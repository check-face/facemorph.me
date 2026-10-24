// Confirmed-crop preprocessing policy: the record created once when a person presses OK on the crop,
// and the single derivation from that record to the encoder's input tensor.
//
// Survey (classic a42829b): photo/crop.mjs owns the limits and the square crop in oriented source
// pixels (rotation a multiple of 90 degrees about the square's centre); photo/selection-worker.mjs
// normalises 256x256 8-bit RGB to float32 ((x/255 - 0.5) / 0.5), NCHW, the 196,608-value tensor
// that ort-worker.mjs requires. Detector alignment and warping only shape the proposal before
// confirmation: after it, nothing re-detects, re-warps or burns guides into the pixels.

import { canonicalJson } from './canonical-json.ts';
import { sha256Hex, utf8Bytes } from './sha256.ts';

/** Source file bytes accepted for cropping (photo/crop.mjs CROP_MAX_BYTES). */
export const CROP_MAX_BYTES = 64 * 1024 * 1024;
/** Decoded pixels refused before a decode is attempted (photo/crop.mjs CROP_MAX_PIXELS). */
export const CROP_MAX_PIXELS = 120 * 1024 * 1024;
/** Longest accepted source edge (photo/crop.mjs CROP_MAX_EDGE). */
export const CROP_MAX_EDGE = 20000;
/** Edge of the rendered square crop (photo/crop.mjs CROP_OUTPUT). */
export const CROP_OUTPUT = 1024;
/** Longest edge of the bounded preview decode (photo/crop.mjs PREVIEW_MAX_EDGE). */
export const PREVIEW_MAX_EDGE = 4096;
/**
 * Limits for one photo input. The candidate's 25 MB align-photo.mjs limit bounds only the detector
 * proposal; it never rejects a confirmed crop.
 */
export const SINGLE_INPUT_LIMITS = Object.freeze({
  CROP_MAX_BYTES,
  CROP_MAX_PIXELS,
  CROP_MAX_EDGE,
  CROP_OUTPUT,
  PREVIEW_MAX_EDGE,
});

export const ENCODER_INPUT_SIZE = 256;
/** [1, 3, 256, 256] float32 values (ort-worker.mjs checks exactly 196,608). */
export const ENCODER_INPUT_LENGTH = 3 * ENCODER_INPUT_SIZE * ENCODER_INPUT_SIZE;

export interface CropPreprocessingPolicyV1 {
  readonly version: 'crop-preprocessing-v1';
  /**
   * Pillow's BILINEAR resample (Image.resize, Pillow 12.3.0 libImaging/Resample.c), as the candidate's qualified
   * preprocessing ran it: a triangle filter widened by the downscale factor, 22-bit fixed-point coefficients,
   * a horizontal then a vertical pass, each rounded to 8 bits. Bit-exact with the candidate's fixtures.
   */
  readonly resize: 'pillow-bilinear';
  /** RGB channels of 8-bit sRGB RGBA source pixels; alpha is ignored; no colour management. */
  readonly colour: 'srgb-rgb-8bit-alpha-ignored';
  /** Each step rounded to float32, as photo/selection-worker.mjs does. */
  readonly normalisation: 'float32((x / 255 - 0.5) / 0.5)';
  readonly layout: 'nchw';
  readonly encoderInputSize: typeof ENCODER_INPUT_SIZE;
}

export const CROP_PREPROCESSING_POLICY_V1: CropPreprocessingPolicyV1 = Object.freeze({
  version: 'crop-preprocessing-v1',
  resize: 'pillow-bilinear',
  colour: 'srgb-rgb-8bit-alpha-ignored',
  normalisation: 'float32((x / 255 - 0.5) / 0.5)',
  layout: 'nchw',
  encoderInputSize: ENCODER_INPUT_SIZE,
});

export type RotationDegrees = 0 | 90 | 180 | 270;
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Integer rectangle in oriented source pixels. */
export interface CropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The eight recorded fields; `confirmedCropId` is derived from exactly these. */
export interface ConfirmedCropFields {
  readonly sourceRevision: number;
  /** SHA-256 (lowercase hex) of the source file's bytes. */
  readonly sourceDigest: string;
  readonly rect: CropRect;
  /** Clockwise, about the centre of the square crop. */
  readonly rotationDegrees: RotationDegrees;
  readonly exifOrientation: ExifOrientation;
  /** Whether `rect` is in EXIF-applied coordinates (the candidate policy is legacy-ignore-exif: false). */
  readonly exifApplied: boolean;
  readonly policyVersion: CropPreprocessingPolicyV1['version'];
  readonly policyParams: CropPreprocessingPolicyV1;
}

