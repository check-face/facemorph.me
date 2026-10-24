// Engine worker messages. Both unions are structured-clone safe: plain data and typed arrays only,
// with no functions, promises or AbortSignals (signals and callbacks stay caller-side; a frame
// callback becomes 'frame' messages acknowledged with 'raw-frame-ack'). A 'status' request reads
// state and starts no acquisition. The candidate's initialize/qualify/prefetch messages belong to
// the manager, which loads the capability before the engine sees it.

import type { CancellationSignal, ProviderState, UnsupportedCapability } from './capability.ts';
import { ENCODER_INPUT_LENGTH } from './crop-policy.ts';
import {
  MAX_MORPH_FRAMES,
  MORPH_PATH_MODES,
  type EncodeRequest,
  type EncodeResult,
  type ExtractMetadataRequest,
  type ExtractMetadataResult,
  type MappingRequest,
  type MappingResult,
  type OperationIds,
  type OperationSettlement,
  type RawImageEncodeRequest,
  type RawImageEncodeResult,
  type RenderMorphRequest,
  type RenderMorphResult,
  type SynthesisRequest,
  type SynthesisResult,
} from './operations.ts';
import type { EngineStage, StageTimingEvent } from './timing.ts';

export type EngineWorkerRequest =
  | { readonly type: 'map'; readonly id: string; readonly request: MappingRequest }
  | { readonly type: 'synthesize'; readonly id: string; readonly request: SynthesisRequest }
  | { readonly type: 'encode'; readonly id: string; readonly request: EncodeRequest }
  | { readonly type: 'extract-metadata'; readonly id: string; readonly request: ExtractMetadataRequest }
  | { readonly type: 'encode-raw-image'; readonly id: string; readonly request: RawImageEncodeRequest }
  | { readonly type: 'render-morph'; readonly id: string; readonly request: RenderMorphRequest }
  | { readonly type: 'raw-frame-ack'; readonly id: string; readonly index: number }
  | { readonly type: 'status'; readonly id: string }
  | { readonly type: 'cancel'; readonly id: string }
  | { readonly type: 'dispose'; readonly id: string };

export type EngineWorkerSettlement =
  | OperationSettlement<MappingResult>
  | OperationSettlement<SynthesisResult>
  | OperationSettlement<EncodeResult>
  | OperationSettlement<ExtractMetadataResult>
  | OperationSettlement<RawImageEncodeResult>
  | OperationSettlement<RenderMorphResult>;

export type EngineWorkerResponse =
  | { readonly type: 'progress'; readonly id: string; readonly stage: EngineStage; readonly fraction?: number }
  | { readonly type: 'stage-timing'; readonly id: string; readonly event: StageTimingEvent }
  | {
      readonly type: 'frame';
      readonly id: string;
      readonly index: number;
      readonly width: number;
      readonly height: number;
      readonly rgba: Uint8ClampedArray;
      /** A sparse preview anchor (display only) rather than a frame of the ordered drain. */
      readonly anchor: boolean;
    }
  | { readonly type: 'settled'; readonly id: string; readonly settlement: EngineWorkerSettlement }
  | {
      readonly type: 'status';
      readonly id: string;
      readonly provider: ProviderState;
      readonly busy: boolean;
      readonly unsupported: readonly UnsupportedCapability[];
    };

type Primitive = string | number | boolean | null | undefined | bigint;
/** true when T holds only structured-clone-safe data (no functions, promises or signals). */
export type IsCloneSafe<T> = [T] extends [Primitive | ArrayBuffer | ArrayBufferView]
  ? true
  : [T] extends [(...args: never[]) => unknown]
    ? false
    : [T] extends [PromiseLike<unknown>]
      ? false
      : [T] extends [CancellationSignal]
        ? false
        : [T] extends [readonly (infer U)[]]
          ? IsCloneSafe<U>
          : [T] extends [object]
            ? false extends { [K in keyof T]-?: IsCloneSafe<T[K]> }[keyof T]
              ? false
              : true
            : false;

export type WorkerMessageErrorCode = 'not-an-object' | 'non-cloneable' | 'unknown-type' | 'invalid-field';

export class WorkerMessageError extends Error {
  readonly code: WorkerMessageErrorCode;
  constructor(code: WorkerMessageErrorCode, message: string) {
    super(message);
    this.name = 'WorkerMessageError';
    this.code = code;
  }
}

const MAX_DEPTH = 32;
const HEX64 = /^[0-9a-f]{64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer);
const fail = (path: string, what: string): never => {
  throw new WorkerMessageError('invalid-field', `${path}: ${what}`);
};

