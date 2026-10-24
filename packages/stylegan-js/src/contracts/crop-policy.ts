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
  /** Box filter with fractional coverage from the square crop to 256x256, then rounded to 8 bits. */
  readonly resize: 'area-average';
  /** RGB channels of 8-bit sRGB RGBA source pixels; alpha is ignored; no colour management. */
  readonly colour: 'srgb-rgb-8bit-alpha-ignored';
  /** Each step rounded to float32, as photo/selection-worker.mjs does. */
  readonly normalisation: 'float32((x / 255 - 0.5) / 0.5)';
  readonly layout: 'nchw';
  readonly encoderInputSize: typeof ENCODER_INPUT_SIZE;
}

export const CROP_PREPROCESSING_POLICY_V1: CropPreprocessingPolicyV1 = Object.freeze({
  version: 'crop-preprocessing-v1',
  resize: 'area-average',
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

export type CropDerivationCode = 'invalid-source-pixels' | 'source-too-large' | 'rect-outside-source';

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
  if (!isRecord(value)) throw new CropValidationError('not-an-object', 'a confirmed crop is an object');
  const allowed = new Set<string>([...CONFIRMED_CROP_FIELDS, ...(allowId ? ['confirmedCropId'] : [])]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CropValidationError('unexpected-field', `unexpected field ${key}`);
  }
  for (const key of CONFIRMED_CROP_FIELDS) {
    if (!(key in value)) throw new CropValidationError('missing-field', `missing field ${key}`);
  }
  const v = value as Record<(typeof CONFIRMED_CROP_FIELDS)[number], unknown>;
  if (!isInt(v.sourceRevision, 0)) {
    throw new CropValidationError('invalid-source-revision', 'sourceRevision is a non-negative integer');
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
    throw new CropValidationError('invalid-rect', 'rect is an integer square {left, top, width, height}');
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
    throw new CropValidationError('unknown-policy', 'only crop-preprocessing-v1 with its exact parameters');
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
    rect: Object.freeze({ left: fields.rect.left, top: fields.rect.top, width: fields.rect.width, height: fields.rect.height }),
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
    throw new CropValidationError('identity-mismatch', 'confirmedCropId does not match the recorded fields');
  }
  return freeze(checked, id);
}

/** Oriented source pixels: 8-bit RGBA, row-major, `width * height * 4` bytes. */
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

/** 1-D area-average weights from `size` source samples onto `ENCODER_INPUT_SIZE` outputs. */
function coverage(size: number): { start: number; weights: number[] }[] {
  const scale = size / ENCODER_INPUT_SIZE;
  return Array.from({ length: ENCODER_INPUT_SIZE }, (_, o) => {
    const lo = o * scale;
    const hi = (o + 1) * scale;
    const start = Math.floor(lo);
    const weights: number[] = [];
    for (let i = start; i < hi && i < size; i++) weights.push((Math.min(i + 1, hi) - Math.max(i, lo)) / scale);
    return { start, weights };
  });
}

/**
 * The only route from a confirmed crop to the encoder, run once per confirmed crop: square crop,
 * area-average to 256x256 8-bit RGB, rotate clockwise, normalise to float32 NCHW.
 * This is the contract's reference derivation; fm-smdf implements the product path against it.
 */
export function deriveEncoderInput(source: SourcePixels, crop: ConfirmedCrop): EncoderInput {
  const checked = validateConfirmedCrop(crop);
  const { width, height, data } = source;
  if (!isInt(width, 1) || !isInt(height, 1) || data.length !== width * height * 4) {
    throw new CropDerivationError('invalid-source-pixels', 'source pixels are RGBA with width * height * 4 bytes');
  }
  if (width > CROP_MAX_EDGE || height > CROP_MAX_EDGE || width * height > CROP_MAX_PIXELS) {
    throw new CropDerivationError('source-too-large', 'source exceeds the single-input limits');
  }
  const { left, top, width: size } = checked.rect;
  if (left + size > width || top + size > height) {
    throw new CropDerivationError('rect-outside-source', 'the crop lies outside the source pixels');
  }
  const n = ENCODER_INPUT_SIZE;
  const cols = coverage(size);
  // Horizontal pass: each crop row onto 256 columns, three channels.
  const rows = new Float64Array(size * n * 3);
  for (let y = 0; y < size; y++) {
    const rowBase = ((top + y) * width + left) * 4;
    for (let o = 0; o < n; o++) {
      const { start, weights } = cols[o]!;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < weights.length; k++) {
        const at = rowBase + (start + k) * 4;
        const w = weights[k]!;
        r += data[at]! * w;
        g += data[at + 1]! * w;
        b += data[at + 2]! * w;
      }
      const out = (y * n + o) * 3;
      rows[out] = r;
      rows[out + 1] = g;
      rows[out + 2] = b;
    }
  }
  // Vertical pass, rounded to 8 bits, into the unrotated 256x256 RGB image.
  const rgb = new Uint8Array(n * n * 3);
  for (let o = 0; o < n; o++) {
    const { start, weights } = cols[o]!;
    for (let x = 0; x < n; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < weights.length; k++) sum += rows[((start + k) * n + x) * 3 + c]! * weights[k]!;
        rgb[(o * n + x) * 3 + c] = Math.min(255, Math.max(0, Math.round(sum)));
      }
    }
  }
  const tensor = new Float32Array(ENCODER_INPUT_LENGTH);
  const last = n - 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Output (x, y) of the image rotated clockwise reads the unrotated pixel (u, v).
      const [u, v] =
        checked.rotationDegrees === 0 ? [x, y]
        : checked.rotationDegrees === 90 ? [y, last - x]
        : checked.rotationDegrees === 180 ? [last - x, last - y]
        : [last - y, x];
      for (let c = 0; c < 3; c++) {
        const value = Math.fround(Math.fround(rgb[(v * n + u) * 3 + c]! / 255) - 0.5);
        tensor[c * n * n + y * n + x] = Math.fround(value / 0.5);
      }
    }
  }
  const bytes = new Uint8Array(tensor.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < tensor.length; i++) view.setFloat32(i * 4, tensor[i]!, true);
  return { tensor, tensorDigest: sha256Hex(bytes), policyVersion: checked.policyVersion };
}
