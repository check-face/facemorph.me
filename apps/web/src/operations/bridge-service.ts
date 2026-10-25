// Serial provider work with intent ownership; file preparation has its own budget.
// React supplies descriptors/blockers; this boundary owns jobs through settlement.
import type { ComputeRoute } from '@facemorph/stylegan-js';
import { nextScheduled } from '../Next/scheduler.mjs';
import { IntentRegistry } from './intents.ts';
import { morphFrameFailure } from './morph-budget.ts';
import { validateSeedText, validateWords } from '../contracts/inputs.ts';
import {
  sources,
  type CancelTarget,
  type OperationEvent,
  type OperationFailure,
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
  readonly order: number;
  readonly handle: OperationHandle;
  readonly resolve: (value: OperationSettlement) => void;
  readonly dependencies: Set<Work>;
  readonly refusal: OperationFailure | undefined;
  provider: ComputeRoute | null;
  cancelled: boolean;
  started: boolean;
  failure?: OperationFailure;
  work?: Work;
}
interface Work {
  order: number;
  readonly request: OperationRequest;
  readonly jobId: number;
  readonly owners: Map<Pending, 'face' | 'dependency' | 'direct'>;
  readonly done: Promise<void>;
  readonly release: () => void;
  phase: 'queued' | 'compute' | 'file';
  provider: ComputeRoute | null;
  cancelled: boolean;
  output?: Output;
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
  const works = new Map<number, Work>();
  const retries = new Map<string, Extract<OperationRequest, { kind: 'face' }>>();
  const listeners = new Set<(event: OperationEvent) => void>();
  const running = new Set<Promise<void>>();
  let blocked: Omit<SchedulingState, 'busy'> = {};
  let active: Work | undefined;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const bridge = facade;
  let loading: Promise<Bridge> | undefined;
  let unsubscribe: (() => void) | undefined;
  let order = 0;

