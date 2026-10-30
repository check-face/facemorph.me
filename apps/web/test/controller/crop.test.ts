import test from 'node:test';
import assert from 'node:assert/strict';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { crop } from '../../src/controller/reducers/crop.ts';
import { offerCrop } from '../../src/controller/reducers/photo.ts';
import {
  createCrop,
  move,
  resize,
  rotate,
  turnTo,
  rect,
  resizeViewport,
} from '../../src/Next/photo/crop-view.mjs';
import { state, offer } from './photo-inputs.ts';

test('adjust/use/cancel keep one proposal; editor Use Crop never queues encoding', () => {
  const proposal = offerCrop(state, 'face-1', offer('new.jpg')).state;
  const editing = reduce(msg('CropAdjust'), proposal)!.state;
  assert.equal(editing.Crop?.previousView, proposal.Crop?.view);
  const moved = reduce(msg('CropResize', 'nw', 40, 40), editing)!.state;
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
  assert.deepEqual(effect.options, {
    rotation: 0,
    previewScale: proposal.Crop!.scale,
  });
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
  current = crop(msg('CropResize', 'se', -60, -60), current)!.state;
  expected = resize(expected, 'se', -60, -60);
  current = crop(msg('CropPan', 17, -9), current)!.state;
  expected = move(expected, 17, -9);
  current = crop(msg('CropRotate'), current)!.state;
  expected = rotate(expected);
  current = crop(msg('CropTurn', 7.5), current)!.state;
  expected = turnTo(expected, 7.5);
  assert.deepEqual(current.Crop?.view, expected);
  const accepted = crop(msg('CropAccept'), current, { photoRevision: 9 })!;
  const effect = accepted.effects.find((effect) => effect.type === 'cropPhoto');
  assert.ok(effect && effect.type === 'cropPhoto');
  assert.deepEqual(effect.area, rect(expected));
  assert.deepEqual(effect.options, { previewScale: 0.5, rotation: -82.5 });
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

// ---- faces first (fm-k09b, operator ruling 28 October 2026) ----
const withDownloads = (downloads: Partial<typeof state.Downloads>) => ({
  ...state,
  Downloads: {
    ...state.Downloads,
    known: true,
    photoAvailable: true,
    ...downloads,
  },
});
const face = (cx: number, cy: number, side: number, rotation = 0) => ({
  x: cx - side / 2,
  y: cy - side / 2,
  width: side,
  height: side,
  align: { cx, cy, side, rotation },
});

test('a fresh photo runs the detector first when photo processing is ready; its aligned face is the proposal', () => {
  const opened = reduce(
    msg('Photo', 'face-1', { kind: 'crop', offer: offer('one.jpg') }),
    withDownloads({ photoReady: true }),
  )!;
  assert.equal(opened.state.Crop?.detect, 'running');
  const detect = opened.effects.find((e) => e.type === 'detectCropFaces');
  assert.deepEqual(detect, {
    type: 'detectCropFaces',
    id: 'face-1',
    url: 'blob:one.jpg',
    file: opened.state.Crop!.preview,
  });
  // No proposal to accept while it looks.
  assert.equal(reduce(msg('CropAccept'), opened.state, { photoRevision: 1 })!.state, opened.state);
  // A stale answer (another photo's URL) changes nothing.
  const stale = reduce(
    msg('CropDetected', 'face-1', 'blob:other', [face(0.5, 0.5, 0.2)]),
    opened.state,
  )!;
  assert.equal(stale.state, opened.state);
  // 640 x 480 preview: the face at (320, 240), 128 px wide, tilted: the proposal stands it upright.
  const found = reduce(
    msg('CropDetected', 'face-1', 'blob:one.jpg', [face(0.5, 0.5, 0.2, -10)]),
    opened.state,
  )!;
  const view = found.state.Crop!.view;
  assert.equal(found.state.Crop?.detect, 'one');
  assert.deepEqual(
    [view.cx, view.cy, view.side, view.rotation, view.fine],
    [320, 240, 128, -10, -10],
  );
  const accepted = reduce(msg('CropAccept'), found.state, {
    photoRevision: 3,
  })!;
  const effect = accepted.effects.find((e) => e.type === 'cropPhoto');
  assert.ok(effect?.type === 'cropPhoto');
  assert.deepEqual(effect.area, {
    left: 256,
    top: 176,
    width: 128,
    height: 128,
  });
  assert.deepEqual(effect.options, { previewScale: 0.5, rotation: -10 });
  // Several faces (before the chooser takes over): the largest one is the proposal.
  const several = reduce(
    msg('CropDetected', 'face-1', 'blob:one.jpg', [face(0.2, 0.5, 0.1), face(0.7, 0.5, 0.3)]),
    opened.state,
  )!;
  assert.equal(several.state.Crop!.view.cx, 0.7 * 640);
});

test('no face is the failed-to-align screen; a detector that cannot run is a neutral note; OK still encodes once', () => {
  const opened = reduce(
    msg('Photo', 'face-1', { kind: 'crop', offer: offer('none.jpg') }),
    withDownloads({ photoReady: true }),
  )!.state;
  const none = reduce(msg('CropDetected', 'face-1', 'blob:none.jpg', []), opened)!.state;
  assert.equal(none.Crop?.detect, 'none');
  assert.deepEqual(none.Crop?.view, opened.Crop?.view, 'the centred square stays the crop');
  const ok = reduce(msg('CropAccept'), none, { photoRevision: 2 })!;
  assert.equal(ok.effects.filter((e) => e.type === 'cropPhoto').length, 1);
  assert.ok(!ok.effects.some((e) => e.type === 'detectCropFaces'), 'nothing is detected after OK');
  // Adjust, then editor Cancel, returns to the failure screen; Use crop shows the person's crop without it.
  const editing = reduce(msg('CropAdjust'), none)!.state;
  assert.equal(
    reduce(msg('CropCancel'), reduce(msg('CropPan', 9, 0), editing)!.state)!.state.Crop?.detect,
    'none',
  );
  assert.equal(reduce(msg('CropUse'), editing)!.state.Crop?.detect, 'adjusted');
  const failed = reduce(msg('CropDetected', 'face-1', 'blob:none.jpg', null), opened)!.state;
  assert.equal(failed.Crop?.detect, 'not-run');
});

test('missing detector files ask the photo-setup decision once; declining means detection did not run', () => {
  const opened = reduce(
    msg('Photo', 'face-1', { kind: 'crop', offer: offer('ask.jpg') }),
    withDownloads({ photoReady: false }),
  )!;
  assert.equal(opened.state.Crop?.detect, 'waiting');
  assert.deepEqual(opened.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.equal(opened.state.EncoderSetup, 'requested');
  assert.ok(
    !opened.effects.some((e) => e.type === 'detectCropFaces' || e.type === 'downloadModels'),
  );
  const declined = reduce(msg('GateCancel'), opened.state)!.state;
  assert.equal(declined.Gate, null);
  assert.equal(declined.Crop?.detect, 'not-run');
  // Accepted: the setup downloads, then the detector runs as soon as photo processing is ready.
  const accepted = reduce(msg('GateAccept'), opened.state)!.state;
  assert.equal(accepted.Crop?.detect, 'waiting');
  const ready = reduce(
    msg('DownloadsChanged', {
      ...accepted.Downloads,
      phase: 'done',
      photoReady: true,
    }),
    accepted,
  )!;
  assert.equal(ready.state.Crop?.detect, 'running');
  assert.ok(ready.effects.some((e) => e.type === 'detectCropFaces'));
  // A failed download: did not run.
  const failed = reduce(
    msg('DownloadsChanged', {
      ...accepted.Downloads,
      phase: 'failed',
      scope: 'photo',
    }),
    accepted,
  )!.state;
  assert.equal(failed.Crop?.detect, 'not-run');
  // No photo processing on this device: did not run, nothing asked.
  const unavailable = reduce(
    msg('Photo', 'face-1', { kind: 'crop', offer: offer('cpu.jpg') }),
    withDownloads({ photoAvailable: false }),
  )!.state;
  assert.equal(unavailable.Crop?.detect, 'not-run');
  assert.equal(unavailable.Gate, null);
});
