// fm-a4b: org-link scan. Parsing and classification are called with plain values; the fixture tree
// is real temporary Git repositories with planted files; the last test scans the five repositories
// plus the monorepo (sibling checkouts under IDENTITY_SCAN_ROOT, default the monorepo's parent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineHits, globToRegExp, classify, compileRules, CLASSES } from './scan-org-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'scan-org-links.mjs');

test('hits: URLs on GitHub hosts, gh -R, gh api paths, workflow uses and bare org mentions', () => {
  const one = (line, opts) => lineHits(line, opts).map((h) => [h.kind, h.owner, h.name]);
  assert.deepEqual(one('see https://github.com/check-face/facemorph.me/issues/13.'), [
    ['url', 'check-face', 'facemorph.me'],
  ]);
  assert.deepEqual(one('curl https://raw.githubusercontent.com/NVlabs/stylegan2/master/x'), [
    ['url', 'NVlabs', 'stylegan2'],
  ]);
  assert.deepEqual(one('https://codeload.github.com/check-face/checkface/tar.gz/master'), [
    ['url', 'check-face', 'checkface'],
  ]);
  assert.deepEqual(one('GET api.github.com/repos/check-face/facemorph.me/releases'), [
    ['url', 'check-face', 'facemorph.me'],
  ]);
  assert.deepEqual(one('git clone git@github.com:check-face/facemorph-names.git'), [
    ['url', 'check-face', 'facemorph-names'],
  ]);
  assert.deepEqual(one('gh run download 1 -R check-face/facemorph.me -n x'), [
    ['gh-repo-flag', 'check-face', 'facemorph.me'],
  ]);
  assert.deepEqual(one('gh api repos/check-face/facemorph.me/actions/runs/1'), [
    ['api-path', 'check-face', 'facemorph.me'],
  ]);
  assert.deepEqual(one("REMOTE='check-face/facemorph.me'"), [
    ['org-name', 'check-face', 'facemorph.me'],
  ]);
  assert.deepEqual(one('- uses: actions/checkout@v4', { workflow: true }), [
    ['uses', 'actions', 'checkout'],
  ]);
  assert.deepEqual(one('- uses: ./.github/actions/local', { workflow: true }), []);
  assert.deepEqual(one('- uses: actions/checkout@v4'), [], 'uses only counts in workflow files');
  assert.deepEqual(one('read https://docs.github.com/en/rest and pages.github.com'), []);
  assert.deepEqual(
    one('prop.href (sprintf "https://github.com/%s" githubRepo)'),
    [['url', null, null]],
    'a templated owner is not third-party',
  );
});

test('globs: ** spans directories, * stays within one', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(globToRegExp('**/README.md').test('README.md'));
  assert.ok(globToRegExp('hosting/**/README.md').test('hosting/gallery/README.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/a/b.md'));
  assert.ok(globToRegExp('docs/*-20??-??-??.md').test('docs/self-host-validation-2026-10-10.md'));
});

test('classification: third-party owners are external; ours need a rule; first matching rule wins', () => {
  const rules = compileRules([
    {
      id: 'fix',
      paths: ['src/Config.fs'],
      target: '^check-face/facemorph\\.me$',
      class: 'repo-name-correction',
      correctName: 'facemorph.me-classic',
      disposition: 'd',
    },
    { id: 'docs', paths: ['docs/**'], class: 'active-link', disposition: 'd' },
    { id: 'shadowed', paths: ['docs/x.md'], class: 'archived', disposition: 'd' },
  ]);
  const hit = (file, owner, name, kind = 'url') => ({
    repo: 'r',
    file,
    owner,
    name,
    kind,
    text: '',
  });
  assert.equal(classify(hit('src/a.js', 'NVlabs', 'stylegan2'), rules).class, 'external');
  const fix = classify(hit('src/Config.fs', 'check-face', 'facemorph.me', 'org-name'), rules);
  assert.deepEqual(
    [fix.class, fix.to],
    ['repo-name-correction', 'facemorph-me/facemorph.me-classic'],
  );
  const doc = classify(hit('docs/x.md', 'check-face', 'checkface'), rules);
  assert.deepEqual(
    [doc.class, doc.rule, doc.to],
    ['active-link', 'docs', 'facemorph-me/checkface'],
  );
  assert.equal(classify(hit('other.md', 'check-face', 'checkface'), rules).class, 'unclassified');
  assert.equal(
    classify(hit('other.md', null, null), rules).class,
    'unclassified',
    'templated URLs are never assumed external',
  );
  assert.throws(() => compileRules([{ class: 'leave', disposition: 'd' }]), /unknown class/);
});

function gitRepo(dir, files, origin) {
  mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main'); // `init -b` needs Git 2.28; the CI runner's Git is older
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (origin) git('remote', 'add', 'origin', origin);
}

