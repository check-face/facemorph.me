import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  composeManifest,
  generateOverlay,
  ORT_BUILD_FILES,
  ORT_FILES,
  validateOverlay,
  verifyOverlay,
  withSerialCompanion,
  type OrtMirrorOverlay,
  type OrtGpuBuild,
} from './ort-mirror.ts';
import {
  composeEncoderDescriptor,
  generateSerialCompanion,
  SERIAL_ORT_FILES,
} from './serial-ort.ts';

const lock = {
  version: '1.30.0',
  resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
  integrity: `sha512-${Buffer.alloc(64, 17).toString('base64')}`,
};
const control = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../import/runtime-manifests/control/d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

function fixture(t: TestContext, gpuBuild: OrtGpuBuild = 'webgpu'): string {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-ort-overlay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: lock.version }),
  );
  for (const [index, file] of ORT_BUILD_FILES[gpuBuild].entries())
    writeFileSync(
      join(dist, file),
      file.endsWith('.wasm')
        ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, index])
        : `// fixture ${file}\nexport const value = ${index};\n`,
    );
  return dist;
}

function serialFixture(t: TestContext, version = lock.version) {
  const dist = mkdtempSync(join(tmpdir(), 'facemorph-serial-overlay-'));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  for (const file of SERIAL_ORT_FILES)
    writeFileSync(
      join(dist, file),
      file.endsWith('.wasm')
        ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32])
        : `// synthetic fixture ${file}\n`,
    );
  const bytes = readFileSync(
    new URL(
      '../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
      import.meta.url,
    ),
  );
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const companion = generateSerialCompanion(
    dist,
    {
      version,
      source: {
        repository: 'https://github.com/microsoft/onnxruntime.git',
        tag: `v${version}`,
        commit: 'f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7',
      },
      toolchain: {
        emsdkVersion: '4.0.23',
        emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56',
      },
      commandSha256: hash('synthetic fixture command'),
      linkReceiptSha256: hash('synthetic fixture link receipt'),
    },
    bytes,
  );
  return { bytes, companion };
}

test('six actual fixture files yield reproducible immutable WASM/JSEP destinations', (t) => {
  const dist = fixture(t, 'jsep');
  const overlay = generateOverlay(dist, lock, 'jsep');
  assert.deepEqual(generateOverlay(dist, lock, 'jsep'), overlay);
  assert.deepEqual(verifyOverlay(dist, overlay), overlay);
  assert.deepEqual(overlay.npm, {
    package: 'onnxruntime-web',
    url: lock.resolved,
    integrity: lock.integrity,
  });
  assert.equal(overlay.gpuBuild, 'jsep');
  // Captured from the pre-native implementation: recorded JSEP bundle identities stay valid.
  assert.equal(
    overlay.bundleSha256,
    '92a9a16f5baaeafc7b31e570fb10cca5c67b55fbaa5d6911945b62319bb36268',
  );
  assert.deepEqual(
    overlay.files.map((file) => file.file),
    ORT_BUILD_FILES.jsep,
  );
  for (const row of overlay.files) {
    const bytes = readFileSync(join(dist, row.file));
    assert.equal(row.size, bytes.length);
    assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(row.path, `assets/${overlay.bundleSha256}/${row.file}`);
  }
  const file = ORT_BUILD_FILES.jsep[4];
  writeFileSync(join(dist, file), '// next release bytes\n');
  const changed = generateOverlay(dist, lock, 'jsep');
  assert.notEqual(changed.bundleSha256, overlay.bundleSha256);
  assert.ok(changed.files.every((row, index) => row.path !== overlay.files[index]!.path));
});

