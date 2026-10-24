// Confirmed-crop policy (fm-smdf): frozen records, identity fields, the eight EXIF orientations, rotation,
// non-square sources, alpha, derive-once, guides never burned, the single-input limits applied from real
// container headers before any decode, the detector's proposal-only limit, malformed input, and detector
// success/failure giving one preprocessing identity. Real planted bytes go through the candidate's own header
// inspector (apps/web/src/Next/photo/image-header.mjs); the decode counter is a plain number in the test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONFIRMED_CROP_FIELDS,
  CROP_MAX_BYTES,
  CROP_MAX_EDGE,
  CROP_MAX_PIXELS,
  CROP_PREPROCESSING_POLICY_V1,
  DETECTOR_MAX_BYTES,
  PhotoAdmissionError,
  admitHeader,
  admitSize,
  admitThenDecode,
  createConfirmedCrop,
  deriveEncoderInput,
  orientedSize,
  storedPixel,
  type ConfirmedCropFields,
  type ExifOrientation,
  type PhotoHeader,
} from '../src/index.ts';

// The candidate's own container header reader, used as the caller's parser (no limits of its own here).
const { inspectImage } = (await import(
  new URL('../../../apps/web/src/Next/photo/image-header.mjs', import.meta.url).href
)) as {
  inspectImage: (b: Uint8Array, o: object) => PhotoHeader;
};
const parseOnly = (b: Uint8Array) =>
  inspectImage(b, {
    maxPixels: Infinity,
    maxBytes: Infinity,
    maxEdge: Infinity,
    requireEightBit: false,
  });

const fields = (over: Partial<ConfirmedCropFields> = {}): ConfirmedCropFields => ({
  sourceRevision: 1,
  sourceDigest: 'a'.repeat(64),
  rect: { left: 0, top: 0, width: 4, height: 4 },
  rotationDegrees: 0,
  exifOrientation: 1,
  exifApplied: false,
  policyVersion: 'crop-preprocessing-v1',
  policyParams: CROP_PREPROCESSING_POLICY_V1,
  ...over,
});
const rgba = (
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number, number?],
) => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = f(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
};
const red = (t: Float32Array, x: number, y: number) => t[y * 256 + x]!;

test('confirmed-crop.frozen and .identity-fields: a frozen record whose identity covers every field', () => {
  const crop = createConfirmedCrop(fields());
  assert.ok(Object.isFrozen(crop) && Object.isFrozen(crop.rect));
  assert.throws(() => {
    (crop as { rotationDegrees: number }).rotationDegrees = 90;
  }, TypeError);
  assert.deepEqual(Object.keys(crop).sort(), [...CONFIRMED_CROP_FIELDS, 'confirmedCropId'].sort());
  const changes: Partial<ConfirmedCropFields>[] = [
    { sourceRevision: 2 },
    { sourceDigest: 'b'.repeat(64) },
    { rect: { left: 1, top: 0, width: 4, height: 4 } },
    { rotationDegrees: 90 },
    { exifOrientation: 6 },
    { exifApplied: true },
  ];
  const ids = new Set([
    crop.confirmedCropId,
    ...changes.map((c) => createConfirmedCrop(fields(c)).confirmedCropId),
  ]);
  assert.equal(ids.size, changes.length + 1);
});

test('confirmed-crop.orientation-1..8: an EXIF-applied crop reads the oriented image; legacy crops ignore the tag', () => {
  // A 3x2 stored image whose pixels are numbered 1..6 in its red channel.
  const stored = rgba(3, 2, (x, y) => [1 + x + 3 * y, 0, 0]);
  // The oriented images per the Exif 2.3 table (row-major), written out by hand.
  const expected: Record<ExifOrientation, number[][]> = {
    1: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    2: [
      [3, 2, 1],
      [6, 5, 4],
    ],
    3: [
      [6, 5, 4],
      [3, 2, 1],
    ],
    4: [
      [4, 5, 6],
      [1, 2, 3],
    ],
    5: [
      [1, 4],
      [2, 5],
      [3, 6],
    ],
    6: [
      [4, 1],
      [5, 2],
      [6, 3],
    ],
    7: [
      [6, 3],
      [5, 2],
      [4, 1],
    ],
    8: [
      [3, 6],
      [2, 5],
      [1, 4],
    ],
  };
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const size = orientedSize(3, 2, o);
    const got = Array.from({ length: size.height }, (_, y) =>
      Array.from({ length: size.width }, (_, x) => {
        const [sx, sy] = storedPixel(x, y, 3, 2, o);
        return stored.data[(sy * 3 + sx) * 4]!;
      }),
    );
    assert.deepEqual(got, expected[o], `orientation ${o}`);
  }
  // Through the derivation: a 1x1 crop of the oriented top-left pixel (a uniform crop survives the resize).
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const applied = deriveEncoderInput(
      stored,
      createConfirmedCrop(
        fields({
          rect: { left: 0, top: 0, width: 1, height: 1 },
          exifOrientation: o,
          exifApplied: true,
        }),
      ),
    );
    assert.equal(
      red(applied.tensor, 128, 128),
      Math.fround(Math.fround(Math.fround(expected[o][0]![0]! / 255) - 0.5) / 0.5),
      `applied ${o}`,
    );
    const legacy = deriveEncoderInput(
      stored,
      createConfirmedCrop(
        fields({
          rect: { left: 0, top: 0, width: 1, height: 1 },
          exifOrientation: o,
          exifApplied: false,
        }),
      ),
    );
    assert.equal(
      red(legacy.tensor, 128, 128),
      red(
        deriveEncoderInput(
          stored,
          createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 1, height: 1 } })),
        ).tensor,
        128,
        128,
      ),
      `legacy ${o}`,
    );
  }
});

