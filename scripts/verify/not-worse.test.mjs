// The strictly-not-worse rule, called with plain values (fm-q007).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellVerdict,
  measureVerdict,
  noiseMargin,
  pairedRatios,
  ratioInterval,
  reliabilityVerdict,
  t95,
} from './not-worse.mjs';

const pairsAt = (ratios, control = 100) => ratios.map((r) => ({ control, candidate: control * r }));
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('t critical values', () => {
  close(t95(4), 2.776);
  close(t95(30), 2.042);
  close(t95(200), 1.96);
});

test('ratio interval is geometric and symmetric in log space', () => {
  const r = ratioInterval([1.1, 1 / 1.1, 1.1, 1 / 1.1]);
  close(r.ratio, 1);
  close(r.low * r.high, 1, 1e-9);
  assert.equal(ratioInterval([1.2]), null);
  close(ratioInterval([1.25, 1.25, 1.25]).ratio, 1.25);
  close(ratioInterval([1.25, 1.25, 1.25]).low, 1.25);
});

test('pairs must hold positive finite values', () => {
  assert.deepEqual(pairedRatios([{ control: 100, candidate: 120 }]), [1.2]);
  assert.throws(() => pairedRatios([{ control: 0, candidate: 1 }]), /positive and finite/);
  assert.throws(() => pairedRatios([{ control: 1, candidate: NaN }]), /positive and finite/);
});

test('noise margin comes from control/control pairs, never below zero', () => {
  assert.equal(noiseMargin(pairsAt([1, 1, 1])), null);
  assert.equal(noiseMargin(pairsAt([1, 1, 1, 1, 1])), 0);
  const m = noiseMargin(pairsAt([1.02, 0.98, 1.03, 0.97, 1.01, 0.99]));
  assert.ok(m > 0 && m < 0.05, String(m));
});

test('fails only when the whole interval lies above 1 + margin', () => {
  // Consistently 20% slower against a 3% margin: fails.
  assert.equal(
    measureVerdict({ pairs: pairsAt([1.19, 1.2, 1.21, 1.2, 1.22]), noise: 0.03 }).verdict,
    'failed',
  );
  // Equal or faster: passes.
  assert.equal(
    measureVerdict({ pairs: pairsAt([0.8, 0.82, 0.79, 0.81, 0.8]), noise: 0.03 }).verdict,
    'passed',
  );
  // 2% slower inside a 3% margin: passes.
  assert.equal(
    measureVerdict({ pairs: pairsAt([1.02, 1.02, 1.02, 1.02, 1.02]), noise: 0.03 }).verdict,
    'passed',
  );
  // Noisy pairs whose interval reaches below the limit: not a failure under the rule.
  assert.equal(
    measureVerdict({ pairs: pairsAt([1.4, 0.9, 1.3, 0.95, 1.2]), noise: 0.03 }).verdict,
    'passed',
  );
});

test('too few pairs or no margin is untested, never passed', () => {
  assert.equal(measureVerdict({ pairs: pairsAt([1, 1, 1, 1]), noise: 0.05 }).verdict, 'untested');
  assert.equal(
    measureVerdict({ pairs: pairsAt([1, 1, 1, 1, 1]), noise: null }).verdict,
    'untested',
  );
  assert.equal(
    measureVerdict({ pairs: pairsAt([1, 1, 1, 1, 1]), noise: pairsAt([1, 1]) }).verdict,
    'untested',
  );
});

test('a recorded trade is reported as traded, not failed', () => {
  // First Save 108.63 -> 202.17 ms traded for 4.38 MB -> 117 KB (PLAN.md retained evidence register).
  const v = measureVerdict({
    pairs: pairsAt([1.86, 1.85, 1.87, 1.86, 1.86]),
    noise: 0.05,
    trade: 'first-Save size/latency (PLAN.md)',
  });
  assert.equal(v.verdict, 'traded');
  assert.equal(
    measureVerdict({ pairs: pairsAt([1, 1, 1, 1, 1]), noise: 0.05, trade: 'x' }).verdict,
    'passed',
  );
});

test('reliability: a result the control produced and the new build did not fails the cell', () => {
  assert.equal(reliabilityVerdict([]).verdict, 'untested');
  assert.equal(
    reliabilityVerdict([{ controlProduced: true, candidateProduced: true }]).verdict,
    'passed',
  );
  assert.equal(
    reliabilityVerdict([
      { controlProduced: true, candidateProduced: false },
      { controlProduced: true, candidateProduced: true },
    ]).verdict,
    'failed',
  );
  assert.equal(
    reliabilityVerdict([{ controlProduced: false, candidateProduced: false }]).verdict,
    'passed',
  );
});

test('a cell passes only when nothing failed or went untested', () => {
  const pass = { verdict: 'passed' },
    fail = { verdict: 'failed' },
    untested = { verdict: 'untested' },
    traded = { verdict: 'traded' };
  assert.deepEqual(
    cellVerdict({ reliability: pass, measures: { warmFace: pass, firstSave: traded } }),
    { verdict: 'passed', traded: ['firstSave'] },
  );
  assert.equal(
    cellVerdict({ reliability: pass, measures: { warmFace: untested } }).verdict,
    'untested',
  );
  assert.equal(cellVerdict({ reliability: fail, measures: { warmFace: pass } }).verdict, 'failed');
  assert.equal(
    cellVerdict({ reliability: pass, measures: { a: untested, b: fail } }).verdict,
    'failed',
  );
});
