import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, generate } from './generate-allowlist.mjs';
import { sha256 } from './lib.mjs';
import { classFindings, overlayFindings, structureFindings } from './scan-allowlist.mjs';
import { gitRepo, run, tempDir } from './testing.mjs';

const DIGESTS = fileURLToPath(new URL('./allowlist-digests.mjs', import.meta.url));

const RULES = [
  { patterns: ['src/Next/Product.fs'], disposition: 'fsharp-specification', owner: 'port' },
  { patterns: ['src/**/*.fs'], disposition: 'excluded' },
  { patterns: ['src/Next/'], disposition: 'imported', class: 'src-next' },
  { patterns: ['hosting/mirror/'], disposition: 'hosting-listed', digests: true, owner: 'hosting' },
  { patterns: ['.github/'], disposition: 'workflow-listed', owner: 'ci' },
];

test('classification takes the first matching rule', () => {
  assert.equal(classify('src/Next/Product.fs', RULES).disposition, 'fsharp-specification');
  assert.equal(classify('src/Next/Other.fs', RULES).disposition, 'excluded');
  assert.equal(classify('src/Next/a.mjs', RULES).disposition, 'imported');
  assert.equal(classify('README.md', RULES), null);
});

test('generate: imported rows from Git objects, unclassified paths, and every delta path with its disposition', () => {
  const repo = gitRepo();
  const reference = repo.commit({ 'src/Next/a.mjs': 'export const a = 1;\n', '.github/ci.yml': 'on: push\n' }, 'reference');
  const frozen = repo.commit({ 'src/Next/a.mjs': 'export const a = 2;\n', 'src/Next/Product.fs': 'module P\n', 'hosting/mirror/w.mjs': 'w\n', 'README.md': 'r\n' }, 'later');
  repo.commit({ 'src/Next/a.mjs': 'export const a = 3;\n' }, 'after the freeze');
  const allowlist = { source: { frozen_commit: frozen, planning_reference: reference }, destination_root: 'apps/web', rules: RULES, delta_notes: { [frozen.slice(0, 7)]: 'noted' } };
  const { unclassified, files, listed, commits } = generate(allowlist, repo.dir);
  assert.deepEqual(unclassified, ['README.md']);
  assert.deepEqual(files, [{ source: 'src/Next/a.mjs', destination: 'apps/web/src/Next/a.mjs', sha256: sha256('export const a = 2;\n'), bytes: 20, class: 'src-next' }]);
  assert.deepEqual(listed.map((r) => [r.source, r.owner, r.sha256]), [['hosting/mirror/w.mjs', 'hosting', sha256('w\n')]]);
  assert.equal(commits.length, 1, 'the commit after the freeze is not in the reviewed delta');
  assert.equal(commits[0].note, 'noted');
  assert.deepEqual(commits[0].paths.map((p) => [p.path, p.disposition]).sort(), [['README.md', null], ['hosting/mirror/w.mjs', 'hosting-listed'], ['src/Next/Product.fs', 'fsharp-specification'], ['src/Next/a.mjs', 'imported']]);
});

function digestFixture() {
  const repo = gitRepo();
  const content = { 'src/Next/a.mjs': 'a\n', 'src/Next/deep/b.json': '{"b":1}\n' };
  const frozen = repo.commit(content, 'frozen');
  repo.commit({ 'src/Next/a.mjs': 'changed after the freeze\n' }, 'later');
  const rows = Object.entries(content).map(([source, text]) => ({ source, destination: `apps/web/${source}`, sha256: sha256(text) }));
  const write = (files) => {
    const path = join(tempDir(), 'allowlist.json');
    writeFileSync(path, JSON.stringify({ source: { frozen_commit: frozen }, files }));
    return path;
  };
  return { repo, rows, write };
}

test('allowlist-digests: every digest regenerated from git archive of the frozen commit matches', () => {
  const { repo, rows, write } = digestFixture();
  const r = run(DIGESTS, ['--classic', repo.dir, '--allowlist', write(rows)]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.summary, { commit: r.summary.commit, archive_commit: r.summary.commit, files: 2, mismatches: 0, archive_is_frozen_commit: true });
  assert.ok(r.lines.slice(0, -1).every((l) => l.match === true && l.sha256 && l.destination));
});

test('allowlist-digests: a one-byte digest change is a mismatch and fails', () => {
  const { repo, rows, write } = digestFixture();
  const tampered = rows.map((r, i) => (i === 0 ? { ...r, sha256: r.sha256.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } : r));
  const r = run(DIGESTS, ['--classic', repo.dir, '--allowlist', write(tampered)]);
  assert.equal(r.status, 1);
  assert.equal(r.summary.mismatches, 1);
  assert.equal(r.lines.find((l) => l.source === 'src/Next/a.mjs').match, false);
});

test('allowlist-digests: a source the frozen commit does not have fails', () => {
  const { repo, rows, write } = digestFixture();
  const r = run(DIGESTS, ['--classic', repo.dir, '--allowlist', write([...rows, { source: 'src/Next/missing.mjs', destination: 'apps/web/src/Next/missing.mjs', sha256: sha256('x') }])]);
  assert.notEqual(r.status, 0);
});

