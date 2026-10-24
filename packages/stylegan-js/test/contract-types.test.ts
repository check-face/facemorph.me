// Type-level contract tests. tsc (npm run typecheck) is the real check here: each `@ts-expect-error`
// marks a deliberately invalid state that must fail compilation, and an unused one fails the build.
// node --test runs the few runtime assertions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/index.ts';
import type {
  CancellationSignal,
  ComputeReady,
  DisplayDecoded,
  EngineWorkerRequest,
  EngineWorkerResponse,
  FileComplete,
  IsCloneSafe,
  LoadedEncoderCapability,
  LoadedModelCapability,
  OperationSettlement,
  Persisted,
  RecoveryReadResult,
  ResultMilestone,
  SynthesisResult,
} from '../src/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const is = <T extends true>(): T => true as T;

/** Every citable engine value export. A missing or renamed one fails here (and in tsc). */
const VALUES = [
  'CROP_MAX_BYTES',
  'CROP_MAX_PIXELS',
  'CROP_MAX_EDGE',
  'CROP_OUTPUT',
  'PREVIEW_MAX_EDGE',
  'SINGLE_INPUT_LIMITS',
  'CROP_PREPROCESSING_POLICY_V1',
  'CONFIRMED_CROP_FIELDS',
  'CROP_POLICY_PROPERTIES',
  'createConfirmedCrop',
  'validateConfirmedCrop',
  'confirmedCropIdentity',
  'deriveEncoderInput',
  'CropDerivationError',
  'CropValidationError',
  'PRODUCT_CANARY_TOLERANCE',
  'E4E_LATENT_TOLERANCE',
  'EXPORT_QUALITY_RULES',
  'checkSynthesis',
  'checkE4eLatent',
  'parseRecoveryMetadata',
  'MAX_MORPH_FRAMES',
  'MORPH_PATH_MODES',
  'MEDIA_BRANCHES',
  'RAW_SEGMENT_FRAMES',
  'acceptsResult',
  'validateWorkerRequest',
  'validateWorkerResponse',
  'assertCloneSafe',
  'WorkerMessageError',
] as const satisfies readonly (keyof typeof api)[];

/** Every citable engine type export; tsc fails on a missing or renamed one. */
export type CitableTypes = [
  api.ModelIdentity,
  api.LatentSchema,
  api.ImageSchema,
  api.LoadedModelCapability,
  api.LoadedEncoderCapability,
  api.ProviderState,
  api.UnsupportedCapability,
  api.ResidencyTransition,
  api.MemoryBoundName,
  api.CancellationSignal,
  api.StageTimingEvent,
  api.StageCompletionBoundary,
  api.E4eTimings,
  api.StageTimingHook,
  api.OperationIds,
  api.MappingRequest,
  api.MappingResult,
  api.SynthesisRequest,
  api.SynthesisResult,
  api.EncodeRequest,
  api.EncodeResult,
  api.ExtractMetadataRequest,
  api.ExtractMetadataResult,
  api.RawImageEncodeRequest,
  api.RecoveryMetadata,
  api.RenderMorphRequest,
  api.RenderMorphResult,
  api.MorphSettings,
  api.MorphPathMode,
  api.ResultMilestone,
  api.OperationSettlement<unknown>,
  api.ResultReadiness,
  api.EngineOperations,
  api.MediaBranch,
  api.EngineWorkerRequest,
  api.EngineWorkerResponse,
  api.RecoveryReadResult,
  api.RecoveryMetadataV1,
  api.ConfirmedCrop,
  api.CropPreprocessingPolicyV1,
  api.EncoderInput,
  api.NumericalCheckResult,
  api.ExportQualityRule,
];

test('every citable value is exported from the package entry point', () => {
  for (const name of VALUES) assert.ok(name in api, name);
});

// ---- Exhaustiveness: adding a variant without handling it fails compilation.
const never = (x: never): never => {
  throw new Error(`unhandled ${String(x)}`);
};
export function requestKind(m: EngineWorkerRequest): string {
  switch (m.type) {
    case 'map':
    case 'synthesize':
    case 'encode':
    case 'extract-metadata':
    case 'encode-raw-image':
    case 'render-morph':
      return m.request.ids.requestId;
    case 'raw-frame-ack':
      return String(m.index);
    case 'status':
    case 'cancel':
    case 'dispose':
      return m.id;
    default:
      return never(m);
  }
}
export function responseKind(m: EngineWorkerResponse): string {
  switch (m.type) {
    case 'progress':
      return m.stage;
    case 'stage-timing':
      return m.event.stage;
    case 'frame':
      return String(m.index);
    case 'settled':
      return m.settlement.status;
    case 'status':
      return m.provider.actual;
    default:
      return never(m);
  }
}
export function settlementKind<R>(s: OperationSettlement<R>): string {
  switch (s.status) {
    case 'completed':
      return String(s.result);
    case 'cancelled':
      return s.ids.requestId;
    case 'superseded':
      return s.by.requestId;
    case 'failed':
      return s.error.code;
    default:
      return never(s);
  }
}
export function recoveryKind(r: RecoveryReadResult): string {
  switch (r.kind) {
    case 'missing':
      return 'missing';
    case 'damaged':
      return r.reason;
    case 'incompatible-schema':
      return String(r.schemaVersion);
    case 'parsed':
      return r.metadata.mime;
    default:
      return never(r);
  }
}
export function milestoneKind(m: ResultMilestone): boolean | 'not-applicable' {
  switch (m.milestone) {
    case 'compute-ready':
      return m.readiness.pixelsAvailable;
    case 'file-complete':
      return m.readiness.fileReady;
    default:
      return never(m);
  }
}

