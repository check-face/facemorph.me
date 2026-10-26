// The merge queue's lane selection (fm-98po): the pure selection on plain file lists against the repository's own
// filters, and the stacked diff in a real temporary Git repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { changedFiles, previousMainRunHead, selectLanes } from './changes.ts';
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
  for (const l of [
    'contracts-m1',
    'app-contracts',
    'next-gpu-lane',
    'next-site',
    'scaffold',
    'mobile-browser',
  ])
    assert.ok(lanes.includes(l), l);
  assert.ok(!lanes.includes('web-shell'));
});

test('bead and documentation changes do not rebuild or retest the application', () => {
  assert.deepEqual(selectLanes(['.beads/issues.jsonl'], FILTERS), []);
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

test('stacked commits: every commit since the previous started run is covered', () => {
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
  const previous = commit('README.md');
  commit('apps/web/a.ts'); // pushed while a run was in progress
  const head = commit('packages/stylegan-js/b.ts'); // the push the pending run was started for
  assert.deepEqual(changedFiles(root, previous, head), [
    'apps/web/a.ts',
    'packages/stylegan-js/b.ts',
  ]);
  const lanes = selectLanes(changedFiles(root, previous, head), FILTERS);
  assert.ok(lanes.includes('web-shell') && lanes.includes('contracts-m1'));
  // No base, an unknown one, or one that is not an ancestor (history rewritten): every lane.
  assert.equal(changedFiles(root, undefined, head), null);
  assert.equal(changedFiles(root, head, head), null);
  assert.equal(changedFiles(root, '0'.repeat(40), head), null);
  git('checkout', '-q', '--orphan', 'other');
  const unrelated = commit('x.md');
  assert.equal(changedFiles(root, unrelated, head), null);
  rmSync(root, { recursive: true });
});

const run = (run_number: number, head_sha: string, extra = {}) => ({
  run_number,
  head_sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...extra,
});

test('previous run includes failed runs, skips superseded pending runs, excludes current/newer runs and ignores API ordering', () => {
  const green = 'a'.repeat(40);
  const failed = 'b'.repeat(40);
  const runs = [
    run(3, 'c'.repeat(40), { conclusion: 'cancelled' }),
    run(1, green),
    run(8, '8'.repeat(40)),
    run(7, '7'.repeat(40)),
    run(2, failed, { conclusion: 'failure' }),
    run(6, '6'.repeat(40), { status: 'pending', conclusion: null }),
    run(5, '5'.repeat(40), { status: 'queued', conclusion: null }),
    run(4, '4'.repeat(40), { conclusion: 'skipped' }),
  ];
  assert.equal(previousMainRunHead({ workflow_runs: runs }, 7), failed);
  assert.equal(
    previousMainRunHead(
      { workflow_runs: [run(2, failed, { status: 'in_progress', conclusion: null })] },
      3,
    ),
    failed,
  );
});

test('a workflow rejected at startup cannot consume untested stacked changes', () => {
  const failed = 'b'.repeat(40);
  assert.equal(
    previousMainRunHead(
      {
        workflow_runs: [
          run(3, 'c'.repeat(40), { conclusion: 'startup_failure' }),
          run(2, failed, { conclusion: 'failure' }),
        ],
      },
      4,
    ),
    failed,
  );
});

test('missing run/event identity, first runs and malformed metadata cannot establish a base', () => {
  const sha = 'a'.repeat(40);
  for (const input of [
    null,
    {},
    { workflow_runs: [] },
    { workflow_runs: [run(0, sha)] },
    { workflow_runs: [run(1, sha, { event: undefined })] },
    { workflow_runs: [run(1, sha, { head_branch: 'other' })] },
    { workflow_runs: [run(1, sha, { head_sha: 'HEAD' })] },
    { workflow_runs: [run(1, sha, { run_number: undefined })] },
    { workflow_runs: [run(1, sha, { event: 'pull_request' })] },
  ])
    assert.equal(previousMainRunHead(input, 2), undefined);
  assert.equal(previousMainRunHead({ workflow_runs: [run(1, sha)] }, 1), undefined);
  for (const number of [0, -1, NaN, Infinity])
    assert.equal(previousMainRunHead({ workflow_runs: [run(1, sha)] }, number), undefined);
});

function cliFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-previous-run-'));
  t.after(() => rmSync(root, { recursive: true }));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const commit = (path: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path);
    git('add', path);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', path);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const green = commit('README.md');
  const failed = commit('services/stats/previously-tested.ts');
  const superseded = commit('apps/web/stacked.ts');
  const head = commit('packages/stylegan-js/current.ts');
  mkdirSync(join(root, 'scripts/ci'), { recursive: true });
  writeFileSync(join(root, 'scripts/ci/path-filters.json'), JSON.stringify(FILTERS));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    `#!${process.execPath}\nconst fs = require('node:fs');
if (process.argv.slice(2).join(' ') !== 'api repos/owner/repo/actions/workflows/main.yml/runs?branch=main&per_page=100') process.exit(2);
process.stdout.write(fs.readFileSync(process.env.RUN_FIXTURE));\n`,
  );
  chmodSync(gh, 0o755);
  const metadata = join(root, 'runs.json');
  const output = join(root, 'github-output');
  const invoke = (runs: unknown, env: Record<string, string> = {}) => {
    writeFileSync(metadata, typeof runs === 'string' ? runs : JSON.stringify(runs));
    writeFileSync(output, '');
    const stdout = execFileSync(
      process.execPath,
      [join(REPO, 'scripts/ci/changes.ts'), '--previous-main-run', '--head', head, '--root', root],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH']}`,
          RUN_FIXTURE: metadata,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_RUN_NUMBER: '5',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_OUTPUT: output,
          ...env,
        },
      },
    );
    return { result: JSON.parse(stdout), output: readFileSync(output, 'utf8') };
  };
  return { root, git, green, failed, superseded, head, invoke };
}

