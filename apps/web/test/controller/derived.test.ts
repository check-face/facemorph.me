import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import {
  estimate,
  gateScope,
  isSlowDevice,
  megabytes,
  perFrameText,
  predictedMorphMs,
  remainingText,
  faceInputProblem,
} from '../../src/controller/derived.ts';
import { msg } from '../../src/controller/msg.ts';
const state = init({
  today: '2026-10-25',
  url: 'https://next.facemorph.me/',
  consentAnswered: false,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
const none = { faceMs: null, frameMs: null, videoMs: null, plannedFrames: null };
test('field validation preserves exact words and seed syntax before any operation', () => {
  const input = state.Inputs[0]!;
  for (const value of ['0', '4294967295'])
    assert.equal(faceInputProblem({ ...input, mode: 'seed', value }), null);
  for (const value of ['', '-1', '1.5', '4294967296', ' 42 ', '1e2', '+42', '１２'])
    assert.equal(
      faceInputProblem({ ...input, mode: 'seed', value }),
      'Use a whole number from 0 to 4294967295.',
      value,
    );
  for (const value of ['hello', 'Hello', ' hello ', 'é'.repeat(256)])
    assert.equal(faceInputProblem({ ...input, value }), null);
  for (const value of ['', ' \t\n'])
    assert.equal(faceInputProblem({ ...input, value }), 'Type some words to make a face.');
  assert.equal(
    faceInputProblem({ ...input, value: 'a'.repeat(513) }),
    'Use at most 512 bytes of text.',
  );
  assert.equal(
    faceInputProblem({ ...input, value: 'é'.repeat(257) }),
    'Use at most 512 bytes of text.',
  );
});
test('megabytes has the classic MiB/GiB boundary and minimum one MB', () => {
  assert.deepEqual([1, 1024 ** 2, 1024 ** 3 - 1, 1024 ** 3].map(megabytes), [
    '1 MB',
    '1 MB',
    '1024 MB',
    '1.0 GB',
  ]);
});
test('slow device uses actual CPU or a measurement over twenty seconds', () => {
  assert.equal(isSlowDevice({ ...state, Route: 'cpu' }, null), true);
  assert.equal(isSlowDevice({ ...state, Route: 'webgpu' }, null), false);
  assert.equal(isSlowDevice({ ...state, Route: 'webgpu' }, 19_999), false);
  assert.equal(isSlowDevice({ ...state, Route: 'webgpu' }, 20_001), true);
});
test('gate scope covers cached/project/photo/import/morph/unknown downloads without requests', () => {
  const known = { ...state, Downloads: { ...state.Downloads, known: true } };
  assert.equal(gateScope(known, msg('RunFace', 'face-1')), 'route');
  assert.equal(
    gateScope({ ...known, CachedFaces: new Set(['face-1']) }, msg('RunFace', 'face-1')),
    null,
  );
  for (const mode of ['photo', 'project'] as const) {
    const inputs = known.Inputs.map((i) => ({ ...i, mode }));
    const s = { ...known, Inputs: inputs };
    assert.equal(gateScope(s, msg('RunFace', 'face-1')), mode === 'photo' ? 'photo' : null);
    if (mode === 'photo') assert.equal(gateScope(s, msg('Run', 'morph')), 'photo');
  }
  assert.equal(gateScope(known, msg('Import', new Blob(['project']))), 'route');
  assert.equal(gateScope(state, msg('RunFace', 'face-1')), null);
  assert.equal(
    gateScope({ ...known, DownloadConsent: new Set(['route']) }, msg('RunFace', 'face-1')),
    null,
  );
});
test('remaining and estimates use measured facts and the real retained estimator', () => {
  const progress = {
    facesTotal: 2,
    facesDone: 1,
    framesTotal: 0,
    framesDone: 0,
    videoFramesTotal: 0,
    videoFramesDone: 0,
  };
  assert.equal(remainingText(state, none, progress), '');
  assert.equal(estimate(state, none), null);
  assert.equal(predictedMorphMs(state, none), null);
  const facts = { faceMs: 2000, frameMs: 500, videoMs: 100, plannedFrames: 8 };
  assert.equal(remainingText(state, facts, progress), 'about 2 seconds remaining');
  assert.deepEqual(estimate(state, facts), [2000, 8]);
  assert.deepEqual(estimate(state, { ...facts, plannedFrames: null }), [2000, 0]);
  assert.equal(predictedMorphMs(state, facts), 8000);
  assert.equal(perFrameText(facts), '0.500 seconds per frame');
  assert.equal(perFrameText({ ...facts, frameMs: null }), '2.000 seconds per face');
});
