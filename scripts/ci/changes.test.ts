// The merge queue's lane selection (fm-98po): the pure selection on plain file lists against the repository's own
// filters, and the stacked diff in a real temporary Git repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { changedFiles, selectLanes } from './changes.ts';
import type { Filters } from './path-filters.ts';

const REPO = new URL('../..', import.meta.url).pathname;
const FILTERS = JSON.parse(
  readFileSync(join(REPO, 'scripts/ci/path-filters.json'), 'utf8'),
) as Filters;
const ALL = Object.keys(FILTERS.lanes).sort();

test('apps/web only: the web lanes and the always lanes, none of the unrelated ones', () => {
  const lanes = selectLanes(['apps/web/src/Next/media.mjs'], FILTERS);
  for (const l of [
    'web-shell',
    'next-site',
    'import-closure',
    'scaffold',
    'build-identity',
    'app-contracts',
  ])
    assert.ok(lanes.includes(l), l);
  for (const l of [
    'beads-site',
    'beads-check',
    'names-spike',
    'stats-worker',
    'model-conv',
    'research-ledger',
  ])
    assert.ok(!lanes.includes(l), l);
});

test('packages/stylegan-js: its lanes run', () => {
  const lanes = selectLanes(['packages/stylegan-js/src/index.ts'], FILTERS);
  for (const l of ['contracts-m1', 'app-contracts', 'next-gpu-lane', 'next-site', 'scaffold'])
    assert.ok(lanes.includes(l), l);
  assert.ok(!lanes.includes('web-shell'));
});

test('bead and documentation changes do not rebuild or retest the application', () => {
  assert.deepEqual(selectLanes(['.beads/issues.jsonl'], FILTERS), ['beads-check', 'beads-site']);
  assert.deepEqual(
    selectLanes(['README.md', 'AGENTS.md', 'ops/swarm/implementer.md'], FILTERS),
    [],
  );
});

test('a dot-file under a glob is matched as GitHub matches it', () => {
  assert.ok(selectLanes(['apps/web/.gitignore'], FILTERS).includes('web-shell'));
});

test('no usable base, or a change to the pipeline itself, selects every lane', () => {
  assert.deepEqual(selectLanes(null, FILTERS), ALL);
  for (const f of [
    '.github/workflows/main.yml',
    'scripts/ci/path-filters.json',
    'scripts/ci/changes.ts',
    'scripts/ci/workspace-cache.sh',
  ])
    assert.deepEqual(selectLanes([f], FILTERS), ALL, f);
  assert.deepEqual(selectLanes([], FILTERS), []);
});

test('stacked commits: the diff runs from the last green head, so every commit since is covered', () => {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-changes-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const commit = (path: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path);
    git('add', path);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', path);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const green = commit('README.md');
  commit('apps/web/a.ts'); // pushed while a run was in progress
  const head = commit('packages/stylegan-js/b.ts'); // the push the pending run was started for
  assert.deepEqual(changedFiles(root, green, head), ['apps/web/a.ts', 'packages/stylegan-js/b.ts']);
  const lanes = selectLanes(changedFiles(root, green, head), FILTERS);
  assert.ok(lanes.includes('web-shell') && lanes.includes('contracts-m1'));
  // No base, an unknown one, or one that is not an ancestor (history rewritten): every lane.
  assert.equal(changedFiles(root, undefined, head), null);
  assert.equal(changedFiles(root, '0'.repeat(40), head), null);
  git('checkout', '-q', '--orphan', 'other');
  const unrelated = commit('x.md');
  assert.equal(changedFiles(root, unrelated, head), null);
  rmSync(root, { recursive: true });
});
