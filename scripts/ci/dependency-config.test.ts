import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { policyProblems, type DependencyPolicy } from './dependency-freeze.ts';
import { ORT_MIRROR_GROUP } from './dependency-controller.ts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const config = parse(read('.github/dependabot.yml'));
const policy = JSON.parse(read('scripts/ci/dependency-policy.json')) as DependencyPolicy;
const main = parse(read('.github/workflows/main.yml'));
const npm = config.updates.find((update: any) => update['package-ecosystem'] === 'npm');

test('the built-in updater has exactly four npm groups, each matching the frozen required-check policy', () => {
  assert.equal(config.version, 2);
  assert.equal(policy.updater, 'dependabot');
  assert.ok(policy.reason.length > 0);
  assert.deepEqual(policyProblems(policy), []);
  assert.deepEqual(Object.keys(npm.groups).sort(), Object.keys(policy.groups).sort());
  for (const [name, group] of Object.entries(policy.groups)) {
    assert.deepEqual(npm.groups[name].patterns, group.patterns);
    assert.deepEqual(npm.groups[name]['exclude-patterns'] ?? [], group.excludePatterns ?? []);
  }
  assert.deepEqual(npm['exclude-paths'], policy.excludedPaths);
  assert.equal(npm['versioning-strategy'], 'increase');
  assert.deepEqual(npm.groups[ORT_MIRROR_GROUP].patterns, ['onnxruntime-web']);
});

test('each declared external npm dependency belongs to one group, including the paired ORT package', () => {
  const paths = [
    'package.json',
    'apps/web/package.json',
    'packages/stylegan-js/package.json',
    'packages/browser-model-manager/package.json',
    'packages/cloudflare-model-host/package.json',
    'packages/model-conv/package.json',
  ];
  for (const path of paths) {
    const manifest = JSON.parse(read(path));
    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (dependency.startsWith('@facemorph/')) continue;
        const groups = Object.entries(policy.groups)
          .filter(
            ([, group]) =>
              group.patterns.some(
                (pattern) => pattern === '*' || matchesGlob(dependency, pattern),
              ) && !group.excludePatterns?.some((pattern) => matchesGlob(dependency, pattern)),
          )
          .map(([name]) => name);
        assert.equal(groups.length, 1, `${path}: ${dependency}: ${groups}`);
        if (dependency === 'onnxruntime-web') assert.deepEqual(groups, ['onnx-runtime']);
      }
    }
  }
});

test('browser-harness has a source requirement and separately updated qualified lock in test-tools', () => {
  const pip = config.updates.find((update: any) => update['package-ecosystem'] === 'pip');
  assert.equal(pip.directory, '/tools/browser-harness');
  assert.deepEqual(Object.keys(pip.groups), ['test-tools']);
  assert.deepEqual(pip.groups['test-tools'].patterns, ['browser-harness']);
  assert.match(read('tools/browser-harness/requirements.in'), /^browser-harness>=\d+\.\d+\.\d+$/m);
  assert.match(read('tools/browser-harness/requirements.txt'), /^browser-harness==\d+\.\d+\.\d+$/m);
  assert.match(
    read('.github/actions/setup-browser-harness/action.yml'),
    /Path\('tools\/browser-harness\/requirements.txt'\)/,
  );
});

test('dependency qualification retains main serialization and exact candidate provenance for all five cells', () => {
  assert.equal(main.concurrency.group, 'main');
  assert.equal(main.concurrency['cancel-in-progress'], false);
  const matrix = parse(read('.github/workflows/next-matrix.yml')).jobs.engines.strategy.matrix
    .include;
  assert.equal(matrix.length, 5);
  for (const cell of matrix) {
    const context = `next-matrix / ${cell.os} ${cell.engine} (${cell.label})`;
    assert.ok(policy.groups['test-tools']!.requiredChecks.includes(context), context);
  }
  const call = main.jobs['next-matrix'];
  assert.equal(call.uses, './.github/workflows/next-matrix.yml');
  assert.equal(call.with.artifact_commit, '${{ github.sha }}');
  assert.equal(call.with.artifact_run, '${{ github.run_id }}');
  assert.equal(call.with.artifact_workflow, '.github/workflows/main.yml');
  assert.match(main.jobs['dependency-policy'].name, /dependency-currency/);
  assert.match(main.jobs['next-deploy'].if, /github.event_name == 'push'/);
});
