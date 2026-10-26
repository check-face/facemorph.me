import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadCandidateRuntime, type RuntimeBuildInputs } from './candidate-runtime.ts';
import {
  composeManifest,
  generateOverlay,
  ORT_FILES,
  withSerialCompanion,
  type OrtMirrorOverlay,
} from './ort-mirror.ts';
import {
  composeEncoderDescriptor,
  generateSerialCompanion,
  SERIAL_ORT_FILES,
} from './serial-ort.ts';

const repo = new URL('../../', import.meta.url);
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const inputsBytes = readFileSync(new URL('import/build-inputs.json', repo));
const inputs = JSON.parse(inputsBytes.toString('utf8')) as RuntimeBuildInputs;
const controlBytes = readFileSync(
  new URL(`import/runtime-manifests/control/${inputs.runtime.manifest.sha256}/manifest.json`, repo),
);
const control = JSON.parse(controlBytes.toString('utf8'));
const encoderPath = new URL(control.encoderStream.url).pathname.slice('/runtime/'.length);
const encoderBytes = readFileSync(new URL(`import/runtime-manifests/${encoderPath}`, repo));
const lock = {
  version: '1.30.0',
  resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
  integrity: `sha512-${Buffer.alloc(64, 17).toString('base64')}`,
};

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'candidate-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plant = (path: string, bytes: Uint8Array | string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  plant('import/build-inputs.json', inputsBytes);
  const controlPath = `import/runtime-manifests/control/${inputs.runtime.manifest.sha256}/manifest.json`;
  plant(controlPath, controlBytes);
  plant(`import/runtime-manifests/${encoderPath}`, encoderBytes);
  plant('npm/package.json', JSON.stringify({ name: 'onnxruntime-web', version: lock.version }));
  for (const file of ORT_FILES) plant(`npm/dist/${file}`, `synthetic npm fixture ${file}`);
  const overlay = generateOverlay(join(root, 'npm/dist'), lock);
  const writeOverlay = (value: unknown) =>
    plant('import/runtime-mirror.json', JSON.stringify(value));
  const serial = (bytes = encoderBytes) => {
    for (const file of SERIAL_ORT_FILES)
      plant(
        `serial/${file}`,
        file.endsWith('.wasm')
          ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32])
          : `synthetic serial fixture ${file}`,
      );
    const companion = generateSerialCompanion(
      join(root, 'serial'),
      {
        version: lock.version,
        source: {
          repository: 'https://github.com/microsoft/onnxruntime.git',
          tag: 'v1.30.0',
          commit: 'f'.repeat(40),
        },
        toolchain: {
          emsdkVersion: '4.0.23',
          emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56',
        },
        commandSha256: hash('synthetic build command'),
        linkReceiptSha256: hash('synthetic link command'),
      },
      bytes,
    );
    return { companion, overlay: withSerialCompanion(overlay, companion) };
  };
  const repinControl = (value: unknown) => {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    const sha256 = hash(bytes);
    const next = {
      ...inputs,
      runtime: {
        ...inputs.runtime,
        manifest: { ...inputs.runtime.manifest, sha256, bytes: bytes.length },
        assets: inputs.runtime.assets.map((row) =>
          row.path === 'manifest.json' ? { ...row, sha256, bytes: bytes.length } : row,
        ),
      },
    };
    plant('import/build-inputs.json', JSON.stringify(next));
    plant(`import/runtime-manifests/control/${sha256}/manifest.json`, bytes);
  };
  return { root, plant, controlPath, overlay, writeOverlay, serial, repinControl };
}

function assertRetained(result: ReturnType<typeof loadCandidateRuntime>, added: number) {
  const rows = new Map(result.buildInputs.runtime.assets.map((row) => [row.path, row]));
  assert.equal(rows.size, inputs.runtime.assets.length + added);
  for (const row of inputs.runtime.assets)
    if (row.path !== 'manifest.json')
      assert.deepEqual(rows.get(row.path), row, `${row.path}: all frozen metadata retained`);
  assert.deepEqual(result.controlBuildInputs, inputs);
  assert.equal(result.modelSha256, inputs.runtime.manifest.modelSourceSha256);
  const rootRow = rows.get('manifest.json')!;
  assert.equal(rootRow.sha256, result.manifestSha256);
  assert.equal(rootRow.bytes, result.manifestBytes.length);
  assert.equal(rootRow.location, 'derived:import/runtime-mirror.json');
  assert.deepEqual(rootRow.acquire, ['ort-mirror']);
  assert.equal(result.buildInputs.runtime.manifest.source, rootRow.location);
  assert.equal(result.buildInputs.runtime.manifest.sha256, result.manifestSha256);
  assert.equal(result.buildInputs.runtime.manifest.bytes, result.manifestBytes.length);
}

