import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { acquireCandidateRuntime, verifyCandidateRuntime } from './acquire-candidate-runtime.ts';
import { loadCandidateRuntime } from './candidate-runtime.ts';
import { generateOverlay, ORT_FILES, withSerialCompanion } from './ort-mirror.ts';
import { generateSerialCompanion, SERIAL_ORT_FILES } from './serial-ort.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const controlBytes = readFileSync(
  new URL(
    '../../import/runtime-manifests/control/d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c/manifest.json',
    import.meta.url,
  ),
);
const encoderBytes = readFileSync(
  new URL(
    '../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
    import.meta.url,
  ),
);
const encoderPath = new URL(JSON.parse(controlBytes.toString()).encoderStream.url).pathname.slice(
  '/runtime/'.length,
);

function fixture(t: TestContext, mode: 'none' | 'npm' | 'serial' = 'npm') {
  const root = mkdtempSync(join(tmpdir(), 'candidate-acquisition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const controlRuntime = join(root, 'control');
  const out = join(root, 'runtime');
  const plant = (path: string, bytes: Uint8Array | string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  plant(join(controlRuntime, 'manifest.json'), controlBytes);
  plant(join(controlRuntime, encoderPath), encoderBytes);
  plant(join(controlRuntime, 'chunks/model.bin'), 'small frozen model bytes');
  const model = readFileSync(join(controlRuntime, 'chunks/model.bin'));
  const rows = [
    {
      path: 'manifest.json',
      sha256: sha(controlBytes),
      bytes: controlBytes.length,
      location: 'classic:root',
    },
    {
      path: encoderPath,
      sha256: sha(encoderBytes),
      bytes: encoderBytes.length,
      location: 'classic:encoder',
    },
    {
      path: 'chunks/model.bin',
      sha256: sha(model),
      bytes: model.length,
      location: 'classic:model',
    },
  ];
  const inputs = {
    runtime: {
      manifest: {
        sha256: sha(controlBytes),
        bytes: controlBytes.length,
        modelSourceSha256: JSON.parse(controlBytes.toString()).modelSourceSha256,
      },
      assets: rows,
    },
    worker_graphs: { pinned: [] },
  };
  const inputsPath = join(repo, 'import/build-inputs.json');
  plant(inputsPath, JSON.stringify(inputs));
  plant(
    join(repo, 'import/runtime-manifests/control', sha(controlBytes), 'manifest.json'),
    controlBytes,
  );
  plant(join(repo, 'import/runtime-manifests', encoderPath), encoderBytes);
  const dist = join(root, 'archive/package/dist');
  plant(
    join(root, 'archive/package/package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: '1.31.1' }),
  );
  for (const file of ORT_FILES) plant(join(dist, file), `synthetic npm bytes ${file}`);
  const archive = join(root, 'ort.tgz');
  execFileSync('tar', ['-czf', archive, '-C', join(root, 'archive'), 'package']);
  const tarball = readFileSync(archive);
  const npm = generateOverlay(dist, {
    version: '1.31.1',
    resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.1.tgz',
    integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
  });
  const serialBytes = SERIAL_ORT_FILES.map((file) =>
    file.endsWith('.wasm')
      ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32])
      : Buffer.from(`synthetic serial bytes ${file}`),
  );
  const built = join(root, 'built');
  SERIAL_ORT_FILES.forEach((file, i) => plant(join(built, file), serialBytes[i]!));
  const companion = generateSerialCompanion(
    built,
    {
      version: '1.31.1',
      source: {
        repository: 'https://github.com/microsoft/onnxruntime.git',
        tag: 'v1.31.1',
        commit: 'f'.repeat(40),
      },
      toolchain: {
        emsdkVersion: '4.0.23',
        emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56',
      },
      commandSha256: sha('fixed synthetic command'),
      linkReceiptSha256: sha('fixed synthetic link receipt'),
    },
    encoderBytes,
  );
  const overlay = mode === 'serial' ? withSerialCompanion(npm, companion) : npm;
  const overlayPath = join(repo, 'import/runtime-mirror.json');
  if (mode !== 'none') plant(overlayPath, JSON.stringify(overlay));
  const source = {
    schema: 'facemorph.serial-ort-source/1',
    bundleSha256: companion.bundleSha256,
    files: companion.files.map((file, index) => ({
      file: file.file,
      url: `https://api.github.com/repos/facemorph-me/facemorph.me/releases/assets/${index + 1}`,
    })),
  };
  const sourcePath = join(repo, 'import/runtime-serial-source.json');
  if (mode === 'serial') plant(sourcePath, JSON.stringify(source));
  return {
    root,
    repo,
    controlRuntime,
    out,
    plant,
    inputs,
    inputsPath,
    tarball,
    serialBytes,
    overlay,
    source,
    sourcePath,
    overlayPath,
  };
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (path: string, prefix = '') => {
    for (const name of readdirSync(path)) {
      const file = join(path, name);
      if (lstatSync(file).isDirectory()) walk(file, `${prefix}${name}/`);
      else result[`${prefix}${name}`] = sha(readFileSync(file));
    }
  };
  walk(root);
  return result;
}
async function transport(t: TestContext, f: ReturnType<typeof fixture>, corruptSerial = false) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url!, authorization: req.headers.authorization });
    const body = req.url === '/npm' ? f.tarball : f.serialBytes[Number(req.url!.slice(1)) - 1]!;
    res.end(corruptSerial && req.url === '/3' ? Buffer.alloc(body.length, 1) : body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const npmRequest: typeof fetch = async (url, init) => {
    assert.equal(String(url), f.overlay.npm.url);
    return fetch(`http://127.0.0.1:${address.port}/npm`, init);
  };
  const serialRequest: typeof fetch = async (url, init) => {
    assert.match(
      String(url),
      /^https:\/\/api.github\.com\/repos\/facemorph-me\/facemorph\.me\/releases\/assets\/[1-3]$/,
    );
    return fetch(`http://127.0.0.1:${address.port}/${String(url).split('/').at(-1)}`, init);
  };
  return { npmRequest, serialRequest, requests };
}
const noNetwork: typeof fetch = async () => {
  throw Error('unexpected network');
};
function noPartial(f: ReturnType<typeof fixture>) {
  assert.equal(existsSync(f.out), false);
  assert.deepEqual(
    readdirSync(f.root).filter(
      (name) =>
        name.startsWith('.candidate-') || name.startsWith('.ort-') || name.startsWith('.serial-'),
    ),
    [],
  );
}

