// The aggregate acquisition budget (fm-fr9s): every worker and tab of one origin shares a fixed number of chunk
// slots, so read-ahead, hashing and write buffering stay inside one bound however many workers acquire at once.
// The candidate read ahead two (or four) chunks per worker, which bounds nothing once two workers overlap.
//
// A slot is one Web Lock (`<name>:slot-<i>`); holding it admits one chunk (at most ACQUISITION_CHUNK_MAX_BYTES)
// from the first byte fetched until it is committed to storage. Priority: inside one manager instance waiters are
// served highest priority first. Across workers and tabs, required work queues on every slot's lock at once and
// keeps the first it is granted, and optional work takes only a slot that is free at that moment, and none while
// any slot request is queued anywhere (`locks.query()`). A released lock goes to a queued request before a later
// `ifAvailable` attempt can see it, so optional preparation does not get ahead of waiting foreground work in any
// worker. Between the required tiers, order holds within an instance; across instances they queue first come.

import {
  ACQUISITION_BUDGETS,
  ACQUISITION_CHUNK_MAX_BYTES,
  type AcquisitionMemoryClass,
} from '../contracts/budgets.ts';
import type { AcquisitionPriority } from '../contracts/grant.ts';

/** Highest first. */
export const PRIORITY_ORDER: readonly AcquisitionPriority[] = Object.freeze([
  'foreground-required',
  'synthesis-prerequisite',
  'detector-prerequisite',
  'optional',
  'speculative-warming',
]);
const rank = (p: AcquisitionPriority) => PRIORITY_ORDER.indexOf(p);
/** Optional tiers never wait in a lock queue: they take a free slot or wait their turn locally. */
export const queuesOnLocks = (p: AcquisitionPriority): boolean => rank(p) < rank('optional');

/** The subset of the Web Locks API the slots use (navigator.locks in windows and workers). */
export interface SlotLocks {
  request(
    name: string,
    options: { readonly ifAvailable?: boolean; readonly signal?: AbortSignal },
    run: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
  query?(): Promise<{ readonly pending?: readonly { readonly name?: string }[] }>;
}

export interface AcquisitionSlots {
  readonly count: number;
  /** Waits for a slot; resolves with its release. Rejects with the signal's reason when cancelled first. */
  take(priority: AcquisitionPriority, signal: AbortSignal): Promise<() => void>;
}

/** Slots per memory class: the aggregate read-ahead budget in whole chunks. */
export function slotCount(memory: AcquisitionMemoryClass): number {
  return ACQUISITION_BUDGETS[memory].readAheadBytes / ACQUISITION_CHUNK_MAX_BYTES;
}

/** How long optional work waits between looks for a free slot. */
export const OPTIONAL_RETRY_MS = 100;

const aborted = () => new DOMException('Asset acquisition cancelled', 'AbortError');

/** Holds one lock until the returned release is called; null when `ifAvailable` found it taken. */
function hold(
  locks: SlotLocks,
  name: string,
  options: { readonly ifAvailable?: boolean; readonly signal?: AbortSignal },
): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, options, (lock) => {
        if (!lock) return resolve(null);
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(reject);
  });
}

interface Waiter {
  readonly priority: AcquisitionPriority;
  readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void;
  readonly reject: (reason: unknown) => void;
}

