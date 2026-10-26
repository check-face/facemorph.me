import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { applyOrtMirror } from './apply-ort-mirror.ts';
import { composeManifest, generateOverlay, ORT_FILES } from './ort-mirror.ts';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const originalControl = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../import/runtime-manifests/control/d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-acquire-ort-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'archive', 'package');
  const dist = join(packageRoot, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: '1.30.0' }),
  );
  for (const [i, file] of ORT_FILES.entries())
    writeFileSync(join(dist, file), `actual fixture bytes ${i}: ${file}`);
  const archive = join(root, 'ort.tgz');
  const repack = () => {
    execFileSync('tar', ['-czf', archive, '-C', join(root, 'archive'), 'package']);
    return readFileSync(archive);
  };
  const bytes = repack();
  const lock = {
    version: '1.30.0',
    resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  const overlay = generateOverlay(dist, lock);
  const control = join(root, 'control');
  mkdirSync(join(control, 'assets', 'old-bundle'), { recursive: true });
  mkdirSync(join(control, 'chunks'));
  mkdirSync(join(control, 'encoder-stream'));
  writeFileSync(join(control, 'manifest.json'), JSON.stringify(originalControl()));
  writeFileSync(join(control, 'assets', 'old-bundle', 'original.bin'), 'frozen original bytes');
  writeFileSync(join(control, 'chunks', 'model.bin'), 'frozen model bytes');
  writeFileSync(join(control, 'encoder-stream', 'manifest.json'), '{"version":"1.24.3"}');
  const request: typeof fetch = async () => new Response(bytes);
  return {
    root,
    control,
    dist,
    packageRoot,
    archive,
    bytes,
    overlay,
    repack,
    request,
    out: join(root, 'candidate'),
  };
}

async function server(
  t: TestContext,
  bytes: Buffer,
  status = 200,
  headers: Record<string, string> = {},
) {
  const app = createServer((_request, response) => {
    response.writeHead(status, headers);
    response.end(bytes);
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        app.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = app.address();
  assert.ok(address && typeof address === 'object');
  const local = `http://127.0.0.1:${address.port}/ort.tgz`;
  const request: typeof fetch = async (input, init) => {
    assert.equal(
      String(input),
      'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
    );
    assert.equal(init?.redirect, 'error');
    return fetch(local, init);
  };
  return request;
}

test('real HTTP tarball verifies and stages six assets while preserving the control and model/reference fields', async (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.control, 'manifest.json'));
  const result = await applyOrtMirror({
    controlRuntime: f.control,
    overlay: f.overlay,
    out: f.out,
    fetch: await server(t, f.bytes, 200, { 'content-length': String(f.bytes.length) }),
  });
  assert.equal(result.files, 6);
  assert.equal(
    result.bytes,
    f.overlay.files.reduce((n, file) => n + file.size, 0),
  );
  assert.equal(result.controlManifestSha256, sha(before));
  assert.equal(result.manifestSha256, sha(readFileSync(join(f.out, 'manifest.json'))));
  const composed = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'));
  assert.deepEqual(
    composed,
    composeManifest(originalControl(), f.overlay, 'https://next.facemorph.me'),
  );
  assert.equal(
    (composed.encoderStream as { sha256: string }).sha256,
    originalControl().encoderStream.sha256,
  );
  for (const file of f.overlay.files)
    assert.equal(sha(readFileSync(join(f.out, file.path))), file.sha256);
  for (const path of [
    'assets/old-bundle/original.bin',
    'chunks/model.bin',
    'encoder-stream/manifest.json',
  ]) {
    assert.equal(
      readFileSync(join(f.out, path), 'utf8'),
      readFileSync(join(f.control, path), 'utf8'),
    );
  }
  assert.ok(lstatSync(join(f.out, 'chunks')).isSymbolicLink());
  assert.equal(realpathSync(join(f.out, 'chunks')), join(f.control, 'chunks'));
  assert.deepEqual(readFileSync(join(f.control, 'manifest.json')), before);
  assert.deepEqual(readdirSync(join(f.control, 'assets')), ['old-bundle']);
  assert.deepEqual(
    readdirSync(f.root).filter((name) => name.startsWith('.ort-')),
    [],
  );
});

test('wrong tarball integrity rejects before output or archive extraction', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    applyOrtMirror({
      controlRuntime: f.control,
      overlay: f.overlay,
      out: f.out,
      fetch: await server(t, Buffer.from('corrupt npm tarball')),
    }),
    /SHA512 integrity mismatch/,
  );
  assert.equal(existsSync(f.out), false);
  assert.deepEqual(
    readdirSync(f.root).filter((name) => name.startsWith('.ort-')),
    [],
  );
});

