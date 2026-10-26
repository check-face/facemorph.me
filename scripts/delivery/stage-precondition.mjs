#!/usr/bin/env node
// Wind-down stage precondition check (fm-y9m, plan #classic-wind-down). Each wind-down stage is an ordinary commit on
// classic; the CI job that lands it runs this check and the stage's own preconditions, and the stage does not land when
// any part fails. Git (a revert of the stage commit) is the reversal path; there is no stage runner and no receipt file.
//
// Read-only: every subcommand only reads the repository (git for-each-ref, ls-remote, status, diff, merge-base) and
// runs the --require commands it is given. It never commits, pushes, checks out, resets, cleans or deletes anything.
//
//   snapshot  --repo <dir> [--remote <name>] [--out <refs.json>]
//             every branch and tag with its SHA (local refs, or the remote's via git ls-remote).
//   plan      --repo <dir> --paths <a,b,...>
//             the paths a stage may touch: any path with uncommitted changes (git status --porcelain) is skipped and
//             reported, never overwritten.
//   check     --repo <dir> --base <rev> --stage <rev> [--refs-before <refs.json>] [--remote <name>]
//             [--default-branch <name>] [--protected <protected-paths.json>] [--require <name>=<shell command>]...
//             protected: every path in the inventory (default inventory/protected-paths.json) that exists at --base is
//               kept or moved by the stage, never dropped; paths outside the repository (../) are not_applicable.
//             dirty: the stage changes no path that has uncommitted changes in --repo.
//             refs: against --refs-before, no branch or tag is deleted, added or moved except the default branch,
//               which may only advance (fast-forward), so history is never rewritten.
//             require: each command exits 0.
//   refs      --repo <dir> --before <refs.json> [--after <refs.json>] [--remote <name>] [--default-branch <name>]
//             the refs part alone, e.g. after the stage commit is pushed.
//
// One JSON line per part (pass, fail, skipped or not_applicable), then a summary line; exit 1 when any part fails.
// A stage job: snapshot -> check (stage commit not yet on the default branch) -> push -> refs --before the snapshot.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_PROTECTED = `${REPO}inventory/protected-paths.json`;
export const COMMANDS = ['snapshot', 'plan', 'check', 'refs'];

const git = (repo, args) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

// ------------------------------------------------------------------------------------------------- arguments

export function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command))
    throw new Error(`usage: stage-precondition.mjs <${COMMANDS.join('|')}> [options]`);
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      repo: { type: 'string', default: '.' },
      remote: { type: 'string' },
      out: { type: 'string' },
      paths: { type: 'string' },
      base: { type: 'string' },
      stage: { type: 'string' },
      'refs-before': { type: 'string' },
      before: { type: 'string' },
      after: { type: 'string' },
      'default-branch': { type: 'string' },
      protected: { type: 'string', default: DEFAULT_PROTECTED },
      require: { type: 'string', multiple: true, default: [] },
    },
  });
  if (command === 'plan' && !values.paths) throw new Error('plan needs --paths');
  if (command === 'check' && (!values.base || !values.stage))
    throw new Error('check needs --base and --stage');
  if (command === 'refs' && !values.before) throw new Error('refs needs --before');
  const require = values.require.map((spec) => {
    const at = spec.indexOf('=');
    if (at < 1) throw new Error(`--require wants <name>=<command>, got ${JSON.stringify(spec)}`);
    return { name: spec.slice(0, at), command: spec.slice(at + 1) };
  });
  return { command, ...values, require };
}

// ------------------------------------------------------------------------------------------------- refs

/** Every branch and tag with its SHA: { "refs/heads/main": "<sha>", "refs/tags/v1": "<sha>" }. */
export function snapshotRefs(repo, remote) {
  const refs = {};
  if (remote) {
    for (const line of git(repo, ['ls-remote', '--heads', '--tags', remote]).split('\n')) {
      const [sha, name] = line.split('\t');
      if (name && !name.endsWith('^{}')) refs[name] = sha;
    }
  } else {
    const out = git(repo, [
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/tags',
    ]);
    for (const line of out.split('\n')) {
      const [name, sha] = line.split(' ');
      if (name) refs[name] = sha;
    }
  }
  return Object.fromEntries(Object.entries(refs).sort(([a], [b]) => a.localeCompare(b)));
}

