// Serial provider work with intent ownership; file preparation has its own budget.
// React supplies descriptors/blockers; this boundary owns jobs through settlement.
import type { ComputeRoute } from '@facemorph/stylegan-js';
import { nextScheduled } from '../Next/scheduler.mjs';
import { IntentRegistry } from './intents.ts';
import { morphFrameFailure } from './morph-budget.ts';
import type { MorphChecks } from './morph-guards.ts';
import {
  createGovernor,
  type AdmittedPhase,
  type Governor,
  type GovernorTraceEvent,
  type Lease,
} from './scheduler.ts';
import {
  createActionProgress,
  morphLine,
  type ActionProgressTracker,
  type PhaseKind,
  type PhasePlan,
} from './progress.ts';
import type { HeavyOp, ProviderContextId } from '../contracts/scheduler.ts';
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
/** The bridge calls this boundary makes; tests supply a recording implementation. */
export type OperationBridge = Pick<
  Bridge,
  | 'subscribe'
  | 'queueFace'
  | 'cancelQueuedFace'
  | 'cancel'
  | 'cancelPhotoRun'
  | 'importProject'
  | 'execute'
  | 'rememberView'
  | 'prepareFaceFile'
  | 'invalidateFace'
  | 'invalidateMorph'
>;
type EventPayload<E = OperationEvent> = E extends OperationEvent
  ? Omit<E, 'intent' | 'provider'>
  : never;
interface Pending {
  readonly order: number;
  readonly handle: OperationHandle;
  readonly resolve: (value: OperationSettlement) => void;
  readonly dependencies: Set<Work>;
  readonly refusal: OperationFailure | undefined;
  /** The morph acceptance pre-checks (neighbour rule, MP4 probe) have passed; no work starts before. */
  checked: boolean;
  provider: ComputeRoute | null;
  cancelled: boolean;
  started: boolean;
  failure?: OperationFailure;
  work?: Work;
  /** The whole action's bar for this attempt, and its status line. */
  readonly bar: ActionProgressTracker;
  line: string | null;
  readyDependencies: number;
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
/** Runtime progress stages that are admitted phases of the job holding the compute permit. */
const PHASES: Readonly<Record<string, AdmittedPhase>> = {
  'models-download': 'runtime-init',
  'route-attempt': 'session-load',
  'canary-invalidated': 'canary',
  face: 'inference',
  morph: 'inference',
};
// Phase shares of one action, from the device-lab journey measurements (tools/device-lab/journeys.json):
// on eris CPU a cold face spends ~3 s of ~21 s on acquisition and loading and the rest generating; a
// phone morph spends most of its time on frames. Costs that are not known up front stay null, so the
// bar is indeterminate until they are, instead of racing to 99%.
function planFor(request: OperationRequest): PhasePlan[] {
  const file: PhasePlan = { kind: 'file', unit: 'steps', weight: 0.1, total: 1 };
  switch (request.kind) {
    case 'face':
      return [
        { kind: 'acquisition', unit: 'bytes', weight: 0.15, total: null },
        { kind: 'load', unit: 'steps', weight: 0.1, total: 1 },
        { kind: 'compute', unit: 'steps', weight: 0.65, total: 1 },
        file,
      ];
    case 'morph':
      return [
        { kind: 'prepare', unit: 'steps', weight: 0.25, total: request.sources.length },
        { kind: 'frames', unit: 'frames', weight: 0.65, total: null },
        file,
      ];
    case 'blend':
      return [
        {
          kind: 'prepare',
          unit: 'steps',
          weight: 0.5,
          total: request.weights.filter((w) => w !== 0).length,
        },
        { kind: 'compute', unit: 'steps', weight: 0.4, total: 1 },
        file,
      ];
    case 'faces':
      return [{ kind: 'compute', unit: 'steps', weight: 0.9, total: request.sources.length }, file];
    case 'import':
      return [{ kind: 'compute', unit: 'steps', weight: 0.9, total: 1 }, file];
  }
}
const hasPhase = (bar: ActionProgressTracker, kind: PhaseKind) =>
  bar.snapshot().phases.some((p) => p.kind === kind);

/** Parent intents wait for their slots' latents, holding nothing, and join the queue when ready. */
const isParent = (request: OperationRequest): boolean =>
  request.kind === 'morph' || request.kind === 'blend';
/** The slots a parent depends on: every morph face, and each blend slot with a nonzero weight. */
function dependencySources(request: OperationRequest) {
  return request.kind === 'blend'
    ? request.sources.filter((_, index) => request.weights[index] !== 0)
    : sources(request);
}
function blendFailure(request: OperationRequest): OperationFailure | undefined {
  if (request.kind !== 'blend') return;
  if (
    request.weights.length !== request.sources.length ||
    request.weights.some((weight) => !Number.isFinite(weight))
  )
    return {
      kind: 'blend-weights',
      recovery: 'adjust-weights',
      message: 'Give every blended face a weight.',
    };
  if (request.weights.every((weight) => weight === 0))
    return {
      kind: 'blend-weights',
      recovery: 'adjust-weights',
      message: 'Give at least one face a weight other than 0.',
    };
}
const sameRecord = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((key) => x[key] === y[key]);
};
/** Whether a morph request repeats a pending morph exactly: no new faces, order, revision or setting. */
function sameMorph(existing: OperationRequest, request: OperationRequest): boolean {
  return (
    existing.kind === 'morph' &&
    request.kind === 'morph' &&
    existing.sources.length === request.sources.length &&
    existing.sources.every((source, index) => {
      const next = request.sources[index]!;
      return (
        source.slot === next.slot &&
        source.revision === next.revision &&
        sameRecord(source.input, next.input)
      );
    }) &&
    sameRecord(existing.settings, request.settings) &&
    sameRecord(existing.route, request.route)
  );
}
const heavyOp = (request: OperationRequest): HeavyOp =>
  request.kind === 'morph'
    ? 'morph-frames'
    : request.kind === 'face' && request.source.input.mode === 'photo'
      ? 'photo-encode'
      : 'face-synthesis';
