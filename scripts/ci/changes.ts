#!/usr/bin/env node
// Which CI lanes a main.yml run calls (fm-98po, the merge queue): main has one run at a time and the next run
// takes every change pushed since, stacked. The diff runs from the previous started main.yml run's head,
// regardless of its result; cancelled pending runs do not consume stacked changes. Each lane's paths
// are its declaration in scripts/ci/path-filters.json: its shared narrowing, its extras, its own workflow file and
// the shared actions. A lane marked `always` runs on any change outside its `ignore` list. A change to the pipeline
// itself (main.yml, this script, the filters) runs every lane, as does a run with no usable base.
//   node scripts/ci/changes.ts --head <sha> [--base <sha>]     one JSON line; appends lanes=<json> to $GITHUB_OUTPUT
//   node scripts/ci/changes.ts --previous-main-run --head <sha>   resolve base using GitHub run metadata
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Filters, type Lane, SHARED_ACTIONS } from './path-filters.ts';

/** Changing any of these changes what every lane is, so every lane runs. */
export const PIPELINE = [
  '.github/workflows/main.yml',
  'scripts/ci/changes.ts',
  'scripts/ci/path-filters.ts',
  'scripts/ci/path-filters.json',
  'scripts/ci/workspace-cache.sh',
];

/** The globs a lane runs for. Pure. */
export function laneGlobs(lane: Lane): string[] {
  return [...lane.shared, ...lane.extra, lane.workflow, SHARED_ACTIONS];
}

// GitHub's path filters let ** match dot-files (apps/web/.gitignore); Node's matchesGlob does not, so a path is also
// tried with its leading dots masked (as scripts/build/identity.mjs does).
const dotless = (f: string) => f.replace(/(^|\/)\./g, '$1_');
const matches = (file: string, globs: readonly string[]) =>
  globs.some((g) => file === g || matchesGlob(file, g) || matchesGlob(dotless(file), g));

/** The lanes to call for a set of changed files; `null` files (no usable base) selects every lane. Pure. */
export function selectLanes(files: readonly string[] | null, filters: Filters): string[] {
  const all = Object.keys(filters.lanes).sort();
  if (files === null || files.some((f) => PIPELINE.includes(f))) return all;
  return all.filter((name) => {
    const lane = filters.lanes[name]!;
    if (lane.always) return files.some((f) => !matches(f, lane.ignore ?? []));
    return files.some((f) => matches(f, laneGlobs(lane)));
  });
}

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** Previous started main run, including failures; never the current run, a newer run, or a superseded pending run. */
export function previousMainRunHead(input: unknown, currentRunNumber: number): string | undefined {
  if (
    !Number.isSafeInteger(currentRunNumber) ||
    currentRunNumber < 1 ||
    !input ||
    typeof input !== 'object'
  )
    return undefined;
  const runs = (input as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(runs)) return undefined;
  const earlier = runs.filter((inputRun: unknown) => {
    if (!inputRun || typeof inputRun !== 'object') return false;
    const run = inputRun as Record<string, unknown>;
    return (
      Number.isSafeInteger(run.run_number) &&
      (run.run_number as number) > 0 &&
      (run.run_number as number) < currentRunNumber &&
      run.head_branch === 'main' &&
      (run.event === 'push' || run.event === 'workflow_dispatch') &&
      (run.status === 'completed' || run.status === 'in_progress') &&
      run.conclusion !== 'cancelled' &&
      run.conclusion !== 'skipped' &&
      run.conclusion !== 'startup_failure' &&
      typeof run.head_sha === 'string' &&
      /^[a-f0-9]{40}$/.test(run.head_sha)
    );
  }) as { run_number: number; head_sha: string }[];
  return earlier.sort((a, b) => b.run_number - a.run_number)[0]?.head_sha;
}

/** API failure or a history with no usable earlier run safely selects all lanes. */
function previousMainBase(): string | undefined {
  if (process.env['GITHUB_EVENT_NAME'] !== 'push') {
    console.error('changes: non-push run requires all lanes');
    return undefined;
  }
  const repository = process.env['GITHUB_REPOSITORY'];
  const runNumber = Number(process.env['GITHUB_RUN_NUMBER']);
  if (
    !repository ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
    !Number.isSafeInteger(runNumber) ||
    runNumber < 1
  ) {
    console.error('changes: missing or invalid run identity; selecting all lanes');
    return undefined;
  }
  try {
    const base = previousMainRunHead(
      JSON.parse(
        execFileSync(
          'gh',
          ['api', `repos/${repository}/actions/workflows/main.yml/runs?branch=main&per_page=100`],
          { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        ),
      ),
      runNumber,
    );
    if (!base) console.error('changes: no usable earlier main run; selecting all lanes');
    return base;
  } catch {
    console.error('changes: previous main run lookup unavailable; selecting all lanes');
    return undefined;
  }
}

/** Files changed from base to head; absent, equal, missing or nonancestor bases require all lanes. */
export function changedFiles(
  root: string,
  base: string | undefined,
  head: string,
): string[] | null {
  if (!base || base === head) return null;
  try {
    git(root, 'merge-base', '--is-ancestor', base, head);
  } catch {
    return null;
  }
  return git(root, 'diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      root: { type: 'string' },
      'previous-main-run': { type: 'boolean' },
    },
  });
  const root = values.root ?? fileURLToPath(new URL('../..', import.meta.url));
  if (!values.head) throw new Error('--head is required');
  const filters = JSON.parse(
    readFileSync(join(root, 'scripts/ci/path-filters.json'), 'utf8'),
  ) as Filters;
  if (values['previous-main-run'] && values.base !== undefined)
    throw new Error('--previous-main-run and --base are mutually exclusive');
  const base = values['previous-main-run'] ? previousMainBase() : values.base || undefined;
  const files = changedFiles(root, base, values.head);
  const lanes = selectLanes(files, filters);
  console.log(
    JSON.stringify({
      event: 'changes',
      base: files ? base : null,
      head: values.head,
      files: files?.length ?? 'all',
      lanes,
    }),
  );
  // `base` is passed on to lanes that diff themselves (test retention, interop renames): empty without a usable one.
  if (process.env['GITHUB_OUTPUT'])
    appendFileSync(
      process.env['GITHUB_OUTPUT'],
      `lanes=${JSON.stringify(lanes)}\nbase=${files ? base : ''}\nfiles=${JSON.stringify(files)}\n`,
    );
}
