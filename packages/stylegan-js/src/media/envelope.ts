// Recovery envelopes on still images: write them on PNG and lossless WebP, read them back.
//
// Ported from the candidate (classic a42829b): image-envelope.mjs (schema 2, PNG tEXt "FaceMorph" / WebP
// "FMRP" chunk, float32-le-base64 W+, SHA-256 of image and latent), recovery-metadata.mjs (the schema-1 PNG
// reader: a JSON latent array) and browser/png.mjs (exact RGBA PNG, stored deflate by default). Changes,
// as the plan asks: the latent shape comes from the latent (not 18x512), the image size from the container,
// and re-encoding always regenerates the envelope over the actual new payload, never copying an old hash.
// The envelope holds only the latent and the model/provenance fields; never a source photo, typed words,
// a filename or diagnostics. Nothing here fetches anything, including URLs found in metadata.

import {
  RECOVERY_MAX_METADATA_BYTES,
  RECOVERY_PROVENANCE_KEYS,
  RECOVERY_SCHEMA_VERSION,
  locateRecoveryChunk,
  parseRecoveryMetadata,
  stillContainer,
  type GenerationKind,
  type RecoveryDamage,
  type RecoveryImageMime,
  type RecoveryLatent,
  type RecoveryProvenance,
} from '../contracts/recovery-metadata.ts';
import type { RecoveryMetadata } from '../contracts/operations.ts';
import { sha256Hex, utf8Bytes } from '../contracts/sha256.ts';
import { blendRecipeDigest } from '../blend/recipe.ts';
import { encodeVp8lWebp } from './webp-lossless.ts';
import {
  RECOVERY_SCHEMA_V3,
  RECOVERY_V3_KIND,
  RECOVERY_V3_MAX_METADATA_BYTES,
  checkRecoveryV3,
  recordV3Fields,
  validateBlendRecipe,
  validateModelRecord,
  type BlendRecipe,
  type RecoveryMetadataV3,
  type RecoveryModelRecord,
  type StillGenerationKind,
} from './recovery-v3.ts';

/** 8-bit RGBA, row-major, width * height * 4 bytes. */
export interface RgbaPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_EDGE = 16384;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let n = 0xffffffff;
  for (const b of bytes) n = CRC_TABLE[(n ^ b) & 255]! ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
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

function latentBytes(latent: RecoveryLatent): Uint8Array {
  const [layers, width] = latent.shape;
  if (
    !Number.isSafeInteger(layers) ||
    !Number.isSafeInteger(width) ||
    layers < 1 ||
    width < 1 ||
    latent.values.length !== layers * width
  ) {
    throw new Error('Recovery latent shape does not match its values.');
  }
  const out = new Uint8Array(latent.values.length * 4);
  const view = new DataView(out.buffer);
  latent.values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new Error('Recovery latent has a non-finite value.');
    view.setFloat32(i * 4, v, true);
  });
  return out;
}

function checkPixels({ width, height, rgba }: RgbaPixels): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('Pixels must be 8-bit RGBA with width * height * 4 bytes.');
  }
}

/** The image without any envelope it carries; a damaged envelope is refused rather than replaced. */
function envelopeBase(image: Uint8Array): {
  container: NonNullable<ReturnType<typeof stillContainer>>;
  base: Uint8Array;
} {
  let container: ReturnType<typeof stillContainer>;
  try {
    container = stillContainer(image);
  } catch {
    throw new Error('The image or its recovery metadata is damaged; it is not replaced.');
  }
  if (!container) throw new Error('Recovery metadata needs a PNG or WebP image.');
  let base = image;
  if (container.hasEnvelope) {
    const located = locateRecoveryChunk(image);
    if (located.kind !== 'located')
      throw new Error('The image carries damaged recovery metadata; it is not replaced.');
    base = located.chunk.baseImage;
  }
  return { container, base };
}