test('authenticated tarball with changed asset or package identity still rejects declared metadata', async (t) => {
  for (const change of ['asset', 'identity', 'missing']) {
    const f = fixture(t);
    if (change === 'asset') writeFileSync(join(f.dist, ORT_FILES[0]), 'wrong bytes');
    if (change === 'identity')
      writeFileSync(join(f.packageRoot, 'package.json'), '{"name":"wrong","version":"1.30.0"}');
    if (change === 'missing') rmSync(join(f.dist, ORT_FILES[0]));
    const alteredBytes = f.repack();
    // Recompute the authenticated archive provenance, while preserving the independently recorded asset hashes.
    const overlay = {
      ...f.overlay,
      npm: {
        ...f.overlay.npm,
        integrity: `sha512-${createHash('sha512').update(alteredBytes).digest('base64')}`,
      },
      files: f.overlay.files.map((row) => ({ ...row })),
    };
    overlay.bundleSha256 = sha(
      JSON.stringify({
        version: overlay.version,
        npm: overlay.npm,
        gpuBuild: overlay.gpuBuild,
        files: overlay.files.map(({ file, sha256, size }) => ({ file, sha256, size })),
      }),
    );
    for (const row of overlay.files) row.path = `assets/${overlay.bundleSha256}/${row.file}`;
    await assert.rejects(
      applyOrtMirror({
        controlRuntime: f.control,
        overlay,
        out: f.out,
        fetch: async () => new Response(alteredBytes),
      }),
      /digest or size mismatch|installed package identity|archive member/,
    );
    assert.equal(existsSync(f.out), false);
  }
});

test('preexisting files, directories, dangling links, symlinked parents and control overlap are preserved and refused', async (t) => {
  const f = fixture(t);
  const directory = join(f.root, 'directory');
  mkdirSync(directory);
  const file = join(f.root, 'file');
  writeFileSync(file, 'do not touch');
  const link = join(f.root, 'link');
  symlinkSync(join(f.root, 'absent'), link);
  const parent = join(f.root, 'linked-parent');
  symlinkSync(directory, parent);
  for (const out of [
    directory,
    file,
    link,
    join(parent, 'new'),
    join(f.control, 'new'),
    f.root,
    join(f.root, 'x', '..', 'candidate') + '/..',
  ]) {
    await assert.rejects(
      applyOrtMirror({ controlRuntime: f.control, overlay: f.overlay, out, fetch: f.request }),
      /output|separate/,
    );
  }
  assert.equal(readFileSync(file, 'utf8'), 'do not touch');
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.deepEqual(readdirSync(directory), []);
});

test('an output that appears during fetch is preserved rather than replaced', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    applyOrtMirror({
      controlRuntime: f.control,
      overlay: f.overlay,
      out: f.out,
      fetch: async () => {
        mkdirSync(f.out);
        writeFileSync(join(f.out, 'peer.txt'), 'peer data');
        return new Response(f.bytes);
      },
    }),
    /output appeared/,
  );
  assert.equal(readFileSync(join(f.out, 'peer.txt'), 'utf8'), 'peer data');
  assert.deepEqual(
    readdirSync(f.root).filter((name) => name.startsWith('.ort-')),
    [],
  );
});

test('hidden control links and overlay path traversal fail before network access', async (t) => {
  const f = fixture(t);
  let requests = 0;
  const request: typeof fetch = async () => {
    requests++;
    return new Response(f.bytes);
  };
  const bad = structuredClone(f.overlay) as unknown as { files: { path: string }[] };
  bad.files[0]!.path = '../escape';
  await assert.rejects(
    applyOrtMirror({ controlRuntime: f.control, overlay: bad, out: f.out, fetch: request }),
    /immutable bundle/,
  );
  symlinkSync(join(f.control, 'manifest.json'), join(f.control, 'chunks', 'hidden-link'));
  await assert.rejects(
    applyOrtMirror({ controlRuntime: f.control, overlay: f.overlay, out: f.out, fetch: request }),
    /real files/,
  );
  assert.equal(requests, 0);
});

test('HTTP failures, oversized declared tarballs and truncated bodies fail closed', async (t) => {
  const f = fixture(t);
  for (const request of [
    await server(t, Buffer.from('no'), 500),
    async () =>
      new Response(f.bytes, { headers: { 'content-length': String(256 * 1024 * 1024 + 1) } }),
    async () =>
      new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length + 1) } }),
  ] as (typeof fetch)[])
    await assert.rejects(
      applyOrtMirror({ controlRuntime: f.control, overlay: f.overlay, out: f.out, fetch: request }),
      /registry returned 500|size bound|empty or truncated/,
    );
  assert.equal(existsSync(f.out), false);
});
