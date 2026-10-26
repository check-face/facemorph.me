import * as facade from '../../shell/facade/bridge.ts';
import * as helpers from '../../shell/facade/helpers.ts';
import { createOperationService } from '../operations/bridge-service.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import type { OperationHandle, OperationRequest, SourceSnapshot } from '../operations/service.ts';
import type { Effect, Transition } from './effects.ts';
import { rejection } from './effects.ts';
import type { State, Input, Request } from './state.ts';
import { init, type InitialFacts } from './init.ts';
import { msg } from './msg.ts';
import { reportSent } from './reducers/reporting.ts';
import { cancelled } from './reducers/jobs.ts';
import { scheduled, scheduling } from './reducers/schedule.ts';
import { createStore, type Store } from './store.ts';
import { subscribeProgress, subscribeDownloads } from './subscriptions.ts';

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
  'sliderFrames',
  'checkCachedFace',
  'execute',
  'importProject',
  'saveMedia',
  'shareMedia',
  'exportProject',
  'requestNext',
  'selectPhoto',
  'previewPhoto',
  'cropPhoto',
  'chooseDetectedFace',
]);
export function orderedEffects(effects: readonly Effect[]): readonly Effect[] {
  return [
    ...effects.filter((effect) => !commands.has(effect.type)),
    ...effects.filter((effect) => commands.has(effect.type)),
  ];
}

/** The only I/O boundary for the controller. All compute goes through the operation service. */
export function createController(
  facts: InitialFacts,
  options: ControllerOptions,
): { readonly store: Store; dispose(): Promise<void> } {
  // A test can ask for the operation trace (fm-vbj7) by providing an array before the app starts.
  const opctlTrace = (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] })
    .__FACEMORPH_OPCTL_TRACE__;
  const service = createOperationService(
    Array.isArray(opctlTrace) ? { trace: (event) => void opctlTrace.push(event) } : {},
  );
  const initial = init(facts);
  const revisions = new Map<string, number>();
  const photoSelections = new Map<string, number>();
  let photoSelectionSequence = 0;
  const handles = new Map<OperationHandle, number>();
  const pending = new Set<Promise<unknown>>();
  const subscriptions = new Map<'subscribe' | 'subscribeDownloads', () => void>();
  const identity = Object.freeze({ ...options.identity });
  let arrivalRevision = 0;
  let disposed = false;
  const store = createStore(initial.state, {
    facts: (message, state) => ({
      ...(message.type === 'AddAt'
        ? { newFaceId: `face-${crypto.randomUUID().replaceAll('-', '')}` }
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
          : message.type === 'ChooseDetected' && state.PhotoChoice
            ? { photoRevision: facade.photoRevision(state.PhotoChoice.id) }
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
    if (!disposed) store.update(transition);
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
        store.dispatch(msg('Progressed', { ...event.progress, jobId }));
      if (event.type === 'compute-ready' && final) {
        committed = true;
        store.dispatch(msg('Completed', jobId, event.output));
      }
    });
    try {
      const result = await handle.done;
      if (disposed) return false;
      if (result.status === 'completed') {
        if (final && !committed) store.dispatch(msg('Completed', jobId, result.output));
        return true;
      }
      if (result.status === 'failed') {
        store.dispatch(
          msg(
            'Failed',
            jobId,
            result.cause.kind === 'admission' ? result.cause.refusal.text : result.cause.message,
          ),
        );
      } else if (!committed) update((current) => cancelled(current, jobId));
      return false;
    } finally {
      off();
      handles.delete(handle);
    }
  }
  async function execute(request: Request): Promise<void> {
    const route = { ...identity, requested: request.provider, fallbackScope: 'cpu-once' as const };
    const settings = {
      kind: request.kind,
      width: request.width,
      pinch: request.pinch,
      frames: request.frames,
      fps: request.fps,
    };
    const sources = request.inputs.map(source);
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
          const revision = (revisions.get(effect.id) ?? 1) + 1;
          revisions.set(effect.id, revision);
          if (state.Inputs.some((input) => input.id === effect.id))
            service.revise(effect.id, revision as InputRevision);
          else service.remove(effect.id);
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
          task(
            facade.selectPhoto({ id: effect.id, files: effect.files }),
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
        case 'previewPhoto': {
          const selection = ++photoSelectionSequence;
          photoSelections.set(effect.id, selection);
          task(
            facade.previewPhoto(effect.file),
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
          task(
            facade.cropPhoto(effect.file, effect.area, effect.options),
            (file) => store.dispatch(msg('Cropped', effect.id, effect.revision, file)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'chooseDetectedFace':
          task(
            facade.chooseDetectedFace(effect.choice, effect.index),
            (file) => store.dispatch(msg('Cropped', effect.id, effect.revision, file)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'publicPreview': {
          const input = state.Inputs.find((item) => item.id === effect.id);
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
          store.dispatch(effect.message);
          break;
        case 'checkCachedFace':
          task(
            facade.checkCachedFace(effect.input),
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
        case 'queueFace':
          facade.queueFace(effect.id, effect.depth);
          break;
        case 'cancelQueuedFace':
          facade.cancelQueuedFace(effect.id);
          break;
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
        case 'shareMedia':
          task(
            effect.type === 'saveMedia'
              ? facade.saveMedia(effect.id)
              : facade.shareMedia(effect.id),
            (notice) => store.dispatch(msg('Notice', notice)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'exportProject':
          task(
            facade.exportProject(effect.view),
            (notice) => store.dispatch(msg('Notice', notice)),
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        case 'execute':
          task(
            execute(effect.request),
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
          task(
            watch(service.requestImport(request), effect.jobId, true),
            () => {},
            (error) => store.dispatch(rejection(effect, error)),
          );
          break;
        }
        default: {
          const absent: never = effect;
          throw new Error(`Unknown controller effect: ${String(absent)}`);
        }
      }
    }
  }
  store.update((state) => ({ state, effects: initial.effects }));
  return {
    store,
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