/** The repository's default branch from origin/HEAD, when the clone records one. */
export function defaultBranch(repo) {
  try {
    return git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      .trim()
      .replace(/^origin\//, '');
  } catch {
    return undefined;
  }
}

const isAncestor = (repo, a, b) =>
  spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }).status;

/** Compare two ref snapshots: only the default branch may move, and only forward. */
export function judgeRefs(repo, before, after, branch) {
  const head = `refs/heads/${branch}`;
  const deleted = Object.keys(before).filter((r) => !(r in after));
  const added = Object.keys(after).filter((r) => !(r in before));
  const moved = [];
  let advanced = null;
  for (const [ref, sha] of Object.entries(before)) {
    if (!(ref in after) || after[ref] === sha) continue;
    if (ref !== head) {
      moved.push({ ref, before: sha, after: after[ref] });
      continue;
    }
    const status = isAncestor(repo, sha, after[ref]);
    if (status === 0) advanced = { ref, before: sha, after: after[ref] };
    else
      moved.push({
        ref,
        before: sha,
        after: after[ref],
        reason:
          status === 1
            ? 'not a fast-forward (history rewritten)'
            : 'cannot verify ancestry (objects missing)',
      });
  }
  const problems = [];
  if (!branch) problems.push('no default branch: pass --default-branch');
  if (deleted.length) problems.push(`deleted: ${deleted.join(', ')}`);
  if (added.length) problems.push(`added: ${added.join(', ')}`);
  if (moved.length) problems.push(`moved: ${moved.map((m) => m.ref).join(', ')}`);
  return {
    part: 'refs',
    status: problems.length ? 'fail' : 'pass',
    default_branch: branch ?? null,
    advanced,
    deleted,
    added,
    moved,
    ...(problems.length ? { reason: problems.join('; ') } : {}),
  };
}

// ------------------------------------------------------------------------------------------------- dirty paths

/** Paths with uncommitted changes (staged, unstaged or untracked), both sides of a rename. */
export function dirtyPaths(repo) {
  const fields = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const dirty = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    dirty.push({ path: entry.slice(3), status: xy });
    if (xy[0] === 'R' || xy[0] === 'C') dirty.push({ path: fields[++i], status: xy });
  }
  return dirty;
}

/** True when `path` is `spec` or under the directory `spec` (inventory directories end with '/'). */
export const covers = (spec, path) =>
  spec.endsWith('/')
    ? path.startsWith(spec) || `${path}/` === spec
    : path === spec || path.startsWith(`${spec}/`);

/** Split candidate stage paths into those the stage may touch and those skipped for uncommitted changes. */
export function planPaths(dirty, paths) {
  const apply = [];
  const skipped = [];
  for (const path of paths) {
    const hits = dirty.filter((d) => covers(path, d.path) || covers(d.path, path));
    if (hits.length) skipped.push({ path, reason: 'uncommitted changes', dirty: hits });
    else apply.push(path);
  }
  return { part: 'plan', status: 'pass', apply, skipped };
}

// ------------------------------------------------------------------------------------------------- stage diff

/** The stage's file changes base..stage with rename detection: [{ status, path, to? }]. */
export function stageChanges(repo, base, stage) {
  const fields = git(repo, [
    'diff',
    '-z',
    '--name-status',
    '-M',
    '--no-ext-diff',
    base,
    stage,
  ]).split('\0');
  const changes = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C')
      changes.push({
        status: status[0],
        similarity: Number(status.slice(1)),
        path: fields[++i],
        to: fields[++i],
      });
    else changes.push({ status, path: fields[++i] });
  }
  return changes;
}

const filesAt = (repo, rev, spec) =>
  git(repo, ['ls-tree', '-r', '-z', '--name-only', rev, '--', spec.replace(/\/$/, '')])
    .split('\0')
    .filter(Boolean);

