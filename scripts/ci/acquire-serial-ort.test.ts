import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { acquireSerialCompanion, validateSerialSource } from './acquire-serial-ort.ts';
import { generateOverlay, ORT_FILES, withSerialCompanion } from './ort-mirror.ts';
import { generateSerialCompanion, SERIAL_ORT_FILES, verifySerialCompanion } from './serial-ort.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const control = readFileSync(
  new URL(
    '../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
    import.meta.url,
  ),
);
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32]);

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'serial-acquisition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const built = join(root, 'built');
  const out = join(root, 'bundle');
  mkdirSync(built);
  const bytes = SERIAL_ORT_FILES.map((file) =>
    file.endsWith('.wasm') ? wasm : Buffer.from(`synthetic ${file}`),
  );
  SERIAL_ORT_FILES.forEach((file, index) => writeFileSync(join(built, file), bytes[index]!));
  const companion = generateSerialCompanion(
    built,
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
      commandSha256: hash('synthetic command'),
      linkReceiptSha256: hash('synthetic link receipt'),
    },
    control,
  );
  const source = {
    schema: 'facemorph.serial-ort-source/1',
    bundleSha256: companion.bundleSha256,
    files: companion.files.map((file, index) => ({
      file: file.file,
      url: `https://api.github.com/repos/facemorph-me/facemorph.me/releases/assets/${index + 1}`,
    })),
  };
  return { root, built, out, bytes, companion, source };
}

async function transport(
  t: TestContext,
  bytes: readonly Buffer[],
  options: { mode?: string } = {},
) {
  const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url!, headers: request.headers });
    const index = Number(request.url!.split('/').at(-1)) - 1;
    const body = bytes[index]!;
    if (options.mode === 'http') {
      response.writeHead(503);
      response.end('unavailable');
      return;
    }
    if (options.mode === 'redirect') {
      response.writeHead(302, {
        location: `https://release-assets.githubusercontent.com/signed/${index + 1}?sig=opaque`,
      });
      response.end();
      return;
    }
    if (options.mode === 'foreign-redirect') {
      response.writeHead(302, { location: 'https://example.com/leak' });
      response.end();
      return;
    }
    if (options.mode === 'length') response.setHeader('content-length', body.length + 1);
    if (options.mode === 'oversized') {
      response.write(Buffer.concat([body, Buffer.from('extra')]));
      response.end();
      return;
    }
    if (options.mode === 'short') {
      response.write(body.subarray(0, body.length - 1));
      response.end();
      return;
    }
    response.end(options.mode === 'corrupt' ? Buffer.alloc(body.length, 1) : body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.match(
      url,
      /^https:\/\/api\.github\.com\/repos\/facemorph-me\/facemorph\.me\/releases\/assets\/[1-3]$/,
    );
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.method, 'GET');
    return fetch(`http://127.0.0.1:${address.port}/${url.split('/').at(-1)}`, init);
  };
  return { request, seen };
}

test('downloads pinned bytes over HTTP, sends octet-stream headers, installs exact files and reuses cache without requests', async (t) => {
  const f = fixture(t);
  const http = await transport(t, f.bytes);
  const result = await acquireSerialCompanion({
    ...f,
    request: http.request,
    token: 'synthetic-secret',
  });
  assert.equal(result.cached, false);
  assert.equal(result.dist, f.out);
  assert.deepEqual(result.companion, f.companion);
  assert.deepEqual(readdirSync(f.out).sort(), [...SERIAL_ORT_FILES].sort());
  assert.deepEqual(verifySerialCompanion(f.out, f.companion), f.companion);
  assert.equal(http.seen.length, 3);
  for (const request of http.seen) {
    assert.equal(request.headers.accept, 'application/octet-stream');
    assert.equal(request.headers.authorization, 'Bearer synthetic-secret');
  }
  const cached = await acquireSerialCompanion({
    ...f,
    request: async () => {
      throw new Error('cache performed network request');
    },
  });
  assert.equal(cached.cached, true);
  assert.deepEqual(readdirSync(f.root).sort(), ['built', 'bundle']);
});

for (const mode of ['http', 'length', 'oversized', 'short', 'corrupt', 'foreign-redirect'])
  test(`failed ${mode} acquisition leaves output absent and unrelated files intact`, async (t) => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'keep'), 'unrelated');
    const http = await transport(t, f.bytes, { mode });
    await assert.rejects(
      acquireSerialCompanion({ ...f, request: http.request, token: 'synthetic-secret' }),
      (error: Error) => {
        assert.ok(!error.message.includes('synthetic-secret'));
        return /Serial acquisition:/.test(error.message);
      },
    );
    assert.deepEqual(readdirSync(f.root).sort(), ['built', 'keep']);
    assert.equal(readFileSync(join(f.root, 'keep'), 'utf8'), 'unrelated');
    assert.equal(http.seen.length, 1);
  });

