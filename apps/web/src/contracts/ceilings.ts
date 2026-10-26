// Numeric ceilings (contracts milestone 2, fm-2o8q): the count and byte limits that confirmed-crop, batch
// admission, acquisition, the scheduler, the device check and media export cite. Every entry has a value,
// a unit, a route scope and the measurement or source it comes from. A decode route with no measurement
// has no entry and is therefore not admitted; there is no unbounded default and no face-count or
// blend-slot ceiling (operator, 24 October: only real constraints).
//
// Values revise only by contract revision. ceilings.vectors.json holds the at-boundary and one-over
// vectors for downstream tests; test/contracts/ceilings.test.ts derives the decode bounds again from the
// raw measurement rows and fails when the two disagree. These are implementation contracts to qualify,
// not browser RSS control claims.

import {
  ACQUISITION_BUDGETS,
  LIVE_RESIDENCY_LIMIT,
  type AcquisitionMemoryClass,
} from 'browser-model-manager';
import {
  CROP_MAX_BYTES,
  CROP_OUTPUT,
  MAX_MORPH_FRAMES,
  MEMORY_BOUNDS,
  type ComputeRoute,
  type MemoryBoundName,
} from 'stylegan-js';
import { PREFLIGHT_BUDGETS } from './preflight.ts';
import type { FrameBudget } from './scheduler.ts';

/** The candidate commit the carried constants were read from (facemorph.me-classic). */
export const CLASSIC_COMMIT = 'a42829bb0582b5a7a55ba6b1045a05861612b8a5';
const MEASUREMENTS = 'packages/stylegan-js/src/contracts/decode-measurements';

export type CeilingName =
  | 'DECODE_TRANSIENT_BYTES'
  | 'RETAINED_SOURCE_BYTES'
  | 'CROP_BUFFER_BYTES'
  | 'BATCH_RETAINED_INPUT_BYTES'
  | 'MORPH_FRAME_BUDGET'
  | 'STORED_SESSION_BYTES'
  | 'PROJECT_FILE_PARSE_BYTES'
  | 'SESSION_FILE_PARSE_BYTES'
  | 'IMAGE_PREPARATION_BYTES'
  | 'FILE_ENCODE_BYTES'
  | 'PREPARED_FILE_CACHE_MAX_BYTES'
  | 'ACQUISITION_READ_AHEAD_BYTES'
  | 'ACQUISITION_HASH_BYTES'
  | 'ACQUISITION_WRITE_BUFFER_BYTES'
  | 'LIVE_RESIDENT_BYTES'
  | 'LIVE_SESSIONS'
  | 'ENGINE_LIVE_ENCODER_SESSIONS'
  | 'ENGINE_WASM_HEAP_BYTES'
  | 'ENGINE_RETAINED_FRAMES'
  | 'ENGINE_RETAINED_FRAME_BYTES'
  | 'ENGINE_CODEC_QUEUE_FRAMES'
  | 'ENGINE_GPU_BUFFER_BYTES'
  | 'PREFLIGHT_SAMPLING_MS'
  | 'PREFLIGHT_UI_DEADLINE_MS'
  | 'PREFLIGHT_SCRATCH_BYTES'
  | 'PREFLIGHT_CHECKER_CODE_BYTES';

export type CeilingUnit = 'bytes' | 'frames' | 'sessions' | 'ms';

/** A measured decode lane: machine and browser of one decode-measurements file. */
export type DecodeLane = 'eris-chromium' | 'eris-firefox' | 'eris-webkit';
export const DECODE_LANES: readonly DecodeLane[] = Object.freeze([
  'eris-chromium',
  'eris-firefox',
  'eris-webkit',
]);

/** The candidate's bounded decode routes (tools/decode-measure/README.md). */
export type DecodeRoute =
  | 'preview-decode'
  | 'preview-display'
  | 'crop-decode'
  | 'frame-decode-512'
  | 'frame-decode-1024';
