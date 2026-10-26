// Canary identity, comparison and reference decoding (fm-3h3w) on plain values and real files: the record key is
// the candidate's own (so receipts already on devices are adopted), the gate is the frozen product tolerance, and the
// reference decoder reads the runtime's real reference PNGs exactly as the candidate decoder does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bundleDigest,
  canaryBundle,
  canaryKey,
  compareCanary,
  recordProvider,
  type CanaryManifest,
} from '../../src/engine/canary.ts';
import { toRgba8 } from '../../src/engine/identity.ts';
import { decodeReferencePng } from '../../src/engine/reference-png.ts';
import { PRODUCT_CANARY_TOLERANCE } from '../../src/contracts/numerics.ts';
import { acquiredManifest, pathOf } from './support/runtime.ts';

// The candidate's modules as the app ran them before fm-7f2o, frozen in test/vectors/candidate-control (manifest.json).
const CONTROL = '../vectors/candidate-control/browser/';
const controlCanary = (await import(CONTROL + 'canary-qualification.mjs')) as {
  createCanaryQualification(o: object): { key: string };
};
const controlPng = (await import(CONTROL + 'png.mjs')) as {
  decodeReferencePng(b: Uint8Array): Promise<{ rgba: Uint8ClampedArray }>;
  encodeRgbaPng(rgba: Uint8ClampedArray, w?: number, h?: number, o?: object): Promise<Blob>;
};

const a = (n: number) => ({
  sha256: String(n).repeat(64).slice(0, 64),
  size: 4,
  url: `https://x.test/${n}`,
});
const manifest: CanaryManifest = {
  bundleVersion: 'b1',
  sampleIndices: a(1),
  canaries: [
    { name: 'frame-00', w: a(2), noise: 'original', samples: a(3), reference: a(4) },
    { name: 'zero-noise', w: a(5), noise: 'zero', samples: a(6), reference: a(7) },
  ],
};
const controlKey = (o: {
  manifest: unknown;
  manifestSha256: string;
  provider: string;
  bundle: unknown;
}) =>
  controlCanary.createCanaryQualification({
    ...o,
    records: {},
    acquireBytes: () => {},
    runSynthesis: () => {},
  }).key;

test('the record key is the candidate key for every route bundle, and content changes it', (t) => {
  const sha = 'a'.repeat(64);
  const bundles = [
    { sha256: 'syn', url: 'u' },
    { assets: [{ sha256: 'x' }, { sha256: 'y' }], module: { sha256: 'm' } },
    null,
  ];
  for (const bundle of bundles)
    for (const provider of ['wasm', 'webgpu'])
      assert.equal(
        canaryKey({ manifest, manifestSha256: sha, provider, bundle }),
        controlKey({ manifest, manifestSha256: sha, provider, bundle }),
      );
  const base = canaryKey({ manifest, manifestSha256: sha, provider: 'wasm', bundle: null });
  const moved = {
    ...manifest,
    canaries: manifest.canaries.map((c) => ({
      ...c,
      reference: { ...c.reference, url: 'https://elsewhere/' },
    })),
  };
  assert.equal(
    canaryKey({ manifest: moved, manifestSha256: sha, provider: 'wasm', bundle: null }),
    base,
    'URLs do not change it',
  );
  const tampered = {
    ...manifest,
    canaries: [manifest.canaries[0]!, { ...manifest.canaries[1]!, reference: a(9) }],
  };
  assert.notEqual(
    canaryKey({ manifest: tampered, manifestSha256: sha, provider: 'wasm', bundle: null }),
    base,
  );
  assert.notEqual(
    canaryKey({ manifest, manifestSha256: 'b'.repeat(64), provider: 'wasm', bundle: null }),
    base,
  );
  assert.notEqual(
    canaryKey({ manifest, manifestSha256: sha, provider: 'webgpu', bundle: null }),
    base,
  );
  assert.equal(
    bundleDigest({ b: { sha256: '2' }, a: { sha256: '1' } }),
    bundleDigest({ a: { sha256: '1' }, b: { sha256: '2' } }),
  );
  const runtime = acquiredManifest();
  if (!runtime)
    return t.skip('the real manifest keys are untested: the runtime is not acquired here');
  const m = runtime.manifest as unknown as CanaryManifest & {
    synthesis: object;
    webgl: object;
    webgpu: object;
  };
  for (const [route, engine, provider] of [
    ['cpu', 'ort', 'wasm'],
    ['webgpu', 'ort', 'webgpu'],
    ['webgpu', 'direct', 'webgpu'],
  ] as const) {
    assert.equal(recordProvider(route), provider);
    const bundle = canaryBundle(m, route, engine);
    assert.equal(
      canaryKey({ manifest: m, manifestSha256: runtime.sha256, provider, bundle }),
      controlKey({ manifest: m, manifestSha256: runtime.sha256, provider, bundle }),
    );
  }
});

