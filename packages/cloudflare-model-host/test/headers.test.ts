// Model serving headers and the model-origin deploy (fm-fy2.14): the `_headers` rules and the header judge on plain
// values, and origin-deploy --publish without the model terms acknowledgement refused before cf runs (its dry run is
// in mirror.test.ts, beside the mirror's: both build into the package's .cloudflare/). The same judge against the
// deployed test origin is the staging qualification's header check.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
