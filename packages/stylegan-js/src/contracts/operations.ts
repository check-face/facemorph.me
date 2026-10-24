// Engine operations: requests, results, readiness and settlement.
//
// Every result records the provider (route) that actually produced it. Cancellation and disposal
// settle every pending operation; a late result never replaces a newer input (acceptsResult).
//
// Media branch table. The media path today (classic a42829b media.mjs, video-worker.mjs): WebCodecs
// at 1024 falling back to 512, FFmpeg at 512 as the last fallback, eight-frame raw segments, bounded
// codec queues. Each branch states how frames drain, who owns the buffers, and how sparse preview
// anchors are ordered so they never deadlock the ordered video drain.
//
// | Branch | Drain | Buffer owner | Anchor ordering |
// | --- | --- | --- | --- |
// | cached-result | none: a stored file or frames are reused whole | the frame/result store | not applicable |
// | raw-sparse-anchors | callback per anchor frame (display only) | caller, after transfer | anchors are display-only; the video drain never waits for one, and an anchor is acked independently |
// | blob-stream | ordered async stream of encoded frames | consumer, after each yield | anchors may arrive early but are consumed in frame order |
// | sequential | one frame synthesized, then encoded, then the next | engine until encoded | strictly in order; no anchors |
// | retained-then-encode | all frames retained within maxRetainedFrames, then encoded | engine until encode ends | anchors drawn from retained frames; encode starts after the last |
// | endpoint-reuse | endpoints copied from earlier results, inner frames synthesized | caller for endpoints, engine for the rest | endpoints count as anchors already delivered |

import type { CancellationSignal, ComputeRoute, LatentSchema } from './capability.ts';
import type { EncoderInput } from './crop-policy.ts';
import type { RecoveryProvenance, GenerationKind, RecoveryReadResult } from './recovery-metadata.ts';
import type { E4eTimings } from './timing.ts';

/** Ids carried by every request and result. */
export interface OperationIds {
  /** Unique per request. */
  readonly requestId: string;
  /** Monotonic revision of the input the request was made from (a face, a crop, morph settings). */
  readonly inputRevision: number;
  /** Retry counter within one request. */
  readonly attemptId: number;
}

export type OperationKind = 'map' | 'synthesize' | 'encode' | 'extract-metadata' | 'encode-raw-image' | 'render-morph';

/** A W+ latent with its explicit shape (layers x width from the model's LatentSchema). */
export interface LatentTensor {
  readonly space: 'w-plus';
  readonly shape: readonly [layers: number, width: number];
  readonly values: Float32Array;
}

export interface MappingRequest {
  readonly ids: OperationIds;
  /** z, length LatentSchema.zLength (browser/identity.mjs inputLatent). */
  readonly z: Float32Array;
  readonly truncation: { readonly psi: number; readonly cutoff: number };
}

export interface MappingResult {
  readonly ids: OperationIds;
  readonly wPlus: LatentTensor;
  readonly provider: ComputeRoute;
}

export interface SynthesisRequest {
  readonly ids: OperationIds;
  readonly wPlus: LatentTensor;
  /** 'rgba-and-raw-float' adds the pre-quantisation float output for numerical checks. */
  readonly output: 'rgba' | 'rgba-and-raw-float';
}

export interface SynthesisResult {
  readonly ids: OperationIds;
  readonly width: number;
  readonly height: number;
  /** 8-bit RGBA, width * height * 4. */
  readonly rgba: Uint8ClampedArray;
  readonly rawFloat?: Float32Array;
  readonly provider: ComputeRoute;
  readonly readiness: ComputeReady;
}

export interface EncodeRequest {
  readonly ids: OperationIds;
  /** From deriveEncoderInput, the only route to the encoder. */
  readonly input: EncoderInput;
  readonly confirmedCropId: string;
}

export interface EncodeResult {
  readonly ids: OperationIds;
  readonly confirmedCropId: string;
  readonly wPlus: LatentTensor;
  readonly provider: ComputeRoute;
  readonly timings: E4eTimings;
}

export interface ExtractMetadataRequest {
  readonly ids: OperationIds;
  readonly bytes: Uint8Array;
}