test('composition preserves every model, reference and unrelated field in the real control', (t) => {
  const original = control();
  const snapshot = structuredClone(original);
  const overlay = generateOverlay(fixture(t, 'jsep'), lock, 'jsep');
  const overlaySnapshot = structuredClone(overlay);
  const composed = composeManifest(original, overlay, 'https://next.facemorph.me');
  const runtime = composed['runtime'] as typeof original.runtime;
  const webgpu = composed['webgpu'] as typeof original.webgpu;
  assert.equal(runtime.version, '1.30.0');
  assert.equal(webgpu.runtime.version, '1.30.0');
  assert.match(webgpu.runtime.module.url, /\/ort\.min\.mjs$/);
  assert.match(webgpu.runtime.factory.url, /\.jsep\.mjs$/);
  assert.match(webgpu.runtime.wasm.url, /\.jsep\.wasm$/);
  assert.doesNotMatch(JSON.stringify(composed), /asyncify/);
  assert.equal(runtime.moduleUrl, runtime.assets[0].url);
  for (const [index, asset] of [
    ...runtime.assets,
    webgpu.runtime.module,
    webgpu.runtime.factory,
    webgpu.runtime.wasm,
  ].entries()) {
    const row = overlay.files[index]!;
    assert.deepEqual(asset, {
      url: `https://next.facemorph.me/runtime/${row.path}`,
      sha256: row.sha256,
      size: row.size,
    });
  }
  assert.equal(
    new URL('ort-wasm-simd-threaded.wasm', runtime.wasmPaths).href,
    runtime.assets[2].url,
  );
  const retained = structuredClone(composed);
  retained['runtime'] = original.runtime;
  (retained['webgpu'] as typeof original.webgpu).runtime = original.webgpu.runtime;
  assert.deepEqual(retained, original);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(overlay, overlaySnapshot);
});

test('a CPU-route overlay moves only the WASM runtime; the WebGPU route keeps its pinned control runtime (fm-qeh)', (t) => {
  const dist = fixture(t, 'cpu');
  const overlay = generateOverlay(dist, lock, 'cpu');
  assert.deepEqual(
    overlay.files.map((file) => file.file),
    ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'],
  );
  assert.deepEqual(verifyOverlay(dist, overlay), overlay);
  const original = control();
  const composed = composeManifest(original, overlay, 'https://next.facemorph.me');
  const runtime = composed['runtime'] as typeof original.runtime;
  assert.equal(runtime.version, lock.version);
  assert.deepEqual(composed['webgpu'], original.webgpu);
  assert.throws(
    () => validateOverlay({ ...overlay, gpuBuild: 'webgpu' }),
    /ORT files are required/,
  );
});

