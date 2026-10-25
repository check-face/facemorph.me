import test from 'node:test';
import assert from 'node:assert/strict';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { photo } from '../../src/controller/reducers/photo.ts';
import { rejection } from '../../src/controller/effects.ts';
import { MULTIPLE_FACES_MESSAGE } from '../../shell/facade/bridge.ts';
import { state, file, offer, recovered } from './photo-inputs.ts';
import { classifyClipboard } from '../../src/photo/source.ts';

test('clipboard classification: image wins over text; malformed selections leave the source unchanged', () => {
  const image = { kind: 'file', type: 'image/png' };
  const text = { kind: 'string', type: 'text/plain' };
  assert.deepEqual(classifyClipboard([image]), { kind: 'image' });
  assert.deepEqual(classifyClipboard([text, image]), { kind: 'image' });
  for (const items of [[], [text], [image, image], [{ kind: 'file', type: 'application/pdf' }]]) {
    const result = classifyClipboard(items);
    assert.equal(result.kind, 'invalid');
    assert.ok('message' in result && result.message.length > 0);
  }
});

test('opening and cancelling source never alters a face or authorizes downloads; chooser cancel keeps it open', () => {
  const opened = reduce(msg('OpenEncode', 'face-2'), state)!;
  assert.deepEqual(opened.state.Encode, { faceId: 'face-2', error: null });
  assert.deepEqual(opened.effects, []);
  assert.equal(opened.state.Inputs, state.Inputs);
  assert.equal(reduce(msg('PickPhoto', 'face-2', []), opened.state)!.state, opened.state);
  const selecting = reduce(msg('PickPhoto', 'face-2', [file('new.jpg')]), opened.state)!;
  const closed = reduce(msg('CloseEncode'), selecting.state)!;
  assert.equal(closed.state.Encode, null);
  assert.equal(closed.state.PreparingFaces.has('face-2'), false);
  assert.equal(closed.state.Inputs, state.Inputs);
  assert.deepEqual(closed.effects, [
    { type: 'invalidatePhotoSelections', id: 'face-2' },
    { type: 'cancelPhotoRun' },
  ]);
  assert.equal(reduce(msg('OpenEncode', 'missing'), state)!.state, state);
});

test('recovery closes source without encoding; direct fresh photos preview before any RunFace', () => {
  const opened = reduce(msg('OpenEncode', 'face-1'), state)!.state;
  const fresh = file('fresh.jpg');
  const preview = reduce(msg('Photo', 'face-1', { kind: 'photo', file: fresh }), opened)!;
  assert.equal(preview.state.Inputs, state.Inputs);
  assert.deepEqual(preview.effects, [{ type: 'previewPhoto', id: 'face-1', file: fresh }]);
  const restored = reduce(
    msg('Photo', 'face-1', { kind: 'recovered', output: recovered }),
    opened,
  )!;
  assert.equal(restored.state.Encode, null);
  assert.ok(
    !restored.effects.some(
      (effect) => effect.type === 'execute' || effect.type === 'downloadModels',
    ),
  );
  const failed = reduce(msg('PhotoFailed', 'face-1', 'Unreadable image'), opened)!;
  assert.equal(failed.state.Encode?.error, 'Unreadable image');
  assert.equal(failed.state.Inputs, state.Inputs);
  assert.equal(failed.state.FailureToast, false);
});

