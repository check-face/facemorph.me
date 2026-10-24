// Recovery-metadata reader: the exact W+ latent and provenance a FaceMorph still image carries.
//
// Survey (classic a42829b image-envelope.mjs): a PNG carries one `tEXt` chunk keyed "FaceMorph\0",
// a WebP one "FMRP" chunk; the JSON record (schema 2, kind facemorph-image-v2, at most 128 KiB)
// holds the latent as float32-le-base64 with SHA-256 integrity hashes of the latent bytes and of the
// image without its envelope; files are at most 64 MiB. Schema 1 PNGs belong to the app's legacy
// reader and come back as incompatible-schema. Comparing the provenance with the loaded model is the
// app's job, and the reader never fetches a URL found in metadata. The latent shape comes from the
// record's own `latent.shape`, bounded, rather than a hard-coded 18x512.

import { sha256Hex } from './sha256.ts';

export const RECOVERY_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const RECOVERY_MAX_METADATA_BYTES = 128 * 1024;
export const RECOVERY_MAX_CHUNKS = 4096;
/** Largest latent the reader accepts (values), well above W+ 18x512 and inside the metadata bound. */
export const RECOVERY_MAX_LATENT_VALUES = 24 * 1024;
export const RECOVERY_SCHEMA_VERSION = 2;

export type RecoveryImageMime = 'image/png' | 'image/webp';
export type GenerationKind = 'seed' | 'photo' | 'latent';

/** Provenance keys the envelope may carry (never a source photo or input string). */
export const RECOVERY_PROVENANCE_KEYS = [
  'bundleVersion',
  'manifestSha256',
  'modelSha256',
  'noiseSha256',
  'provider',
  'mappingProvider',
  'route',
  'truncationPsi',
  'truncationCutoff',
  'createdAt',
] as const;
export type RecoveryProvenance = { readonly modelSha256: string; readonly noiseSha256: string } & {
  readonly [K in (typeof RECOVERY_PROVENANCE_KEYS)[number]]?: string | number;
};

export interface RecoveryLatent {
  readonly space: 'w-plus';
  /** [layers, width], from the record. */
  readonly shape: readonly [number, number];
  readonly values: Float32Array;
}

/** The reader's contract version 1 of a parsed record (envelope schema 2). */
export interface RecoveryMetadataV1 {
  readonly schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  readonly mime: RecoveryImageMime;
  readonly width: number;
  readonly height: number;
  readonly generationKind: GenerationKind;
  readonly generationSha256: string;
  readonly provenance: RecoveryProvenance;
  readonly imageSha256: string;
  readonly latentSha256: string;
  readonly latent: RecoveryLatent;
  readonly seed?: number;
  /** The image bytes without the envelope chunk (what `imageSha256` covers). */
  readonly baseImage: Uint8Array;
}

export type RecoveryDamage =
  | 'file-too-large'
  | 'container'
  | 'duplicate-metadata'
  | 'checksum'
  | 'metadata-too-large'
  | 'unreadable-json'
  | 'invalid-fields'
  | 'dimensions'
  | 'integrity';

export type RecoveryReadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'damaged'; readonly reason: RecoveryDamage; readonly detail: string }
  | { readonly kind: 'incompatible-schema'; readonly schemaVersion: unknown }
  | { readonly kind: 'parsed'; readonly metadata: RecoveryMetadataV1 };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_KEY = 'FaceMorph';
const WEBP_KEY = 'FMRP';
const HEX64 = /^[0-9a-f]{64}$/;

