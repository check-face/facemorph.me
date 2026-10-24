#!/usr/bin/env node
// Which CI lanes a main.yml run calls (fm-98po, the merge queue): main has one run at a time and the next run
// takes every change pushed since, stacked. The diff runs from the head of the last successful main.yml run, not
// the previous commit, so a change in a run that failed, or in a stacked push, is still covered. Each lane's paths
// are its declaration in scripts/ci/path-filters.json: its shared narrowing, its extras, its own workflow file and
// the shared actions. A lane marked `always` runs on any change outside its `ignore` list. A change to the pipeline
// itself (main.yml, this script, the filters) runs every lane, as does a run with no usable base.
//   node scripts/ci/changes.ts --head <sha> [--base <sha>]     one JSON line; appends lanes=<json> to $GITHUB_OUTPUT
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

/** Files changed from base to head, or null when the base is absent or not an ancestor of head. */
export function changedFiles(
  root: string,
  base: string | undefined,
  head: string,
): string[] | null {
  if (!base) return null;
  try {
    git(root, 'merge-base', '--is-ancestor', base, head);
  } catch {
    return null;
  }
  return git(root, 'diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { base: { type: 'string' }, head: { type: 'string' }, root: { type: 'string' } },
  });
  const root = values.root ?? fileURLToPath(new URL('../..', import.meta.url));
  if (!values.head) throw new Error('--head is required');
  const filters = JSON.parse(
    readFileSync(join(root, 'scripts/ci/path-filters.json'), 'utf8'),
  ) as Filters;
  const files = changedFiles(root, values.base || undefined, values.head);
  const lanes = selectLanes(files, filters);
  console.log(
    JSON.stringify({
      event: 'changes',
      base: values.base || null,
      head: values.head,
      files: files?.length ?? 'all',
      lanes,
    }),
  );
  // `base` is passed on to lanes that diff themselves (test retention, interop renames): empty without a usable one.
  if (process.env['GITHUB_OUTPUT'])
    appendFileSync(
      process.env['GITHUB_OUTPUT'],
      `lanes=${JSON.stringify(lanes)}\nbase=${files ? values.base : ''}\n`,
    );
}
