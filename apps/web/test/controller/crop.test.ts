import test from 'node:test';
import assert from 'node:assert/strict';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { crop } from '../../src/controller/reducers/crop.ts';
import { offerCrop } from '../../src/controller/reducers/photo.ts';
import {
  createCrop,
  pan,
  zoomTo,
  rotate,
  rect,
  resizeViewport,
} from '../../src/Next/photo/crop-view.mjs';
import { state, offer } from './photo-inputs.ts';

test('adjust/use/cancel keep one proposal; editor Use Crop never queues encoding', () => {
  const proposal = offerCrop(state, 'face-1', offer('new.jpg')).state;
  const editing = reduce(msg('CropAdjust'), proposal)!.state;
  assert.equal(editing.Crop?.previousView, proposal.Crop?.view);
  const moved = reduce(msg('CropZoom', 2), editing)!.state;
  assert.notDeepEqual(moved.Crop?.view, proposal.Crop?.view);
  assert.equal(reduce(msg('CropAccept'), moved)!.state, moved);
  const back = reduce(msg('CropCancel'), moved)!;
  assert.deepEqual(back.state.Crop, proposal.Crop);
  assert.deepEqual(back.effects, []);
  const used = reduce(msg('CropUse'), moved)!;
  assert.equal(used.state.Crop?.previousView, undefined);
  assert.equal(used.state.Crop?.view, moved.Crop?.view);
  assert.deepEqual(used.effects, []);
});

test('OK snapshots crop geometry and revision once; repeated OK and Cancel cannot produce more work', () => {
  const proposal = offerCrop(state, 'face-1', offer('frozen.jpg')).state;
  const accepted = reduce(msg('CropAccept'), proposal, { photoRevision: 41 })!;
  const effect = accepted.effects.find((effect) => effect.type === 'cropPhoto');
  assert.ok(effect?.type === 'cropPhoto');
  assert.deepEqual(effect.area, rect(proposal.Crop!.view));
  assert.deepEqual(effect.options, { rotation: 0, previewScale: proposal.Crop!.scale });
  assert.equal(effect.revision, 41);
  assert.ok(Object.isFrozen(effect.area));
  assert.ok(Object.isFrozen(effect.options));
  assert.equal(accepted.state.Crop, null);
  assert.equal(accepted.state.PreparingFaces.has('face-1'), true);
  let next = accepted.state;
  for (let tap = 0; tap < 3; tap++) {
    const again = reduce(msg('CropAccept'), next, { photoRevision: 42 })!;
    assert.deepEqual(again.effects, []);
    next = again.state;
  }
  const cancelled = reduce(msg('CropCancel'), proposal)!;
  assert.equal(cancelled.state.Crop, null);
  assert.equal(cancelled.state.Inputs, state.Inputs);
  assert.ok(
    !cancelled.effects.some((item) => item.type === 'cropPhoto' || item.type === 'execute'),
  );
  assert.ok(cancelled.effects.some((item) => item.type === 'invalidatePhotoSelections'));
});

