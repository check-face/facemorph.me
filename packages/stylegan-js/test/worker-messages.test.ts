import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MORPH_FRAMES,
  WorkerMessageError,
  assertCloneSafe,
  validateWorkerRequest,
  validateWorkerResponse,
} from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const ids = { requestId: 'r1', inputRevision: 2, attemptId: 0 };
const latent = (layers = 18, width = 512) => ({ space: 'w-plus', shape: [layers, width], values: new Float32Array(layers * width) });
const hex = 'e'.repeat(64);

const requests = (): Record<string, unknown>[] => [
  { type: 'map', id: 'm', request: { ids, z: new Float32Array(512), truncation: { psi: 0.7, cutoff: 8 } } },
  { type: 'synthesize', id: 's', request: { ids, wPlus: latent(), output: 'rgba' } },
  { type: 'encode', id: 'e', request: { ids, input: { tensor: new Float32Array(196608), tensorDigest: hex, policyVersion: 'crop-preprocessing-v1' }, confirmedCropId: hex } },
  { type: 'extract-metadata', id: 'x', request: { ids, bytes: new Uint8Array(8) } },
  {
    type: 'encode-raw-image',
    id: 'i',
    request: { ids, format: 'png', width: 2, height: 2, rgba: new Uint8ClampedArray(16), recovery: { generationKind: 'seed', generationSha256: hex, provenance: { modelSha256: hex, noiseSha256: hex }, latent: latent() } },
  },
  {
    type: 'render-morph',
    id: 'v',
    request: { ids, endpoints: [latent(), latent(), latent()], settings: { kind: 'pairwise-figure8', width: 0.6, pinch: true, frames: 16, fps: 24 }, frameCount: 48, fps: 24, resolution: 1024, branch: 'blob-stream' },
  },
  { type: 'raw-frame-ack', id: 'v', index: 7 },
  { type: 'status', id: 'q' },
  { type: 'cancel', id: 'q' },
  { type: 'dispose', id: 'q' },
];

const responses = (): Record<string, unknown>[] => [
  { type: 'progress', id: 's', stage: 'synthesis', fraction: 0.5 },
  { type: 'stage-timing', id: 's', event: { ids, operation: 'synthesize', stage: 'readback', route: 'webgpu', startedAtMs: 1, completedAtMs: 3, boundary: 'map-async-complete' } },
  { type: 'frame', id: 'v', index: 0, width: 2, height: 2, rgba: new Uint8ClampedArray(16), anchor: true },
  { type: 'settled', id: 's', settlement: { status: 'superseded', ids, by: { ...ids, inputRevision: 3 } } },
  { type: 'settled', id: 's', settlement: { status: 'failed', ids, error: { code: 'route-failed', message: 'x', correctnessFailure: true } } },
  { type: 'status', id: 'q', provider: { requested: 'auto', actual: 'cpu', admission: 'admitted', validation: 'validated' }, busy: false, unsupported: [] },
];

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'accepted';
  } catch (e) {
    assert.ok(e instanceof WorkerMessageError, `untyped rejection: ${String(e)}`);
    return e.code;
  }
};

test('every request and response type validates', () => {
  for (const m of requests()) assert.equal(code(() => validateWorkerRequest(m)), 'accepted', String(m.type));
  for (const m of responses()) assert.equal(code(() => validateWorkerResponse(m)), 'accepted', String(m.type));
});

test('functions, promises and signals never cross the worker boundary', () => {
  const signal = new AbortController().signal;
  assert.equal(code(() => validateWorkerRequest({ type: 'status', id: 'q', onDone: () => {} })), 'non-cloneable');
  assert.equal(code(() => validateWorkerRequest({ type: 'status', id: 'q', done: Promise.resolve() })), 'non-cloneable');
  assert.equal(code(() => validateWorkerRequest({ type: 'cancel', id: 'q', signal })), 'non-cloneable');
  assert.equal(code(() => assertCloneSafe({ deep: [{ f: Symbol('x') }] })), 'non-cloneable');
});

test('invalid fields are typed rejections', () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ type: 'teleport', id: 'q' }, 'unknown-type'],
    [{ type: 'status', id: '' }, 'invalid-field'],
    [{ ...requests()[1]!, request: { ids, wPlus: latent(18, 256), output: 'rgba' } }, 'accepted'], // shape is the model's, not fixed
    [{ ...requests()[1]!, request: { ids, wPlus: { ...latent(), values: new Float32Array(10) }, output: 'rgba' } }, 'invalid-field'],
    [{ ...requests()[2]!, request: { ...(requests()[2]!.request as object), confirmedCropId: 'nope' } }, 'invalid-field'],
    [{ ...requests()[5]!, request: { ...(requests()[5]!.request as object), endpoints: [latent()] } }, 'invalid-field'],
    [{ ...requests()[5]!, request: { ...(requests()[5]!.request as object), frameCount: MAX_MORPH_FRAMES + 1 } }, 'invalid-field'],
    [{ ...requests()[5]!, request: { ...(requests()[5]!.request as object), settings: { kind: 'spiral', width: 0.5, pinch: false, frames: 16, fps: 24 } } }, 'invalid-field'],
  ];
  for (const [m, expected] of bad) assert.equal(code(() => validateWorkerRequest(m)), expected, JSON.stringify(m.type));
  assert.equal(code(() => validateWorkerRequest(null)), 'not-an-object');
  assert.equal(code(() => validateWorkerResponse({ type: 'frame', id: 'v', index: 0, width: 2, height: 2, rgba: new Uint8ClampedArray(3), anchor: false })), 'invalid-field');
  assert.equal(code(() => validateWorkerResponse({ type: 'stage-timing', id: 's', event: { ids, stage: 'synthesis', startedAtMs: 5, completedAtMs: 1, boundary: 'inference-complete' } })), 'invalid-field');
});

/** Replaces one randomly chosen nested value. */
function mutate(value: unknown, random: () => number, odd: unknown[]): unknown {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return odd[Math.floor(random() * odd.length)];
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) };
  const keys = Object.keys(copy);
  if (keys.length === 0 || random() < 0.15) return odd[Math.floor(random() * odd.length)];
  const key = keys[Math.floor(random() * keys.length)]!;
  if (random() < 0.1) delete (copy as Record<string, unknown>)[key];
  else (copy as Record<string, unknown>)[key] = mutate((copy as Record<string, unknown>)[key], random, odd);
  return copy;
}

test('fuzz (seed 1024, 4000 cases): mutated worker payloads are accepted or rejected with a typed error', () => {
  const random = mulberry32(1024);
  const odd: unknown[] = [null, undefined, -1, 0, 1.5, NaN, Infinity, '', 'x', [], {}, true, () => 1, Promise.resolve(), new Float32Array(3), new Uint8Array(2), 2 ** 53, Symbol('s')];
  const counts: Record<string, number> = {};
  const cases = 4000;
  for (let i = 0; i < cases; i++) {
    const request = i % 2 === 0;
    const pool = request ? requests() : responses();
    const m = mutate(pool[Math.floor(random() * pool.length)], random, odd);
    const c = code(() => (request ? validateWorkerRequest(m) : validateWorkerResponse(m)));
    counts[c] = (counts[c] ?? 0) + 1;
  }
  assert.equal(Object.values(counts).reduce((a, b) => a + b), cases);
  assert.ok((counts['invalid-field'] ?? 0) > cases / 4, 'the fuzz reaches field validation');
  console.log(`worker-message fuzz: ${cases} cases`, counts);
});