/**
 * Frozen at crop OK and never edited: Adjust Crop or Encode image makes a new record with a new
 * `sourceRevision`. `confirmedCropId` is SHA-256 over the canonical JSON of the eight fields and is
 * the cache, provenance and export-identity key.
 */
export interface ConfirmedCrop extends ConfirmedCropFields {
  readonly confirmedCropId: string;
}

export const CONFIRMED_CROP_FIELDS = [
  'sourceRevision',
  'sourceDigest',
  'rect',
  'rotationDegrees',
  'exifOrientation',
  'exifApplied',
  'policyVersion',
  'policyParams',
] as const satisfies readonly (keyof ConfirmedCropFields)[];

/** Properties the crop workstream proves against the real flow (fm-smdf owns those tests). */
export const CROP_POLICY_PROPERTIES = [
  'noRedetectAfterConfirm',
  'noRewarpAfterConfirm',
  'guidesNotBurned',
  'singleE4eAttemptPerConfirmedCrop',
  'detectionFailureNeverReopensCrop',
] as const;
export type CropPolicyProperty = (typeof CROP_POLICY_PROPERTIES)[number];

export type CropValidationCode =
  | 'not-an-object'
  | 'unexpected-field'
  | 'missing-field'
  | 'invalid-source-revision'
  | 'invalid-source-digest'
  | 'invalid-rect'
  | 'invalid-rotation'
  | 'invalid-exif-orientation'
  | 'invalid-exif-applied'
  | 'unknown-policy'
  | 'identity-mismatch';

export class CropValidationError extends Error {
  readonly code: CropValidationCode;
  constructor(code: CropValidationCode, message: string) {
    super(message);
    this.name = 'CropValidationError';
    this.code = code;
  }
}

export type CropDerivationCode =
  | 'invalid-source-pixels'
  | 'source-too-large'
  | 'rect-outside-source';