test('the comparison is the frozen gate: RGB difference 1 passes, 2 fails; sampled float 0.002 passes, above fails', () => {
  assert.deepEqual(
    { ...PRODUCT_CANARY_TOLERANCE, source: undefined },
    { maxRgbDiff: 1, maxSampledRawFloatError: 0.002, source: undefined },
  );
  const n = 1024 * 1024;
  const raw = Float32Array.from({ length: 3 * n }, (_, i) => ((i * 7919) % 511) / 255 - 1);
  const expected = toRgba8(raw);
  const indices = Uint32Array.from({ length: 64 }, (_, i) => i * 49139);
  const samples = Float32Array.from(indices, (i) => raw[i] as number);
  assert.deepEqual(compareCanary('same', raw, indices, samples, expected), {
    name: 'same',
    maxRgb: 0,
    maxFloat: 0,
    passed: true,
  });
  const off = (d: number) => {
    const e = new Uint8ClampedArray(expected);
    e[4 * 1000 + 1] = (e[4 * 1000 + 1] as number) + (e[4 * 1000 + 1]! > 128 ? -d : d);
    return e;
  };
  assert.equal(compareCanary('rgb1', raw, indices, samples, off(1)).passed, true);
  const two = compareCanary('rgb2', raw, indices, samples, off(2));
  assert.deepEqual([two.maxRgb, two.passed], [2, false]);
  const alpha = new Uint8ClampedArray(expected);
  alpha[3] = 0;
  assert.equal(
    compareCanary('alpha', raw, indices, samples, alpha).passed,
    true,
    'alpha is excluded',
  );
  const drift = (d: number) => Float32Array.from(samples, (v, i) => (i === 10 ? v + d : v));
  assert.equal(compareCanary('f-ok', raw, indices, drift(0.0019), expected).passed, true);
  assert.equal(compareCanary('f-bad', raw, indices, drift(0.0021), expected).passed, false);
  assert.equal(compareCanary('f-nan', raw, indices, drift(NaN), expected).passed, false);
  assert.throws(
    () => compareCanary('range', raw, Uint32Array.of(3 * n), Float32Array.of(0), expected),
    /out of range/,
  );
});

test('the reference decoder reads every runtime reference PNG exactly as the candidate decoder', async (t) => {
  const runtime = acquiredManifest();
  // A planted PNG first (the candidate encoder's stored-deflate output), so this runs without the runtime too.
  const rgba = toRgba8(Float32Array.from({ length: 3 * 1024 * 1024 }, (_, i) => Math.sin(i) * 0.9));
  const planted = new Uint8Array(
    await (await controlPng.encodeRgbaPng(rgba, 1024, 1024, { compress: true })).arrayBuffer(),
  );
  assert.deepEqual((await decodeReferencePng(planted)).rgba, rgba);
  const bad = planted.slice();
  bad[40] = (bad[40] as number) ^ 1;
  await assert.rejects(decodeReferencePng(bad), /CRC mismatch/);
  await assert.rejects(decodeReferencePng(planted, { expectedWidth: 512 }), /dimensions/);
  if (!runtime)
    return t.skip('the runtime references are untested: the runtime is not acquired here');
  const canaries = runtime.manifest['canaries'] as { name: string; reference: { url: string } }[];
  assert.equal(canaries.length, 7);
  for (const c of canaries) {
    const bytes = new Uint8Array(readFileSync(pathOf(c.reference)));
    assert.deepEqual(
      (await decodeReferencePng(bytes)).rgba,
      (await controlPng.decodeReferencePng(bytes)).rgba,
      c.name,
    );
  }
});