export const DECODE_ROUTES: readonly DecodeRoute[] = Object.freeze([
  'preview-decode',
  'preview-display',
  'crop-decode',
  'frame-decode-512',
  'frame-decode-1024',
]);

export type CeilingScope =
  /** Holds wherever the app runs. */
  | { readonly kind: 'all-routes' }
  | { readonly kind: 'compute-route'; readonly route: ComputeRoute }
  | { readonly kind: 'memory-class'; readonly memory: AcquisitionMemoryClass }
  | { readonly kind: 'decode-route'; readonly lane: DecodeLane; readonly route: DecodeRoute };

export type CeilingReference =
  | {
      readonly kind: 'decode-measurement';
      readonly file: string;
      readonly browserVersion: string;
      readonly leaseRunId: string;
      readonly rule: string;
    }
  /** A constant carried from the candidate until a measurement revises it. */
  | {
      readonly kind: 'candidate-constant';
      readonly source: string;
      readonly symbol: string;
      readonly classicCommit: typeof CLASSIC_COMMIT;
    }
  /** A figure the plan sets for a model-free check. */
  | { readonly kind: 'plan-budget'; readonly anchor: string }
  | { readonly kind: 'derived'; readonly from: readonly CeilingName[]; readonly rule: string };

/** What the person is told to do when a request is over: never truncation or hidden eviction. */
export type OverCeilingAction =
  | 'choose-smaller-photo'
  | 'reduce-selection'
  | 'remove-retry-input'
  | 'shorten-morph'
  | 'refuse-file'
  /** The prepared file is handed off and not kept (PreparedFileNotRetained). */
  | 'not-retained'
  /** Internal back-pressure: work waits for the budget, nothing is refused. */
  | 'wait';

export interface Ceiling {
  readonly name: CeilingName;
  /** Inclusive: a request of exactly `value` is admitted, `value + 1` is not. */
  readonly value: number;
  readonly unit: CeilingUnit;
  readonly scope: CeilingScope;
  /** What one request of this ceiling counts. */
  readonly counts: string;
  readonly over: OverCeilingAction;
  readonly reference: CeilingReference;
}

const ALL: CeilingScope = Object.freeze({ kind: 'all-routes' });
const candidate = (source: string, symbol: string): CeilingReference => ({
  kind: 'candidate-constant',
  source,
  symbol,
  classicCommit: CLASSIC_COMMIT,
});

/**
 * Per lane and route: CROP_MAX_BYTES for the compressed source (every fixture is at most that) plus the
 * largest per-fixture sum of the representations the route holds besides it (decoded, cropped,
 * cropped_canvas, reencoded). `imagebitmap-full` is measured but is the unbounded decode the bounded
 * routes exist to avoid, so it is not admitted; phone lanes are not measured, so not admitted.
 */
export const DECODE_RULE =
  'CROP_MAX_BYTES + max over fixtures of the sum of the non-compressed representation peaks';

const LANE_RUNS: { readonly [L in DecodeLane]: { readonly browserVersion: string; readonly leaseRunId: string } } =
  Object.freeze({
    'eris-chromium': { browserVersion: '152.0.7977.82', leaseRunId: '20261024T111010Z-69b94ff3' },
    'eris-firefox': { browserVersion: '157.0', leaseRunId: '20261024T093104Z-3ddcf941' },
    'eris-webkit': { browserVersion: '27.2', leaseRunId: '20261024T093151Z-7d470e55' },
  });