// ---- Invalid states are unrepresentable.
const ids = { requestId: 'r', inputRevision: 1, attemptId: 0 };
// @ts-expect-error a completed settlement carries its result
export const noResult: OperationSettlement<number> = { status: 'completed', ids };
// @ts-expect-error a superseded settlement names what superseded it
export const noBy: OperationSettlement<number> = { status: 'superseded', ids };
// @ts-expect-error a parsed recovery result carries metadata
export const noMetadata: RecoveryReadResult = { kind: 'parsed' };
// @ts-expect-error damaged results give a known reason
export const badReason: RecoveryReadResult = { kind: 'damaged', reason: 'cosmic-rays', detail: '' };
const twelveFrames = { kind: 'linear', width: 1, pinch: false, frames: 12, fps: 24 } as const;
// @ts-expect-error morph settings take only the candidate frame counts
export const badFrames: api.MorphSettings = twelveFrames;
// @ts-expect-error WebGL is no longer a compute route
export const webgl: api.ComputeRoute = 'webgl';

// ---- file-complete implies nothing about persistence or display (checked by tsc, never called).
export function readinessIsIndependent(complete: FileComplete, computed: ComputeReady): unknown[] {
  // @ts-expect-error a complete file is not persisted unless persisted is set
  const persisted: Persisted = complete;
  // @ts-expect-error a complete file is not display-decoded unless displayDecoded is set
  const shown: DisplayDecoded = complete;
  const both: Persisted & DisplayDecoded = { ...complete, persisted: true, displayDecoded: true };
  // @ts-expect-error compute-ready pixels are not a file
  const notFile: FileComplete = computed;
  return [persisted, shown, both, notFile];
}

// ---- Worker messages are structured-clone safe; the encoder surface is exactly three methods.
is<IsCloneSafe<EngineWorkerRequest>>();
is<IsCloneSafe<EngineWorkerResponse>>();
is<Equal<IsCloneSafe<{ a: () => void }>, false>>();
is<Equal<IsCloneSafe<{ a: { b: Promise<number> } }>, false>>();
is<Equal<IsCloneSafe<{ signal: CancellationSignal }>, false>>();
is<Equal<IsCloneSafe<{ frames: Uint8ClampedArray[]; n: number }>, true>>();
is<Equal<keyof LoadedEncoderCapability, 'encode' | 'abort' | 'dispose'>>();
// @ts-expect-error a worker message cannot carry a callback
export const callback: EngineWorkerRequest = { type: 'status', id: 'x', onDone: () => {} };

// ---- No engine contract reaches a URL, OPFS handle or acquireBytes callback.
type Forbidden =
  | 'url'
  | 'urls'
  | 'manifestUrl'
  | 'acquireBytes'
  | 'opfs'
  | 'directoryHandle'
  | 'fileHandle'
  | 'fetch';
type DeepKeys<T, Depth extends unknown[] = []> = Depth['length'] extends 6
  ? never
  : T extends ArrayBufferView | ArrayBuffer | string | number | boolean | null | undefined
    ? never
    : T extends (...args: infer A) => infer R
      ? DeepKeys<A[number], [...Depth, 1]> | DeepKeys<Awaited<R>, [...Depth, 1]>
      : T extends readonly (infer U)[]
        ? DeepKeys<U, [...Depth, 1]>
        : T extends object
          ? { [K in keyof T]-?: K | DeepKeys<T[K], [...Depth, 1]> }[keyof T]
          : never;
is<Equal<Extract<DeepKeys<LoadedModelCapability>, Forbidden>, never>>();
is<Equal<Extract<DeepKeys<api.EngineOperations>, Forbidden>, never>>();
is<Equal<Extract<DeepKeys<EngineWorkerRequest | EngineWorkerResponse>, Forbidden>, never>>();
// The check itself bites: a type with a URL field is caught.
is<Equal<Extract<DeepKeys<{ model: { urls: string[] } }>, Forbidden>, 'urls'>>();

test('results record the provider that produced them', () => {
  is<Equal<SynthesisResult['provider'], api.ComputeRoute>>();
  assert.ok(true);
});
