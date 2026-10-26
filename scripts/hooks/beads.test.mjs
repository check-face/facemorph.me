import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBeadsCommit } from './beads.mjs';

const CHECK = fileURLToPath(new URL('./check.mjs', import.meta.url));
const ISSUES = '.beads/issues.jsonl';
const zero = '0'.repeat(40);
const bead = (id, status, extra = {}) => ({ id, status, ...extra });
const open = [bead('fm-a', 'open'), bead('fm-b', 'open')];
const blocked = [
  bead('fm-a', 'closed', { dependencies: [{ type: 'blocks', depends_on_id: 'fm-b' }] }),
  bead('fm-b', 'open'),
];
const healthy = [
  bead('fm-a', 'closed', {
    acceptance_criteria: '- [x] checked',
    dependencies: [{ type: 'blocks', depends_on_id: 'fm-b' }],
  }),
  bead('fm-b', 'closed'),
];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'beads-push-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  git('init', '-q');
  mkdirSync(join(root, '.beads'));
  const writeIssues = (issues) => {
    mkdirSync(join(root, '.beads'), { recursive: true });
    writeFileSync(
      join(root, ISSUES),
      issues.map((issue) => JSON.stringify(issue)).join('\n') + '\n',
    );
  };
  const commit = (path, contents) => {
    if (path === ISSUES) writeIssues(contents);
    else writeFileSync(join(root, path), contents);
    git('add', path);
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const push = (head, base = zero) =>
    spawnSync(process.execPath, [CHECK, 'pre-push'], {
      cwd: root,
      input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
      encoding: 'utf8',
    });
  return { root, git, writeIssues, commit, push };
}

test('outgoing invalid closure is rejected from its committed snapshot despite healthy working-tree dirt', (t) => {
  const f = fixture(t);
  const base = f.commit(ISSUES, open);
  const head = f.commit(ISSUES, blocked);
  f.writeIssues(healthy);
  assert.deepEqual(checkBeadsCommit({ ...f, head, base }), {
    ok: false,
    checked: true,
    violations: [{ bead: 'fm-a', rule: 'closed-while-blocked', dep: 'fm-b', depStatus: 'open' }],
  });
  const pushed = f.push(head, base);
  assert.equal(pushed.status, 1, pushed.stderr);
  assert.match(pushed.stderr, /pre-push beads:.*closed-while-blocked/);
});

test('ordinary unrelated push passes with stale invalid committed Beads and unrelated dirty working Beads', (t) => {
  const f = fixture(t);
  const base = f.commit(ISSUES, blocked);
  const head = f.commit('README.md', '# ordinary change\n');
  writeFileSync(join(f.root, ISSUES), 'malformed shared working-tree dirt\n');
  assert.deepEqual(checkBeadsCommit({ ...f, head, base }), {
    ok: true,
    checked: false,
    violations: [],
  });
  const pushed = f.push(head, base);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.ok(!pushed.stderr.includes('Beads closure check failed'));
});

test('healthy outgoing Beads pass while working-tree Beads are invalid', (t) => {
  const f = fixture(t);
  const base = f.commit(ISSUES, open);
  const head = f.commit(ISSUES, healthy);
  f.writeIssues(blocked);
  assert.deepEqual(checkBeadsCommit({ ...f, head, base }), {
    ok: true,
    checked: true,
    violations: [],
  });
  assert.equal(f.push(head, base).status, 0);
});

test('the reused checker retains unchecked acceptance, all blocking types and reopened dependency behavior', (t) => {
  const f = fixture(t);
  let base = f.commit(ISSUES, open);
  for (const type of ['blocks', 'conditional-blocks', 'waits-for']) {
    const issues = [
      bead('fm-a', 'closed', {
        acceptance_criteria: '- [ ] unfinished',
        dependencies: [{ type, depends_on_id: 'fm-b' }],
      }),
      bead('fm-b', 'open'),
    ];
    const head = f.commit(ISSUES, issues);
    assert.deepEqual(
      checkBeadsCommit({ ...f, head, base }).violations.map((v) => v.rule),
      ['unchecked-acceptance', 'closed-while-blocked'],
    );
    base = head;
  }
  const head = f.commit(ISSUES, [blocked[0], bead('fm-b', 'open', { labels: ['reopened'] })]);
  assert.equal(checkBeadsCommit({ ...f, head, base }).ok, true);
});

test('new refs ignore Beads history already in local remote refs and check genuinely outgoing Beads changes', (t) => {
  const f = fixture(t);
  const remote = f.commit(ISSUES, blocked);
  f.git('update-ref', 'refs/remotes/origin/main', remote);
  const unrelated = f.commit('README.md', '# new branch\n');
  assert.deepEqual(checkBeadsCommit({ ...f, head: unrelated }), {
    ok: true,
    checked: false,
    violations: [],
  });
  // A new branch with an outgoing Beads edit must still run the exact check.
  const edited = f.commit(ISSUES, [...blocked, bead('fm-c', 'open')]);
  assert.equal(checkBeadsCommit({ ...f, head: edited }).ok, false);
  assert.equal(f.push(edited).status, 1);
});

test('first push checks the full outgoing Beads snapshot and deleted refs are ignored', (t) => {
  const f = fixture(t);
  const head = f.commit(ISSUES, blocked);
  assert.equal(checkBeadsCommit({ ...f, head }).ok, false);
  assert.equal(f.push(head).status, 1);
  assert.equal(f.push(zero, head).status, 0);
});

test('Beads deletion or malformed outgoing JSON fails closed without reading working files', (t) => {
  const f = fixture(t);
  const base = f.commit(ISSUES, healthy);
  writeFileSync(join(f.root, ISSUES), 'invalid committed JSON\n');
  f.git('add', ISSUES);
  f.git(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'malformed',
  );
  const malformed = f.git('rev-parse', 'HEAD');
  assert.equal(checkBeadsCommit({ ...f, head: malformed, base }).ok, false);
  f.git('rm', '-q', ISSUES);
  f.git(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'deleted',
  );
  const deleted = f.git('rev-parse', 'HEAD');
  f.writeIssues(healthy);
  assert.equal(checkBeadsCommit({ ...f, head: deleted, base }).ok, false);
});

test('force-push compares exact snapshots without requiring ancestry; equal snapshots skip the gate', (t) => {
  const f = fixture(t);
  const base = f.commit(ISSUES, open);
  f.git('checkout', '-q', '--orphan', 'rewritten');
  const head = f.commit(ISSUES, blocked);
  assert.equal(checkBeadsCommit({ ...f, head, base }).ok, false);
  assert.deepEqual(checkBeadsCommit({ ...f, head, base: head }), {
    ok: true,
    checked: false,
    violations: [],
  });
});
