import { inputs, type InputFacts } from './inputs.ts';
import { names } from './names.ts';
import { reporting } from './reporting.ts';
import { slider } from './slider.ts';
import type { Msg } from '../msg.ts';
import type { State } from '../state.ts';
import type { Transition } from '../effects.ts';
// Explicit ownership: jobs and photo/crop transitions land in fm-v80g/fm-j16n. Adding a Msg needs a case here.
export const CASES = {
  Edit: inputs,
  Mode: inputs,
  AddAt: inputs,
  Remove: inputs,
  Kind: inputs,
  Frames: inputs,
  Provider: inputs,
  OverflowToggle: inputs,
  Compare: inputs,
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
  Photo: 'photo',
  PickPhoto: 'photo',
  PhotoError: 'photo',
  PhotoFailed: 'photo',
  Photos: 'photo',
  ChooseDetected: 'photo',
  DismissDetected: 'photo',
  CropViewport: 'photo',
  CropPan: 'photo',
  CropZoom: 'photo',
  CropRotate: 'photo',
  CropAccept: 'photo',
  CropCancel: 'photo',
  RequestCrop: 'photo',
  Cropped: 'photo',
  CancelFace: 'jobs',
  Run: 'jobs',
  RunFace: 'jobs',
  Cancel: 'jobs',
  Progressed: 'jobs',
  Completed: 'jobs',
  Failed: 'jobs',
  Save: 'jobs',
  Share: 'jobs',
  Export: 'jobs',
  Import: 'jobs',
  Notice: 'jobs',
  DownloadsChanged: 'jobs',
  DownloadNow: 'jobs',
  HideModelToast: 'jobs',
  GateAccept: 'jobs',
  GateCancel: 'jobs',
  Retry: 'jobs',
  RestoredLast: 'jobs',
} satisfies Record<
  Msg['type'],
  ((message: Msg, state: State) => Transition | null) | 'jobs' | 'photo'
>;
/** null means this message belongs to a subsequent controller slice; callers must handle it, never discard it. */
export function reduce(message: Msg, state: State, facts: InputFacts = {}): Transition | null {
  const handler = CASES[message.type];
  if (typeof handler === 'string') return null;
  const result = handler(message, state, facts);
  if (result === null) throw new Error(`Controller case ${message.type} has no reducer`);
  return result;
}
