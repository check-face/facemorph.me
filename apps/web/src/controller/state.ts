import type { CropView, Msg } from './msg.ts';
import type {
  DetectedFaces,
  Downloads,
  Face,
  Input,
  MorphKind,
  NameFace,
  PublicPreview,
  RequestedProvider,
} from '../../shell/facade/records.ts';
export type {
  Downloads,
  Face,
  Input,
  NameFace,
  Output,
  Progress,
  PublicPreview,
  Request,
} from '../../shell/facade/records.ts';
export interface CropChoice {
  readonly faceId: string;
  readonly url: string;
  readonly file: Blob;
  readonly scale: number;
  readonly view: CropView;
  readonly input?: Input;
  /** Editing is an in-dialog state. Its saved view is restored by editor Cancel. */
  readonly previousView?: CropView;
}
/** The classic model, with its optional values represented by null and F# sets by ReadonlySet. */
export interface State {
  /** Absent/null while closed; opening this source step never grants acquisition. */
  readonly Inputs: readonly Input[];
  readonly Faces: readonly Face[];
  readonly Previews: readonly PublicPreview[];
  readonly VideoUrl: string;
  readonly Kind: MorphKind;
  readonly Width: number;
  readonly Pinch: boolean;
  readonly Frames: number;
  readonly Fps: number;
  readonly Provider: RequestedProvider;
  readonly Busy: boolean;
  readonly JobId: number;
  readonly Stage: string;
  readonly Status: string;
  readonly Fraction: number;
  readonly Preparing: string;
  readonly Browse: string | null;
  readonly Names: readonly NameFace[];
  readonly NameQuery: string;
  readonly NameLimit: number;
  /** Why the name list failed to load, shown inside the open picker. Absent while loading or
   *  loaded; optional because it is not part of the frozen classic control model. */
  readonly NamesError?: string;
  readonly Error: string | null;
  readonly DebugStatus: string;
  readonly Debug: boolean;
  readonly NextId: number;
  readonly Crop: CropChoice | null;
  readonly CropQueue: readonly CropChoice[];
  readonly Route: string;
  readonly Rejected: string | null;
  readonly Invite: boolean;
  readonly UseSlider: boolean;
  readonly SliderFrames: readonly string[] | null;
  readonly SliderFrame: number;
  readonly Warn: string | null;
  readonly Overflow: boolean;
  readonly PhotoQueue: readonly (readonly [string, File])[];
  readonly PendingFaces: readonly string[];
  readonly PendingJobs: readonly Msg[];
  readonly PendingMorph: boolean;
  readonly PendingImport: Blob | null;
  readonly RunInputs: readonly Input[];
  readonly RunSettings: string;
  readonly PreparingFaces: ReadonlySet<string>;
  readonly PhotoChoice: DetectedFaces | null;
  readonly CachedFaces: ReadonlySet<string>;
  readonly ActiveFace: string | null;
  readonly Remaining: string;
  readonly ConsentPrompt: boolean;
  readonly Downloads: Downloads;
  readonly ModelToastHidden: boolean;
  readonly DownloadConsent: ReadonlySet<string>;
  readonly Gate: readonly [string, Msg] | null;
  readonly LastRun: Msg | null;
  readonly FailureToast: boolean;
  /** The current morph's MP4 size disclosure (e.g. 512 × 512), kept beside progress and the result (fm-fy2.9). */
  readonly Disclosure?: string;
}
