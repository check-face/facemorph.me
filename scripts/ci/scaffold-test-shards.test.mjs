import assert from 'node:assert/strict';
import { globSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import {
  inventory,
  partitionInventory,
  shardInventory,
  SHARDS,
  tokens,
} from './scaffold-test-shards.mjs';
import { testGlobs } from '../build/check-tests-listed.mjs';

test('every live npm-test file runs exactly once across all scaffold shards, with its original runner', () => {
  const suites = inventory();
  // Compare with the existing npm-test discovery judge as an independent coverage oracle.
  const root = new URL('../../', import.meta.url);
  const top = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const expectedFiles = ['', ...top.workspaces]
    .flatMap((cwd) => {
      const pkg = JSON.parse(
        readFileSync(new URL(`${cwd ? `${cwd}/` : ''}package.json`, root), 'utf8'),
      );
      return testGlobs(cwd, pkg.scripts?.test).flatMap((pattern) =>
        globSync(pattern, { cwd: root }),
      );
    })
    .sort();
  assert.deepEqual(
    suites.flatMap(({ cwd, files }) => files.map((file) => (cwd ? `${cwd}/${file}` : file))).sort(),
    expectedFiles,
  );
  const identities = (items) =>
    items.flatMap(({ cwd, prefix, files }) =>
      files.map((file) => JSON.stringify([cwd, prefix, file])),
    );
  const expected = identities(suites).sort();
  const actual = Array.from({ length: SHARDS }, (_, i) => identities(shardInventory(suites, i + 1)))
    .flat()
    .sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.ok(suites.some(({ prefix }) => prefix[1] === 'test/run.mjs'));
  assert.equal(suites.filter(({ prefix }) => prefix[0] === 'python3').length, 3);
  for (let shard = 1; shard <= SHARDS; shard++) assert.ok(shardInventory(suites, shard).length);
});

test('sharding rejects invalid indices instead of silently running no tests', () => {
  for (const index of [0, -1, 1.5, SHARDS + 1, NaN])
    assert.throws(() => shardInventory([], index), /integer shard/);
});

test('the adapter refuses shell operations and preserves quoted globs', () => {
  assert.deepEqual(tokens("node --test 'scripts/ci/**/*.test.mjs'"), [
    'node',
    '--test',
    'scripts/ci/**/*.test.mjs',
  ]);
  for (const command of ['node x; true', 'ENV=1 node x | cat', 'node "$(echo x)"'])
    assert.throws(() => tokens(command), /Unsupported/);
});

test('changed npm-test runners, hooks and empty globs require an explicit adapter update', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-shards-'));
  try {
    mkdirSync(join(root, 'workspace'));
    const top = {
      workspaces: ['workspace'],
      scripts: { test: 'npm test --workspaces --if-present' },
    };
    writeFileSync(join(root, 'package.json'), JSON.stringify(top));
    const workspace = (scripts) =>
      writeFileSync(join(root, 'workspace/package.json'), JSON.stringify({ scripts }));
    workspace({ test: 'vitest run' });
    assert.throws(() => inventory(root), /Unadapted npm test command/);
    workspace({ test: 'node --test absent/*.test.ts' });
    assert.throws(() => inventory(root), /Empty npm test pattern/);
    workspace({ test: 'node --test *.test.ts', pretest: 'echo preparation' });
    assert.throws(() => inventory(root), /Unadapted workspace pretest/);
    workspace({});
    top.scripts.test = 'npm test --workspaces';
    writeFileSync(join(root, 'package.json'), JSON.stringify(top));
    assert.throws(() => inventory(root), /Unadapted root workspace/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('the workflow schedules every shard and keeps network isolation on the real wrapper', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/scaffold.yml', import.meta.url), 'utf8'),
  );
  const job = workflow.jobs.tests;
  assert.deepEqual(
    job.strategy.matrix.shard,
    Array.from({ length: SHARDS }, (_, i) => i + 1),
  );
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job.env.FACEMORPH_ISOLATE_TEST_NETWORK, '1');
  const run = job.steps.find((step) => step.run?.includes('scaffold-test-shards.mjs'));
  assert.match(run.run, /args=\(--shard "\$SHARD"\)/);
  assert.match(run.run, /if \[ "\$FULL" != true \]; then args\+=\(--quick\); fi/);
  assert.match(run.run, /node scripts\/ci\/scaffold-test-shards\.mjs "\$\{args\[@\]\}"/);
  assert.equal(run.env.FULL, "${{ github.event_name == 'workflow_dispatch' || inputs.full }}");
  assert.equal(workflow.on.workflow_call.inputs.full.default, true);
  assert.equal(run.env.SHARD, '${{ matrix.shard }}');
});

test('the required scaffold/gates context aggregates every matrix and refuses failed or skipped dependencies', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/scaffold.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(workflow.jobs.gates.needs, ['checks', 'tests']);
  assert.equal(workflow.jobs.gates.if, 'always()');
  const step = workflow.jobs.gates.steps[0];
  assert.deepEqual(step.env, {
    CHECKS: '${{ needs.checks.result }}',
    TESTS: '${{ needs.tests.result }}',
  });
  assert.equal(step.run, 'test "$CHECKS" = success && test "$TESTS" = success');
  assert.equal(workflow.on.workflow_call.inputs.shared_build.default, false);
  const restore = workflow.jobs.tests.steps.find((s) =>
    s.uses?.endsWith('/restore-workspace-build'),
  );
  assert.equal(restore.if, 'inputs.shared_build');
  assert.equal(
    workflow.jobs.tests.steps.find((s) => s.run === 'npm run build').if,
    '!inputs.shared_build',
  );
});

test('quick shards defer only the exact full31 file; quick plus deferred equals the unchanged full inventory', () => {
  const suites = inventory();
  const paths = (items) =>
    items
      .flatMap(({ cwd, prefix, files }) => files.map((file) => JSON.stringify([cwd, prefix, file])))
      .sort();
  const full = partitionInventory(suites);
  assert.deepEqual(full.run, suites);
  assert.deepEqual(full.deferred, []);
  const quick = [],
    deferred = [];
  for (let shard = 1; shard <= SHARDS; shard++) {
    const part = partitionInventory(shardInventory(suites, shard), true);
    quick.push(...part.run);
    deferred.push(...part.deferred);
  }
  assert.deepEqual(deferred, [
    {
      cwd: 'packages/stylegan-js',
      prefix: ['node', '--test'],
      files: ['test/full31/full31.test.ts'],
    },
  ]);
  assert.deepEqual(paths([...quick, ...deferred]), paths(suites));
  assert.equal(new Set(paths([...quick, ...deferred])).size, paths(suites).length);
  assert.ok(!paths(quick).some((file) => file.includes('full31/full31.test.ts')));
});
