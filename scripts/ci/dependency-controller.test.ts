import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  dependencyGroup,
  mirrorLockEntry,
  qualificationProblems,
  type DependencyPullRequest,
  type QualificationRun,
} from './dependency-controller.ts';
import type { DependencyPolicy } from './dependency-freeze.ts';

const policy = JSON.parse(
  readFileSync(new URL('./dependency-policy.json', import.meta.url), 'utf8'),
) as DependencyPolicy;
const sha = 'a'.repeat(40);
const pull = (): DependencyPullRequest => ({
  number: 12,
  state: 'open',
  user: { login: 'dependabot[bot]' },
  base: { ref: 'main', sha: 'b'.repeat(40), repo: { id: 123 } },
  head: { ref: 'dependabot/npm_and_yarn/build-tools-123', sha, repo: { id: 123 } },
});
const run = (): QualificationRun => ({
  id: 42,
  event: 'workflow_dispatch',
  path: '.github/workflows/main.yml',
  head_sha: sha,
  head_branch: pull().head.ref,
  status: 'completed',
  conclusion: 'success',
  repository: { id: 123 },
});
const files = ['package.json', 'package-lock.json'];
const jobs = () =>
  ['dependency-currency', ...policy.groups['build-tools']!.requiredChecks].map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
  }));

test('a native grouped bot PR with exact branch qualification is eligible', () => {
  assert.equal(dependencyGroup(pull(), files), 'build-tools');
  assert.deepEqual(qualificationProblems(run(), jobs(), pull(), files, policy), []);
});

test('all four npm groups and the pip test-tools group are recognized', () => {
  for (const group of Object.keys(policy.groups)) {
    const pr = pull();
    pr.head.ref = `dependabot/npm_and_yarn/${group}-hash`;
    assert.equal(dependencyGroup(pr, files), group);
  }
  const pr = pull();
  pr.head.ref = 'dependabot/pip/tools/browser-harness/test-tools-hash';
  assert.equal(dependencyGroup(pr, ['tools/browser-harness/requirements.txt']), 'test-tools');
});

test('foreign authors, forks, closed PRs, wrong bases and ungrouped branches are refused', () => {
  for (const mutate of [
    (pr: DependencyPullRequest) => {
      pr.user.login = 'ordinary-user';
    },
    (pr: DependencyPullRequest) => {
      pr.head.repo.id++;
    },
    (pr: DependencyPullRequest) => {
      pr.state = 'closed';
    },
    (pr: DependencyPullRequest) => {
      pr.base.ref = 'candidate/old';
    },
    (pr: DependencyPullRequest) => {
      pr.head.ref = 'dependabot/npm_and_yarn/react-19';
    },
  ]) {
    const pr = pull();
    mutate(pr);
    assert.throws(() => dependencyGroup(pr, files));
  }
});

test('a synthetic tolerance widening, removed workflow or source edit is refused before dispatch', () => {
  for (const path of [
    'packages/stylegan-js/src/contracts/numerics.ts',
    '.github/workflows/next-matrix.yml',
    'apps/web/src/Next/browser/runtime.mjs',
    '../package.json',
    'classic/package.json',
  ])
    assert.throws(() => dependencyGroup(pull(), [...files, path]), /only dependency manifests/);
  assert.throws(() => dependencyGroup(pull(), []));
});

test('stale commits, wrong branches/repositories and ordinary PR merge artifacts cannot qualify', () => {
  for (const mutate of [
    (r: QualificationRun) => {
      r.head_sha = 'c'.repeat(40);
    },
    (r: QualificationRun) => {
      r.head_branch = 'main';
    },
    (r: QualificationRun) => {
      r.repository.id++;
    },
    (r: QualificationRun) => {
      r.event = 'pull_request';
    },
    (r: QualificationRun) => {
      r.path = '.github/workflows/other.yml';
    },
  ]) {
    const value = run();
    mutate(value);
    assert.ok(qualificationProblems(value, jobs(), pull(), files, policy).length);
  }
});

test('any missing, skipped, failed, incomplete or duplicate required check prevents merge', () => {
  const required = jobs();
  for (const conclusion of ['skipped', 'failure', 'cancelled', null]) {
    const altered = jobs();
    altered[1]!.conclusion = conclusion as string;
    assert.ok(qualificationProblems(run(), altered, pull(), files, policy).length);
  }
  assert.ok(qualificationProblems(run(), required.slice(1), pull(), files, policy).length);
  assert.ok(
    qualificationProblems(run(), [...required, required[1]!], pull(), files, policy).length,
  );
  const incomplete = jobs();
  incomplete[1]!.status = 'in_progress';
  assert.ok(qualificationProblems(run(), incomplete, pull(), files, policy).length);
  const failed = run();
  failed.conclusion = 'failure';
  assert.ok(qualificationProblems(failed, jobs(), pull(), files, policy).length);
});

test('an ordinary main dispatch with only the freeze job cannot pass dependency currency', () => {
  const ordinary = jobs();
  ordinary[0]!.name = 'dependency-policy';
  assert.ok(
    qualificationProblems(run(), ordinary, pull(), files, policy).some((p) =>
      p.includes('dependency-currency'),
    ),
  );
});

test('ORT enrichment accepts only a consistent stable npm registry lock, before fetching anything', () => {
  const lock = JSON.parse(
    readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'),
  );
  const source = mirrorLockEntry(lock);
  assert.equal(
    source.resolved,
    `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${source.version}.tgz`,
  );
  for (const change of [
    { resolved: 'https://example.test/ort.tgz' },
    { version: source.version + '-dev' },
    { integrity: 'sha512-bad' },
  ]) {
    const modified = structuredClone(lock);
    Object.assign(modified.packages['node_modules/onnxruntime-web'], change);
    assert.throws(() => mirrorLockEntry(modified));
  }
  const conflicting = structuredClone(lock);
  conflicting.packages['nested/node_modules/onnxruntime-web'] = { ...source, version: '1.0.0' };
  assert.throws(() => mirrorLockEntry(conflicting), /consistent locked ORT/);
});

test('controller executes only trusted default-branch source and uses an atomic exact-head merge', () => {
  const source = readFileSync(new URL('./dependency-controller.ts', import.meta.url), 'utf8');
  const workflow = readFileSync(
    new URL('../../.github/workflows/dependency-currency.yml', import.meta.url),
    'utf8',
  );
  assert.match(source, /'--match-head-commit',\s*pr\.head\.sha/);
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request.head.sha|npm (?:ci|install)/);
});