class Damaged extends Error {
  readonly reason: RecoveryDamage;
  constructor(reason: RecoveryDamage, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

interface Part {
  readonly at: number;
  readonly end: number;
  readonly type: string;
  readonly data: Uint8Array;
  readonly own: boolean;
}

const ascii = (bytes: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + n));

function crc32(bytes: Uint8Array): number {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}

/** The container's chunks and pixel size, null for a format that cannot carry recovery metadata. */
function structure(
  bytes: Uint8Array,
): { mime: RecoveryImageMime; parts: Part[]; width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Part[] = [];
  if (bytes.length >= 20 && PNG_SIGNATURE.every((x, i) => bytes[i] === x)) {
    let at = 8;
    let ended = false;
    while (at + 12 <= bytes.length) {
      if (parts.length >= RECOVERY_MAX_CHUNKS)
        throw new Damaged('container', 'too many PNG chunks');
      const size = v.getUint32(at);
      if (size > bytes.length - at - 12) throw new Damaged('container', 'truncated PNG chunk');
      const type = ascii(bytes, at + 4, 4);
      const end = at + size + 12;
      const data = bytes.subarray(at + 8, end - 4);
      if (parts.length === 0 && (type !== 'IHDR' || size !== 13))
        throw new Damaged('container', 'invalid PNG header');
      const own = type === 'tEXt' && ascii(data, 0, PNG_KEY.length + 1) === PNG_KEY + '\0';
      if (own && crc32(bytes.subarray(at + 4, end - 4)) !== v.getUint32(end - 4)) {
        throw new Damaged('checksum', 'recovery chunk CRC mismatch');
      }
      parts.push({ at, end, type, data, own });
      at = end;
      if (type === 'IEND') {
        if (size !== 0 || at !== bytes.length) throw new Damaged('container', 'data after PNG end');
        ended = true;
        break;
      }
    }
    if (!ended) throw new Damaged('container', 'missing PNG end');
    return { mime: 'image/png', parts, width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    if (v.getUint32(4, true) !== bytes.length - 8)
      throw new Damaged('container', 'invalid WebP container length');
    let at = 12;
    while (at < bytes.length) {
      if (parts.length >= RECOVERY_MAX_CHUNKS || at + 8 > bytes.length)
        throw new Damaged('container', 'invalid WebP chunks');
      const size = v.getUint32(at + 4, true);
      const end = at + 8 + size + (size & 1);
      if (end > bytes.length) throw new Damaged('container', 'truncated WebP chunk');
      const type = ascii(bytes, at, 4);
      parts.push({
        at,
        end,
        type,
        data: bytes.subarray(at + 8, at + 8 + size),
        own: type === WEBP_KEY,
      });
      at = end;
    }
    if (parts.some((p) => p.type === 'ANIM' || p.type === 'ANMF'))
      throw new Damaged('container', 'animated WebP');
    const image = parts.find((p) => p.type === 'VP8 ' || p.type === 'VP8L');
    if (!image) throw new Damaged('container', 'WebP has no image');
    const d = image.data;
    if (image.type === 'VP8 ') {
      if (d.length < 10 || d[3] !== 0x9d || d[4] !== 1 || d[5] !== 0x2a)
        throw new Damaged('container', 'invalid WebP image header');
      const iv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      return {
        mime: 'image/webp',
        parts,
        width: iv.getUint16(6, true) & 16383,
        height: iv.getUint16(8, true) & 16383,
      };
    }
    if (d.length < 5 || d[0] !== 0x2f)
      throw new Damaged('container', 'invalid lossless WebP header');
    const width = 1 + d[1]! + ((d[2]! & 63) << 8);
    const height = 1 + (d[2]! >> 6) + (d[3]! << 2) + ((d[4]! & 15) << 10);
    return { mime: 'image/webp', parts, width, height };
  }
  return null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Strict padded base64 (no whitespace), as the envelope writes it. */
function base64Bytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = text[i + k]!;
      const last = i + 4 === text.length;
      const value = c === '=' && last && k >= 4 - pad ? 0 : B64_INDEX.get(c);
      if (value === undefined) return null;
      n = (n << 6) | value;
    }
    for (let k = 0; k < 3 && o < out.length; k++) out[o++] = (n >> (16 - 8 * k)) & 255;
  }
  return out;
}

