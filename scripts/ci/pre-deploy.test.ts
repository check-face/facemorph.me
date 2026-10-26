import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { createReceipt, requiredLanes, verifyReceipt, type Identity } from './pre-deploy.ts';
const wf = (name: string) =>
  parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const main = wf('main');
const filters = JSON.parse(readFileSync(new URL('./path-filters.json', import.meta.url), 'utf8'));
const required = requiredLanes(Object.keys(filters.lanes));
const identity: Identity = {
  repositoryId: '123',
  workflow: '.github/workflows/main.yml',
  runId: '456',
  commit: 'a'.repeat(40),
  artifactName: `next-site-${'a'.repeat(40)}`,
  artifactDigest: 'b'.repeat(64),
};
const results = () => Object.fromEntries(required.map((lane) => [lane, { result: 'success' }]));

test('push path is correctness-only; manual all-lanes run keeps every full browser command', () => {
  for (const id of ['web-shell', 'next-site'])
    assert.equal(main.jobs[id].with.full, "${{ github.event_name == 'workflow_dispatch' }}");
  for (const id of ['mobile-browser', 'next-gpu-lane'])
    assert.match(main.jobs[id].if, /^github.event_name == 'workflow_dispatch' &&/);
  const shell = wf('web-shell');
  for (const id of ['facade', 'crop-acceptance', 'runtime-e2e', 'e2e'])
    assert.equal(shell.jobs[id].if, 'inputs.full');
  assert.equal(shell.on.workflow_call.inputs.full.default, true);
  assert.equal(wf('next-site-qualify').on.workflow_call.inputs.full.default, true);
  assert.match(wf('next-site-qualify').jobs.qualify.if, /^inputs.full &&/);
  assert.equal(main.concurrency.group, 'main');
  assert.equal(main.concurrency['cancel-in-progress'], false);
});

test('the receipt waits for all registered lanes and publication waits for that receipt', () => {
  assert.deepEqual([...main.jobs['pre-deploy'].needs].sort(), required);
  assert.match(main.jobs['pre-deploy'].if, /always\(\).*workflow_dispatch.*dependency_group == ''/);
  assert(main.jobs['next-deploy'].needs.includes('pre-deploy'));
  assert.match(
    main.jobs['next-deploy'].if,
    /workflow_dispatch.*needs.pre-deploy.result == 'success'/,
  );
  const receipt = wf('pre-deploy');
  assert.equal(receipt.on.push, undefined);
  assert(
    receipt.jobs.receipt.steps.some((s: any) => s.uses === './.github/actions/fetch-artifact'),
  );
  assert.match(wf('name-catalogue').jobs.publish.if, /github.workflow_ref/);
});

test('complete receipt verifies; every absent, skipped, failed or extra lane refuses', () => {
  const receipt = createReceipt(identity, results(), required);
  assert.deepEqual(verifyReceipt(receipt, identity, required), receipt);
  for (const lane of required) {
    for (const state of ['skipped', 'failure', 'cancelled', undefined]) {
      const planted = results();
      if (state === undefined) delete planted[lane];
      else planted[lane] = { result: state };
      assert.throws(() => createReceipt(identity, planted, required));
    }
  }
  assert.throws(() =>
    createReceipt(identity, { ...results(), unexpected: { result: 'success' } }, required),
  );
});

test('receipt cannot transfer between artifact bytes, commits, runs, repos or workflows', () => {
  const receipt = createReceipt(identity, results(), required);
  for (const [key, value] of Object.entries({
    repositoryId: '124',
    runId: '457',
    commit: 'c'.repeat(40),
    artifactName: `next-site-${'c'.repeat(40)}`,
    artifactDigest: 'd'.repeat(64),
    workflow: '.github/workflows/next-site.yml',
  }))
    assert.throws(() => verifyReceipt({ ...receipt, [key]: value }, identity, required), key);
  assert.throws(() => verifyReceipt({ ...receipt, lanes: {} }, identity, required));
  assert.throws(() => verifyReceipt({ ...receipt, schema: 'unknown' }, identity, required));
});

test('actual receipt CLI refuses push, mismatched source and partial full runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-pre-deploy-'));
  try {
    const out = join(root, 'receipt.json');
    const env = {
      ...process.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY_ID: identity.repositoryId,
      GITHUB_RUN_ID: identity.runId,
      GITHUB_SHA: identity.commit,
      ARTIFACT_RUN: identity.runId,
      ARTIFACT_WORKFLOW: identity.workflow,
      ARTIFACT_COMMIT: identity.commit,
      ARTIFACT_NAME: identity.artifactName,
      ARTIFACT_DIGEST: identity.artifactDigest,
      LANE_RESULTS: JSON.stringify(results()),
    };
    const run = (patch: Record<string, string> = {}) =>
      spawnSync(process.execPath, ['scripts/ci/pre-deploy.ts', '--out', out], {
        encoding: 'utf8',
        env: { ...env, ...patch },
      });
    assert.equal(run().status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(out, 'utf8')),
      createReceipt(identity, results(), required),
    );
    for (const patch of [
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_SHA: 'c'.repeat(40) },
      { GITHUB_RUN_ID: '999' },
      { LANE_RESULTS: '{}' },
    ])
      assert.notEqual(run(patch).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