for (const gpuBuild of ['webgpu', 'jspi'] as const)
  test(`${gpuBuild} stages its exact six pinned files and composes the native EP without changing models`, (t) => {
    const dist = fixture(t, gpuBuild);
    const overlay = generateOverlay(dist, lock, gpuBuild);
    assert.equal(overlay.gpuBuild, gpuBuild);
    assert.equal(overlay.files.length, 6);
    assert.deepEqual(
      overlay.files.map((file) => file.file),
      ORT_BUILD_FILES[gpuBuild],
    );
    assert.deepEqual(
      overlay.files.slice(3).map((file) => file.file),
      gpuBuild === 'webgpu'
        ? [
            'ort.webgpu.min.mjs',
            'ort-wasm-simd-threaded.asyncify.mjs',
            'ort-wasm-simd-threaded.asyncify.wasm',
          ]
        : [
            'ort.jspi.min.mjs',
            'ort-wasm-simd-threaded.jspi.mjs',
            'ort-wasm-simd-threaded.jspi.wasm',
          ],
    );
    assert.deepEqual(verifyOverlay(dist, overlay), overlay);
    if (gpuBuild === 'webgpu') {
      assert.deepEqual(generateOverlay(dist, lock), overlay);
      assert.deepEqual(ORT_FILES, ORT_BUILD_FILES.webgpu);
    }
    const original = control();
    const composed = composeManifest(original, overlay, 'https://next.facemorph.me');
    const runtime = composed['runtime'] as typeof original.runtime;
    const webgpu = composed['webgpu'] as typeof original.webgpu;
    assert.equal(runtime.version, lock.version);
    assert.equal(webgpu.runtime.version, lock.version);
    assert.equal(runtime.moduleUrl, runtime.assets[0].url);
    for (const [index, asset] of [
      ...runtime.assets,
      webgpu.runtime.module,
      webgpu.runtime.factory,
      webgpu.runtime.wasm,
    ].entries()) {
      const row = overlay.files[index]!;
      assert.deepEqual(asset, {
        url: `https://next.facemorph.me/runtime/${row.path}`,
        sha256: row.sha256,
        size: row.size,
      });
    }
    const retained = structuredClone(composed);
    retained['runtime'] = original.runtime;
    (retained['webgpu'] as typeof original.webgpu).runtime = original.webgpu.runtime;
    assert.deepEqual(retained, original);
    assert.doesNotMatch(JSON.stringify(composed.webgpu), /\.jsep\./);
    // A native build cannot be silently relabelled or transplanted under another bundle digest.
    for (const otherBuild of Object.keys(ORT_BUILD_FILES) as OrtGpuBuild[]) {
      if (otherBuild === gpuBuild) continue;
      assert.throws(
        () => validateOverlay({ ...overlay, gpuBuild: otherBuild }),
        /filename|ORT files are required/,
      );
      const other = generateOverlay(fixture(t, otherBuild), lock, otherBuild);
      assert.notEqual(other.bundleSha256, overlay.bundleSha256);
      const transplanted = {
        ...other,
        bundleSha256: overlay.bundleSha256,
        files: other.files.map((row) => ({
          ...row,
          path: `assets/${overlay.bundleSha256}/${row.file}`,
        })),
      };
      assert.throws(() => validateOverlay(transplanted), /bundle digest/);
    }
  });

test('native staging is the default and never substitutes JSEP files or an unknown build', (t) => {
  const legacy = fixture(t, 'jsep');
  assert.throws(() => generateOverlay(legacy, lock), /ENOENT/);
  assert.throws(
    () => generateOverlay(legacy, lock, 'unknown' as OrtGpuBuild),
    /unsupported GPU build/,
  );
});

test('lock provenance rejects unstable versions, foreign releases and malformed integrity', (t) => {
  const dist = fixture(t);
  for (const version of ['1.30.0-rc.1', 'latest', '^1.30.0', '01.30.0', '', '1.30'])
    assert.throws(() => generateOverlay(dist, { ...lock, version }), /version/);
  for (const resolved of [
    lock.resolved.replace('1.30.0', '1.29.0'),
    'http://registry.npmjs.org/a',
    'https://example.com/ort.tgz',
  ])
    assert.throws(() => generateOverlay(dist, { ...lock, resolved }), /npm URL/);
  for (const integrity of ['', 'sha512-invalid', `sha256-${'a'.repeat(64)}`, `${lock.integrity} `])
    assert.throws(() => generateOverlay(dist, { ...lock, integrity }), /integrity/);
  assert.throws(
    () =>
      generateOverlay(dist, {
        ...lock,
        version: '1.31.0',
        resolved: lock.resolved.replace('1.30.0', '1.31.0'),
      }),
    /installed package identity/,
  );
  assert.throws(() => generateOverlay(dist, null), /lock entry/);
});