  function track(task: Promise<void>): void {
    running.add(task);
    void task.finally(() => running.delete(task));
  }
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
  function current(item: Pending): boolean {
    return (
      pending.has(item.handle.requestId) &&
      !item.cancelled &&
      !item.failure &&
      registry.current(item.handle)
    );
  }
  function finish(item: Pending, result: OperationSettlement): void {
    if (!pending.delete(item.handle.requestId)) return;
    if (result.status === 'completed') registry.complete(item.handle.requestId, result.output);
    if (result.status === 'failed') registry.fail(item.handle.requestId);
    if (result.status === 'cancelled' || result.status === 'superseded')
      emit(item, { type: 'cancelled' });
    if (result.status === 'failed') emit(item, { type: 'failed', cause: result.cause });
    emit(item, { type: 'settled', outcome: result.status });
    registry.forget(item.handle.requestId);
    item.resolve(result);
  }
  function progress(p: Progress): void {
    const work = active;
    if (!work || work.cancelled || work.jobId !== p.jobId) return;
    if (p.stage === 'route-admitted' && (p.text === 'cpu' || p.text === 'webgpu'))
      work.provider = p.text;
    for (const item of work.owners.keys()) {
      if (!current(item)) continue;
      item.provider = work.provider;
      if (p.stage === 'route-admitted' && work.provider !== null) emit(item, { type: 'admitted' });
      emit(item, { type: 'progress', progress: p });
    }
  }
  async function getBridge(): Promise<Bridge> {
    return (loading ??= Promise.resolve(bridge).then((b) => {
      if (!disposed) {
        unsubscribe = b.subscribe(progress);
        let depth = 0;
        for (const work of works.values())
          if (work.request.kind === 'face') b.queueFace(work.request.source.slot, ++depth);
      }
      return b;
    }));
  }
  function makeWork(request: OperationRequest, requestedOrder = ++order): Work {
    let release!: () => void;
    const work: Work = {
      request,
      order: requestedOrder,
      jobId: ++jobSequence,
      owners: new Map(),
      done: new Promise<void>((resolve) => {
        release = resolve;
      }),
      release: () => release(),
      phase: 'queued',
      provider: null,
      cancelled: false,
    };
    works.set(work.jobId, work);
    if (request.kind === 'face') bridge.queueFace(request.source.slot, works.size);
    return work;
  }
  function faceWork(request: Extract<OperationRequest, { kind: 'face' }>): Work {
    // A revision identifies immutable input. Different approved routes/identities
    // cannot silently inherit one another's provider or fallback policy.
    for (const work of works.values()) {
      if (work.cancelled || work.request.kind !== 'face') continue;
      const existing = work.request;
      if (
        existing.source.slot === request.source.slot &&
        existing.source.revision === request.source.revision &&
        existing.source.input.mode === request.source.input.mode &&
        existing.source.input.value === request.source.input.value &&
        existing.source.input.file === request.source.input.file &&
        JSON.stringify(existing.route) === JSON.stringify(request.route)
      )
        return work;
    }
    return makeWork(request);
  }
  function attach(item: Pending, work: Work, role: 'face' | 'dependency' | 'direct'): void {
    // A parent's frame lease joins at readiness, after faces requested while it
    // waited. Other requests retain their original FIFO position.
    if (role === 'face' || (role === 'direct' && item.handle.request.kind !== 'morph'))
      work.order = Math.min(work.order, item.order);
    work.owners.set(item, role);
    if (role === 'dependency') item.dependencies.add(work);
    else item.work = work;
    if (work.phase !== 'queued') registry.begin(item.handle.requestId);
    if (work.provider !== null) {
      item.provider = work.provider;
      emit(item, { type: 'admitted' });
    }
    if (work.output) readyOwner(item, work, role, work.output);
  }
  function detach(item: Pending, work: Work): Promise<void> {
    work.owners.delete(item);
    item.dependencies.delete(work);
    if (work.owners.size) return Promise.resolve();
    work.cancelled = true;
    if (work.phase === 'queued') {
      works.delete(work.jobId);
      if (work.request.kind === 'face') bridge.cancelQueuedFace(work.request.source.slot);
      work.release();
    } else if (work === active) {
      // No new provider work is admitted until this real execute settles.
      bridge.cancel();
      if (sources(work.request).some((source) => source.input.mode === 'photo'))
        bridge.cancelPhotoRun();
    }
    return work.done;
  }
  async function abandon(item: Pending, result: OperationSettlement): Promise<void> {
    const owned = new Set(item.dependencies);
    if (item.work) owned.add(item.work);
    await Promise.all([...owned].map((work) => detach(item, work)));
    finish(item, result);
    pump();
  }
  function stop(ids: readonly RequestId[]): void {
    for (const id of ids) {
      const item = pending.get(id);
      if (!item || item.cancelled) continue;
      item.cancelled = true;
      track(abandon(item, { status: 'cancelled' }));
    }
  }
  function fail(item: Pending, cause: OperationFailure): void {
    if (!current(item)) return;
    item.failure = cause;
    track(abandon(item, { status: 'failed', cause }));
  }
  function promote(item: Pending): void {
    if (!current(item) || item.dependencies.size || item.work) return;
    const work = makeWork(item.handle.request);
    attach(item, work, 'direct');
  }
  function readyOwner(
    item: Pending,
    work: Work,
    role: 'face' | 'dependency' | 'direct',
    output: Output,
  ): void {
    if (!current(item)) return;
    item.provider = work.provider;
    if (role === 'dependency') {
      // A verified latent/endpoint is enough. No default-file promise joins
      // the parent's dependency graph, and a file failure cannot rerun inference.
      work.owners.delete(item);
      item.dependencies.delete(work);
      if (item.started) promote(item);
    } else emit(item, { type: 'compute-ready', output });
  }
  function prepareParent(item: Pending): void {
    if (
      item.started ||
      item.handle.request.kind !== 'morph' ||
      blocked.blockMorph ||
      !current(item)
    )
      return;
    const request = item.handle.request;
    for (const source of request.sources) {
      const input = source.input;
      if (
        (input.mode === 'text' && !validateWords(input.value).valid) ||
        (input.mode === 'seed' && !validateSeedText(input.value))
      ) {
        fail(item, {
          kind: 'dependency',
          slot: source.slot,
          recovery: 'edit-input',
          message: 'Correct the selected words or seed, then create the morph again.',
        });
        return;
      }
      if (input.mode === 'photo' && !(input.file instanceof Blob)) {
        fail(item, {
          kind: 'dependency',
          slot: source.slot,
          recovery: 'confirm-photo',
          message: 'Confirm this photo crop, then create the morph again.',
        });
        return;
      }
    }
    // Install every dependency before observing already-ready shared jobs.
    // Otherwise the first cache hit could prematurely queue the frame lease.
    const dependencies = sources(request).map((source) =>
      faceWork({
        kind: 'face',
        source,
        route: request.route,
        settings: request.settings,
      }),
    );
    for (const work of dependencies) {
      work.owners.set(item, 'dependency');
      item.dependencies.add(work);
    }
    registry.begin(item.handle.requestId);
    item.started = true;
    for (const work of dependencies)
      if (work.output) readyOwner(item, work, 'dependency', work.output);
    promote(item);
  }
  async function run(work: Work): Promise<void> {
    try {
      const b = await getBridge();
      if (work.cancelled || disposed) return;
      const request = work.request;
      const inputs = sources(request).map((source) => source.input);
      let output: Output;
      if (request.kind === 'import') {
        output = await b.importProject({
          file: request.file,
          inputs,
          jobId: work.jobId,
          provider: request.route.requested,
          routeSnapshot: request.route,
        });
      } else {
        const payload = {
          ...request.settings,
          jobId: work.jobId,
          action: request.kind,
          target: request.kind === 'face' ? request.source.slot : '',
          inputs,
          provider: request.route.requested,
          routeSnapshot: request.route,
        };
        if (request.kind !== 'face') b.rememberView(payload);
        output = await b.execute(payload);
      }
      if (work.cancelled || disposed) return;
      if (output.refusal) {
        const refusedOwners = [...work.owners];
        for (const [item, role] of refusedOwners)
          fail(
            item,
            role === 'dependency' && request.kind === 'face'
              ? {
                  kind: 'dependency',
                  slot: request.source.slot,
                  recovery: 'choose-supported-route',
                  message: output.refusal.text,
                }
              : { kind: 'admission', refusal: output.refusal },
          );
        return;
      }
      if (output.errorMessage) throw new Error(output.errorMessage);
      if (
        request.kind === 'face' &&
        (output.photoChoices || output.cropFace) &&
        [...work.owners.values()].includes('dependency')
      ) {
        // The parent never treats an unconfirmed crop/picker offer as a latent.
        for (const [item, role] of work.owners)
          if (role === 'dependency')
            fail(item, {
              kind: 'dependency',
              slot: request.source.slot,
              recovery: 'confirm-photo',
              message: 'Confirm this photo crop, then create the morph again.',
            });
      }
      work.output = output;
      // Delivery can detach owners or synchronously request another operation.
      const readyOwners = [...work.owners];
      for (const [item, role] of readyOwners) readyOwner(item, work, role, output);
      work.phase = 'file';
      if (active === work) active = undefined;
      queueMicrotask(pump);
      const prepared =
        request.kind === 'face' &&
        !output.photoChoices &&
        !output.cropFace &&
        [...work.owners.values()].some((role) => role === 'face')
          ? await b.prepareFaceFile(request.source.slot)
          : output;
      const fileOwners = [...work.owners];
      for (const [item, role] of fileOwners) {
        if (role === 'dependency' || !current(item)) continue;
        emit(item, { type: 'file-ready', output: prepared });
        work.owners.delete(item);
        if (current(item)) finish(item, { status: 'completed', output: prepared });
      }
    } catch (error) {
      const failedOwners = [...work.owners];
      for (const [item, role] of failedOwners)
        fail(
          item,
          role === 'dependency' && work.request.kind === 'face'
            ? {
                kind: 'dependency',
                slot: work.request.source.slot,
                recovery: 'retry-face',
                message:
                  'A selected face could not finish. Retry that face, then create the morph again.',
              }
            : {
                kind: 'operation',
                message: error instanceof Error ? error.message : String(error),
              },
        );
    } finally {
      works.delete(work.jobId);
      if (active === work) active = undefined;
      work.release();
      pump();
    }
  }
  function pump(): void {
    for (const item of pending.values()) {
      if (item.refusal) fail(item, item.refusal);
      else prepareParent(item);
    }
    if (active || disposed) return;
    const items = [...works.values()].sort((a, b) => a.order - b.order || a.jobId - b.jobId);
    const descriptors = items.map(({ request, phase }) =>
      request.kind === 'face'
        ? { kind: 'face' as const, id: request.source.slot, phase }
        : { kind: request.kind, phase },
    );
    const work = items[requestNext(descriptors, blocked)];
    if (!work) return;
    for (const item of work.owners.keys()) registry.begin(item.handle.requestId);
    active = work;
    work.phase = 'compute';
    track(run(work));
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
      order: ++order,
      handle,
      resolve,
      dependencies: new Set(),
      provider: null,
      cancelled: false,
      started: false,
      refusal: morphFrameFailure(intent.request),
    };
    pending.set(intent.requestId, item);
    if (intent.request.kind === 'face') retries.set(intent.request.source.slot, intent.request);
    emit(item, { type: 'queued' });
    // Attaching is deferred so a caller can subscribe/cancel using the returned handle.
    queueMicrotask(() => {
      if (!current(item)) return;
      if (!item.refusal && intent.request.kind !== 'morph') {
        const work =
          intent.request.kind === 'face' ? faceWork(intent.request) : makeWork(intent.request);
        attach(item, work, intent.request.kind === 'face' ? 'face' : 'direct');
      }
      pump();
    });
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
      bridge.invalidateFace(slot);
    },
    remove(slot) {
      stop(registry.remove(slot));
      retries.delete(slot);
      bridge.invalidateFace(slot);
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
      for (const item of next) if (item.verified === undefined) bridge.invalidateFace(item.slot);
      if (replacement.kind === 'import') retries.clear();
      else for (const item of next) retries.delete(item.slot);
      bridge.invalidateMorph();
      return true;
    },
    dispose() {
      return (disposing ??= (async () => {
        disposed = true;
        for (const id of pending.keys()) stop(registry.cancel(id));
        while (running.size) await Promise.all(running);
        unsubscribe?.();
        registry.clear();
        listeners.clear();
        retries.clear();
      })());
    },
  };
}