/** Measured transient decode bounds, bytes (fm-4cp rows, eris, 24 October 2026). */
export const DECODE_TRANSIENT_BYTES: {
  readonly [L in DecodeLane]: { readonly [R in DecodeRoute]: number };
} = Object.freeze({
  'eris-chromium': Object.freeze({
    'preview-decode': 134_217_728,
    'preview-display': 178_722_028,
    'crop-decode': 74_398_475,
    'frame-decode-512': 68_157_440,
    'frame-decode-1024': 71_303_168,
  }),
  'eris-firefox': Object.freeze({
    'preview-decode': 134_217_728,
    'preview-display': 180_250_438,
    'crop-decode': 74_056_371,
    'frame-decode-512': 68_157_440,
    'frame-decode-1024': 71_303_168,
  }),
  'eris-webkit': Object.freeze({
    'preview-decode': 134_217_728,
    'preview-display': 149_501_112,
    'crop-decode': 74_405_269,
    'frame-decode-512': 68_157_440,
    'frame-decode-1024': 71_303_168,
  }),
});

/** Decode routes and lanes with no ceiling, and why: none of them is admitted. */
export const NOT_ADMITTED_DECODE: readonly { readonly route: string; readonly lane: string; readonly reason: string }[] =
  Object.freeze([
    {
      route: 'imagebitmap-full',
      lane: 'all',
      reason: 'the unbounded full decode (about 503 MB for a 125 MP source); the bounded routes replace it',
    },
    { route: 'all', lane: 'android-emulator', reason: 'not measured' },
    { route: 'all', lane: 'ios-simulator', reason: 'not measured' },
    { route: 'all', lane: 'physical-phone', reason: 'not measured' },
    { route: 'all', lane: 'macos-desktop', reason: 'not measured' },
  ]);

const CROP_BUFFER = CROP_OUTPUT * CROP_OUTPUT * 4;
/** Bytes a batch may retain for Retry: what one bounded preview decode of a maximal source already holds. */
const BATCH_RETAINED_INPUT = 134_217_728;
const STORED_SESSION = 32 * 1024 * 1024;
const IMAGE_PREPARATION = 8 * 1024 * 1024;
const FILE_ENCODE = 48 * 1024 * 1024;

const ENGINE: { readonly [N in MemoryBoundName]: { readonly name: CeilingName; readonly unit: CeilingUnit; readonly counts: string; readonly source: string; readonly symbol: string; readonly scope: CeilingScope } } = {
  maxLiveEncoderSessions: { name: 'ENGINE_LIVE_ENCODER_SESSIONS', unit: 'sessions', counts: 'encoder ORT sessions alive at once', source: 'src/Next/browser/ort-worker.mjs', symbol: 'encodeStream', scope: ALL },
  maxWasmHeapBytes: { name: 'ENGINE_WASM_HEAP_BYTES', unit: 'bytes', counts: 'one unshared WASM heap', source: 'src/Next/photo/selection-worker.mjs', symbol: 'maxWasmBytes', scope: { kind: 'compute-route', route: 'cpu' } },
  maxRetainedFrames: { name: 'ENGINE_RETAINED_FRAMES', unit: 'frames', counts: 'frames of one morph', source: 'src/Next/video-worker.mjs', symbol: '4096', scope: ALL },
  maxRetainedFrameBytes: { name: 'ENGINE_RETAINED_FRAME_BYTES', unit: 'bytes', counts: 'retained morph frames across stored morphs', source: 'src/Next/morph-frames.mjs', symbol: 'DEFAULT_MAX_BYTES', scope: ALL },
  maxCodecQueueFrames: { name: 'ENGINE_CODEC_QUEUE_FRAMES', unit: 'frames', counts: 'frames waiting in the video encoder when one more is submitted', source: 'src/Next/video-worker.mjs', symbol: 'encodeQueueSize', scope: ALL },
  maxGpuBufferBytes: { name: 'ENGINE_GPU_BUFFER_BYTES', unit: 'bytes', counts: 'one GPU buffer', source: 'src/Next/browser/webgpu-direct.mjs', symbol: 'DIRECT_LIMITS.maxBufferSize', scope: { kind: 'compute-route', route: 'webgpu' } },
};