test('confirmed-crop.rotation is exact and composes; .non-square sources take a square crop anywhere inside', () => {
  const src = rgba(300, 200, (x, y) => [x % 256, y % 256, (x + y) % 256]);
  const rect = { left: 60, top: 20, width: 160, height: 160 };
  const at = (deg: 0 | 90 | 180 | 270) =>
    deriveEncoderInput(src, createConfirmedCrop(fields({ rect, rotationDegrees: deg })))
      .tensorDigest;
  assert.equal(new Set([at(0), at(90), at(180), at(270)]).size, 4);
  assert.throws(
    () =>
      deriveEncoderInput(
        src,
        createConfirmedCrop(fields({ rect: { left: 150, top: 50, width: 160, height: 160 } })),
      ),
    /outside/,
  );
  // 90 then the source rotated back by 270 = the source: rotation is a pixel permutation.
  const square = rgba(64, 64, (x, y) => [x * 4, y * 4, 9]);
  const r90 = deriveEncoderInput(
    square,
    createConfirmedCrop(
      fields({ rect: { left: 0, top: 0, width: 64, height: 64 }, rotationDegrees: 90 }),
    ),
  );
  const turned = rgba(64, 64, (x, y) => [y * 4, (63 - x) * 4, 9]); // the source rotated clockwise by hand
  assert.equal(
    deriveEncoderInput(
      turned,
      createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 64, height: 64 } })),
    ).tensorDigest,
    r90.tensorDigest,
  );
});

test('confirmed-crop.alpha is ignored: the same RGB with any alpha gives the same tensor', () => {
  const opaque = rgba(32, 32, (x, y) => [x * 8, y * 8, 100, 255]);
  const clear = rgba(32, 32, (x, y) => [x * 8, y * 8, 100, (x * y) % 256]);
  const crop = createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 32, height: 32 } }));
  assert.equal(
    deriveEncoderInput(clear, crop).tensorDigest,
    deriveEncoderInput(opaque, crop).tensorDigest,
  );
});

test('confirmed-crop.derive-once and .guides-not-burned: one result per record, from source pixels only', () => {
  const src = rgba(48, 48, (x, y) => [x * 5, y * 5, 50]);
  const crop = createConfirmedCrop(fields({ rect: { left: 0, top: 0, width: 48, height: 48 } }));
  const first = deriveEncoderInput(src, crop);
  assert.equal(
    deriveEncoderInput(src, crop).tensorDigest,
    first.tensorDigest,
    'deterministic: the record fixes the result',
  );
  // A display canvas with crop guides and handles drawn on it is a different buffer; the derivation never reads it.
  const display = new Uint8Array(src.data);
  for (let i = 0; i < 48; i++) display.set([255, 255, 255, 255], (i * 48 + 24) * 4); // a white guide line
  assert.equal(deriveEncoderInput(src, crop).tensorDigest, first.tensorDigest);
  assert.notEqual(
    deriveEncoderInput({ ...src, data: display }, crop).tensorDigest,
    first.tensorDigest,
    'had guides been read, they would show',
  );
  const policy = readFileSync(
    new URL('../src/contracts/crop-policy.ts', import.meta.url),
    'utf8',
  ).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
  assert.doesNotMatch(
    policy,
    /\b(document|canvas|Canvas|getContext|ImageData|drawImage|HTMLElement|window)\b/,
    'no display or canvas code',
  );
});

