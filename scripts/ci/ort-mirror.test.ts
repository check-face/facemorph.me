import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  composeManifest,
  generateOverlay,
  ORT_FILES,
  validateOverlay,
  verifyOverlay,
  type OrtMirrorOverlay,
} from './ort-mirror.ts';

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

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-ort-overlay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: lock.version }),
  );
  for (const [index, file] of ORT_FILES.entries())
    writeFileSync(
      join(dist, file),
      file.endsWith('.wasm')
        ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, index])
        : `// fixture ${file}\nexport const value = ${index};\n`,
    );
  return dist;
}

test('six actual fixture files yield reproducible immutable WASM/JSEP destinations', (t) => {
  const dist = fixture(t);
  const overlay = generateOverlay(dist, lock);
  assert.deepEqual(generateOverlay(dist, lock), overlay);
  assert.deepEqual(verifyOverlay(dist, overlay), overlay);
  assert.deepEqual(overlay.npm, {
    package: 'onnxruntime-web',
    url: lock.resolved,
    integrity: lock.integrity,
  });
  assert.equal(overlay.gpuBuild, 'jsep');
  assert.deepEqual(
    overlay.files.map((file) => file.file),
    ORT_FILES,
  );
  for (const row of overlay.files) {
    const bytes = readFileSync(join(dist, row.file));
    assert.equal(row.size, bytes.length);
    assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(row.path, `assets/${overlay.bundleSha256}/${row.file}`);
  }
  const file = ORT_FILES[4];
  writeFileSync(join(dist, file), '// next release bytes\n');
  const changed = generateOverlay(dist, lock);
  assert.notEqual(changed.bundleSha256, overlay.bundleSha256);
  assert.ok(changed.files.every((row, index) => row.path !== overlay.files[index]!.path));
});

test('composition preserves every model, reference and unrelated field in the real control', (t) => {
  const original = control();
  const snapshot = structuredClone(original);
  const overlay = generateOverlay(fixture(t), lock);
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
      'native EP',
      (row) => {
        row.gpuBuild = 'webgpu';
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
        row.files[3].file = 'ort.webgpu.min.mjs';
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
