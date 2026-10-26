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
// A device whose models are already here: these cases are about jobs and inputs, not the download question,
// which an unknown inventory now asks (fm-qrfz, defect 19).
const state = {
  ...initial,
  Downloads: { ...initial.Downloads, known: true, routeReady: true, photoReady: true },
};
test('rememberView follows only structural Inputs/Kind/Frames/Pinch changes', () => {
  for (const message of [
    msg('Edit', 'face-1', 'changed'),
    msg('Mode', 'face-1', 'seed'),
    msg('Kind', 'linear'),
    msg('Frames', 8),
    msg('PinchToggle', false),
  ])
    assert.equal(
      reduce(message, state)!.effects.filter((effect) => effect.type === 'rememberView').length,
      1,
    );
  for (const message of [
    msg('Edit', 'face-1', 'hello'),
    msg('Provider', 'cpu'),
    msg('MoreNames'),
    msg('Kind', state.Kind),
    msg('Frames', state.Frames),
    msg('PinchToggle', state.Pinch),
  ])
    assert.equal(
      reduce(message, state)!.effects.filter((effect) => effect.type === 'rememberView').length,
      0,
    );
  assert.equal(
    reduce(msg('RunFace', 'face-1'), state)!.effects.filter(
      (effect) => effect.type === 'rememberView',
    ).length,
    1,
  );
});