test('detector success and failure give the identical confirmed-pixel preprocessing identity', () => {
  const src = rgba(64, 64, (x, y) => [x * 3, y * 3, 7]);
  const rect = { left: 8, top: 8, width: 48, height: 48 };
  // The detector proposed this rect and the person accepted it; or the detector failed and the person drew it.
  const proposed = createConfirmedCrop(fields({ rect: { ...rect } }));
  const manual = createConfirmedCrop(fields({ rect: { left: 8, top: 8, width: 48, height: 48 } }));
  assert.equal(proposed.confirmedCropId, manual.confirmedCropId);
  assert.equal(
    deriveEncoderInput(src, proposed).tensorDigest,
    deriveEncoderInput(src, manual).tensorDigest,
  );
});

// ---- Limits from real headers, before any decode.
function png(width: number, height: number, bytes: number): Uint8Array {
  const out = new Uint8Array(Math.max(bytes, 33));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(out.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out.subarray(0, bytes);
}
const decodes = { count: 0 };
const decode = () => {
  decodes.count++;
  return 'decoded';
};
const admit = (b: Uint8Array) => {
  try {
    return admitThenDecode(b, parseOnly, decode);
  } catch (e) {
    if (e instanceof PhotoAdmissionError) return e.refusal;
    throw e;
  }
};

test('confirmed-crop.limits: 64 MiB, 120 x 1024^2 pixels and 20,000 px accepted; one more refused before any decode', () => {
  decodes.count = 0;
  assert.equal(admit(png(1000, 1000, CROP_MAX_BYTES)), 'decoded');
  assert.equal(admit(png(1000, 1000, CROP_MAX_BYTES + 1)), 'too-many-bytes');
  assert.equal(admit(png(12288, 10240, 1024)), 'decoded', 'exactly 120 x 1024^2 pixels');
  // The nearest count above the limit that two edges of at most 20,000 can make is limit + 3 (7257 x 17339).
  assert.equal(7257 * 17339, CROP_MAX_PIXELS + 3);
  assert.equal(admit(png(7257, 17339, 1024)), 'too-many-pixels');
  assert.equal(admit(png(CROP_MAX_EDGE, 1, 1024)), 'decoded');
  assert.equal(admit(png(CROP_MAX_EDGE + 1, 1, 1024)), 'edge-too-long');
  assert.equal(decodes.count, 3, 'only the three admitted photos reached the decoder');
  assert.deepEqual(admitHeader({ width: 1, height: 1, encodedBytes: CROP_MAX_BYTES + 1 }), {
    admitted: false,
    refusal: 'too-many-bytes',
    message: 'Choose a photo smaller than 64 MB.',
  });
});

test('confirmed-crop.align-limit-proposal-only: a 30 MB photo is admitted for manual crop, with no detector proposal', () => {
  const thirty = png(4000, 3000, 30 * 1024 * 1024);
  assert.deepEqual(admitSize(thirty.length), { admitted: true, detector: 'not-run' });
  assert.deepEqual(admitSize(DETECTOR_MAX_BYTES), { admitted: true, detector: 'propose' });
  assert.deepEqual(admitSize(DETECTOR_MAX_BYTES + 1), { admitted: true, detector: 'not-run' });
  const align = readFileSync(
    new URL('../../../apps/web/src/Next/photo/align-photo.mjs', import.meta.url),
    'utf8',
  );
  assert.match(align, /blob\.size>25\*1024\*1024/, 'the candidate detector limit is 25 MB');
  assert.equal(admit(thirty), 'decoded');
});

test('confirmed-crop.malformed: truncated, unknown or empty containers are refused before decode', () => {
  decodes.count = 0;
  assert.equal(admit(new Uint8Array([1, 2, 3])), 'malformed');
  assert.equal(admit(new Uint8Array(64)), 'malformed', 'unknown container');
  assert.equal(admit(png(10, 10, 20)), 'malformed', 'PNG header cut short');
  assert.equal(admit(png(0, 10, 64)), 'malformed', 'zero width');
  assert.equal(decodes.count, 0);
});

test('route ceilings: measured, no threshold until contracts milestone 2 (fm-2o8q) sets them', () => {
  const files = readdirSync(new URL('../src/contracts/', import.meta.url));
  const admission = readFileSync(
    new URL('../src/contracts/photo-admission.ts', import.meta.url),
    'utf8',
  );
  assert.ok(files.includes('photo-admission.ts'));
  assert.match(admission, /measured, no threshold/);
  assert.doesNotMatch(admission, /ROUTE_CEILING|_CEILING_BYTES\s*=/, 'no invented route ceiling');
});
