// The engine over one loaded generator (fm-3h3w): map and synthesize as settled operations, the canary
// admission, and one inference lane shared by user work and background qualification. Ported from the
// candidate's ort-worker.mjs pump()/startResumeDrain() and runtime.mjs operation()/afterDelivery()
// (classic a42829b).
//
// - Every request is validated first (the worker schema's own checks); an invalid one settles failed with
//   'invalid-request' and touches nothing.
// - One foreground operation runs at a time, in arrival order. A background canary runs only while nothing
//   is queued, so a user operation waits out at most the single canary already in flight.
// - Cold ordinary admission runs exactly one canary before the first face; the rest start after the first
//   face is delivered, behind foreground work; a compatible recorded receipt runs none; `full` runs all
//   before any face. A canary failing in the background invalidates the route: later operations fail with
//   correctnessFailure, and the trace says so.
// - Revisions: per slot, a request older than the newest seen settles 'superseded' without running, and a
//   queued or running one settles 'superseded' as soon as a newer one arrives (a late result never
//   replaces a newer input).
// - Abort settles 'cancelled' at once, whatever stage the work is in; work already inside an inference
//   finishes on the lane and its result is discarded. Cancel and dispose settle everything pending.

import type { CancellationSignal, LoadedModelCapability } from '../contracts/capability.ts';
import type {
  EngineError,
  EngineErrorCode,
  MappingRequest,
  MappingResult,
  OperationIds,
  OperationSettlement,
  SynthesisRequest,
  SynthesisResult,
} from '../contracts/operations.ts';
import type { StageTimingHook } from '../contracts/timing.ts';
import { validateWorkerRequest, WorkerMessageError } from '../contracts/worker-messages.ts';
import { GeneratorUnavailable } from './adapters/generator.ts';
import {
  CanaryFailed,
  type AdmissionReceipt,
  type CanaryEvent,
  type CanaryQualification,
} from './canary.ts';
import { DescriptorUnsupported } from './model.ts';
import { LocalAssetUnavailable } from './reader.ts';

export type EngineTraceEvent =
  | {
      readonly kind: 'canary';
      readonly name: string;
      readonly index: number;
      readonly phase: 'admission' | 'background';
    }
  | {
      readonly kind: 'admitted';
      readonly ran: number;
      readonly cached: boolean;
      readonly partial: boolean;
      readonly full: boolean;
    }
  | {
      readonly kind: 'operation';
      readonly operation: 'map' | 'synthesize';
      readonly requestId: string;
    }
  | { readonly kind: 'qualified'; readonly checks: number }
  | { readonly kind: 'canary-invalidated'; readonly name: string };

export interface OperationOptions {
  readonly signal?: CancellationSignal;
  readonly onTiming?: StageTimingHook;
  /** Revisions are compared within a slot (default: the operation kind). */
  readonly slot?: string;
}

export interface Engine {
  /** The capability operated on: a generator, or the manager's loaded handle capability around one. */
  readonly generator: LoadedModelCapability;
  /** Runs the admission canaries now (otherwise the first operation does). */
  admit(): Promise<AdmissionReceipt | null>;
  map(
    request: MappingRequest,
    options?: OperationOptions,
  ): Promise<OperationSettlement<MappingResult>>;
  synthesize(
    request: SynthesisRequest,
    options?: OperationOptions,
  ): Promise<OperationSettlement<SynthesisResult>>;
  /** Settles once the background canaries have finished (or failed); resolves at once when none remain. */
  qualified(): Promise<void>;
  trace(): readonly EngineTraceEvent[];
  state(): {
    readonly admitted: boolean;
    readonly invalid: string | null;
    readonly queued: number;
    readonly running: boolean;
  };
  /** Every pending operation settles 'cancelled'. */
  cancel(): void;
  /** Settles pending operations, then releases the generator. */
  dispose(): Promise<void>;
}

