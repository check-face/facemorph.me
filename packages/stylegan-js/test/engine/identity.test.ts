// The ported latent identity against the control: the candidate's own identity.mjs (apps/web/src/Next/browser, as
// imported from classic a42829b) and its fixture digests. Plain values in, plain values out.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  generationIdentity,
  inputLatent,
  randomState,
  requireLatent,
  toRgba8,
  truncate,
} from '../../src/engine/identity.ts';
import { acquiredManifest } from './support/runtime.ts';

const CONTROL = '../../../../apps/web/src/Next/browser/';
const control = (await import(CONTROL + 'identity.mjs')) as {
  inputLatent(mode: string, value: string): Promise<{ values: Float32Array; identity: unknown }>;
  truncate(w: Float32Array, a: Float32Array, psi?: number, cutoff?: number): Float32Array;
  rgba1024(raw: Float32Array): Uint8ClampedArray;
  generationIdentity(manifest: unknown, kind: string): unknown;
  randomState(seed: number | number[]): { normal(): number };
};
const fixtures = JSON.parse(
  readFileSync(new URL(CONTROL + 'identity-fixtures.json', import.meta.url), 'utf8'),
) as {
  cases: { mode: 'seed' | 'text'; value: string; sha256: string }[];
};
const digest = (a: Float32Array) =>
  createHash('sha256')
    .update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex');

test('z for every fixture matches the candidate fixture digests and the control, bit for bit', async () => {
  assert.ok(fixtures.cases.length >= 4);
  for (const c of fixtures.cases) {
    const ours = inputLatent(c.mode, c.value);
    const theirs = await control.inputLatent(c.mode, c.value);
    assert.equal(digest(ours.z), digest(theirs.values), `${c.mode} ${c.value}`);
    assert.deepEqual(ours.identity, theirs.identity);
    assert.equal(digest(ours.z), c.sha256, `${c.mode} ${c.value} fixture`);
  }
});

test('more seeds, texts and a uint32 key agree with the control', async () => {
  for (const seed of ['2', '7', '42', '123456789', '4294967294'])
    assert.equal(
      digest(inputLatent('seed', seed).z),
      digest((await control.inputLatent('seed', seed)).values),
    );
  for (const text of ['', 'x', 'Zoë 🙂', 'a'.repeat(512)])
    assert.equal(
      digest(inputLatent('text', text).z),
      digest((await control.inputLatent('text', text)).values),
    );
  const a = randomState([1, 2, 3, 0xffffffff]),
    b = control.randomState([1, 2, 3, 0xffffffff]);
  for (let i = 0; i < 2000; i++) assert.equal(a.normal(), b.normal());
});

test('invalid inputs are refused as the candidate refuses them', async () => {
  for (const [mode, value] of [
    ['seed', '-1'],
    ['seed', '4294967296'],
    ['seed', '1.5'],
    ['seed', ''],
    ['text', 'a'.repeat(513)],
    ['photo', '1'],
  ] as const) {
    assert.throws(() => inputLatent(mode as 'seed', value), TypeError, `${mode} ${value}`);
    await assert.rejects(control.inputLatent(mode, value), TypeError);
  }
});

test('truncation and RGBA8 conversion equal the control on awkward values', () => {
  const w = Float32Array.from({ length: 9216 }, (_, i) => Math.sin(i * 12.9898) * 3.7);
  const avg = Float32Array.from({ length: 512 }, (_, i) => Math.cos(i) * 0.3);
  for (const [psi, cutoff] of [
    [0.7, 8],
    [0, 18],
    [1, 0],
    [0.3333333, 5],
  ] as const)
    assert.equal(
      digest(truncate(w, avg, psi, cutoff)),
      digest(control.truncate(w, avg, psi, cutoff)),
    );
  assert.throws(() => truncate(w, avg, 1.5, 8));
  assert.throws(() => truncate(w, avg, 0.7, 19));
  // Values on and around the quantisation steps, plus the clamps.
  const raw = Float32Array.from(
    { length: 3 * 1024 * 1024 },
    (_, i) => ((i % 600) - 300) / 255 + (i % 7) * 1e-7,
  );
  raw[5] = -9;
  raw[6] = 9;
  assert.deepEqual(toRgba8(raw), control.rgba1024(raw));
  raw[7] = NaN;
  assert.throws(() => toRgba8(raw), /Nonfinite/);
  assert.throws(() => requireLatent(new Float32Array(10)), TypeError);
  assert.throws(() => requireLatent(new Float64Array(9216)), TypeError);
});

test('the generation identity serialises exactly as the control, with and without encoder fields', (t) => {
  const minimal = {
    synthesis: { sha256: 's' },
    mapping: { sha256: 'm' },
    average: { sha256: 'a' },
    noise: [{ name: 'noise_0', shape: [4, 4], sha256: 'n' }],
  };
  for (const kind of ['seed', 'photo', 'latent'] as const)
    assert.equal(
      JSON.stringify(generationIdentity(minimal, kind)),
      JSON.stringify(control.generationIdentity(minimal, kind)),
      kind,
    );
  const runtime = acquiredManifest();
  if (!runtime)
    return t.skip('the real manifest case is untested: the candidate runtime is not acquired here');
  const m = runtime.manifest as unknown as Parameters<typeof generationIdentity>[0];
  for (const kind of ['seed', 'photo', 'latent'] as const)
    assert.equal(
      JSON.stringify(generationIdentity(m, kind)),
      JSON.stringify(control.generationIdentity(m, kind)),
      kind,
    );
});