test('a stale crop result cannot change a replacement photo', () => {
  const next = reduce(msg('Cropped', 'face-1', 2, file('older.jpg')), state, { photoRevision: 3 })!;
  assert.equal(next.state, state);
  assert.deepEqual(next.effects, []);
  assert.throws(
    () => photo(msg('Cropped', 'face-1', 2, file('missing-facts.jpg')), state),
    /current revision/,
  );
});
test('accepted photo queues behind a real run but clears cropping-owned Busy', () => {
  const image = file('accepted.jpg');
  const busy = photo(
    msg('Cropped', 'face-1', 2, image),
    { ...state, Busy: true, Stage: 'face' },
    { photoRevision: 2 },
  )!;
  assert.equal(busy.state.Busy, true);
  assert.deepEqual(busy.state.PendingFaces, ['face-1']);
  assert.deepEqual(busy.state.PendingJobs, [msg('RunFace', 'face-1')]);
  assert.ok(!busy.effects.some((effect) => effect.type === 'dispatch'));
  const own = photo(
    msg('Cropped', 'face-1', 2, image),
    { ...state, Busy: true, Stage: 'cropping' },
    { photoRevision: 2 },
  )!;
  assert.equal(own.state.Busy, false);
  assert.equal(own.state.Inputs[0]?.file, image);
  assert.deepEqual(own.effects, [
    { type: 'invalidateFace', id: 'face-1' },
    { type: 'dispatch', message: msg('RunFace', 'face-1') },
  ]);
});
test('a three-file drop uses an empty tile first then appends in drop order', () => {
  const files = ['first.jpg', 'second.jpg', 'third.jpg'].map(file);
  const empty = { ...state, Inputs: [{ ...state.Inputs[0]!, value: '' }, state.Inputs[1]!] };
  const next = photo(msg('Photos', null, files), empty, {
    newPhotoIds: ['new-a', 'new-b', 'unused'],
  })!;
  assert.deepEqual(
    next.state.Inputs.map((input) => input.id),
    ['face-1', 'face-2', 'new-a', 'new-b'],
  );
  assert.deepEqual(next.state.PhotoQueue, [
    ['new-a', files[1]],
    ['new-b', files[2]],
  ]);
  assert.deepEqual(next.effects.at(-1), { type: 'selectPhoto', id: 'face-1', files: [files[0]] });
});
test('selection failure advances pending photos and drops only that face intent', () => {
  const pending = {
    ...state,
    PhotoQueue: [['face-2', file('next.jpg')]] as const,
    PreparingFaces: new Set(['face-1']),
    PendingFaces: ['face-1', 'face-2'],
    PendingJobs: [msg('RunFace', 'face-1'), msg('RunFace', 'face-2')],
  };
  const next = photo(msg('PhotoFailed', 'face-1', 'decode failed'), pending)!;
  assert.equal(next.state.Error, 'decode failed');
  assert.equal(next.state.FailureToast, true);
  assert.deepEqual([...next.state.PreparingFaces], ['face-2']);
  assert.deepEqual(next.state.PendingJobs, [msg('RunFace', 'face-2')]);
  assert.deepEqual(
    next.effects.map((effect) => effect.type),
    ['selectPhoto', 'requestNext'],
  );
});
test('a recovered still restores its slot without any encode or RunFace effect', () => {
  const next = reduce(msg('Photo', 'face-1', { kind: 'recovered', output: recovered }), {
    ...state,
    PreparingFaces: new Set(['face-1']),
  })!;
  assert.deepEqual(next.state.Inputs[0], {
    id: 'face-1',
    mode: 'project',
    value: 'Saved face',
    file: null,
  });
  assert.equal(next.state.PreparingFaces.size, 0);
  assert.ok(
    next.effects.every((effect) => effect.type === 'requestNext' || effect.type === 'rememberView'),
  );
});
test('the actual shared multiple-face error requests a crop through composed reducers', () => {
  const next = reduce(
    msg('Failed', 3, MULTIPLE_FACES_MESSAGE),
    { ...state, Busy: true, JobId: 3, ActiveFace: 'face-1' },
    { multipleFacesMessage: MULTIPLE_FACES_MESSAGE },
  )!;
  assert.equal(next.state.Error, null);
  assert.deepEqual(next.effects, [{ type: 'dispatch', message: msg('RequestCrop', 'face-1') }]);
});
test('photo promise rejections map to PhotoFailed with the original slot and error', () => {
  const image = file('bad.jpg'),
    preview = offer('preview.jpg');
  const error = new Error('decode failed');
  for (const effect of [
    { type: 'selectPhoto', id: 'face-1', files: [image] },
    { type: 'previewPhoto', id: 'face-1', file: image },
    {
      type: 'cropPhoto',
      id: 'face-1',
      file: image,
      revision: 2,
      area: { left: 0, top: 0, width: 1, height: 1 },
      options: { previewScale: 1, rotation: 0 },
    },
    {
      type: 'chooseDetectedFace',
      id: 'face-1',
      revision: 2,
      index: 0,
      choice: {
        id: 'face-1',
        file: image,
        boxes: [],
        url: preview.url,
        previewWidth: 640,
        previewHeight: 480,
        scale: 0.5,
      },
    },
  ] as const)
    assert.deepEqual(rejection(effect, error), msg('PhotoFailed', 'face-1', error.message));
});

test('cancelled chooser and rejected replacement keep the previous result and other faces', () => {
  const face = (id: string) => ({
    id,
    raw: false,
    url: `blob:${id}`,
    label: id,
    sourceMode: 'text',
    sourceFile: null,
  });
  const prior = { ...state, Faces: [face('face-1'), face('face-2')] };
  assert.equal(photo(msg('PickPhoto', 'face-1', []), prior)!.state, prior);
  const pending = photo(msg('PickPhoto', 'face-1', [file('damaged.webp')]), prior)!;
  assert.equal(pending.state.Faces, prior.Faces);
  assert.equal(
    pending.effects.some((effect) => effect.type === 'invalidateFace'),
    false,
  );
  const rejected = photo(
    msg('PhotoFailed', 'face-1', 'This saved image is damaged.'),
    pending.state,
  )!;
  assert.equal(rejected.state.Faces, prior.Faces);
  assert.equal(rejected.state.Inputs, prior.Inputs);
  const imported = photo(
    msg('Photo', 'face-1', {
      kind: 'recovered',
      output: { ...recovered, faces: [face('face-1')] },
    }),
    pending.state,
  )!;
  assert.deepEqual(imported.state.Faces.map((value) => value.id).sort(), ['face-1', 'face-2']);
  assert.equal(
    imported.state.Faces.find((value) => value.id === 'face-2'),
    prior.Faces[1],
  );
});