/** Places one JSON record as the envelope of `base` (an image with no envelope). */
function placeEnvelope(base: Uint8Array, mime: RecoveryImageMime, json: Uint8Array): Uint8Array {
  if (mime === 'image/png') {
    const chunk = pngChunk('tEXt', concat([ascii('FaceMorph\0'), json]));
    const iend = base.length - 12; // stillContainer checked that IEND ends the file
    return concat([base.subarray(0, iend), chunk, base.subarray(iend)]);
  }
  const chunk = new Uint8Array(8 + json.length + (json.length & 1));
  chunk.set(ascii('FMRP'));
  new DataView(chunk.buffer).setUint32(4, json.length, true);
  chunk.set(json, 8);
  const out = concat([base, chunk]);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/**
 * The image with a fresh schema-2 envelope for `recovery`: any envelope already present is removed first, and
 * the image and latent hashes are computed over this payload. A damaged existing envelope is refused rather
 * than replaced (its identity must not change silently). Works on any PNG or WebP payload, including the
 * app's lossy WebP. New exports use embedRecoveryV3; this writer stays for schema-2 compatibility.
 */
export function embedRecovery(image: Uint8Array, recovery: RecoveryMetadata): Uint8Array {
  const { container, base } = envelopeBase(image);
  const { generationKind, generationSha256, provenance, latent, seed } = recovery;
  if (!['seed', 'photo', 'latent'].includes(generationKind) || !HEX64.test(generationSha256))
    throw new Error('Invalid recovery generation identity.');
  if (!HEX64.test(provenance.modelSha256) || !HEX64.test(provenance.noiseSha256))
    throw new Error('Recovery provenance needs the model and noise digests.');
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295))
    throw new Error('Invalid recovery seed.');
  const raw = latentBytes(latent);
  // A field that does not apply (null in the bridge's provenance) is left out, as the reader requires.
  const kept = Object.fromEntries(
    RECOVERY_PROVENANCE_KEYS.filter((k) => provenance[k] != null).map((k) => [k, provenance[k]]),
  );
  const record = {
    schema: RECOVERY_SCHEMA_VERSION,
    kind: 'facemorph-image-v2',
    generationKind,
    generationSha256,
    provenance: kept,
    width: container.width,
    height: container.height,
    mime: container.mime,
    imageSha256: sha256Hex(base),
    latentSha256: sha256Hex(raw),
    latent: {
      space: 'w-plus',
      shape: [latent.shape[0], latent.shape[1]],
      encoding: 'float32-le-base64',
      data: base64(raw),
    },
    ...(seed === undefined ? {} : { seed }),
  };
  const json = utf8Bytes(JSON.stringify(record));
  if (json.length > RECOVERY_MAX_METADATA_BYTES)
    throw new Error('Recovery metadata exceeds its limit.');
  return placeEnvelope(base, container.mime, json);
}

/**
 * The image with a fresh schema-3 (dynamic-shape) envelope: the generator's identity and W+ shape come from
 * `recovery.descriptor`, the image must be the descriptor's full output frame, and a blend carries its recipe.
 * As embedRecovery, an existing envelope is replaced and the hashes cover this payload, never a copied one.
 */
export function embedRecoveryV3(image: Uint8Array, recovery: RecoveryMetadataV3): Uint8Array {
  const { container, base } = envelopeBase(image);
  checkRecoveryV3(recovery, container);
  if (recovery.blend !== undefined) {
    const digest = blendRecipeDigest(recovery.descriptor.identity.modelSha256, recovery.blend);
    if (digest !== recovery.generationSha256)
      throw new Error('A blend’s generation identity is its recipe digest.');
  }
  const raw = latentBytes(recovery.latent);
  const record = {
    ...recordV3Fields(recovery),
    width: container.width,
    height: container.height,
    mime: container.mime,
    imageSha256: sha256Hex(base),
    latentSha256: sha256Hex(raw),
    latent: {
      space: 'w-plus',
      shape: [recovery.latent.shape[0], recovery.latent.shape[1]],
      encoding: 'float32-le-base64',
      data: base64(raw),
    },
  };
  const json = utf8Bytes(JSON.stringify(record));
  if (json.length > RECOVERY_V3_MAX_METADATA_BYTES)
    throw new Error('Recovery metadata exceeds its limit.');
  return placeEnvelope(base, container.mime, json);
}

const embedAny = (image: Uint8Array, recovery: RecoveryMetadata | RecoveryMetadataV3) =>
  'descriptor' in recovery ? embedRecoveryV3(image, recovery) : embedRecovery(image, recovery);

type DeflateStream = { readonly readable: unknown; readonly writable: unknown };
type CompressionGlobal = {
  CompressionStream?: new (format: 'deflate') => DeflateStream;
  Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  Blob?: new (parts: unknown[]) => { stream(): { pipeThrough(t: DeflateStream): unknown } };
};

