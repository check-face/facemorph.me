// Real cf deploy dry runs require workerd (glibc >= 2.32), just like mirror.workerd.ts.
// Run in the existing eris cloudflare-model-host lane, keeping Triton npm test portable.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(PACKAGE, 'src/cli.ts');

test('mirror-deploy without --publish is cf deploy --dry-run: it builds the Worker with the given bindings and needs no credentials', () => {
  // No Cloudflare credentials and an empty home: a request to the API could not authenticate.
  const home = mkdtempSync(join(tmpdir(), 'mirror-deploy-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k)),
  );
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      'mirror-deploy',
      '--worker',
      'mirror-dry-run-probe',
      '--bucket',
      'probe-bucket',
      '--upstream',
      'https://upstream.invalid/',
      '--prefixes',
      'runtime/chunks/,runtime/assets/',
      '--site',
      'probe-site',
    ],
    { encoding: 'utf8', env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') } },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { published: false, status: 0 });
  for (const binding of [
    /env\.MIRROR \(probe-bucket\)\s+R2 Bucket/,
    /env\.SITE \(probe-site\)\s+Worker/,
    /env\.UPSTREAM \("https:\/\/upstream\.invalid\/"\)/,
    /env\.PREFIXES \("runtime\/chunks\/,runtime\/assets\/"\)/,
    /--dry-run: exiting now/,
  ])
    assert.match(r.stderr, binding);
  const bundle = readFileSync(
    join(PACKAGE, '.cloudflare/output/v0/workers/default/bundle/index.js'),
    'utf8',
  );
  assert.match(bundle, /PREFIXES/, 'the bundle is the mirror Worker');
  assert.doesNotMatch(bundle, /facemorph\.me/);
  rmSync(home, { recursive: true, force: true });
});

/** A planted staged root: a manifest naming the model source, and files under the immutable prefixes. */
function plantedOriginRoot() {
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

test('origin-deploy without --publish builds an assets-only Worker holding the root and its rules, with no credentials', () => {
  const root = plantedOriginRoot();
  const home = mkdtempSync(join(tmpdir(), 'origin-home-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k)),
  );
  const r = spawnSync(process.execPath, originArgs(root), {
    encoding: 'utf8',
    env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
    published: false,
    status: 0,
    refused: null,
  });
  assert.match(r.stderr, /--dry-run: exiting now/);
  const out = join(PACKAGE, '.cloudflare/output/v0/workers/default');
  assert.deepEqual(
    JSON.parse(readFileSync(join(out, 'worker.config.json'), 'utf8')).name,
    'model-origin-dry-run-probe',
  );
  assert.equal(existsSync(join(out, 'bundle')), false, 'no Worker script');
  assert.equal(readFileSync(join(out, 'assets/runtime/assets/aa/average.f32'), 'utf8'), 'f32');
  const rules = readFileSync(join(out, 'assets/_headers'), 'utf8');
  assert.match(rules, /\/runtime\/\*\.f32\n {2}Content-Type: application\/octet-stream/);
  assert.match(rules, /\/runtime\/manifest\.json\n {2}Cache-Control: no-cache/);
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
