// Not-worse lanes (fm-0q4h): the per-cell summary reports raw paired values and, for control/control, a noise margin
// per measure by the gate's own rule; a planted slowdown shows in the raw pairs; a planted crash is a reliability
// event; the planted artifacts change only index.html's head.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain ES module without declarations
import { summarize } from './summary.mjs';
// @ts-expect-error plain ES module without declarations
import { PLANTS, plantHtml } from './plant.mjs';
// @ts-expect-error plain ES module without declarations
import { noiseMargin } from '../not-worse.mjs';
import { abbaSchedule, waitedWithin, type ScheduledRun, type TraceEvent } from './workload.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ok = {
  faceProduced: true,
  photoFaceProduced: true,
  videoProduced: true,
  crash: false,
  reloads: 0,
  outOfMemory: false,
  fallback: false,
  uncaughtErrors: 0,
};

function docs(
  build: string,
  face: (r: ScheduledRun) => number,
  rel: (r: ScheduledRun) => typeof ok = () => ok,
) {
  return abbaSchedule(5).map((run) => ({
    file: `${String(run.index).padStart(2, '0')}-${run.side}.json`,
    doc: {
      digests: { control: A, build },
      cell: { device: 'test' },
      runs: [
        {
          ...run,
          measures: {
            values: { coldFaceMs: face(run), warmFaceMs: null },
            lockups: 0,
            bytes: { first: 1000, return: 10 },
            peakMemory: 'unreported',
          },
          reliability: rel(run),
        },
      ],
    },
  }));
}

test('control/control: a noise margin per measure, equal to the gate rule on the raw pairs', () => {
  const face = (r: ScheduledRun) => 1000 + r.index * 7;
  const s = summarize(docs(A, face));
  assert.equal(s.controlControl, true);
  assert.equal(s.scoredPairs, 5);
  const m = s.measures.coldFaceMs;
  assert.equal(m.pairs.length, 5);
  assert.equal(m.noiseMargin, noiseMargin(m.pairs));
  assert.ok(m.noiseMargin > 0);
  assert.equal(s.measures.bytesFirst.noiseMargin, 0);
  // a measure the lane does not observe has no margin, and says why
  assert.equal(s.measures.warmFaceMs.noiseMargin, null);
  assert.match(s.measures.warmFaceMs.noiseMarginUnset, /0 complete pairs/);
});

test('a planted 5 s slowdown on one side shows in every raw pair; no margin when the sides differ', () => {
  const s = summarize(docs(B, (r) => (r.side === 'build' ? 15_000 : 10_000) + r.index));
  assert.equal(s.controlControl, false);
  assert.equal(s.measures.coldFaceMs.noiseMargin, undefined);
  for (const p of s.measures.coldFaceMs.pairs) assert.ok(p.candidate - p.control > 4900);
  assert.ok(s.measures.coldFaceMs.ratioMin > 1.4);
});

test('a planted crash is a reliability event and its run is not scored', () => {
  const crashed = (r: ScheduledRun) =>
    r.side === 'build'
      ? { ...ok, crash: true, videoProduced: false, photoFaceProduced: false }
      : ok;
  const all = docs(B, () => 1000, crashed);
  const s = summarize(all, {
    failed: new Set(all.filter((d) => d.file.endsWith('build.json')).map((d) => d.file)),
  });
  assert.equal(s.reliabilityEvents.length, 5);
  assert.ok(
    s.reliabilityEvents.every(
      (e: { crash: boolean; side: string }) => e.crash && e.side === 'build',
    ),
  );
  assert.equal(s.measures.coldFaceMs.pairs.length, 0);
});

test('planted artifacts put one script first in <head> and leave the rest of the page unchanged', () => {
  const html = '<!doctype html><html><head><base href="/"></head><body></body></html>';
  for (const script of [PLANTS.slow(5000), PLANTS.crash()]) {
    const out = plantHtml(html, script);
    assert.equal(out.replace(script, ''), html);
    assert.ok(out.indexOf(script) < out.indexOf('<base'));
  }
  assert.match(PLANTS.slow(5000), /DELAY = 5000/);
  assert.throws(() => plantHtml('<p>no head</p>', PLANTS.crash()), /no <head>/);
});

test('overlapping scripted waits (a toast and a dialog up together) are excluded once', () => {
  const w = (t: number, end: number): TraceEvent => ({ t, kind: 'wait', end });
  assert.equal(waitedWithin([w(10, 20), w(15, 30), w(16, 18), w(40, 45)], 0, 100), 25);
  assert.equal(waitedWithin([w(10, 20), w(15, 30)], 18, 25), 7);
});
