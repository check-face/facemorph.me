import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { scheduling, scheduled, schedule } from '../../src/controller/reducers/schedule.ts';
import { requestNext } from '../../src/operations/bridge-service.ts';
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
test('the real scheduler skips blocked faces and a blocked morph, preserving remaining order', () => {
  const queued = {
    ...state,
    PreparingFaces: new Set(['face-1']),
    PendingJobs: [msg('RunFace', 'face-1'), msg('Run', 'morph'), msg('RunFace', 'face-2')],
  };
  const plan = scheduling(queued);
  assert.equal(requestNext(plan.jobs, plan.options), 2);
  const selected = scheduled(queued, 2);
  assert.deepEqual(selected.state.PendingJobs, queued.PendingJobs.slice(0, 2));
  assert.deepEqual(selected.effects, [{ type: 'dispatch', message: msg('RunFace', 'face-2') }]);
  assert.equal(scheduled(queued, -1).state, queued);
});
test('scheduling prunes removed targets and preserves commands before continuation', () => {
  const next = schedule(
    { ...state, PendingJobs: [msg('RunFace', 'removed'), msg('RunFace', 'face-1')] },
    [{ type: 'sliderFrames' }],
  );
  assert.deepEqual(next.state.PendingJobs, [msg('RunFace', 'face-1')]);
  assert.deepEqual(next.effects, [{ type: 'sliderFrames' }, { type: 'requestNext' }]);
});