test('no overlay verifies every frozen byte and returns the same directory without any network or output', async (t) => {
  const f = fixture(t, 'none');
  const before = snapshot(f.controlRuntime);
  const result = await acquireCandidateRuntime({
    ...f,
    npmRequest: noNetwork,
    serialRequest: noNetwork,
  });
  assert.deepEqual(result, {
    controlRuntime: f.controlRuntime,
    runtimeDir: f.controlRuntime,
    manifestSha256: sha(controlBytes),
  });
  assert.deepEqual(snapshot(f.controlRuntime), before);
  noPartial(f);
  assert.deepEqual(await verifyCandidateRuntime({ ...f, runtimeDir: result.runtimeDir }), result);
  const cli = spawnSync(
    process.execPath,
    [
      new URL('./acquire-candidate-runtime.ts', import.meta.url).pathname,
      '--repo',
      f.repo,
      '--control-runtime',
      f.controlRuntime,
      '--out',
      f.out,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), result);
});

for (const mode of ['npm', 'serial'] as const)
  test(`${mode}: real HTTP acquisition verifies the complete projection and borrows model bytes without copying`, async (t) => {
    const f = fixture(t, mode);
    const before = snapshot(f.controlRuntime);
    const http = await transport(t, f);
    const result = await acquireCandidateRuntime({ ...f, ...http, token: 'synthetic-token' });
    const expected = loadCandidateRuntime(f.repo);
    assert.equal(result.manifestSha256, expected.manifestSha256);
    assert.deepEqual(readFileSync(join(f.out, 'manifest.json')), expected.manifestBytes);
    for (const row of expected.buildInputs.runtime.assets) {
      const bytes = readFileSync(join(f.out, row.path));
      assert.equal(sha(bytes), row.sha256, row.path);
      assert.equal(bytes.length, row.bytes, row.path);
    }
    assert.ok(lstatSync(join(f.out, 'chunks')).isSymbolicLink());
    assert.equal(
      realpathSync(join(f.out, 'chunks/model.bin')),
      join(f.controlRuntime, 'chunks/model.bin'),
    );
    assert.deepEqual(snapshot(f.controlRuntime), before);
    assert.equal(http.requests.length, mode === 'serial' ? 4 : 1);
    for (const request of http.requests)
      assert.equal(
        request.authorization,
        request.url === '/npm' ? undefined : 'Bearer synthetic-token',
      );
    assert.deepEqual(await verifyCandidateRuntime({ ...f, runtimeDir: f.out }), result);
    assert.deepEqual(
      readdirSync(f.root).filter((name) => name.startsWith('.candidate-')),
      [],
    );
    if (expected.encoderDescriptor) {
      const descriptor = join(f.out, expected.encoderDescriptor.path);
      const bytes = readFileSync(descriptor);
      writeFileSync(descriptor, Buffer.alloc(bytes.length, 32));
      await assert.rejects(verifyCandidateRuntime({ ...f, runtimeDir: f.out }), /digest mismatch/);
      writeFileSync(descriptor, bytes);
    }
    writeFileSync(join(f.out, 'manifest.json'), Buffer.alloc(expected.manifestBytes.length, 32));
    await assert.rejects(verifyCandidateRuntime({ ...f, runtimeDir: f.out }), /digest mismatch/);
  });

