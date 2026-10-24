// Envelope helpers: round trips through the real writers, the candidate's own fixtures, and corruption fuzz.
// PNG pixels are checked by decoding with node:zlib; lossless WebP decode is checked in real browsers
// (test/browser/).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  embedRecovery,
  encodeLosslessWebp,
  encodePng,
  readRecovery,
  type RecoveryMetadata,
  type StillRecoveryResult,
} from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const vector = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./vectors/${name}`, import.meta.url)));
const stills = JSON.parse(
  readFileSync(new URL('./vectors/stills/stills.json', import.meta.url), 'utf8'),
);
const MODEL = '2'.repeat(64);
const NOISE = '3'.repeat(64);

function latent(layers = 18, width = 512, seed = 1) {
  const random = mulberry32(seed);
  // N(0,1)-like values: the realistic case whose schema-1 JSON exceeds 128 KiB.
  const values = Float32Array.from(
    { length: layers * width },
    () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random()),
  );
  return { space: 'w-plus' as const, shape: [layers, width] as const, values };
}

const recovery = (over: Partial<RecoveryMetadata> = {}): RecoveryMetadata => ({
  generationKind: 'seed',
  generationSha256: 'a'.repeat(64),
  provenance: {
    modelSha256: MODEL,
    noiseSha256: NOISE,
    bundleVersion: 'test',
    route: 'cpu',
    truncationPsi: 0.7,
  },
  latent: latent(),
  seed: 42,
  ...over,
});

function pixels(width: number, height: number) {
  const random = mulberry32(width * 31 + height);
  return {
    width,
    height,
    rgba: Uint8ClampedArray.from({ length: width * height * 4 }, () => Math.floor(random() * 256)),
  };
}

/** Decodes the PNGs encodePng writes (8-bit RGBA, filter 0) with node:zlib. */
function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  while (at < bytes.length) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IHDR') [width, height] = [view.getUint32(at + 8), view.getUint32(at + 12)];
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const scan = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(scan[y * (width * 4 + 1)], 0);
    rgba.set(scan.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

const parsed = (r: StillRecoveryResult) => {
  assert.equal(r.kind, 'parsed', JSON.stringify(r));
  if (r.kind !== 'parsed') throw new Error('unreachable');
  return r.recovered;
};

test('encodePng: exact pixels and exact recovery values, stored and compressed', async () => {
  const px = pixels(64, 48);
  for (const compress of [false, true]) {
    const png = await encodePng(px, recovery(), { compress });
    const decoded = decodePng(png);
    assert.deepEqual([decoded.width, decoded.height], [64, 48]);
    assert.deepEqual(decoded.rgba, new Uint8Array(px.rgba.buffer));
    const r = parsed(readRecovery(png));
    assert.equal(r.schemaVersion, 2);
    assert.deepEqual(r.latent.values, recovery().latent.values);
    assert.deepEqual(r.latent.shape, [18, 512]);
    assert.deepEqual(
      [r.seed, r.generationKind, r.provenance.modelSha256, r.provenance.truncationPsi],
      [42, 'seed', MODEL, 0.7],
    );
  }
});

test('encodeLosslessWebp: exact recovery values; latent shape from the latent, not 18x512', () => {
  const small = latent(4, 8, 3);
  const webp = encodeLosslessWebp(pixels(16, 16), recovery({ latent: small }));
  assert.equal(String.fromCharCode(...webp.subarray(12, 16)), 'VP8L');
  const r = parsed(readRecovery(webp));
  assert.deepEqual([r.mime, r.width, r.height], ['image/webp', 16, 16]);
  assert.deepEqual(r.latent.shape, [4, 8]);
  assert.deepEqual(r.latent.values, small.values);
});

test('re-encoding regenerates the envelope over the new payload, never an old hash', () => {
  const first = embedRecovery(vector('plain.png'), recovery());
  const again = embedRecovery(first, recovery({ seed: 7 }));
  const r = parsed(readRecovery(again));
  assert.equal(r.seed, 7);
  // hash-assert: replacement=corruption-check; imageSha256 is the recovery envelope's integrity value over the
  // embedded payload bytes (exact recovery), not an encoder-output equality.
  assert.equal(r.imageSha256, createHash('sha256').update(vector('plain.png')).digest('hex'));
  assert.deepEqual(r.baseImage, vector('plain.png'));
  // A lossy payload gets an envelope for its own bytes too.
  const lossy = parsed(readRecovery(embedRecovery(vector('plain.webp'), recovery())));
  // hash-assert: replacement=corruption-check; the same integrity value for a lossy payload.
  assert.equal(lossy.imageSha256, createHash('sha256').update(vector('plain.webp')).digest('hex'));
});

test('a damaged envelope is never replaced; private inputs never enter the envelope', () => {
  assert.throws(() => embedRecovery(vector('stills/damaged-v1.png'), recovery()), /damaged/);
  const withPrivate = recovery({
    provenance: {
      modelSha256: MODEL,
      noiseSha256: NOISE,
      sourcePhoto: 'me.jpg',
      words: 'secret',
    } as unknown as RecoveryMetadata['provenance'],
  });
  const text = Buffer.from(embedRecovery(vector('plain.png'), withPrivate)).toString('latin1');
  assert.ok(!text.includes('me.jpg') && !text.includes('secret'));
});

test("the candidate's fixtures decode to identical latent and model values", () => {
  for (const name of ['recovery-v1.png', 'recovery-v2.png', 'recovery-v2.webp']) {
    assert.equal(
      createHash('sha256')
        .update(vector(`stills/${name}`))
        .digest('hex'),
      stills.files[name].sha256,
      name,
    );
  }
  const v1 = parsed(readRecovery(vector('stills/recovery-v1.png')));
  const v2 = parsed(readRecovery(vector('stills/recovery-v2.png')));
  const webp = parsed(readRecovery(vector('stills/recovery-v2.webp')));
  assert.deepEqual([v1.schemaVersion, v2.schemaVersion, webp.schemaVersion], [1, 2, 2]);
  for (const r of [v1, v2, webp]) {
    assert.deepEqual(r.latent.values, v1.latent.values);
    assert.deepEqual(
      [r.provenance.modelSha256, r.provenance.noiseSha256, r.seed],
      [MODEL, NOISE, 42],
    );
  }
  // The defect fm-48bj found: a realistic schema-1 latent is ~181 KiB of JSON, which the candidate could not reopen.
  assert.ok(vector('stills/recovery-v1.png').length > 128 * 1024);
});

test('truncated, corrupt, oversized and unknown-schema inputs are rejected', async () => {
  const png = await encodePng(pixels(8, 8), recovery());
  const kinds = (b: Uint8Array) => readRecovery(b).kind;
  assert.equal(kinds(png.subarray(0, png.length - 20)), 'damaged');
  const flipped = png.slice();
  flipped[Buffer.from(png).indexOf('FaceMorph') + 200]! ^= 4;
  assert.equal(kinds(flipped), 'damaged');
  assert.equal(kinds(vector('stills/damaged-v1.png')), 'damaged');
  const unknown = embedRecovery(vector('plain.png'), recovery()).slice();
  const at = Buffer.from(unknown).indexOf('"schema":2');
  unknown[at + 9] = '7'.charCodeAt(0); // CRC now fails: damaged, not silently another schema
  assert.equal(kinds(unknown), 'damaged');
  assert.throws(
    () => embedRecovery(vector('plain.png'), recovery({ latent: latent(64, 512) })),
    /exceeds its limit/,
  );
  assert.equal(kinds(new Uint8Array(65 * 1024 * 1024)), 'damaged'); // over the 64 MiB file bound
});

test('corruption fuzz (seed 99, 2000 cases): no mutation yields a silently accepted different latent', () => {
  const random = mulberry32(99);
  const sources = [
    vector('stills/recovery-v1.png'),
    vector('stills/recovery-v2.png'),
    vector('stills/recovery-v2.webp'),
  ];
  const expected = parsed(readRecovery(sources[0]!)).latent.values;
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2000; i++) {
    const src = sources[i % 3]!;
    let bytes = src.slice();
    const op = Math.floor(random() * 3);
    if (op === 0)
      for (let k = 0; k < 1 + Math.floor(random() * 6); k++)
        bytes[Math.floor(random() * bytes.length)]! ^= 1 << Math.floor(random() * 8);
    if (op === 1) bytes = bytes.subarray(0, Math.floor(random() * bytes.length));
    if (op === 2) {
      const at = Buffer.from(bytes).indexOf('"schema":');
      if (at > 0) bytes[at + 9] = '0123456789'.charCodeAt(Math.floor(random() * 10));
    }
    const r = readRecovery(bytes);
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    if (r.kind === 'parsed')
      assert.deepEqual(
        r.recovered.latent.values,
        expected,
        'a mutation produced a different accepted latent',
      );
  }
  console.log('envelope corruption fuzz: 2000 cases', counts);
});
