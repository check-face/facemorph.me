import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventory, partitionInventory, shardInventory, SHARDS } from './scaffold-test-shards.mjs';
import { scopeInventory } from './scaffold-scopes.mjs';

const suites = Object.freeze(
  [
    { cwd: 'apps/web', prefix: ['node', '--test'], files: ['test/build/survival.test.ts'] },
    {
      cwd: 'packages/stylegan-js',
      prefix: ['node', '--test'],
      files: ['test/engine/blend.test.ts'],
    },
    {
      cwd: 'packages/browser-model-manager',
      prefix: ['node', 'test/run.mjs'],
      files: ['test/slots.test.ts'],
    },
    {
      cwd: 'packages/cloudflare-model-host',
      prefix: ['node', '--test'],
      files: ['test/stage.test.ts'],
    },
    { cwd: '', prefix: ['node', '--test'], files: ['scripts/ci/path-filters.test.ts'] },
    { cwd: '', prefix: ['python3'], files: ['autoresearch/test_run.py'] },
  ].map((suite) =>
    Object.freeze({
      ...suite,
      prefix: Object.freeze(suite.prefix),
      files: Object.freeze(suite.files),
    }),
  ),
);
const identities = (items) =>
  items
    .flatMap(({ cwd, prefix, files }) => files.map((file) => JSON.stringify([cwd, prefix, file])))
    .sort();

test('only the exact audited scripts and workflow paths defer the three package suites', () => {
  for (const path of [
    '.github/workflows/main.yml',
    '.github/workflows/new-workflow.yml',
    'scripts/ci/changes.ts',
    'scripts/ci/changes.test.ts',
    'scripts/ci/path-filters.ts',
    'scripts/ci/path-filters.json',
    'scripts/ci/path-filters.test.ts',
    'scripts/ci/pre-deploy.ts',
    'scripts/ci/pre-deploy.test.ts',
    'scripts/ci/workspace-build.mjs',
    'scripts/ci/workspace-build.test.mjs',
    'scripts/ci/scaffold-test-shards.mjs',
    'scripts/ci/scaffold-test-shards.test.mjs',
    'scripts/ci/scaffold-scopes.mjs',
    'scripts/ci/scaffold-scopes.test.mjs',
    'scripts/ci/shared-build.test.ts',
  ]) {
    const { run, deferred } = scopeInventory(suites, [path]);
    assert.deepEqual(
      run.map((suite) => suite.cwd),
      ['apps/web', '', ''],
      path,
    );
    assert.deepEqual(
      deferred.map((suite) => suite.cwd),
      ['packages/stylegan-js', 'packages/browser-model-manager', 'packages/cloudflare-model-host'],
      path,
    );
  }
});

test('scoped run plus deferred preserves every live npm-test file and original runner exactly once', () => {
  const live = inventory();
  const scoped = scopeInventory(live, ['.github/workflows/scaffold.yml', 'scripts/ci/changes.ts']);
  assert.ok(scoped.run.length > 0);
  assert.ok(scoped.deferred.length > 0);
  assert.deepEqual(identities([...scoped.run, ...scoped.deferred]), identities(live));
  assert.equal(
    new Set(identities([...scoped.run, ...scoped.deferred])).size,
    identities(live).length,
  );
  assert.ok(scoped.run.some((suite) => suite.cwd === 'apps/web'));
  assert.ok(scoped.run.some((suite) => suite.prefix[0] === 'python3'));
  assert.ok(scoped.deferred.some((suite) => suite.prefix[1] === 'test/run.mjs'));
  const sharded = Array.from({ length: SHARDS }, (_, index) =>
    shardInventory(scoped.run, index + 1),
  ).flat();
  const quick = partitionInventory(sharded, true);
  assert.deepEqual(
    identities([...quick.run, ...quick.deferred, ...scoped.deferred]),
    identities(live),
  );
});

test('absent, unknown and empty history retain the full inventory', () => {
  for (const files of [null, undefined, [], ['unknown/file.ts']]) {
    const result = scopeInventory(suites, files);
    assert.equal(result.run, suites);
    assert.deepEqual(result.deferred, []);
  }
});

test('mixed changes and all runtime, interception, source or configuration paths retain everything', () => {
  for (const path of [
    'apps/web/src/controller/model.ts',
    'apps/web/src/public/README.md',
    'packages/stylegan-js/src/engine/synthesis.ts',
    'packages/browser-model-manager/schema/manifest.json',
    'scripts/ci/intercept/playwright.ts',
    'scripts/ci/intercept/record.ts',
    'scripts/ci/ort-mirror.ts',
    'scripts/ci/candidate-runtime.ts',
    'scripts/runtime/acquire.mjs',
    'scripts/ci/workspace-cache.sh',
    'scripts/ci/run-lanes.ts',
    '.github/actions/restore-workspace-build/action.yml',
    '.github/actions/setup-runtime/action.yml',
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    '.oxlintrc.json',
    'packages/stylegan-js/README.md',
    'docs/dev/build-next.md',
    '.beads/issues.jsonl',
    '.github/workflows/nested/workflow.yml',
    '.github/workflows/workflow.yaml',
    'scripts/ci/changes-extra.ts',
    'scripts/ci/future-helper.test.ts',
  ]) {
    for (const files of [[path], ['.github/workflows/scaffold.yml', path]]) {
      const result = scopeInventory(suites, files);
      assert.equal(result.run, suites, path);
      assert.deepEqual(result.deferred, [], path);
    }
  }
});

test('malformed lists and non-relative or non-canonical paths are rejected instead of narrowed', () => {
  for (const files of [
    '',
    'all',
    {},
    4,
    true,
    Array(1),
    [''],
    [null],
    [undefined],
    [42],
    [{}],
    ['/scripts/ci/changes.ts'],
    ['../scripts/ci/changes.ts'],
    ['./scripts/ci/changes.ts'],
    ['a/../scripts/ci/changes.ts'],
    ['scripts//ci/changes.ts'],
    ['scripts/ci/changes.ts/'],
    ['C:/scripts/ci/changes.ts'],
    ['C:\\scripts\\ci\\changes.ts'],
    ['scripts/ci/changes.ts\n'],
    ['scripts/ci/changes.ts\0'],
  ])
    assert.throws(() => scopeInventory(suites, files), /repository-relative paths/);
});

test('a future or unknown workspace retains all suites until its dependencies are audited', () => {
  for (const cwd of ['packages/new-package', 'packages/model-conv', 'services/stats', '.']) {
    const expanded = [...suites, { cwd, prefix: ['node', '--test'], files: ['test.test.ts'] }];
    const result = scopeInventory(expanded, ['.github/workflows/main.yml']);
    assert.equal(result.run, expanded);
    assert.deepEqual(result.deferred, []);
  }
});

test('scoping preserves original suite objects, file arrays, runner arguments and order', () => {
  const { run, deferred } = scopeInventory(suites, ['scripts/ci/workspace-build.mjs']);
  for (const group of [run, deferred]) {
    let previous = -1;
    for (const suite of group) {
      const index = suites.indexOf(suite);
      assert.ok(index > previous);
      assert.equal(suite.files, suites[index].files);
      assert.equal(suite.prefix, suites[index].prefix);
      previous = index;
    }
  }
});
