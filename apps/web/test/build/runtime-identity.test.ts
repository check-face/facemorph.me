import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { runtimeIdentity } from '../../build/runtime-identity.ts';
import {
  composeManifest,
  generateOverlay,
  ORT_FILES,
  withSerialCompanion,
} from '../../../../scripts/ci/ort-mirror.ts';
import { generateSerialCompanion, SERIAL_ORT_FILES } from '../../../../scripts/ci/serial-ort.ts';
import { createHash } from 'node:crypto';

const repo = new URL('../../../../', import.meta.url);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const inputs = JSON.parse(readFileSync(new URL('import/build-inputs.json', repo), 'utf8'));
const encoderPath =
  'encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json';
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'import'));
  writeFileSync(join(root, 'import/build-inputs.json'), JSON.stringify(inputs));
  cpSync(new URL('import/runtime-manifests', repo), join(root, 'import/runtime-manifests'), {
    recursive: true,
  });
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: '1.30.0' }),
  );
  for (const file of ORT_FILES) writeFileSync(join(dist, file), `synthetic ${file}`);
  const overlay = generateOverlay(dist, {
    version: '1.30.0',
    resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
    integrity: `sha512-${Buffer.alloc(64, 17).toString('base64')}`,
  });
  const controlPath = join(
    root,
    'import/runtime-manifests/control',
    inputs.runtime.manifest.sha256,
    'manifest.json',
  );
  return {
    root,
    dist,
    overlay,
    controlPath,
    control: JSON.parse(readFileSync(controlPath, 'utf8')),
  };
}

test('without an overlay the frozen model, runtime and hosted graph remain exact', (t) => {
  const f = fixture(t);
  assert.deepEqual(runtimeIdentity(f.root), {
    runtimeSha256: inputs.runtime.manifest.sha256,
    modelSha256: inputs.runtime.manifest.modelSourceSha256,
    hosted: inputs.worker_graphs.pinned.map(
      ({ path, sha256 }: { path: string; sha256: string }) => ({ path, sha256 }),
    ),
  });
});

test('schema1 binds exact acquisition serialization and replaces only hosted runtime entries', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'import/runtime-mirror.json'), JSON.stringify(f.overlay));
  const actual = runtimeIdentity(f.root);
  const expected = composeManifest(f.control, f.overlay, 'https://next.facemorph.me');
  assert.equal(actual.runtimeSha256, sha(`${JSON.stringify(expected)}\n`));
  assert.equal(actual.modelSha256, inputs.runtime.manifest.modelSourceSha256);
  for (const file of f.overlay.files)
    assert.ok(actual.hosted.some((x) => x.path === file.path && x.sha256 === file.sha256));
  assert.ok(actual.hosted.some((x) => x.path.endsWith('/photo-worker.mjs')));
  assert.ok(!actual.hosted.some((x) => x.path.endsWith('/ort-wasm-simd-threaded.jsep.mjs')));
  writeFileSync(f.controlPath, readFileSync(f.controlPath, 'utf8') + ' ');
  assert.throws(() => runtimeIdentity(f.root), /frozen control bytes/);
});

test('schema2 binds verified encoder bytes and inventories the actual serial modules', (t) => {
  const f = fixture(t);
  const serial = join(f.root, 'serial');
  mkdirSync(serial);
  for (const file of SERIAL_ORT_FILES)
    writeFileSync(
      join(serial, file),
      file.endsWith('.wasm')
        ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32])
        : `synthetic ${file}`,
    );
  const encoderFile = join(f.root, 'import/runtime-manifests', encoderPath);
  const encoder = readFileSync(encoderFile);
  const companion = generateSerialCompanion(
    serial,
    {
      version: '1.30.0',
      source: {
        repository: 'https://github.com/microsoft/onnxruntime.git',
        tag: 'v1.30.0',
        commit: 'f'.repeat(40),
      },
      toolchain: {
        emsdkVersion: '4.0.23',
        emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56',
      },
      commandSha256: sha('command'),
      linkReceiptSha256: sha('link'),
    },
    encoder,
  );
  const overlay = withSerialCompanion(f.overlay, companion);
  writeFileSync(join(f.root, 'import/runtime-mirror.json'), JSON.stringify(overlay));
  const actual = runtimeIdentity(f.root);
  assert.equal(
    actual.runtimeSha256,
    sha(
      `${JSON.stringify(composeManifest(f.control, overlay, 'https://next.facemorph.me', { controlEncoderDescriptorBytes: encoder }))}\n`,
    ),
  );
  for (const file of companion.files)
    assert.ok(actual.hosted.some((x) => x.path === file.path && x.sha256 === file.sha256));
  assert.ok(
    !actual.hosted.some(
      (x) => x.path === encoderPath.replace('manifest.json', 'ort-wasm-simd.mjs'),
    ),
  );
  assert.ok(actual.hosted.some((x) => x.path.endsWith('/execute.mjs')));
  writeFileSync(encoderFile, Buffer.concat([encoder, Buffer.from(' ')]));
  assert.throws(() => runtimeIdentity(f.root), /frozen encoder bytes/);
});

test('a malformed overlay cannot silently fall back to the frozen runtime', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'import/runtime-mirror.json'), '{}');
  assert.throws(() => runtimeIdentity(f.root), /unsupported overlay schema/);
});
