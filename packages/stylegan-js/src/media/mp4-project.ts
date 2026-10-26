// MP4 project metadata (fm-fzzd, plan: media.schema.core): the morph project a saved MP4 carries, so the app's
// internal reader can rebuild the ordered controls and morph settings exactly. The container is the candidate's
// (classic a42829b recovery-metadata.mjs decorateVideo): one top-level `uuid` box whose 16-byte user type is
// the ASCII "FaceMorphProject", appended after the movie, holding UTF-8 JSON. Schema 1 is the candidate's
// project (project-v1.fixture.json shape: latents as JSON number arrays, no integrity hash) and stays readable.
// Schema 2, written here, is dynamic-shape aware: the generator record and W+ shape come from the descriptor,
// each control latent is exact float32-le-base64 with its SHA-256, the video's actual size, frame count and
// encoder route are recorded, and `videoSha256` covers the MP4 without this box, so a box copied onto another
// video (an obsolete hash) is rejected. Pure: bytes in, typed results out; nothing here fetches anything.
// External MP4 project-open UI stays deferred ("Video; reopening this file as a project is not available in
// this release."). See docs/formats.md.

import type { ModelDescriptor } from '../contracts/descriptor.ts';
import { latentFitsDescriptor } from '../contracts/descriptor.ts';
import type { LatentTensor, MorphPathMode } from '../contracts/operations.ts';
import { MAX_MORPH_FRAMES, MORPH_PATH_MODES } from '../contracts/operations.ts';
import { sha256Hex, utf8Bytes } from '../contracts/sha256.ts';
import { modelRecord, validateModelRecord, type RecoveryModelRecord } from './recovery-v3.ts';

export const MP4_PROJECT_SCHEMA = 2;
export const MP4_PROJECT_KIND = 'facemorph-project-v2';
/** The candidate's bounds (recoverVideoProject / decorateVideo). */
export const MP4_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MP4_PROJECT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MP4_MAX_BOXES = 10000;
const KEY = 'FaceMorphProject';
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------------
// Encoder route report

export type VideoRoute = 'webcodecs' | 'ffmpeg';
export type VideoRouteReason =
  | 'webcodecs-full-size'
  | 'webcodecs-fallback-size'
  | 'webcodecs-unavailable'
  | 'webcodecs-unsupported';

/** What the produced file is and why: the app discloses the actual resolution beside the result. */
export interface VideoFileResult {
  readonly width: number;
  readonly height: number;
  readonly route: VideoRoute;
  readonly reason: VideoRouteReason;
}

/** The encoder choice as export-policy chooseVideoEncoder returns it (structurally). */
export type VideoChoiceLike =
  | { readonly kind: 'webcodecs'; readonly width: number; readonly height: number }
  | {
      readonly kind: 'ffmpeg';
      readonly width: number;
      readonly height: number;
      readonly reason: 'webcodecs-unavailable' | 'webcodecs-unsupported';
    };

/** The file result for an encoder choice; `fullSize` is the size the chosen quality aimed for (1024 by default). */
export function videoFileResult(choice: VideoChoiceLike, fullSize = 1024): VideoFileResult {
  if (choice.kind === 'ffmpeg')
    return { width: choice.width, height: choice.height, route: 'ffmpeg', reason: choice.reason };
  return {
    width: choice.width,
    height: choice.height,
    route: 'webcodecs',
    reason: choice.width === fullSize ? 'webcodecs-full-size' : 'webcodecs-fallback-size',
  };
}

// ---------------------------------------------------------------------------------------------------------
// MP4 boxes

interface Box {
  readonly type: string;
  readonly at: number;
  readonly end: number;
  /** Payload start (after size, type, a 64-bit size and a uuid user type). */
  readonly body: number;
}

export type Mp4Damage =
  | 'file-too-large'
  | 'container'
  | 'truncated'
  | 'duplicate-metadata'
  | 'metadata-too-large'
  | 'unreadable-json'
  | 'invalid-fields'
  | 'video-mismatch'
  | 'integrity';

