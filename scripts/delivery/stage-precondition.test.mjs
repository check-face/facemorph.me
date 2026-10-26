// The wind-down stage precondition check (fm-y9m) against real fixture repositories: a temporary classic-shaped
// repository with a bare origin, real commits, real uncommitted edits and the real protected-path inventory. Every
// case runs the script's CLI as the stage job would, so the exit code is the job result.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';
import { covers, DEFAULT_PROTECTED, parseCli } from './stage-precondition.mjs';

const SCRIPT = fileURLToPath(new URL('stage-precondition.mjs', import.meta.url));
const inventory = JSON.parse(readFileSync(DEFAULT_PROTECTED, 'utf8'));

let root, repo, origin;
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const write = (path, text) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
/** Run the CLI; returns { code, parts: { name: line } }. */
const cli = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  const lines = r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return {
    code: r.status,
    parts: Object.fromEntries(lines.map((l) => [l.part, l])),
    stderr: r.stderr,
  };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stage-precondition-'));
  origin = join(root, 'origin.git');
  repo = join(root, 'classic');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  execFileSync('git', ['init', '-q', '-b', 'master', repo]);
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null'); // no host hooks (guards) in the fixture
  // Classic-shaped tree with real inventory paths: a keep file, a keep directory, a historical file and plain files.
  write('hosting/next-static/promote.py', 'print("promote")\n');
  write('experiment/hf/models/e4e/notes.txt', 'staging reads this\n');
  write('hosting/next/server.py', 'historical\n');
  write('.github/workflows/next-site.yml', 'name: next-site\n');
  write('.github/workflows/desktop-linux.yml', 'name: desktop-linux\n');
  write('README.md', 'classic\n');
  commit('base');
  git('tag', 'v1.0.0');
  git('branch', 'candidate/next-delivery-20260916');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'master', 'candidate/next-delivery-20260916', 'v1.0.0');
  git('fetch', '-q', 'origin');
  git('remote', 'set-head', 'origin', 'master');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('the real protected-path inventory is the one the check loads, with keep and historical rows', () => {
  assert.equal(inventory.bead, 'fm-p7v');
  assert.ok(inventory.paths.some((p) => p.path === 'experiment/' && p.disposition === 'keep'));
  assert.ok(inventory.paths.some((p) => p.disposition === 'historical'));
  assert.ok(covers('experiment/', 'experiment/hf/x'));
  assert.ok(!covers('experiment/', 'experimental.txt'));
  assert.ok(covers('hosting/next/server.py', 'hosting/next/server.py'));
  assert.throws(() => parseCli(['check', '--repo', repo]), /--base and --stage/);
  assert.throws(
    () => parseCli(['check', '--base', 'a', '--stage', 'b', '--require', 'nocommand']),
    /<name>=<command>/,
  );
  assert.throws(() => parseCli(['deploy']), /usage/);
});

test('a dirty path is skipped and reported, and a stage that changes it fails', () => {
  const base = git('rev-parse', 'HEAD');
  // Another session's uncommitted edit and an untracked file.
  write('.github/workflows/desktop-linux.yml', 'name: desktop-linux\n# another session\n');
  write('.github/workflows/new-untracked.yml', 'x\n');

  const plan = cli(
    'plan',
    '--repo',
    repo,
    '--paths',
    '.github/workflows/next-site.yml,.github/workflows/desktop-linux.yml,.github/workflows/',
  );
  assert.equal(plan.code, 0);
  assert.deepEqual(plan.parts.plan.apply, ['.github/workflows/next-site.yml']);
  assert.deepEqual(
    plan.parts.plan.skipped.map((s) => s.path),
    ['.github/workflows/desktop-linux.yml', '.github/workflows/'],
  );
  assert.deepEqual(plan.parts.plan.skipped[0].dirty, [
    { path: '.github/workflows/desktop-linux.yml', status: ' M' },
  ]);

  // A stage that commits only the planned path leaves the dirty edit in place and passes.
  // next-site.yml is itself protected (keep): the stage disables its deploy job rather than deleting the file.
  write(
    '.github/workflows/next-site.yml',
    'name: next-site\n# deploy disabled by the publisher stage\n',
  );
  git(
    'commit',
    '-q',
    '-m',
    'stage: disable next-site deploy',
    '--',
    '.github/workflows/next-site.yml',
  );
  const good = git('rev-parse', 'HEAD');
  const pass = cli('check', '--repo', repo, '--base', base, '--stage', good);
  assert.equal(pass.code, 0, JSON.stringify(pass.parts));
  assert.equal(pass.parts.dirty.status, 'pass');
  assert.equal(pass.parts.dirty.dirty.length, 2);
  assert.match(
    readFileSync(join(repo, '.github/workflows/desktop-linux.yml'), 'utf8'),
    /another session/,
  );

  // A stage commit that also changes the dirty path fails the job.
  git('add', '.github/workflows/desktop-linux.yml');
  git(
    'commit',
    '-q',
    '-m',
    'stage overwrote another session',
    '--',
    '.github/workflows/desktop-linux.yml',
  );
  write(
    '.github/workflows/desktop-linux.yml',
    'name: desktop-linux\n# another session, still editing\n',
  );
  const bad = cli('check', '--repo', repo, '--base', base, '--stage', 'HEAD');
  assert.equal(bad.code, 1);
  assert.equal(bad.parts.dirty.status, 'fail');
  assert.deepEqual(bad.parts.summary.failed, ['dirty']);
});

