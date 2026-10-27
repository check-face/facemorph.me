import assert from 'node:assert/strict';
import test from 'node:test';
import { check } from './median-check.mjs';

const run = (side, coldFaceMs, reliability = {}) => ({
  side,
  measures: { values: { coldFaceMs }, bytes: { first: 100, return: 10 } },
  reliability: { faceProduced: true, videoProduced: true, reloads: 0, ...reliability },
});
const control = [run('control', 10000), run('control', 11000), run('control', 9000)];

test('a build within the threshold passes; one beyond it fails on that measure', () => {
  assert.equal(
    check({ control, build: [run('build', 10500), run('build', 11200), run('build', 9900)] }, 0.15)
      .ok,
    true,
  );
  const slow = check(
    { control, build: [run('build', 13000), run('build', 12500), run('build', 14000)] },
    0.15,
  );
  assert.equal(slow.ok, false);
  assert.deepEqual(
    slow.rows.filter((r) => !r.ok).map((r) => r.measure),
    ['coldFaceMs'],
  );
});

test('a lost video or a reload fails the build whatever its timings', () => {
  const build = [run('build', 90), run('build', 90, { videoProduced: false }), run('build', 90)];
  assert.equal(check({ control, build }, 0.15).ok, false);
  assert.equal(check({ control, build: [run('build', 90, { reloads: 1 })] }, 0.15).ok, false);
});

test('a timed measure over the ratio but within 50 ms of the control passes; past both it fails', () => {
  const save = (side, firstSaveMs) => ({
    ...run(side, 100),
    measures: { values: { coldFaceMs: 100, firstSaveMs }, bytes: { first: 100, return: 10 } },
  });
  const control = [save('control', 74), save('control', 74), save('control', 74)];
  // Release run 40542780390: firstSaveMs 93 vs 74 ms, 1.26x and 19 ms.
  assert.equal(
    check({ control, build: [save('build', 93), save('build', 93), save('build', 93)] }, 0.15).ok,
    true,
  );
  assert.equal(
    check({ control, build: [save('build', 125), save('build', 125), save('build', 125)] }, 0.15)
      .ok,
    false,
  );
});

test('byte counts keep the ratio alone', () => {
  const bytes = (side, first) => ({
    ...run(side, 100),
    measures: { values: { coldFaceMs: 100 }, bytes: { first, return: 10 } },
  });
  assert.equal(
    check({ control: [bytes('control', 100)], build: [bytes('build', 130)] }, 0.15).ok,
    false,
  );
});