const decodeCeilings = DECODE_LANES.flatMap((lane) =>
  DECODE_ROUTES.map(
    (route): Ceiling => ({
      name: 'DECODE_TRANSIENT_BYTES',
      value: DECODE_TRANSIENT_BYTES[lane][route],
      unit: 'bytes',
      scope: { kind: 'decode-route', lane, route },
      counts: 'peak transient bytes of one decode of one source',
      over: 'choose-smaller-photo',
      reference: { kind: 'decode-measurement', file: `${MEASUREMENTS}/${lane}.json`, ...LANE_RUNS[lane], rule: DECODE_RULE },
    }),
  ),
);

const memoryCeilings = (['constrained-or-unknown', 'ample'] as const).flatMap((memory): Ceiling[] => {
  const b = ACQUISITION_BUDGETS[memory];
  const scope: CeilingScope = { kind: 'memory-class', memory };
  return [
    { name: 'ACQUISITION_READ_AHEAD_BYTES', value: b.readAheadBytes, unit: 'bytes', scope, counts: 'chunk bytes fetched ahead of the writer, all workers together', over: 'wait', reference: candidate('src/Next/browser/ort-worker.mjs', 'readAhead') },
    { name: 'ACQUISITION_HASH_BYTES', value: b.hashBytes, unit: 'bytes', scope, counts: 'bytes held while hashing', over: 'wait', reference: candidate('src/Next/Assets/sha256.mjs', 'one chunk and a 64-byte block') },
    { name: 'ACQUISITION_WRITE_BUFFER_BYTES', value: b.writeBufferBytes, unit: 'bytes', scope, counts: 'bytes buffered before one shard write commits', over: 'wait', reference: candidate('src/Next/Assets/model-cache.mjs', 'commitUnit') },
  ];
});

const engineCeilings = (Object.keys(ENGINE) as MemoryBoundName[]).map((bound): Ceiling => {
  const e = ENGINE[bound];
  return { name: e.name, value: MEMORY_BOUNDS[bound], unit: e.unit, scope: e.scope, counts: e.counts, over: 'wait', reference: candidate(e.source, e.symbol) };
});

const DEVICE_CHECK = '#lightweight-device-check-and-pre-download-guidance';