export class CropDerivationError extends Error {
  readonly code: CropDerivationCode;
  constructor(code: CropDerivationCode, message: string) {
    super(message);
    this.name = 'CropDerivationError';
    this.code = code;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

function checkFields(value: unknown, allowId: boolean): ConfirmedCropFields {
  if (!isRecord(value))
    throw new CropValidationError('not-an-object', 'a confirmed crop is an object');
  const allowed = new Set<string>([
    ...CONFIRMED_CROP_FIELDS,
    ...(allowId ? ['confirmedCropId'] : []),
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new CropValidationError('unexpected-field', `unexpected field ${key}`);
  }
  for (const key of CONFIRMED_CROP_FIELDS) {
    if (!(key in value)) throw new CropValidationError('missing-field', `missing field ${key}`);
  }
  const v = value as Record<(typeof CONFIRMED_CROP_FIELDS)[number], unknown>;
  if (!isInt(v.sourceRevision, 0)) {
    throw new CropValidationError(
      'invalid-source-revision',
      'sourceRevision is a non-negative integer',
    );
  }
  if (typeof v.sourceDigest !== 'string' || !HEX64.test(v.sourceDigest)) {
    throw new CropValidationError('invalid-source-digest', 'sourceDigest is lowercase hex SHA-256');
  }
  const r = v.rect;
  if (
    !isRecord(r) ||
    Object.keys(r).sort().join() !== 'height,left,top,width' ||
    !isInt(r.left, 0, CROP_MAX_EDGE - 1) ||
    !isInt(r.top, 0, CROP_MAX_EDGE - 1) ||
    !isInt(r.width, 1, CROP_MAX_EDGE) ||
    r.height !== r.width
  ) {
    throw new CropValidationError(
      'invalid-rect',
      'rect is an integer square {left, top, width, height}',
    );
  }
  if (![0, 90, 180, 270].includes(v.rotationDegrees as number)) {
    throw new CropValidationError('invalid-rotation', 'rotationDegrees is 0, 90, 180 or 270');
  }
  if (!isInt(v.exifOrientation, 1, 8)) {
    throw new CropValidationError('invalid-exif-orientation', 'exifOrientation is 1 to 8');
  }
  if (typeof v.exifApplied !== 'boolean') {
    throw new CropValidationError('invalid-exif-applied', 'exifApplied is a boolean');
  }
  if (
    v.policyVersion !== CROP_PREPROCESSING_POLICY_V1.version ||
    !isRecord(v.policyParams) ||
    canonicalJson(v.policyParams) !== canonicalJson(CROP_PREPROCESSING_POLICY_V1)
  ) {
    throw new CropValidationError(
      'unknown-policy',
      'only crop-preprocessing-v1 with its exact parameters',
    );
  }
  return value as unknown as ConfirmedCropFields;
}

/** SHA-256 over the canonical JSON of exactly the eight recorded fields. */
export function confirmedCropIdentity(fields: ConfirmedCropFields): string {
  const picked = Object.fromEntries(CONFIRMED_CROP_FIELDS.map((k) => [k, fields[k]]));
  return sha256Hex(utf8Bytes(canonicalJson(picked)));
}

function freeze(fields: ConfirmedCropFields, confirmedCropId: string): ConfirmedCrop {
  return Object.freeze({
    sourceRevision: fields.sourceRevision,
    sourceDigest: fields.sourceDigest,
    rect: Object.freeze({
      left: fields.rect.left,
      top: fields.rect.top,
      width: fields.rect.width,
      height: fields.rect.height,
    }),
    rotationDegrees: fields.rotationDegrees,
    exifOrientation: fields.exifOrientation,
    exifApplied: fields.exifApplied,
    policyVersion: fields.policyVersion,
    policyParams: CROP_PREPROCESSING_POLICY_V1,
    confirmedCropId,
  });
}

/** Creates the frozen record at crop OK; throws CropValidationError on any invalid field. */
export function createConfirmedCrop(fields: ConfirmedCropFields): ConfirmedCrop {
  const checked = checkFields(fields, false);
  return freeze(checked, confirmedCropIdentity(checked));
}

/** Validates a record from storage or a worker message, including its identity. */
export function validateConfirmedCrop(value: unknown): ConfirmedCrop {
  const checked = checkFields(value, true);
  const id = confirmedCropIdentity(checked);
  if ((value as { confirmedCropId?: unknown }).confirmedCropId !== id) {
    throw new CropValidationError(
      'identity-mismatch',
      'confirmedCropId does not match the recorded fields',
    );
  }
  return freeze(checked, id);
}

/**
 * Decoded source pixels as the file stores them (no EXIF orientation applied): 8-bit RGBA, row-major,
 * `width * height * 4` bytes. A crop with `exifApplied` is oriented before cropping; the candidate's
 * legacy-ignore-exif crops are not.
 */
export interface SourcePixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface EncoderInput {
  /** [1, 3, 256, 256] NCHW. */
  readonly tensor: Float32Array;
  /** SHA-256 of the tensor's little-endian float32 bytes. */
  readonly tensorDigest: string;
  readonly policyVersion: CropPreprocessingPolicyV1['version'];
}

const PRECISION_BITS = 32 - 8 - 2;

/** Pillow's bilinear coefficients for one axis, as fixed-point integers with their first input index. */
function bilinearCoefficients(inSize: number, outSize: number): { start: number; k: Int32Array }[] {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = filterscale;
  const ss = 1 / filterscale;
  const out: { start: number; k: Int32Array }[] = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const start = Math.max(Math.trunc(center - support + 0.5), 0);
    const count = Math.min(Math.trunc(center + support + 0.5), inSize) - start;
    const pre = new Float64Array(count);
    let total = 0;
    for (let x = 0; x < count; x++) {
      const t = Math.abs((x + start - center + 0.5) * ss);
      pre[x] = t < 1 ? 1 - t : 0;
      total += pre[x]!;
    }
    const k = new Int32Array(count);
    for (let x = 0; x < count; x++) {
      const v = total !== 0 ? pre[x]! / total : pre[x]!;
      k[x] =
        v < 0
          ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS))
          : Math.trunc(0.5 + v * (1 << PRECISION_BITS));
    }
    out.push({ start, k });
  }
  return out;
}