export interface ExtractMetadataResult {
  readonly ids: OperationIds;
  readonly metadata: RecoveryReadResult;
}

/** What a still export embeds; the envelope (integrity hashes included) is regenerated each time. */
export interface RecoveryMetadata {
  readonly generationKind: GenerationKind;
  readonly generationSha256: string;
  readonly provenance: RecoveryProvenance;
  readonly latent: LatentTensor;
  readonly seed?: number;
}

export interface RawImageEncodeRequest {
  readonly ids: OperationIds;
  readonly format: 'png' | 'webp-lossless';
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
  readonly recovery: RecoveryMetadata;
}

export interface RawImageEncodeResult {
  readonly ids: OperationIds;
  readonly mime: 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
  readonly readiness: FileComplete;
}

/** Every current morph selector mode (geometry/latent-path.mjs kinds). */
export type MorphPathMode = 'linear' | 'pairwise-ellipse' | 'pairwise-figure8' | 'full-smooth-ellipse' | 'full-smooth-figure8';
export const MORPH_PATH_MODES = [
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
] as const satisfies readonly MorphPathMode[];

/** The candidate's morph settings (last-result.mjs validation). */
export interface MorphSettings {
  readonly kind: MorphPathMode;
  /** Path width, 0 to 1.2. */
  readonly width: number;
  readonly pinch: boolean;
  /** Frames per segment. */
  readonly frames: 8 | 16 | 32;
  /** 1 to 120. */
  readonly fps: number;
}

/**
 * Starting frame budget: the classic 4,096-frame path limit (product-bridge.mjs, video-worker.mjs).
 * Contracts milestone 2's ceilings file replaces it with a per-route budget from measured memory,
 * storage and time. It bounds frames, never the number of faces.
 */
export const MAX_MORPH_FRAMES = 4096;
/** Frames per raw transfer segment (ort-worker.mjs synthesize-frames). */
export const RAW_SEGMENT_FRAMES = 8;
export type VideoResolution = 1024 | 512;
export type VideoEncoderPath = 'webcodecs' | 'ffmpeg';

export type MediaBranch = 'cached-result' | 'raw-sparse-anchors' | 'blob-stream' | 'sequential' | 'retained-then-encode' | 'endpoint-reuse';

export interface MediaBranchRow {
  readonly branch: MediaBranch;
  readonly drain: 'none' | 'anchor-callback' | 'ordered-stream' | 'per-frame' | 'after-retention' | 'inner-frames';
  readonly bufferOwner: 'store' | 'caller' | 'consumer' | 'engine' | 'caller-endpoints-engine-inner';
  readonly anchorOrdering: string;
}

/** The media branch table above, as data. */
export const MEDIA_BRANCHES: readonly MediaBranchRow[] = Object.freeze(
  (
    [
      { branch: 'cached-result', drain: 'none', bufferOwner: 'store', anchorOrdering: 'not applicable' },
      { branch: 'raw-sparse-anchors', drain: 'anchor-callback', bufferOwner: 'caller', anchorOrdering: 'display-only; the ordered video drain never waits for an anchor' },
      { branch: 'blob-stream', drain: 'ordered-stream', bufferOwner: 'consumer', anchorOrdering: 'consumed in frame order even when anchors arrive early' },
      { branch: 'sequential', drain: 'per-frame', bufferOwner: 'engine', anchorOrdering: 'strictly in order; no anchors' },
      { branch: 'retained-then-encode', drain: 'after-retention', bufferOwner: 'engine', anchorOrdering: 'anchors come from retained frames; encoding starts after the last' },
      { branch: 'endpoint-reuse', drain: 'inner-frames', bufferOwner: 'caller-endpoints-engine-inner', anchorOrdering: 'endpoints count as delivered anchors' },
    ] satisfies MediaBranchRow[]
  ).map((row) => Object.freeze(row)),
);