/** Every ceiling. A (name, scope) pair appears once. */
export const CEILINGS: readonly Ceiling[] = Object.freeze([
  ...decodeCeilings,
  { name: 'RETAINED_SOURCE_BYTES', value: CROP_MAX_BYTES, unit: 'bytes', scope: ALL, counts: 'compressed bytes of one retained source photo', over: 'choose-smaller-photo', reference: candidate('src/Next/photo/crop.mjs', 'CROP_MAX_BYTES') },
  { name: 'CROP_BUFFER_BYTES', value: CROP_BUFFER, unit: 'bytes', scope: ALL, counts: 'one confirmed crop canvas (1024 x 1024 RGBA)', over: 'remove-retry-input', reference: { kind: 'decode-measurement', file: `${MEASUREMENTS}/eris-chromium.json`, ...LANE_RUNS['eris-chromium'], rule: 'cropped_canvas peak, equal on every lane and fixture' } },
  { name: 'BATCH_RETAINED_INPUT_BYTES', value: BATCH_RETAINED_INPUT, unit: 'bytes', scope: ALL, counts: 'sources and crops a batch keeps for its pending, running and retryable slots', over: 'reduce-selection', reference: { kind: 'derived', from: ['DECODE_TRANSIENT_BYTES'], rule: 'the preview-decode bound, the same on every measured lane: a batch holds no more than one admitted maximal decode' } },
  { name: 'MORPH_FRAME_BUDGET', value: MAX_MORPH_FRAMES, unit: 'frames', scope: ALL, counts: 'frames of one morph, every keypoint included', over: 'shorten-morph', reference: candidate('src/Next/video-worker.mjs', '4096 (also last-result.mjs)') },
  { name: 'STORED_SESSION_BYTES', value: STORED_SESSION, unit: 'bytes', scope: ALL, counts: 'one stored session: faces, frames and video', over: 'reduce-selection', reference: candidate('src/Next/last-result.mjs', 'MAX_SESSION_BYTES') },
  { name: 'PROJECT_FILE_PARSE_BYTES', value: 64 * 1024 * 1024, unit: 'bytes', scope: ALL, counts: 'one untrusted project or recovery file, before it is read', over: 'refuse-file', reference: candidate('src/Next/image-envelope.mjs', 'MAX_FILE (also recovery-metadata.mjs)') },
  { name: 'SESSION_FILE_PARSE_BYTES', value: STORED_SESSION, unit: 'bytes', scope: ALL, counts: 'one untrusted stored-session record, before it is parsed', over: 'refuse-file', reference: { kind: 'derived', from: ['STORED_SESSION_BYTES'], rule: 'nothing larger than a storable session is parsed' } },
  { name: 'IMAGE_PREPARATION_BYTES', value: IMAGE_PREPARATION, unit: 'bytes', scope: ALL, counts: 'raw pixel bytes reserved while preparing still files', over: 'wait', reference: candidate('src/Next/image-encoder.mjs', 'maxBytes') },
  { name: 'FILE_ENCODE_BYTES', value: FILE_ENCODE, unit: 'bytes', scope: ALL, counts: 'compressed bytes of one encoded video', over: 'shorten-morph', reference: candidate('src/Next/video-worker.mjs', 'MAX_COMPRESSED') },
  { name: 'PREPARED_FILE_CACHE_MAX_BYTES', value: FILE_ENCODE + 2 * IMAGE_PREPARATION, unit: 'bytes', scope: ALL, counts: 'prepared export files kept ready to Save or Share', over: 'not-retained', reference: { kind: 'derived', from: ['FILE_ENCODE_BYTES', 'IMAGE_PREPARATION_BYTES'], rule: 'one largest video plus a still in each of two formats' } },
  ...memoryCeilings,
  { name: 'LIVE_RESIDENT_BYTES', value: LIVE_RESIDENCY_LIMIT.maxResidentBytes, unit: 'bytes', scope: ALL, counts: 'model bytes resident at once, all workers together', over: 'wait', reference: candidate('src/Next/browser/ort-worker.mjs', 'maxWasmBytes (streamed encoder)') },
  { name: 'LIVE_SESSIONS', value: LIVE_RESIDENCY_LIMIT.maxLiveSessions, unit: 'sessions', scope: ALL, counts: 'ORT sessions alive at once, all workers together', over: 'wait', reference: candidate('src/Next/browser/ort-worker.mjs', 'mapping + synthesis') },
  ...engineCeilings,
  { name: 'PREFLIGHT_SAMPLING_MS', value: PREFLIGHT_BUDGETS.samplingMs, unit: 'ms', scope: ALL, counts: 'device-check sampling time', over: 'wait', reference: { kind: 'plan-budget', anchor: DEVICE_CHECK } },
  { name: 'PREFLIGHT_UI_DEADLINE_MS', value: PREFLIGHT_BUDGETS.uiDeadlineMs, unit: 'ms', scope: ALL, counts: 'time before the device check gives up (no reliable estimate)', over: 'wait', reference: { kind: 'plan-budget', anchor: DEVICE_CHECK } },
  { name: 'PREFLIGHT_SCRATCH_BYTES', value: PREFLIGHT_BUDGETS.scratchBytes, unit: 'bytes', scope: ALL, counts: 'explicitly allocated device-check scratch buffers', over: 'wait', reference: { kind: 'plan-budget', anchor: DEVICE_CHECK } },
  { name: 'PREFLIGHT_CHECKER_CODE_BYTES', value: PREFLIGHT_BUDGETS.checkerCodeBytesCompressed, unit: 'bytes', scope: ALL, counts: 'compressed device-check code', over: 'wait', reference: { kind: 'plan-budget', anchor: DEVICE_CHECK } },
] satisfies readonly Ceiling[]);