/** Every inventory path present at base is kept (or moved) by the stage, never dropped. */
export function judgeProtected(repo, base, changes, inventory) {
  const rows = [];
  for (const { path, disposition } of inventory.paths) {
    if (path.startsWith('../')) {
      rows.push({ path, disposition, status: 'not_applicable', reason: 'outside the repository' });
      continue;
    }
    if (!filesAt(repo, base, path).length) {
      rows.push({ path, disposition, status: 'not_applicable', reason: 'absent at base' });
      continue;
    }
    const dropped = changes
      .filter((c) => c.status === 'D' && covers(path, c.path))
      .map((c) => c.path);
    const moved = changes
      .filter((c) => c.status === 'R' && covers(path, c.path))
      .map((c) => ({ from: c.path, to: c.to, similarity: c.similarity }));
    rows.push({
      path,
      disposition,
      status: dropped.length ? 'fail' : 'pass',
      kept: !dropped.length && !moved.length,
      ...(moved.length ? { moved } : {}),
      ...(dropped.length ? { dropped, reason: 'protected path dropped by the stage' } : {}),
    });
  }
  const failed = rows.filter((r) => r.status === 'fail');
  return {
    part: 'protected',
    status: failed.length ? 'fail' : 'pass',
    rows,
    ...(failed.length ? { reason: `dropped: ${failed.map((r) => r.path).join(', ')}` } : {}),
  };
}

/** The stage must not change a path that has uncommitted changes: it is skipped, never overwritten. */
export function judgeDirty(dirty, changes) {
  const touched = changes.flatMap((c) => (c.to ? [c.path, c.to] : [c.path]));
  const overlap = dirty.filter((d) => touched.some((t) => covers(t, d.path) || covers(d.path, t)));
  return {
    part: 'dirty',
    status: overlap.length ? 'fail' : 'pass',
    dirty,
    overlap,
    ...(overlap.length
      ? {
          reason: `stage changes paths with uncommitted changes: ${overlap.map((d) => d.path).join(', ')}`,
        }
      : {}),
  };
}

export function runRequire({ name, command }, cwd = process.cwd()) {
  const r = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8' });
  const tail = (s) => (s ?? '').trim().split('\n').slice(-5).join('\n');
  return {
    part: `require:${name}`,
    status: r.status === 0 ? 'pass' : 'fail',
    command,
    exit: r.status,
    ...(r.status === 0
      ? {}
      : { reason: `exit ${r.status ?? r.signal}`, stderr: tail(r.stderr), stdout: tail(r.stdout) }),
  };
}

export function summarize(parts) {
  const failed = parts.filter((p) => p.status === 'fail').map((p) => p.part);
  return { part: 'summary', status: failed.length ? 'fail' : 'pass', failed };
}

// ------------------------------------------------------------------------------------------------- main

export function run(opts) {
  const repo = opts.repo;
  const branch = opts['default-branch'] ?? defaultBranch(repo);
  const parts = [];
  if (opts.command === 'snapshot') {
    const refs = snapshotRefs(repo, opts.remote);
    if (opts.out) writeFileSync(opts.out, `${JSON.stringify(refs, null, 2)}\n`);
    parts.push({ part: 'snapshot', status: 'pass', count: Object.keys(refs).length, refs });
  } else if (opts.command === 'plan') {
    const paths = opts.paths
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    parts.push(planPaths(dirtyPaths(repo), paths));
  } else if (opts.command === 'refs') {
    const before = JSON.parse(readFileSync(opts.before, 'utf8'));
    const after = opts.after
      ? JSON.parse(readFileSync(opts.after, 'utf8'))
      : snapshotRefs(repo, opts.remote);
    parts.push(judgeRefs(repo, before, after, branch));
  } else {
    const changes = stageChanges(repo, opts.base, opts.stage);
    const inventory = JSON.parse(readFileSync(opts.protected, 'utf8'));
    parts.push(judgeProtected(repo, opts.base, changes, inventory));
    parts.push(judgeDirty(dirtyPaths(repo), changes));
    if (opts['refs-before']) {
      const before = JSON.parse(readFileSync(opts['refs-before'], 'utf8'));
      parts.push(judgeRefs(repo, before, snapshotRefs(repo, opts.remote), branch));
    } else
      parts.push({ part: 'refs', status: 'not_applicable', reason: 'no --refs-before snapshot' });
    for (const req of opts.require) parts.push(runRequire(req));
  }
  return [...parts, summarize(parts)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let lines;
  try {
    lines = run(parseCli(process.argv.slice(2)));
  } catch (error) {
    lines = [
      { part: 'error', status: 'fail', reason: error.message },
      summarize([{ part: 'error', status: 'fail' }]),
    ];
  }
  for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
  process.exitCode = lines.at(-1).status === 'fail' ? 1 : 0;
}