test('recorded overlay metadata cannot introduce invalid paths, assets or tampered digests', (t) => {
  const overlay = generateOverlay(fixture(t), lock);
  const cases: [string, (row: any) => void][] = [
    [
      'schema',
      (row) => {
        row.schema = 'facemorph.ort-mirror/2';
      },
    ],
    [
      'mismatched GPU build',
      (row) => {
        row.gpuBuild = 'jsep';
      },
    ],
    [
      'version',
      (row) => {
        row.version = '1.30.0-next';
      },
    ],
    [
      'integrity',
      (row) => {
        row.npm.integrity = 'sha512-invalid';
      },
    ],
    [
      'package',
      (row) => {
        row.npm.package = 'another-package';
      },
    ],
    [
      'traversal',
      (row) => {
        row.files[0].path = '../private/ort.min.mjs';
      },
    ],
    [
      'URL path',
      (row) => {
        row.files[0].path = 'https://example.com/ort.min.mjs';
      },
    ],
    [
      'encoded traversal',
      (row) => {
        row.files[0].path = 'assets/%2e%2e/ort.min.mjs';
      },
    ],
    [
      'filename',
      (row) => {
        row.files[3].file = 'ort.min.mjs';
      },
    ],
    [
      'duplicate file',
      (row) => {
        row.files[3] = row.files[0];
      },
    ],
    [
      'missing file',
      (row) => {
        row.files.pop();
      },
    ],
    [
      'additional file',
      (row) => {
        row.files.push(row.files[0]);
      },
    ],
    [
      'zero size',
      (row) => {
        row.files[0].size = 0;
      },
    ],
    [
      'fractional size',
      (row) => {
        row.files[0].size = 1.5;
      },
    ],
    [
      'malformed digest',
      (row) => {
        row.files[0].sha256 = 'x'.repeat(64);
      },
    ],
    [
      'planted digest',
      (row) => {
        row.files[0].sha256 = 'f'.repeat(64);
      },
    ],
    [
      'unknown field',
      (row) => {
        row.files[0].source = '/private';
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(overlay);
    mutate(changed);
    assert.throws(() => validateOverlay(changed), /ORT mirror:/, label);
    assert.throws(
      () => composeManifest(control(), changed, 'https://next.facemorph.me'),
      /ORT mirror:/,
      label,
    );
  }
});

test('verification refuses actual changed bytes, missing files, empty files and symlink escapes', (t) => {
  const dist = fixture(t);
  const overlay = generateOverlay(dist, lock);
  const file = join(dist, ORT_FILES[0]);
  const bytes = readFileSync(file);
  bytes[0] = bytes[0]! ^ 1;
  writeFileSync(file, bytes);
  assert.throws(() => verifyOverlay(dist, overlay), /digest or size mismatch/);
  writeFileSync(file, bytes.subarray(1));
  assert.throws(() => verifyOverlay(dist, overlay), /digest or size mismatch/);
  writeFileSync(file, '');
  assert.throws(() => generateOverlay(dist, lock), /empty/);
  rmSync(file);
  assert.throws(() => generateOverlay(dist, lock), /ENOENT/);
  symlinkSync(join(dist, ORT_FILES[1]), file);
  assert.throws(() => generateOverlay(dist, lock), /regular file/);
});

test('composition refuses unsupported control/runtime shapes and unsafe destination origins', (t) => {
  const overlay: OrtMirrorOverlay = generateOverlay(fixture(t), lock);
  for (const origin of [
    'http://localhost',
    'https://user:pass@example.com',
    'https://example.com/runtime',
    'https://example.com/?x=1',
    'https://example.com/#x',
    'invalid',
  ])
    assert.throws(() => composeManifest(control(), overlay, origin), /ORT mirror:/);
  for (const mutate of [
    (row: any) => {
      row.schemaVersion = 2;
    },
    (row: any) => {
      row.runtime = null;
    },
    (row: any) => {
      row.webgpu.runtime = null;
    },
    (row: any) => {
      row.runtime.assets = [];
    },
    (row: any) => {
      row.runtime.moduleUrl = 'http://example.com/ort.mjs';
    },
    (row: any) => {
      row.webgpu.runtime.wasm.sha256 = 'invalid';
    },
  ]) {
    const changed = control();
    mutate(changed);
    assert.throws(
      () => composeManifest(changed, overlay, 'https://next.facemorph.me'),
      /ORT mirror:/,
    );
  }
});

test('schema 2 keeps the npm bundle identity and composes only the trusted control encoder reference', (t) => {
  const npm = generateOverlay(fixture(t, 'jsep'), lock, 'jsep');
  const serial = serialFixture(t);
  const overlay = withSerialCompanion(npm, serial.companion);
  assert.equal(overlay.schema, 'facemorph.ort-mirror/2');
  assert.equal(overlay.bundleSha256, npm.bundleSha256);
  assert.deepEqual(overlay.files, npm.files);
  assert.deepEqual(overlay.npm, npm.npm);
  assert.deepEqual(validateOverlay(overlay), overlay);
  assert.deepEqual(
    verifyOverlay(fixture(t, 'jsep'), overlay),
    overlay,
    'npm verification retains its six-file scope',
  );
  const original = control();
  const composed = composeManifest(original, overlay, 'https://next.facemorph.me', {
    controlEncoderDescriptorBytes: serial.bytes,
  });
  const descriptor = composeEncoderDescriptor(
    serial.bytes,
    serial.companion,
    'https://next.facemorph.me',
  );
  assert.deepEqual(composed.encoderStream, { ...original.encoderStream, ...descriptor.asset });
  assert.equal((composed.encoderStream as any).phoneAdmitted, original.encoderStream.phoneAdmitted);
  assert.deepEqual(
    (composed.encoderStream as any).candidateAdmission,
    original.encoderStream.candidateAdmission,
  );
  assert.equal((composed.encoderStream as any).releaseQualified, false);
  const retained: any = structuredClone(composed);
  retained.runtime = original.runtime;
  retained.webgpu.runtime = original.webgpu.runtime;
  retained.encoderStream = original.encoderStream;
  assert.deepEqual(retained, original);
  assert.deepEqual(control(), original);
  const schema1 = { ...overlay, schema: 'facemorph.ort-mirror/1' } as any;
  delete schema1.serial;
  assert.deepEqual(
    validateOverlay(schema1),
    npm,
    'historical schema 1 bytes and digest stay compatible',
  );
});

test('schema 2 requires matching version, trusted root pin and exact descriptor bytes; caller replacements fail closed', (t) => {
  const npm = generateOverlay(fixture(t), lock);
  const { bytes, companion } = serialFixture(t);
  const overlay = withSerialCompanion(npm, companion);
  assert.throws(
    () => validateOverlay({ ...npm, schema: 'facemorph.ort-mirror/2' }),
    /missing or unexpected/,
  );
  assert.throws(() => validateOverlay({ ...npm, serial: companion }), /unexpected fields/);
  assert.throws(
    () => withSerialCompanion(npm, serialFixture(t, '1.29.0').companion),
    /version differs/,
  );
  assert.throws(
    () => composeManifest(control(), overlay, 'https://next.facemorph.me'),
    /trusted control encoder descriptor bytes are required/,
  );
  assert.throws(
    () =>
      composeManifest(control(), overlay, 'https://next.facemorph.me', {
        controlEncoderDescriptorBytes: Buffer.from('{}'),
      }),
    /size mismatch/,
  );
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  assert.throws(
    () =>
      composeManifest(control(), overlay, 'https://next.facemorph.me', {
        controlEncoderDescriptorBytes: changed,
      }),
    /digest mismatch/,
  );
  const root = control();
  root.encoderStream.sha256 = 'a'.repeat(64);
  assert.throws(
    () =>
      composeManifest(root, overlay, 'https://next.facemorph.me', {
        controlEncoderDescriptorBytes: bytes,
      }),
    /trusted control encoder pin/,
  );
  for (const field of ['steps', 'canaries', 'phoneAdmitted', 'modelSourceSha256', 'descriptor']) {
    assert.throws(
      () => withSerialCompanion(npm, { ...companion, [field]: null }),
      /unexpected fields/,
    );
    assert.throws(() => validateOverlay({ ...overlay, [field]: null }), /unexpected fields/);
  }
});