/** A stable key for a scope, as the vectors file writes it. */
export function scopeKey(scope: CeilingScope): string {
  switch (scope.kind) {
    case 'all-routes':
      return 'all-routes';
    case 'compute-route':
      return `compute-route:${scope.route}`;
    case 'memory-class':
      return `memory-class:${scope.memory}`;
    case 'decode-route':
      return `decode-route:${scope.lane}:${scope.route}`;
  }
}

export type CeilingLookup =
  | { readonly admitted: true; readonly ceiling: Ceiling }
  /** No ceiling for this name in this scope: the request is not admitted. */
  | { readonly admitted: false; readonly reason: 'not-measured'; readonly name: CeilingName; readonly scope: string };

/** The ceiling for a name in a scope; an `all-routes` ceiling answers every scope. */
export function lookupCeiling(name: CeilingName, scope: CeilingScope): CeilingLookup {
  const key = scopeKey(scope);
  const exact = CEILINGS.find((c) => c.name === name && scopeKey(c.scope) === key);
  const general = CEILINGS.find((c) => c.name === name && c.scope.kind === 'all-routes');
  const ceiling = exact ?? general;
  return ceiling ? { admitted: true, ceiling } : { admitted: false, reason: 'not-measured', name, scope: key };
}

export type CeilingCheck =
  | { readonly ok: true; readonly ceiling: CeilingName; readonly limit: number; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: 'over-ceiling';
      readonly ceiling: CeilingName;
      readonly limit: number;
      readonly requested: number;
      readonly unit: CeilingUnit;
      readonly action: OverCeilingAction;
    }
  | { readonly ok: false; readonly reason: 'not-measured'; readonly ceiling: CeilingName; readonly scope: string }
  | { readonly ok: false; readonly reason: 'invalid-amount'; readonly ceiling: CeilingName; readonly requested: number };

/**
 * Admits `requested` (the total including what is already held) against a ceiling. Callers check before
 * allocating anything (a batch before any extra keypoint), so an over-budget request changes nothing.
 */
export function checkCeiling(name: CeilingName, scope: CeilingScope, requested: number): CeilingCheck {
  const found = lookupCeiling(name, scope);
  if (!found.admitted) return { ok: false, reason: 'not-measured', ceiling: name, scope: found.scope };
  if (!Number.isSafeInteger(requested) || requested < 0) return { ok: false, reason: 'invalid-amount', ceiling: name, requested };
  const c = found.ceiling;
  return requested <= c.value
    ? { ok: true, ceiling: name, limit: c.value, remaining: c.value - requested }
    : { ok: false, reason: 'over-ceiling', ceiling: name, limit: c.value, requested, unit: c.unit, action: c.over };
}

/**
 * Admits one decode on a lane and route as the caller names them (from the device and the decode path it
 * would take). An unmeasured lane or route, `imagebitmap-full` included, is `not-measured`: not admitted.
 */
export function checkDecode(lane: string, route: string, requested: number): CeilingCheck {
  const l = DECODE_LANES.find((x) => x === lane);
  const r = DECODE_ROUTES.find((x) => x === route);
  if (l === undefined || r === undefined)
    return { ok: false, reason: 'not-measured', ceiling: 'DECODE_TRANSIENT_BYTES', scope: `decode-route:${lane}:${route}` };
  return checkCeiling('DECODE_TRANSIENT_BYTES', { kind: 'decode-route', lane: l, route: r }, requested);
}

/** The morph frame budget the scheduler cites: the classic 4,096 frames, until a measurement revises it. */
export const MORPH_FRAME_BUDGET: FrameBudget = Object.freeze({ maxFrames: MAX_MORPH_FRAMES, source: 'classic-4096' });
