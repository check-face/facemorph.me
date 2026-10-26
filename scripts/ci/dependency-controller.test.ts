import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  activeDependencyQualification,
  dependencyGroup,
  mirrorLockEntry,
  qualificationAttempted,
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

test('a queued or running dependency group preserves the single main pending slot', () => {
  for (const status of ['pending', 'queued', 'in_progress', 'waiting', 'requested']) {
    const active = { ...run(), status, conclusion: null };
    assert.equal(activeDependencyQualification([run(), active]), active);
  }
  assert.equal(activeDependencyQualification([run()]), undefined);
  assert.equal(
    activeDependencyQualification([{ ...run(), status: 'pending', head_branch: 'main' }]),
    undefined,
  );
  assert.equal(
    activeDependencyQualification([{ ...run(), status: 'pending', event: 'push' }]),
    undefined,
  );
});

test('queue-cancelled heads retry, but failed gates and completed qualifications do not loop', () => {
  const cancelled = { ...run(), conclusion: 'cancelled' };
  assert.equal(qualificationAttempted([cancelled], sha), false);
  assert.equal(activeDependencyQualification([cancelled]), undefined);
  for (const conclusion of ['success', 'failure', 'timed_out', 'action_required']) {
    assert.equal(qualificationAttempted([{ ...run(), conclusion }], sha), true);
  }
  assert.equal(qualificationAttempted([run()], 'c'.repeat(40)), false);
  assert.equal(qualificationAttempted([cancelled, run()], sha), true);
});

