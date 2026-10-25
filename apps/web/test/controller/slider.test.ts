import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { slider } from '../../src/controller/reducers/slider.ts';
import { compareFields, fixture, fromGolden, verifyControl } from './scaffold.ts';
before(verifyControl);
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: true,
  sliderPosition: 7,
}).state;
test('hiding and showing retains position and requests frames only when needed', () => {
  const off = slider(msg('UseSliderToggle', false), { ...state, VideoUrl: 'video' })!;
  const on = slider(msg('UseSliderToggle', true), off.state)!;
  assert.equal(on.state.SliderFrame, 7);
  assert.deepEqual(off.effects, [{ type: 'rememberSlider', enabled: false, frame: 7 }]);
  assert.deepEqual(on.effects, [
    { type: 'rememberSlider', enabled: true, frame: 7 },
    { type: 'sliderFrames' },
  ]);
  const loaded = slider(msg('SliderLoaded', ['frame']), on.state)!.state;
  assert.equal(slider(msg('UseSliderToggle', true), loaded)!.effects.length, 1);
  assert.equal(slider(msg('UseSliderToggle', true), state)!.effects.length, 1);
  assert.equal(slider(msg('SliderLoaded', null), loaded)!.state.SliderFrames, null);
});
test('SliderFrameSet clamps zero to one and remembers the current toggle', () => {
  const result = slider(msg('SliderFrameSet', 0), { ...state, UseSlider: false })!;
  assert.equal(result.state.SliderFrame, 1);
  assert.deepEqual(result.effects, [{ type: 'rememberSlider', enabled: false, frame: 1 }]);
});
test('recorded slider end transition replays exactly on desktop and phone', () => {
  for (const device of ['desktop', 'phone']) {
    const prior = fromGolden(fixture(`morph.play-slider/${device}/01-slider.json`).model);
    const golden = fixture(`morph.play-slider/${device}/02-scrubbed-to-end.json`).model;
    const result = slider(msg('SliderFrameSet', Number(golden.SliderFrame)), prior)!;
    compareFields(result, golden, ['SliderFrame', 'SliderFrames', 'UseSlider', 'VideoUrl']);
    assert.deepEqual(result.effects, [{ type: 'rememberSlider', enabled: true, frame: 16 }]);
  }
});
