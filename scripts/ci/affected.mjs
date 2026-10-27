#!/usr/bin/env node
// Which npm-test suites a check.yml run needs, from the files changed since the last successful check run.
// Suites are the live npm-test inventory's cwds (scaffold-test-shards.mjs): '.' (the root's own tests) and each
// workspace with a test script. Rules, in order, for every changed path:
// - Inside a workspace directory: that workspace and every workspace depending on it (package.json dependencies,
//   devDependencies, peerDependencies, optionalDependencies, transitively).
// - Under a ROOT_ONLY directory: nothing beyond the baseline. Each was checked to be unreferenced by package code
//   (affected.test.mjs keeps that true).
// - Anything else selects every suite: root config (package.json, package-lock.json, tsconfig*, .oxlintrc.json,
//   .oxfmtrc.json, .nvmrc, .gitignore), .github/**, scripts/** outside ROOT_ONLY (scripts/ci/** included), hosting,
//   services, tests, tools, import, inventory, docs and top-level files. Workspace code and tests read these.
// Any change also selects the BASELINE suites: the root (its tests exercise every workspace and the whole tree) and
// apps/web (test/build/native-retirement.test.ts scans every tracked file). No usable base, an empty diff or a
// non-push event selects every suite. Static checks and the smoke journeys are not selected here: they always run.
// The base is the head of the latest earlier successful check run on main, so a failed or superseded pending run's
// changes stay in the next diff until a run passes. It is a tree diff, so a rewritten history still compares what
// last passed with what is pushed now.
//   node scripts/ci/affected.mjs --head <sha> [--base <sha> | --previous-success <workflow file>]
//   one JSON line; appends suites=<json array> and base=<sha or empty> to $GITHUB_OUTPUT
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inventory } from './scaffold-test-shards.mjs';

export const ROOT_SUITE = '.';
export const BASELINE = [ROOT_SUITE, 'apps/web'];
export const ROOT_ONLY = [
  '.beads/',
  'autoresearch/',
  'ops/',
  'scripts/beads/',
  'scripts/delivery/',
  'scripts/diagnostics/',
  'scripts/hooks/',
  'scripts/names-publish/',
  'scripts/names-snapshot/',
  'scripts/obs/',
  'scripts/research-import/',
  'scripts/research-ledger/',
  'tests/external-consumer/',
  'tools/browser-harness/',
  'tools/names-generator/',
  'tools/names-spike/',
  'tools/ort-qualify/',
];
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** Workspaces of a tree: directory and the directories of the workspaces it depends on. Pure given `read`. */
export function workspaceGraph(read) {
  const root = JSON.parse(read('package.json'));
  const metas = (root.workspaces ?? []).map((dir) => ({
    dir,
    meta: JSON.parse(read(`${dir}/package.json`)),
  }));
  const byName = new Map(metas.map(({ dir, meta }) => [meta.name, dir]));
  return metas.map(({ dir, meta }) => ({
    dir,
    deps: [
      ...new Set(
        DEPENDENCY_SECTIONS.flatMap((section) => Object.keys(meta[section] ?? {}))
          .map((name) => byName.get(name))
          .filter((d) => d && d !== dir),
      ),
    ].sort(),
  }));
}

/** The given workspace directories and every workspace depending on them, transitively. Pure. */
export function withDependents(graph, dirs) {
  const out = new Set(dirs);
  for (let grew = true; grew;) {
    grew = false;
    for (const { dir, deps } of graph)
      if (!out.has(dir) && deps.some((d) => out.has(d))) {
        out.add(dir);
        grew = true;
      }
  }
  return out;
}

const under = (file, dir) => file.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

/**
 * The suites to run for the changed files. `files` null (no usable base) or empty selects every suite. `suites` is
 * the inventory's suite cwds ('.' for the root). Returns the sorted selection and why. Pure.
 */