for (const outcome of ['cancelled', 'success', 'active', 'stale-base'] as const)
  test(`dispatch CLI reconciles ${outcome} without replacing another group`, (t) => {
    const scratch = mkdtempSync(join(tmpdir(), 'dependency-controller-queue-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const event = join(scratch, 'event.json');
    const calls = join(scratch, 'calls.jsonl');
    writeFileSync(event, '{}');
    const first = pull();
    const second = structuredClone(first);
    second.number++;
    second.head.ref = 'dependabot/npm_and_yarn/react-and-ui-hash';
    second.head.sha = 'c'.repeat(40);
    writeFileSync(
      join(scratch, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), endpoint = args[3];
fs.appendFileSync(process.env.PROBE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
const prs = ${JSON.stringify(outcome === 'stale-base' ? [first] : [first, second])};
let value;
if (endpoint.endsWith('/pulls?state=open&base=main&per_page=100')) value = prs;
else if (endpoint.endsWith('/git/ref/heads/main')) value = {object:{sha:${JSON.stringify(outcome === 'stale-base' ? 'd'.repeat(40) : first.base.sha)}}};
else if (endpoint.endsWith('/runs?event=workflow_dispatch&per_page=100'))
  value = {workflow_runs:${JSON.stringify(outcome === 'active' ? [{ ...run(), status: 'pending', conclusion: null }] : [])}};
else if (endpoint.includes('/files?')) value = [{filename:'package.json'}];
else if (endpoint.includes('/compare/')) value = {merge_base_commit:{sha:prs[0].base.sha}};
else if (endpoint.includes('/runs?event=workflow_dispatch&branch='))
  value = {workflow_runs:[${JSON.stringify({ ...run(), conclusion: outcome === 'cancelled' ? 'cancelled' : 'success' })}]};
else if (endpoint.endsWith('/jobs?per_page=100&page=1')) value = {jobs:${JSON.stringify(jobs())}};
else if (endpoint.endsWith('/dispatches') || endpoint.endsWith('/update-branch')) {
  fs.readFileSync(0, 'utf8');
} else value = prs.find(pr => endpoint.endsWith('/pulls/' + pr.number));
if (value !== undefined) process.stdout.write(JSON.stringify(value));
else if (!endpoint.endsWith('/dispatches') && !endpoint.endsWith('/update-branch')) throw Error('unexpected API: ' + endpoint);
`,
      { mode: 0o755 },
    );
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./dependency-controller.ts', import.meta.url)), 'dispatch'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${scratch}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'probe/repository',
          GITHUB_EVENT_PATH: event,
          PROBE_CALLS: calls,
        },
      },
    );
    const eventResult = JSON.parse(output);
    assert.equal(
      eventResult.event,
      outcome === 'success'
        ? 'qualification-reviewed'
        : outcome === 'active'
          ? 'qualification-in-flight'
          : outcome === 'stale-base'
            ? 'base-update-requested'
            : 'qualification-dispatched',
    );
    const invoked = readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(
      invoked.filter((args) => args[3]?.endsWith('/dispatches')).length,
      outcome === 'cancelled' ? 1 : 0,
    );
    const merges = invoked.filter((args) => args[0] === 'pr' && args[1] === 'merge');
    assert.equal(merges.length, outcome === 'success' ? 1 : 0);
    if (merges.length) assert.deepEqual(merges[0]!.slice(-2), ['--match-head-commit', sha]);
    assert.equal(
      invoked.some((args) => args[3]?.endsWith(`/pulls/${second.number}`)),
      false,
    );
  });

test('merge CLI retains failed native gate reasons when live main has advanced', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'dependency-controller-failed-merge-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const event = join(scratch, 'event.json');
  const calls = join(scratch, 'calls.jsonl');
  const pr = pull();
  const failedRun = { ...run(), conclusion: 'failure' };
  const failedJobs = jobs();
  failedJobs[0]!.conclusion = 'failure';
  const liveBase = 'd'.repeat(40);
  writeFileSync(event, JSON.stringify({ workflow_run: { id: failedRun.id } }));
  writeFileSync(
    join(scratch, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), endpoint = args[3];
fs.appendFileSync(process.env.PROBE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
let value;
if (endpoint.endsWith('/actions/runs/${failedRun.id}')) value = ${JSON.stringify(failedRun)};
else if (endpoint.includes('/pulls?state=open&base=main&head=')) value = [${JSON.stringify(pr)}];
else if (endpoint.endsWith('/pulls/${pr.number}')) value = ${JSON.stringify(pr)};
else if (endpoint.endsWith('/git/ref/heads/main')) value = {object:{sha:${JSON.stringify(liveBase)}}};
else if (endpoint.endsWith('/compare/${liveBase}...${pr.head.sha}')) value = {merge_base_commit:{sha:${JSON.stringify(pr.base.sha)}}};
else if (endpoint.endsWith('/jobs?per_page=100&page=1')) value = {jobs:${JSON.stringify(failedJobs)}};
else if (endpoint.endsWith('/files?per_page=100&page=1')) value = ${JSON.stringify(files.map((filename) => ({ filename })))};
else throw Error('unexpected API: ' + endpoint);
process.stdout.write(JSON.stringify(value));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./dependency-controller.ts', import.meta.url)), 'merge'],
    {
      encoding: 'utf8',
      timeout: 12_000,
      env: {
        ...process.env,
        PATH: `${scratch}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'probe/repository',
        GITHUB_EVENT_PATH: event,
        PROBE_CALLS: calls,
      },
    },
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const reviewed = JSON.parse(result.stdout);
  assert.equal(reviewed.event, 'qualification-reviewed');
  assert.equal(reviewed.run, failedRun.id);
  assert.equal(reviewed.pr, pr.number);
  assert.equal(reviewed.head, pr.head.sha);
  assert.deepEqual(reviewed.problems, [
    'main qualification did not pass',
    'required check missing, skipped, ambiguous or failed: dependency-currency',
    'main advanced beyond the qualified branch; update and requalify before merging',
  ]);
  const invoked = readFileSync(calls, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(
    invoked.some((args) => args[0] === 'pr' && args[1] === 'merge'),
    false,
  );
});

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
  assert.match(workflow, /group: dependency-controller\n\s+cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /pull_request.head.sha|npm (?:ci|install)/);
});
