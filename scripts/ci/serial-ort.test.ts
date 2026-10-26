import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  composeEncoderDescriptor,
  generateSerialCompanion,
  inspectSerialWasm,
  SERIAL_ORT_FILES,
  validateSerialCompanion,
  verifySerialCompanion,
  type SerialOrtBuild,
  type SerialOrtCompanion,
} from './serial-ort.ts';

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const controlBytes = () =>
  readFileSync(
    new URL(
      '../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
      import.meta.url,
    ),
  );
const build: SerialOrtBuild = {
  version: '1.30.0',
  source: {
    repository: 'https://github.com/microsoft/onnxruntime.git',
    tag: 'v1.30.0',
    commit: 'f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7',
  },
  toolchain: { emsdkVersion: '4.0.23', emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56' },
  commandSha256: sha('synthetic fixture build command'),
  linkReceiptSha256: sha('synthetic fixture link receipt'),
};
const header = [0, 97, 115, 109, 1, 0, 0, 0];
const leb = (value: number): number[] => {
  const result: number[] = [];
  do {
    const next = value % 128;
    value = Math.floor(value / 128);
    result.push(next | (value ? 128 : 0));
  } while (value);
  return result;
};
const section = (id: number, bytes: number[]) => [id, ...leb(bytes.length), ...bytes];
// An actual WASM function body: local.get 0; memory.grow 0; end. The parser never executes or edits it.
const growCode = section(10, [1, 6, 0, 0x20, 0, 0x40, 0, 0x0b]);
const wasm = (maximum = 4096, flags = 1, initial = 1): Buffer =>
  Buffer.from([
    ...header,
    ...section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...section(3, [1, 0]),
    ...section(5, [1, flags, ...leb(initial), ...(flags & 1 ? leb(maximum) : [])]),
    ...growCode,
  ]);

function fixture(t: TestContext, bytes = wasm()) {
  const dir = mkdtempSync(join(tmpdir(), 'facemorph-serial-ort-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dist = join(dir, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, SERIAL_ORT_FILES[0]), '// synthetic fixture module\n');
  writeFileSync(join(dist, SERIAL_ORT_FILES[1]), '// synthetic fixture factory\n');
  writeFileSync(join(dist, SERIAL_ORT_FILES[2]), bytes);
  const control = controlBytes();
  const companion = generateSerialCompanion(dist, build, control);
  return { dir, dist, control, companion };
}

// A forged, internally consistent receipt must still lose to independently inspected actual WASM bytes.
function reseal(companion: SerialOrtCompanion): SerialOrtCompanion {
  const bundleSha256 = sha(
    JSON.stringify({
      schema: companion.schema,
      controlDescriptorSha256: companion.controlDescriptorSha256,
      build: companion.build,
      memory: companion.memory,
      files: companion.files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
  return {
    ...companion,
    bundleSha256,
    files: companion.files.map((file) => ({
      ...file,
      path: `assets/${bundleSha256}/${file.file}`,
    })),
  };
}

test('generation binds genuine file bytes, pinned build provenance and independently observed memory without modifying WASM code', (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.dist, SERIAL_ORT_FILES[2]));
  assert.deepEqual(generateSerialCompanion(f.dist, build, f.control), f.companion);
  assert.deepEqual(verifySerialCompanion(f.dist, f.companion), f.companion);
  assert.deepEqual(f.companion.memory, { unshared: true, initialPages: 1, maximumPages: 4096 });
  assert.equal(f.companion.controlDescriptorSha256, sha(f.control));
  assert.deepEqual(f.companion.build, build);
  for (const file of f.companion.files) {
    const actual = readFileSync(join(f.dist, file.file));
    assert.equal(file.sha256, sha(actual));
    assert.equal(file.size, actual.length);
    assert.equal(file.path, `assets/${f.companion.bundleSha256}/${file.file}`);
  }
  assert.deepEqual(readFileSync(join(f.dist, SERIAL_ORT_FILES[2])), before);
  assert.deepEqual(
    [...before.subarray(-growCode.length)],
    growCode,
    'memory.grow code section is retained verbatim',
  );
  const changed = generateSerialCompanion(
    f.dist,
    { ...build, commandSha256: sha('another command') },
    f.control,
  );
  assert.notEqual(changed.bundleSha256, f.companion.bundleSha256);
});

test('the WASM memory.grow boundary admits 4096 pages and rejects 4097, shared, imported, unbounded or missing memory', () => {
  assert.equal(inspectSerialWasm(wasm(4096)).maximumPages * 65536, 268435456);
  assert.equal(inspectSerialWasm(wasm(4095)).maximumPages, 4095);
  const imported = Buffer.from([
    ...header,
    ...section(2, [1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 1, 1, 0x80, 0x20]),
    ...section(5, [1, 1, 1, 0x80, 0x20]),
  ]);
  for (const [bytes, pattern] of [
    [wasm(4097), /4096 pages/],
    [wasm(4096, 3), /unshared/],
    [wasm(4096, 0), /explicit maximum/],
    [wasm(4096, 5), /memory32/],
    [wasm(2, 1, 3), /finite maximum/],
    [imported, /imported/],
    [Buffer.from(header), /missing/],
    [wasm().subarray(0, -1), /truncated/],
    [
      Buffer.from([
        ...header,
        ...section(5, [1, 1, 1, 0x80, 0x20]),
        ...section(5, [1, 1, 1, 0x80, 0x20]),
      ]),
      /invalid WASM section/,
    ],
    [Buffer.from([...header, ...section(5, [2, 1, 1, 1, 1, 1, 1])]), /exactly one/],
    [Buffer.from('not wasm'), /invalid/],
  ] as const)
    assert.throws(() => inspectSerialWasm(bytes), pattern);
});

test('WASM import parsing cannot overlook memory after function, table, global and tag imports', () => {
  const imports = [
    5,
    0,
    0,
    0,
    0, // Function.
    0,
    0,
    1,
    0x70,
    1,
    1,
    1, // Table with maximum.
    0,
    0,
    3,
    0x7f,
    0, // Global.
    0,
    0,
    4,
    0,
    0, // Exception tag.
    0,
    0,
    2,
    1,
    1,
    1, // Memory.
  ];
  assert.throws(
    () => inspectSerialWasm(Buffer.from([...header, ...section(2, imports)])),
    /imported/,
  );
  assert.throws(
    () =>
      inspectSerialWasm(
        Buffer.from([...header, ...section(5, [1, 1, 0xff, 0xff, 0xff, 0xff, 0x10])]),
      ),
    /invalid WASM u32/,
  );
});

test('actual verification rejects forged memory receipts even when the companion digest is recomputed', (t) => {
  const f = fixture(t);
  const forged = reseal({ ...f.companion, memory: { ...f.companion.memory, maximumPages: 4095 } });
  assert.deepEqual(validateSerialCompanion(forged), forged);
  assert.throws(() => verifySerialCompanion(f.dist, forged), /memory declarations differ/);
  writeFileSync(join(f.dist, SERIAL_ORT_FILES[2]), wasm(4097));
  assert.throws(() => verifySerialCompanion(f.dist, f.companion), /digest or size/);
  assert.throws(() => generateSerialCompanion(f.dist, build, f.control), /4096 pages/);
});

test('strict metadata cannot inject replacement models, references, paths, admission or a foreign build', (t) => {
  const f = fixture(t);
  for (const field of [
    'descriptor',
    'steps',
    'canaries',
    'runtime',
    'phoneAdmitted',
    'candidateAdmission',
    'releaseQualified',
  ])
    assert.throws(
      () => validateSerialCompanion({ ...f.companion, [field]: {} }),
      /unexpected fields/,
      field,
    );
  for (const mutate of [
    (c: any) => {
      c.files[0].path = '../outside';
    },
    (c: any) => {
      c.files[0].file = 'model.onnx';
    },
    (c: any) => {
      c.files.push(c.files[0]);
    },
    (c: any) => {
      c.files.reverse();
    },
    (c: any) => {
      c.files[0].sha256 = 'bad';
    },
    (c: any) => {
      c.files[0].size = 0;
    },
    (c: any) => {
      c.files[0].size = 64 * 1024 * 1024 + 1;
    },
    (c: any) => {
      c.build.version = '1.30.0-rc.1';
    },
    (c: any) => {
      c.build.source.repository = 'https://example.com/ort';
    },
    (c: any) => {
      c.build.source.tag = 'v1.29.0';
    },
    (c: any) => {
      c.build.source.commit = 'main';
    },
    (c: any) => {
      c.build.source.canaries = [];
    },
    (c: any) => {
      c.build.toolchain.emsdkVersion = '4.0.22';
    },
    (c: any) => {
      c.build.toolchain.emsdkCommit = 'a'.repeat(40);
    },
    (c: any) => {
      c.build.commandSha256 = 'bad';
    },
    (c: any) => {
      c.build.linkReceiptSha256 = 'bad';
    },
    (c: any) => {
      c.memory.unshared = false;
    },
    (c: any) => {
      c.memory.maximumPages = 4097;
    },
    (c: any) => {
      c.memory.phoneAdmitted = true;
    },
    (c: any) => {
      c.controlDescriptorSha256 = 'bad';
    },
    (c: any) => {
      c.bundleSha256 = 'a'.repeat(64);
    },
  ]) {
    const changed = structuredClone(f.companion);
    mutate(changed);
    assert.throws(() => validateSerialCompanion(changed), /Serial ORT:/);
  }
});

test('composition retains the real 108 steps, references, tolerances and admission exactly; no new qualification is claimed', (t) => {
  const f = fixture(t);
  const original = JSON.parse(f.control.toString());
  const snapshot = structuredClone(f.companion);
  const composed = composeEncoderDescriptor(f.control, f.companion, 'https://next.facemorph.me');
  assert.deepEqual(
    composeEncoderDescriptor(f.control, f.companion, 'https://next.facemorph.me'),
    composed,
  );
  const manifest = composed.manifest as any;
  assert.equal(manifest.runtime.version, '1.30.0');
  assert.equal(manifest.runtime.unshared, true);
  assert.equal(manifest.runtime.maxWasmBytes, 268435456);
  for (const [index, role] of ['module', 'factory', 'wasm'].entries()) {
    const file = f.companion.files[index]!;
    assert.deepEqual(manifest.runtime[role!], {
      url: `https://next.facemorph.me/runtime/${file.path}`,
      sha256: file.sha256,
      size: file.size,
    });
  }
  assert.equal(manifest.runtime.memoryReceipt.wasmSha256, f.companion.files[2]!.sha256);
  assert.deepEqual(manifest.runtime.memoryReceipt.build, build);
  const retained = structuredClone(manifest);
  for (const key of ['version', 'module', 'factory', 'wasm', 'memoryReceipt'])
    retained.runtime[key] = original.runtime[key];
  assert.deepEqual(retained, original);
  assert.equal(manifest.steps.length, 108);
  assert.deepEqual(
    manifest.canaries.map((c: any) => c.threshold),
    [0.0001, 0.0001, 0.0001, 0.0001, 0.0001],
  );
  assert.equal(manifest.phoneAdmitted, original.phoneAdmitted);
  assert.equal(manifest.browserQualified, false);
  assert.equal(manifest.qualification, original.qualification);
  assert.equal(composed.asset.sha256, sha(composed.bytes));
  assert.equal(composed.asset.size, composed.bytes.length);
  assert.equal(composed.path, `encoder-stream/${sha(composed.bytes)}/manifest.json`);
  assert.equal(composed.asset.url, `https://next.facemorph.me/runtime/${composed.path}`);
  assert.deepEqual(f.companion, snapshot);
  assert.deepEqual(controlBytes(), f.control);
  for (const field of ['sourceEncoderSha256', 'steps', 'canaries', 'phoneAdmitted']) {
    const tampered = JSON.parse(f.control.toString());
    tampered[field] = null;
    assert.throws(
      () =>
        composeEncoderDescriptor(
          Buffer.from(JSON.stringify(tampered)),
          f.companion,
          'https://next.facemorph.me',
        ),
      /digest mismatch/,
      field,
    );
  }
  for (const origin of [
    'http://localhost',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com/?q=1',
    'https://example.com/#fragment',
    'bad',
  ])
    assert.throws(() => composeEncoderDescriptor(f.control, f.companion, origin), /HTTPS origin/);
});

test('generation and verification refuse missing, empty, changed or symlinked runtime files', (t) => {
  const f = fixture(t);
  const file = join(f.dist, SERIAL_ORT_FILES[0]);
  writeFileSync(file, 'different bytes');
  assert.throws(() => verifySerialCompanion(f.dist, f.companion), /digest or size/);
  writeFileSync(file, '');
  assert.throws(() => generateSerialCompanion(f.dist, build, f.control), /nonempty regular/);
  rmSync(file);
  assert.throws(() => generateSerialCompanion(f.dist, build, f.control), /ENOENT/);
  symlinkSync(join(f.dist, SERIAL_ORT_FILES[1]), file);
  assert.throws(() => generateSerialCompanion(f.dist, build, f.control), /regular file/);
});
