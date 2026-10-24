// check-tests-listed (fm-pud): retired-test detection in real temporary Git repositories (planted commits are
// inputs, not fakes), the tests/retired.txt parser, and discovery of a new unlisted test under apps/web or a package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseRetired,
  retiredFindings,
  testChanges,
  testGlobs,
  unlisted,
} from './check-tests-listed.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tests-listed-'));
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main'); // no `init -b`: triton's git 2.25
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  const put = (f) => {
    for (const [p, body] of Object.entries(f)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
  };
  put(files);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  return {
    dir,
    base,
    put,
    remove: (p) => rmSync(join(dir, p)),
    commit: () => {
      git('add', '-A');
      git('commit', '-q', '-m', 'change');
    },
    mv: (a, b) => git('mv', a, b),
  };
}

const BODY = (n) =>
  `import test from 'node:test';\ntest('case ${n}', () => {});\n// ${'x'.repeat(200)}\n`;

test('removing a listed test fails; the same change with a retired entry naming its replacement passes', () => {
  const r = repo({
    'packages/a/test/one.test.ts': BODY(1),
    'packages/a/test/two.test.ts': BODY(2),
    'packages/a/src/x.ts': 'x',
  });
  r.remove('packages/a/test/one.test.ts');
  r.commit();
  const changes = testChanges(r.dir, r.base);
  assert.deepEqual(changes, [{ change: 'removed', path: 'packages/a/test/one.test.ts' }]);
  const exists = (p) => existsSync(join(r.dir, p));
  assert.equal(
    retiredFindings(changes, new Map(), exists)[0].problem,
    'removed without a tests/retired.txt entry',
  );
  const ok = parseRetired(
    'packages/a/test/one.test.ts -> replacement: packages/a/test/two.test.ts; reason: merged into two\n',
  );
  assert.deepEqual(retiredFindings(changes, ok.entries, exists), []);
  const plan = parseRetired(
    'packages/a/test/one.test.ts -> plan: PLAN.md#web-release-and-desktop-package-retirement--12-october-2026; reason: native\n',
  );
  assert.deepEqual(retiredFindings(changes, plan.entries, exists), []);
  const gone = parseRetired(
    'packages/a/test/one.test.ts -> replacement: packages/a/test/three.test.ts; reason: moved\n',
  );
  assert.match(
    retiredFindings(changes, gone.entries, exists)[0].problem,
    /replacement that does not exist/,
  );
});

test('renaming a listed test fails without an entry; with one naming the new path it passes', () => {
  const r = repo({ 'apps/web/test/build/old.test.ts': BODY(3) });
  r.mv('apps/web/test/build/old.test.ts', 'apps/web/test/build/new.test.ts');
  r.commit();
  const changes = testChanges(r.dir, r.base);
  assert.deepEqual(changes, [
    {
      change: 'renamed',
      path: 'apps/web/test/build/old.test.ts',
      to: 'apps/web/test/build/new.test.ts',
    },
  ]);
  const exists = (p) => existsSync(join(r.dir, p));
  assert.equal(retiredFindings(changes, new Map(), exists).length, 1);
  const e = parseRetired(
    'apps/web/test/build/old.test.ts -> replacement: apps/web/test/build/new.test.ts; reason: renamed\n',
  );
  assert.deepEqual(retiredFindings(changes, e.entries, exists), []);
});

test('python tests count; non-test files and added tests do not', () => {
  const r = repo({
    'scripts/ci/x/test_thing.py': 'def test_a(): pass\n',
    'scripts/ci/x/helper.py': 'x = 1\n',
  });
  r.remove('scripts/ci/x/test_thing.py');
  r.remove('scripts/ci/x/helper.py');
  r.put({ 'scripts/ci/x/new.test.mjs': BODY(4) });
  r.commit();
  assert.deepEqual(testChanges(r.dir, r.base), [
    { change: 'removed', path: 'scripts/ci/x/test_thing.py' },
  ]);
});

test('a retired entry missing a field fails', () => {
  for (const line of [
    'a.test.ts -> replacement: ; reason: x',
    'a.test.ts -> replacement: b.test.ts; reason: ',
    'a.test.ts -> plan: PLAN.md#x',
    'a.test.ts replacement b.test.ts',
    'a.test.ts -> superseded: b.test.ts; reason: x',
  ])
    assert.equal(parseRetired(`${line}\n`).problems.length, 1, line);
  assert.deepEqual(parseRetired('# comment\n\n').problems, []);
});

test('a new unlisted test file under apps/web or a package fails discovery', () => {
  const globs = [
    ...testGlobs('apps/web', 'node --test test/build/*.test.ts'),
    ...testGlobs('packages/a', 'node --test test/*.test.ts'),
  ];
  assert.deepEqual(
    unlisted(['apps/web/test/build/a.test.ts', 'packages/a/test/b.test.ts'], globs),
    [],
  );
  assert.deepEqual(
    unlisted(['apps/web/test/new/c.test.ts', 'packages/a/test/deep/d.test.ts'], globs),
    ['apps/web/test/new/c.test.ts', 'packages/a/test/deep/d.test.ts'],
  );
});

test('the repository itself: every test listed, no retired test without an entry, tests/retired.txt well formed', () => {
  const r = spawnSync(
    process.execPath,
    ['scripts/build/check-tests-listed.mjs', '--base', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.retiredFile, []);
  assert.deepEqual(out.retired, []);
  assert.deepEqual(out.unlisted, []);
  assert.equal(r.status, 0);
});
