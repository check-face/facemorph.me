import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONFIRMED_CROP_FIELDS,
  CROP_MAX_BYTES,
  CROP_MAX_EDGE,
  CROP_MAX_PIXELS,
  CROP_OUTPUT,
  CROP_PREPROCESSING_POLICY_V1,
  ENCODER_INPUT_LENGTH,
  PREVIEW_MAX_EDGE,
  SINGLE_INPUT_LIMITS,
  CropDerivationError,
  CropValidationError,
  createConfirmedCrop,
  deriveEncoderInput,
  validateConfirmedCrop,
  type ConfirmedCropFields,
  type SourcePixels,
} from '../src/index.ts';
import { sha256Hex, utf8Bytes } from '../src/contracts/sha256.ts';

const vectors = JSON.parse(
  readFileSync(new URL('./vectors/confirmed-crop-identity.json', import.meta.url), 'utf8'),
);

const fields = (over: Partial<ConfirmedCropFields> = {}): ConfirmedCropFields => ({
  sourceRevision: 1,
  sourceDigest: 'c'.repeat(64),
  rect: { left: 0, top: 0, width: 512, height: 512 },
  rotationDegrees: 0,
  exifOrientation: 1,
  exifApplied: false,
  policyVersion: 'crop-preprocessing-v1',
  policyParams: CROP_PREPROCESSING_POLICY_V1,
  ...over,
});

test('limits are the candidate photo/crop.mjs values', () => {
  assert.deepEqual(
    { CROP_MAX_BYTES, CROP_MAX_PIXELS, CROP_MAX_EDGE, CROP_OUTPUT, PREVIEW_MAX_EDGE },
    {
      CROP_MAX_BYTES: 67108864,
      CROP_MAX_PIXELS: 125829120,
      CROP_MAX_EDGE: 20000,
      CROP_OUTPUT: 1024,
      PREVIEW_MAX_EDGE: 4096,
    },
  );
  assert.deepEqual(Object.keys(SINGLE_INPUT_LIMITS).sort(), [
    'CROP_MAX_BYTES',
    'CROP_MAX_EDGE',
    'CROP_MAX_PIXELS',
    'CROP_OUTPUT',
    'PREVIEW_MAX_EDGE',
  ]);
});

test('package SHA-256 matches node:crypto', () => {
  for (const text of [
    '',
    'abc',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'é😀'.repeat(40),
  ]) {
    assert.equal(
      sha256Hex(utf8Bytes(text)),
      createHash('sha256').update(text, 'utf8').digest('hex'),
      text,
    );
  }
});

test('identity vectors: one changed field changes the identity; key order does not', () => {
  assert.equal(
    validateConfirmedCrop({
      ...vectors.records[0].record,
      confirmedCropId: vectors.records[0].confirmedCropId,
    }).confirmedCropId,
    vectors.records[0].confirmedCropId,
  );
  const ids = new Set<string>();
  for (const { changed, record, confirmedCropId } of vectors.records) {
    assert.equal(createConfirmedCrop(record).confirmedCropId, confirmedCropId, changed);
    ids.add(confirmedCropId);
  }
  assert.equal(ids.size, vectors.records.length);
  assert.equal(
    createConfirmedCrop(vectors.reordered.record).confirmedCropId,
    vectors.reordered.confirmedCropId,
  );
  assert.equal(vectors.reordered.confirmedCropId, vectors.records[0].confirmedCropId);
});

test('a confirmed crop declares exactly the eight fields plus its identity, frozen', () => {
  const crop = createConfirmedCrop(fields());
  assert.deepEqual(Object.keys(crop).sort(), [...CONFIRMED_CROP_FIELDS, 'confirmedCropId'].sort());
  assert.ok(
    Object.isFrozen(crop) && Object.isFrozen(crop.rect) && Object.isFrozen(crop.policyParams),
  );
  assert.throws(() => {
    (crop as { sourceRevision: number }).sourceRevision = 2;
  }, TypeError);
});

test('every invalid record is a typed CropValidationError', () => {
  const bad: [unknown, string][] = [
    [null, 'not-an-object'],
    [{ ...fields(), extra: 1 }, 'unexpected-field'],
    [{ ...fields(), sourceDigest: undefined }, 'invalid-source-digest'],
    [Object.fromEntries(Object.entries(fields()).filter(([k]) => k !== 'rect')), 'missing-field'],
    [fields({ sourceRevision: -1 }), 'invalid-source-revision'],
    [fields({ sourceRevision: 1.5 }), 'invalid-source-revision'],
    [fields({ sourceDigest: 'C'.repeat(64) }), 'invalid-source-digest'],
    [fields({ rect: { left: 0, top: 0, width: 10, height: 11 } }), 'invalid-rect'],
    [fields({ rect: { left: 0.5, top: 0, width: 10, height: 10 } }), 'invalid-rect'],
    [fields({ rect: { left: 0, top: 0, width: 0, height: 0 } }), 'invalid-rect'],
    [fields({ rotationDegrees: 45 as 0 }), 'invalid-rotation'],
    [fields({ exifOrientation: 9 as 1 }), 'invalid-exif-orientation'],
    [fields({ exifApplied: 'no' as unknown as boolean }), 'invalid-exif-applied'],
    [
      fields({
        policyParams: { ...CROP_PREPROCESSING_POLICY_V1, resize: 'bilinear' as 'area-average' },
      }),
      'unknown-policy',
    ],
  ];
  for (const [value, code] of bad) {
    assert.throws(
      () => createConfirmedCrop(value as ConfirmedCropFields),
      (e: unknown) => e instanceof CropValidationError && e.code === code,
      code,
    );
  }
  const crop = createConfirmedCrop(fields());
  assert.throws(
    () => validateConfirmedCrop({ ...crop, confirmedCropId: 'd'.repeat(64) }),
    (e: unknown) => e instanceof CropValidationError && e.code === 'identity-mismatch',
  );
});

