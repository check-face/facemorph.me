import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { megabytes } from '../../src/controller/derived.ts';
// The production walker defines which manifest descriptors the acquisition budget counts.
import { collectAssets } from '../../src/Next/browser/acquisition-budget.mjs';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), 'utf8');
const fixture = JSON.parse(read('apps/web/test/fixtures/phone-cpu-check.json'));
const pin = JSON.parse(read('import/build-inputs.json')).runtime.manifest.sha256;
const manifestBytes = read(`import/runtime-manifests/control/${pin}/manifest.json`);
const manifest = JSON.parse(manifestBytes);
type Asset = { sha256: string; size: number; url: string };

function validateManifest(digest: string): void {
  assert.equal(digest, pin, 'CPU measurements must use the independently pinned runtime manifest');
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), digest);
}

test('phone CPU facts bind the entire cold first-face package to the pinned manifest', () => {
  validateManifest(fixture.manifestDigest);
  assert.throws(() => validateManifest('0'.repeat(64)));
  const required = collectAssets([
    manifest.runtime,
    manifest.mapping,
    manifest.average,
    manifest.noise,
    manifest.synthesis,
    manifest.sampleIndices,
    manifest.canaries,
  ]) as Asset[];
  const unique = [...new Map(required.map((asset) => [asset.sha256, asset])).values()];
  const canonical = (assets: Asset[]) =>
    assets
      .map(({ sha256, size, url }) => ({ sha256, size, url }))
      .sort((a, b) => a.sha256.localeCompare(b.sha256));
  assert.deepEqual(canonical(fixture.requiredAssets), canonical(unique));
  assert.equal(
    fixture.cpuPackageBytes,
    unique.reduce((sum, asset) => sum + asset.size, 0),
  );
  assert.equal(fixture.cpuPackageLabel, megabytes(fixture.cpuPackageBytes));
  assert.equal(fixture.byteBase, 1024);
});

test('measured quota labels and retention predicates use the shared formatter and recorded phase', () => {
  assert.ok(fixture.measurements.length > 0);
  for (const row of fixture.measurements) {
    for (const key of ['lane', 'browser', 'platform', 'measuredAt', 'outcome', 'storagePhase'])
      assert.equal(typeof row[key], 'string', key);
    assert.ok(Number.isFinite(Date.parse(row.measuredAt)));
    assert.ok(['completed-on-cpu', 'guidance-shown'].includes(row.outcome));
    for (const key of ['quotaBytes', 'usageBytes', 'remainingPackageBytes'])
      assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0, key);
    assert.equal(row.quotaLabel, megabytes(row.quotaBytes));
    assert.equal(row.canKeep, row.quotaBytes - row.usageBytes >= row.remainingPackageBytes);
    assert.equal(row.webgpu, null);
    assert.ok(row.evidence.run && row.evidence.artifactDigest && row.evidence.commit);
    if (!row.canKeep)
      assert.match(
        fixture.cannotKeepConsentRequirement,
        /byte count.*downloaded again on each visit/,
      );
  }
  assert.ok(
    fixture.untested.some(
      (row: { lane: string; reason: string }) =>
        row.lane === 'physical-iphone-safaridriver' && row.reason.length > 0,
    ),
  );
});
