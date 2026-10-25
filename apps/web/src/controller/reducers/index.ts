import { inputs, type InputFacts } from './inputs.ts';
import { names } from './names.ts';
import { reporting } from './reporting.ts';
import { slider } from './slider.ts';
import { jobs, type JobFacts } from './jobs.ts';
import { gate } from './gate.ts';
import { photo, type PhotoFacts } from './photo.ts';
import { crop } from './crop.ts';
import { sameInputs } from './schedule.ts';
import type { Msg } from '../msg.ts';
import type { State } from '../state.ts';
import { viewSnapshot, type Transition } from '../effects.ts';
export type ControllerFacts = InputFacts & JobFacts & PhotoFacts;
type ControllerReducer = (message: Msg, state: State, facts: ControllerFacts) => Transition | null;
// Every frozen message has one explicit pure reducer. Adding a Msg requires a case here.
export const CASES = {
  Edit: inputs,
  Mode: inputs,
  AddAt: inputs,
  Remove: inputs,
  Kind: inputs,
  Frames: inputs,
  Provider: inputs,
  OverflowToggle: inputs,
  CachedFaceChecked: inputs,
  PinchToggle: inputs,
  BrowseNames: names,
  NamesLoaded: names,
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
  DownloadNow: gate,
  HideModelToast: gate,
  GateAccept: gate,
  GateCancel: gate,
  Retry: jobs,
  RestoredLast: jobs,
} satisfies Record<Msg['type'], ControllerReducer>;
/** Compose guard priority and the classic remember-view wrapper around each pure transition. */
export function reduce(message: Msg, state: State, facts: ControllerFacts = {}): Transition | null {
  const gated = gate(message, state);
  if (gated !== null) return gated;
  const handler: ControllerReducer = CASES[message.type];
  const result = handler(message, state, facts);
  if (result === null) throw new Error(`Controller case ${message.type} has no reducer`);
  return rememberView(state, result);
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
