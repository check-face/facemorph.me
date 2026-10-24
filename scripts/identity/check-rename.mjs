#!/usr/bin/env node
// Organization rename check (fm-rur, plan: rename.execute). Read-only: `gh api` GETs and `git ls-remote`.
// For the organization given (the old one before the rename, the new one after it), asserts that every repository
// in rename-expected.json still has its stable ID, name, archive flag and default branch, that its URL under that
// organization answers `git ls-remote`, that each historical commit still resolves, and that every
// github.com/<org>/<repo> link in the active docs names a repository that resolves.
//   node scripts/identity/check-rename.mjs --org check-face        # pre-rename dry run
//   node scripts/identity/check-rename.mjs --org facemorph-me      # immediately after the rename
//   --expected <file>   expected values (default: rename-expected.json beside this script)
//   --root <dir>        repository root for the active docs (default: this checkout)
// One JSON line per assertion {assertion, command, expected, actual, ok}, then a summary line.
// Exit 0 when every assertion holds, 1 when any fails, 2 on a usage error.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell } from './read-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const EXPECTED_FILE = join(here, 'rename-expected.json');

function run(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 60_000 });
  return {
    command: shell(argv),
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

const ghJson = (path) => {
  const r = run(['gh', 'api', path]);
  let json = null;
  if (r.status === 0)
    try {
      json = JSON.parse(r.stdout);
    } catch {
      json = null;
    }
  return { ...r, json };
};

/** github.com/<org>/<repo> references in the active docs (files or directories, markdown and text). */
export function docLinks(root, paths, org) {
  const pattern = new RegExp(
    `https://github\\.com/${org.replace(/[.-]/g, '\\$&')}/([A-Za-z0-9._-]+)`,
    'g',
  );
  const files = [];
  const walk = (p) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else if (/\.(md|txt)$/i.test(p)) files.push(p);
  };
  for (const p of paths) walk(join(root, p));
  const repos = new Map();
  for (const f of files)
    for (const m of readFileSync(f, 'utf8').matchAll(pattern)) {
      const name = m[1].replace(/\.git$/, '').replace(/[.]+$/, '');
      if (!repos.has(name)) repos.set(name, f.slice(root.length + 1));
    }
  return [...repos].map(([name, file]) => ({ name, file }));
}

/** Runs every assertion; `emit` receives each result as it is made. Returns the results. */
export function checkRename({ org, expected, root, emit = () => {} }) {
  const out = [];
  const add = (assertion, command, want, actual) => {
    const r = {
      assertion,
      command,
      expected: want,
      actual,
      ok: JSON.stringify(want) === JSON.stringify(actual),
    };
    out.push(r);
    emit(r);
  };
  for (const repo of expected.repositories) {
    const r = ghJson(`repositories/${repo.id}`);
    const got = r.json
      ? {
          id: r.json.id,
          fullName: r.json.full_name,
          archived: r.json.archived,
          defaultBranch: r.json.default_branch,
        }
      : { error: (r.stderr || r.stdout).trim().slice(0, 200) };
    add(
      `repository ${repo.id} identity`,
      r.command,
      {
        id: repo.id,
        fullName: `${org}/${repo.name}`,
        archived: repo.archived,
        defaultBranch: repo.defaultBranch,
      },
      got,
    );
    const url = `https://github.com/${org}/${repo.name}.git`;
    const ls = run(['git', 'ls-remote', '--symref', url, 'HEAD']);
    const head = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(ls.stdout)?.[1] ?? null;
    add(
      `${org}/${repo.name} answers git ls-remote with its default branch`,
      ls.command,
      repo.defaultBranch,
      ls.status === 0 ? head : `exit ${ls.status}`,
    );
  }
  for (const c of expected.commits) {
    const r = ghJson(`repositories/${c.repoId}/commits/${c.sha}`);
    add(
      `commit ${c.sha.slice(0, 7)} (${c.label}) resolves`,
      r.command,
      c.sha,
      r.json?.sha ?? `exit ${r.status}`,
    );
  }
  const names = new Set(expected.repositories.map((r) => r.name));
  for (const link of docLinks(root, expected.activeDocs, org)) {
    const r = ghJson(`repos/${org}/${link.name}`);
    add(
      `link github.com/${org}/${link.name} in ${link.file} resolves to a listed repository`,
      r.command,
      { fullName: `${org}/${link.name}`, listed: true },
      { fullName: r.json?.full_name ?? `exit ${r.status}`, listed: names.has(link.name) },
    );
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const org = arg('--org');
  if (!org || !/^[A-Za-z0-9-]+$/.test(org)) {
    console.error('usage: check-rename.mjs --org <login> [--expected <file>] [--root <dir>]');
    process.exit(2);
  }
  const expected = JSON.parse(readFileSync(arg('--expected') ?? EXPECTED_FILE, 'utf8'));
  const root = resolve(arg('--root') ?? join(here, '../..'));
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  const results = checkRename({ org, expected, root, emit: (r) => console.log(JSON.stringify(r)) });
  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ summary: { org, assertions: results.length, failed } }));
  process.exit(failed ? 1 : 0);
}
