import * as facade from '../../shell/facade/bridge.ts';
import * as helpers from '../../shell/facade/helpers.ts';
import { createOperationService } from '../operations/bridge-service.ts';
import { morphFrameFailure } from '../operations/morph-budget.ts';
import { morphChecks, neighbourFailure } from '../operations/morph-guards.ts';
import { browserWebCodecs, probeMp4, type FfmpegAvailability } from '../media/mp4-probe.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import type {
  OperationFailure,
  OperationEvent,
  OperationHandle,
  OperationRequest,
  SourceSnapshot,
} from '../operations/service.ts';
import type { Effect, Transition } from './effects.ts';
import { rejection, unchanged } from './effects.ts';
import type { State, Input, Progress, Request, Downloads } from './state.ts';
import { init, type InitialFacts } from './init.ts';
import { faceInputProblem } from './derived.ts';
import { msg } from './msg.ts';
import { reportSent } from './reducers/reporting.ts';
import { cancelled } from './reducers/jobs.ts';
import { UNDO_MS } from './reducers/undo.ts';
import { schedule, scheduled, scheduling } from './reducers/schedule.ts';
import { createStore, type Store } from './store.ts';
import { classifyStills, isHeld, stillLog } from '../media/still-entry.ts';
import { saveFile, shareFile } from '../Next/media.mjs';
import type { ClassifiedStill } from './msg.ts';
import { subscribeProgress, subscribeDownloads } from './subscriptions.ts';
import { storedSize } from '../../shell/session/app-storage.ts';
import { createPhotoTasks } from './photo-tasks.ts';
import { retirePhotoRunInputs } from './admission.ts';
import { BLEND_RESULT } from './blend.ts';

export interface RuntimeIdentity {
  readonly runtimeSha256: string;
  readonly modelSha256: string;
}
export interface ControllerOptions {
  /** Already verified manifest identity; no model acquisition is performed by controller setup. */
  readonly identity: RuntimeIdentity;
}
const commands = new Set<Effect['type']>([
  'restoreLastResult',
  'subscribe',
  'subscribeDownloads',
  'dispatch',
  'loadNames',
  'publicPreview',
  'pickName',
  'sliderFrames',
  'checkCachedFace',
  'execute',
  'importProject',
  'saveMedia',
  'shareMedia',
  'exportProject',
  'requestNext',
  'selectPhoto',
  'classifyStills',
  'previewPhoto',
  'cropPhoto',
  'runBlend',
]);
export function orderedEffects(effects: readonly Effect[]): readonly Effect[] {
  return [
    ...effects.filter((effect) => !commands.has(effect.type)),
    ...effects.filter((effect) => commands.has(effect.type)),
  ];
}

/** A failed classifier settles only its own token, never a newer pick's preparation. */
export function classificationFailure(
  state: State,
  effect: Extract<Effect, { type: 'classifyStills' }>,
  error: unknown,
): Transition {
  if (state.StillChecks?.get(effect.key) !== effect.token) return unchanged(state);
  const checks = new Map(state.StillChecks);
  checks.delete(effect.key);
  return {
    state: { ...state, StillChecks: checks },
    effects:
      effect.target !== null && !state.Inputs.some((input) => input.id === effect.target)
        ? []
        : [{ type: 'dispatch', message: rejection(effect, error) }],
  };
}

/** Adapts the action's spoken line and bar; route events retain their provider metadata. */
export function operationProgress(
  event: Extract<OperationEvent, { type: 'progress' }>,
  jobId: number,
  currentStatus: string,
): Progress {
  return {
    ...event.progress,
    jobId,
    fraction: event.action.fraction ?? -1,
    text:
      event.intent.request.kind === 'morph' && !event.progress.stage.startsWith('route-')
        ? (event.line ?? currentStatus)
        : event.progress.text,
  };
}

/**
 * Where the FFmpeg fallback stands, read from the same-origin runtime manifest (not a model asset): absent
 * only when the manifest positively carries no codec; cached when the bridge's inventory found both its parts
 * verified on this device; in scope once the person approved its bytes in this tab; otherwise acquisition
 * consent asks for it (fm-9kr8). An unreadable manifest is not a refusal: the bridge decides.
 */
async function ffmpegAvailability(
  downloads: Downloads,
  approved: boolean,
): Promise<FfmpegAvailability> {
  let codec: unknown;
  try {
    const response = await fetch('/runtime/manifest.json', { credentials: 'omit' });
    if (!response.ok) return 'needs-consent';
    codec = ((await response.json()) as { codec?: unknown }).codec;
  } catch {
    return 'needs-consent';
  }
  if (!codec) return 'absent';
  if (approved) return 'in-scope';
  return downloads.known && downloads.codecReady === true ? 'cached' : 'needs-consent';
}

