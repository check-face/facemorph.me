// The application scheduler's governor (fm-in6a): the runtime counterpart of the pure reference model in
// contracts/scheduler.ts. One compute permit per provider context, residency reserved before anything is
// allocated and bounded by the contracts' live-residency ceilings, idle warm memory counted until it is
// actually released, and constrained devices tearing workers down between heavy phases. Waiting jobs hold
// nothing; jobs are admitted in request order, so a stream of new faces cannot starve an eligible morph.
import { CEILINGS } from '../contracts/ceilings.ts';
import {
  RESIDENCY_OF,
  tearsDownBetweenPhases,
  type CapabilityStatus,
  type ComputePermit,
  type ConstrainedTeardownPolicy,
  type HeavyOp,
  type ProviderContextId,
  type Residency,
  type ResidencyReservation,
} from '../contracts/scheduler.ts';

export interface GovernorLimits {
  /** Model bytes resident at once, all workers together (LIVE_RESIDENT_BYTES). */
  readonly maxResidentBytes: number;
  /** ORT sessions alive at once (LIVE_SESSIONS). */
  readonly maxLiveSessions: number;
}
function ceiling(name: 'LIVE_RESIDENT_BYTES' | 'LIVE_SESSIONS'): number {
  const found = CEILINGS.find((c) => c.name === name);
  if (!found) throw new Error(`Missing contracts ceiling ${name}`);
  return found.value;
}
/** The numeric limits, read from the contracts ceilings file rather than restated here. */
export const contractLimits = (): GovernorLimits =>
  Object.freeze({
    maxResidentBytes: ceiling('LIVE_RESIDENT_BYTES'),
    maxLiveSessions: ceiling('LIVE_SESSIONS'),
  });

export interface GovernorJob {
  readonly id: string;
  readonly op: HeavyOp;
  readonly context: ProviderContextId;
  /** What the job keeps resident while it runs (model, shard buffers, heaps, GPU allocations). */
  readonly bytes: number;
  readonly sessions: number;
}
/** Admission covers every phase that allocates or computes, not only the final inference call. */
export type AdmittedPhase = 'runtime-init' | 'session-load' | 'canary' | 'inference';
export interface Lease {
  readonly permit: ComputePermit;
  readonly reservation: ResidencyReservation;
  readonly phases: readonly AdmittedPhase[];
  phase(name: AdmittedPhase): void;
  /** Compute settled: the permit goes; the residency stays warm only under the qualified desktop policy. */
  settle(): Promise<void>;
}
export interface GovernorHooks {
  /** Actually release an idle residency (end the sessions, free the buffers). */
  releaseWarm(context: ProviderContextId, residency: Residency): Promise<void> | void;
  /** Terminate alignment/encoder workers: ending an ONNX session does not shrink its WASM heap. */
  terminateWorkers(context: ProviderContextId): Promise<void> | void;
}
export class CapabilityUnavailable extends Error {
  readonly context: ProviderContextId;
  readonly status: CapabilityStatus;
  constructor(context: ProviderContextId, status: CapabilityStatus) {
    super(`Provider ${context} is ${status}`);
    this.context = context;
    this.status = status;
  }
}
export interface GovernorSnapshot {
  readonly permits: readonly ComputePermit[];
  readonly reservations: readonly ResidencyReservation[];
  readonly warm: readonly ResidencyReservation[];
  readonly waiting: readonly string[];
  readonly residentBytes: number;
}

interface Waiter {
  readonly job: GovernorJob;
  readonly resolve: (lease: Lease) => void;
  readonly reject: (error: Error) => void;
}
interface Held {
  readonly reservation: ResidencyReservation;
  readonly bytes: number;
  readonly context: ProviderContextId;
  /** Null while the residency is idle (warm). */
  permit: ComputePermit | null;
}

