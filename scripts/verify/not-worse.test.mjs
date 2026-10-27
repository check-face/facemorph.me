// The strictly-not-worse rule, called with plain values (fm-q007, fm-mc27).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellVerdict,
  measureVerdict,
  noiseMargin,
  pairedRatios,
  ratioInterval,
  releaseVerdict,
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
  // Noisy pairs whose interval spans the limit: neither a failure nor a pass.
  const wide = measureVerdict({ pairs: pairsAt([1.4, 0.9, 1.3, 0.95, 1.2]), noise: 0.03 });
  assert.equal(wide.verdict, 'inconclusive');
  assert.match(wide.reason, /spans the limit/);
});

test('too few pairs is inconclusive and no margin is untested, never passed', () => {
  assert.equal(
    measureVerdict({ pairs: pairsAt([0.5, 0.5, 0.5, 0.5]), noise: 0.05 }).verdict,
    'inconclusive',
  );
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
  const cited = measureVerdict({
    pairs: pairsAt([1.86, 1.85, 1.87, 1.86, 1.86]),
    noise: 0.05,
    trade: { measure: 'firstSave', citation: 'PLAN.md#retained-evidence-register' },
  });
  assert.deepEqual(
    [cited.verdict, cited.trade.citation],
    ['traded', 'PLAN.md#retained-evidence-register'],
  );
  assert.throws(
    () =>
      measureVerdict({
        pairs: pairsAt([1.86, 1.85, 1.87, 1.86, 1.86]),
        noise: 0.05,
        trade: { measure: 'x' },
      }),
    /citation/,
  );
});

test('the same pairs give the same interval in any order', () => {
  const pairs = pairsAt([1.03, 0.97, 1.05, 1.01, 0.99, 1.02]);
  const a = measureVerdict({ pairs, noise: 0.04 });
  const b = measureVerdict({ pairs: [...pairs].reverse(), noise: 0.04 });
  for (const k of ['verdict', 'ratio', 'low', 'high', 'limit'])
    close(Number(a[k]) || 0, Number(b[k]) || 0, 1e-12);
  assert.equal(a.verdict, b.verdict);
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
  // A new crash, reload, out-of-memory kill or fallback in any pair fails the cell, whatever the timings.
  for (const event of ['crash', 'reload', 'outOfMemory', 'fallback']) {
    const v = reliabilityVerdict([
      { controlProduced: true, candidateProduced: true },
      { controlProduced: true, candidateProduced: true, candidateEvents: { [event]: true } },
    ]);
    assert.deepEqual([v.verdict, v.events], ['failed', [event]]);
    assert.equal(
      cellVerdict({ reliability: v, measures: { warmFace: { verdict: 'passed' } } }).verdict,
      'failed',
    );
  }
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

test('cells: inconclusive is not a pass; failed outranks untested outranks inconclusive', () => {
  const pass = { verdict: 'passed' },
    inconclusive = { verdict: 'inconclusive' },
    untested = { verdict: 'untested' };
  assert.equal(
    cellVerdict({ reliability: pass, measures: { a: inconclusive } }).verdict,
    'inconclusive',
  );
  assert.equal(
    cellVerdict({ reliability: pass, measures: { a: inconclusive, b: untested } }).verdict,
    'untested',
  );
});

// The release's listed cells: required local ones (eris, P30 Pro) and hosted lanes.
const LISTED = [
  { id: 'eris-cpu', class: 'desktop', local: true },
  { id: 'eris-webgpu', class: 'desktop-gpu', local: true },
  { id: 'phone-cpu', class: 'android', local: true },
  { id: 'android-emulator', class: 'android', local: false },
  { id: 'ios-simulator', class: 'ios', local: false },
  { id: 'macos-webkit', class: 'mac', local: false },
];
const all = (verdict) => Object.fromEntries(LISTED.map((c) => [c.id, { verdict }]));

test('release: every listed cell passed allows handover and claims every class', () => {
  const r = releaseVerdict({ listed: LISTED, results: all('passed') });
  assert.equal(r.handover, 'allowed');
  assert.deepEqual(r.claims.sort(), ['android', 'desktop', 'desktop-gpu', 'ios', 'mac']);
});

test('release: a missing cell is untested and permits no claim for its class only', () => {
  const results = all('passed');
  delete results['ios-simulator'];
  const r = releaseVerdict({ listed: LISTED, results });
  assert.equal(r.classes['ios'], 'untested');
  assert.ok(!r.claims.includes('ios'));
  // A hosted gap blocks no handover; the other classes keep their verdicts.
  assert.equal(r.handover, 'allowed');
  assert.deepEqual(r.claims.sort(), ['android', 'desktop', 'desktop-gpu', 'mac']);
});

test('release: missing required local evidence blocks handover; an unavailable hosted runner does not', () => {
  const noPhone = all('passed');
  delete noPhone['phone-cpu'];
  const blocked = releaseVerdict({ listed: LISTED, results: noPhone });
  assert.equal(blocked.handover, 'blocked');
  assert.deepEqual(
    blocked.blockers.map((b) => b.id),
    ['phone-cpu'],
  );
  const unavailable = {
    ...all('passed'),
    'macos-webkit': { verdict: 'untested', unavailable: 'no macOS runner allocated in 45 min' },
  };
  const hosted = releaseVerdict({ listed: LISTED, results: unavailable });
  assert.equal(hosted.handover, 'allowed');
  assert.equal(hosted.classes['mac'], 'untested');
  // A required local cell cannot be excused as unavailable.
  const local = releaseVerdict({
    listed: LISTED,
    results: {
      ...all('passed'),
      'eris-webgpu': { verdict: 'untested', unavailable: 'no adapter' },
    },
  });
  assert.equal(local.handover, 'blocked');
});

test('release: a real failure on a hosted lane blocks handover; a gain elsewhere changes no other cell', () => {
  const failed = releaseVerdict({
    listed: LISTED,
    results: { ...all('passed'), 'android-emulator': { verdict: 'failed' } },
  });
  assert.equal(failed.handover, 'blocked');
  assert.equal(failed.classes['android'], 'failed');
  assert.equal(failed.classes['desktop'], 'passed');
  const inconclusive = releaseVerdict({
    listed: LISTED,
    results: { ...all('passed'), 'eris-cpu': { verdict: 'inconclusive' } },
  });
  assert.equal(inconclusive.handover, 'blocked');
  assert.equal(inconclusive.classes['desktop'], 'inconclusive');
  assert.equal(inconclusive.classes['android'], 'passed');
});