/**
 * Each file's recovery verdict (fm-4f5m). A held still gets a display URL when its pixels decode; a damaged one
 * only learns whether they decode (Use as photo is offered then). Nothing here fetches.
 */
async function classify(files: readonly File[]): Promise<readonly ClassifiedStill[]> {
  const entries = await classifyStills(files);
  return Promise.all(
    entries.map(async (entry): Promise<ClassifiedStill> => {
      if (!isHeld(entry.kind)) return entry;
      let decodes = false;
      try {
        (await createImageBitmap(entry.file)).close();
        decodes = true;
      } catch {
        /* the pixels do not decode */
      }
      return {
        ...entry,
        decodes,
        url: decodes && entry.kind !== 'damaged' ? URL.createObjectURL(entry.file) : '',
      };
    }),
  );
}
/** A held still is handed over as the exact File that was opened (media.mjs owns Save/Share). */
function handOver(file: File, share: boolean): Promise<string> {
  const name =
    file.name || (file.type === 'image/webp' ? 'facemorph-face.webp' : 'facemorph-face.png');
  return share ? shareFile(file, name) : saveFile(file, name);
}

/** The only I/O boundary for the controller. All compute goes through the operation service. */
export function createController(
  facts: InitialFacts,
  options: ControllerOptions,
): { readonly store: Store; dispose(): Promise<void> } {
  // A test can ask for the operation trace (fm-vbj7) by providing an array before the app starts.
  const opctlTrace = (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] })
    .__FACEMORPH_OPCTL_TRACE__;
  // A test can likewise ask for the face trace (fm-id4c): every invalidateFace and slot cancel, in order.
  const faceTraceHook = (globalThis as { __FACEMORPH_FACE_TRACE__?: unknown })
    .__FACEMORPH_FACE_TRACE__;
  const faceTrace = Array.isArray(faceTraceHook) ? (faceTraceHook as unknown[]) : null;
  // Morph acceptance pre-checks (fm-fy2.9): the neighbour rule and MP4 probe answer before any acquisition.
  const checks = morphChecks({
    probe: (request) =>
      probeMp4({
        fps: request.settings.fps,
        webcodecs: browserWebCodecs(),
        ffmpeg: () => {
          const state = store.getState();
          return ffmpegAvailability(state.Downloads, state.DownloadConsent.has('codec'));
        },
        quality: request.settings.quality ?? 'standard',
        deviceMemoryGiB:
          (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? null,
      }),
  });
  const service = createOperationService({
    ...(Array.isArray(opctlTrace) ? { trace: (event) => void opctlTrace.push(event) } : {}),
    morphChecks: checks,
  });
  /** The Morph status refusal from the last pre-check, cleared or replaced when the inputs change. */
  let morphRefusal: string | null = null;
  const initial = init(facts);
  const revisions = new Map<string, number>();
  const photoSelections = new Map<string, number>();
  let photoSelectionSequence = 0;
  let detections: Promise<void> = Promise.resolve();
  let crops: Promise<void> = Promise.resolve();
  const handles = new Map<OperationHandle, number>();
  const pending = new Set<Promise<unknown>>();
  const photoTasks = createPhotoTasks();
  const subscriptions = new Map<'subscribe' | 'subscribeDownloads', () => void>();
  const identity = Object.freeze({ ...options.identity });
  let arrivalRevision = 0;
  let disposed = false;
  // The stored session's bytes as last measured, for admission's stored-session budget (fm-id4c); measured at
  // start and after each completed job, 0 while unknown or where the browser keeps nothing.
  let storedSessionBytes = 0;
  const measureStored = () =>
    void storedSize().then(
      (size) => (storedSessionBytes = size.session),
      () => {},
    );
  measureStored();
  const store = createStore(initial.state, {
    facts: (message, state) => ({
      ...(['AddAt', 'Photos', 'PickPhoto', 'Classified', 'BatchOk', 'BlendAddToMorph'].includes(
        message.type,
      )
        ? { storedSessionBytes, pendingPhotoFiles: photoTasks.files() }
        : {}),
      ...(message.type === 'AddAt' || message.type === 'BlendAddToMorph'
        ? { newFaceId: `face-${crypto.randomUUID().replaceAll('-', '')}` }
        : {}),
      // Blend slot ids (fm-2kse): one per morph face plus a spare when the view first opens, one per added slot.
      ...((message.type === 'BlendView' && message.args[0] && !state.Blend) ||
      message.type === 'BlendAdd'
        ? {
            blendIds: Array.from(
              { length: message.type === 'BlendAdd' ? 1 : state.Inputs.length + 1 },
              () => `blend-${crypto.randomUUID().replaceAll('-', '')}`,
            ),
          }
        : {}),
      ...(message.type === 'StartOver'
        ? {
            startOverIds: [
              `face-${crypto.randomUUID().replaceAll('-', '')}`,
              `face-${crypto.randomUUID().replaceAll('-', '')}`,
            ] as const,
          }
        : {}),
      ...(message.type === 'Classified' && !message.args[2]
        ? {
            newPhotoIds: message.args[4].map(
              () => `face-${crypto.randomUUID().replaceAll('-', '')}`,
            ),
          }
        : {}),
      ...(message.type === 'BatchOk' && state.Batch
        ? {
            newPhotoIds: state.Batch.order.map(
              () => `face-${crypto.randomUUID().replaceAll('-', '')}`,
            ),
            photoRevisions: Object.fromEntries(
              state.Inputs.map((input) => [input.id, facade.photoRevision(input.id)]),
            ),
          }
        : {}),
      ...(message.type === 'Photos'
        ? {
            newPhotoIds: message.args[1].map(
              () => `face-${crypto.randomUUID().replaceAll('-', '')}`,
            ),
          }
        : {}),
      ...(message.type === 'Cropped'
        ? { photoRevision: facade.photoRevision(message.args[0]) }
        : message.type === 'CropAccept' && state.Crop
          ? { photoRevision: facade.photoRevision(state.Crop.faceId) }
          : {}),
      measurements: {
        faceMs: facade.measuredFaceMs(),
        frameMs: facade.measuredFrameMs(),
        videoMs: facade.measuredVideoMs(),
        plannedFrames: facade.plannedFrames({
          inputs: state.Inputs,
          kind: state.Kind,
          width: state.Width,
          pinch: state.Pinch,
          frames: state.Frames,
          fps: state.Fps,
        }),
      },
      progress: facade.jobProgress(),
      multipleFacesMessage: facade.MULTIPLE_FACES_MESSAGE,
    }),
    runEffects,
  });
  function task<T>(
    promise: Promise<T>,
    fulfilled: (value: T) => void,
    rejected: (error: unknown) => void,
  ): void {
    const running = promise.then(
      (value) => {
        if (!disposed) fulfilled(value);
      },
      (error: unknown) => {
        if (!disposed) rejected(error);
      },
    );
    pending.add(running);
    void running.then(
      () => pending.delete(running),
      (error: unknown) => {
        pending.delete(running);
        console.error('[controller effect]', error);
      },
    );
  }
  function update(transition: (state: State) => Transition): void {
    if (!disposed)
      store.update((current) => {
        const next = transition(current);
        return { ...next, state: retirePhotoRunInputs(next.state) };
      });
  }
  function photoTask<T>(
    files: readonly Blob[],
    start: () => Promise<T>,
    fulfilled: (value: T) => void,
    rejected: (error: unknown) => void,
  ): void {
    task(
      photoTasks.run(
        files,
        start,
        (value) => {
          if (!disposed) fulfilled(value);
        },
        (error) => {
          if (!disposed) rejected(error);
        },
      ),
      () => {},
      (error) => {
        throw error;
      },
    );
  }
  /** A morph face or a blend slot (fm-2kse) with this id. */
  const inputOf = (state: State, id: string): Input | undefined =>
    state.Inputs.find((input) => input.id === id) ??
    state.Blend?.slots.find((slot) => slot.input.id === id)?.input;
  /** The blend view's current parent intent; a newer one supersedes it inside the service. */
  let blendHandle: OperationHandle | null = null;
  function runBlend(effect: Extract<Effect, { type: 'runBlend' }>): void {
    const state = store.getState();
    const request: Extract<OperationRequest, { kind: 'blend' }> = {
      kind: 'blend',
      sources: effect.inputs.map(source),
      weights: effect.weights,
      target: BLEND_RESULT,
      settings: {
        kind: state.Kind,
        width: state.Width,
        pinch: state.Pinch,
        frames: state.Frames,
        fps: state.Fps,
        quality: state.Quality ?? 'standard',
      },
      route: { ...identity, requested: effect.provider, fallbackScope: 'cpu-once' },
    };
    const handle = service.requestBlend(request);
    blendHandle = handle;
    const off = service.subscribe((event) => {
      if (disposed || event.intent.requestId !== handle.requestId) return;
      if (event.type === 'dependency-ready') {
        const face = event.output.faces.find((item) => item.id === event.slot);
        if (face) store.dispatch(msg('BlendSlotReady', face));
      }
    });
    photoTask(
      effect.inputs.flatMap((input) => (input.file ? [input.file] : [])),
      () => handle.done,
      (result) => {
        off();
        if (blendHandle === handle) blendHandle = null;
        if (result.status === 'completed') {
          for (const face of result.output.faces)
            if (effect.inputs.some((input) => input.id === face.id))
              store.dispatch(msg('BlendSlotReady', face));
          const face = result.output.faces.find((item) => item.id === BLEND_RESULT);
          store.dispatch(
            face
              ? msg('BlendCompleted', effect.revision, face)
              : msg('BlendFailed', effect.revision, 'The blend returned no face.'),
          );
        } else if (result.status === 'failed')
          store.dispatch(
            msg(
              'BlendFailed',
              effect.revision,
              result.cause.kind === 'admission' ? result.cause.refusal.text : result.cause.message,
            ),
          );
        else store.dispatch(msg('BlendSettled', effect.revision));
        measureStored();
      },
      (error) => {
        off();
        if (blendHandle === handle) blendHandle = null;
        store.dispatch(
          msg(
            'BlendFailed',
            effect.revision,
            error instanceof Error ? error.message : String(error),
          ),
        );
      },
    );
  }
  function source(input: Input): SourceSnapshot {
    return { slot: input.id, revision: (revisions.get(input.id) ?? 1) as InputRevision, input };
  }
  async function watch(handle: OperationHandle, jobId: number, final: boolean): Promise<boolean> {
    handles.set(handle, jobId);
    let committed = false;
    const off = service.subscribe((event) => {
      if (disposed || event.intent.requestId !== handle.requestId) return;
      if (event.type === 'progress')
        store.dispatch(msg('Progressed', operationProgress(event, jobId, store.getState().Status)));
      if (event.type === 'dependency-ready')
        update((current) => {
          const request = event.intent.request;
          const expected =
            'sources' in request
              ? request.sources.find((source) => source.slot === event.slot)?.input
              : undefined;
          const input = current.Inputs.find((input) => input.id === event.slot);
          const face = event.output.faces.find((face) => face.id === event.slot);
          if (
            current.JobId !== jobId ||
            !current.Busy ||
            !face ||
            !input ||
            !expected ||
            input.mode !== expected.mode ||
            input.value !== expected.value ||
            input.file !== expected.file
          )
            return unchanged(current);
          return {
            state: {
              ...current,
              Faces: [...current.Faces.filter((face) => face.id !== event.slot), face],
              ActiveFace: current.ActiveFace === event.slot ? null : current.ActiveFace,
            },
            effects: [],
          };
        });
      if (event.type === 'disclosure')
        update((current) =>
          current.JobId === jobId
            ? { state: { ...current, Status: event.text, Disclosure: event.text }, effects: [] }
            : unchanged(current),
        );
      if (
        final &&
        !committed &&
        'output' in event &&
        (event.intent.request.kind === 'morph'
          ? event.type === 'file-ready'
          : event.type === 'compute-ready')
      ) {
        committed = true;
        store.dispatch(msg('Completed', jobId, event.output));
        measureStored();
      }
    });
    try {
      const result = await handle.done;
      if (disposed) return false;
      if (result.status === 'completed') {
        if (final && !committed) store.dispatch(msg('Completed', jobId, result.output));
        return true;
      }
      const cause = result.status === 'failed' ? result.cause : null;
      if (
        cause &&
        (cause.kind === 'morph-neighbours' ||
          cause.kind === 'mp4-route' ||
          cause.kind === 'morph-frames')
      ) {
        refuseMorph(cause, jobId);
      } else if (result.status === 'failed') {
        store.dispatch(
          msg(
            'Failed',
            jobId,
            result.cause.kind === 'admission'
              ? result.cause.refusal.text
              : handle.request.kind === 'morph' &&
                  result.cause.kind === 'operation' &&
                  !/not covered by an approved download|needs more data than was approved/.test(
                    result.cause.message,
                  )
                ? 'This morph could not finish. Your completed faces are still ready. Retry, or reduce Length in More options.'
                : result.cause.message,
          ),
        );
      } else if (!committed) update((current) => cancelled(current, jobId));
      return false;
    } finally {
      off();
      handles.delete(handle);
    }
  }
  /** A morph refused at acceptance says why in Morph status, never as a generic failure. */
  function refuseMorph(cause: OperationFailure, jobId: number | null): void {
    if (
      cause.kind !== 'morph-neighbours' &&
      cause.kind !== 'mp4-route' &&
      cause.kind !== 'morph-frames'
    )
      return;
    const text = cause.message;
    morphRefusal = cause.kind === 'morph-neighbours' ? text : null;
    update((current) =>
      (jobId === null ? current.Busy : current.JobId !== jobId)
        ? unchanged(current)
        : schedule({
            ...current,
            Busy: false,
            Error: null,
            Status: text,
            Stage: 'idle',
            Fraction: 0,
            Warn: null,
            Remaining: '',
            ActiveFace: null,
          }),
    );
  }
  /** A held still (another model, an unreadable version, damaged) never reaches the engine (fm-4f5m). */
  const computable = (inputs: readonly Input[], state: State = store.getState()) =>
    inputs.filter((input) => !(state.Held?.has(input.id) && input.mode === 'project'));
  function morphRequest(state: State): Extract<OperationRequest, { kind: 'morph' }> {
    return {
      kind: 'morph',
      sources: computable(state.Inputs, state).map(source),
      settings: {
        kind: state.Kind,
        width: state.Width,
        pinch: state.Pinch,
        frames: state.Frames,
        fps: state.Fps,
        quality: state.Quality ?? 'standard',
      },
      route: { ...identity, requested: state.Provider, fallbackScope: 'cpu-once' },
    };
  }
  /**
   * Morph acceptance (fm-fy2.9): the frame budget, neighbour rule and MP4 probe answer before the Run
   * reaches the reducers, so a refused morph never opens the download question or acquires anything.
   */
  let accepting = false;
  function acceptMorph(message: Extract<Parameters<Store['dispatch']>[0], { type: 'Run' }>): void {
    const state = store.getState();
    if (accepting) return;
    const held = state.Inputs.filter((input) => !computable([input], state).length);
    if (!state.Busy && held.length && state.Inputs.length - held.length < 2) {
      // Morph leaves held faces out; with fewer than two others it says which face and why.
      const why = held.map((input) => state.Held?.get(input.id)?.reason.text ?? '').join(' ');
      update((current) =>
        current.Busy
          ? unchanged(current)
          : { state: { ...current, Status: `Add another face to morph. ${why}` }, effects: [] },
      );
      return;
    }
    if (state.Busy || state.Inputs.length < 2 || state.Inputs.some((i) => faceInputProblem(i)))
      return store.dispatch(message);
    const request = morphRequest(state);
    const frames = morphFrameFailure(request);
    if (frames) return refuseMorph(frames, null);
    accepting = true;
    // Accepting is visible while the checks run and cleared only after their outcome is dispatched, so
    // the state never looks idle between pressing Morph and the job (or its refusal) arriving.
    update((current) => ({ state: { ...current, Accepting: true }, effects: [] }));
    const accepted = () =>
      update((current) => {
        if (!current.Accepting) return unchanged(current);
        const { Accepting: _, ...rest } = current;
        return { state: rest, effects: [] };
      });
    photoTask(
      request.sources.flatMap(({ input }) => (input.file ? [input.file] : [])),
      () => checks(request).finally(() => (accepting = false)),
      (result) => {
        if (result.failure) refuseMorph(result.failure, null);
        // The probe's codec answer goes to the one consent (fm-9kr8): fallback bytes the press must download
        // are asked for in its Generate row before anything is fetched.
        else
          store.dispatch(
            msg(
              'MorphCodecChecked',
              message,
              result.route?.ok === true && result.route.needsConsent,
              store.getState().Downloads.codecBytes ?? 0,
            ),
          );
        accepted();
      },
      (error) => {
        console.error('[morph acceptance]', error);
        store.dispatch(message);
        accepted();
      },
    );
  }
  const guarded: Store = {
    ...store,
    dispatch(message) {
      if (message.type === 'Run' && message.args[0] === 'morph') acceptMorph(message);
      else store.dispatch(message);
    },
  };
  /** Re-runs the neighbour rule on changed inputs: a valid change clears the refusal, another replaces it. */
  function recheckNeighbours(state: State): void {
    const shown = morphRefusal;
    const request = morphRequest(state);
    photoTask(
      request.sources.flatMap(({ input }) => (input.file ? [input.file] : [])),
      () => neighbourFailure(request),
      (failure) => {
        if (morphRefusal !== shown) return;
        morphRefusal = failure?.message ?? null;
        update((current) =>
          current.Status !== shown || current.Busy
            ? unchanged(current)
            : { state: { ...current, Status: failure?.message ?? '' }, effects: [] },
        );
      },
      () => {},
    );
  }
  async function execute(request: Request): Promise<void> {
    const route = { ...identity, requested: request.provider, fallbackScope: 'cpu-once' as const };
    const settings = {
      kind: request.kind,
      width: request.width,
      pinch: request.pinch,
      frames: request.frames,
      fps: request.fps,
      ...(request.quality ? { quality: request.quality } : {}),
    };
    const sources = computable(request.inputs).map(source);
    if (request.action === 'morph') {
      await watch(
        service.requestMorph({ kind: 'morph', sources, settings, route }),
        request.jobId,
        true,
      );
    } else if (request.action === 'faces') {
      await watch(
        service.requestFaces({ kind: 'faces', sources, settings, route }),
        request.jobId,
        true,
      );
    } else {
      const source = sources[0];
      if (!source) throw new Error('Choose a face to generate.');
      await watch(
        service.requestFace({ kind: 'face', source, settings, route }),
        request.jobId,
        true,
      );
    }
  }
  function runEffects(effects: readonly Effect[], state: State): void {
    for (const effect of orderedEffects(effects)) {
      if (disposed) return;
      switch (effect.type) {
        case 'subscribe':
        case 'subscribeDownloads':
          if (!subscriptions.has(effect.type))
            subscriptions.set(
              effect.type,
              effect.type === 'subscribe' ? subscribeProgress(store) : subscribeDownloads(store),
            );
          break;
        case 'restoreLastResult': {
          const revision = arrivalRevision;
          task(
            facade.restoreLastResult(),
            (result) => {
              if (result && revision === arrivalRevision)
                store.dispatch(msg('RestoredLast', result));
            },
            (error) => {
              if (revision === arrivalRevision) store.dispatch(rejection(effect, error));
            },
          );
          break;
        }
        case 'invalidateArrivalRestore':
          arrivalRevision++;
          facade.invalidateArrivalRestore();
          break;
        case 'invalidateFace': {
          faceTrace?.push({ type: 'invalidateFace', id: effect.id, at: performance.now() });
          const revision = (revisions.get(effect.id) ?? 1) + 1;
          revisions.set(effect.id, revision);
          if (inputOf(state, effect.id)) service.revise(effect.id, revision as InputRevision);
          else service.remove(effect.id);
          if (morphRefusal !== null && state.Status === morphRefusal) recheckNeighbours(state);
          break;
        }
        case 'invalidateMorph':
          facade.invalidateMorph();
          break;
        case 'invalidatePhotoSelections':
          photoSelections.delete(effect.id);
          helpers.invalidatePhotoSelections(effect.id);
          break;
        case 'focusCropArea':
          helpers.focusCropArea();
          break;
        case 'revokeUrl':
          helpers.revokeUrl(effect.url);
          break;
        case 'cancelPhotoRun':
          facade.cancelPhotoRun();
          break;
        case 'openNamesFocus':
          helpers.openNamesFocus();
          break;
        case 'closeNamesFocus':
          helpers.closeNamesFocus();
          break;
        case 'pickName': {
          // The text is read here, at dispatch, never carried in the effect.
          const input = inputOf(state, effect.id);
          if (!input || input.mode !== 'text') break;
          task(
            facade.pickName({ id: input.id, value: input.value }),
            (selection) => store.dispatch(msg('NamePicked', input.id, input.value, selection)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        }
        case 'loadNames':
          task(
            facade.loadNames(),
            (names) => store.dispatch(msg('NamesLoaded', names)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'selectPhoto': {
          const selection = ++photoSelectionSequence;
          photoSelections.set(effect.id, selection);
          photoTask(
            effect.files,
            () => facade.selectPhoto({ id: effect.id, files: effect.files }),
            (result) => {
              if (photoSelections.get(effect.id) !== selection) return;
              photoSelections.delete(effect.id);
              store.dispatch(msg('Photo', effect.id, result));
            },
            (error) => {
              if (photoSelections.get(effect.id) !== selection) return;
              photoSelections.delete(effect.id);
              store.dispatch(rejection(effect, error));
            },
          );
          break;
        }
        case 'classifyStills':
          photoTask(
            effect.files,
            () => classify(effect.files),
            (entries) => {
              const current = store.getState().StillChecks?.get(effect.key) === effect.token;
              for (const entry of entries)
                console.info(
                  '[still-entry]',
                  JSON.stringify(
                    stillLog(entry, effect.target ?? effect.key, effect.token, current),
                  ),
                );
              store.dispatch(
                msg('Classified', effect.key, effect.token, effect.pick, effect.target, entries),
              );
            },
            (error) => update((current) => classificationFailure(current, effect, error)),
          );
          break;
        case 'stageBatch':
          // Each file is decoded for display on its own: a slow or broken file never holds up its siblings.
          for (const item of effect.files)
            photoTask(
              [item.file],
              async () =>
                item.photo
                  ? { ok: true, offer: await facade.previewPhoto(item.file, { edge: 2048 }) }
                  : { ok: true, url: URL.createObjectURL(item.file) },
              (result) => store.dispatch(msg('BatchStaged', effect.token, item.id, result)),
              () => store.dispatch(msg('BatchStaged', effect.token, item.id, { ok: false })),
            );
          break;
        case 'detectBatchFaces':
          photoTask(
            [effect.file],
            // The on-device aligner prepares one photo at a time: detections run one after another.
            () => {
              const run = detections.then(() => facade.detectFaces(effect.file));
              detections = run.then(
                () => undefined,
                () => undefined,
              );
              return run;
            },
            (faces) => store.dispatch(msg('BatchDetected', effect.token, effect.group, faces)),
            () => store.dispatch(msg('BatchDetected', effect.token, effect.group, null)),
          );
          break;
        case 'detectCropFaces':
          photoTask(
            [effect.file],
            // One aligner at a time, shared with the batch view's detections.
            () => {
              const run = detections.then(() => facade.detectFaces(effect.file));
              detections = run.then(
                () => undefined,
                () => undefined,
              );
              return run;
            },
            (faces) => store.dispatch(msg('CropDetected', effect.id, effect.url, faces)),
            (error: unknown) => {
              // Shown as "detection did not run"; the reason stays in the console for a report.
              console.warn(
                '[faces-first] detection did not run:',
                String((error as Error)?.message ?? error),
              );
              store.dispatch(msg('CropDetected', effect.id, effect.url, null));
            },
          );
          break;
        case 'previewPhoto': {
          const selection = ++photoSelectionSequence;
          photoSelections.set(effect.id, selection);
          photoTask(
            [effect.file],
            () => facade.previewPhoto(effect.file),
            (offer) => {
              if (photoSelections.get(effect.id) !== selection) {
                helpers.revokeUrl(offer.url);
                return;
              }
              photoSelections.delete(effect.id);
              store.dispatch(msg('Photo', effect.id, { kind: 'crop', offer }));
            },
            (error) => {
              if (photoSelections.get(effect.id) !== selection) return;
              photoSelections.delete(effect.id);
              store.dispatch(rejection(effect, error));
            },
          );
          break;
        }
        case 'cropPhoto':
          photoTask(
            [effect.file],
            // One crop at a time, in the order they were confirmed (a Choose faces OK freezes several at once):
            // their faces then encode in pick order, and only one original is decoded at a time.
            () => {
              const { file, area, options } = effect;
              const run = crops.then(() => facade.cropPhoto(file, area, options));
              crops = run.then(
                () => undefined,
                () => undefined,
              );
              return run;
            },
            (file) => store.dispatch(msg('Cropped', effect.id, effect.revision, file)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'publicPreview': {
          const input = inputOf(state, effect.id);
          if (!input) break;
          const finish = (url: string) =>
            store.dispatch(msg('PreviewLoaded', input.id, input.mode, input.value, url));
          if (input.mode !== 'text' && input.mode !== 'seed') {
            finish('');
            break;
          }
          task(facade.publicPreview(input.mode, input.value), finish, (error) =>
            store.dispatch(rejection(effect, error, input)),
          );
          break;
        }
        case 'sliderFrames':
          task(
            facade.sliderFrames(),
            (frames) => store.dispatch(msg('SliderLoaded', frames)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'setDebug':
          facade.setDebug(effect.enabled, effect.basis);
          break;
        case 'sendReportOnce': {
          const sent = facade.sendReportOnce();
          update((current) => ({ state: reportSent(current, sent), effects: [] }));
          break;
        }
        case 'rememberSlider':
          facade.rememberSlider(effect.enabled, effect.frame);
          break;
        case 'rememberView':
          facade.rememberView(effect.view);
          break;
        case 'dispatch':
          store.dispatch(effect.message, 'continuation' in effect ? effect : undefined);
          break;
        case 'checkCachedFace':
          photoTask(
            effect.input.file ? [effect.input.file] : [],
            () => facade.checkCachedFace(effect.input),
            (hit) => store.dispatch(msg('CachedFaceChecked', effect.input, hit)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'consentToDownload':
          facade.consentToDownload(effect.scope);
          break;
        case 'downloadModels':
          facade.downloadModels(effect.includePhoto);
          break;
        case 'cancelDownloadSetup':
          facade.cancelDownloadSetup();
          break;
        case 'queueFace':
          facade.queueFace(effect.id, effect.depth);
          break;
        case 'cancelQueuedFace':
          facade.cancelQueuedFace(effect.id);
          break;
        case 'cancelSlot':
          // Remove's owned-work abort (fm-id4c): the slot's requests stop; its retained result is kept for Undo.
          faceTrace?.push({ type: 'cancelSlot', id: effect.id, at: performance.now() });
          service.cancel({ slot: effect.id });
          break;
        case 'admissionRefused':
          faceTrace?.push({ type: 'admissionRefused', id: effect.budget, at: performance.now() });
          if (Array.isArray(opctlTrace))
            opctlTrace.push({ type: 'admission-refused', budget: effect.budget });
          break;
        case 'expireUndo': {
          const seq = effect.seq;
          setTimeout(() => {
            if (!disposed) store.dispatch(msg('UndoExpired', seq));
          }, UNDO_MS);
          break;
        }
        case 'cancelWork':
          for (const [handle, jobId] of handles)
            if (jobId === state.JobId) service.cancel({ requestId: handle.requestId });
          break;
        case 'requestNext': {
          update((current) => {
            const planned = scheduling(current);
            return scheduled(current, service.requestNext(planned.jobs, planned.options));
          });
          break;
        }
        case 'saveMedia':
        case 'shareMedia': {
          // Only a shown held still stands in for the face; a damaged one leaves the face (and its Save) as it was.
          const held = state.Held?.get(effect.id);
          if (held?.url) {
            // A held still is handed over as the exact bytes that were opened: no re-encode, envelope kept.
            photoTask(
              [held.file],
              () => handOver(held.file, effect.type === 'shareMedia'),
              (notice) => store.dispatch(msg('Notice', notice)),
              (error) => store.dispatch(rejection(effect, error)),
            );
            break;
          }
          task(
            effect.type === 'saveMedia'
              ? facade.saveMedia(effect.id)
              : facade.shareMedia(effect.id),
            (notice) => store.dispatch(msg('Notice', notice)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        }
        case 'exportProject':
          photoTask(
            effect.view.inputs.flatMap((input) => (input.file ? [input.file] : [])),
            () => facade.exportProject(effect.view),
            (notice) => store.dispatch(msg('Notice', notice)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'execute':
          photoTask(
            effect.request.inputs.flatMap((input) => (input.file ? [input.file] : [])),
            () => execute(effect.request),
            () => {},
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'importProject': {
          const request: Extract<OperationRequest, { kind: 'import' }> = {
            kind: 'import',
            file: effect.file,
            sources: effect.view.inputs.map(source),
            settings: effect.view,
            route: { ...identity, requested: effect.provider, fallbackScope: 'cpu-once' },
          };
          photoTask(
            effect.view.inputs.flatMap((input) => (input.file ? [input.file] : [])),
            () => watch(service.requestImport(request), effect.jobId, true),
            () => {},
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        }
        case 'runBlend':
          runBlend(effect);
          break;
        case 'cancelBlend':
          if (blendHandle) service.cancel({ requestId: blendHandle.requestId });
          blendHandle = null;
          break;
        case 'copyFace':
          facade.copyFace(effect.from, effect.to);
          break;
        default: {
          const absent: never = effect;
          throw new Error(`Unknown controller effect: ${String(absent)}`);
        }
      }
    }
  }
  store.update((state) => ({ state, effects: initial.effects }));
  return {
    store: guarded,
    async dispose() {
      if (disposed) return;
      disposed = true;
      store.dispose();
      for (const off of subscriptions.values()) off();
      subscriptions.clear();
      await service.dispose();
      await Promise.allSettled(pending);
    },
  };
}