test('fixture tree: every class, an unclassified hit failing the run, and uncommitted edits not scanned', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-links-'));
  gitRepo(
    join(root, 'app'),
    {
      'docs/active.md': 'Issues: https://github.com/check-face/app/issues\n',
      'src/Config.fs': 'let githubRepo = "check-face/facemorph.me"\n',
      'provenance.json': '{"repository": "https://github.com/check-face/facemorph.me.git"}\n',
      'history/log.md': '[run](https://github.com/check-face/facemorph.me/actions/runs/1)\n',
      'desktop/updater.mjs':
        "endpoints: ['https://github.com/check-face/app/releases/latest/download/latest.json']\n",
      'src/Next/bridge.mjs':
        "const ISSUE_REPO='https://github.com/check-face/facemorph.me/issues/new';\n",
      'vendor/NOTICE.txt': 'Based on https://github.com/NVlabs/stylegan2\n',
      '.github/workflows/ci.yml':
        'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: ./.github/actions/local\n      - run: gh run download 1 -R check-face/app\n',
    },
    'https://github.com/check-face/app.git',
  );
  gitRepo(join(root, 'old'), { 'README.md': 'Source: https://github.com/check-face/old\n' });
  const rules = {
    targets: [
      { repo: 'app', dir: 'app', revs: ['HEAD'] },
      { repo: 'old', dir: 'old', revs: ['main'] },
    ],
    rules: [
      { id: 'origin', paths: ['.git/config'], class: 'active-link', disposition: 'update origin' },
      { id: 'archived', repo: 'old', class: 'archived', disposition: 'leave' },
      {
        id: 'active',
        repo: 'app',
        paths: ['docs/**', '.github/workflows/**'],
        class: 'active-link',
        disposition: 'update',
      },
      {
        id: 'fix',
        repo: 'app',
        paths: ['src/Config.fs'],
        class: 'repo-name-correction',
        correctName: 'facemorph.me-classic',
        disposition: 'correct',
      },
      {
        id: 'prov',
        repo: 'app',
        paths: ['provenance.json'],
        class: 'immutable-provenance',
        disposition: 'map',
      },
      {
        id: 'frozen',
        repo: 'app',
        paths: ['history/**'],
        class: 'frozen-evidence',
        disposition: 'leave',
      },
      {
        id: 'native',
        repo: 'app',
        paths: ['desktop/**'],
        class: 'native-updater',
        disposition: 'retire',
      },
      {
        id: 'candidate',
        repo: 'app',
        paths: ['src/Next/**'],
        class: 'candidate-source',
        disposition: 'edit set',
      },
    ],
  };
  const rulesFile = join(root, 'rules.json');
  writeFileSync(rulesFile, JSON.stringify(rules));
  const runScan = () =>
    spawnSync('node', [script, '--root', root, '--rules', rulesFile], { encoding: 'utf8' });

  let r = runScan();
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const summary = lines.at(-1);
  assert.equal(summary.event, 'scan-done');
  const hits = lines.slice(0, -1);
  const cls = (file) => hits.filter((h) => h.file === file).map((h) => h.class);
  assert.deepEqual(cls('.git/config'), ['active-link']);
  assert.deepEqual(cls('docs/active.md'), ['active-link']);
  assert.deepEqual(cls('src/Config.fs'), ['repo-name-correction']);
  assert.equal(
    hits.find((h) => h.file === 'src/Config.fs').to,
    'facemorph-me/facemorph.me-classic',
  );
  assert.deepEqual(cls('provenance.json'), ['immutable-provenance']);
  assert.deepEqual(cls('history/log.md'), ['frozen-evidence']);
  assert.deepEqual(cls('desktop/updater.mjs'), ['native-updater']);
  assert.deepEqual(cls('src/Next/bridge.mjs'), ['candidate-source']);
  assert.deepEqual(cls('vendor/NOTICE.txt'), ['external']);
  assert.deepEqual(cls('.github/workflows/ci.yml').sort(), ['active-link', 'external']);
  assert.deepEqual(cls('README.md'), ['archived']);
  for (const c of CLASSES) assert.ok(summary.counts[c] >= 1, `class ${c} not exercised`);
  assert.equal(summary.counts.unclassified, 0);
  assert.equal(summary.scanned.length, 2);
  assert.ok(
    hits.every((h) => /^[0-9a-f]{40}$/.test(h.commit) && h.disposition),
    'each hit names the commit scanned and a disposition',
  );

  // An uncommitted edit is not part of the scanned tree.
  writeFileSync(join(root, 'app', 'stray.md'), 'https://github.com/check-face/app\n');
  r = runScan();
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('stray.md'));

  // A committed hit no rule covers fails the run and is printed as unclassified.
  execFileSync('git', ['-C', join(root, 'app'), 'add', 'stray.md']);
  execFileSync('git', ['-C', join(root, 'app'), 'commit', '-q', '-m', 'stray']);
  r = runScan();
  assert.equal(r.status, 1);
  const stray = r.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .find((h) => h.file === 'stray.md');
  assert.equal(stray.class, 'unclassified');
  assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).counts.unclassified, 1);
});

test('the five repositories plus the monorepo yield zero unclassified hits', () => {
  const root = process.env.IDENTITY_SCAN_ROOT
    ? resolve(process.env.IDENTITY_SCAN_ROOT)
    : resolve(here, '../../..');
  const r = spawnSync('node', [script, '--root', root], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const lines = r.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const summary = lines.at(-1);
  const unclassified = lines
    .filter((h) => h.class === 'unclassified')
    .map((h) => `${h.repo}@${h.rev} ${h.file}:${h.line} ${h.hit}`);
  assert.deepEqual(unclassified, []);
  assert.equal(r.status, 0, r.stderr);
  const { targets } = JSON.parse(readFileSync(resolve(here, 'org-link-rules.json'), 'utf8'));
  assert.deepEqual(
    summary.scanned.map((s) => `${s.repo}@${s.rev}`),
    targets.flatMap((t) => t.revs.map((rev) => `${t.repo}@${rev}`)),
  );
  assert.deepEqual(Object.keys(summary.counts), [...CLASSES, 'unclassified']);
  console.log(JSON.stringify({ counts: summary.counts, scanned: summary.scanned }));
});
