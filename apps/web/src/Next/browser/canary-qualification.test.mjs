// C-03: a device that passed every canary on an unchanged bundle has not become numerically
// different overnight. These tests drive the real qualification orchestration — real reference
// PNGs, the real RGB/float comparison gates — with synthesis stood in for, since the point is
// when the checks run and what invalidates them, not the inference itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanaryQualification } from './canary-qualification.mjs';
import { createRecordAccess } from '../Assets/model-cache.mjs';
import { encodeRgbaPng } from './png.mjs';
import { rgba1024 } from './identity.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const rawFor = level => Float32Array.from({ length: 3 * 1024 * 1024 }, () => level);
const asset = bytes => ({ sha256: digest(bytes), size: bytes.length, url: `https://models.example/${digest(bytes).slice(0, 8)}` });

async function fixture({ referenceLevels = [0.5, 0.5, 0.5], provider = 'cpu', manifestSha256 = 'a'.repeat(64) } = {}) {
  const map = new Map();
  const store = {
    get: async key => map.has(key) ? new Response(map.get(key)) : undefined,
    put: async (key, response) => { map.set(key, new Uint8Array(await response.arrayBuffer())); },
    remove: async key => map.delete(key)
  };
  const records = createRecordAccess(store);
  const references = await Promise.all(referenceLevels.map(referenceBytes));
  const w = new Float32Array(512).map((_, i) => (i % 7) * 0.01 - 0.03);
  const wBytes = new Uint8Array(w.buffer, w.byteOffset, w.byteLength);
  const empty = new Uint8Array(0);
  const manifest = {
    bundleVersion: 'test-bundle',
    sampleIndices: asset(empty),
    canaries: references.map((reference, i) => ({
      name: `canary-${i + 1}`, w: asset(wBytes), noise: i === 1 ? 'zero' : 'original',
      samples: asset(empty), reference: asset(reference)
    }))
  };
  const pools = new Map([[digest(wBytes), wBytes], [digest(empty), empty], ...references.map(reference => [digest(reference), reference])]);
  const acquireBytes = async item => {
    const found = pools.get(item.sha256);
    if (!found) throw Error('Asset integrity mismatch');
    return found;
  };
  const raw = rawFor(0.5); // what the device actually synthesises
  let synthesisRuns = 0;
  const runSynthesis = async () => { synthesisRuns++; return raw; };
  const qualification = overrides => createCanaryQualification({
    manifest, manifestSha256, provider, bundle: manifest.synthesis ?? null, records, acquireBytes, runSynthesis, ...overrides
  });
  return { map, records, manifest, acquireBytes, runSynthesis, qualification, counts: () => synthesisRuns };
}

async function referenceBytes(level) {
  return new Uint8Array(await (await encodeRgbaPng(rgba1024(rawFor(level)))).arrayBuffer());
}

test('a cold device pays for exactly one canary before the first face', async () => {
  const f = await fixture();
  const q = f.qualification();
  await q.adopt();
  assert.ok(!q.complete(), 'a cold device has no recorded pass');
  const events = [];
  await q.runNext(event => events.push(event));
  assert.equal(f.counts(), 1, 'exactly one canary runs to gate admission');
  assert.deepEqual(events, [{ name: 'canary-1', loaded: 0, total: 3 }]);
  assert.ok(!q.complete());
});

test('the remaining canaries finish after the first face and the pass is recorded', async () => {
  const f = await fixture();
  const q = f.qualification();
  await q.adopt();
  const events = [];
  while (!q.complete()) await q.runNext(event => events.push(event));
  assert.equal(f.counts(), 3);
  assert.deepEqual(events.map(event => event.loaded), [0, 1, 2]);
  assert.ok(q.checks().every(check => check.passed === true));
  const record = await f.records.get(q.key);
  assert.equal(record?.schema, 'checkface-canary-qualification-v1');
  assert.equal(record?.manifestSha256, 'a'.repeat(64));
  assert.equal(record?.provider, 'cpu');
  assert.equal(record?.checks.length, 3);
});

test('a warm device on an unchanged bundle emits zero canary events and runs no synthesis', async () => {
  const f = await fixture();
  const first = f.qualification();
  await first.adopt();
  while (!first.complete()) await first.runNext(() => {});
  const coldRuns = f.counts();
  const second = f.qualification(); // a fresh page, same device, same bundle
  await second.adopt();
  assert.ok(second.complete(), 'the recorded pass is adopted');
  assert.deepEqual(second.checks().map(check => check.name), ['canary-1', 'canary-2', 'canary-3']);
  assert.equal(f.counts(), coldRuns, 'no additional synthesis for the warm load');
});

test('a tampered reference changes the identity, forces a fresh run, and fails the route', async () => {
  const f = await fixture();
  const first = f.qualification();
  await first.adopt();
  while (!first.complete()) await first.runNext(() => {});
  // Same device, same record store, but canary-2's reference bytes no longer match the bundle.
  const tampered = await fixture({ referenceLevels: [0.5, 0.9, 0.5] });
  const q = f.qualification({ manifest: tampered.manifest, acquireBytes: tampered.acquireBytes });
  await q.adopt();
  assert.ok(!q.complete(), 'the recorded pass for the untampered bundle must not be reused');
  await q.runNext(() => {}); // canary-1 still matches
  await assert.rejects(q.runNext(() => {}), /Device correctness check failed: canary-2/);
  assert.ok(((await f.records.get(q.key))?.checks?.length ?? 0) < 3, 'no complete pass is recorded for the tampered bundle');
});

test('a recorded pass is not reused across routes or manifest digests', async () => {
  const f = await fixture();
  const first = f.qualification();
  await first.adopt();
  while (!first.complete()) await first.runNext(() => {});
  const otherBundle = f.qualification({ manifestSha256: 'b'.repeat(64) });
  await otherBundle.adopt();
  assert.ok(!otherBundle.complete(), 'a different manifest digest re-qualifies');
  const otherRoute = f.qualification({ provider: 'webgpu' });
  await otherRoute.adopt();
  assert.ok(!otherRoute.complete(), 'a different route re-qualifies');
});

test('a full (CI) run re-proves every canary even on a recorded pass', async () => {
  const f = await fixture();
  const normal = f.qualification();
  await normal.adopt();
  while (!normal.complete()) await normal.runNext(() => {});
  const warmRuns = f.counts();
  const ci = f.qualification({ full: true }); // CI and release qualification never skip
  await ci.adopt();
  assert.ok(!ci.complete(), 'a full run ignores the recorded pass');
  const events = [];
  while (!ci.complete()) await ci.runNext(event => events.push(event));
  assert.equal(f.counts() - warmRuns, 3, 'every canary runs again, all before any face');
  assert.deepEqual(events.map(event => event.loaded), [0, 1, 2]);
});

test('partially recorded progress resumes where the previous session stopped', async () => {
  const f = await fixture();
  const first = f.qualification();
  await first.adopt();
  await first.runNext(() => {}); // the session ends after one canary
  const resumed = f.qualification();
  await resumed.adopt();
  assert.equal(resumed.checks().length, 1, 'the partial pass was recorded');
  const events = [];
  await resumed.runNext(event => events.push(event));
  assert.deepEqual(events, [{ name: 'canary-2', loaded: 1, total: 3 }]);
  assert.equal(f.counts(), 2, 'the finished canary is not re-run');
});
