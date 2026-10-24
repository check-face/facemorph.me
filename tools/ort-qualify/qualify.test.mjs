// The ORT overlay (fm-bxwv): which manifest entries change and that their digests are the files' own.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { plant, tempDir } from '../../scripts/inventory/testing.mjs';
import { GPU_BUILDS, withOrt } from './qualify.mjs';

const files = Object.fromEntries(
  [
    'ort.wasm.min.mjs',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort.webgpu.min.mjs',
    'ort.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
  ].map((f) => [f, `bytes of ${f}`]),
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pinned = {
  runtime: { version: '1.24.3', moduleUrl: 'https://x/a.mjs', wasmPaths: 'https://x/', assets: [] },
  webgpu: { runtime: { version: '1.22.0' }, prefix: { url: 'https://x/prefix.onnx', sha256: 'p' } },
  canaries: [{ name: 'frame-00', w: { url: 'https://x/w', sha256: 'w' } }],
  synthesis: { url: 'https://x/s.onnx', sha256: 's' },
};

test('the overlay replaces only the six ORT entries, with digests of the files themselves', () => {
  const dist = plant(tempDir('ort-dist-'), files);
  const m = withOrt(pinned, dist, 'https://127.0.0.1:1/', '1.30.0');
  assert.equal(m.runtime.version, '1.30.0');
  assert.equal(m.runtime.moduleUrl, 'https://127.0.0.1:1/ort.wasm.min.mjs');
  assert.deepEqual(
    m.runtime.assets.map((a) => [a.url.split('/').at(-1), a.sha256]),
    ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((f) => [
      f,
      sha(files[f]),
    ]),
  );
  assert.equal(
    m.webgpu.runtime.factory.url,
    'https://127.0.0.1:1/ort-wasm-simd-threaded.asyncify.mjs',
  );
  assert.equal(m.webgpu.runtime.wasm.sha256, sha(files['ort-wasm-simd-threaded.asyncify.wasm']));
  assert.deepEqual(m.canaries, pinned.canaries, 'canaries stay pinned');
  assert.deepEqual(m.synthesis, pinned.synthesis, 'the model stays pinned');
  assert.deepEqual(m.webgpu.prefix, pinned.webgpu.prefix);
  assert.equal(pinned.runtime.version, '1.24.3', 'the pinned manifest is not changed');
  const jsep = withOrt(pinned, dist, 'https://h/', '1.30.0', 'jsep');
  assert.equal(jsep.webgpu.runtime.module.url, 'https://h/ort.min.mjs');
  assert.equal(jsep.webgpu.runtime.factory.url, 'https://h/ort-wasm-simd-threaded.jsep.mjs');
  assert.throws(
    () => withOrt(pinned, dist, 'https://h/', '1.30.0', 'webgl'),
    /unknown --gpu-build/,
  );
  assert.deepEqual(Object.keys(GPU_BUILDS), ['jsep122', 'webgpu', 'jsep']);
});
