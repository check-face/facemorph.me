#!/usr/bin/env node
// fm-jx26/fm-fy2.11: a green path-filtered push is not an all-lanes release qualification.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface Identity {
  repositoryId: string;
  workflow: string;
  runId: string;
  commit: string;
  artifactName: string;
  artifactDigest: string;
}
export interface Receipt extends Identity {
  schema: 'facemorph.pre-deploy/1';
  lanes: Record<string, 'success'>;
}
export const requiredLanes = (lanes: string[]) =>
  [...new Set(['dependency-policy', 'next-site-artifact', ...lanes])].sort();

function checkIdentity(identity: Identity) {
  assert.match(identity.repositoryId, /^[1-9][0-9]*$/);
  assert.equal(identity.workflow, '.github/workflows/main.yml');
  assert.match(identity.runId, /^[1-9][0-9]*$/);
  assert.match(identity.commit, /^[a-f0-9]{40}$/);
  assert.equal(identity.artifactName, `next-site-${identity.commit}`);
  assert.match(identity.artifactDigest, /^[a-f0-9]{64}$/);
}

/** Refuse absent, skipped, failed and surplus results; no partial push can mint a receipt. */
export function createReceipt(identity: Identity, results: unknown, required: string[]): Receipt {
  checkIdentity(identity);
  assert(
    results && typeof results === 'object' && !Array.isArray(results),
    'lane results required',
  );
  assert.deepEqual(
    Object.keys(results).sort(),
    [...required].sort(),
    'complete lane coverage required',
  );
  const lanes: Record<string, 'success'> = {};
  for (const name of [...required].sort()) {
    const result: unknown = (results as Record<string, { result?: unknown }>)[name]?.result;
    assert.equal(result, 'success', `${name}: every pre-deploy lane must succeed`);
    lanes[name] = 'success';
  }
  return { schema: 'facemorph.pre-deploy/1', ...identity, lanes };
}

/** Recheck the receipt against the independently fetched artifact and the full lane inventory. */
export function verifyReceipt(input: unknown, identity: Identity, required: string[]): Receipt {
  assert(input && typeof input === 'object', 'pre-deploy receipt required');
  const receipt = input as Receipt;
  assert.equal(receipt.schema, 'facemorph.pre-deploy/1');
  for (const key of Object.keys(identity) as (keyof Identity)[])
    assert.equal(receipt[key], identity[key], `pre-deploy ${key} mismatch`);
  const results = Object.fromEntries(
    Object.entries(receipt.lanes ?? {}).map(([lane, result]) => [lane, { result }]),
  );
  return createReceipt(identity, results, required);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, receipt: { type: 'string' } },
  });
  const env = process.env;
  const identity: Identity = {
    repositoryId: env['GITHUB_REPOSITORY_ID'] ?? '',
    workflow: env['ARTIFACT_WORKFLOW'] ?? '',
    runId: env['ARTIFACT_RUN'] ?? '',
    commit: env['ARTIFACT_COMMIT'] ?? '',
    artifactName: env['ARTIFACT_NAME'] ?? '',
    artifactDigest: env['ARTIFACT_DIGEST'] ?? '',
  };
  const filters = JSON.parse(readFileSync(new URL('./path-filters.json', import.meta.url), 'utf8'));
  const required = requiredLanes(Object.keys(filters.lanes));
  if (values.receipt) {
    verifyReceipt(JSON.parse(readFileSync(values.receipt, 'utf8')), identity, required);
    console.log('Exact artifact has a complete all-lanes pre-deploy receipt');
  } else {
    assert.equal(env['GITHUB_EVENT_NAME'], 'workflow_dispatch', 'only a manual full run qualifies');
    assert.equal(
      env['GITHUB_RUN_ID'],
      identity.runId,
      'receipt must be produced in the artifact run',
    );
    assert.equal(env['GITHUB_SHA'], identity.commit, 'test source must match the built artifact');
    assert(values.out, '--out required');
    const receipt = createReceipt(identity, JSON.parse(env['LANE_RESULTS'] ?? 'null'), required);
    writeFileSync(values.out, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`All ${required.length} lanes passed for ${identity.artifactDigest}`);
  }
}