test('only GitHub release CDN redirects are followed and credentials are never forwarded', async (t) => {
  const f = fixture(t);
  const http = await transport(t, f.bytes, { mode: 'redirect' });
  let redirected = 0;
  const request: typeof fetch = async (input, init) => {
    if (String(input).startsWith('https://api.github.com/')) return http.request(input, init);
    assert.match(
      String(input),
      /^https:\/\/release-assets\.githubusercontent\.com\/signed\/[1-3]\?sig=opaque$/,
    );
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(new Headers(init?.headers).get('accept'), 'application/octet-stream');
    assert.equal(init?.redirect, 'error');
    const body = f.bytes[Number(new URL(String(input)).pathname.split('/').at(-1)) - 1]!;
    redirected++;
    return new Response(body);
  };
  await acquireSerialCompanion({ ...f, request, token: 'synthetic-secret' });
  assert.equal(redirected, 3);
});

test('network errors are sanitized and partial download staging is removed', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const request: typeof fetch = async () => {
    if (calls++ === 0) return new Response(f.bytes[0]);
    throw new Error('transport accidentally included synthetic-secret');
  };
  await assert.rejects(
    acquireSerialCompanion({ ...f, request, token: 'synthetic-secret' }),
    /^Error: Serial acquisition: release asset request failed$/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(readdirSync(f.root), ['built']);
});

test('strict source validation rejects altered bundles, fields, order and noncanonical URLs before network', async (t) => {
  const f = fixture(t);
  const badUrls = [
    'http://api.github.com/repos/facemorph-me/facemorph.me/releases/assets/1',
    'https://example.com/repos/facemorph-me/facemorph.me/releases/assets/1',
    'https://api.github.com/repos/other/repo/releases/assets/1',
    'https://user@api.github.com/repos/facemorph-me/facemorph.me/releases/assets/1',
    f.source.files[0]!.url + '?download=1',
    f.source.files[0]!.url + '#fragment',
    f.source.files[0]!.url.replace('/1', '/0'),
    f.source.files[0]!.url.replace('/1', '/01'),
    f.source.files[0]!.url + '/',
    f.source.files[0]!.url + '\n',
  ];
  const cases = [
    null,
    { ...f.source, schema: 'other' },
    { ...f.source, extra: true },
    { ...f.source, bundleSha256: '0'.repeat(64) },
    { ...f.source, files: [] },
    { ...f.source, files: [...f.source.files].reverse() },
    { ...f.source, files: f.source.files.map((file) => ({ ...file, extra: 1 })) },
    {
      ...f.source,
      files: f.source.files.map((file) => ({ ...file, url: f.source.files[0]!.url })),
    },
    ...badUrls.map((url) => ({
      ...f.source,
      files: [{ ...f.source.files[0], url }, ...f.source.files.slice(1)],
    })),
  ];
  for (const source of cases)
    await assert.rejects(
      acquireSerialCompanion({
        ...f,
        source,
        request: async () => {
          assert.fail('invalid source reached network');
        },
      }),
    );
  assert.deepEqual(validateSerialSource(f.source, f.companion), f.source);
  assert.deepEqual(readdirSync(f.root), ['built']);
});

for (const mode of ['missing', 'extra', 'corrupt', 'symlink', 'directory', 'fifo', 'wrong-bundle'])
  test(`invalid ${mode} cache is preserved and rejected without requests`, async (t) => {
    const f = fixture(t);
    mkdirSync(f.out);
    SERIAL_ORT_FILES.forEach((file, index) => writeFileSync(join(f.out, file), f.bytes[index]!));
    const first = join(f.out, SERIAL_ORT_FILES[0]);
    if (mode === 'missing') rmSync(first);
    if (mode === 'extra') writeFileSync(join(f.out, 'unrelated'), 'retain');
    if (mode === 'corrupt') writeFileSync(first, Buffer.alloc(f.bytes[0]!.length, 2));
    if (mode === 'symlink') {
      rmSync(first);
      symlinkSync(join(f.built, SERIAL_ORT_FILES[0]), first);
    }
    if (mode === 'directory') {
      rmSync(first);
      mkdirSync(first);
    }
    if (mode === 'fifo') {
      rmSync(first);
      execFileSync('mkfifo', [first]);
    }
    const before = readdirSync(f.out).sort();
    const companion =
      mode === 'wrong-bundle' ? { ...f.companion, bundleSha256: '0'.repeat(64) } : f.companion;
    await assert.rejects(
      acquireSerialCompanion({
        ...f,
        companion,
        request: async () => {
          assert.fail('invalid cache reached network');
        },
      }),
    );
    assert.deepEqual(readdirSync(f.out).sort(), before);
    assert.deepEqual(readdirSync(f.root).sort(), ['built', 'bundle']);
  });