function utf8Text(bytes: Uint8Array): string | null {
  // Strict UTF-8 decode without TextDecoder (a platform global outside ES2024).
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fields(
  record: Record<string, unknown>,
  mime: RecoveryImageMime,
): Omit<RecoveryMetadataV1, 'latent' | 'baseImage'> & {
  latentData: string;
  shape: [number, number];
} {
  const bad = (detail: string): never => {
    throw new Damaged('invalid-fields', detail);
  };
  const {
    kind,
    generationKind,
    generationSha256,
    provenance,
    width,
    height,
    imageSha256,
    latentSha256,
    latent,
    seed,
  } = record;
  if (kind !== 'facemorph-image-v2') bad('kind');
  if (record.mime !== mime) bad('mime differs from the container');
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1
  )
    bad('width/height');
  if (generationKind !== 'seed' && generationKind !== 'photo' && generationKind !== 'latent')
    bad('generationKind');
  if (typeof generationSha256 !== 'string' || !HEX64.test(generationSha256))
    bad('generationSha256');
  if (
    !isRecord(provenance) ||
    typeof provenance.modelSha256 !== 'string' ||
    !HEX64.test(provenance.modelSha256) ||
    typeof provenance.noiseSha256 !== 'string' ||
    !HEX64.test(provenance.noiseSha256)
  ) {
    bad('provenance model/noise hashes');
  }
  const keys = new Set<string>(RECOVERY_PROVENANCE_KEYS);
  for (const [k, value] of Object.entries(provenance as Record<string, unknown>)) {
    if (!keys.has(k) || (typeof value !== 'string' && typeof value !== 'number'))
      bad(`provenance field ${k}`);
  }
  if (
    seed !== undefined &&
    (!Number.isSafeInteger(seed) || (seed as number) < 0 || (seed as number) > 4294967295)
  )
    bad('seed');
  if (
    typeof imageSha256 !== 'string' ||
    !HEX64.test(imageSha256) ||
    typeof latentSha256 !== 'string' ||
    !HEX64.test(latentSha256)
  )
    bad('integrity hashes');
  if (
    !isRecord(latent) ||
    latent.space !== 'w-plus' ||
    latent.encoding !== 'float32-le-base64' ||
    typeof latent.data !== 'string'
  )
    bad('latent');
  const l = latent as Record<string, unknown>;
  const shape = l.shape;
  if (
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    !shape.every((n) => Number.isSafeInteger(n) && n > 0) ||
    shape[0] * shape[1] > RECOVERY_MAX_LATENT_VALUES
  ) {
    bad('latent shape');
  }
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    mime,
    width: width as number,
    height: height as number,
    generationKind: generationKind as GenerationKind,
    generationSha256: generationSha256 as string,
    provenance: Object.freeze({ ...(provenance as RecoveryProvenance) }),
    imageSha256: imageSha256 as string,
    latentSha256: latentSha256 as string,
    ...(seed === undefined ? {} : { seed: seed as number }),
    latentData: l.data as string,
    shape: [(shape as number[])[0]!, (shape as number[])[1]!],
  };
}

function read(bytes: Uint8Array): RecoveryReadResult {
  if (bytes.byteLength > RECOVERY_MAX_FILE_BYTES)
    throw new Damaged('file-too-large', 'file exceeds 64 MiB');
  const parsed = structure(bytes);
  if (!parsed) return { kind: 'missing' };
  const own = parsed.parts.filter((p) => p.own);
  if (own.length === 0) return { kind: 'missing' };
  if (own.length > 1) throw new Damaged('duplicate-metadata', 'more than one recovery chunk');
  const part = own[0]!;
  const base = new Uint8Array(bytes.length - (part.end - part.at));
  base.set(bytes.subarray(0, part.at));
  base.set(bytes.subarray(part.end), part.at);
  if (parsed.mime === 'image/webp') new DataView(base.buffer).setUint32(4, base.length - 8, true);
  const payload = parsed.mime === 'image/png' ? part.data.subarray(PNG_KEY.length + 1) : part.data;
  if (payload.length > RECOVERY_MAX_METADATA_BYTES)
    throw new Damaged('metadata-too-large', 'metadata exceeds 128 KiB');
  const text = utf8Text(payload);
  let record: unknown;
  try {
    record = text === null ? undefined : JSON.parse(text);
  } catch {
    record = undefined;
  }
  if (!isRecord(record)) throw new Damaged('unreadable-json', 'metadata is not a JSON object');
  if (record.schema !== RECOVERY_SCHEMA_VERSION)
    return { kind: 'incompatible-schema', schemaVersion: record.schema };
  const f = fields(record, parsed.mime);
  if (parsed.width !== f.width || parsed.height !== f.height)
    throw new Damaged('dimensions', 'recorded size differs from the image');
  const raw = base64Bytes(f.latentData);
  if (!raw || raw.length !== f.shape[0] * f.shape[1] * 4)
    throw new Damaged('invalid-fields', 'latent bytes do not match its shape');
  if (sha256Hex(base) !== f.imageSha256 || sha256Hex(raw) !== f.latentSha256)
    throw new Damaged('integrity', 'image or latent integrity hash mismatch');
  const values = new Float32Array(raw.length / 4);
  const rv = new DataView(raw.buffer);
  for (let i = 0; i < values.length; i++) {
    values[i] = rv.getFloat32(i * 4, true);
    if (!Number.isFinite(values[i])) throw new Damaged('invalid-fields', 'non-finite latent value');
  }
  const { latentData: _data, shape, ...metadata } = f;
  return {
    kind: 'parsed',
    metadata: { ...metadata, latent: { space: 'w-plus', shape, values }, baseImage: base },
  };
}

/** Reads a still image's recovery metadata. Never throws: every failure is a typed result. */
export function parseRecoveryMetadata(bytes: Uint8Array): RecoveryReadResult {
  try {
    return read(bytes);
  } catch (error) {
    if (error instanceof Damaged)
      return { kind: 'damaged', reason: error.reason, detail: error.message };
    throw error;
  }
}
