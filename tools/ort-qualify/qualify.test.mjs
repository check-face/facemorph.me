// The ORT overlay (fm-bxwv): which manifest entries change and that their digests are the files' own.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { plant, tempDir } from '../../scripts/inventory/testing.mjs';
import { GPU_BUILDS, qualificationIdentity, withOrt } from './qualify.mjs';

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
    'ort.jspi.min.mjs',
    'ort-wasm-simd-threaded.jspi.mjs',
    'ort-wasm-simd-threaded.jspi.wasm',
  ].map((f) => [f, `bytes of ${f}`]),
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pinned = {
  runtime: { version: '1.24.3', moduleUrl: 'https://x/a.mjs', wasmPaths: 'https://x/', assets: [] },
  webgpu: { runtime: { version: '1.22.0' }, prefix: { url: 'https://x/prefix.onnx', sha256: 'p' } },
  canaries: [{ name: 'frame-00', w: { url: 'https://x/w', sha256: 'w' } }],
  synthesis: { url: 'https://x/s.onnx', sha256: 's' },
};

const gpuFiles = {
  jsep122: [
    'ort.webgpu.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ],
  webgpu: [
    'ort.webgpu.min.mjs',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
  ],
  jspi: ['ort.jspi.min.mjs', 'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm'],
  jsep: ['ort.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'],
};

for (const [gpuBuild, expectedFiles] of Object.entries(gpuFiles))
  test(`${gpuBuild} overlay replaces only six ORT entries with exact file digests`, () => {
    const dist = plant(tempDir('ort-dist-'), files);
    const base = 'https://127.0.0.1:1/';
    const m = withOrt(pinned, dist, base, '1.30.0', gpuBuild);
    assert.equal(m.runtime.version, '1.30.0');
    assert.equal(m.runtime.moduleUrl, 'https://127.0.0.1:1/ort.wasm.min.mjs');
    assert.deepEqual(
      m.runtime.assets.map((a) => [a.url.split('/').at(-1), a.sha256]),
      ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((f) => [
        f,
        sha(files[f]),
      ]),
    );
    for (const [index, field] of ['module', 'factory', 'wasm'].entries()) {
      const file = expectedFiles[index];
      assert.deepEqual(m.webgpu.runtime[field], {
        url: base + file,
        sha256: sha(files[file]),
        size: Buffer.byteLength(files[file]),
      });
    }
    assert.deepEqual(m.canaries, pinned.canaries, 'canaries stay pinned');
    assert.deepEqual(m.synthesis, pinned.synthesis, 'the model stays pinned');
    assert.deepEqual(m.webgpu.prefix, pinned.webgpu.prefix);
    assert.equal(pinned.runtime.version, '1.24.3', 'the pinned manifest is not changed');
    if (gpuBuild === 'webgpu') assert.deepEqual(withOrt(pinned, dist, base, '1.30.0'), m);
  });

test('unknown GPU builds cannot select an accidental bundle', () => {
  const dist = plant(tempDir('ort-dist-'), files);
  for (const gpuBuild of ['webgl', 'toString', '__proto__'])
    assert.throws(
      () => withOrt(pinned, dist, 'https://h/', '1.30.0', gpuBuild),
      /unknown --gpu-build/,
    );
  assert.deepEqual(Object.keys(GPU_BUILDS), Object.keys(gpuFiles));
});

const controlFixture = (dist) => {
  const manifest = withOrt(pinned, dist, 'https://control.example/', '1.24.3', 'jsep122');
  manifest.webgpu.runtime.version = '1.22.0';
  return manifest;
};
const bytes = (value) => Buffer.from(JSON.stringify(value));
const packageBytes = bytes({ name: 'onnxruntime-web', version: '1.30.0' });

test('qualification identity binds exact source, control, served candidate and release bytes per GPU build', () => {
  const dist = plant(tempDir('ort-identity-'), files);
  const control = controlFixture(dist);
  const controlBytes = Buffer.from(JSON.stringify(control, null, 2) + '\n');
  const sets = new Set();
  for (const gpuBuild of Object.keys(gpuFiles)) {
    const candidate = withOrt(control, dist, 'https://127.0.0.1:1234/', '1.30.0', gpuBuild);
    const candidateBytes = bytes(candidate);
    const identity = qualificationIdentity({
      controlBytes,
      candidateBytes,
      gpuBuild,
      packageBytes,
    });
    assert.equal(identity.source.classicCommit, 'a42829bb0582b5a7a55ba6b1045a05861612b8a5');
    assert.equal(identity.source.classicManifestSha256, sha(controlBytes));
    assert.equal(
      identity.source.qualifierSha256,
      sha(readFileSync(new URL('./qualify.mjs', import.meta.url))),
    );
    assert.equal(
      identity.source.harnessSha256,
      sha(readFileSync(new URL('../names-generator/harness.mjs', import.meta.url))),
    );
    assert.match(identity.scope, /pinned-classic/);
    assert.equal(identity.controlManifestSha256, sha(controlBytes));
    assert.equal(identity.candidateManifestSha256, sha(candidateBytes));
    assert.notEqual(
      identity.controlManifestSha256,
      sha(bytes(control)),
      'control bytes are not reserialized before hashing',
    );
    assert.deepEqual(identity.release, {
      package: 'onnxruntime-web',
      version: '1.30.0',
      packageJsonSha256: sha(packageBytes),
    });
    assert.equal(identity.gpuBuild, gpuBuild);
    assert.equal(identity.assets.length, 6);
    for (const asset of identity.assets) {
      assert.equal(asset.sha256, sha(files[asset.file]));
      assert.equal(asset.size, Buffer.byteLength(files[asset.file]));
    }
    assert.match(identity.runtimeSetSha256, /^[a-f0-9]{64}$/);
    sets.add(identity.runtimeSetSha256);
    const relocated = bytes(withOrt(control, dist, 'https://127.0.0.1:5678/', '1.30.0', gpuBuild));
    const next = qualificationIdentity({
      controlBytes,
      candidateBytes: relocated,
      gpuBuild,
      packageBytes,
    });
    assert.notEqual(identity.candidateManifestSha256, next.candidateManifestSha256);
    assert.equal(
      identity.runtimeSetSha256,
      next.runtimeSetSha256,
      'serving ports do not change the release byte set',
    );
  }
  assert.equal(sets.size, Object.keys(gpuFiles).length);
});

test('the pinned control retains exact manifest identity and honestly names its mixed runtime versions', () => {
  const dist = plant(tempDir('ort-control-identity-'), files);
  const controlBytes = bytes(controlFixture(dist));
  const identity = qualificationIdentity({
    controlBytes,
    candidateBytes: controlBytes,
    gpuBuild: 'jsep122',
  });
  assert.equal(identity.controlManifestSha256, identity.candidateManifestSha256);
  assert.deepEqual(identity.release, {
    package: 'onnxruntime-web',
    cpuVersion: '1.24.3',
    webgpuVersion: '1.22.0',
  });
  assert.equal(identity.gpuBuild, 'jsep122');
});

test('a candidate cannot claim a release without matching package and version identity', () => {
  const dist = plant(tempDir('ort-invalid-identity-'), files);
  const control = controlFixture(dist);
  const input = {
    controlBytes: bytes(control),
    candidateBytes: bytes(withOrt(control, dist, 'https://local.example/', '1.30.0')),
    gpuBuild: 'webgpu',
  };
  assert.throws(() => qualificationIdentity(input), /requires the supplied ORT package identity/);
  for (const pkg of [
    { name: 'other', version: '1.30.0' },
    { name: 'onnxruntime-web', version: '' },
  ])
    assert.throws(
      () => qualificationIdentity({ ...input, packageBytes: bytes(pkg) }),
      /must identify/,
    );
  assert.throws(
    () =>
      qualificationIdentity({
        ...input,
        packageBytes: bytes({ name: 'onnxruntime-web', version: '1.29.0' }),
      }),
    /runtime versions differ/,
  );
  assert.throws(
    () => qualificationIdentity({ ...input, packageBytes, gpuBuild: 'unknown' }),
    /unknown --gpu-build/,
  );
});
