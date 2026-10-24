#!/usr/bin/env node
// Research-tree import (bead fm-86u).
//   node import.mjs census [--classic=../facemorph.me-classic] [--commit=b2d945a]   writes the digest list
//   node import.mjs import [--classic=...]                                          writes the files
// The census reads classic's Git objects at the snapshot commit, scans every file for weights and secrets,
// lists classic's uncommitted autoresearch/ edits as exclusions with content digests, and lists every
// classic file outside the tree that references a tree path. The import writes from Git objects only and
// never overwrites a file that differs.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeFiles, buildDigestList, importFiles } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const DIGEST_LIST = join(ROOT, 'docs/research-import/digest-list.json');
export const SNAPSHOT = { repository: 'check-face/facemorph.me-classic', branch: 'candidate/next-delivery-20260916', commit: 'b2d945a8c7f0ff9f382fbfefaecc2651943077a3' };

// Paths another bead re-homed before this import: recorded, never overwritten.
export const OVERRIDES = {
  'autoresearch/run.py': {
    disposition: 're-homed', owner: 'fm-htbc',
    reason: 'research lease bead re-homed run.py with the lease state (24 October parallelism pass); the snapshot copy is listed by digest only',
  },
  'autoresearch/README.md': {
    disposition: 'held', owner: 'fm-htbc',
    reason: 'destination reserved by fm-htbc for the lease guide; imported byte-identically or listed by digest only once fm-htbc settles the path',
  },
};

// --no-optional-locks: never take classic's index lock while other sessions work there.
// The research ledger grows after the import; its snapshot bytes must stay its prefix.
export const APPEND_ONLY = ['autoresearch/results.tsv'];

const git = (repo, args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Classic files outside the tree that name a tree path, with the referenced paths and those that do not
// exist at the snapshot (neither a file nor a directory prefix of one).
export function consumers(repo, commit, files) {
  let out = '';
  try {
    out = git(repo, ['grep', '-I', '-o', '-z', '-E', 'autoresearch/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]', commit, '--', '.', ':!autoresearch']);
  } catch (e) {
    if (e.status !== 1) throw e; // 1: no matches
  }
  const paths = files.map((f) => f.path);
  const exists = (ref) => paths.includes(ref) || paths.some((p) => p.startsWith(ref.endsWith('/') ? ref : `${ref}/`));
  const byFile = new Map();
  for (const rec of out.split('\n').filter(Boolean)) {
    // <commit>:<path>\0<match>
    const [where, ref] = rec.split('\0');
    const path = where.slice(commit.length + 1);
    if (!byFile.has(path)) byFile.set(path, new Set());
    byFile.get(path).add(ref.replace(/\.$/, ''));
  }
  return [...byFile].sort(([a], [b]) => a.localeCompare(b)).map(([path, refs]) => {
    const references = [...refs].sort();
    return { path, references, missingAtSnapshot: references.filter((r) => !exists(r)) };
  });
}

// Classic's working-copy autoresearch/ files that differ from HEAD or are untracked (read only).
export function uncommitted(repo) {
  return git(repo, ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'autoresearch/']).split('\0').filter(Boolean)
    .map((l) => l.slice(3)).filter((p) => existsSync(join(repo, p)))
    .map((path) => ({ path, bytes: readFileSync(join(repo, path)) }));
}

export function census(classic, commit) {
  const full = git(classic, ['rev-parse', `${commit}^{commit}`]).trim();
  const files = treeFiles(classic, full, 'autoresearch/');
  const head = git(classic, ['rev-parse', 'HEAD']).trim();
  const tree = git(classic, ['rev-parse', `${full}:autoresearch`]).trim();
  const snapshot = {
    ...SNAPSHOT, commit: full, tree,
    sameTreeAt: { commit: head, identical: git(classic, ['rev-parse', `${head}:autoresearch`]).trim() === tree },
  };
  return buildDigestList({ snapshot, files, overrides: OVERRIDES, uncommitted: uncommitted(classic), consumers: consumers(classic, full, files), appendOnly: APPEND_ONLY });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = Object.fromEntries(rest.map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
  const classic = resolve(a.classic ?? join(ROOT, '../facemorph.me-classic'));
  if (cmd === 'census') {
    const list = census(classic, a.commit ?? SNAPSHOT.commit);
    mkdirSync(dirname(DIGEST_LIST), { recursive: true });
    writeFileSync(DIGEST_LIST, `${JSON.stringify(list, null, 1)}\n`);
    const counts = {};
    for (const f of list.files) counts[f.disposition] = (counts[f.disposition] ?? 0) + 1;
    console.log(JSON.stringify({ event: 'census', ...list.census, dispositions: counts, exclusions: list.exclusions.length, consumers: list.consumers.length, frozenDirectories: list.frozenDirectories }));
  } else if (cmd === 'import') {
    const list = JSON.parse(readFileSync(DIGEST_LIST, 'utf8'));
    const r = importFiles(list, { repo: classic, commit: list.snapshot.commit, root: ROOT });
    console.log(JSON.stringify({ event: 'import', written: r.written.length, present: r.present, conflicts: r.conflicts }));
    process.exitCode = r.conflicts.length ? 1 : 0;
  } else {
    console.error('usage: import.mjs census|import [--classic=<path>] [--commit=<sha>]');
    process.exitCode = 2;
  }
}
