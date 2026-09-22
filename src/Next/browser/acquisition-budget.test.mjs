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
  assert.deepEqual(budget.totals(), { loaded: 140, total: 140, fetched: 0, fetchedTotal: 0 });
  assert.deepEqual(readings.map(reading => reading.loaded), [100, 100]);
});

test('boundary readings are ledger events, not bar-only ticks', () => {
  const budget = createAcquisitionBudget();
  const readings = [];
  budget.attach((totals, progressOnly) => readings.push({ ...totals, progressOnly }));
  budget.planAsset(asset(A, 100));
  budget.progress(false);
  assert.deepEqual(readings, [{ loaded: 0, total: 100, fetched: 0, fetchedTotal: 0, progressOnly: false }]);
  budget.progress(true);
  assert.equal(readings[1].progressOnly, true);
});

test('bytes already on the device are never counted as bytes being fetched', () => {
  const budget = createAcquisitionBudget();
  budget.planAsset({ a: { sha256: 'a'.repeat(64), size: 200, url: 'https://x/a' },
                     b: { sha256: 'b'.repeat(64), size: 100, url: 'https://x/b' } });
  budget.cacheEvent({ status: 'retained', sha256: 'a'.repeat(64), bytes: 200 });
  // The bar covers the retained asset — reading and verifying it costs the visitor time — but
  // nothing about it crossed the network.
  assert.deepEqual(budget.totals(), { loaded: 200, total: 300, fetched: 0, fetchedTotal: 0 });
  budget.cacheEvent({ status: 'missing', sha256: 'b'.repeat(64) });
  assert.deepEqual(budget.totals(), { loaded: 200, total: 300, fetched: 0, fetchedTotal: 100 });
  budget.cacheEvent({ status: 'progress', sha256: 'b'.repeat(64), loaded: 40, bytes: 100 });
  assert.deepEqual(budget.totals(), { loaded: 240, total: 300, fetched: 40, fetchedTotal: 100 });
  budget.cacheEvent({ status: 'saved', sha256: 'b'.repeat(64), bytes: 100 });
  assert.deepEqual(budget.totals(), { loaded: 300, total: 300, fetched: 100, fetchedTotal: 100 });
});

test('a repaired asset joins the fetched set, because its bytes do cross the network', () => {
  const budget = createAcquisitionBudget();
  budget.planAsset({ sha256: 'c'.repeat(64), size: 50, url: 'https://x/c' });
  budget.cacheEvent({ status: 'retained', sha256: 'c'.repeat(64), bytes: 50 });
  budget.cacheEvent({ status: 'corrupt-removed', sha256: 'c'.repeat(64) });
  budget.cacheEvent({ status: 'downloading', sha256: 'c'.repeat(64) });
  assert.equal(budget.totals().fetchedTotal, 50);
});
