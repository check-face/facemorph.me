// Engine capability contracts: what a caller hands the engine once a model is loaded.
//
// The engine accepts a caller-supplied, already-loaded capability. It has no model URLs, chunk
// downloader, OPFS cache, model-host dependency or UI/reporting policy: no URL, OPFS handle or
// acquireBytes callback reaches it, and the cache's network-repair-capable handle
// (model-cache.mjs acquire(), bytes(), open()) is never exposed as an offline loaded capability.
//
// Adapter survey (classic a42829b, src/Next/), each export, worker message, callback, promise and
// owned resource with its contract owner. "manager" is browser-model-manager (contracts.m1, fm-hwh);
// "app" stays in apps/web; "retired" goes with provider simplification.
//
// | Adapter | Export / message / resource | Owner |
// | --- | --- | --- |
// | browser/runtime.mjs | createBrowserRuntime(): generate | operations.ts MappingRequest + SynthesisRequest |
// | | synthesize, synthesizeFrames | operations.ts SynthesisRequest; RenderMorphRequest frames |
// | | encodePhoto (25 MB detector bound, align, e4e) | crop-policy.ts (proposal only) + EncodeRequest |
// | | qualify, status, setPreferredRoute, cancel, dispose | ProviderState; OperationSettlement; dispose() |
// | | prefetch / warming, speeds (localStorage), cachedGenerate | manager (acquisition, caches) / app |
// | | onProgress callback; AbortSignal per operation | StageTimingEvent (caller-side hook); CancellationSignal |
// | browser/ort-worker.mjs | messages initialize, qualify(+resume), prefetch | manager loads; worker-messages.ts 'status' |
// | | generate, synthesize, synthesize-frames, encode-aligned | worker-messages.ts map/synthesize/render-morph/encode |
// | | raw-frame-ack; frame, progress, complete, error | worker-messages.ts raw-frame-ack, frame, progress, settled |
// | | ORT sessions, GPU devices, shard residency, encoder stream | LoadedModelCapability / LoadedEncoderCapability (owned) |
// | product-bridge.mjs | execute, cancel, subscribe, job/morph keys, measured*Ms | app facade (migration.facade) over EngineOperations |
// | | saveMedia, shareMedia, export/importProject | app; RawImageEncodeRequest for still files |
// | | downloadModels, consentToDownload, keepModelsOnDevice, warm* | manager + app consent |
// | | photo stage/select/preview/crop | app crop UI -> ConfirmedCrop |
// | | static import of desktop/runtime.mjs | retired (retirement seam, not a native contract) |
// | Assets/model-cache.mjs | createModelCache, acquire/bytes/open (network repair) | manager only; never reaches the engine |
// | Assets/shard-store.mjs | createShardStore, openShardStore, trailer | manager (verified local shards) |
// | photo/crop.mjs | limits, decodeBounded, previewPhoto, cropPhoto | crop-policy.ts limits; app decode |
// | media.mjs | saveFile, shareFile, framePixels, probeVideoEncoder, videoWriter | app (save/share); MEDIA_BRANCHES (operations.ts) |
// | video-worker.mjs | muxMp4, bounded codec queue | RenderMorphResult; MAX_MORPH_FRAMES |
// | last-result.mjs | validate/remember/read last and session, slider prefs | app persistence (ResultReadiness.persisted) |
// | browser/identity.mjs | inputLatent, truncate, requireLatent, rgba, generationIdentity | MappingRequest (z, truncation); ModelIdentity |
// | image-envelope.mjs | embedRecovery, recoverEnvelope | RawImageEncodeRequest.recovery; parseRecoveryMetadata |
// | estimate.mjs | createEstimator, COLD_FACE_MS, describe* | app; its cold constants are single-device priors and its
// |   |   | encodeMs is video export, so no preflight type inherits them |
//
// Promises and callbacks cross no worker boundary: every signal and callback stays caller-side,
// and worker-messages.ts carries only structured-clone-safe data.