const contextOf = (request: OperationRequest): ProviderContextId =>
  `${request.route.requested === 'webgpu' ? 'webgpu' : 'cpu'}:${request.route.runtimeSha256}`;

/** One entry of the operation trace; IDs are concrete here and mapped to symbols by the comparator. */
export type OperationTraceEvent =
  | GovernorTraceEvent
  | {
      readonly type: 'request';
      readonly requestId: string;
      readonly attemptId: string;
      readonly kind: OperationRequest['kind'];
      readonly inputs: readonly {
        readonly slot: string;
        readonly revision: number;
        readonly mode: string;
      }[];
    }
  | { readonly type: 'provider-requested'; readonly jobId: string; readonly requested: string }
  | { readonly type: 'provider-actual'; readonly jobId: string; readonly provider: string }
  | {
      readonly type: 'compute-ready' | 'file-ready' | 'cancelled' | 'settled';
      readonly requestId: string;
      readonly attemptId: string;
      readonly outcome?: string;
    };

/** What an offline job that needed missing files says: what still works, and that Retry will finish it. */
export const OFFLINE_MISSING_ASSETS =
  "You're offline, and this face needs model files that aren't on this device yet. Faces you've finished and saved files still work. Reconnect, then try again.";

export function createOperationService(
  options: {
    readonly bridge?: OperationBridge;
    readonly governor?: Governor;
    /** Whether the browser reports a network; offline failures are typed rather than passed through. */
    readonly online?: () => boolean;
    /** Records the operation trace (fm-vbj7): requests, governor decisions, providers and settlements. */
    readonly trace?: (event: OperationTraceEvent) => void;
    /** Morph acceptance pre-checks run before any dependency, acquisition or inference (fm-fy2.9). */
    readonly morphChecks?: MorphChecks;
  } = {},
): OperationService {
  const online = options.online ?? (() => globalThis.navigator?.onLine !== false);
  // Residency bytes stay symbolic (zero) until the contracts decode measurement supplies them; the
  // runtime keeps its own warm-model policy, so release hooks have nothing further to do here yet.
  const governor =
    options.governor ??
    createGovernor({
      policy: { memory: 'ample' },
      hooks: { releaseWarm() {}, terminateWorkers() {} },
      ...(options.trace ? { trace: options.trace } : {}),
    });
  const trace = (event: OperationTraceEvent) => options.trace?.(event);
  const leases = new Map<number, Lease>();
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
  const bridge: OperationBridge = options.bridge ?? facade;
  let loading: Promise<OperationBridge> | undefined;
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
    if (
      event.type === 'compute-ready' ||
      event.type === 'file-ready' ||
      event.type === 'cancelled' ||
      event.type === 'settled'
    )
      trace({
        type: event.type,
        requestId: item.handle.requestId,
        attemptId: item.handle.attemptId,
        ...(event.type === 'settled' ? { outcome: event.outcome } : {}),
      });
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
    if (result.status !== 'completed')
      item.bar.settle(result.status === 'failed' ? 'failed' : 'cancelled');
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
    if (p.stage === 'route-admitted' && (p.text === 'cpu' || p.text === 'webgpu')) {
      if (work.provider !== p.text)
        trace({ type: 'provider-actual', jobId: String(work.jobId), provider: p.text });
      work.provider = p.text;
    }
    const phase = PHASES[p.stage];
    if (phase) leases.get(work.jobId)?.phase(phase);
    for (const [item, role] of work.owners) {
      if (!current(item)) continue;
      item.provider = work.provider;
      if (p.stage === 'route-admitted' && work.provider !== null) emit(item, { type: 'admitted' });
      // A dependency's own stages are its tile's business: the parent's bar moves when it is ready.
      if (role !== 'dependency') advanceBar(item, p);
      emit(item, { type: 'progress', progress: p, action: item.bar.snapshot(), line: item.line });
    }
  }
  function advanceBar(item: Pending, p: Progress): void {
    const { bar } = item;
    const morph = item.handle.request.kind === 'morph';
    const loaded = Number((p as { loaded?: unknown }).loaded);
    const total = Number((p as { total?: unknown }).total);
    if (['route-attempt', 'route-admitted', 'model-loaded'].includes(p.stage)) {
      if (hasPhase(bar, 'acquisition')) bar.finish('acquisition');
    } else if (p.stage === 'face' || p.stage === 'synthesis') {
      if (hasPhase(bar, 'acquisition')) bar.finish('acquisition');
      if (hasPhase(bar, 'load')) bar.finish('load');
    } else if (p.stage === 'morph' && hasPhase(bar, 'frames')) {
      if (Number.isFinite(loaded))
        bar.advance('frames', 'frames', loaded, Number.isFinite(total) ? total : undefined);
    } else if (p.stage === 'export' && hasPhase(bar, 'frames')) {
      bar.finish('frames');
    }
    if (!morph) {
      if (p.text) item.line = p.text;
      return;
    }
    // Release gate (operator, 21 September): while a morph renders the line is the finished-frame
    // count and nothing else; MP4 preparation follows it so the action never ends in silence.
    if (p.stage === 'morph') {
      const frames = bar.snapshot().phases.find((phase) => phase.kind === 'frames');
      if (frames?.total) item.line = morphLine(frames.done, frames.total);
    } else if (p.stage === 'export' && p.text) item.line = p.text;
  }
  async function getBridge(): Promise<OperationBridge> {
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
    if (role === 'face' || (role === 'direct' && !isParent(item.handle.request)))
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
  function stop(ids: readonly RequestId[], status: 'cancelled' | 'superseded' = 'cancelled'): void {
    for (const id of ids) {
      const item = pending.get(id);
      if (!item || item.cancelled) continue;
      item.cancelled = true;
      track(abandon(item, { status }));
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
      if (hasPhase(item.bar, 'prepare'))
        item.bar.advance('prepare', 'steps', ++item.readyDependencies);
      if (item.started) promote(item);
    } else {
      for (const kind of ['acquisition', 'load', 'compute', 'frames'] as const)
        if (hasPhase(item.bar, kind)) item.bar.finish(kind);
      emit(item, { type: 'compute-ready', output });
    }
  }
  function prepareParent(item: Pending): void {
    if (
      item.started ||
      !item.checked ||
      !isParent(item.handle.request) ||
      blocked.blockMorph ||
      !current(item)
    )
      return;
    const request = item.handle.request;
    for (const source of dependencySources(request)) {
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
    const dependencies = dependencySources(request).map((source) =>
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
  async function settleLease(work: Work): Promise<void> {
    const lease = leases.get(work.jobId);
    leases.delete(work.jobId);
    await lease?.settle();
  }
  async function run(work: Work): Promise<void> {
    try {
      const b = await getBridge();
      if (work.cancelled || disposed) return;
      const request = work.request;
      // The compute permit covers runtime init, session load, canary and inference.
      trace({
        type: 'provider-requested',
        jobId: String(work.jobId),
        requested: request.route.requested,
      });
      leases.set(
        work.jobId,
        await governor.request({
          id: String(work.jobId),
          op: heavyOp(request),
          context: contextOf(request),
          bytes: 0,
          sessions: 1,
        }),
      );
      if (work.cancelled || disposed) return;
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
      } else if (request.kind === 'blend') {
        // Weight-0 slots were never dependencies and are not part of the sum.
        const used = request.sources.flatMap((source, index) =>
          request.weights[index] === 0
            ? []
            : [{ input: source.input, weight: request.weights[index]! }],
        );
        output = await b.execute({
          ...request.settings,
          jobId: work.jobId,
          action: 'blend',
          target: request.target,
          inputs: used.map((slot) => slot.input),
          weights: used.map((slot) => slot.weight),
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
      // Compute has settled: file preparation below holds no heavyweight permit.
      await settleLease(work);
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
        // The completion boundary: the default file (a morph's playable MP4) is ready.
        item.bar.fileReady();
        emit(item, { type: 'file-ready', output: prepared });
        work.owners.delete(item);
        if (current(item)) finish(item, { status: 'completed', output: prepared });
      }
    } catch (error) {
      const failedOwners = [...work.owners];
      // Offline, a job that fails is one whose files are not all on this device: a typed failure
      // with Retry, never the runtime's generic "engine stopped" (defect 15).
      const offline = !online();
      for (const [item, role] of failedOwners)
        fail(
          item,
          offline
            ? { kind: 'offline', message: OFFLINE_MISSING_ASSETS, recovery: 'retry' }
            : role === 'dependency' && work.request.kind === 'face'
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
      await settleLease(work);
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
    // One current morph: repeating the pending morph (same faces, revisions, settings and route)
    // is that intent, not a second one; any other morph supersedes it below.
    const repeat =
      request.kind === 'morph'
        ? [...pending.values()].find(
            (other) => current(other) && sameMorph(other.handle.request, request),
          )
        : undefined;
    if (repeat) return repeat.handle;
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
      bar: createActionProgress(intent.attemptId, planFor(intent.request)),
      line: null,
      readyDependencies: 0,
      refusal: morphFrameFailure(intent.request) ?? blendFailure(intent.request),
      checked: intent.request.kind !== 'morph' || !options.morphChecks,
    };
    // A newer blend for the same result, or any newer morph (new faces, order or settings), supersedes
    // a pending one: latest wins, the old result is never installed. It is stopped after the newer one
    // has joined the shared slot jobs, so no face reruns.
    const superseded =
      intent.request.kind === 'blend' || intent.request.kind === 'morph'
        ? [...pending.values()]
            .filter((other) => {
              const r = other.handle.request;
              return intent.request.kind === 'morph'
                ? r.kind === 'morph'
                : r.kind === 'blend' &&
                    intent.request.kind === 'blend' &&
                    r.target === intent.request.target;
            })
            .map((other) => other.handle.requestId)
        : [];
    pending.set(intent.requestId, item);
    trace({
      type: 'request',
      requestId: intent.requestId,
      attemptId: intent.attemptId,
      kind: intent.request.kind,
      inputs: sources(intent.request).map((s) => ({
        slot: s.slot,
        revision: s.revision,
        mode: s.input.mode,
      })),
    });
    if (intent.request.kind === 'face') retries.set(intent.request.source.slot, intent.request);
    emit(item, { type: 'queued' });
    // Attaching is deferred so a caller can subscribe/cancel using the returned handle.
    queueMicrotask(() => {
      if (!current(item)) return;
      if (!item.refusal && !isParent(intent.request)) {
        const work =
          intent.request.kind === 'face' ? faceWork(intent.request) : makeWork(intent.request);
        attach(item, work, intent.request.kind === 'face' ? 'face' : 'direct');
      }
      pump();
      stop(superseded, 'superseded');
      const checks = options.morphChecks;
      const request = intent.request;
      if (!item.checked && !item.refusal && checks && request.kind === 'morph')
        track(
          checks(request).then(
            (result) => {
              if (!current(item)) return;
              if (result.failure) return fail(item, result.failure);
              if (result.route?.ok && result.route.disclosure)
                emit(item, {
                  type: 'disclosure',
                  text: result.route.disclosure,
                  width: result.route.width,
                });
              item.checked = true;
              pump();
            },
            (error: unknown) =>
              fail(item, {
                kind: 'operation',
                message: error instanceof Error ? error.message : String(error),
              }),
          ),
        );
    });
    return handle;
  }
  return {
    requestFace: queue,
    requestFaces: queue,
    requestMorph: queue,
    requestBlend: queue,
    requestImport: queue,
    requestNext,
    capability(route) {
      return governor.capability(
        `${route.requested === 'webgpu' ? 'webgpu' : 'cpu'}:${route.runtimeSha256}`,
      );
    },
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
