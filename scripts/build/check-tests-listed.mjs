#!/usr/bin/env node
// Every workspace test file runs in `npm test` (fm-fy2.4), after classic's scripts/check-tests-listed.mjs: a test
// file no command names is not a gate, it is a file. Reads the `test` script of the root and of each workspace,
// takes its `*.test.*` arguments as globs from that package's directory, and lists every *.test.{mjs,ts} file in
// the workspaces and scripts/build that none of them match.
//   node scripts/build/check-tests-listed.mjs
// One JSON line; exit 1 when a test file is unlisted.
import { readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACES } from './check-scaffold.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEST_FILE = /\.test\.(mjs|ts)$/;

/** Repo-relative globs from one package's `test` script, given that package's directory ('' for the root). */
export function testGlobs(dir, script = '') {
  return script
    .split(/\s+/)
    .filter((arg) => TEST_FILE.test(arg))
    .map((arg) => (dir ? `${dir}/${arg}` : arg));
}

/** The files that no glob matches. */
export function unlisted(files, globs) {
  return files.filter((f) => !globs.some((g) => matchesGlob(f, g))).sort();
}

function testFiles(dir, found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFiles(path, found);
    else if (TEST_FILE.test(entry.name)) found.push(path);
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
  ]
    .flatMap((dir) => testFiles(dir))
    .map((f) => relative(ROOT, join(ROOT, f)));
  const missing = unlisted(files, globs);
  console.log(JSON.stringify({ testFiles: files.length, globs, unlisted: missing }));
  process.exit(missing.length ? 1 : 0);
}
