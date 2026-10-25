// Model serving headers and the model-origin deploy (fm-fy2.14): the `_headers` rules and the header judge on plain
// values, and origin-deploy --publish without the model terms acknowledgement refused before cf runs (its dry run is
// in mirror.test.ts, beside the mirror's: both build into the package's .cloudflare/). The same judge against the
// deployed test origin is the staging qualification's header check.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IMMUTABLE_CACHE,
  MUTABLE_CACHE,
  expectedType,
  extensionsOf,
  judgeHeaders,
  modelHeaders,
} from '../src/headers.ts';

const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(PACKAGE, 'src/cli.ts');
const plan = {
  basePath: '/runtime/',
  immutable: ['assets/', 'chunks/'],
  mutable: ['manifest.json'],
  extensions: ['f32', 'json', 'onnx', 'png'],
};

test('the rules: CORS, CORP and nosniff on the root, immutable and mutable caching, a type for untyped extensions', () => {
  assert.equal(
    modelHeaders(plan),
    [
      '/runtime/*',
      '  Access-Control-Allow-Origin: *',
      '  Cross-Origin-Resource-Policy: cross-origin',
      '  X-Content-Type-Options: nosniff',
      '/runtime/assets/*',
      `  Cache-Control: ${IMMUTABLE_CACHE}`,
      '/runtime/chunks/*',
      `  Cache-Control: ${IMMUTABLE_CACHE}`,
      '/runtime/manifest.json',
      `  Cache-Control: ${MUTABLE_CACHE}`,
      '/runtime/*.f32',
      '  Content-Type: application/octet-stream',
      '/runtime/*.onnx',
      '  Content-Type: application/octet-stream',
      '',
    ].join('\n'),
  );
  assert.deepEqual(extensionsOf(['a/b.F32', 'c.json', 'd', 'e.json']), ['f32', 'json']);
  assert.equal(expectedType('/runtime/assets/x/seed-1.png'), 'image/png');
  assert.equal(expectedType('/runtime/assets/x/average.f32'), 'application/octet-stream');
});

test('the judge names every missing or wrong header and passes a correct answer', () => {
  const good = new Headers({
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
    'content-type': 'application/octet-stream',
    'cache-control': IMMUTABLE_CACHE,
  });
  assert.deepEqual(judgeHeaders(plan, '/runtime/chunks/a.bin', 200, good), []);
  const bad = new Headers({ 'content-type': 'application/json', 'cache-control': IMMUTABLE_CACHE });
  assert.deepEqual(
    judgeHeaders(plan, '/runtime/manifest.json', 404, bad).map((f) => f.header),
    [
      'status',
      'access-control-allow-origin',
      'cross-origin-resource-policy',
      'x-content-type-options',
      'cache-control',
    ],
  );
  const untyped = new Headers(good);
  untyped.delete('content-type');
  assert.deepEqual(judgeHeaders(plan, '/runtime/assets/x/average.f32', 200, untyped), [
    {
      path: '/runtime/assets/x/average.f32',
      header: 'content-type',
      expected: 'application/octet-stream',
      actual: null,
    },
  ]);
});

/** A planted staged root: a manifest naming the model source, and files under the immutable prefixes. */
function plantedRoot() {
  const root = mkdtempSync(join(tmpdir(), 'origin-root-'));
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({
      modelSourceSha256: 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d',
    }),
    'assets/aa/average.f32': 'f32',
    'chunks/bb.bin': 'bin',
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
const originArgs = (root: string) => [
  CLI,
  'origin-deploy',
  '--root',
  root,
  '--worker',
  'model-origin-dry-run-probe',
  '--workers-dev',
  '--base-path',
  '/runtime/',
  '--immutable',
  'assets/,chunks/',
  '--mutable',
  'manifest.json',
];

test('origin-deploy --publish without the model terms acknowledgement is refused before cf runs', () => {
  const root = plantedRoot();
  const r = spawnSync(
    process.execPath,
    [...originArgs(root), '--terms', join(REPO, 'import/licences.json'), '--publish'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.equal(report.published, false);
  assert.equal(report.status, null, 'cf never ran');
  assert.match(report.refused, /nvidia-stylegan2-ffhq-config-f-derived .* must acknowledge it/);
  rmSync(root, { recursive: true, force: true });
});

test('qualify-origin checks real served bytes, headers, chunk reconstruction and reference identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qualify-origin-'));
  const bytes = Buffer.from('a real served asset');
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const parts = [bytes.subarray(0, 8), bytes.subarray(8)];
  let corrupt = false;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    const body = readFileSync(join(root, path.slice('/runtime/'.length)));
    res.writeHead(200, {
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
      'content-type': expectedType(path),
      'cache-control': path.endsWith('/manifest.json') ? MUTABLE_CACHE : IMMUTABLE_CACHE,
    });
    res.end(corrupt && path.includes('/chunks/') ? Buffer.alloc(body.length) : body);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    mkdirSync(join(root, 'chunks'));
    const chunks = parts.map((body) => {
      const digest = sha(body);
      writeFileSync(join(root, 'chunks', `${digest}.bin`), body);
      return {
        url: `https://models.example.test/runtime/chunks/${digest}.bin`,
        sha256: digest,
        size: body.length,
      };
    });
    const asset = {
      url: 'https://models.example.test/runtime/whole.bin',
      sha256: sha(bytes),
      size: bytes.length,
      chunks,
    };
    const manifest = {
      schemaVersion: 1,
      bundleVersion: 'qualification-input',
      modelSourceSha256: 'a'.repeat(64),
      noiseSha256: 'b'.repeat(64),
      mapping: asset,
      synthesis: asset,
      noise: [{ ...asset, name: 'noise', shape: [1] }],
    };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    const reference = join(tmpdir(), `qualify-reference-${process.pid}-${Date.now()}.json`);
    writeFileSync(reference, JSON.stringify(manifest));
    try {
      const run = () =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
          const p = spawn(process.execPath, [
            CLI,
            'qualify-origin',
            '--root',
            root,
            '--origin',
            origin,
            '--base-path',
            '/runtime/',
            '--immutable',
            'chunks/',
            '--mutable',
            'manifest.json',
            '--reference',
            reference,
          ]);
          let stdout = '',
            stderr = '';
          p.stdout.on('data', (d) => {
            stdout += d;
          });
          p.stderr.on('data', (d) => {
            stderr += d;
          });
          p.on('error', reject);
          p.on('close', (code) => resolve({ code, stdout, stderr }));
        });
      const good = await run();
      assert.equal(good.code, 0, good.stderr + good.stdout);
      const report = JSON.parse(good.stdout);
      assert.equal(report.ok, true);
      assert.equal(report.files, 3);
      assert.equal(report.chunked, 3);
      assert.equal(report.contract, null);
      corrupt = true;
      const bad = await run();
      assert.equal(bad.code, 1, bad.stderr + bad.stdout);
      const failed = JSON.parse(bad.stdout);
      assert.equal(failed.mismatched.length, 2);
      assert.equal(failed.unreconstructed.length, 3);
    } finally {
      rmSync(reference, { force: true });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
});
