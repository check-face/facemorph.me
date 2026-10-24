#!/usr/bin/env node
// Research ledger checks (bead fm-zxj), run in CI on every autoresearch/** change:
//   node scripts/check-research-ledger.mjs [--base <rev>] [--classic <classic git dir>] [--root <repo>]
// - autoresearch/results.tsv: exact header; the base revision's file is its byte prefix; the handover
//   snapshot (docs/research-import/digest-list.json) is still its prefix; unique row IDs; corrections cite
//   earlier IDs; new rows record evaluated outcomes only.
// - autoresearch/**/log.md: only grow at EOF; entry headings in maintained logs have timezone-aware
//   timestamps and unique IDs (the frozen reviews/ logs keep their historical headings).
// - Links in the maintained research docs (and, with --classic, classic's forward pointer) resolve.
// - With --classic: a row appended to classic's results.tsv on its default or candidate branch after the
//   handover fails as a new round in classic.
// --base defaults to the merge-base of HEAD and origin/main, or HEAD~1 when HEAD is origin/main.
// Exit 0 pass, 1 fail; one JSON line per problem.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClassicFork, checkLedger, checkLinks, checkLog } from './research-ledger/lib.mjs';

export const CLASSIC_BRANCHES = ['master', 'candidate/next-delivery-20260916'];
export const CLASSIC_POINTER = 'autoresearch/MOVED.md';
const MAINTAINED_DOCS = ['autoresearch/README.md', 'autoresearch/program.md', 'autoresearch/records.md', 'ops/lease/README.md'];

const git = (dir, args) => execFileSync('git', ['-C', dir, '--no-optional-locks', ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (dir, args) => {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
};

function defaultBase(root) {
  const head = git(root, ['rev-parse', 'HEAD']).toString().trim();
  const main = tryGit(root, ['rev-parse', 'origin/main'])?.toString().trim();
  if (main && main !== head) return git(root, ['merge-base', 'HEAD', 'origin/main']).toString().trim();
  return tryGit(root, ['rev-parse', 'HEAD~1'])?.toString().trim() ?? null;
}

/** A ref name as it exists in the classic repository: origin's branch first (the published, canonical state; a
 * shared local checkout can lag it), else the local branch. */
function classicRef(classic, branch) {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) if (tryGit(classic, ['rev-parse', '--verify', '--quiet', ref])) return ref;
  return null;
}

export function run({ root, base, classic }) {
  const problems = [];
  const at = (rev, path) => (rev ? tryGit(root, ['show', `${rev}:${path}`]) : null);
  const list = JSON.parse(readFileSync(join(root, 'docs/research-import/digest-list.json'), 'utf8'));
  const entry = list.files.find((f) => f.destination === 'autoresearch/results.tsv');
  const snapshot = { size: entry.size, sha256: entry.sha256 };
  const head = readFileSync(join(root, 'autoresearch/results.tsv'));
  problems.push(...checkLedger({ head, base: at(base, 'autoresearch/results.tsv'), snapshot }));

  const logs = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'autoresearch']).toString().split('\n').filter((p) => p.endsWith('/log.md'));
  for (const path of logs) {
    problems.push(...checkLog({ path, head: readFileSync(join(root, path)), base: at(base, path), frozen: path.startsWith('autoresearch/reviews/') }));
  }

  const rounds = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'autoresearch/rounds']).toString().split('\n').filter((p) => p.endsWith('.md'));
  const docs = [...MAINTAINED_DOCS, ...rounds].filter((p) => existsSync(join(root, p))).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  const missing = MAINTAINED_DOCS.filter((p) => !existsSync(join(root, p))).map((path) => ({ kind: 'missing-doc', path }));
  problems.push(...missing);

  if (classic) {
    const ledgers = CLASSIC_BRANCHES.map((branch) => {
      const ref = classicRef(classic, branch);
      return { ref: ref ?? branch, bytes: ref ? tryGit(classic, ['show', `${ref}:autoresearch/results.tsv`]) : null };
    });
    problems.push(...checkClassicFork({ classic: ledgers, snapshotBytes: head.subarray(0, snapshot.size) }));
    const candidate = classicRef(classic, CLASSIC_BRANCHES[1]);
    const pointer = candidate ? tryGit(classic, ['show', `${candidate}:${CLASSIC_POINTER}`]) : null;
    if (pointer) docs.push({ path: `classic:${CLASSIC_POINTER}`, text: pointer.toString('utf8'), base: '' });
    else problems.push({ kind: 'classic-pointer-missing', path: CLASSIC_POINTER });
  }
  problems.push(...checkLinks(docs, (p) => existsSync(join(root, p))));
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const root = resolve(args.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const base = args.base && !/^0+$/.test(args.base) ? args.base : defaultBase(root);
  const problems = run({ root, base, classic: args.classic && resolve(args.classic) });
  console.log(JSON.stringify({ event: 'check-research-ledger', ok: problems.length === 0, base, classic: Boolean(args.classic), problems: problems.length }));
  for (const p of problems) console.log(JSON.stringify({ event: 'problem', ...p }));
  process.exitCode = problems.length ? 1 : 0;
}