function expectedHosted(overlay: OrtMirrorOverlay, serial: boolean) {
  const replaced = new Set<string>();
  const remove = (asset: { url: string }) =>
    replaced.add(new URL(asset.url).pathname.slice('/runtime/'.length));
  control.runtime.assets.forEach(remove);
  for (const field of ['module', 'factory', 'wasm']) remove(control.webgpu.runtime[field]);
  if (serial) {
    const encoder = JSON.parse(encoderBytes.toString('utf8'));
    for (const field of ['module', 'factory', 'wasm']) remove(encoder.runtime[field]);
  }
  return [
    ...inputs.worker_graphs.pinned.filter((row) => !replaced.has(row.path)),
    ...[...overlay.files, ...(overlay.serial?.files ?? [])].map(({ path, sha256 }) => ({
      path,
      sha256,
      location: `https://next.facemorph.me/runtime/${path}`,
    })),
  ];
}

test('no overlay retains the exact frozen metadata and original serialized manifest; environment pins have no authority', (t) => {
  const f = fixture(t);
  const previous = process.env['FACEMORPH_RUNTIME_SHA256'];
  process.env['FACEMORPH_RUNTIME_SHA256'] = 'arbitrary-untrusted-pin';
  t.after(() => {
    if (previous === undefined) delete process.env['FACEMORPH_RUNTIME_SHA256'];
    else process.env['FACEMORPH_RUNTIME_SHA256'] = previous;
  });
  const result = loadCandidateRuntime(f.root);
  assert.deepEqual(result.buildInputs, inputs);
  assert.deepEqual(result.controlBuildInputs, inputs);
  assert.notEqual(result.buildInputs, result.controlBuildInputs);
  assert.deepEqual(result.manifestBytes, controlBytes);
  assert.deepEqual(result.controlManifestBytes, controlBytes);
  assert.equal(result.manifestSha256, inputs.runtime.manifest.sha256);
  assert.equal(result.overlay, null);
  assert.equal(result.encoderDescriptor, undefined);
  assert.deepEqual(
    result.hosted,
    inputs.worker_graphs.pinned.map(({ path, sha256 }) => ({ path, sha256 })),
  );
});

test('schema1 matches acquisition serialization and retains every old asset and acquisition source', (t) => {
  const f = fixture(t);
  f.writeOverlay(f.overlay);
  const result = loadCandidateRuntime(f.root);
  const expected = Buffer.from(
    `${JSON.stringify(composeManifest(control, f.overlay, 'https://next.facemorph.me'))}\n`,
  );
  assert.deepEqual(result.manifestBytes, expected);
  assert.equal(result.manifestSha256, hash(expected));
  assertRetained(result, 6);
  assert.deepEqual(result.buildInputs.worker_graphs.pinned, expectedHosted(f.overlay, false));
  for (const file of f.overlay.files)
    assert.deepEqual(
      result.buildInputs.runtime.assets.find((row) => row.path === file.path),
      {
        path: file.path,
        sha256: file.sha256,
        bytes: file.size,
        location: `https://next.facemorph.me/runtime/${file.path}`,
        acquire: ['ort-mirror'],
      },
    );
  assert.deepEqual(readFileSync(join(f.root, 'import/build-inputs.json')), inputsBytes);
  assert.deepEqual(readFileSync(join(f.root, f.controlPath)), controlBytes);
});

