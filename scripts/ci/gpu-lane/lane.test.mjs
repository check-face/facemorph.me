// GPU lane verdict (fm-wzy), called with plain values: a software adapter is the named failure with no timings;
// canaries must exist for webgpu and pass within RGB 1 / raw float 0.002 before any timing is reported.
import assert from 'node:assert/strict';
import test from 'node:test';
import { verdict } from './lane.mjs';

const timings = {
  warmMsPerFace: 60,
  wallClockFirstFaceMs: 9000,
  wallClockSubsequentMedianMs: 800,
  faces: 6,
};
const pass = { name: 'hello', maxRgb: 1, maxFloat: 0.0011, passed: true };

test('a software adapter fails as "software adapter" and reports no timings', () => {
  const v = verdict({
    adapterFailure: 'This is a software adapter, not a GPU',
    canaries: [],
    timings,
  });
  assert.deepEqual([v.ok, v.failure, v.timings], [false, 'software adapter', null]);
});

test('timings are reported only after the webgpu canaries passed within tolerance', () => {
  assert.equal(
    verdict({ canaries: [{ provider: 'webgpu', checks: [pass] }], timings }).timings,
    timings,
  );
  for (const canaries of [
    [],
    [{ provider: 'cpu', checks: [pass] }],
    [{ provider: 'webgpu', checks: [{ ...pass, maxRgb: 2 }] }],
    [{ provider: 'webgpu', checks: [{ ...pass, maxFloat: 0.003 }] }],
    [{ provider: 'webgpu', checks: [{ ...pass, passed: false }] }],
  ]) {
    const v = verdict({ canaries, timings });
    assert.deepEqual(
      [v.ok, v.failure, v.timings],
      [false, 'canaries', null],
      JSON.stringify(canaries),
    );
  }
});

test('no benchmark timings with passing canaries is still a failure', () => {
  const v = verdict({ canaries: [{ provider: 'webgpu', checks: [pass] }], timings: null });
  assert.deepEqual([v.ok, v.failure], [false, 'benchmark']);
});