test('output and parent symlinks, special files and traversal are refused', async (t) => {
  const f = fixture(t);
  const request: typeof fetch = async () => {
    assert.fail('unsafe output reached network');
  };
  symlinkSync(f.built, f.out);
  await assert.rejects(acquireSerialCompanion({ ...f, request }), /real directory/);
  await assert.rejects(
    acquireSerialCompanion({ ...f, out: join(f.out, 'nested'), request }),
    /real directories/,
  );
  await assert.rejects(
    acquireSerialCompanion({ ...f, out: f.root + '/built/../another', request }),
    /traversal/,
  );
  rmSync(f.out);
  writeFileSync(f.out, 'caller owned');
  await assert.rejects(acquireSerialCompanion({ ...f, request }), /real directory/);
  assert.equal(readFileSync(f.out, 'utf8'), 'caller owned');
});

test('actual WASM memory is verified even when metadata and file digests are internally consistent', async (t) => {
  const f = fixture(t);
  const altered = { ...f.companion, memory: { ...f.companion.memory, initialPages: 0 } };
  const bundleSha256 = hash(
    JSON.stringify({
      schema: altered.schema,
      controlDescriptorSha256: altered.controlDescriptorSha256,
      build: altered.build,
      memory: altered.memory,
      files: altered.files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
  const companion = {
    ...altered,
    bundleSha256,
    files: altered.files.map((file) => ({ ...file, path: `assets/${bundleSha256}/${file.file}` })),
  };
  const source = { ...f.source, bundleSha256 };
  const http = await transport(t, f.bytes);
  await assert.rejects(
    acquireSerialCompanion({ ...f, companion, source, request: http.request }),
    /WASM memory declarations differ/,
  );
  assert.equal(http.seen.length, 3);
  assert.deepEqual(readdirSync(f.root), ['built']);
});

test('caller output appearing during acquisition is preserved', async (t) => {
  const f = fixture(t);
  let index = 0;
  const request: typeof fetch = async () => {
    if (index === 0) {
      mkdirSync(f.out);
      writeFileSync(join(f.out, 'caller'), 'keep');
    }
    return new Response(f.bytes[index++]);
  };
  await assert.rejects(acquireSerialCompanion({ ...f, request }), /output appeared/);
  assert.equal(readFileSync(join(f.out, 'caller'), 'utf8'), 'keep');
  assert.deepEqual(readdirSync(f.root).sort(), ['built', 'bundle']);
});

test('CLI accepts overlay/source/out and reports only the verified cached identity', (t) => {
  const f = fixture(t);
  const npm = join(f.root, 'npm');
  mkdirSync(join(npm, 'dist'), { recursive: true });
  writeFileSync(
    join(npm, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: '1.30.0' }),
  );
  for (const file of ORT_FILES) writeFileSync(join(npm, 'dist', file), `fixture ${file}`);
  const overlay = withSerialCompanion(
    generateOverlay(join(npm, 'dist'), {
      version: '1.30.0',
      resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
      integrity: `sha512-${Buffer.alloc(64, 17).toString('base64')}`,
    }),
    f.companion,
  );
  const overlayPath = join(f.root, 'overlay.json');
  const sourcePath = join(f.root, 'source.json');
  writeFileSync(overlayPath, JSON.stringify(overlay));
  writeFileSync(sourcePath, JSON.stringify(f.source));
  const result = spawnSync(
    process.execPath,
    [
      new URL('./acquire-serial-ort.ts', import.meta.url).pathname,
      '--overlay',
      overlayPath,
      '--source',
      sourcePath,
      '--out',
      f.built,
    ],
    { encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'synthetic-secret' } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dist: f.built,
    bundleSha256: f.companion.bundleSha256,
    cached: true,
  });
  assert.ok(!result.stdout.includes('synthetic-secret'));
});
