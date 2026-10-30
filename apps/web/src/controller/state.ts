import type { CropView, Msg } from './msg.ts';
import type { HeldKind, StillReason } from '../media/still-entry.ts';
import type { UndoNotice } from './reducers/undo.ts';
import type { BlendState } from './blend.ts';
import type { BatchState } from './reducers/batch.ts';
import type {
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
  /** The decoded preview the detector looks at (fm-k09b). */
  readonly preview?: Blob;
  /**
   * Faces first (fm-k09b): waiting for photo processing (its download decision, or its download), running, found one
   * face (the view is its aligned square), found none (the failed-to-align screen), did not run (declined or not
   * available here: a neutral note), or adjusted by the person (their crop, no note).
   */
  readonly detect?: CropDetect;
  /** The photo-processing download was asked for this crop (asked once per photo). */
  readonly asked?: boolean;
}
export type CropDetect = 'waiting' | 'running' | 'one' | 'none' | 'not-run' | 'adjusted';
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
  /** Morph video size (fm-36ag): Standard 512 × 512 by default, or Full quality up to the model size. */
  readonly Quality?: 'standard' | 'full';
  /** Morph acceptance pre-checks are running (fm-fy2.9); the Run reaches the reducers when they answer. */
  readonly Accepting?: true;
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
  readonly CachedFaces: ReadonlySet<string>;
  readonly ActiveFace: string | null;
  readonly Remaining: string;
  readonly ConsentPrompt: boolean;
  readonly Downloads: Downloads;
  /** Independent page preparation; cancelled suppresses late setup-only revision notices. */
  readonly EncoderSetup?: 'requested' | 'active' | 'cancelled';
  /** Confirmed photo sources paused by a Generate-only decision; tab memory only. */
  readonly PausedPhotos?: ReadonlyMap<string, Input>;
  /**
   * The MP4 probe answer for one Morph press (fm-9kr8): `run` is that press's own message, so a later press probes
   * again. When the video codec fallback must be downloaded, its bytes join the Generate row of the consent.
   */
  readonly MorphCodec?: { readonly run: Msg; readonly needed: boolean; readonly bytes: number };
  /** The bytes the last approval downloads, as its consent showed them (fm-9kr8): a failure counts against it. */
  readonly ApprovedBytes?: number;
  /** A failed download whose kept files the bridge has not re-measured yet: its byte line waits for that. */
  readonly KeptPending?: boolean;
  readonly ModelToastHidden: boolean;
  readonly DownloadConsent: ReadonlySet<string>;
  readonly Gate: readonly [string, Msg] | null;
  readonly LastRun: Msg | null;
  readonly FailureToast: boolean;
  /** The current morph's MP4 size disclosure (e.g. 512 × 512), kept beside progress and the result (fm-fy2.9). */
  readonly Disclosure?: string;
  /** Pending still classifications (fm-4f5m): the face (or '*' for a drop on the page) and its latest token. */
  readonly StillChecks?: ReadonlyMap<string, number>;
  readonly StillSeq?: number;
  /** Files a face holds as media, never computed with: damaged, unreadable-version or other-model stills. */
  readonly Held?: ReadonlyMap<string, HeldStill>;
  /** The open Remove/Start over notice and what it hid (fm-id4c); absent when there is nothing to undo. */
  readonly Undo?: UndoNotice;
  /** The last notice number handed out, so a stale timeout never ends a newer notice. */
  readonly UndoSeq?: number;
  /** The blend view's slots, weights and result (fm-2kse); absent until the view first opens. */
  readonly Blend?: BlendState;
  /** Faces whose confirmed crop is being made (OK pressed, Cropped not yet back). */
  readonly CropsPending?: ReadonlySet<string>;
  /** Of those, the ones cancelled meanwhile: the crop still lands (for Retry), but does not encode. */
  readonly CropsHeld?: ReadonlySet<string>;
  /** The open batch view of a multi-file pick, drop or paste (fm-id4c, fm-q5b9); absent when closed. */
  readonly Batch?: BatchState | undefined;
}
/** A still the face shows and saves as its original bytes; `url` is '' when it is not shown (damaged). */
export interface HeldStill {
  readonly kind: HeldKind;
  readonly reason: StillReason;
  readonly file: File;
  readonly url: string;
  /** Use as photo is offered (only as an explicit action) when the pixels decode. */
  readonly photoAction: boolean;
}
