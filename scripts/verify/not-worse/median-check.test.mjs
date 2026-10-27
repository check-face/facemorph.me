import assert from 'node:assert/strict';
import test from 'node:test';
import { check } from './median-check.mjs';

const run = (side, coldFaceMs, reliability = {}) => ({
  side,
  measures: { values: { coldFaceMs }, bytes: { first: 100, return: 10 } },
  reliability: { faceProduced: true, videoProduced: true, reloads: 0, ...reliability },
});
const control = [run('control', 100), run('control', 110), run('control', 90)];

test('a build within the threshold passes; one beyond it fails on that measure', () => {
  assert.equal(
    check({ control, build: [run('build', 105), run('build', 112), run('build', 99)] }, 0.15).ok,
    true,
  );
  const slow = check(
    { control, build: [run('build', 130), run('build', 125), run('build', 140)] },
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
