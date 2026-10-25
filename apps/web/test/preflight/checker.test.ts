import assert from 'node:assert/strict';
import test from 'node:test';
import { PREFLIGHT_BUDGETS } from '../../src/contracts/preflight.ts';
import { Scratch } from '../../src/preflight/types.ts';
import { admitsGpuSample } from '../../src/preflight/gpu-sample.ts';
import { memoryHint, storageFact } from '../../src/preflight/checker.ts';

test('GPU admission requires every actual limit; insufficient plain input preserves CPU work', () => {
  const limits = {
    maxBufferSize: 262144,
    maxStorageBufferBindingSize: 262144,
    maxComputeWorkgroupSizeX: 64,
    maxComputeInvocationsPerWorkgroup: 64,
    maxComputeWorkgroupsPerDimension: 1024,
  };
  assert.equal(admitsGpuSample(limits), true);
  for (const key of Object.keys(limits))
    assert.equal(admitsGpuSample({ ...limits, [key]: 0 }), false, key);
  assert.equal(admitsGpuSample({ ...limits, maxBufferSize: NaN }), false);
});
test('scratch ownership enforces contracts ceiling and every release is idempotent', () => {
  const scratch = new Scratch();
  const release = scratch.acquire(PREFLIGHT_BUDGETS.scratchBytes);
  assert.throws(() => scratch.acquire(1), /budget/);
  assert.throws(() => scratch.acquire(-1), /budget/);
  release();
  release();
  assert.equal(scratch.current, 0);
  assert.equal(scratch.resources, 0);
  assert.equal(scratch.peak, PREFLIGHT_BUDGETS.scratchBytes);
});
test('browser-rounded memory stays unknown; quota zero is a reported fact', () => {
  for (const hint of [undefined, 0, 2, 8, NaN])
    assert.deepEqual(memoryHint(hint), { state: 'unknown' });
  assert.equal(storageFact(0), 0);
  for (const value of [-1, undefined, Infinity, '1000']) assert.equal(storageFact(value), null);
});