export function createGovernor(options: {
  readonly policy: ConstrainedTeardownPolicy;
  readonly hooks: GovernorHooks;
  readonly limits?: GovernorLimits;
}) {
  const limits = options.limits ?? contractLimits();
  const queue: Waiter[] = [];
  const held = new Set<Held>();
  const unavailable = new Set<ProviderContextId>();
  const releasing = new Set<ProviderContextId>();
  const loads = new Map<ProviderContextId, Promise<unknown>>();
  let loadChain: Promise<unknown> = Promise.resolve();
  let scheduled = false;

  const resident = () => [...held].reduce((sum, h) => sum + h.bytes, 0);
  const sessions = () => [...held].reduce((sum, h) => sum + h.reservation.sessions, 0);
  const activeIn = (context: ProviderContextId) =>
    [...held].some((h) => h.context === context && h.permit !== null);

  function reservationOf(job: GovernorJob): ResidencyReservation {
    return Object.freeze({
      jobId: job.id,
      residency: RESIDENCY_OF[job.op],
      sessions: job.sessions,
      shardBufferBytes: 0,
      wasmHeapBytes: job.bytes,
      gpuBytes: 0,
    });
  }
  async function release(warm: Held): Promise<void> {
    releasing.add(warm.context);
    try {
      await options.hooks.releaseWarm(warm.context, warm.reservation.residency);
      if (tearsDownBetweenPhases(options.policy))
        await options.hooks.terminateWorkers(warm.context);
    } finally {
      // Counted until the release has actually happened.
      held.delete(warm);
      releasing.delete(warm.context);
      schedule();
    }
  }
  function grant(waiter: Waiter, reuse: Held | undefined): void {
    const { job } = waiter;
    if (reuse) held.delete(reuse);
    const permit = Object.freeze({ context: job.context, jobId: job.id });
    const entry: Held = {
      reservation: reservationOf(job),
      bytes: job.bytes,
      context: job.context,
      permit,
    };
    held.add(entry);
    const phases: AdmittedPhase[] = [];
    let settled = false;
    waiter.resolve({
      permit,
      reservation: entry.reservation,
      phases,
      phase(name) {
        if (settled) throw new Error('A settled lease admits no further phase');
        phases.push(name);
      },
      async settle() {
        if (settled) return;
        settled = true;
        entry.permit = null;
        if (tearsDownBetweenPhases(options.policy)) await release(entry);
        else schedule();
      },
    });
  }
  /** Admits waiters in request order; a job that cannot start yet blocks later jobs on its context. */
  function admit(): void {
    const blocked = new Set<ProviderContextId>();
    // A copy: granted or rejected waiters are spliced out while iterating.
    for (const waiter of queue.slice()) {
      const { job } = waiter;
      if (blocked.has(job.context)) continue;
      blocked.add(job.context);
      if (unavailable.has(job.context)) {
        queue.splice(queue.indexOf(waiter), 1);
        waiter.reject(new CapabilityUnavailable(job.context, 'unavailable'));
        continue;
      }
      if (activeIn(job.context) || releasing.has(job.context)) continue;
      const needs = RESIDENCY_OF[job.op];
      const warm = [...held].filter((h) => h.permit === null);
      const reuse = warm.find(
        (h) => h.context === job.context && h.reservation.residency === needs,
      );
      // Encoder and generator never overlap in one context: the other idle residency goes first.
      const conflicting = warm.find((h) => h.context === job.context && h !== reuse);
      if (conflicting) {
        void release(conflicting);
        continue;
      }
      const otherBytes = resident() - (reuse?.bytes ?? 0);
      const otherSessions = sessions() - (reuse?.reservation.sessions ?? 0);
      if (
        otherBytes + job.bytes > limits.maxResidentBytes ||
        otherSessions + job.sessions > limits.maxLiveSessions
      ) {
        // Idle residency elsewhere is released to make room; live work is waited for.
        const idle = warm.find((h) => h !== reuse && !releasing.has(h.context));
        if (idle) void release(idle);
        continue;
      }
      queue.splice(queue.indexOf(waiter), 1);
      grant(waiter, reuse);
    }
  }
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      admit();
    });
  }

  return {
    limits,
    /** Waits, holding nothing, until the job's permit and reservation can both be granted. */
    request(job: GovernorJob): Promise<Lease> {
      if (job.bytes > limits.maxResidentBytes || job.sessions > limits.maxLiveSessions)
        return Promise.reject(new RangeError(`Job ${job.id} exceeds the live-residency ceiling`));
      return new Promise<Lease>((resolve, reject) => {
        queue.push({ job, resolve, reject });
        schedule();
      });
    },
    /** Drops a waiting job; an admitted one settles through its lease. */
    withdraw(jobId: string): boolean {
      const index = queue.findIndex((w) => w.job.id === jobId);
      if (index < 0) return false;
      queue.splice(index, 1)[0]!.reject(new Error('Withdrawn'));
      schedule();
      return true;
    },
    /**
     * Provider loads are admitted one at a time: a load already running for this context is joined,
     * and a load for another context starts only after the previous one finishes.
     */
    load<T>(context: ProviderContextId, start: () => Promise<T>): Promise<T> {
      const existing = loads.get(context);
      if (existing) return existing as Promise<T>;
      const run = loadChain.then(start, start);
      const tracked = run.finally(() => {
        if (loads.get(context) === tracked) loads.delete(context);
      });
      loads.set(context, tracked);
      loadChain = tracked.catch(() => {});
      return tracked;
    },
    capability(context: ProviderContextId): CapabilityStatus {
      return unavailable.has(context) ? 'unavailable' : activeIn(context) ? 'busy' : 'available';
    },
    setAvailable(context: ProviderContextId, available: boolean): void {
      if (available) unavailable.delete(context);
      else unavailable.add(context);
      schedule();
    },
    snapshot(): GovernorSnapshot {
      const all = [...held];
      return {
        permits: all.flatMap((h) => (h.permit ? [h.permit] : [])),
        reservations: all.map((h) => h.reservation),
        warm: all.filter((h) => h.permit === null).map((h) => h.reservation),
        waiting: queue.map((w) => w.job.id),
        residentBytes: resident(),
      };
    },
  };
}
export type Governor = ReturnType<typeof createGovernor>;