test('different crop offers retain their queue order and only same-slot replacement releases a URL', () => {
  const threeInputs = {
    ...state,
    Inputs: [...state.Inputs, { id: 'face-3', mode: 'text' as const, value: '', file: null }],
  };
  const one = offerCrop(threeInputs, 'face-1', offer('one.jpg'));
  const two = offerCrop(one.state, 'face-2', offer('two.jpg'));
  const three = offerCrop(two.state, 'face-3', offer('three.jpg'));
  assert.deepEqual(
    three.state.CropQueue.map((choice) => choice.faceId),
    ['face-2', 'face-3'],
  );
  assert.deepEqual(two.effects, []);
  assert.deepEqual(three.effects, []);
  const replacement = offerCrop(three.state, 'face-1', offer('replacement.jpg'));
  assert.equal(replacement.state.Crop?.url, 'blob:replacement.jpg');
  assert.deepEqual(replacement.effects, [
    { type: 'revokeUrl', url: 'blob:one.jpg' },
    { type: 'focusCropArea' },
  ]);
  assert.equal(replacement.state.CropQueue, three.state.CropQueue);
});
test('cancel and accept expose the next crop immediately; a crop failure cannot strand it', () => {
  const queued = offerCrop(
    offerCrop(state, 'face-1', offer('one.jpg')).state,
    'face-2',
    offer('two.jpg'),
  ).state;
  for (const exit of [msg('CropCancel'), msg('CropAccept')]) {
    const next = crop(exit, queued, { photoRevision: 7 })!;
    assert.equal(next.state.Crop?.faceId, 'face-2');
    assert.equal(next.state.CropQueue.length, 0);
    assert.equal(next.effects.filter((effect) => effect.type === 'focusCropArea').length, 1);
    assert.equal(next.effects.filter((effect) => effect.type === 'revokeUrl').length, 1);
    if (exit.type === 'CropAccept') {
      const failed = reduce(msg('PhotoFailed', 'face-1', 'crop decode failed'), next.state)!;
      assert.equal(failed.state.Crop, next.state.Crop);
      assert.equal(failed.state.PreparingFaces.has('face-1'), false);
    }
  }
});
test('crop editing forwards the recorded geometry policy to retained pure math', () => {
  const preview = offer('geometry.jpg');
  let current = offerCrop(state, 'face-1', preview).state;
  let expected = createCrop({
    previewWidth: preview.previewWidth,
    previewHeight: preview.previewHeight,
    scale: preview.scale,
    viewport: 320,
  });
  current = crop(msg('CropViewport', 260), current)!.state;
  expected = resizeViewport(expected, 260);
  current = crop(msg('CropZoom', 2.5), current)!.state;
  expected = zoomTo(expected, 2.5);
  current = crop(msg('CropPan', 17, -9), current)!.state;
  expected = pan(expected, 17, -9);
  current = crop(msg('CropRotate'), current)!.state;
  expected = rotate(expected);
  assert.deepEqual(current.Crop?.view, expected);
  const accepted = crop(msg('CropAccept'), current, { photoRevision: 9 })!;
  const effect = accepted.effects.find((effect) => effect.type === 'cropPhoto');
  assert.ok(effect && effect.type === 'cropPhoto');
  assert.deepEqual(effect.area, rect(expected));
  assert.deepEqual(effect.options, { previewScale: 0.5, rotation: 90 });
  assert.equal(effect.revision, 9);
});
test('RequestCrop preserves the active run and uses the actual stored photo for an idle slot', () => {
  const image = offer('source.jpg').file;
  const source = {
    ...state,
    Inputs: [{ ...state.Inputs[0]!, mode: 'photo' as const, file: image }],
  };
  assert.deepEqual(crop(msg('RequestCrop', 'face-1'), source)!.effects, [
    { type: 'previewPhoto', id: 'face-1', file: image },
  ]);
  const active = { ...source, ActiveFace: 'face-1' };
  assert.equal(crop(msg('RequestCrop', 'face-1'), active)!.state, active);
  assert.deepEqual(crop(msg('RequestCrop', 'missing'), source)!.effects, []);
});

test('a changed or removed target invalidates an uncommitted proposal', () => {
  const proposal = offerCrop(state, 'face-1', offer('source.jpg')).state;
  for (const inputs of [
    state.Inputs.slice(1),
    state.Inputs.map((item) => (item.id === 'face-1' ? { ...item, value: 'changed' } : item)),
  ]) {
    const accepted = reduce(
      msg('CropAccept'),
      { ...proposal, Inputs: inputs },
      { photoRevision: 7 },
    )!;
    assert.equal(accepted.state.Crop, null);
    assert.ok(!accepted.effects.some((effect) => effect.type === 'cropPhoto'));
    assert.ok(accepted.effects.some((effect) => effect.type === 'revokeUrl'));
  }
});
