// Native retirement (fm-be10): the bridge and media have no native dispatch, the build id no longer hashes
// desktop/runtime.mjs, the web-artifact verifier lives at apps/web/scripts/ with every classic check kept, and
// nothing outside history notes still names its old path. Real files, real Python, real git; no fakes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const REPO = join(WEB, '../..');
const VERIFIER = join(WEB, 'scripts/verify-web-artifact.py');
const OLD_PATH = ['desktop', 'scripts', 'verify-web-artifact.py'].join('/');
const read = (path: string) => readFileSync(join(WEB, path), 'utf8');

test('the bridge and media import nothing from desktop/ and have no native branch', () => {
  for (const file of ['src/Next/product-bridge.mjs', 'src/Next/media.mjs']) {
    const text = read(file);
    assert.doesNotMatch(text, /from\s+['"][^'"]*desktop\//, file);
    assert.doesNotMatch(text, /__TAURI__|createDesktopRuntime|native_save_media/, file);
  }
  assert.equal(existsSync(join(WEB, 'desktop')), false, 'apps/web/desktop/ is gone');
  // The former native-only switches are now the browser's: raw pixels, the preferred route, the frames path.
  const bridge = read('src/Next/product-bridge.mjs');
  assert.match(bridge, /runtime=createBrowserRuntime\(\{/);
  assert.match(bridge, /service\.setPreferredRoute\(provider\);\n\}/);
  assert.doesNotMatch(bridge, /raw:!globalThis/);
});

test('the closure import check passes: no unresolved specifier (the Fable output was swapped for project-json.ts, fm-stth)', () => {
  const r = spawnSync(
    process.execPath,
    [
      join(REPO, 'scripts/inventory/unresolved-imports.mjs'),
      '--root',
      'apps/web',
      '--lock',
      'package-lock.json',
      '--expect-none',
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  const unresolved = r.stdout
    .split('\n')
    .filter((l) => l.includes('"importer"'))
    .map((l) => JSON.parse(l) as { importer: string; specifier: string })
    .filter((u) => !u.importer.startsWith('apps/web/dist/')); // a local Vite build output, untracked
  assert.deepEqual(
    unresolved.map((u) => u.specifier),
    [],
    r.stdout + r.stderr,
  );
});

test('the build id hashes src/Next only, path then bytes, and not desktop/runtime.mjs', () => {
  const require = createRequire(import.meta.url);
  const build = require(join(WEB, 'scripts/build-next.cjs')) as {
    buildIdInputs: () => string[];
    buildId: (files?: string[]) => string;
  };
  const files = build.buildIdInputs();
  assert.ok(files.length > 50, `${files.length} inputs`);
  assert.ok(!files.some((f) => f.includes('desktop/')), 'no desktop/ input');
  assert.ok(files.every((f) => f.startsWith('src/Next/') && /\.(fs|mjs|scss)$/.test(f)));
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(join(WEB, f)));
  }
  assert.equal(build.buildId(), `next-${hash.digest('hex').slice(0, 16)}`);
  assert.match(build.buildId(), /^next-[0-9a-f]{16}$/);
});

// ---- The verifier, against planted artifacts. One case per check of classic a42829b's verifier (under desktop/,
// scripts/); none is retired, so there is no tests/retired.txt entry.
const REV = 'a'.repeat(40);
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
function artifact(
  files: Record<string, string> = {
    'deploy-next/index.html': '<!doctype html>',
    'deploy-next/a/app.js': 'x',
  },
) {
  const root = mkdtempSync(join(tmpdir(), 'web-artifact-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  writeFileSync(join(root, 'next-site-source.txt'), `${REV}\n`);
  const sums = Object.entries(files).map(([name, body]) => `${sha(body)}  ${name}`);
  writeFileSync(join(root, 'next-site-SHA256SUMS'), `${sums.join('\n')}\n`);
  return root;
}
function verify(root: string, revision = REV) {
  const receipt = join(root, 'out/receipt.json');
  const r = spawnSync(
    'python3',
    [VERIFIER, '--artifact', root, '--revision', revision, '--receipt', receipt],
    {
      encoding: 'utf8',
    },
  );
  return { ...r, receipt };
}
const sums = (root: string, text: string) =>
  writeFileSync(join(root, 'next-site-SHA256SUMS'), text);

test('verifier: an exact artifact passes and writes the receipt', () => {
  const root = artifact();
  const r = verify(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Verified 2 compiled web files at a{40}/);
  const receipt = JSON.parse(readFileSync(r.receipt, 'utf8'));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.webSourceRevision, REV);
  assert.deepEqual(receipt.files.map((f: { path: string }) => f.path).sort(), [
    'deploy-next/a/app.js',
    'deploy-next/index.html',
  ]);
});

const CHECKS: [string, RegExp, (root: string) => string | void][] = [
  ['the revision is a full 40-hex commit', /Expected full source revision/, () => 'abc123'],
  ['the artifact names the same source revision', /source revision differs/, () => 'b'.repeat(40)],
  [
    'each digest is 64 hex',
    /Invalid web artifact inventory/,
    (r) => sums(r, `xyz  deploy-next/index.html\n`),
  ],
  [
    'no absolute path',
    /Invalid web artifact inventory/,
    (r) => sums(r, `${sha('x')}  /etc/passwd\n`),
  ],
  [
    'no .. component',
    /Invalid web artifact inventory/,
    (r) => sums(r, `${sha('x')}  deploy-next/../next-site-source.txt\n`),
  ],
  [
    'every path is under deploy-next/',
    /Invalid web artifact inventory/,
    (r) => sums(r, `${sha(REV + '\n')}  next-site-source.txt\n`),
  ],
  [
    'no path is listed twice',
    /Invalid web artifact inventory/,
    (r) => sums(r, readFileSync(join(r, 'next-site-SHA256SUMS'), 'utf8').repeat(2)),
  ],
  [
    'no symlink or escape from deploy-next/',
    /escapes frontend/,
    (r) => {
      symlinkSync(join(r, 'next-site-source.txt'), join(r, 'deploy-next/link.txt'));
      sums(
        r,
        `${sha(REV + '\n')}  deploy-next/link.txt\n${sha('<!doctype html>')}  deploy-next/index.html\n`,
      );
    },
  ],
  [
    'each file matches its digest',
    /checksum differs: deploy-next\/a\/app\.js/,
    (r) => writeFileSync(join(r, 'deploy-next/a/app.js'), 'y'),
  ],
  [
    'every file under deploy-next/ is listed',
    /Incomplete web artifact inventory/,
    (r) => writeFileSync(join(r, 'deploy-next/extra.js'), 'z'),
  ],
];

for (const [check, message, plant] of CHECKS) {
  test(`verifier check: ${check}`, () => {
    const root = artifact();
    const revision = plant(root) ?? REV;
    const r = verify(root, revision);
    assert.notEqual(r.status, 0, `${check}: accepted`);
    assert.match(r.stderr, message, check);
    assert.equal(existsSync(r.receipt), false, 'no receipt on failure');
  });
}

test('verifier: index.html must be listed', () => {
  // Without index.html at all: the inventory is complete, but the site has no entry page.
  const r = verify(artifact({ 'deploy-next/a/app.js': 'x' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Incomplete web artifact inventory/);
});

test('verifier: the identified deploy-next/ from build:next passes', (t) => {
  const identity = join(REPO, 'next-site-identity.json');
  if (!existsSync(identity) && process.env.FACEMORPH_REQUIRE_ARTIFACT)
    assert.fail('FACEMORPH_REQUIRE_ARTIFACT is set but build:next has not run');
  if (!existsSync(identity))
    return t.skip('untested here: run `npm run build:next` first (CI does)');
  const label = JSON.parse(readFileSync(identity, 'utf8')).label as string;
  assert.ok(label === 'destination' || label.startsWith('control '), label);
  const revision = readFileSync(join(REPO, 'next-site-source.txt'), 'utf8').trim();
  const out = mkdtempSync(join(tmpdir(), 'control-receipt-'));
  const r = spawnSync(
    'python3',
    [VERIFIER, '--artifact', REPO, '--revision', revision, '--receipt', join(out, 'r.json')],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Verified \\d+ compiled web files at ${revision}`));
});

// ---- References: the old verifier path survives only in history notes, and the app recommends nothing native.
const HISTORY = [
  /^\.beads\//,
  /^PLAN\.md$/,
  /^docs\//,
  /^import\//,
  /^inventory\//,
  /^autoresearch\/(results\.tsv|reviews\/)/,
];

test(`no reference to the old verifier path outside history notes`, () => {
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
    .stdout.split('\0')
    .filter(Boolean);
  assert.ok(files.length > 100);
  const hits = files.filter(
    (f) =>
      !HISTORY.some((h) => h.test(f)) &&
      existsSync(join(REPO, f)) &&
      readFileSync(join(REPO, f), 'latin1').includes(OLD_PATH),
  );
  assert.deepEqual(hits, []);
});

test('apps/web source carries no active native install or availability recommendation', () => {
  const files = spawnSync(
    'git',
    ['ls-files', '-z', 'src', 'shell', 'photo-runtime', 'index.html'],
    { cwd: WEB, encoding: 'utf8' },
  )
    .stdout.split('\0')
    .filter((f) => f && existsSync(join(WEB, f)) && !f.endsWith('.test.mjs'));
  const pattern =
    /native (install|cpu processing|app)|installer|desktop (app|package|preview|install|shell|version)|__TAURI__/i;
  // Historical notes that say the packages are retired are allowed, by file and line.
  const NOTES = new Set(['shell/render/Notes.tsx:4', 'shell/render/help.ts:172']);
  const hits = files.flatMap((f) =>
    read(f)
      .split('\n')
      .flatMap((l, i) =>
        pattern.test(l) && !NOTES.has(`${f}:${i + 1}`)
          ? [`${f}:${i + 1}: ${l.trim().slice(0, 120)}`]
          : [],
      ),
  );
  assert.deepEqual(hits, []);
});