/** zlib stream of stored (uncompressed) deflate blocks: a few ms where the platform compressor took ~200. */
function storedDeflate(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out.set([0x78, 0x01]);
  let p = 2;
  let a = 1;
  let b = 0;
  for (let i = 0; i < blocks; i++) {
    const at = i * 65535;
    const n = Math.min(65535, data.length - at);
    out[p++] = i === blocks - 1 ? 1 : 0;
    out[p++] = n & 255;
    out[p++] = n >>> 8;
    out[p++] = ~n & 255;
    out[p++] = (~n >>> 8) & 255;
    out.set(data.subarray(at, at + n), p);
    p += n;
  }
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(out.buffer).setUint32(p, ((b << 16) | a) >>> 0);
  return out;
}

async function deflate(data: Uint8Array, compress: boolean): Promise<Uint8Array> {
  const g = globalThis as unknown as CompressionGlobal;
  if (!compress || !g.CompressionStream || !g.Response || !g.Blob) return storedDeflate(data);
  const stream = new g.Blob([data]).stream().pipeThrough(new g.CompressionStream('deflate'));
  return new Uint8Array(await new g.Response(stream).arrayBuffer());
}

/**
 * An exact 8-bit RGBA PNG (filter 0 rows) carrying the recovery envelope. Stored deflate blocks by default
 * (the candidate's measured choice); `compress` uses the platform's deflate where it has one.
 */
export async function encodePng(
  pixels: RgbaPixels,
  recovery: RecoveryMetadata | RecoveryMetadataV3,
  options: { readonly compress?: boolean } = {},
): Promise<Uint8Array> {
  checkPixels(pixels);
  const { width, height, rgba } = pixels;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const scan = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++)
    scan.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const png = concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', await deflate(scan, options.compress === true)),
    pngChunk('IEND', new Uint8Array()),
  ]);
  return embedAny(png, recovery);
}

/** A lossless WebP (VP8L) of exactly these pixels, carrying the recovery envelope. */
export function encodeLosslessWebp(
  pixels: RgbaPixels,
  recovery: RecoveryMetadata | RecoveryMetadataV3,
): Uint8Array {
  checkPixels(pixels);
  return embedAny(encodeVp8lWebp(pixels.rgba, pixels.width, pixels.height), recovery);
}

/** A still's recovered values, from a schema-3 or schema-2 envelope or the candidate's schema-1 PNG. */
export interface RecoveredStill {
  readonly schemaVersion: 1 | 2 | 3;
  readonly mime: RecoveryImageMime;
  readonly width: number;
  readonly height: number;
  /** Schema 1 may omit the generation identity; only schema 3 has `blend`. */
  readonly generationKind?: StillGenerationKind;
  readonly generationSha256?: string;
  readonly provenance: RecoveryProvenance;
  readonly latent: RecoveryLatent;
  readonly seed?: number;
  /** Schema 3: the generator the latent belongs to, from its descriptor. */
  readonly model?: RecoveryModelRecord;
  /** Schema 3 blends: each slot's kind, latent digest and weight. */
  readonly blend?: BlendRecipe;
  readonly imageSha256: string;
  readonly latentSha256: string;
  /** The image without its envelope (what imageSha256 covers). */
  readonly baseImage: Uint8Array;
}

export type StillRecoveryResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'damaged'; readonly reason: RecoveryDamage; readonly detail: string }
  | { readonly kind: 'incompatible-schema'; readonly schemaVersion: unknown }
  | { readonly kind: 'parsed'; readonly recovered: RecoveredStill };