test('scan: planted forbidden classes are each found; a clean list has none', () => {
  const planted = [
    { source: 'src/Next/Foo.fs.js', bytes: 10 },
    { source: 'src/Next/Product.fs', bytes: 10 },
    { source: 'hosting/next-cloudflare/.wrangler/state/v3/kv.sqlite', bytes: 10 },
    { source: 'Server/Index.fs', bytes: 10 },
    { source: 'global.json', bytes: 10 },
    { source: 'webpack.config.js', bytes: 10 },
    { source: 'node_modules/x/index.js', bytes: 10 },
    { source: 'assets/model.onnx', bytes: 10 },
    { source: 'src/public/huge.png', bytes: 9 * 1024 * 1024 },
    { source: 'deploy-next/index.html', bytes: 10 },
    { source: 'hosting/.dev.vars', bytes: 10 },
    { source: 'src/Next/config.mjs', bytes: 10 },
  ];
  const content = new Map([['src/Next/config.mjs', 'const k = "-----BEGIN RSA PRIVATE KEY-----";']]);
  const found = classFindings(planted, content);
  const classes = (source) => found.filter((f) => f.source === source).map((f) => f.class).sort();
  assert.deepEqual(classes('src/Next/Foo.fs.js'), ['fable-output']);
  assert.deepEqual(classes('src/Next/Product.fs'), ['fsharp-source']);
  assert.deepEqual(classes('hosting/next-cloudflare/.wrangler/state/v3/kv.sqlite'), ['wrangler-state']);
  assert.deepEqual(classes('Server/Index.fs'), ['fsharp-source', 'legacy-server-api']);
  assert.deepEqual(classes('global.json'), ['dotnet-fable-pins']);
  assert.deepEqual(classes('webpack.config.js'), ['webpack-config']);
  assert.deepEqual(classes('node_modules/x/index.js'), ['node-modules']);
  assert.deepEqual(classes('assets/model.onnx'), ['weights']);
  assert.deepEqual(classes('src/public/huge.png'), ['weights']);
  assert.deepEqual(classes('deploy-next/index.html'), ['delivery-directory']);
  assert.deepEqual(classes('hosting/.dev.vars'), ['credentials']);
  assert.deepEqual(classes('src/Next/config.mjs'), ['credentials']);
  const clean = [{ source: 'src/Next/product-bridge.mjs', bytes: 54317 }, { source: 'src/public/og-next.png', bytes: 480238 }, { source: 'scripts/check-no-third-party.mjs', bytes: 5326 }];
  assert.deepEqual(classFindings(clean, new Map([['src/Next/product-bridge.mjs', 'const token = getToken(); // api_key: not a literal']])), []);
});

test('scan: destinations, temporary-path ownership, not-applicable checks and mirror rows', () => {
  const base = {
    destination_root: 'apps/web',
    protected_destinations: ['PLAN.md', '.beads/'],
    files: [
      { source: 'src/Next/a.mjs', destination: 'apps/web/src/Next/a.mjs', sha256: 'a'.repeat(64) },
      { source: 'scripts/check-bridge-imports.mjs', destination: 'apps/web/scripts/check-bridge-imports.mjs', sha256: 'b'.repeat(64) },
      { source: 'src/Next/verify-fable.mjs', destination: 'apps/web/src/Next/verify-fable.mjs', sha256: 'c'.repeat(64) },
    ],
    rules: [{ patterns: ['src/Next/'], disposition: 'imported' }, { patterns: ['scripts/x.mjs'], disposition: 'imported', temporary: true, consumer: 'c', owner: 'o' }],
    checks: ['scripts/check-bridge-imports.mjs', 'src/Next/verify-fable.mjs'].map((source) => ({ source, status: 'not applicable until the port', reason: 'r', successors: ['s'] })),
    listed_with_digests: ['worker.mjs', 'worker.test.mjs', 'wrangler.jsonc'].map((n) => ({ source: `hosting/next-mirror/${n}`, sha256: 'd'.repeat(64), owner: 'hosting' })),
  };
  assert.deepEqual(structureFindings(base), []);
  const broken = structuredClone(base);
  broken.files.push({ source: '.beads/x', destination: '.beads/x', sha256: 'e'.repeat(64) });
  broken.rules.push({ patterns: ['desktop/runtime.mjs'], disposition: 'imported' });
  broken.checks[1].status = 'passed';
  broken.listed_with_digests.pop();
  const problems = structureFindings(broken).map((f) => f.problem);
  assert.ok(problems.includes('destination is not destination_root/source'));
  assert.ok(problems.includes('destination collides with a protected path'));
  assert.ok(problems.includes('a temporary root path needs temporary, consumer and owner'));
  assert.ok(problems.includes('must be marked "not applicable until the port" with reason and successors'));
  assert.ok(problems.includes('hosting/next-mirror/ rows need digests and owners'));
});

test('scan: a live classic change that is not listed fails; a listed one that moved on is info only', () => {
  const recorded = { entries: [{ path: 'AGENTS.md', sha256: 'a'.repeat(64) }, { path: '.beads/' }] };
  assert.deepEqual(overlayFindings([{ path: 'AGENTS.md', sha256: 'a'.repeat(64) }, { path: '.beads/issues.jsonl' }], recorded), []);
  const found = overlayFindings([{ path: 'AGENTS.md', sha256: 'b'.repeat(64) }, { path: 'README.md', sha256: 'c'.repeat(64) }], recorded);
  assert.deepEqual(found.map((f) => [f.overlay, !!f.info]), [['AGENTS.md', true], ['README.md', false]]);
});