/** Maps what an adapter threw to the structured, clone-safe engine error. */
export function engineError(error: unknown): EngineError {
  const message = error instanceof Error ? error.message : String(error);
  const fail = (code: EngineErrorCode, extra: Partial<EngineError> = {}): EngineError => ({
    code,
    message,
    ...extra,
  });
  if (error instanceof CanaryFailed) return fail('route-failed', { correctnessFailure: true });
  if (error instanceof GeneratorUnavailable)
    return error.kind === 'disposed'
      ? fail('disposed')
      : fail('route-failed', { cause: error.kind });
  if (error instanceof LocalAssetUnavailable)
    return fail('route-failed', { cause: error.error.code });
  // A descriptor the engine cannot run names its field in the message (fm-qjcs).
  if (error instanceof DescriptorUnsupported) return fail('unsupported');
  if (error instanceof WorkerMessageError || error instanceof TypeError)
    return fail('invalid-request');
  // The manager's HandleUnavailable carries its typed error (invalidated with a cause, evicted, corrupt).
  const managed = (error as { error?: { code?: unknown; cause?: unknown } } | null)?.error;
  if (managed && typeof managed.code === 'string')
    return fail('route-failed', {
      cause: typeof managed.cause === 'string' ? managed.cause : managed.code,
    });
  if (error instanceof Error && error.name === 'NotSupportedError') return fail('unsupported');
  if (error instanceof RangeError || /out of memory/i.test(message)) return fail('out-of-memory');
  return fail('internal');
}

interface Pending {
  readonly ids: OperationIds;
  readonly slot: string;
  settle(
    s: OperationSettlement<never> | { status: 'superseded'; ids: OperationIds; by: OperationIds },
  ): void;
}

