// The aggregate acquisition budget (fm-fr9s): every worker and tab of one origin shares a fixed number of chunk
// slots, so read-ahead, hashing and write buffering stay inside one bound however many workers acquire at once.
// The candidate read ahead two (or four) chunks per worker, which bounds nothing once two workers overlap.
//
// A slot is one Web Lock (`<name>:slot-<i>`); holding it admits one chunk (at most ACQUISITION_CHUNK_MAX_BYTES)
// from the first byte fetched until it is committed to storage. Priority: inside one manager instance waiters are
// served highest priority first. Across workers, required work queues on the locks, and optional work only ever
// takes a slot that is free at that moment: a released lock goes to a queued request before any later
// `ifAvailable` attempt can see it, so optional preparation never gets ahead of foreground work anywhere.

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

  /**
   * One attempt for the head waiter: any free slot, else (required work) the queue of one of them. Optional work
   * that finds none pauses and returns null, so a higher-priority waiter that arrived meanwhile goes first.
   */
  async function grantHead(w: Waiter): Promise<(() => void) | null> {
    if (w.signal.aborted) throw w.signal.reason ?? aborted();
    for (let k = 0; k < count; k++) {
      const release = await hold(locks, slot((next + k) % count), { ifAvailable: true });
      if (release) {
        next = (next + k + 1) % count;
        return release;
      }
    }
    if (queuesOnLocks(w.priority)) {
      const i = next;
      next = (next + 1) % count;
      return hold(locks, slot(i), { signal: w.signal });
    }
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

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (waiting.length) {
        waiting.sort((a, b) => rank(a.priority) - rank(b.priority));
        const w = waiting[0]!;
        current = w;
        try {
          const release = await grantHead(w);
          current = null;
          if (!release) continue;
          waiting.splice(waiting.indexOf(w), 1);
          if (w.signal.aborted) release();
          else w.resolve(release);
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
        const w: Waiter = { priority, signal, resolve: (r) => resolve(release(r)), reject };
        // A waiter cancelled before its turn leaves at once; an attempt in flight is ended by its signal.
        signal.addEventListener(
          'abort',
          () => {
            const at = waiting.indexOf(w);
            if (at >= 0 && current !== w) {
              waiting.splice(at, 1);
              reject(signal.reason ?? aborted());
            }
          },
          { once: true },
        );
        waiting.push(w);
        void pump();
      });
    },
  });
}
