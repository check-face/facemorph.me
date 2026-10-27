import { inputs, type InputFacts } from './inputs.ts';
import { names } from './names.ts';
import { reporting } from './reporting.ts';
import { slider } from './slider.ts';
import { jobs, type JobFacts } from './jobs.ts';
import { gate } from './gate.ts';
import { photo, type PhotoFacts } from './photo.ts';
import { crop } from './crop.ts';
import { sameInputs } from './schedule.ts';
import { commitUndo, NEXT_ACTIONS, undo, type UndoFacts } from './undo.ts';
import type { Msg } from '../msg.ts';
import type { State } from '../state.ts';
import { viewSnapshot, type Transition } from '../effects.ts';
import { retirePhotoRunInputs } from '../admission.ts';
export type ControllerFacts = InputFacts &
  JobFacts &
  PhotoFacts &
  UndoFacts & {
    /** An already requested queued job resuming automatically, not a new user action. */
    readonly continuation?: boolean;
  };
type ControllerReducer = (message: Msg, state: State, facts: ControllerFacts) => Transition | null;
// Every frozen message has one explicit pure reducer. Adding a Msg requires a case here.
export const CASES = {
  CropAdjust: crop,
  CropUse: crop,
  Edit: inputs,
  Mode: inputs,
  AddAt: inputs,
  Remove: undo,
  StartOver: undo,
  Undo: undo,
  UndoExpired: undo,
  Kind: inputs,
  Frames: inputs,
  Quality: inputs,
  Provider: inputs,
  OverflowToggle: inputs,
  CachedFaceChecked: inputs,
  PinchToggle: inputs,
  BrowseNames: names,
  NamesLoaded: names,
  NamesFailed: names,
  PreviewLoaded: names,
  SearchNames: names,
  ChooseName: names,
  CloseNames: names,
  MoreNames: names,
  Debug: reporting,
  Consent: reporting,
  DismissConsentPrompt: reporting,
  SendReportOnce: reporting,
  DismissInvite: reporting,
  DismissWarn: reporting,
  DismissError: reporting,
  ReportFailure: reporting,
  DismissFailureToast: reporting,
  UseSliderToggle: slider,
  SliderLoaded: slider,
  SliderFrameSet: slider,
  Photo: photo,
  PickPhoto: photo,
  PhotoError: photo,
  PhotoRefused: photo,
  PhotoFailed: photo,
  Photos: photo,
  ChooseDetected: photo,
  DismissDetected: photo,
  CropViewport: crop,
  CropPan: crop,
  CropZoom: crop,
  CropRotate: crop,
  CropAccept: crop,
  CropCancel: crop,
  RequestCrop: crop,
  Cropped: photo,
  Classified: photo,
  UseAsPhoto: photo,
  CancelFace: jobs,
  Run: jobs,
  RunFace: jobs,
  Cancel: jobs,
  Progressed: jobs,
  Completed: jobs,
  Failed: jobs,
  Save: jobs,
  Share: jobs,
  Export: jobs,
  Import: jobs,
  Notice: jobs,
  DownloadsChanged: gate,
  PrepareEncoder: gate,
  CancelEncoderSetup: gate,
  DownloadNow: gate,
  HideModelToast: gate,
  GateAccept: gate,
  GateCancel: gate,
  Retry: jobs,
  RestoredLast: jobs,
} satisfies Record<Msg['type'], ControllerReducer>;
/** Compose guard priority and the classic remember-view wrapper around each pure transition. */
export function reduce(message: Msg, state: State, facts: ControllerFacts = {}): Transition | null {
  // A person's next action ends an open Undo notice first (fm-id4c): the hidden faces are released, then it applies.
  if (state.Undo && !facts.continuation && NEXT_ACTIONS.has(message.type)) {
    const committed = commitUndo(state);
    const result = reduce(message, committed.state, facts);
    return result && { ...result, effects: [...committed.effects, ...result.effects] };
  }
  // A valid new selection can replace this idle face's cached run snapshot. Active requests keep their
  // snapshot and the runner independently reserves their files until genuine settlement.
  const runInputs = state.RunInputs;
  const runSettings = state.RunSettings;
  const replacing =
    (message.type === 'PickPhoto' || message.type === 'Photos') && message.args[1].length
      ? message.args[0]
      : null;
  if (replacing !== null && state.Inputs.some((input) => input.id === replacing))
    state = retirePhotoRunInputs(state, replacing);
  const gated = gate(message, state);
  if (gated !== null) return { ...gated, state: retirePhotoRunInputs(gated.state) };
  const handler: ControllerReducer = CASES[message.type];
  const result = handler(message, state, facts);
  if (result === null) throw new Error(`Controller case ${message.type} has no reducer`);
  // A refused selection did not replace anything: preserve its valid retry/cache identity. Normal
  // retirement below still releases a snapshot that was already obsolete before the refused action.
  const selected = result.effects.some((effect) => effect.type === 'admissionRefused')
    ? { ...result.state, RunInputs: runInputs, RunSettings: runSettings }
    : result.state;
  return rememberView(state, { ...result, state: retirePhotoRunInputs(selected) });
}
export function rememberView(previous: State, next: Transition): Transition {
  const state = next.state;
  return !sameInputs(previous.Inputs, state.Inputs) ||
    previous.Kind !== state.Kind ||
    previous.Frames !== state.Frames ||
    previous.Pinch !== state.Pinch
    ? { ...next, effects: [...next.effects, { type: 'rememberView', view: viewSnapshot(state) }] }
    : next;
}