/** Rejects anything structured clone would not carry faithfully: functions, promises, class instances. */
export function assertCloneSafe(value: unknown, path = 'message', depth = 0): void {
  if (depth > MAX_DEPTH) throw new WorkerMessageError('non-cloneable', `${path}: nested too deeply`);
  if (value === null || ['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (typeof value === 'function' || typeof value === 'symbol') throw new WorkerMessageError('non-cloneable', `${path}: ${typeof value}`);
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertCloneSafe(item, `${path}[${i}]`, depth + 1));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new WorkerMessageError('non-cloneable', `${path}: not plain data`);
  for (const [k, v] of Object.entries(value as object)) assertCloneSafe(v, `${path}.${k}`, depth + 1);
}

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const finite = (a: Float32Array) => a.every(Number.isFinite);

function ids(v: unknown, path: string): OperationIds {
  if (!isRecord(v) || typeof v.requestId !== 'string' || v.requestId === '' || !isInt(v.inputRevision, 0) || !isInt(v.attemptId, 0)) fail(path, 'ids');
  return v as unknown as OperationIds;
}

function latent(v: unknown, path: string): void {
  if (!isRecord(v) || v.space !== 'w-plus' || !Array.isArray(v.shape) || v.shape.length !== 2 || !v.shape.every((n) => isInt(n, 1, 65536))) fail(path, 'latent');
  const l = v as { shape: number[]; values: unknown };
  if (!(l.values instanceof Float32Array) || l.values.length !== l.shape[0]! * l.shape[1]! || !finite(l.values)) fail(path, 'latent values');
}

function rgba(v: unknown, width: unknown, height: unknown, path: string): void {
  if (!isInt(width, 1, 16384) || !isInt(height, 1, 16384) || !(v instanceof Uint8ClampedArray) || v.length !== width * height * 4) fail(path, 'rgba');
}

function request(type: string, r: unknown): void {
  if (!isRecord(r)) fail('request', 'object');
  const q = r as Record<string, unknown>;
  ids(q.ids, 'request.ids');
  switch (type) {
    case 'map': {
      const t = q.truncation as Record<string, unknown> | undefined;
      if (!(q.z instanceof Float32Array) || q.z.length < 1 || !finite(q.z)) fail('request.z', 'finite Float32Array');
      if (!isRecord(t) || !Number.isFinite(t.psi) || !isInt(t.cutoff, 0, 64)) fail('request.truncation', '{psi, cutoff}');
      return;
    }
    case 'synthesize':
      latent(q.wPlus, 'request.wPlus');
      if (q.output !== 'rgba' && q.output !== 'rgba-and-raw-float') fail('request.output', 'rgba or rgba-and-raw-float');
      return;
    case 'encode': {
      const input = q.input as Record<string, unknown> | undefined;
      if (!isRecord(input) || !(input.tensor instanceof Float32Array) || input.tensor.length !== ENCODER_INPUT_LENGTH || !finite(input.tensor)) fail('request.input.tensor', '[1,3,256,256] finite');
      if (typeof input!.tensorDigest !== 'string' || !HEX64.test(input!.tensorDigest) || input!.policyVersion !== 'crop-preprocessing-v1') fail('request.input', 'digest and policy');
      if (typeof q.confirmedCropId !== 'string' || !HEX64.test(q.confirmedCropId)) fail('request.confirmedCropId', 'hex SHA-256');
      return;
    }
    case 'extract-metadata':
      if (!(q.bytes instanceof Uint8Array)) fail('request.bytes', 'Uint8Array');
      return;
    case 'encode-raw-image': {
      if (q.format !== 'png' && q.format !== 'webp-lossless') fail('request.format', 'png or webp-lossless');
      rgba(q.rgba, q.width, q.height, 'request');
      const rec = q.recovery as Record<string, unknown> | undefined;
      if (!isRecord(rec) || !['seed', 'photo', 'latent'].includes(rec.generationKind as string) || typeof rec.generationSha256 !== 'string' || !HEX64.test(rec.generationSha256) || !isRecord(rec.provenance)) {
        fail('request.recovery', 'recovery metadata');
      }
      latent(rec!.latent, 'request.recovery.latent');
      return;
    }
    case 'render-morph': {
      if (!Array.isArray(q.endpoints) || q.endpoints.length < 2) fail('request.endpoints', 'two or more latents');
      (q.endpoints as unknown[]).forEach((e, i) => latent(e, `request.endpoints[${i}]`));
      const s = q.settings as Record<string, unknown> | undefined;
      if (
        !isRecord(s) ||
        !(MORPH_PATH_MODES as readonly unknown[]).includes(s.kind) ||
        typeof s.width !== 'number' ||
        !(s.width >= 0 && s.width <= 1.2) ||
        typeof s.pinch !== 'boolean' ||
        ![8, 16, 32].includes(s.frames as number) ||
        !isInt(s.fps, 1, 120)
      ) {
        fail('request.settings', 'morph settings');
      }
      if (!isInt(q.frameCount, 2, MAX_MORPH_FRAMES)) fail('request.frameCount', `2 to ${MAX_MORPH_FRAMES}`);
      if (!isInt(q.fps, 1, 120)) fail('request.fps', '1 to 120');
      if (q.resolution !== 1024 && q.resolution !== 512) fail('request.resolution', '1024 or 512');
      if (!['cached-result', 'raw-sparse-anchors', 'blob-stream', 'sequential', 'retained-then-encode', 'endpoint-reuse'].includes(q.branch as string)) fail('request.branch', 'media branch');
      return;
    }
  }
}

const REQUEST_TYPES = new Set(['map', 'synthesize', 'encode', 'extract-metadata', 'encode-raw-image', 'render-morph', 'raw-frame-ack', 'status', 'cancel', 'dispose']);
const RESPONSE_TYPES = new Set(['progress', 'stage-timing', 'frame', 'settled', 'status']);
const STAGES = new Set(['mapping', 'synthesis', 'readback', 'encoder-session-create', 'encoder-run', 'image-encode', 'video-encode', 'metadata-read']);
const SETTLED = new Set(['completed', 'cancelled', 'superseded', 'failed']);

function envelope(value: unknown, types: Set<string>): Record<string, unknown> {
  if (!isRecord(value)) throw new WorkerMessageError('not-an-object', 'a worker message is a plain object');
  assertCloneSafe(value);
  if (typeof value.type !== 'string' || !types.has(value.type)) throw new WorkerMessageError('unknown-type', `unknown message type ${String(value.type)}`);
  if (typeof value.id !== 'string' || value.id === '') fail('id', 'non-empty string');
  return value;
}

/** Validates a message arriving at the engine worker. Every rejection is a WorkerMessageError. */
export function validateWorkerRequest(value: unknown): EngineWorkerRequest {
  const m = envelope(value, REQUEST_TYPES);
  if (m.type === 'raw-frame-ack') {
    if (!isInt(m.index, 0, MAX_MORPH_FRAMES - 1)) fail('index', 'frame index');
  } else if (!['status', 'cancel', 'dispose'].includes(m.type as string)) {
    request(m.type as string, m.request);
  }
  return m as unknown as EngineWorkerRequest;
}

/** Validates a message arriving from the engine worker. Every rejection is a WorkerMessageError. */
export function validateWorkerResponse(value: unknown): EngineWorkerResponse {
  const m = envelope(value, RESPONSE_TYPES);
  switch (m.type) {
    case 'progress':
      if (!STAGES.has(m.stage as string)) fail('stage', 'engine stage');
      if (m.fraction !== undefined && !(typeof m.fraction === 'number' && m.fraction >= 0 && m.fraction <= 1)) fail('fraction', '0 to 1');
      break;
    case 'stage-timing': {
      const e = m.event as Record<string, unknown> | undefined;
      if (!isRecord(e) || !STAGES.has(e.stage as string) || !Number.isFinite(e.startedAtMs) || !Number.isFinite(e.completedAtMs) || (e.completedAtMs as number) < (e.startedAtMs as number)) fail('event', 'stage timing');
      if (!['inference-complete', 'readback-complete', 'map-async-complete'].includes(e!.boundary as string)) fail('event.boundary', 'completion boundary');
      ids(e!.ids, 'event.ids');
      break;
    }
    case 'frame':
      if (!isInt(m.index, 0, MAX_MORPH_FRAMES - 1) || typeof m.anchor !== 'boolean') fail('frame', 'index and anchor');
      rgba(m.rgba, m.width, m.height, 'frame');
      break;
    case 'settled': {
      const s = m.settlement as Record<string, unknown> | undefined;
      if (!isRecord(s) || !SETTLED.has(s.status as string)) fail('settlement', 'status');
      ids(s!.ids, 'settlement.ids');
      if (s!.status === 'completed' && !isRecord(s!.result)) fail('settlement.result', 'object');
      if (s!.status === 'superseded') ids(s!.by, 'settlement.by');
      if (s!.status === 'failed' && (!isRecord(s!.error) || typeof (s!.error as Record<string, unknown>).message !== 'string')) fail('settlement.error', 'engine error');
      break;
    }
    case 'status': {
      const p = m.provider as Record<string, unknown> | undefined;
      if (!isRecord(p) || !['cpu', 'webgpu'].includes(p.actual as string) || typeof m.busy !== 'boolean' || !Array.isArray(m.unsupported)) fail('status', 'provider, busy, unsupported');
      break;
    }
  }
  return m as unknown as EngineWorkerResponse;
}
