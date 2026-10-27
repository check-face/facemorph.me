import assert from 'node:assert/strict';
import { globSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import {
  inventory,
  onlySuites,
  partitionInventory,
  shardInventory,
  SHARDS,
  tokens,
  workspaceInventory,
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

test('the measured hosting tail moves to shard 4 without disturbing other assignments', () => {
  const suites = inventory();
  const paths = (items) =>
    items.flatMap(({ cwd, files }) => files.map((file) => (cwd ? `${cwd}/${file}` : file)));
  const all = paths(suites);
  const hosted = 'packages/cloudflare-model-host/test/host.test.ts';
  assert.equal(all.filter((file) => file === hosted).length, 1);
  for (const count of [1, 2, 3, SHARDS, SHARDS + 1]) {
    for (let shard = 1; shard <= count; shard++) {
      const expected = all.filter((file, index) => {
        const assigned = count === SHARDS && file === hosted ? 4 : (index % count) + 1;
        return assigned === shard;
      });
      assert.deepEqual(paths(shardInventory(suites, shard, count)), expected);
    }
  }
  assert.ok(paths(shardInventory(suites, 4)).includes(hosted));
  assert.ok(!paths(shardInventory(suites, 6)).includes(hosted));
});

test('contracts reuse the live engine workspace inventory and the same exact inference partition', () => {
  const suites = inventory();
  const selected = workspaceInventory(suites, 'packages/stylegan-js');
  assert.deepEqual(
    selected,
    suites.filter((suite) => suite.cwd === 'packages/stylegan-js'),
  );
  assert.deepEqual(partitionInventory(selected).run, selected);
  const { run, deferred } = partitionInventory(selected, true);
  assert.deepEqual(deferred[0].files, [
    'test/engine/browsers.test.ts',
    'test/engine/caller-loaded-example.test.ts',
    'test/engine/cpu.test.ts',
    'test/engine/encode-browsers.test.ts',
    'test/engine/encode-schedule.test.ts',
    'test/full31/full31.test.ts',
  ]);
  assert.deepEqual([...run[0].files, ...deferred[0].files].sort(), [...selected[0].files].sort());
  for (const cwd of ['', 'packages/missing', '../stylegan-js', undefined])
    assert.throws(() => workspaceInventory(suites, cwd), /known npm-test workspace/);
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

test('check.yml schedules every shard in quick mode; release.yml runs the deferred engine files in full', () => {
  const read = (name) =>
    parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
  const unit = read('check').jobs.unit;
  assert.deepEqual(
    unit.strategy.matrix.shard,
    Array.from({ length: SHARDS }, (_, i) => i + 1),
  );
  assert.equal(unit.strategy['fail-fast'], false);
  assert.ok(
    unit.steps.some(
      (s) =>
        s.run === 'node scripts/ci/scaffold-test-shards.mjs --shard ${{ matrix.shard }} --quick',
    ),
  );
  const engine = read('release').jobs.engine;
  // The step keeps its log for the failure bundle; the suite and full qualification are what matter.
  assert.ok(
    engine.steps.some(
      (s) =>
        s.run?.includes(
          'node scripts/ci/scaffold-test-shards.mjs --workspace packages/stylegan-js',
        ) && s.env?.FACEMORPH_FULL_QUALIFY === '1',
    ),
  );
});

test('quick shards defer only measured inference files; quick plus deferred equals unchanged full inventory', () => {
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
  assert.deepEqual(
    deferred.flatMap(({ cwd, files }) => files.map((file) => `${cwd}/${file}`)).sort(),
    [
      'packages/stylegan-js/test/engine/browsers.test.ts',
      'packages/stylegan-js/test/engine/caller-loaded-example.test.ts',
      'packages/stylegan-js/test/engine/cpu.test.ts',
      'packages/stylegan-js/test/engine/encode-browsers.test.ts',
      'packages/stylegan-js/test/engine/encode-schedule.test.ts',
      'packages/stylegan-js/test/full31/full31.test.ts',
    ],
  );
  assert.deepEqual(paths([...quick, ...deferred]), paths(suites));
  assert.equal(new Set(paths([...quick, ...deferred])).size, paths(suites).length);
  assert.ok(!paths(quick).some((file) => file.includes('full31/full31.test.ts')));
  const ordinaryPaths = quick.flatMap(({ cwd, files }) => files.map((file) => `${cwd}/${file}`));
  for (const file of [
    'test/execution-gate.test.ts',
    'test/engine/canary.test.ts',
    'test/engine/encode.test.ts',
    'test/engine/runtime-input.test.ts',
    'test/morph/latent-path.test.ts',
    'test/morph/render.test.ts',
  ])
    assert.ok(ordinaryPaths.includes(`packages/stylegan-js/${file}`), `${file} stays ordinary`);
});

test('the affected selection keeps whole listed suites, names the root ".", and refuses unknown suites', () => {
  const suites = inventory();
  const picked = onlySuites(suites, ['.', 'packages/cloudflare-model-host']);
  assert.deepEqual(
    picked,
    suites.filter((s) => s.cwd === '' || s.cwd === 'packages/cloudflare-model-host'),
  );
  assert.deepEqual(onlySuites(suites, []), []);
  assert.throws(() => onlySuites(suites, ['packages/model-conv']), /Unknown npm-test suites/);
  assert.throws(() => onlySuites(suites, '.'), /array/);
});
