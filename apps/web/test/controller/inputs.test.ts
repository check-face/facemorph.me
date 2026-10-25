import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { inputs } from '../../src/controller/reducers/inputs.ts';
import { CASES, reduce } from '../../src/controller/reducers/index.ts';
import { compareFields, fixture, fromGolden, verifyControl } from './scaffold.ts';
before(verifyControl);
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: false,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
test('recorded seed edit replays exactly on desktop and phone', () => {
  for (const device of ['desktop', 'phone']) {
    const prior = fromGolden(fixture(`seed.generate/${device}/01-seed-mode.json`).model);
    const next = fixture(`seed.generate/${device}/02-typed-0.json`).model;
    const result = inputs(msg('Edit', 'face-2', '0'), prior)!;
    compareFields(result, next, ['Inputs', 'Faces', 'VideoUrl', 'Status', 'CachedFaces']);
    assert.deepEqual(
      result.effects.map((e) => e.type),
      ['invalidateArrivalRestore', 'invalidatePhotoSelections', 'invalidateFace', 'publicPreview'],
    );
  }
});
test('remove of the last face is a no-op; queued removal drops only its job and preserves effect order', () => {
  const last = { ...state, Inputs: state.Inputs.slice(0, 1) };
  assert.equal(inputs(msg('Remove', 'face-1'), last)!.state, last);
  const queued = {
    ...state,
    PendingFaces: ['face-1', 'face-2'],
    PendingJobs: [msg('RunFace', 'face-1'), msg('Run', 'morph'), msg('RunFace', 'face-2')],
  };
  const result = inputs(msg('Remove', 'face-1'), queued)!;
  assert.deepEqual(result.state.PendingJobs, [msg('Run', 'morph'), msg('RunFace', 'face-2')]);
  assert.deepEqual(result.state.PendingFaces, ['face-2']);
  assert.deepEqual(result.effects, [
    { type: 'invalidateFace', id: 'face-1' },
    { type: 'rememberSourcePhoto', id: 'face-1', file: null },
    { type: 'invalidatePhotoSelections', id: 'face-1' },
  ]);
});
test('AddAt permits 63 to 64, then makes no state change; busy Provider is ignored', () => {
  const many = {
    ...state,
    Inputs: Array.from({ length: 63 }, (_, i) => ({
      id: `old-${i}`,
      mode: 'text' as const,
      value: '',
      file: null,
    })),
  };
  const full = inputs(msg('AddAt', 1), many, { newFaceId: 'face-fresh-id' })!.state;
  assert.equal(full.Inputs.length, 64);
  assert.equal(full.Inputs[1]?.id, 'face-fresh-id');
  assert.equal(inputs(msg('AddAt', 0), full)!.state, full);
  const busy = { ...state, Busy: true };
  assert.equal(inputs(msg('Provider', 'webgpu'), busy)!.state, busy);
});
test('Kind, Pinch and Frames invalidate morph once and clear the slider frames', () => {
  for (const message of [msg('Kind', 'linear'), msg('PinchToggle', false), msg('Frames', 32)]) {
    const result = inputs(message, { ...state, SliderFrames: ['frame'], VideoUrl: 'video' })!;
    assert.equal(result.state.VideoUrl, '');
    assert.equal(result.state.SliderFrames, null);
    assert.deepEqual(result.effects, [{ type: 'invalidateMorph' }]);
  }
});
test('cached completion belongs to the exact input that requested the check', () => {
  const input = state.Inputs[0]!;
  const checked = inputs(msg('CachedFaceChecked', input, true), state)!;
  assert.equal(checked.state.CachedFaces.has(input.id), true);
  assert.equal(checked.effects[0]?.type, 'dispatch');
  const edited = { ...state, Inputs: state.Inputs.map((i) => ({ ...i, value: 'changed' })) };
  assert.equal(inputs(msg('CachedFaceChecked', input, true), edited)!.state, edited);
});
test('all 64 frozen messages have explicit ownership; future slices are never silently dropped', () => {
  assert.equal(Object.keys(CASES).length, 64);
  assert.equal(reduce(msg('Cancel'), state), null);
  assert.equal(reduce(msg('CropAccept'), state), null);
  assert.equal(reduce(msg('Provider', 'cpu'), state)!.state.Provider, 'cpu');
  assert.throws(() => reduce(msg('AddAt', 1), state), /fresh face ID/);
  assert.throws(() => reduce(msg('AddAt', 1), state, { newFaceId: 'face-1' }), /fresh face ID/);
});
test('word edits and boundary seeds replay the recorded input and invalidation fields', () => {
  for (const device of ['desktop', 'phone']) {
    for (const [before, after] of [
      [
        `words.generate-cpu/${device}/01-arrived.json`,
        `words.generate-cpu/${device}/02-typed.json`,
      ],
      [
        `seed.generate/${device}/03-generated-0.json`,
        `seed.generate/${device}/04-typed-4294967295.json`,
      ],
    ]) {
      const prior = fromGolden(fixture(before!).model);
      const golden = fixture(after!).model;
      const nextInput = (golden.Inputs as typeof state.Inputs).find((i) => i.id === 'face-2')!;
      const result = inputs(msg('Edit', nextInput.id, nextInput.value), prior)!;
      compareFields(result, golden, ['Inputs', 'Faces', 'Status', 'VideoUrl', 'CachedFaces']);
      assert.equal(JSON.stringify(result.effects).includes(nextInput.value), false);
    }
  }
});
