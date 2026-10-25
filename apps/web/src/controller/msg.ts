// One payload tuple per frozen Product.fs Msg case (a42829bb, lines 263-279).
import type { CropState } from '../../shell/facade/helpers.ts';
import type {
  Downloads,
  Input,
  InputMode,
  MorphKind,
  NameFace,
  Output,
  PhotoSelection,
  Progress,
  RequestedProvider,
} from '../../shell/facade/records.ts';
export type ConsentBasis = 'checkbox' | 'invite' | 'toast' | 'labs-default' | 'legacy' | 'once';
export interface Payloads {
  Edit: readonly [string, string];
  Mode: readonly [string, InputMode];
  Photo: readonly [string, PhotoSelection];
  PickPhoto: readonly [string, readonly File[]];
  PhotoError: readonly [string];
  PhotoFailed: readonly [string, string];
  Photos: readonly [string | null, readonly File[]];
  AddAt: readonly [number];
  Remove: readonly [string];
  Kind: readonly [MorphKind];
  CancelFace: readonly [string];
  ChooseDetected: readonly [number];
  DismissDetected: readonly [];
  Frames: readonly [number];
  Provider: readonly [RequestedProvider];
  Run: readonly [string];
  RunFace: readonly [string];
  Cancel: readonly [];
  Progressed: readonly [Progress];
  Completed: readonly [number, Output];
  Failed: readonly [number, string];
  Save: readonly [string];
  Share: readonly [string];
  Export: readonly [];
  Import: readonly [Blob];
  Notice: readonly [string];
  DownloadsChanged: readonly [Downloads];
  DownloadNow: readonly [boolean];
  HideModelToast: readonly [];
  GateAccept: readonly [];
  GateCancel: readonly [];
  Debug: readonly [boolean];
  Consent: readonly [boolean, ConsentBasis];
  SendReportOnce: readonly [];
  ReportFailure: readonly [];
  DismissFailureToast: readonly [];
  Retry: readonly [];
  DismissConsentPrompt: readonly [];
  DismissError: readonly [];
  DismissInvite: readonly [];
  DismissWarn: readonly [];
  OverflowToggle: readonly [boolean];
  UseSliderToggle: readonly [boolean];
  SliderLoaded: readonly [readonly string[] | null];
  SliderFrameSet: readonly [number];
  BrowseNames: readonly [string];
  NamesLoaded: readonly [readonly NameFace[]];
  SearchNames: readonly [string];
  ChooseName: readonly [string];
  CloseNames: readonly [];
  MoreNames: readonly [];
  CachedFaceChecked: readonly [Input, boolean];
  RestoredLast: readonly [Output];
  PreviewLoaded: readonly [string, InputMode, string, string];
  PinchToggle: readonly [boolean];
  CropViewport: readonly [number];
  CropPan: readonly [number, number];
  CropZoom: readonly [number];
  CropRotate: readonly [];
  CropAccept: readonly [];
  CropCancel: readonly [];
  RequestCrop: readonly [string];
  Cropped: readonly [string, number, Blob];
}
export type Msg = {
  [K in keyof Payloads]: { readonly type: K; readonly args: Payloads[K] };
}[keyof Payloads];
export type CropView = CropState;
export const msg = <K extends keyof Payloads>(
  type: K,
  ...args: Payloads[K]
): { readonly type: K; readonly args: Payloads[K] } => ({ type, args });
