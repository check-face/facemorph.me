import { msg, type Msg } from '../msg.ts';
import type { State, Input, Output, Progress } from '../state.ts';
import { unchanged, viewSnapshot, type Transition, type Effect } from '../effects.ts';
import {
  predictedMorphMs,
  isSlowDevice,
  remainingText,
  describeDuration,
  type Measurements,
  faceInputProblem,
  gateScope,
} from '../derived.ts';
import { enqueue, without, sameInputs, settingsKey, schedule, runFace } from './schedule.ts';

/** The manager's refusal texts for a file outside every approved grant (acquisition/grants.ts GrantRefused). */
const GRANT_REFUSAL = /not covered by an approved download|needs more data than was approved/;

export interface JobFacts {
  readonly measurements?: Measurements;
  readonly progress?: {
    readonly facesTotal: number;
    readonly facesDone: number;
    readonly framesTotal: number;
    readonly framesDone: number;
    readonly videoFramesTotal: number;
    readonly videoFramesDone: number;
  };
  readonly multipleFacesMessage?: string;
}
const emptyMeasurements: Measurements = {
  faceMs: null,
  frameMs: null,
  videoMs: null,
  plannedFrames: null,
};
export function restored(state: State, result: Output, clearPreviews = true): State {
  return {
    ...state,
    Inputs: result.inputs,
    Faces: result.faces,
    VideoUrl: result.videoUrl,
    Previews: clearPreviews ? [] : state.Previews,
    Status: result.message,
    Kind: result.kind || state.Kind,
    Width: result.width,
    Pinch: result.pinch,
    Frames: result.frames,
    Fps: result.fps,
  };
}
export function cancelled(state: State, jobId: number): Transition {
  return jobId !== state.JobId
    ? unchanged(state)
    : schedule({
        ...state,
        Busy: false,
        Stage: 'done',
        Status: 'Cancelled. Your completed faces are still available.',
        Fraction: state.Fraction,
        ActiveFace: null,
        Error: null,
        FailureToast: false,
        Warn: null,
        Remaining: '',
      });
}
export function jobs(message: Msg, state: State, facts: JobFacts = {}): Transition | null {
  switch (message.type) {
    case 'RunFace': {
      const [id] = message.args;
      const input = state.Inputs.find((item) => item.id === id);
      if (!input || faceInputProblem(input) || state.Faces.some((face) => face.id === id))
        return unchanged(state);
      if (state.Busy || state.PreparingFaces.has(id))
        return {
          state: {
            ...state,
            PendingFaces: [...new Set([...state.PendingFaces, id])],
            PendingJobs: enqueue(state.PendingJobs, message),
          },
          effects: [{ type: 'queueFace', id, depth: state.PendingFaces.length + 1 }],
        };
      return start(state, message, 'face', [input], id);
    }
    case 'Run': {
      const [action] = message.args;
      if (state.Inputs.some((input) => faceInputProblem(input))) return unchanged(state);
      // One current morph (fm-8w99): pressing Morph again while that same morph runs (same faces and settings)
      // is the running intent, not a second one queued behind it.
      if (
        action === 'morph' &&
        state.Busy &&
        state.LastRun?.type === 'Run' &&
        state.LastRun.args[0] === 'morph' &&
        state.RunSettings === settingsKey(state) &&
        sameInputs(state.RunInputs, state.Inputs)
      )
        return unchanged(state);
      if (
        action === 'morph' &&
        (state.Busy ||
          state.PreparingFaces.size > 0 ||
          state.PhotoChoice !== null ||
          state.Crop !== null)
      )
        return {
          state: { ...state, PendingMorph: true, PendingJobs: enqueue(state.PendingJobs, message) },
          effects: [],
        };
      if (state.Busy) return unchanged(state);
      if (action !== 'morph' && action !== 'faces')
        throw new RangeError('Unknown controller action');
      const measured = facts.measurements ?? emptyMeasurements;
      const predicted = predictedMorphMs(state, measured);
      const warn =
        action !== 'morph'
          ? null
          : predicted !== null && predicted > 30_000
            ? `This video may take ${describeDuration(predicted)} on this device. It keeps going if you switch tabs, and you can cancel at any time.`
            : isSlowDevice(state, measured.faceMs)
              ? 'Generating is slow on this device, so this video may take a while. You can cancel at any time.'
              : null;
      return start(state, message, action, state.Inputs, '', warn);
    }
    case 'CancelFace': {
      const [id] = message.args;
      const next = {
        ...state,
        PendingJobs: without(state.PendingJobs, runFace(id)),
        PendingFaces: state.PendingFaces.filter((item) => item !== id),
      };
      if (state.ActiveFace === id)
        return {
          state: { ...next, Stage: 'cancelling' },
          effects: [{ type: 'cancelQueuedFace', id }, { type: 'cancelWork' }],
        };
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      return schedule({ ...next, PreparingFaces: preparing }, [
        { type: 'cancelQueuedFace', id },
        { type: 'invalidateFace', id },
        { type: 'invalidatePhotoSelections', id },
      ]);
    }
    case 'Cancel':
      return state.Busy
        ? {
            state: { ...state, Stage: 'cancelling', Status: 'Cancelling…' },
            effects: [{ type: 'cancelWork' }],
          }
        : unchanged(state);
    case 'RestoredLast': {
      const [result] = message.args;
      if (state.JobId !== 0 || state.RunInputs.length > 0 || state.Inputs[0]?.value !== 'hello')
        return unchanged(state);
      return {
        state: restored(state, result),
        effects: state.UseSlider && result.videoUrl ? [{ type: 'sliderFrames' }] : [],
      };
    }
    case 'Progressed':
      return progressed(message.args[0], state, facts);
    case 'Completed': {
      const [id, result] = message.args;
      if (id !== state.JobId) return unchanged(state);
      if (result.photoChoices)
        return schedule(
          {
            ...state,
            Busy: false,
            ActiveFace: null,
            PhotoChoice: result.photoChoices,
            Status: 'Choose the face you mean.',
            Fraction: 0,
          },
          [{ type: 'openNamesFocus' }],
        );
      if (result.cropFace)
        return schedule(
          {
            ...state,
            Busy: false,
            ActiveFace: null,
            Status: 'Crop to a clear face to continue.',
            Fraction: 0,
            PreparingFaces: new Set([...state.PreparingFaces, result.cropFace]),
          },
          [{ type: 'dispatch', message: msg('RequestCrop', result.cropFace) }],
        );
      const output = result.restored ? restored(state, result, false) : state;
      return schedule(
        {
          ...output,
          Busy: false,
          Faces: result.restored
            ? result.faces
            : result.faces.filter((face) => state.Inputs.some((input) => input.id === face.id)),
          VideoUrl:
            sameInputs(state.RunInputs, state.Inputs) && state.RunSettings === settingsKey(state)
              ? result.videoUrl
              : '',
          Status: result.message,
          Error: result.errorMessage || null,
          FailureToast: Boolean(result.errorMessage) && !state.Debug,
          Stage: result.errorMessage ? 'error' : 'done',
          Fraction: result.errorMessage ? state.Fraction : 1,
          Warn: null,
          Remaining: '',
          ActiveFace: null,
        },
        result.videoUrl && state.UseSlider ? [{ type: 'sliderFrames' }] : [],
      );
    }
    case 'Failed': {
      const [id, error] = message.args;
      if (id !== state.JobId) return unchanged(state);
      // A model file the approval does not cover (packages/browser-model-manager GrantRefused: another route's files,
      // a shard past the advertised size, an evicted file) is a new cost, so the question is asked again for this run
      // rather than shown as a failure (fm-qrfz).
      if (GRANT_REFUSAL.test(error) && state.LastRun) {
        const asked = { ...state, DownloadConsent: new Set<string>() };
        const scope =
          gateScope({ ...asked, Downloads: { ...state.Downloads, known: false } }, state.LastRun) ??
          'route';
        return {
          state: {
            ...asked,
            Busy: false,
            Error: null,
            Status: '',
            Stage: 'idle',
            Fraction: 0,
            Warn: null,
            Remaining: '',
            ActiveFace: null,
            Gate: [scope, state.LastRun],
          },
          effects: [],
        };
      }
      if (error === facts.multipleFacesMessage && state.ActiveFace !== null)
        return {
          state: {
            ...state,
            Busy: false,
            Error: null,
            Status: 'Crop to one face to continue.',
            Stage: 'idle',
            Fraction: 0,
            Warn: null,
            Remaining: '',
            ActiveFace: null,
          },
          effects: [{ type: 'dispatch', message: msg('RequestCrop', state.ActiveFace) }],
        };
      return schedule({
        ...state,
        Busy: false,
        Error: error,
        Status: state.LastRun?.type === 'Run' && state.LastRun.args[0] === 'morph' ? error : '',
        Stage: 'error',
        Fraction: state.Fraction,
        Warn: null,
        Remaining: '',
        ActiveFace: null,
        FailureToast: !state.Debug,
      });
    }
    case 'Save':
    case 'Share':
      return {
        state,
        effects: [
          { type: message.type === 'Save' ? 'saveMedia' : 'shareMedia', id: message.args[0] },
        ],
      };
    case 'Export':
      return state.Busy
        ? unchanged(state)
        : { state, effects: [{ type: 'exportProject', view: viewSnapshot(state) }] };
    case 'Import': {
      const [file] = message.args;
      if (state.Busy)
        return {
          state: {
            ...state,
            PendingImport: file,
            PendingJobs: enqueue(state.PendingJobs, message),
          },
          effects: [],
        };
      const id = state.JobId + 1;
      return {
        state: {
          ...state,
          Busy: true,
          JobId: id,
          Stage: 'importing',
          PendingImport: null,
          PendingJobs: without(state.PendingJobs, message),
          Status: 'Opening project…',
          RunInputs: state.Inputs,
          RunSettings: '',
        },
        effects: [
          {
            type: 'importProject',
            file,
            jobId: id,
            provider: state.Provider,
            view: viewSnapshot(state),
          },
        ],
      };
    }
    case 'Notice':
      return { state: { ...state, Status: message.args[0] }, effects: [] };
    case 'Retry':
      return state.Busy
        ? unchanged(state)
        : {
            state: { ...state, Error: null, FailureToast: false },
            effects: state.LastRun ? [{ type: 'dispatch', message: state.LastRun }] : [],
          };
    default:
      return null;
  }
}
function start(
  state: State,
  message: Msg,
  action: 'face' | 'faces' | 'morph',
  inputs: readonly Input[],
  target: string,
  warn: string | null = null,
): Transition {
  const id = state.JobId + 1;
  const effects: Effect[] =
    action === 'face' ? [{ type: 'rememberView', view: viewSnapshot(state) }] : [];
  effects.push({
    type: 'execute',
    request: {
      ...viewSnapshot(state),
      inputs,
      jobId: id,
      action,
      target,
      provider: state.Provider,
    },
  });
  return {
    state: {
      ...state,
      Busy: true,
      JobId: id,
      LastRun: message,
      FailureToast: false,
      Error: null,
      Stage: 'preparing',
      Status: action === 'face' ? 'Generating this face…' : 'Preparing…',
      ...(action === 'face' ? {} : { Disclosure: '' }),
      ActiveFace: action === 'face' ? target : null,
      RunInputs: inputs,
      RunSettings: action === 'face' ? '' : settingsKey(state),
      PendingJobs: without(
        state.PendingJobs,
        action === 'face' ? runFace(target) : msg('Run', 'morph'),
      ),
      PendingFaces:
        action === 'face'
          ? state.PendingFaces.filter((face) => face !== target)
          : state.PendingFaces,
      PendingMorph: action === 'face' ? state.PendingMorph : false,
      // The frame plan is unknown until the actual morph planner reports its total.
      Fraction: action === 'morph' ? -1 : 0,
      VideoUrl: action === 'face' ? '' : state.VideoUrl,
      Warn: warn,
      Remaining: '',
      SliderFrames: null,
      SliderFrame: 1,
    },
    effects,
  };
}
function progressed(progress: Progress, state: State, facts: JobFacts): Transition {
  if (progress.stage === 'frames-available' && progress.jobId === state.JobId)
    return { state, effects: [{ type: 'sliderFrames' }] };
  if (progress.stage.startsWith('diagnostics-')) {
    const status =
      progress.stage === 'diagnostics-sent'
        ? `Report saved. Reference: ${progress.text}`
        : progress.stage === 'diagnostics-failed'
          ? 'Report could not be saved. You can still email us.'
          : progress.stage === 'diagnostics-enabled'
            ? 'Reporting is on. It stays on until you turn it off.'
            : 'Reporting is off.';
    return {
      state: {
        ...state,
        DebugStatus: status,
        Debug:
          progress.stage === 'diagnostics-enabled'
            ? true
            : progress.stage === 'diagnostics-disabled'
              ? false
              : state.Debug,
        ConsentPrompt: progress.stage === 'diagnostics-enabled' ? false : state.ConsentPrompt,
      },
      effects: [],
    };
  }
  if (progress.stage === 'route-admitted')
    return { state: { ...state, Route: progress.text }, effects: [] };
  if (progress.stage === 'route-rejected')
    return { state: { ...state, Rejected: progress.text }, effects: [] };
  if (progress.stage === 'photo-acquisition' || progress.stage === 'photo-tools-ready')
    return { state: { ...state, Preparing: state.Busy ? '' : progress.text }, effects: [] };
  if (!state.Busy || progress.jobId !== state.JobId) return unchanged(state);
  return {
    state: {
      ...state,
      Stage: progress.stage,
      Status: progress.text,
      Fraction: progress.fraction,
      ActiveFace: progress.stage === 'face' && progress.face ? progress.face : state.ActiveFace,
      Remaining: facts.progress
        ? remainingText(state, facts.measurements ?? emptyMeasurements, facts.progress)
        : '',
    },
    effects: [],
  };
}
