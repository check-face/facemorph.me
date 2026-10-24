#!/usr/bin/env node
// Every workspace test file runs in `npm test` (fm-fy2.4), after classic's scripts/check-tests-listed.mjs: a test
// file no command names is not a gate, it is a file. Reads the `test` script of the root and of each workspace,
// takes its `*.test.*` arguments as globs from that package's directory, and lists every *.test.{mjs,ts} file in
// the workspaces, scripts/build and scripts/ci (plus test_*.py there) that none of them match.
// With --base <rev> it also fails when a test file that existed at <rev> was removed or renamed and
// tests/retired.txt does not name it with its replacement test or the plan change that made it obsolete (fm-pud).
//   node scripts/build/check-tests-listed.mjs [--base <rev>]
// One JSON line; exit 1 when a test file is unlisted or retired without an entry.
//
// tests/retired.txt: one entry per line, `#` comments and blank lines ignored:
//   <removed test path> -> replacement: <test path>; reason: <text>
//   <removed test path> -> plan: <PLAN.md#anchor or dated decision>; reason: <text>
// A replacement must exist; every field must be non-empty.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACES } from './check-scaffold.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEST_FILE = /\.test\.(mjs|ts)$/;
// Python unittest files, listed only where this check scans for them (scripts/ci, fm-o8xn).
const PY_TEST_FILE = /(^|\/)test_[^/]*\.py$/;

/** Repo-relative globs from one package's `test` script, given that package's directory ('' for the root). */
export function testGlobs(dir, script = '') {
  return script
    .split(/\s+/)
    .map((arg) => arg.replace(/^(['"])(.*)\1$/, '$2')) // a quoted glob reaches node --test unexpanded
    .filter((arg) => TEST_FILE.test(arg) || PY_TEST_FILE.test(arg))
    .map((arg) => (dir ? `${dir}/${arg}` : arg));
}

/** The files that no glob matches. */
export function unlisted(files, globs) {
  return files.filter((f) => !globs.some((g) => matchesGlob(f, g))).sort();
}

export const RETIRED = 'tests/retired.txt';
const ENTRY = /^(\S+)\s+->\s+(replacement|plan):\s*([^;]*?)\s*;\s*reason:\s*(.*?)\s*$/;

/** Parses tests/retired.txt into entries by path, and a problem for each malformed or incomplete line. Pure. */
export function parseRetired(text) {
  const entries = new Map();
  const problems = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = ENTRY.exec(line);
    if (!m || !m[3] || !m[4])
      problems.push({
        line: i + 1,
        problem: 'entry needs <path> -> replacement|plan: <target>; reason: <text>',
      });
    else entries.set(m[1], { path: m[1], kind: m[2], target: m[3], reason: m[4] });
  });
  return { entries, problems };
}

const isTest = (path) => TEST_FILE.test(path) || PY_TEST_FILE.test(path);

/** Test files removed or renamed between `base` and the working tree's HEAD, from git's rename detection. */
export function testChanges(root, base) {
  const r = spawnSync('git', ['diff', '--name-status', '-M', '--no-color', base, 'HEAD', '--'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git diff ${base} HEAD failed: ${r.stderr.trim()}`);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .flatMap(([status, from, to]) =>
      status === 'D' && isTest(from)
        ? [{ change: 'removed', path: from }]
        : status.startsWith('R') && isTest(from)
          ? [{ change: 'renamed', path: from, to }]
          : [],
    );
}

/** Each removed or renamed test without a valid retired entry. `exists` says whether a replacement path exists. */
export function retiredFindings(changes, entries, exists) {
  const out = [];
  for (const c of changes) {
    const e = entries.get(c.path);
    if (!e) out.push({ ...c, problem: `${c.change} without a tests/retired.txt entry` });
    else if (e.kind === 'replacement' && !exists(e.target))
      out.push({
        ...c,
        problem: `retired entry names a replacement that does not exist: ${e.target}`,
      });
  }
  return out;
}

function testFiles(dir, found = [], pattern = TEST_FILE) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFiles(path, found, pattern);
    else if (pattern.test(entry.name)) found.push(path);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const script = (dir) =>
    JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts?.test;
  const globs = ['', ...WORKSPACES].flatMap((dir) => testGlobs(dir, script(dir)));
  // apps/web's e2e and parity specs run in their own browser lanes, not in `npm test`.
  const files = [
    ...WORKSPACES.map((w) => (w === 'apps/web' ? 'apps/web/test' : w)),
    'scripts/build',
    'scripts/ci',
  ]
    .flatMap((dir) => testFiles(dir))
    .concat(testFiles('scripts/ci', [], PY_TEST_FILE))
    .map((f) => relative(ROOT, join(ROOT, f)));
  const missing = unlisted(files, globs);
  const argv = process.argv.slice(2);
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : undefined;
  const { entries, problems } = parseRetired(
    existsSync(join(ROOT, RETIRED)) ? readFileSync(join(ROOT, RETIRED), 'utf8') : '',
  );
  const retired = base
    ? retiredFindings(testChanges(ROOT, base), entries, (p) => existsSync(join(ROOT, p)))
    : [];
  console.log(
    JSON.stringify({
      testFiles: files.length,
      globs,
      unlisted: missing,
      base: base ?? null,
      retired,
      retiredFile: problems,
    }),
  );
  process.exit(missing.length || retired.length || problems.length ? 1 : 0);
}