test('schema2 adds only six npm files, three serial files and the exact derived descriptor to the retained tree', (t) => {
  const f = fixture(t);
  const s = f.serial();
  f.writeOverlay(s.overlay);
  const result = loadCandidateRuntime(f.root);
  const descriptor = composeEncoderDescriptor(
    encoderBytes,
    s.companion,
    'https://next.facemorph.me',
  );
  const manifest = composeManifest(control, s.overlay, 'https://next.facemorph.me', {
    controlEncoderDescriptorBytes: encoderBytes,
  });
  assert.deepEqual(result.manifestBytes, Buffer.from(`${JSON.stringify(manifest)}\n`));
  assert.deepEqual(result.encoderDescriptor, descriptor);
  assert.deepEqual(result.controlEncoderDescriptorBytes, encoderBytes);
  assertRetained(result, 10);
  assert.deepEqual(result.buildInputs.worker_graphs.pinned, expectedHosted(s.overlay, true));
  const oldEncoder = JSON.parse(encoderBytes.toString('utf8'));
  const { runtime: oldRuntime, ...oldFields } = oldEncoder;
  const { runtime: newRuntime, ...newFields } = descriptor.manifest;
  assert.deepEqual(
    newFields,
    oldFields,
    'all108steps, model, reference, tolerance and admission fields preserved',
  );
  assert.notDeepEqual(newRuntime, oldRuntime);
  assert.deepEqual(
    result.buildInputs.runtime.assets.find((row) => row.path === descriptor.path),
    {
      path: descriptor.path,
      sha256: descriptor.asset.sha256,
      bytes: descriptor.asset.size,
      location: 'derived:import/runtime-mirror.json',
      acquire: ['ort-mirror'],
    },
  );
  assert.ok(
    result.hosted.some((row) => row.path === encoderPath.replace('manifest.json', 'execute.mjs')),
  );
  assert.ok(
    !result.hosted.some(
      (row) => row.path === encoderPath.replace('manifest.json', 'ort-wasm-simd.mjs'),
    ),
  );
  for (const file of s.companion.files)
    assert.ok(result.hosted.some((row) => row.path === file.path && row.sha256 === file.sha256));
  assert.deepEqual(readFileSync(join(f.root, 'import/build-inputs.json')), inputsBytes);
  assert.deepEqual(
    readFileSync(join(f.root, 'import/runtime-manifests', encoderPath)),
    encoderBytes,
  );
});

test('a corrupt canonical control is rejected even without an overlay', (t) => {
  const f = fixture(t);
  f.plant(f.controlPath, Buffer.concat([controlBytes, Buffer.from(' ')]));
  assert.throws(() => loadCandidateRuntime(f.root), /frozen control bytes differ/);
});

test('a corrupt canonical encoder is rejected against the control pin before schema2 composition', (t) => {
  const f = fixture(t);
  f.writeOverlay(f.serial().overlay);
  f.plant(
    `import/runtime-manifests/${encoderPath}`,
    Buffer.concat([encoderBytes, Buffer.from(' ')]),
  );
  assert.throws(() => loadCandidateRuntime(f.root), /frozen encoder bytes differ/);
});

test('schema2 cannot authorize a different encoder through its own internally consistent companion', (t) => {
  const f = fixture(t);
  f.writeOverlay(f.serial(Buffer.concat([encoderBytes, Buffer.from(' ')])).overlay);
  assert.throws(() => loadCandidateRuntime(f.root), /trusted control descriptor digest mismatch/);
});

for (const url of [
  control.encoderStream.url + '?download=1',
  control.encoderStream.url.replace('https://', 'https://user@'),
  control.encoderStream.url.replace('next.facemorph.me', 'example.com'),
])
  test(`schema2 rejects a noncanonical frozen encoder URL: ${url}`, (t) => {
    const f = fixture(t);
    f.writeOverlay(f.serial().overlay);
    f.repinControl({ ...control, encoderStream: { ...control.encoderStream, url } });
    assert.throws(() => loadCandidateRuntime(f.root), /canonical descriptor/);
  });

test('malformed overlay, mismatched root row, model source and colliding assets fail closed', (t) => {
  const f = fixture(t);
  f.writeOverlay({});
  assert.throws(() => loadCandidateRuntime(f.root), /unsupported overlay schema/);
  f.writeOverlay(f.overlay);
  f.plant(
    'import/build-inputs.json',
    JSON.stringify({
      ...inputs,
      runtime: {
        ...inputs.runtime,
        assets: inputs.runtime.assets.filter((row) => row.path !== 'manifest.json'),
      },
    }),
  );
  assert.throws(() => loadCandidateRuntime(f.root), /root asset row differs/);
  f.plant(
    'import/build-inputs.json',
    JSON.stringify({
      ...inputs,
      runtime: {
        ...inputs.runtime,
        manifest: { ...inputs.runtime.manifest, modelSourceSha256: '0'.repeat(64) },
      },
    }),
  );
  assert.throws(() => loadCandidateRuntime(f.root), /model source differs/);
  const file = f.overlay.files[0]!;
  f.plant(
    'import/build-inputs.json',
    JSON.stringify({
      ...inputs,
      runtime: {
        ...inputs.runtime,
        assets: [
          ...inputs.runtime.assets,
          {
            path: file.path,
            sha256: file.sha256,
            bytes: file.size,
            location: 'classic:retained-source-path',
          },
        ],
      },
    }),
  );
  assert.throws(() => loadCandidateRuntime(f.root), /collides with frozen inventory/);
});