export function selectSuites(files, graph, suites) {
  const all = [...new Set(suites)].sort();
  if (files == null) return { full: true, reason: 'no usable base', suites: all };
  if (!files.length) return { full: true, reason: 'no changed files', suites: all };
  const hit = new Set();
  for (const file of files) {
    const workspace = graph.find(({ dir }) => under(file, dir));
    if (workspace) hit.add(workspace.dir);
    else if (!ROOT_ONLY.some((dir) => under(file, dir)))
      return { full: true, reason: `${file} is outside the workspaces and ROOT_ONLY`, suites: all };
  }
  const selected = new Set([...BASELINE, ...withDependents(graph, hit)]);
  return {
    full: false,
    reason: hit.size ? `workspaces ${[...hit].sort().join(', ')}` : 'root-only paths',
    suites: all.filter((s) => selected.has(s)),
  };
}

/** Head of the latest earlier successful run on main of the workflow's run listing, or undefined. Pure. */
export function previousSuccessHead(listing, currentRunNumber) {
  if (!Number.isSafeInteger(currentRunNumber) || currentRunNumber < 1) return undefined;
  const runs = listing?.workflow_runs;
  if (!Array.isArray(runs)) return undefined;
  return runs
    .filter(
      (run) =>
        run &&
        Number.isSafeInteger(run.run_number) &&
        run.run_number > 0 &&
        run.run_number < currentRunNumber &&
        run.head_branch === 'main' &&
        (run.event === 'push' || run.event === 'workflow_dispatch') &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        typeof run.head_sha === 'string' &&
        /^[a-f0-9]{40}$/.test(run.head_sha),
    )
    .sort((a, b) => b.run_number - a.run_number)[0]?.head_sha;
}

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

function previousSuccessBase(workflow) {
  const { GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_RUN_NUMBER } = process.env;
  if (GITHUB_EVENT_NAME !== 'push')
    return { note: `${GITHUB_EVENT_NAME ?? 'local'} run: every suite` };
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? '') || !/^[\w.-]+\.ya?ml$/.test(workflow))
    return { note: 'no run identity: every suite' };
  try {
    const listing = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=50`,
        ],
        { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      ),
    );
    const base = previousSuccessHead(listing, Number(GITHUB_RUN_NUMBER));
    return base ? { base } : { note: 'no earlier successful run: every suite' };
  } catch (error) {
    return { note: `run lookup failed (${String(error.message).slice(0, 200)}): every suite` };
  }
}

/** Files differing between the base and head trees, or null when the base cannot be read even after a fetch. */
export function changedFiles(root, base, head) {
  if (!base) return null;
  const present = () => {
    try {
      git(root, 'cat-file', '-e', `${base}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  if (!present()) {
    try {
      git(root, 'fetch', '--no-tags', '--quiet', '--depth=1', 'origin', base);
    } catch {
      return null;
    }
    if (!present()) return null;
  }
  return git(root, 'diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      head: { type: 'string', default: 'HEAD' },
      base: { type: 'string' },
      'previous-success': { type: 'string' },
      root: { type: 'string' },
    },
  });
  if (values.base !== undefined && values['previous-success'] !== undefined)
    throw Error('--base and --previous-success are mutually exclusive');
  const root = values.root ?? fileURLToPath(new URL('../..', import.meta.url));
  const looked = values['previous-success']
    ? previousSuccessBase(values['previous-success'])
    : { base: values.base || undefined };
  const files = changedFiles(root, looked.base, values.head);
  const graph = workspaceGraph((path) => readFileSync(join(root, path), 'utf8'));
  const suites = inventory(root).map(({ cwd }) => cwd || ROOT_SUITE);
  const selection = selectSuites(files, graph, suites);
  console.log(
    JSON.stringify({
      event: 'affected',
      base: files ? looked.base : null,
      head: values.head,
      ...(looked.note ? { note: looked.note } : {}),
      files: files?.length ?? 'all',
      ...selection,
    }),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `suites=${JSON.stringify(selection.suites)}\nbase=${files ? looked.base : ''}\n`,
    );
}
