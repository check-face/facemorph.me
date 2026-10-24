// Weighted face blend (fm-mtax): against a fixture computed by classic LatentByMultiLerp's own arithmetic in numpy
// (test/vectors/blend/make_fixture.py), the latents regenerated here from the same formula. Plain values only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blend, clampWeight, latentDigest } from '../src/blend/blend.ts';
import {
  AFHQ_CAT_512_DESCRIPTOR,
  FFHQ_1024_DESCRIPTOR,
  type ModelDescriptor,
} from '../src/contracts/descriptor.ts';
import type { LatentTensor } from '../src/contracts/operations.ts';

const dir = new URL('./vectors/blend/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('cases.json', dir), 'utf8')) as {
  cases: {
    name: string;
    layers: number;
    width: number;
    weights: number[];
    clampedWeights: number[];
    weightSum: number;
    expected: string;
  }[];
};
const latent = (k: number, layers: number, width: number): LatentTensor => {
  const values = new Float32Array(layers * width);
  for (let i = 0; i < values.length; i++)
    values[i] = Math.sin(k * 1.618 + i * 0.0137) * (1 + (k % 5) * 0.3);
  return { space: 'w-plus', shape: [layers, width], values };
};
const descriptorFor = (layers: number): ModelDescriptor =>
  layers === 18 ? FFHQ_1024_DESCRIPTOR : AFHQ_CAT_512_DESCRIPTOR;

test('blend matches classic LatentByMultiLerp arithmetic for 1, 16 and 500 slots and a 16-layer model (raw error <= 1e-4)', () => {
  assert.deepEqual(
    fixture.cases.map((c) => c.weights.length),
    [1, 16, 500, 3],
  );
  for (const c of fixture.cases) {
    const d = descriptorFor(c.layers);
    assert.equal(d.latent.layers, c.layers, `${c.name}: the descriptor gives the shape`);
    const r = blend(
      d,
      c.weights.map((_, k) => latent(k, c.layers, c.width)),
      c.weights,
    );
    assert.ok(r.ok, c.name);
    const b = readFileSync(new URL(c.expected, dir));
    const expected = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    let max = 0;
    for (let i = 0; i < expected.length; i++)
      max = Math.max(max, Math.abs(r.value.latent.values[i]! - expected[i]!));
    assert.ok(max <= 1e-4, `${c.name}: max raw error ${max}`);
    assert.deepEqual(r.value.weights, c.clampedWeights, `${c.name}: clamped as the API clamped`);
    assert.ok(Math.abs(r.value.weightSum - c.weightSum) < 1e-9);
    assert.deepEqual(r.value.latent.shape, [c.layers, c.width]);
  }
});

test('clamping and the unnormalised sum: -2.5 -> -2, 3 -> 2; weights 1 and 1 give the sum; negative weights subtract', () => {
  assert.equal(clampWeight(-2.5), -2);
  assert.equal(clampWeight(3), 2);
  assert.equal(clampWeight(0.4), 0.4);
  const a = latent(1, 18, 512);
  const b = latent(2, 18, 512);
  const sum = blend(FFHQ_1024_DESCRIPTOR, [a, b], [1, 1]);
  assert.ok(sum.ok);
  assert.equal(
    sum.value.latent.values[100],
    Math.fround(a.values[100]! + b.values[100]!),
    'the sum, not the mean',
  );
  assert.equal(sum.value.weightSum, 2);
  const diff = blend(FFHQ_1024_DESCRIPTOR, [a, b], [1, -1]);
  assert.ok(diff.ok);
  assert.equal(diff.value.latent.values[7], Math.fround(a.values[7]! - b.values[7]!));
});

test('refusals are typed: no slots, a weight count mismatch, a non-finite weight, a non-W+ latent, a wrong shape', () => {
  const a = latent(1, 18, 512);
  const code = (r: ReturnType<typeof blend>) => (r.ok ? 'ok' : r.error.code);
  assert.equal(code(blend(FFHQ_1024_DESCRIPTOR, [], [])), 'no-slots');
  assert.equal(code(blend(FFHQ_1024_DESCRIPTOR, [a], [1, 1])), 'weight-count');
  assert.equal(code(blend(FFHQ_1024_DESCRIPTOR, [a], [Number.NaN])), 'weight-not-finite');
  const z = { space: 'z', shape: [18, 512], values: a.values } as unknown as LatentTensor;
  assert.equal(code(blend(FFHQ_1024_DESCRIPTOR, [a, z], [1, 1])), 'not-w-plus');
  const afhq = latent(1, 16, 512);
  const r = blend(FFHQ_1024_DESCRIPTOR, [a, afhq], [1, 1]);
  assert.deepEqual(r.ok ? null : [r.error.code, r.error.slot], ['shape-mismatch', 1]);
  assert.equal(code(blend(AFHQ_CAT_512_DESCRIPTOR, [afhq], [1])), 'ok', 'no hard-coded 18 x 512');
});

test('cache key: equal for equal clamped inputs, different for any changed weight or latent', () => {
  const a = latent(1, 18, 512);
  const b = latent(2, 18, 512);
  const key = (ls: LatentTensor[], ws: number[]) => {
    const r = blend(FFHQ_1024_DESCRIPTOR, ls, ws);
    assert.ok(r.ok);
    return r.value.cacheKey;
  };
  const base = key([a, b], [0.5, 1]);
  assert.equal(key([a, b], [0.5, 1]), base);
  assert.equal(
    key([a, b], [0.5, 1]),
    key([{ ...a, values: a.values.slice() }, b], [0.5, 1]),
    'by digest, not identity',
  );
  assert.equal(key([a, b], [0.5, 2]), key([a, b], [0.5, 7]), 'equal after clamping');
  assert.notEqual(key([a, b], [0.5, 0.75]), base);
  const changed = a.values.slice();
  changed[0] = changed[0]! + 1e-3;
  assert.notEqual(latentDigest({ ...a, values: changed }), latentDigest(a));
  assert.notEqual(key([{ ...a, values: changed }, b], [0.5, 1]), base);
  assert.notEqual(key([b, a], [0.5, 1]), base, 'slot order is part of the key');
});