test('a protected path is kept or moved, never dropped', () => {
  const base = git('rev-parse', 'HEAD');

  // Modify a keep file and touch an unprotected file: kept.
  write('hosting/next-static/promote.py', 'print("promote v2")\n');
  write('README.md', 'classic, wound down\n');
  const kept = commit('stage: edits');
  let r = cli('check', '--repo', repo, '--base', base, '--stage', kept);
  assert.equal(r.code, 0, JSON.stringify(r.parts));
  const row = (p) => r.parts.protected.rows.find((x) => x.path === p);
  assert.equal(row('hosting/next-static/promote.py').kept, true);
  assert.equal(row('experiment/').status, 'pass');
  assert.equal(row('../review-artifacts/ (git-external sibling)').status, 'not_applicable');
  assert.equal(row('photo-runtime/').reason, 'absent at base');

  // Move a keep directory's file: reported as moved, still a pass.
  mkdirSync(join(repo, 'archive'));
  git('mv', 'experiment/hf/models/e4e/notes.txt', 'archive/experiment-notes.txt');
  const moved = commit('stage: move');
  r = cli('check', '--repo', repo, '--base', base, '--stage', moved);
  assert.equal(r.code, 0, JSON.stringify(r.parts));
  assert.deepEqual(row('experiment/').moved, [
    {
      from: 'experiment/hf/models/e4e/notes.txt',
      to: 'archive/experiment-notes.txt',
      similarity: 100,
    },
  ]);

  // Drop a keep file and a historical file: fails the job.
  git('rm', '-q', 'hosting/next-static/promote.py', 'hosting/next/server.py');
  const dropped = commit('stage: drop');
  r = cli('check', '--repo', repo, '--base', base, '--stage', dropped);
  assert.equal(r.code, 1);
  assert.equal(r.parts.protected.status, 'fail');
  assert.deepEqual(
    r.parts.protected.rows.filter((x) => x.status === 'fail').map((x) => [x.path, x.disposition]),
    [
      ['hosting/next/server.py', 'historical'],
      ['hosting/next-static/promote.py', 'keep'],
    ],
  );
});

