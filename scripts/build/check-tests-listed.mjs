#!/usr/bin/env node
// Every workspace test file runs in `npm test` (fm-fy2.4), after classic's scripts/check-tests-listed.mjs: a test
// file no command names is not a gate, it is a file. Reads the `test` script of the root and of each workspace,
// takes its `*.test.*` arguments as globs from that package's directory, and lists every *.test.{mjs,ts} file in
// the workspaces, scripts/build and scripts/ci (plus test_*.py there) that none of them match.
//   node scripts/build/check-tests-listed.mjs
// One JSON line; exit 1 when a test file is unlisted.
import { readdirSync, readFileSync } from 'node:fs';
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
  console.log(JSON.stringify({ testFiles: files.length, globs, unlisted: missing }));
  process.exit(missing.length ? 1 : 0);
}
