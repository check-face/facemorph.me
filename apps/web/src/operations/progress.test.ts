// fm-vbj7: whole-action progress properties over random event interleavings (seeded, reproducible).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionProgress, type PhasePlan } from './progress.ts';

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const facePlan = (): PhasePlan[] => [
  { kind: 'acquisition', unit: 'bytes', weight: 5, total: 200_000_000 },
  { kind: 'load', unit: 'steps', weight: 1, total: 3 },
  { kind: 'compute', unit: 'steps', weight: 2, total: 1 },
  { kind: 'file', unit: 'steps', weight: 0.5, total: 1 },
];
const morphPlan = (frames: number): PhasePlan[] => [
  { kind: 'acquisition', unit: 'bytes', weight: 3, total: 100_000_000 },
  { kind: 'compute', unit: 'steps', weight: 1, total: 2 },
  { kind: 'frames', unit: 'frames', weight: 6, total: frames },
  { kind: 'file', unit: 'steps', weight: 1, total: 1 },
];

test('progress is monotonic for any event interleaving and completes only at the default-file boundary', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const next = random(seed);
    const frames = 4 + Math.floor(next() * 60);
    const progress = createActionProgress(`attempt:${seed}`, morphPlan(frames));
    let previous = 0;
    for (let step = 0; step < 200; step += 1) {
      const r = next();
      const snap =
        r < 0.3
          ? progress.advance('acquisition', 'bytes', Math.floor(next() * 120_000_000))
          : r < 0.5
            ? progress.advance('compute', 'steps', Math.floor(next() * 3))
            : r < 0.85
              ? progress.finishUnit('frames', 'frames', Math.floor(next() * (frames + 2)) - 1)
              : r < 0.92
                ? progress.setWaiting(next() < 0.5)
                : progress.advance('file', 'steps', 0);
      assert.ok(snap.fraction !== null);
      assert.ok(
        snap.fraction >= previous,
        `seed ${seed} step ${step}: ${snap.fraction} < ${previous}`,
      );
      assert.ok(snap.fraction < 1, 'computed work alone never completes the action');
      assert.equal(snap.complete, false);
      previous = snap.fraction;
    }
    progress.setWaiting(false);
    for (let i = 0; i < frames; i += 1) progress.finishUnit('frames', 'frames', i);
    progress.finish('acquisition');
    progress.finish('compute');
    const before = progress.snapshot();
    assert.ok(before.fraction! < 1 && !before.complete, 'all compute done is still not the file');
    const done = progress.fileReady();
    assert.equal(done.fraction, 1);
    assert.equal(done.complete, true);
  }
});

test('unknown costs yield indeterminate progress with the counts still reported', () => {
  const progress = createActionProgress('attempt:1', [
    { kind: 'acquisition', unit: 'bytes', weight: 1, total: null },
    { kind: 'compute', unit: 'steps', weight: 1, total: 1 },
  ]);
  const snap = progress.advance('acquisition', 'bytes', 5_000_000);
  assert.equal(snap.fraction, null, 'no race to 99% while a cost is unknown');
  assert.deepEqual(snap.phases[0], {
    kind: 'acquisition',
    unit: 'bytes',
    done: 5_000_000,
    total: null,
  });
  const known = progress.advance('acquisition', 'bytes', 6_000_000, 10_000_000);
  assert.ok(known.fraction !== null && known.fraction > 0);
});

test('bytes and frames never share a unit', () => {
  const progress = createActionProgress('attempt:1', morphPlan(8));
  assert.throws(() => progress.advance('frames', 'bytes', 10), /counts frames, not bytes/);
  assert.throws(() => progress.advance('acquisition', 'frames', 1), /counts bytes, not frames/);
  assert.throws(
    () =>
      createActionProgress('a', [
        { kind: 'frames', unit: 'frames', weight: 1, total: 4 },
        { kind: 'frames', unit: 'bytes', weight: 1, total: 4 },
      ]),
    /appears once/,
  );
});

test('the bar never advances while a user decision is pending', () => {
  const progress = createActionProgress('attempt:1', facePlan());
  const before = progress.advance('acquisition', 'bytes', 50_000_000).fraction!;
  progress.setWaiting(true);
  assert.equal(progress.advance('acquisition', 'bytes', 200_000_000).fraction, before);
  assert.equal(progress.finish('load').fraction, before);
  assert.ok(progress.setWaiting(false).fraction! > before, 'resumes from the work actually done');
});

test('Retry starts a new attempt; cancellation and failure settle the bar where it stood', () => {
  const first = createActionProgress('attempt:1', facePlan());
  first.advance('acquisition', 'bytes', 100_000_000);
  const cancelled = first.settle('cancelled');
  assert.equal(cancelled.settled, 'cancelled');
  assert.equal(cancelled.complete, false);
  const held = cancelled.fraction;
  assert.equal(
    first.advance('acquisition', 'bytes', 200_000_000).fraction,
    held,
    'a settled bar is final',
  );
  assert.equal(
    first.fileReady().complete,
    false,
    'a late file cannot complete a cancelled attempt',
  );
  const retry = createActionProgress('attempt:2', [
    // The bytes already on this device are part of the new attempt's starting point, not lost.
    { kind: 'acquisition', unit: 'bytes', weight: 5, total: 200_000_000, done: 100_000_000 },
    { kind: 'load', unit: 'steps', weight: 1, total: 3 },
    { kind: 'compute', unit: 'steps', weight: 2, total: 1 },
    { kind: 'file', unit: 'steps', weight: 0.5, total: 1 },
  ]);
  assert.equal(retry.snapshot().attemptId, 'attempt:2');
  assert.equal(retry.snapshot().settled, null);
  const failed = createActionProgress('attempt:3', facePlan());
  assert.equal(failed.settle('failed').settled, 'failed');
});

test("a completed tile's bar never restarts inside a Morph", () => {
  const tile = createActionProgress('attempt:face-a', facePlan());
  tile.finish('acquisition');
  tile.finish('load');
  tile.finish('compute');
  const finished = tile.fileReady();
  // The Morph composes its prerequisites: the finished face enters as done work.
  const morph = createActionProgress('attempt:morph', [
    { kind: 'prepare', unit: 'steps', weight: 2, total: 2, done: 1 }, // face a ready, face b pending
    { kind: 'frames', unit: 'frames', weight: 6, total: 4 },
    { kind: 'file', unit: 'steps', weight: 1, total: 1 },
  ]);
  const start = morph.advance('prepare', 'steps', 1);
  assert.ok(start.fraction! > 0, 'the completed face counts from the start');
  morph.advance('prepare', 'steps', 2);
  for (const index of [0, 3, 3, 1, 2]) morph.finishUnit('frames', 'frames', index);
  assert.equal(morph.fileReady().complete, true);
  assert.deepEqual(tile.snapshot(), finished, "the tile's own bar is untouched by the Morph");
});