export function createAcquisitionSlots({
  locks,
  count,
  name = 'facemorph-acquisition',
}: {
  readonly locks: SlotLocks;
  readonly count: number;
  readonly name?: string;
}): AcquisitionSlots {
  if (!Number.isInteger(count) || count < 1)
    throw new TypeError('Acquisition slots: count must be a positive integer');
  const slot = (i: number) => `${name}:slot-${i}`;
  const waiting: Waiter[] = [];
  let next = 0;
  let busy = false;
  /** The waiter whose attempt is in flight; its own signal ends that attempt. */
  let current: Waiter | null = null;

  /** Queues on every slot at once; keeps the first granted and lets any other grant go at once. */
  function queueOnAll(w: Waiter): Promise<() => void> {
    const race = new AbortController();
    const relay = () => race.abort(w.signal.reason ?? aborted());
    w.signal.addEventListener('abort', relay, { once: true });
    return new Promise((resolve, reject) => {
      let won = false;
      let failed = 0;
      for (let i = 0; i < count; i++)
        hold(locks, slot(i), { signal: race.signal }).then(
          (release) => {
            if (!release) return;
            if (won) return release();
            won = true;
            w.signal.removeEventListener('abort', relay);
            race.abort(aborted()); // the other queued requests leave
            resolve(release);
          },
          (error) => {
            if (++failed === count && !won) {
              w.signal.removeEventListener('abort', relay);
              reject(w.signal.reason ?? error);
            }
          },
        );
    });
  }

  /** Whether a slot request is queued anywhere on this origin (unknown when the platform cannot say). */
  async function othersWaiting(): Promise<boolean> {
    if (!locks.query) return false;
    const { pending = [] } = await locks.query();
    return pending.some((p) => p.name?.startsWith(`${name}:slot-`) === true);
  }

  /**
   * One attempt for the head waiter: any free slot, else (required work) the queues of all of them. Optional work
   * that finds none free, or finds required work queued anywhere, pauses and returns null, so a higher-priority
   * waiter that arrived meanwhile goes first.
   */
  async function grantHead(w: Waiter): Promise<(() => void) | null> {
    if (w.signal.aborted) throw w.signal.reason ?? aborted();
    const required = queuesOnLocks(w.priority);
    if (required || !(await othersWaiting()))
      for (let k = 0; k < count; k++) {
        if (w.signal.aborted) throw w.signal.reason ?? aborted();
        const release = await hold(locks, slot((next + k) % count), { ifAvailable: true });
        if (w.signal.aborted) {
          release?.();
          throw w.signal.reason ?? aborted();
        }
        if (release) {
          next = (next + k + 1) % count;
          return release;
        }
      }
    // A cancellation during the lookups above has already fired, so the queue's relay would never see it.
    if (w.signal.aborted) throw w.signal.reason ?? aborted();
    if (required) return queueOnAll(w);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        w.signal.removeEventListener('abort', stop);
        resolve();
      }, OPTIONAL_RETRY_MS);
      const stop = () => {
        clearTimeout(timer);
        reject(w.signal.reason ?? aborted());
      };
      w.signal.addEventListener('abort', stop, { once: true });
    });
    return null;
  }

  /**
   * Platform queries and ifAvailable callbacks need not answer before cancellation. Let the caller and the local
   * queue move on immediately; an outstanding attempt still owns its answer and returns any grant that arrives late.
   */
  function attemptHead(w: Waiter): Promise<(() => void) | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cancel = () => {
        if (settled) return;
        settled = true;
        w.signal.removeEventListener('abort', cancel);
        reject(w.signal.reason ?? aborted());
      };
      w.signal.addEventListener('abort', cancel, { once: true });
      if (w.signal.aborted) return cancel();
      void grantHead(w).then(
        (release) => {
          if (settled) return release?.();
          settled = true;
          w.signal.removeEventListener('abort', cancel);
          resolve(release);
        },
        (error) => {
          if (settled) return;
          settled = true;
          w.signal.removeEventListener('abort', cancel);
          reject(error);
        },
      );
    });
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (waiting.length) {
        waiting.sort((a, b) => rank(a.priority) - rank(b.priority));
        const w = waiting[0]!;
        current = w;
        try {
          const release = await attemptHead(w);
          current = null;
          if (!release) continue;
          waiting.splice(waiting.indexOf(w), 1);
          // Cancelled while its attempt was in flight (the abort listener leaves the current waiter to the attempt):
          // the slot goes back and the caller is told. Releasing without rejecting left the take pending forever,
          // and with it the whole acquisition (hosted macOS WebKit, fm-fy2.13: a sibling chunk's reset aborted a lane
          // whose `ifAvailable` lookup then found a free slot).
          if (w.signal.aborted) {
            release();
            w.reject(w.signal.reason ?? aborted());
          } else w.resolve(release);
        } catch (error) {
          current = null;
          const at = waiting.indexOf(w);
          if (at >= 0) waiting.splice(at, 1);
          w.reject(error);
        }
      }
    } finally {
      busy = false;
    }
  }

  return Object.freeze({
    count,
    take(priority: AcquisitionPriority, signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(signal.reason ?? aborted());
      return new Promise<() => void>((resolve, reject) => {
        let once = false;
        const release = (r: () => void) => () => {
          if (once) return;
          once = true;
          r();
        };
        const cleanup = () => signal.removeEventListener('abort', cancel);
        const w: Waiter = {
          priority,
          signal,
          resolve: (r) => {
            cleanup();
            resolve(release(r));
          },
          reject: (reason) => {
            cleanup();
            reject(reason);
          },
        };
        // A waiter cancelled before its turn leaves at once; an attempt in flight is ended by its signal.
        const cancel = () => {
          const at = waiting.indexOf(w);
          if (at >= 0 && current !== w) {
            waiting.splice(at, 1);
            w.reject(signal.reason ?? aborted());
          }
        };
        signal.addEventListener('abort', cancel, { once: true });
        waiting.push(w);
        void pump();
      });
    },
  });
}