/** The schema-1 record (recovery-metadata.mjs decorateImage): PNG only, latent values as a JSON array. */
function readSchema1(bytes: Uint8Array): StillRecoveryResult | null {
  const located = locateRecoveryChunk(bytes);
  if (located.kind !== 'located' || located.chunk.record.schema !== 1) return null;
  const { record, mime, width, height, baseImage } = located.chunk;
  const damaged = (detail: string): StillRecoveryResult => ({
    kind: 'damaged',
    reason: 'invalid-fields',
    detail,
  });
  if (mime !== 'image/png' || record.kind !== 'facemorph-image-v1')
    return damaged('schema 1 is a PNG facemorph-image-v1 record');
  const latent = record.latent as
    | { space?: unknown; shape?: unknown; values?: unknown }
    | undefined;
  const shape = latent?.shape;
  if (
    !latent ||
    latent.space !== 'w-plus' ||
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    !shape.every((n) => Number.isSafeInteger(n) && n > 0)
  )
    return damaged('latent');
  const values = latent.values;
  if (
    !Array.isArray(values) ||
    values.length !== shape[0] * shape[1] ||
    !values.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    return damaged('latent values');
  const f32 = Float32Array.from(values as number[]);
  if (!f32.every((v, i) => v === values[i])) return damaged('latent values are not float32');
  const p = record.provenance as Record<string, unknown> | undefined;
  if (
    !p ||
    typeof p.modelSha256 !== 'string' ||
    !HEX64.test(p.modelSha256) ||
    typeof p.noiseSha256 !== 'string' ||
    !HEX64.test(p.noiseSha256)
  )
    return damaged('provenance model/noise hashes');
  const raw = new Uint8Array(f32.length * 4);
  f32.forEach((v, i) => new DataView(raw.buffer).setFloat32(i * 4, v, true));
  if (sha256Hex(baseImage) !== record.imageSha256 || sha256Hex(raw) !== record.latentSha256)
    return {
      kind: 'damaged',
      reason: 'integrity',
      detail: 'image or latent integrity hash mismatch',
    };
  const kind = record.generationKind;
  // The candidate's decorateImage wrote the seed as the bridge held it: a number, or the seed field's decimal text.
  const seed =
    typeof record.seed === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(record.seed)
      ? Number(record.seed)
      : record.seed;
  if (
    seed !== undefined &&
    (!Number.isSafeInteger(seed) || (seed as number) < 0 || (seed as number) > 4294967295)
  )
    return damaged('seed');
  if (kind !== undefined && kind !== 'seed' && kind !== 'photo' && kind !== 'latent')
    return damaged('generationKind');
  const gen = record.generationSha256;
  if (gen !== undefined && (typeof gen !== 'string' || !HEX64.test(gen)))
    return damaged('generationSha256');
  const provenance = Object.freeze(
    Object.fromEntries(
      RECOVERY_PROVENANCE_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
    ),
  ) as RecoveryProvenance;
  return {
    kind: 'parsed',
    recovered: {
      schemaVersion: 1,
      mime,
      width,
      height,
      ...(kind === undefined ? {} : { generationKind: kind as GenerationKind }),
      ...(gen === undefined ? {} : { generationSha256: gen as string }),
      provenance,
      latent: { space: 'w-plus', shape: [shape[0], shape[1]], values: f32 },
      ...(seed === undefined ? {} : { seed: seed as number }),
      imageSha256: record.imageSha256 as string,
      latentSha256: record.latentSha256 as string,
      baseImage,
    },
  };
}

const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Strict padded base64 (no whitespace), as the envelope writes it. */
function base64Decode(text: string): Uint8Array | null {
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

const V3_FIELDS = new Set([
  'schema',
  'kind',
  'generationKind',
  'generationSha256',
  'model',
  'provenance',
  'seed',
  'blend',
  'width',
  'height',
  'mime',
  'imageSha256',
  'latentSha256',
  'latent',
]);

/** The schema-3 record: every field validated, the shape from the model record, integrity over this payload. */
function readSchema3(bytes: Uint8Array): StillRecoveryResult | null {
  const located = locateRecoveryChunk(bytes);
  if (located.kind !== 'located' || located.chunk.record.schema !== RECOVERY_SCHEMA_V3) return null;
  const { record, mime, width, height, baseImage, payloadBytes } = located.chunk;
  const damaged = (reason: RecoveryDamage, detail: string): StillRecoveryResult => ({
    kind: 'damaged',
    reason,
    detail,
  });
  const bad = (detail: string) => damaged('invalid-fields', detail);
  if (payloadBytes > RECOVERY_V3_MAX_METADATA_BYTES)
    return damaged('metadata-too-large', 'metadata exceeds the schema-3 limit');
  for (const key of Object.keys(record))
    if (!V3_FIELDS.has(key)) return bad(`unknown field ${key}`);
  if (record.kind !== RECOVERY_V3_KIND) return bad('kind');
  if (record.mime !== mime) return bad('mime differs from the container');
  if (record.width !== width || record.height !== height)
    return damaged('dimensions', 'recorded size differs from the image');
  const kind = record.generationKind;
  if (kind !== 'seed' && kind !== 'photo' && kind !== 'latent' && kind !== 'blend')
    return bad('generationKind');
  const gen = record.generationSha256;
  if (typeof gen !== 'string' || !HEX64.test(gen)) return bad('generationSha256');
  const model = validateModelRecord(record.model);
  if (!model.ok) return bad(model.error);
  if (model.value.output.width !== width || model.value.output.height !== height)
    return damaged('dimensions', 'the image is not the model’s full output frame');
  const p = record.provenance;
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return bad('provenance');
  const prov = p as Record<string, unknown>;
  const keys = new Set<string>(RECOVERY_PROVENANCE_KEYS);
  for (const [k, value] of Object.entries(prov))
    if (!keys.has(k) || (typeof value !== 'string' && typeof value !== 'number'))
      return bad(`provenance field ${k}`);
  if (prov.modelSha256 !== model.value.modelSha256 || prov.noiseSha256 !== model.value.noiseSha256)
    return bad('provenance differs from the model record');
  const seed = record.seed;
  if (
    seed !== undefined &&
    (kind !== 'seed' ||
      !Number.isSafeInteger(seed) ||
      (seed as number) < 0 ||
      (seed as number) > 4294967295)
  )
    return bad('seed');
  let blend: BlendRecipe | undefined;
  if (kind === 'blend') {
    const r = validateBlendRecipe(record.blend);
    if (!r.ok) return bad(r.error);
    blend = r.value;
    if (blendRecipeDigest(model.value.modelSha256, blend) !== gen)
      return damaged('integrity', 'the blend recipe differs from its generation identity');
  } else if (record.blend !== undefined) return bad('blend on a non-blend still');
  const l = record.latent as Record<string, unknown> | undefined;
  const shape = l?.shape;
  if (
    typeof l !== 'object' ||
    l === null ||
    l.space !== 'w-plus' ||
    l.encoding !== 'float32-le-base64' ||
    typeof l.data !== 'string' ||
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    shape[0] !== model.value.latent.layers ||
    shape[1] !== model.value.latent.width
  )
    return bad('latent (its shape must be the model record’s)');
  const raw = base64Decode(l.data);
  if (!raw || raw.length !== model.value.latent.layers * model.value.latent.width * 4)
    return bad('latent bytes do not match its shape');
  const imageSha256 = record.imageSha256;
  const latentSha256 = record.latentSha256;
  if (
    typeof imageSha256 !== 'string' ||
    !HEX64.test(imageSha256) ||
    typeof latentSha256 !== 'string' ||
    !HEX64.test(latentSha256)
  )
    return bad('integrity hashes');
  if (sha256Hex(baseImage) !== imageSha256 || sha256Hex(raw) !== latentSha256)
    return damaged('integrity', 'image or latent integrity hash mismatch');
  const values = new Float32Array(raw.length / 4);
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < values.length; i++) {
    values[i] = rv.getFloat32(i * 4, true);
    if (!Number.isFinite(values[i])) return bad('non-finite latent value');
  }
  return {
    kind: 'parsed',
    recovered: {
      schemaVersion: 3,
      mime,
      width,
      height,
      generationKind: kind,
      generationSha256: gen,
      provenance: Object.freeze({ ...(prov as RecoveryProvenance) }),
      latent: { space: 'w-plus', shape: [shape[0], shape[1]], values },
      ...(seed === undefined ? {} : { seed: seed as number }),
      model: model.value,
      ...(blend === undefined ? {} : { blend }),
      imageSha256,
      latentSha256,
      baseImage,
    },
  };
}

/**
 * Reads a still's recovery metadata (schema 3 and 2 PNG/WebP, schema 1 PNG). Never throws, never fetches. Any
 * other version is `incompatible-schema` with the version it claims.
 */
export function readRecovery(bytes: Uint8Array): StillRecoveryResult {
  const r = parseRecoveryMetadata(bytes);
  if (r.kind === 'incompatible-schema' && r.schemaVersion === 1) return readSchema1(bytes) ?? r;
  if (r.kind === 'incompatible-schema' && r.schemaVersion === RECOVERY_SCHEMA_V3)
    return readSchema3(bytes) ?? r;
  if (r.kind !== 'parsed') return r;
  const { metadata } = r;
  return {
    kind: 'parsed',
    recovered: {
      schemaVersion: 2,
      mime: metadata.mime,
      width: metadata.width,
      height: metadata.height,
      generationKind: metadata.generationKind,
      generationSha256: metadata.generationSha256,
      provenance: metadata.provenance,
      latent: metadata.latent,
      ...(metadata.seed === undefined ? {} : { seed: metadata.seed }),
      imageSha256: metadata.imageSha256,
      latentSha256: metadata.latentSha256,
      baseImage: metadata.baseImage,
    },
  };
}