test('refs are unchanged except the default branch advancing', () => {
  const snap = join(root, 'refs-before.json');
  const s = cli('snapshot', '--repo', repo, '--out', snap);
  assert.equal(s.code, 0);
  const before = JSON.parse(readFileSync(snap, 'utf8'));
  assert.deepEqual(Object.keys(before), [
    'refs/heads/candidate/next-delivery-20260916',
    'refs/heads/master',
    'refs/tags/v1.0.0',
  ]);
  const remoteSnap = cli('snapshot', '--repo', repo, '--remote', 'origin');
  assert.deepEqual(remoteSnap.parts.snapshot.refs, before);

  // Default branch (from origin/HEAD) advances: pass.
  write('README.md', 'stage\n');
  commit('stage');
  let r = cli('refs', '--repo', repo, '--before', snap);
  assert.equal(r.code, 0, JSON.stringify(r.parts));
  assert.equal(r.parts.refs.default_branch, 'master');
  assert.equal(r.parts.refs.advanced.ref, 'refs/heads/master');

  // Default branch rewritten (not a fast-forward): fail.
  git('checkout', '-q', '--orphan', 'tmp-rewrite');
  write('README.md', 'rewritten\n');
  const rewritten = commit('rewrite');
  git('checkout', '-q', 'master');
  git('update-ref', 'refs/heads/master', rewritten);
  git('update-ref', '-d', 'refs/heads/tmp-rewrite');
  r = cli('refs', '--repo', repo, '--before', snap);
  assert.equal(r.code, 1);
  assert.match(r.parts.refs.moved[0].reason, /not a fast-forward/);
  git('update-ref', 'refs/heads/master', before['refs/heads/master']);

  // A tag deleted, another branch moved, a branch added: each fails.
  git('tag', '-d', 'v1.0.0');
  r = cli('refs', '--repo', repo, '--before', snap);
  assert.equal(r.code, 1);
  assert.deepEqual(r.parts.refs.deleted, ['refs/tags/v1.0.0']);
  git('tag', 'v1.0.0', before['refs/tags/v1.0.0']);
  git('update-ref', 'refs/heads/candidate/next-delivery-20260916', rewritten);
  git('branch', 'extra');
  r = cli('refs', '--repo', repo, '--before', snap);
  assert.equal(r.code, 1);
  assert.deepEqual(
    r.parts.refs.moved.map((m) => m.ref),
    ['refs/heads/candidate/next-delivery-20260916'],
  );
  assert.deepEqual(r.parts.refs.added, ['refs/heads/extra']);

  // Restored refs pass, with an explicit --default-branch as well.
  git(
    'update-ref',
    'refs/heads/candidate/next-delivery-20260916',
    before['refs/heads/candidate/next-delivery-20260916'],
  );
  git('branch', '-D', 'extra');
  r = cli('refs', '--repo', repo, '--before', snap, '--default-branch', 'main');
  assert.equal(r.code, 0, 'unchanged refs pass whatever the default branch');
});

test('a failed precondition fails the job so the stage commit does not land', () => {
  const base = git('rev-parse', 'HEAD');
  write(
    '.github/workflows/next-site.yml',
    'name: next-site\n# deploy disabled by the publisher stage\n',
  );
  git('rm', '-q', '.github/workflows/desktop-linux.yml');
  const stage = commit('stage: disable next-site deploy, remove desktop-linux');
  const snap = join(root, 'refs-before.json');
  // The stage job as CI runs it: snapshot the origin, check, push only when the check passes, then re-check refs.
  const job = (requireCmd) =>
    spawnSync(
      'sh',
      [
        '-ec',
        [
          `node "$S" snapshot --repo "$R" --remote origin --out "$SNAP"`,
          `node "$S" check --repo "$R" --base ${base} --stage ${stage} --refs-before "$SNAP" --remote origin --require 'post-delivery-check=${requireCmd}'`,
          `git -C "$R" push -q origin ${stage}:refs/heads/master`,
          `git -C "$R" fetch -q origin`,
          `node "$S" refs --repo "$R" --remote origin --before "$SNAP"`,
        ].join('\n'),
      ],
      { encoding: 'utf8', env: { ...process.env, S: SCRIPT, R: repo, SNAP: snap }, cwd: root },
    );
  const originMaster = () =>
    execFileSync('git', ['--git-dir', origin, 'rev-parse', 'refs/heads/master'], {
      encoding: 'utf8',
    }).trim();

  const failed = job('echo monorepo publisher not live >&2; exit 3');
  assert.notEqual(failed.status, 0);
  const lines = failed.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const req = lines.find((l) => l.part === 'require:post-delivery-check');
  assert.equal(req.status, 'fail');
  assert.equal(req.exit, 3);
  assert.match(req.stderr, /publisher not live/);
  assert.equal(originMaster(), base, 'the stage commit did not land');

  const passed = job('true');
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.equal(originMaster(), stage, 'the stage commit landed');
  const last = passed.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(
    last.some((l) => l.part === 'refs' && l.status === 'pass' && l.advanced?.after === stage),
  );
});

test('the script changes nothing in the repository it checks', () => {
  write('scratch.txt', 'uncommitted\n');
  const status = git('status', '--porcelain');
  const refs = git('for-each-ref');
  cli('snapshot', '--repo', repo);
  cli('plan', '--repo', repo, '--paths', 'scratch.txt');
  cli('check', '--repo', repo, '--base', 'HEAD', '--stage', 'HEAD', '--require', 'ok=true');
  assert.equal(git('status', '--porcelain'), status);
  assert.equal(git('for-each-ref'), refs);
  assert.match(readFileSync(join(repo, 'scratch.txt'), 'utf8'), /uncommitted/);
});
