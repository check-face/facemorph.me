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
  PREVIEW_MAX_EDGE,
  SINGLE_INPUT_LIMITS,
  CropDerivationError,
  CropValidationError,
  createConfirmedCrop,
  deriveEncoderInput,
  pillowBilinearRgb,
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
        policyParams: {
          ...CROP_PREPROCESSING_POLICY_V1,
          resize: 'area-average' as 'pillow-bilinear',
        },
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

test("candidate fixtures: the policy reproduces the candidate's qualified preprocessing bit for bit", () => {
  // classic a42829b photo-runtime/fixtures: Pillow 12.3.0 RGB + bilinear, no alignment. seed-0-unaligned's
  // tensor is also the exact input the encoder-stream qualification ran (its inputSha256), so the W+ the
  // product computes from a confirmed crop of this photo is the qualified W+ itself.
  const dir = new URL('./vectors/candidate-preprocessing/', import.meta.url);
  const cases = JSON.parse(readFileSync(new URL('cases.json', dir), 'utf8')).cases as {
    id: string;
    inputRgb: string;
    inputRgbSha256: string;
    width: number;
    height: number;
    preparedSha256: string;
    tensorSha256: string;
  }[];
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  for (const c of cases) {
    const rgb = new Uint8Array(readFileSync(new URL(c.inputRgb, dir)));
    assert.equal(sha(rgb), c.inputRgbSha256, `${c.id} input bytes`);
    assert.equal(
      sha(pillowBilinearRgb(rgb, c.width, c.height, 256, 256)),
      c.preparedSha256,
      `${c.id} prepared RGB`,
    );
    if (c.width !== c.height) continue; // a confirmed crop is square; the stretched non-square resize is checked above
    const rgba = new Uint8Array(c.width * c.height * 4);
    for (let i = 0; i < c.width * c.height; i++)
      rgba.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
    const crop = createConfirmedCrop(
      fields({ rect: { left: 0, top: 0, width: c.width, height: c.height } }),
    );
    assert.equal(
      deriveEncoderInput({ width: c.width, height: c.height, data: rgba }, crop).tensorDigest,
      c.tensorSha256,
      `${c.id} tensor`,
    );
  }
  assert.equal(
    cases.find((c) => c.id === 'seed-0-unaligned')!.tensorSha256,
    '51529b7a56d218a191b308a889db37fbff311a0bd4c2096e46b2334f7d835726',
  );
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