test('CLI diffs from previous failed run, keeps superseded stacked changes and avoids reselecting ancient green changes', (t) => {
  const f = cliFixture(t);
  const { result, output } = f.invoke({
    workflow_runs: [
      run(5, f.head),
      run(4, f.superseded, { conclusion: 'cancelled' }),
      run(3, f.failed, { conclusion: 'failure' }),
      run(1, f.green),
    ],
  });
  assert.equal(result.base, f.failed);
  assert.equal(result.files, 2);
  assert.deepEqual(changedFiles(f.root, result.base, f.head), [
    'apps/web/stacked.ts',
    'packages/stylegan-js/current.ts',
  ]);
  assert.ok(result.lanes.includes('web-shell') && result.lanes.includes('contracts-m1'));
  assert.ok(!result.lanes.includes('stats-worker'));
  assert.ok(selectLanes(changedFiles(f.root, f.green, f.head), FILTERS).includes('stats-worker'));
  assert.ok(output.endsWith(`base=${f.failed}\n`));
});

test('CLI uses all lanes on first run, equal head, rewritten history, missing identity or API failure', (t) => {
  const f = cliFixture(t);
  f.git('checkout', '-q', '--orphan', 'rewritten');
  f.git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'new root');
  const unrelated = f.git('rev-parse', 'HEAD');
  for (const [runs, env] of [
    [{ workflow_runs: [] }, {}],
    [{ workflow_runs: [run(4, f.head)] }, {}],
    [{ workflow_runs: [run(4, unrelated)] }, {}],
    ['invalid JSON response', {}],
    [{ workflow_runs: [run(4, f.failed)] }, { GITHUB_REPOSITORY: 'owner/other' }],
    [{ workflow_runs: [run(4, f.failed)] }, { GITHUB_RUN_NUMBER: '' }],
    [{ workflow_runs: [run(4, f.failed)] }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
  ] as [unknown, Record<string, string>][]) {
    const { result, output } = f.invoke(runs, env);
    assert.equal(result.base, null);
    assert.equal(result.files, 'all');
    assert.deepEqual(result.lanes, ALL);
    assert.ok(output.endsWith('base=\n'));
  }
});
