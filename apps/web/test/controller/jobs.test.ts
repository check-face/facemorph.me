// Plain reducer event inputs; these are not results from a simulated inference service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { cancelled as settleCancelled } from '../../src/controller/reducers/jobs.ts';
import type { Output } from '../../src/controller/state.ts';
const initial = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
// A device whose models are already here: these cases are about jobs and inputs, not the download question,
// which an unknown inventory now asks (fm-qrfz, defect 19).
const state = {
  ...initial,
  Downloads: { ...initial.Downloads, known: true, routeReady: true, photoReady: true },
};
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
test('a repeated Morph press while that morph runs is the same intent; a morph behind a face still queues (fm-8w99)', () => {
  const started = reduce(msg('Run', 'morph'), state)!.state;
  assert.equal(started.Busy, true);
  const again = reduce(msg('Run', 'morph'), started)!;
  assert.equal(again.state, started, 'no second morph is queued behind the running one');
  assert.deepEqual(again.effects, []);
  // Behind a face job, or after a setting changed, Morph is still queued as before.
  const face = reduce(msg('RunFace', 'face-1'), state)!.state;
  assert.equal(reduce(msg('Run', 'morph'), face)!.state.PendingMorph, true);
  const changed = { ...started, Frames: started.Frames === 8 ? 16 : 8 };
  assert.equal(reduce(msg('Run', 'morph'), changed)!.state.PendingMorph, true);
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
test('cancelled and failed morphs preserve unfinished progress; the failure belongs beside Morph', () => {
  const run = reduce(msg('Run', 'morph'), state)!.state;
  const partial = { ...run, Fraction: 0.625 };
  const stopped = settleCancelled(partial, run.JobId).state;
  assert.equal(stopped.Fraction, 0.625, 'cancellation cannot claim complete');
  assert.equal(stopped.Faces, partial.Faces);
  const failed = reduce(msg('Failed', run.JobId, 'Retry this morph.'), partial)!.state;
  assert.equal(failed.Fraction, 0.625, 'failure cannot reset the attempt');
  assert.equal(failed.Status, 'Retry this morph.');
  assert.equal(failed.Error, failed.Status, 'diagnostics retain the same failure');
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
test('a file outside the approval asks again for the run that needed it; other failures stay failures (fm-qrfz)', () => {
  const run = msg('Run', 'morph');
  const running = {
    ...state,
    Busy: true,
    JobId: 7,
    LastRun: run,
    DownloadConsent: new Set(['route']),
  };
  const refused = reduce(
    msg(
      'Failed',
      7,
      'Model file 3d27df84fd1b is not covered by an approved download (out-of-scope).',
    ),
    running,
  )!;
  assert.deepEqual(refused.state.Gate, ['route', run]);
  assert.equal(
    refused.state.DownloadConsent.size,
    0,
    'the earlier approval no longer covers this run',
  );
  assert.equal(refused.state.Busy, false);
  assert.equal(refused.state.Error, null);
  assert.deepEqual(refused.effects, []);
  const over = reduce(
    msg(
      'Failed',
      7,
      'This download needs more data than was approved. Approve the download again to continue.',
    ),
    running,
  )!;
  assert.deepEqual(over.state.Gate, ['route', run]);
  const failed = reduce(msg('Failed', 7, 'The local generation engine stopped.'), running)!;
  assert.equal(failed.state.Gate, null);
  assert.equal(failed.state.Error, 'The local generation engine stopped.');
});
// fm-9kr8: a model download that fails after approval says what failed in plain words; the error box adds what was
// kept and what remains against the consent's own figure, as the bridge re-measured the verified files; storage is
// worded as storage; other failures are untouched.
test('acquisition failures are plain, count kept and remaining bytes, and keep Try again (fm-9kr8)', async () => {
  const { downloadKept } = await import('../../src/controller/derived.ts');
  const { isAcquisitionFailure } = await import('../../src/controller/reducers/jobs.ts');
  const MiB = 1024 * 1024;
  const running = {
    ...state,
    Busy: true,
    JobId: 11,
    LastRun: msg('RunFace', 'face-1'),
    ApprovedBytes: 158 * MiB,
    DownloadConsent: new Set(['route']),
  };
  const fault = reduce(
    msg(
      'Failed',
      11,
      'The model download server had a temporary fault (HTTP 500). Parts already downloaded are kept: try again in a few minutes.',
    ),
    running,
  )!.state;
  assert.match(fault.Error!, /^The model download server had a temporary fault \(HTTP 500\)/);
  assert.ok(isAcquisitionFailure(fault.Error));
  assert.ok(fault.LastRun, 'Try again stays offered');
  assert.equal(
    downloadKept(fault),
    null,
    'no kept figure until the verified files are re-measured',
  );
  // The bridge's re-measured inventory after the failure: 136 MB still missing.
  const measured = reduce(
    msg('DownloadsChanged', {
      ...fault.Downloads,
      known: true,
      routeReady: false,
      routeBytes: 136 * MiB,
    }),
    fault,
  )!.state;
  assert.deepEqual(downloadKept(measured), { kept: '22 MB', total: '158 MB', remaining: '136 MB' });
  const damaged = reduce(msg('Failed', 11, 'Asset integrity mismatch'), running)!.state;
  assert.match(damaged.Error!, /^A downloaded model file arrived damaged, so it was not used\./);
  assert.doesNotMatch(damaged.Error!, /integrity/i, 'plain words');
  const full = reduce(
    msg(
      'Failed',
      11,
      'Not enough browser storage to save this model. Free some storage and try again.',
    ),
    running,
  )!.state;
  assert.match(full.Error!, /ran out of browser storage/);
  assert.doesNotMatch(full.Error!, /device cannot|not supported|capab/i, 'storage, not capability');
  const other = reduce(msg('Failed', 11, 'The local generation engine stopped.'), running)!.state;
  assert.equal(other.Error, 'The local generation engine stopped.');
  assert.equal(isAcquisitionFailure(other.Error), false);
});