const clip8 = (sum: number): number => {
  const v = sum >> PRECISION_BITS;
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/** Pillow BILINEAR resize of packed 8-bit RGB, horizontal pass first, both passes rounded to 8 bits. */
export function pillowBilinearRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Uint8Array {
  const horizontal = bilinearCoefficients(width, outWidth);
  const vertical = bilinearCoefficients(height, outHeight);
  const mid = new Uint8Array(outWidth * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < outWidth; x++) {
      const { start, k } = horizontal[x]!;
      for (let c = 0; c < 3; c++) {
        let sum = 1 << (PRECISION_BITS - 1);
        for (let i = 0; i < k.length; i++) sum += rgb[(y * width + start + i) * 3 + c]! * k[i]!;
        mid[(y * outWidth + x) * 3 + c] = clip8(sum);
      }
    }
  const out = new Uint8Array(outWidth * outHeight * 3);
  for (let y = 0; y < outHeight; y++) {
    const { start, k } = vertical[y]!;
    for (let x = 0; x < outWidth; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 1 << (PRECISION_BITS - 1);
        for (let i = 0; i < k.length; i++)
          sum += mid[((start + i) * outWidth + x) * 3 + c]! * k[i]!;
        out[(y * outWidth + x) * 3 + c] = clip8(sum);
      }
  }
  return out;
}

/**
 * Where oriented pixel (x, y) is in the stored image, for EXIF orientation 1-8 (TIFF 6.0 / Exif 2.3 tag 0x0112),
 * with the oriented size. Orientations 5-8 swap width and height.
 */
export function orientedSize(
  width: number,
  height: number,
  o: ExifOrientation,
): { width: number; height: number } {
  return o >= 5 ? { width: height, height: width } : { width, height };
}
export function storedPixel(
  x: number,
  y: number,
  width: number,
  height: number,
  o: ExifOrientation,
): [number, number] {
  const w = width - 1;
  const h = height - 1;
  switch (o) {
    case 1:
      return [x, y];
    case 2:
      return [w - x, y];
    case 3:
      return [w - x, h - y];
    case 4:
      return [x, h - y];
    case 5:
      return [y, x];
    case 6:
      return [y, h - x];
    case 7:
      return [w - y, h - x];
    case 8:
      return [w - y, x];
  }
}

/**
 * The only route from a confirmed crop to the encoder, run once per confirmed crop: orient (only when the crop
 * was confirmed in EXIF-applied coordinates), cut the square, rotate it clockwise (an exact pixel permutation),
 * resize to 256x256 with Pillow bilinear, drop alpha, normalise to float32 NCHW. Reads decoded pixels, never a
 * display canvas, so guides and handles drawn for the person can never reach the tensor.
 */
export function deriveEncoderInput(source: SourcePixels, crop: ConfirmedCrop): EncoderInput {
  const checked = validateConfirmedCrop(crop);
  const { width, height, data } = source;
  if (!isInt(width, 1) || !isInt(height, 1) || data.length !== width * height * 4) {
    throw new CropDerivationError(
      'invalid-source-pixels',
      'source pixels are RGBA with width * height * 4 bytes',
    );
  }
  if (width > CROP_MAX_EDGE || height > CROP_MAX_EDGE || width * height > CROP_MAX_PIXELS) {
    throw new CropDerivationError('source-too-large', 'source exceeds the single-input limits');
  }
  const o: ExifOrientation = checked.exifApplied ? checked.exifOrientation : 1;
  const oriented = orientedSize(width, height, o);
  const { left, top, width: size } = checked.rect;
  if (left + size > oriented.width || top + size > oriented.height) {
    throw new CropDerivationError('rect-outside-source', 'the crop lies outside the source pixels');
  }
  // The square crop, rotated clockwise about its centre, as packed RGB.
  const square = new Uint8Array(size * size * 3);
  const last = size - 1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Output (x, y) of the clockwise-rotated crop reads the unrotated crop pixel (u, v).
      const [u, v] =
        checked.rotationDegrees === 0
          ? [x, y]
          : checked.rotationDegrees === 90
            ? [y, last - x]
            : checked.rotationDegrees === 180
              ? [last - x, last - y]
              : [last - y, x];
      const [sx, sy] = storedPixel(left + u, top + v, width, height, o);
      const from = (sy * width + sx) * 4;
      const to = (y * size + x) * 3;
      square[to] = data[from]!;
      square[to + 1] = data[from + 1]!;
      square[to + 2] = data[from + 2]!;
    }
  const n = ENCODER_INPUT_SIZE;
  const rgb = pillowBilinearRgb(square, size, size, n, n);
  const tensor = new Float32Array(ENCODER_INPUT_LENGTH);
  for (let i = 0; i < n * n; i++)
    for (let c = 0; c < 3; c++) {
      const value = Math.fround(Math.fround(rgb[i * 3 + c]! / 255) - 0.5);
      tensor[c * n * n + i] = Math.fround(value / 0.5);
    }
  const bytes = new Uint8Array(tensor.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < tensor.length; i++) view.setFloat32(i * 4, tensor[i]!, true);
  return { tensor, tensorDigest: sha256Hex(bytes), policyVersion: checked.policyVersion };
}
