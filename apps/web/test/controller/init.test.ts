import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import type { State } from '../../src/controller/state.ts';
import { checkControl, compareFields, fixture, verifyControl } from './scaffold.ts';
before(verifyControl);
const facts = {
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: false,
  sliderPreference: false,
  sliderPosition: 1,
};
test('init matches the control defaults and describes its subscriptions without I/O', () => {
  const result = init(facts);
  // DownloadsChanged has already arrived in the recording; every other initial field is unchanged.
  compareFields(
    result,
    fixture('first-visit/desktop/01-arrived.json').model,
    (Object.keys(result.state) as (keyof State)[]).filter((key) => key !== 'Downloads'),
  );
  assert.deepEqual(
    result.effects.map((e) => e.type),
    ['restoreLastResult', 'subscribe', 'subscribeDownloads'],
  );
  assert.equal(result.state.ConsentPrompt, true);
  assert.equal(result.state.Downloads.known, false);
});
test('init testing, labs, answered consent, names path and persisted slider choice', () => {
  for (const url of ['https://next.facemorph.me/?testing', 'https://labs.facemorph.me/'])
    assert.equal(init({ ...facts, url }).state.ConsentPrompt, false);
  assert.equal(init({ ...facts, consentAnswered: true }).state.ConsentPrompt, false);
  for (const url of [
    'https://next.facemorph.me/names',
    'https://next.facemorph.me/names/',
    'https://next.facemorph.me/?names',
  ])
    assert.deepEqual(init({ ...facts, url }).effects.at(-1), {
      type: 'dispatch',
      message: { type: 'BrowseNames', args: ['face-1'] },
    });
  const remembered = init({ ...facts, sliderPreference: true, sliderPosition: 7 }).state;
  assert.equal(remembered.UseSlider, true);
  assert.equal(remembered.SliderFrame, 7);
});
test('a control digest mismatch refuses replay', () => {
  const expected = { commit: 'a', release_sha256: 'b', deploy_next_sha256: 'c' };
  assert.throws(
    () => checkControl({ ...expected, release_sha256: 'wrong' }, expected),
    /digest mismatch/,
  );
});
