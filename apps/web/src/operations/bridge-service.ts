// Serial bridge execution with intent ownership. React supplies descriptors/blockers; this boundary owns jobs.
import type { ComputeRoute } from '@facemorph/stylegan-js';
import { nextScheduled } from '../Next/scheduler.mjs';
import { IntentRegistry } from './intents.ts';
import {
  sources,
  type CancelTarget,
  type OperationEvent,
  type OperationHandle,
  type OperationRequest,
  type OperationService,
  type OperationSettlement,
  type RequestId,
  type ScheduledJob,
  type SchedulingState,
} from './service.ts';
import type { Output, Progress } from '../../shell/facade/records.ts';
import * as facade from '../../shell/facade/bridge.ts';

type Bridge = typeof import('../../shell/facade/bridge.ts');
type EventPayload<E = OperationEvent> = E extends OperationEvent
  ? Omit<E, 'intent' | 'provider'>
  : never;
interface Pending {
  readonly handle: OperationHandle;
  readonly jobId: number;
  readonly resolve: (value: OperationSettlement) => void;
  provider: ComputeRoute | null;
  cancelled: boolean;
}

/** The same public scheduling seam used by the service, callable with plain descriptors before a browser exists. */
export function requestNext(jobs: readonly ScheduledJob[], state: SchedulingState = {}): number {
  return (nextScheduled as (jobs: readonly ScheduledJob[], state: SchedulingState) => number)(
    jobs,
    state,
  );
}