class Damaged extends Error {
  readonly reason: Mp4Damage;
  constructor(reason: Mp4Damage, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

function boxes(bytes: Uint8Array, start: number, end: number, top: boolean): Box[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  for (let at = start; at < end;) {
    if (out.length >= MP4_MAX_BOXES) throw new Damaged('container', 'too many MP4 boxes');
    if (at + 8 > end) throw new Damaged('truncated', 'truncated MP4 box header');
    let size = v.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > end) throw new Damaged('truncated', 'truncated MP4 box header');
      const big = v.getBigUint64(at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Damaged('container', 'MP4 box too large');
      size = Number(big);
      body = at + 16;
    } else if (size === 0) {
      if (!top) throw new Damaged('container', 'open-ended nested MP4 box');
      size = end - at;
    }
    if (size < body - at) throw new Damaged('container', 'invalid MP4 box size');
    if (at + size > end)
      throw new Damaged('truncated', `MP4 ${type} box runs past the end of the file`);
    if (type === 'uuid') body += 16;
    if (body > at + size) throw new Damaged('container', 'invalid MP4 uuid box');
    out.push({ type, at, end: at + size, body });
    at += size;
  }
  return out;
}

const child = (bytes: Uint8Array, b: Box, type: string) =>
  boxes(bytes, b.body, b.end, false).find((c) => c.type === type);

/** The video track facts the reader checks against the project: sample entry size and sample count. */
export interface Mp4VideoInfo {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

const VISUAL = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v', 'vp09', 'av01']);

function videoInfo(bytes: Uint8Array, top: readonly Box[]): Mp4VideoInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Damaged('container', 'MP4 has no movie box');
  if (!top.some((b) => b.type === 'mdat')) throw new Damaged('container', 'MP4 has no media data');
  for (const trak of boxes(bytes, moov.body, moov.end, false).filter((b) => b.type === 'trak')) {
    const mdia = child(bytes, trak, 'mdia');
    const minf = mdia && child(bytes, mdia, 'minf');
    const stbl = minf && child(bytes, minf, 'stbl');
    const stsd = stbl && child(bytes, stbl, 'stsd');
    const stsz = stbl && child(bytes, stbl, 'stsz');
    if (!stsd || !stsz || stsd.body + 8 + 36 > stsd.end || stsz.body + 12 > stsz.end) continue;
    const entry = stsd.body + 8; // version/flags, entry count
    const codec = ascii(bytes, entry + 4, 4);
    if (!VISUAL.has(codec)) continue;
    return {
      codec,
      width: v.getUint16(entry + 32),
      height: v.getUint16(entry + 34),
      frameCount: v.getUint32(stsz.body + 8),
    };
  }
  throw new Damaged('container', 'MP4 has no video track');
}

interface Located {
  readonly top: readonly Box[];
  readonly project: Box | null;
  readonly info: Mp4VideoInfo;
}

function locate(bytes: Uint8Array): Located | null {
  if (bytes.byteLength > MP4_MAX_FILE_BYTES)
    throw new Damaged('file-too-large', 'file exceeds 512 MiB');
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null;
  const top = boxes(bytes, 0, bytes.length, true);
  const own = top.filter((b) => b.type === 'uuid' && ascii(bytes, b.at + 8, 16) === KEY);
  if (own.length > 1) throw new Damaged('duplicate-metadata', 'more than one project box');
  return { top, project: own[0] ?? null, info: videoInfo(bytes, top) };
}

/** The MP4's video track facts, or null when the bytes are not an MP4. Throws a plain Error when malformed. */
export function mp4VideoInfo(bytes: Uint8Array): Mp4VideoInfo | null {
  try {
    return locate(bytes)?.info ?? null;
  } catch (error) {
    if (error instanceof Damaged) throw new Error(`malformed MP4: ${error.message}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Project values

export interface ProjectControl {
  readonly visitId: string;
  readonly latent: LatentTensor;
}

/** Morph settings as the project file names them (project-v1.fixture.json). */
export interface ProjectMorph {
  readonly algorithmVersion: string;
  readonly kind: MorphPathMode;
  readonly closed: boolean;
  readonly width: number;
  readonly pinchCenter: boolean;
  readonly framesPerSegment: number;
  readonly framesPerSecond: number;
  readonly controls: readonly ProjectControl[];
}

export interface Mp4ProjectInput {
  readonly descriptor: ModelDescriptor;
  readonly bundle?: { readonly version: string; readonly manifestSha256: string };
  readonly truncationPsi: number;
  readonly truncationCutoff: number;
  readonly morph: ProjectMorph;
  /** The encoder that produced the MP4 (videoFileResult). */
  readonly route: VideoFileResult;
}

export interface Mp4ProjectV2 {
  readonly schemaVersion: 2;
  readonly model: RecoveryModelRecord;
  readonly bundle?: { readonly version: string; readonly manifestSha256: string };
  readonly truncationPsi: number;
  readonly truncationCutoff: number;
  readonly morph: ProjectMorph;
  readonly video: VideoFileResult & { readonly frameCount: number };
  readonly videoSha256: string;
}

/** The candidate's project, structurally checked; latents keep the shape they were written with. */
export interface Mp4ProjectV1 {
  readonly schemaVersion: 1;
  readonly bundle: { readonly version: string; readonly manifestSha256: string };
  readonly modelSha256: string;
  readonly noiseSha256: string;
  readonly truncationPsi: number;
  readonly truncationCutoff: number;
  readonly morph: Omit<ProjectMorph, 'controls'> & {
    readonly controls: readonly {
      readonly visitId: string;
      readonly latent: {
        readonly space: 'w-plus';
        readonly shape: readonly number[];
        readonly values: Float32Array;
      };
    }[];
  };
  /** The project JSON exactly as stored, for the app's own project codec (project-json.ts decode). */
  readonly text: string;
}

export type Mp4ProjectResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'damaged'; readonly reason: Mp4Damage; readonly detail: string }
  | { readonly kind: 'incompatible-schema'; readonly schemaVersion: unknown }
  | {
      readonly kind: 'parsed';
      readonly project: Mp4ProjectV1 | Mp4ProjectV2;
      readonly video: Mp4VideoInfo;
      /** The MP4 without the project box (what videoSha256 covers). */
      readonly baseVideo: Uint8Array;
    };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (detail: string): never => {
  throw new Damaged('invalid-fields', detail);
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      B64[n >> 18]! +
      B64[(n >> 12) & 63]! +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') +
      (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}
function unbase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = text[i + k]!;
      const value = c === '=' && i + 4 === text.length && k >= 4 - pad ? 0 : B64_INDEX.get(c);
      if (value === undefined) return null;
      n = (n << 6) | value;
    }
    for (let k = 0; k < 3 && o < out.length; k++) out[o++] = (n >> (16 - 8 * k)) & 255;
  }
  return out;
}
const f32Bytes = (values: Float32Array): Uint8Array => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return out;
};

function utf8Text(bytes: Uint8Array): string | null {
  // TextDecoder is a platform global outside ES2024; decode strictly by hand, as the still reader does.
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const n =
      b < 0x80
        ? 0
        : b >= 0xc2 && b < 0xe0
          ? 1
          : b >= 0xe0 && b < 0xf0
            ? 2
            : b >= 0xf0 && b < 0xf5
              ? 3
              : -1;
    if (n < 0) return null;
    let cp = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (
      (n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000))) ||
      (n === 3 && (cp < 0x10000 || cp > 0x10ffff))
    )
      return null;
    text += String.fromCodePoint(cp);
    i += n + 1;
  }
  return text;
}

/** Settings checks shared by both schemas (the candidate's bounds: last-result.mjs, project-json.schema.ts). */
function morphSettings(m: Record<string, unknown>): Omit<ProjectMorph, 'controls'> {
  const { algorithmVersion, kind, closed, width, pinchCenter, framesPerSegment, framesPerSecond } =
    m;
  if (
    typeof algorithmVersion !== 'string' ||
    algorithmVersion.length < 1 ||
    algorithmVersion.length > 128
  )
    bad('morph.algorithmVersion');
  if (!MORPH_PATH_MODES.includes(kind as MorphPathMode)) bad('morph.kind');
  if (typeof closed !== 'boolean') bad('morph.closed');
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > 1.2)
    bad('morph.width');
  if (typeof pinchCenter !== 'boolean') bad('morph.pinchCenter');
  if (
    !Number.isSafeInteger(framesPerSegment) ||
    (framesPerSegment as number) < 1 ||
    (framesPerSegment as number) > MAX_MORPH_FRAMES
  )
    bad('morph.framesPerSegment');
  if (
    !Number.isSafeInteger(framesPerSecond) ||
    (framesPerSecond as number) < 1 ||
    (framesPerSecond as number) > 120
  )
    bad('morph.framesPerSecond');
  return {
    algorithmVersion: algorithmVersion as string,
    kind: kind as MorphPathMode,
    closed: closed as boolean,
    width: width as number,
    pinchCenter: pinchCenter as boolean,
    framesPerSegment: framesPerSegment as number,
    framesPerSecond: framesPerSecond as number,
  };
}

function controlsList(v: unknown): unknown[] {
  // At least two controls and no fixed count (fm-id4c): the payload byte bound limits a project.
  if (!Array.isArray(v) || v.length < 2) bad('morph.controls');
  return v as unknown[];
}
const visitId = (c: Record<string, unknown>, i: number): string => {
  if (typeof c.visitId !== 'string' || c.visitId.length < 1 || c.visitId.length > 128)
    bad(`morph.controls[${i}].visitId`);
  return c.visitId as string;
};

function readV1(record: Record<string, unknown>, text: string): Mp4ProjectV1 {
  const { bundle, modelSha256, noiseSha256, truncationPsi, truncationCutoff, morph } = record;
  if (
    !isRecord(bundle) ||
    typeof bundle.version !== 'string' ||
    typeof bundle.manifestSha256 !== 'string'
  )
    bad('bundle');
  if (typeof modelSha256 !== 'string' || !HEX64.test(modelSha256)) bad('modelSha256');
  if (typeof noiseSha256 !== 'string' || !HEX64.test(noiseSha256)) bad('noiseSha256');
  if (typeof truncationPsi !== 'number' || !Number.isFinite(truncationPsi)) bad('truncationPsi');
  if (!Number.isSafeInteger(truncationCutoff) || (truncationCutoff as number) < 0)
    bad('truncationCutoff');
  if (!isRecord(morph)) return bad('morph');
  const settings = morphSettings(morph);
  const controls = controlsList(morph.controls).map((c, i) => {
    if (!isRecord(c) || !isRecord(c.latent)) return bad(`morph.controls[${i}]`);
    const l = c.latent;
    const shape = l.shape;
    if (
      l.space !== 'w-plus' ||
      !Array.isArray(shape) ||
      shape.length < 1 ||
      shape.length > 3 ||
      !shape.every((n) => Number.isSafeInteger(n) && n > 0) ||
      !Array.isArray(l.values) ||
      l.values.length !== shape.reduce((a: number, b: number) => a * b, 1) ||
      !l.values.every((x) => typeof x === 'number' && Number.isFinite(x))
    )
      return bad(`morph.controls[${i}].latent`);
    const values = Float32Array.from(l.values as number[]);
    return {
      visitId: visitId(c, i),
      latent: { space: 'w-plus' as const, shape: Object.freeze([...(shape as number[])]), values },
    };
  });
  const b = bundle as { version: string; manifestSha256: string };
  return {
    schemaVersion: 1,
    bundle: { version: b.version, manifestSha256: b.manifestSha256 },
    modelSha256: modelSha256 as string,
    noiseSha256: noiseSha256 as string,
    truncationPsi: truncationPsi as number,
    truncationCutoff: truncationCutoff as number,
    morph: { ...settings, controls },
    text,
  };
}

const V2_FIELDS = new Set([
  'schemaVersion',
  'kind',
  'model',
  'bundle',
  'truncationPsi',
  'truncationCutoff',
  'morph',
  'video',
  'videoSha256',
]);

function readV2(
  record: Record<string, unknown>,
  info: Mp4VideoInfo,
  base: Uint8Array,
): Mp4ProjectV2 {
  for (const k of Object.keys(record)) if (!V2_FIELDS.has(k)) bad(`unknown field ${k}`);
  if (record.kind !== MP4_PROJECT_KIND) bad('kind');
  const model = validateModelRecord(record.model);
  if (!model.ok) return bad(model.error);
  const { bundle, truncationPsi, truncationCutoff, morph, video, videoSha256 } = record;
  if (
    bundle !== undefined &&
    (!isRecord(bundle) ||
      typeof bundle.version !== 'string' ||
      typeof bundle.manifestSha256 !== 'string')
  )
    bad('bundle');
  if (typeof truncationPsi !== 'number' || !Number.isFinite(truncationPsi)) bad('truncationPsi');
  if (!Number.isSafeInteger(truncationCutoff) || (truncationCutoff as number) < 0)
    bad('truncationCutoff');
  if (!isRecord(morph)) return bad('morph');
  const settings = morphSettings(morph);
  const { layers, width } = model.value.latent;
  const controls = controlsList(morph.controls).map((c, i): ProjectControl => {
    if (!isRecord(c) || !isRecord(c.latent)) return bad(`morph.controls[${i}]`);
    const l = c.latent;
    const shape = l.shape;
    if (
      l.space !== 'w-plus' ||
      l.encoding !== 'float32-le-base64' ||
      typeof l.data !== 'string' ||
      typeof l.sha256 !== 'string' ||
      !Array.isArray(shape) ||
      shape.length !== 2 ||
      shape[0] !== layers ||
      shape[1] !== width
    )
      return bad(`morph.controls[${i}].latent (its shape must be the model record's)`);
    const raw = unbase64(l.data);
    if (!raw || raw.length !== layers * width * 4) return bad(`morph.controls[${i}].latent bytes`);
    if (sha256Hex(raw) !== l.sha256)
      throw new Damaged('integrity', `control ${i} latent integrity hash mismatch`);
    const values = new Float32Array(layers * width);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let k = 0; k < values.length; k++) {
      values[k] = view.getFloat32(k * 4, true);
      if (!Number.isFinite(values[k])) bad(`morph.controls[${i}] non-finite latent value`);
    }
    return { visitId: visitId(c, i), latent: { space: 'w-plus', shape: [layers, width], values } };
  });
  if (
    !isRecord(video) ||
    (video.route !== 'webcodecs' && video.route !== 'ffmpeg') ||
    typeof video.reason !== 'string' ||
    ![
      'webcodecs-full-size',
      'webcodecs-fallback-size',
      'webcodecs-unavailable',
      'webcodecs-unsupported',
    ].includes(video.reason) ||
    !Number.isSafeInteger(video.width) ||
    !Number.isSafeInteger(video.height) ||
    !Number.isSafeInteger(video.frameCount)
  )
    bad('video');
  const vid = video as Record<string, number | string>;
  if (vid.width !== info.width || vid.height !== info.height || vid.frameCount !== info.frameCount)
    throw new Damaged(
      'video-mismatch',
      'the recorded video size or frame count differs from the MP4',
    );
  if (typeof videoSha256 !== 'string' || !HEX64.test(videoSha256)) bad('videoSha256');
  if (sha256Hex(base) !== videoSha256)
    throw new Damaged(
      'integrity',
      'video integrity hash mismatch (the project belongs to another file)',
    );
  const b = bundle as { version: string; manifestSha256: string } | undefined;
  return {
    schemaVersion: 2,
    model: model.value,
    ...(b === undefined
      ? {}
      : { bundle: { version: b.version, manifestSha256: b.manifestSha256 } }),
    truncationPsi: truncationPsi as number,
    truncationCutoff: truncationCutoff as number,
    morph: { ...settings, controls },
    video: {
      width: vid.width as number,
      height: vid.height as number,
      frameCount: vid.frameCount as number,
      route: vid.route as VideoRoute,
      reason: vid.reason as VideoRouteReason,
    },
    videoSha256: videoSha256 as string,
  };
}

function withoutBox(bytes: Uint8Array, b: Box): Uint8Array {
  const out = new Uint8Array(bytes.length - (b.end - b.at));
  out.set(bytes.subarray(0, b.at));
  out.set(bytes.subarray(b.end), b.at);
  return out;
}

function read(bytes: Uint8Array): Mp4ProjectResult {
  const located = locate(bytes);
  if (!located || !located.project) return { kind: 'missing' };
  const { project: box, info } = located;
  const payload = bytes.subarray(box.body, box.end);
  if (payload.length > MP4_PROJECT_MAX_PAYLOAD_BYTES)
    throw new Damaged('metadata-too-large', 'project metadata exceeds 16 MiB');
  const text = utf8Text(payload);
  let record: unknown;
  try {
    record = text === null ? undefined : JSON.parse(text);
  } catch {
    record = undefined;
  }
  if (!isRecord(record))
    throw new Damaged('unreadable-json', 'project metadata is not a JSON object');
  const base = withoutBox(bytes, box);
  if (record.schemaVersion === 1)
    return { kind: 'parsed', project: readV1(record, text!), video: info, baseVideo: base };
  if (record.schemaVersion === MP4_PROJECT_SCHEMA)
    return { kind: 'parsed', project: readV2(record, info, base), video: info, baseVideo: base };
  return { kind: 'incompatible-schema', schemaVersion: record.schemaVersion };
}

/**
 * Reads a saved MP4's project (schema 2, or the candidate's schema 1) and checks it against the movie. Never
 * throws: a truncated file, a damaged or copied project and an unknown version are typed results.
 */
export function readMp4Project(bytes: Uint8Array): Mp4ProjectResult {
  try {
    return read(bytes);
  } catch (error) {
    if (error instanceof Damaged)
      return { kind: 'damaged', reason: error.reason, detail: error.message };
    throw error;
  }
}

/**
 * The MP4 with a fresh schema-2 project box appended. An existing project box is replaced only when it is the
 * last box (removing an earlier one would move the media data its chunk offsets point at); a damaged file is
 * refused. The video's size and frame count are read from the movie and must match `input.route`.
 */
export function embedMp4Project(mp4: Uint8Array, input: Mp4ProjectInput): Uint8Array {
  let located: Located | null;
  try {
    located = locate(mp4);
  } catch (error) {
    if (error instanceof Damaged)
      throw new Error(`The MP4 is damaged (${error.message}); no project is written.`);
    throw error;
  }
  if (!located) throw new Error('Project metadata needs an MP4 file.');
  let base = mp4;
  if (located.project) {
    if (located.project !== located.top.at(-1))
      throw new Error('The MP4 carries a project box before its end; it is not replaced.');
    base = withoutBox(mp4, located.project);
  }
  const { descriptor, morph, route } = input;
  const { info } = located;
  if (info.width !== route.width || info.height !== route.height)
    throw new Error(
      `The MP4 is ${info.width} x ${info.height}, not the reported ${route.width} x ${route.height}.`,
    );
  try {
    morphSettings(morph as unknown as Record<string, unknown>);
    controlsList(morph.controls);
  } catch (error) {
    if (error instanceof Damaged) throw new Error(`Invalid morph settings (${error.message}).`);
    throw error;
  }
  const controls = morph.controls.map((c, i) => {
    if (c.latent.space !== 'w-plus' || !latentFitsDescriptor(c.latent, descriptor))
      throw new Error(
        `Control ${i} must be ${descriptor.latent.layers} x ${descriptor.latent.width} W+.`,
      );
    if (typeof c.visitId !== 'string' || c.visitId.length < 1 || c.visitId.length > 128)
      throw new Error(`Control ${i} needs a visit id.`);
    if (!c.latent.values.every(Number.isFinite))
      throw new Error(`Control ${i} has a non-finite value.`);
    const raw = f32Bytes(c.latent.values);
    return {
      visitId: c.visitId,
      latent: {
        space: 'w-plus',
        shape: [c.latent.shape[0], c.latent.shape[1]],
        encoding: 'float32-le-base64',
        data: base64(raw),
        sha256: sha256Hex(raw),
      },
    };
  });
  if (
    !Number.isFinite(input.truncationPsi) ||
    !Number.isSafeInteger(input.truncationCutoff) ||
    input.truncationCutoff < 0
  )
    throw new Error('Invalid truncation.');
  const record = {
    schemaVersion: MP4_PROJECT_SCHEMA,
    kind: MP4_PROJECT_KIND,
    model: modelRecord(descriptor),
    ...(input.bundle === undefined
      ? {}
      : { bundle: { version: input.bundle.version, manifestSha256: input.bundle.manifestSha256 } }),
    truncationPsi: input.truncationPsi,
    truncationCutoff: input.truncationCutoff,
    morph: {
      algorithmVersion: morph.algorithmVersion,
      kind: morph.kind,
      closed: morph.closed,
      width: morph.width,
      pinchCenter: morph.pinchCenter,
      framesPerSegment: morph.framesPerSegment,
      framesPerSecond: morph.framesPerSecond,
      controls,
    },
    video: {
      width: info.width,
      height: info.height,
      frameCount: info.frameCount,
      route: route.route,
      reason: route.reason,
    },
    videoSha256: sha256Hex(base),
  };
  const json = utf8Bytes(JSON.stringify(record));
  if (json.length > MP4_PROJECT_MAX_PAYLOAD_BYTES)
    throw new Error('Project recovery metadata exceeds its limit.');
  const out = new Uint8Array(base.length + 24 + json.length);
  out.set(base);
  const view = new DataView(out.buffer);
  view.setUint32(base.length, 24 + json.length);
  for (let i = 0; i < 4; i++) out[base.length + 4 + i] = 'uuid'.charCodeAt(i);
  for (let i = 0; i < 16; i++) out[base.length + 8 + i] = KEY.charCodeAt(i);
  out.set(json, base.length + 24);
  return out;
}

/** Format help for MP4 (deferred project-open UI). */
export const MP4_FORMAT_HELP =
  'Video; reopening this file as a project is not available in this release.';