export function createEngine(o: {
  readonly generator: LoadedModelCapability;
  readonly qualification?: CanaryQualification | null;
}): Engine {
  const { generator } = o;
  const q = o.qualification ?? null;
  const events: EngineTraceEvent[] = [];
  const foreground: (() => Promise<void>)[] = [];
  let background: (() => Promise<void>) | null = null;
  let pumping = false;
  let running = false;
  let disposed = false;
  let admission: Promise<AdmissionReceipt | null> | null = null;
  let admitted = false;
  let invalid: string | null = null;
  let draining: Promise<void> | null = null;
  let drainDone: (() => void) | null = null;
  const latest = new Map<string, OperationIds>();
  const pending = new Set<Pending>();

  const onCanary = (e: CanaryEvent) =>
    events.push({ kind: 'canary', name: e.name, index: e.index, phase: e.phase });

  function pump() {
    if (pumping) return;
    pumping = true;
    void (async () => {
      try {
        for (;;) {
          const unit = foreground.shift() ?? background;
          if (!unit) break;
          if (unit === background) background = null;
          running = true;
          try {
            await unit();
          } catch {
            /* units settle their own operations */
          }
          running = false;
        }
      } finally {
        // Cleared in the same turn as the empty-queue check: a unit queued after it starts a new pump. (A
        // .finally() on the promise ran a few microtasks later, and work queued in between was never run.)
        pumping = false;
      }
    })();
  }

  function admit(): Promise<AdmissionReceipt | null> {
    admission ??= (async () => {
      if (!q) {
        admitted = true;
        return null;
      }
      const receipt = await q.admit(onCanary);
      events.push({
        kind: 'admitted',
        ran: receipt.ran,
        cached: receipt.cached,
        partial: receipt.partial,
        full: receipt.full,
      });
      admitted = true;
      if (!receipt.partial) events.push({ kind: 'qualified', checks: receipt.checks.length });
      return receipt;
    })().catch((error: unknown) => {
      admission = null;
      if (error instanceof CanaryFailed) invalid = error.check.name;
      throw error;
    });
    return admission;
  }

  /** After the first delivered face: the remaining canaries, one per idle moment of the lane. */
  function startDrain() {
    if (!q || q.complete() || draining || invalid || disposed) return;
    draining = new Promise<void>((r) => (drainDone = r));
    const step = () => {
      background = async () => {
        if (disposed || invalid) return finishDrain();
        try {
          await q.runNext('background', onCanary);
        } catch (error) {
          if (error instanceof CanaryFailed) {
            invalid = error.check.name;
            events.push({ kind: 'canary-invalidated', name: error.check.name });
          }
          return finishDrain();
        }
        if (q.complete()) {
          events.push({ kind: 'qualified', checks: q.checks().length });
          return finishDrain();
        }
        step();
      };
      pump();
    };
    step();
  }
  function finishDrain() {
    drainDone?.();
    drainDone = null;
  }

  function operate<R extends { ids: OperationIds }>(
    type: 'map' | 'synthesize',
    request: MappingRequest | SynthesisRequest,
    options: OperationOptions,
    run: (
      signal: CancellationSignal | undefined,
      onTiming: StageTimingHook | undefined,
    ) => Promise<R>,
  ): Promise<OperationSettlement<R>> {
    const ids = (request as { ids?: OperationIds } | null)?.ids as OperationIds;
    try {
      validateWorkerRequest({ type, id: 'engine', request });
    } catch (error) {
      const fallback = {
        requestId: String(ids?.requestId ?? ''),
        inputRevision: -1,
        attemptId: -1,
      };
      return Promise.resolve({ status: 'failed', ids: ids ?? fallback, error: engineError(error) });
    }
    if (disposed)
      return Promise.resolve({
        status: 'failed',
        ids,
        error: { code: 'disposed', message: 'The engine was disposed.' },
      });
    const { signal, onTiming } = options;
    if (signal?.aborted) return Promise.resolve({ status: 'cancelled', ids });
    const slot = options.slot ?? type;
    const newest = latest.get(slot);
    if (newest && ids.inputRevision < newest.inputRevision)
      return Promise.resolve({ status: 'superseded', ids, by: newest });
    latest.set(slot, ids);
    // A newer input supersedes whatever older work of this slot is still pending.
    for (const p of pending)
      if (p.slot === slot && p.ids.inputRevision < ids.inputRevision)
        p.settle({ status: 'superseded', ids: p.ids, by: ids });

    return new Promise<OperationSettlement<R>>((resolve) => {
      let settled = false;
      const entry: Pending = {
        ids,
        slot,
        settle: (s) => {
          if (settled) return;
          settled = true;
          pending.delete(entry);
          signal?.removeEventListener('abort', onAbort);
          resolve(s as OperationSettlement<R>);
        },
      };
      const onAbort = () => entry.settle({ status: 'cancelled', ids } as never);
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.add(entry);
      foreground.push(async () => {
        if (settled) return; // cancelled or superseded while queued: never run
        try {
          if (invalid)
            throw new CanaryFailed({ name: invalid, maxRgb: NaN, maxFloat: NaN, passed: false });
          if (!admitted) await admit();
          if (settled) return;
          events.push({ kind: 'operation', operation: type, requestId: ids.requestId });
          const result = await run(signal, onTiming);
          entry.settle({ status: 'completed', ids, result } as never);
          if (type === 'synthesize') startDrain();
        } catch (error) {
          entry.settle({ status: 'failed', ids, error: engineError(error) } as never);
        }
      });
      pump();
    });
  }

  function settleAll() {
    for (const p of pending) p.settle({ status: 'cancelled', ids: p.ids } as never);
  }

  return {
    generator,
    admit: () => admit(),
    map: (request, options = {}) =>
      operate('map', request, options, (signal, onTiming) =>
        generator.map(request, signal, onTiming),
      ),
    synthesize: (request, options = {}) =>
      operate('synthesize', request, options, (signal, onTiming) =>
        generator.synthesize(request, signal, onTiming),
      ),
    qualified: () => draining ?? Promise.resolve(),
    trace: () => events.slice(),
    state: () => ({ admitted, invalid, queued: foreground.length, running }),
    cancel: settleAll,
    async dispose() {
      if (disposed) return;
      disposed = true;
      foreground.length = 0;
      background = null;
      settleAll();
      finishDrain();
      await generator.dispose();
    },
  };
}