let jobSequence = 0;
export function createOperationService(): OperationService {
  const registry = new IntentRegistry<Output>();
  const pending = new Map<RequestId, Pending>();
  const retries = new Map<string, Extract<OperationRequest, { kind: 'face' }>>();
  const listeners = new Set<(event: OperationEvent) => void>();
  let blocked: Omit<SchedulingState, 'busy'> = {};
  let active: Pending | undefined;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  let bridge: Bridge = facade;
  let loading: Promise<Bridge> | undefined;
  let unsubscribe: (() => void) | undefined;
  let running: Promise<void> | undefined;

  function emit(item: Pending, event: EventPayload): void {
    const full = {
      ...event,
      intent: {
        requestId: item.handle.requestId,
        attemptId: item.handle.attemptId,
        request: item.handle.request,
      },
      provider: item.provider,
    } as OperationEvent;
    for (const callback of listeners) {
      try {
        callback(full);
      } catch (error) {
        console.error('[operation-service listener]', error);
      }
    }
  }
  function progress(p: Progress): void {
    const item = active;
    if (!item || item.cancelled || item.jobId !== p.jobId || !registry.current(item.handle)) return;
    if (p.stage === 'route-admitted' && (p.text === 'cpu' || p.text === 'webgpu')) {
      item.provider = p.text;
      emit(item, { type: 'admitted' });
    }
    emit(item, { type: 'progress', progress: p });
  }
  async function getBridge(): Promise<Bridge> {
    return (loading ??= Promise.resolve(bridge).then((b) => {
      bridge = b;
      if (!disposed) {
        unsubscribe = b.subscribe(progress);
        let depth = 0;
        for (const item of pending.values())
          if (item.handle.request.kind === 'face')
            b.queueFace(item.handle.request.source.slot, ++depth);
      }
      return b;
    }));
  }
  function finish(item: Pending, result: OperationSettlement): void {
    if (!pending.delete(item.handle.requestId)) return;
    if (result.status === 'cancelled' || result.status === 'superseded')
      emit(item, { type: 'cancelled' });
    if (result.status === 'failed') emit(item, { type: 'failed', cause: result.cause });
    emit(item, { type: 'settled', outcome: result.status });
    registry.forget(item.handle.requestId);
    item.resolve(result);
  }
  function stop(ids: readonly RequestId[]): void {
    for (const id of ids) {
      const item = pending.get(id);
      if (!item) continue;
      item.cancelled = true;
      if (item === active) {
        // Keep the serial lane occupied until execute's finally releases its owned resources.
        bridge?.cancel();
        if (sources(item.handle.request).some((s) => s.input.mode === 'photo'))
          bridge?.cancelPhotoRun();
      } else {
        if (item.handle.request.kind === 'face')
          bridge?.cancelQueuedFace(item.handle.request.source.slot);
        finish(item, { status: 'cancelled' });
      }
    }
  }
  async function run(item: Pending): Promise<void> {
    try {
      const b = await getBridge();
      if (item.cancelled || disposed) return;
      const request = item.handle.request;
      const inputs = sources(request).map((s) => s.input);
      let output: Output;
      if (request.kind === 'import') {
        output = await b.importProject({
          file: request.file,
          inputs,
          jobId: item.jobId,
          provider: request.route.requested,
          routeSnapshot: request.route,
        });
      } else {
        const payload = {
          ...request.settings,
          jobId: item.jobId,
          action: request.kind,
          target: request.kind === 'face' ? request.source.slot : '',
          inputs,
          provider: request.route.requested,
          routeSnapshot: request.route,
        };
        // A face request contains one slot; the controller has already remembered the full
        // view. Replacing it here would lose siblings when the visitor returns.
        if (request.kind !== 'face') b.rememberView(payload);
        output = await b.execute(payload);
      }
      if (item.cancelled || disposed) return;
      if (output.refusal) {
        registry.fail(item.handle.requestId);
        finish(item, { status: 'failed', cause: { kind: 'admission', refusal: output.refusal } });
      } else if (output.errorMessage) {
        registry.fail(item.handle.requestId);
        finish(item, {
          status: 'failed',
          cause: { kind: 'operation', message: output.errorMessage },
        });
      } else if (!registry.current(item.handle)) {
        finish(item, { status: 'superseded' });
      } else {
        emit(item, { type: 'compute-ready', output });
        // Bridge file readiness is separate from raw display readiness. Its save path awaits encoding.
        const prepared =
          request.kind === 'face' && !output.photoChoices && !output.cropFace
            ? await b.prepareFaceFile(request.source.slot)
            : output;
        if (!item.cancelled && !disposed && registry.current(item.handle)) {
          registry.complete(item.handle.requestId, prepared);
          emit(item, { type: 'file-ready', output: prepared });
          finish(item, { status: 'completed', output: prepared });
        } else finish(item, { status: item.cancelled || disposed ? 'cancelled' : 'superseded' });
      }
    } catch (error) {
      if (!item.cancelled && !disposed) {
        registry.fail(item.handle.requestId);
        finish(item, {
          status: 'failed',
          cause: {
            kind: 'operation',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } finally {
      if (item.cancelled || disposed) finish(item, { status: 'cancelled' });
      active = undefined;
      running = undefined;
      pump();
    }
  }
  function pump(): void {
    if (active || disposed) return;
    const items = [...pending.values()];
    const descriptors = items.map(({ handle: { request } }) =>
      request.kind === 'face'
        ? { kind: 'face' as const, id: request.source.slot }
        : { kind: request.kind },
    );
    const index = requestNext(descriptors, blocked);
    const item = items[index];
    if (!item) return;
    if (!registry.begin(item.handle.requestId)) {
      finish(item, { status: 'superseded' });
      pump();
      return;
    }
    active = item;
    running = run(item);
  }
  function queue(request: OperationRequest): OperationHandle {
    if (disposed) throw new Error('Operation service disposed');
    const intent = registry.queue(request);
    let resolve!: Pending['resolve'];
    const done = new Promise<OperationSettlement>((r) => {
      resolve = r;
    });
    const handle = Object.freeze({ ...intent, done });
    const item: Pending = {
      handle,
      resolve,
      jobId: ++jobSequence,
      provider: null,
      cancelled: false,
    };
    pending.set(intent.requestId, item);
    if (intent.request.kind === 'face') {
      retries.set(intent.request.source.slot, intent.request);
      bridge?.queueFace(intent.request.source.slot, pending.size);
    }
    emit(item, { type: 'queued' });
    // Let the caller receive the handle and synchronously cancel/block before heavy execution begins.
    queueMicrotask(pump);
    return handle;
  }
  return {
    requestFace: queue,
    requestFaces: queue,
    requestMorph: queue,
    requestImport: queue,
    requestNext,
    setBlocked(state) {
      blocked = {
        ...state,
        ...(state.blockedFaces ? { blockedFaces: [...state.blockedFaces] } : {}),
      };
      pump();
    },
    revise(slot, revision) {
      stop(registry.revise(slot, revision));
      retries.delete(slot);
      bridge?.invalidateFace(slot);
    },
    remove(slot) {
      stop(registry.remove(slot));
      retries.delete(slot);
      bridge?.invalidateFace(slot);
    },
    cancel(target: CancelTarget) {
      stop('slot' in target ? registry.cancelSlot(target.slot) : registry.cancel(target.requestId));
    },
    retry(slot) {
      const request = retries.get(slot);
      if (!request) throw new Error('No retryable request for this slot');
      return queue(request);
    },
    subscribe(callback) {
      if (disposed) throw new Error('Operation service disposed');
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    stageReplacement(kind, slots) {
      if (disposed) throw new Error('Operation service disposed');
      return registry.stageReplacement(kind, slots);
    },
    abandonReplacement(replacement) {
      registry.abandonReplacement(replacement);
    },
    commitReplacement(replacement, next) {
      if (disposed) throw new Error('Operation service disposed');
      const ids = registry.commitReplacement(replacement, next);
      if (ids === null) return false;
      stop(ids);
      for (const item of next) if (item.verified === undefined) bridge?.invalidateFace(item.slot);
      if (replacement.kind === 'import') retries.clear();
      else for (const item of next) retries.delete(item.slot);
      bridge?.invalidateMorph();
      return true;
    },
    dispose() {
      return (disposing ??= (async () => {
        disposed = true;
        for (const id of pending.keys()) stop(registry.cancel(id));
        await running;
        unsubscribe?.();
        registry.clear();
        listeners.clear();
        retries.clear();
      })());
    },
  };
}
