// One payload tuple per frozen Product.fs Msg case (a42829bb, lines 263-279).
import type { CropState } from '../../shell/facade/helpers.ts';
import type { StillEntry } from '../media/still-entry.ts';
import type {
  Downloads,
  Face,
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
  CropAdjust: readonly [];
  CropUse: readonly [];
  Edit: readonly [string, string];
  Mode: readonly [string, InputMode];
  Photo: readonly [string, PhotoSelection];
  PickPhoto: readonly [string, readonly File[]];
  PhotoError: readonly [string];
  PhotoRefused: readonly [string, string];
  PhotoFailed: readonly [string, string];
  Photos: readonly [string | null, readonly File[]];
  AddAt: readonly [number];
  Remove: readonly [string];
  /** More options → Start over: two empty faces in one action, with the same Undo as Remove (fm-id4c). */
  StartOver: readonly [];
  /** Restores what the open Remove/Start over notice hid, at the same index with the same content. */
  Undo: readonly [];
  /** The notice `seq` timed out; its removal becomes final. */
  UndoExpired: readonly [number];
  Kind: readonly [MorphKind];
  CancelFace: readonly [string];
  ChooseDetected: readonly [number];
  DismissDetected: readonly [];
  Frames: readonly [number];
  Quality: readonly ['standard' | 'full'];
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
  /** Page-level optional photo setup asks through the same explicit download decision. */
  PrepareEncoder: readonly [];
  CancelEncoderSetup: readonly [];
  DownloadNow: readonly [boolean];
  HideModelToast: readonly [];
  GateAccept: readonly [bundle?: 'route' | 'photo'];
  ResumePhoto: readonly [string];
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
  /** The name list could not be loaded; the open picker shows this inside itself. */
  NamesFailed: readonly [string];
  SearchNames: readonly [string];
  ChooseName: readonly [string];
  /** A picked name's published result for face `id` and the exact text it was picked for (fm-ejwq). */
  NamePicked: readonly [string, string, PhotoSelection];
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
  /** Each file of a pick (`target`) or drop classified, in order, before any face changes (fm-4f5m). */
  Classified: readonly [
    key: string,
    token: number,
    pick: boolean,
    target: string | null,
    entries: readonly ClassifiedStill[],
  ];
  /** The explicit Use as photo action on a held still: enters the confirmed-crop flow. */
  UseAsPhoto: readonly [string];
  // ---- the blend view (fm-2kse) ----
  /** The view opened (seeds the slots on first open) or closed (cancels a pending blend synthesis). */
  BlendView: readonly [boolean];
  /** A new empty slot at weight 1/N; the runner supplies its id. */
  BlendAdd: readonly [];
  BlendRemove: readonly [string];
  /** A released slider or a committed keyboard step: one regeneration. */
  BlendWeight: readonly [string, number];
  /** Every weight at once (Shuffle weights), in slot order. */
  BlendWeights: readonly [readonly number[]];
  /** Every weight 1/N. */
  BlendReset: readonly [];
  /** Make it 1: every weight scaled in proportion. */
  BlendNormalize: readonly [];
  BlendRun: readonly [];
  /** A slot's face finished as a blend dependency. */
  BlendSlotReady: readonly [Face];
  BlendCompleted: readonly [number, Face];
  BlendFailed: readonly [number, string];
  /** Cancelled or superseded: nothing to show. */
  BlendSettled: readonly [number];
}
/** A classified file; held kinds carry their display URL ('' when it does not decode) and photo action. */
export interface ClassifiedStill extends StillEntry<File> {
  readonly url?: string;
  readonly decodes?: boolean;
}
export type Msg = {
  [K in keyof Payloads]: { readonly type: K; readonly args: Payloads[K] };
}[keyof Payloads];
export type CropView = CropState;
export const msg = <K extends keyof Payloads>(
  type: K,
  ...args: Payloads[K]
): { readonly type: K; readonly args: Payloads[K] } => ({ type, args });