export interface RenderMorphRequest {
  readonly ids: OperationIds;
  /** Two or more endpoint latents, in order; the face count is not fixed. */
  readonly endpoints: readonly LatentTensor[];
  readonly settings: MorphSettings;
  /** Total frames, at most MAX_MORPH_FRAMES. */
  readonly frameCount: number;
  readonly fps: number;
  readonly resolution: VideoResolution;
  /** Frame display callbacks stay caller-side; the request only says which branch to use. */
  readonly branch: MediaBranch;
}

export interface RenderMorphResult {
  readonly ids: OperationIds;
  readonly mime: 'video/mp4';
  readonly bytes: Uint8Array;
  readonly width: VideoResolution;
  readonly height: VideoResolution;
  readonly frameCount: number;
  readonly fps: number;
  readonly encoder: VideoEncoderPath;
  readonly branch: MediaBranch;
  readonly provider: ComputeRoute;
  readonly readiness: FileComplete;
}

/** Each readiness fact is independent; `not-applicable` where it cannot hold (a still has no playback). */
export type ReadinessFlag = boolean | 'not-applicable';
export interface ResultReadiness {
  readonly pixelsAvailable: ReadinessFlag;
  readonly fileReady: ReadinessFlag;
  readonly persisted: ReadinessFlag;
  readonly displayDecoded: ReadinessFlag;
  readonly videoPlayable: ReadinessFlag;
}
export type ComputeReady = ResultReadiness & { readonly pixelsAvailable: true };
/** A complete file. It implies nothing about persistence, display decode or playback. */
export type FileComplete = ResultReadiness & { readonly fileReady: true };
export type Persisted = ResultReadiness & { readonly persisted: true };
export type DisplayDecoded = ResultReadiness & { readonly displayDecoded: true };
export type VideoPlayable = ResultReadiness & { readonly videoPlayable: true };

export type ResultMilestone =
  | { readonly milestone: 'compute-ready'; readonly readiness: ComputeReady }
  | { readonly milestone: 'file-complete'; readonly readiness: FileComplete };

export type EngineErrorCode =
  | 'invalid-request'
  | 'unsupported'
  | 'route-failed'
  | 'out-of-memory'
  | 'frame-budget-exceeded'
  | 'encoder-failed'
  | 'disposed'
  | 'internal';

/** Structured-clone-safe error (no Error instance crosses a worker). */
export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  /** A device correctness failure invalidates the route (ort-worker.mjs correctnessFailure). */
  readonly correctnessFailure?: boolean;
}

export type OperationSettlement<R> =
  | { readonly status: 'completed'; readonly ids: OperationIds; readonly result: R }
  | { readonly status: 'cancelled'; readonly ids: OperationIds }
  | { readonly status: 'superseded'; readonly ids: OperationIds; readonly by: OperationIds }
  | { readonly status: 'failed'; readonly ids: OperationIds; readonly error: EngineError };

/** The engine's operations over a caller-loaded capability. */
export interface EngineOperations {
  readonly latent: LatentSchema;
  map(request: MappingRequest, signal?: CancellationSignal): Promise<OperationSettlement<MappingResult>>;
  synthesize(request: SynthesisRequest, signal?: CancellationSignal): Promise<OperationSettlement<SynthesisResult>>;
  encode(request: EncodeRequest, signal?: CancellationSignal): Promise<OperationSettlement<EncodeResult>>;
  extractMetadata(request: ExtractMetadataRequest): Promise<OperationSettlement<ExtractMetadataResult>>;
  encodeRawImage(request: RawImageEncodeRequest, signal?: CancellationSignal): Promise<OperationSettlement<RawImageEncodeResult>>;
  renderMorph(
    request: RenderMorphRequest,
    signal?: CancellationSignal,
    onFrame?: (index: number, rgba: Uint8ClampedArray) => void,
  ): Promise<OperationSettlement<RenderMorphResult>>;
  /** Settles every pending operation as cancelled. */
  cancel(): void;
  /** Settles pending operations, then releases the capability. */
  dispose(): Promise<void>;
}

/**
 * Whether a result may replace what is shown: only a result for the newest input revision of its
 * slot. A late result for an older revision is superseded, never displayed.
 */
export function acceptsResult(latestInputRevision: number, ids: OperationIds): boolean {
  return ids.inputRevision >= latestInputRevision;
}