import type { EncodeRequest, EncodeResult, MappingRequest, MappingResult, SynthesisRequest, SynthesisResult } from './operations.ts';
import type { StageTimingHook } from './timing.ts';

/** Structural subset of AbortSignal, so contracts need no DOM or Node globals. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface ModelIdentity {
  /** SHA-256 of the source model weights (manifest modelSourceSha256). */
  readonly modelSha256: string;
  /** SHA-256 of the fixed synthesis noise. */
  readonly noiseSha256: string;
  /** SHA-256 of the runtime manifest the model was loaded from. */
  readonly manifestSha256: string;
  readonly bundleVersion?: string;
}

/** Explicit latent dimensions; nothing assumes 18x512 beyond the descriptor. */
export interface LatentSchema {
  /** Mapping input z length (512 for FFHQ). */
  readonly zLength: number;
  /** W+ layers (18 for FFHQ 1024). */
  readonly layers: number;
  /** W per layer (512). */
  readonly width: number;
}

export interface ImageSchema {
  readonly width: number;
  readonly height: number;
}

export type ComputeRoute = 'cpu' | 'webgpu';
export type RequestedRoute = 'auto' | ComputeRoute;
export type RouteAdmission = 'admitted' | 'refused' | 'pending';
export type RouteValidation = 'unvalidated' | 'validating' | 'validated' | 'failed';

/** The route a caller asked for and the one actually in use, with its admission and validation. */
export interface ProviderState {
  readonly requested: RequestedRoute;
  readonly actual: ComputeRoute;
  readonly admission: RouteAdmission;
  readonly validation: RouteValidation;
}

/** A capability the loaded model does not offer, with its plain reason. */
export interface UnsupportedCapability {
  readonly capability: 'encode' | 'webgpu' | 'raw-float-readback' | 'render-morph';
  readonly reason: string;
}

/**
 * Sequential residency (ort-worker.mjs): the encoder is released before synthesis loads, and
 * synthesis before the encoder is acquired; peaks never overlap.
 */
export interface ResidencyTransition {
  readonly from: 'encoder' | 'synthesis' | 'none';
  readonly to: 'encoder' | 'synthesis' | 'none';
  readonly releasedBeforeAcquire: true;
}

/** Named memory bounds; numeric values arrive with contracts milestone 2's ceilings file. */
export type MemoryBoundName =
  | 'maxLiveEncoderSessions'
  | 'maxWasmHeapBytes'
  | 'maxRetainedFrames'
  | 'maxRetainedFrameBytes'
  | 'maxCodecQueueFrames'
  | 'maxGpuBufferBytes';

/**
 * A loaded photo encoder. `encode` owns bounded sequential session creation, execution and release
 * (today 108 sequential ORT sessions over FP32 shards) and may read verified local shards lazily;
 * it never acquires from the network. Loaded means ready for offline execution, not all sessions
 * resident. Consent-authorised acquisition and verification finish before its admission.
 */
export interface LoadedEncoderCapability {
  encode(request: EncodeRequest, signal?: CancellationSignal, onTiming?: StageTimingHook): Promise<EncodeResult>;
  abort(): void;
  dispose(): Promise<void>;
}

/** A loaded model: mapping and synthesis, and optionally the encoder, ready offline. */
export interface LoadedModelCapability {
  readonly identity: ModelIdentity;
  readonly latent: LatentSchema;
  readonly image: ImageSchema;
  readonly provider: ProviderState;
  readonly unsupported: readonly UnsupportedCapability[];
  readonly encoder?: LoadedEncoderCapability;
  map(request: MappingRequest, signal?: CancellationSignal, onTiming?: StageTimingHook): Promise<MappingResult>;
  synthesize(request: SynthesisRequest, signal?: CancellationSignal, onTiming?: StageTimingHook): Promise<SynthesisResult>;
  /** Releases every owned session, buffer and device; pending operations settle first. */
  dispose(): Promise<void>;
}
