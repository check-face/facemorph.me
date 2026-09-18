// C-10: the acquisition bar must move inside an asset, not only between assets, and two assets
// downloading concurrently must each advance it instead of fighting over a single in-flight slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcquisitionBudget } from './acquisition-budget.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const asset = (sha256, size) => ({ sha256, size, url: `https://models.example/${sha256[0]}${size}` });

test('acquisition progress increases strictly within a single asset, not only between assets (C-10)', () => {
  const budget = createAcquisitionBudget();
  const readings = [];
  budget.attach(({ loaded, total }, progressOnly) => readings.push({ loaded, total, progressOnly }));
  budget.planAsset(asset(A, 100));
  budget.planAsset(asset(B, 50));
  for (const loaded of [10, 40, 90]) budget.cacheEvent({ status: 'progress', sha256: A, loaded });
  budget.cacheEvent({ status: 'saved', sha256: A, bytes: 100 });
  budget.cacheEvent({ status: 'progress', sha256: B, loaded: 25 });
  assert.deepEqual(readings.map(reading => reading.loaded), [10, 40, 90, 100, 125]);
  assert.equal(readings.at(-1).total, 150, 'one budget spans the whole planned set');
  for (let i = 1; i < readings.length; i++)
    assert.ok(readings[i].loaded > readings[i - 1].loaded, 'the bar must advance within an asset, not jump at boundaries');
  assert.ok(readings.every(reading => reading.progressOnly), 'byte ticks belong to the bar, not the diagnostics ledger');
});

test('two assets downloading concurrently each advance the bar', () => {
  const budget = createAcquisitionBudget();
  const loaded = [];
  budget.attach(({ loaded: value }) => loaded.push(value));
  budget.planAsset(asset(A, 100));
  budget.planAsset(asset(B, 100));
  // Interleaved ticks: the single-slot accounting this replaces would oscillate instead of rising.
  for (const event of [
    { status: 'progress', sha256: A, loaded: 10 }, { status: 'progress', sha256: B, loaded: 10 },
    { status: 'progress', sha256: A, loaded: 20 }, { status: 'progress', sha256: B, loaded: 20 },
    { status: 'saved', sha256: A, bytes: 100 }, { status: 'saved', sha256: B, bytes: 100 }
  ]) budget.cacheEvent(event);
  assert.deepEqual(loaded, [10, 20, 30, 40, 120, 200]);
  for (let i = 1; i < loaded.length; i++) assert.ok(loaded[i] > loaded[i - 1]);
});

test('a retained or verified asset is credited at its reported size without a download', () => {
  const budget = createAcquisitionBudget();
  const readings = [];
  budget.attach(({ loaded, total }) => readings.push({ loaded, total }));
  budget.planAsset(asset(A, 100));
  budget.cacheEvent({ status: 'retained', sha256: A, bytes: 100 });
  budget.cacheEvent({ status: 'verified', sha256: B, bytes: 40 }); // credited even before it is planned
  budget.planAsset(asset(B, 40));
  assert.deepEqual(budget.totals(), { loaded: 140, total: 140 });
  assert.deepEqual(readings.map(reading => reading.loaded), [100, 100]);
});

test('boundary readings are ledger events, not bar-only ticks', () => {
  const budget = createAcquisitionBudget();
  const readings = [];
  budget.attach((totals, progressOnly) => readings.push({ ...totals, progressOnly }));
  budget.planAsset(asset(A, 100));
  budget.progress(false);
  assert.deepEqual(readings, [{ loaded: 0, total: 100, progressOnly: false }]);
  budget.progress(true);
  assert.equal(readings[1].progressOnly, true);
});
