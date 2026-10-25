import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
const initial = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
const state = { ...initial, Downloads: { ...initial.Downloads, known: true } };
test('cold RunFace checks verified cache before asking for acquisition', () => {
  const first = reduce(msg('RunFace', 'face-1'), state)!;
  assert.equal(first.state, state);
  assert.deepEqual(first.effects, [{ type: 'checkCachedFace', input: state.Inputs[0] }]);
  const miss = reduce(msg('CachedFaceChecked', state.Inputs[0]!, false), state)!.state;
  assert.deepEqual(miss.Gate, ['route', msg('RunFace', 'face-1')]);
  assert.equal(miss.Busy, false);
});
test('photo consent grants photo and route before dispatching the original intent', () => {
  const pending = msg('RunFace', 'face-2');
  const accepted = reduce(msg('GateAccept'), { ...state, Gate: ['photo', pending] })!;
  assert.deepEqual([...accepted.state.DownloadConsent], ['photo', 'route']);
  assert.equal(accepted.state.Gate, null);
  assert.equal(accepted.state.ModelToastHidden, true);
  assert.deepEqual(accepted.effects, [
    { type: 'consentToDownload', scope: 'photo' },
    { type: 'dispatch', message: pending },
  ]);
  assert.equal(reduce(msg('GateCancel'), { ...state, Gate: ['route', pending] })!.state.Gate, null);
});
test('morph/import gate directly; download and inventory changes retain candidate scope', () => {
  for (const message of [msg('Run', 'morph'), msg('Import', new Blob(['project']))])
    assert.deepEqual(reduce(message, state)!.state.Gate, ['route', message]);
  const all = reduce(msg('DownloadNow', true), state)!;
  assert.equal(all.state.DownloadConsent.has('route'), true);
  assert.equal(all.state.DownloadConsent.has('photo'), true);
  assert.deepEqual(all.effects, [{ type: 'downloadModels', includePhoto: true }]);
  const failed = { ...state.Downloads, phase: 'failed' };
  assert.equal(reduce(msg('DownloadsChanged', failed), state)!.state.Downloads, failed);
  assert.equal(reduce(msg('HideModelToast'), state)!.state.ModelToastHidden, true);
});
