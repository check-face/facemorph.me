// Plain reducer event inputs; these are not results from a simulated inference service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { Output } from '../../src/controller/state.ts';
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
const output: Output = {
  faces: [],
  videoUrl: '',
  projectJson: '',
  message: 'Completed',
  errorMessage: '',
  restored: false,
  inputs: state.Inputs,
  kind: state.Kind,
  width: state.Width,
  pinch: state.Pinch,
  frames: state.Frames,
  fps: state.Fps,
  photoChoices: null,
  cropFace: null,
  refusal: null,
};
test('old job completion, failure and ordinary progress cannot change a newer run', () => {
  const busy = { ...state, Busy: true, JobId: 2 };
  for (const message of [
    msg('Completed', 1, output),
    msg('Failed', 1, 'synthetic error'),
    msg('Progressed', { jobId: 1, stage: 'synthesis', text: 'old', fraction: 1 }),
  ])
    assert.equal(reduce(message, busy)!.state, busy);
});
test('queued imports and morphs are deduplicated while busy or cropping', () => {
  const file = new Blob(['project']);
  const once = reduce(msg('Import', file), { ...state, Busy: true })!.state;
  assert.equal(reduce(msg('Import', file), once)!.state.PendingJobs.length, 1);
  assert.equal(once.PendingImport, file);
  const cropping = { ...state, PreparingFaces: new Set(['face-2']) };
  const morph = reduce(msg('Run', 'morph'), cropping)!.state;
  assert.equal(morph.PendingMorph, true);
  assert.equal(morph.Busy, false);
  assert.equal(reduce(msg('Run', 'morph'), morph)!.state.PendingJobs.length, 1);
});
test('Cancel changes spoken state; Retry without a remembered run clears only the error', () => {
  const cancelled = reduce(msg('Cancel'), { ...state, Busy: true })!;
  assert.equal(cancelled.state.Stage, 'cancelling');
  assert.equal(cancelled.state.Status, 'Cancelling…');
  assert.deepEqual(cancelled.effects, [{ type: 'cancelWork' }]);
  const retry = reduce(msg('Retry'), { ...state, Error: 'synthetic error', FailureToast: true })!;
  assert.equal(retry.state.Error, null);
  assert.equal(retry.state.FailureToast, false);
  assert.deepEqual(retry.effects, []);
});
test('report/route events remain global, with normal progress retaining its active face ID', () => {
  const busy = { ...state, Busy: true, JobId: 2 };
  const diagnostic = reduce(
    msg('Progressed', { jobId: 0, stage: 'diagnostics-enabled', text: '', fraction: 0 }),
    busy,
  )!.state;
  assert.equal(diagnostic.Busy, true);
  assert.equal(diagnostic.Debug, true);
  const rejected = reduce(
    msg('Progressed', { jobId: 0, stage: 'route-rejected', text: 'webgpu', fraction: 0 }),
    busy,
  )!.state;
  assert.equal(rejected.Rejected, 'webgpu');
  assert.equal(rejected.Busy, true);
  const face = reduce(
    msg('Progressed', {
      jobId: 2,
      stage: 'face',
      text: 'Face 2 of 2',
      fraction: 0,
      face: 'face-2',
    }),
    busy,
  )!.state;
  assert.equal(face.ActiveFace, 'face-2');
});
test('arrival restoration after an edit of the initial face is ignored', () => {
  const edited = reduce(msg('Edit', 'face-1', 'changed'), state)!.state;
  assert.equal(reduce(msg('RestoredLast', { ...output, restored: true }), edited)!.state, edited);
});
test('completion filters removed faces and refuses video for changed morph settings', () => {
  const started = reduce(msg('Run', 'morph'), state)!.state;
  const changed = { ...started, Frames: 8 };
  const next = reduce(
    msg('Completed', started.JobId, { ...output, videoUrl: 'blob:recorded-input' }),
    changed,
  )!;
  assert.equal(next.state.VideoUrl, '');
  assert.equal(next.state.Busy, false);
  assert.equal(next.effects.at(-1)?.type, 'requestNext');
});