/** RGBA pixels from a per-pixel colour function. */
function pixels(
  width: number,
  height: number,
  colour: (x: number, y: number) => [number, number, number],
): SourcePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colour(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const at = (tensor: Float32Array, c: number, x: number, y: number) =>
  tensor[c * 65536 + y * 256 + x]!;
const norm = (v: number) => Math.fround(Math.fround(Math.fround(v / 255) - 0.5) / 0.5);

test('worked example: 2x2 blocks of a 512 crop average to one encoder pixel each', () => {
  // Inside a 600x560 source, the crop at (40, 30) holds blocks whose four pixels are 10, 20, 30, 40.
  const source = pixels(600, 560, (x, y) => {
    const u = x - 40;
    const v = y - 30;
    const block = (Math.floor(u / 2) + Math.floor(v / 2)) % 2;
    const corner = (u & 1) + 2 * (v & 1);
    return [10 + 10 * corner, block ? 255 : 0, 7];
  });
  const crop = createConfirmedCrop(
    fields({ rect: { left: 40, top: 30, width: 512, height: 512 } }),
  );
  const { tensor, tensorDigest, policyVersion } = deriveEncoderInput(source, crop);
  assert.equal(tensor.length, ENCODER_INPUT_LENGTH);
  assert.equal(policyVersion, 'crop-preprocessing-v1');
  assert.equal(at(tensor, 0, 0, 0), norm(25)); // mean of 10, 20, 30, 40
  assert.equal(at(tensor, 1, 0, 0), norm(0));
  assert.equal(at(tensor, 1, 1, 0), norm(255));
  assert.equal(at(tensor, 2, 200, 100), norm(7));
  assert.equal(norm(255), 1);
  assert.equal(norm(0), -1);
  const bytes = Buffer.from(tensor.buffer, tensor.byteOffset, tensor.byteLength); // little-endian hosts
  assert.equal(tensorDigest, createHash('sha256').update(bytes).digest('hex'));
});

test('non-integer scale: a uniform crop stays uniform; a 256 crop is copied exactly', () => {
  const uniform = deriveEncoderInput(
    pixels(300, 300, () => [100, 150, 200]),
    createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 300, height: 300 } })),
  );
  assert.ok(uniform.tensor.subarray(0, 65536).every((v) => v === norm(100)));
  assert.ok(uniform.tensor.subarray(131072).every((v) => v === norm(200)));
  const exact = deriveEncoderInput(
    pixels(256, 256, (x, y) => [x, y, (x + y) % 256]),
    createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 256, height: 256 } })),
  );
  assert.equal(at(exact.tensor, 0, 17, 3), norm(17));
  assert.equal(at(exact.tensor, 1, 17, 3), norm(3));
});

test('rotation is clockwise about the centre of the crop', () => {
  const source = pixels(256, 256, (x, y) => [x, y, 0]);
  const rect = { left: 0, top: 0, width: 256, height: 256 };
  const r90 = deriveEncoderInput(
    source,
    createConfirmedCrop(fields({ rect, rotationDegrees: 90 })),
  ).tensor;
  // Clockwise: the source's bottom-left corner (0, 255) becomes the top-left.
  assert.deepEqual([at(r90, 0, 0, 0), at(r90, 1, 0, 0)], [norm(0), norm(255)]);
  const r180 = deriveEncoderInput(
    source,
    createConfirmedCrop(fields({ rect, rotationDegrees: 180 })),
  ).tensor;
  assert.deepEqual([at(r180, 0, 0, 0), at(r180, 1, 0, 0)], [norm(255), norm(255)]);
  const r270 = deriveEncoderInput(
    source,
    createConfirmedCrop(fields({ rect, rotationDegrees: 270 })),
  ).tensor;
  assert.deepEqual([at(r270, 0, 0, 0), at(r270, 1, 0, 0)], [norm(255), norm(0)]);
});

test('derivation refuses malformed or out-of-bounds input with a typed error', () => {
  const crop = createConfirmedCrop(fields({ rect: { left: 10, top: 0, width: 256, height: 256 } }));
  const cases: [SourcePixels, string][] = [
    [{ width: 256, height: 256, data: new Uint8Array(10) }, 'invalid-source-pixels'],
    [{ width: 0, height: 256, data: new Uint8Array(0) }, 'invalid-source-pixels'],
    [pixels(260, 256, () => [0, 0, 0]), 'rect-outside-source'],
  ];
  for (const [source, code] of cases) {
    assert.throws(
      () => deriveEncoderInput(source, crop),
      (e: unknown) => e instanceof CropDerivationError && e.code === code,
      code,
    );
  }
  // Claimed dimensions over the limits are refused before any pixel is read.
  assert.throws(
    () =>
      deriveEncoderInput(
        { width: CROP_MAX_EDGE + 1, height: 1, data: new Uint8Array((CROP_MAX_EDGE + 1) * 4) },
        crop,
      ),
    (e: unknown) => e instanceof CropDerivationError && e.code === 'source-too-large',
  );
  // An edited record no longer matches its identity.
  assert.throws(
    () =>
      deriveEncoderInput(
        pixels(300, 300, () => [0, 0, 0]),
        { ...crop, rotationDegrees: 90 },
      ),
    CropValidationError,
  );
});