test('control digest, declared size, canonical paths and symlinks fail before any HTTP', async (t) => {
  for (const change of [
    'digest',
    'size',
    'traversal',
    'drive',
    'control',
    'duplicate',
    'symlink',
  ]) {
    const f = fixture(t);
    if (change === 'digest')
      writeFileSync(join(f.controlRuntime, 'chunks/model.bin'), Buffer.alloc(24, 1));
    if (change === 'size') f.inputs.runtime.assets[2]!.bytes++;
    if (change === 'traversal') f.inputs.runtime.assets[2]!.path = '../model.bin';
    if (change === 'drive') f.inputs.runtime.assets[2]!.path = 'C:/model.bin';
    if (change === 'control') f.inputs.runtime.assets[2]!.path = 'chunks/\nmodel.bin';
    if (change === 'duplicate') f.inputs.runtime.assets.push(f.inputs.runtime.assets[2]!);
    if (change === 'symlink') symlinkSync(f.root, join(f.controlRuntime, 'escape'));
    writeFileSync(f.inputsPath, JSON.stringify(f.inputs));
    await assert.rejects(
      acquireCandidateRuntime({ ...f, npmRequest: noNetwork }),
      /mismatch|runtime row|duplicate|link escapes/,
    );
    noPartial(f);
  }
});

test('missing or invalid reviewed serial authority and corrupt acquired serial bytes fail closed', async (t) => {
  for (const change of ['missing', 'foreign', 'bundle', 'symlink', 'override', 'bytes']) {
    const f = fixture(t, 'serial');
    const http = await transport(t, f, change === 'bytes');
    if (change === 'missing') rmSync(f.sourcePath);
    if (change === 'foreign') f.source.files[0]!.url = 'https://example.com/serial.wasm';
    if (change === 'bundle') f.source.bundleSha256 = '0'.repeat(64);
    if (change === 'foreign' || change === 'bundle')
      writeFileSync(f.sourcePath, JSON.stringify(f.source));
    if (change === 'symlink') {
      rmSync(f.sourcePath);
      symlinkSync(f.overlayPath, f.sourcePath);
    }
    await assert.rejects(
      acquireCandidateRuntime({
        ...f,
        ...http,
        ...(change === 'override' ? { serialSourcePath: f.overlayPath } : {}),
      }),
      /ENOENT|Serial acquisition|reviewed/,
    );
    assert.equal(http.requests.length, change === 'bytes' ? 3 : 0);
    noPartial(f);
  }
});

test('corruption while npm is acquired is caught by candidate verification and removes only owned output', async (t) => {
  const f = fixture(t);
  const http = await transport(t, f);
  const original = readFileSync(join(f.controlRuntime, 'chunks/model.bin'));
  const npmRequest: typeof fetch = async (...args) => {
    const response = await http.npmRequest(...args);
    writeFileSync(join(f.controlRuntime, 'chunks/model.bin'), Buffer.alloc(original.length, 1));
    return response;
  };
  await assert.rejects(
    acquireCandidateRuntime({ ...f, npmRequest }),
    /chunks\/model.bin: digest mismatch/,
  );
  assert.equal(existsSync(f.controlRuntime), true);
  noPartial(f);
});

test('preexisting caller output and external candidate links are refused without removal', async (t) => {
  const f = fixture(t);
  mkdirSync(f.out);
  writeFileSync(join(f.out, 'caller.txt'), 'keep');
  await assert.rejects(acquireCandidateRuntime({ ...f, npmRequest: noNetwork }), /already exists/);
  assert.equal(readFileSync(join(f.out, 'caller.txt'), 'utf8'), 'keep');
  rmSync(f.out, { recursive: true });
  const http = await transport(t, f);
  await acquireCandidateRuntime({ ...f, ...http });
  const external = join(f.root, 'external.bin');
  writeFileSync(external, readFileSync(join(f.controlRuntime, 'chunks/model.bin')));
  symlinkSync(external, join(f.out, 'unreferenced-escape'));
  await assert.rejects(verifyCandidateRuntime({ ...f, runtimeDir: f.out }), /link escapes/);
  assert.equal(readFileSync(external, 'utf8'), 'small frozen model bytes');
});
