import assert from 'node:assert/strict';
import test from 'node:test';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { retainedPhotoBytes } from '../../src/controller/admission.ts';
import { state as initial, file } from './photo-inputs.ts';
import type { State } from '../../src/controller/state.ts';

const source = file('retained.jpg');
const photo = {
  ...initial.Inputs[0]!,
  mode: 'photo' as const,
  file: source,
  value: 'retained.jpg',
};
const state: State = {
  ...initial,
  Inputs: [photo, initial.Inputs[1]!],
  Downloads: { ...initial.Downloads, known: true, photoAvailable: true },
  Gate: ['photo', msg('RunFace', photo.id)],
};
const pause = () => reduce(msg('GateAccept', 'route'), state)!;

test('Generate-only approves no encoder and retains the exact inspected photo under its byte ceiling', () => {
  const next = pause();
  assert.equal(next.state.Gate, null);
  assert.deepEqual([...next.state.DownloadConsent], ['route']);
  assert.equal(next.state.PausedPhotos?.get(photo.id), photo);
  assert.equal(next.state.PausedPhotos?.get(photo.id)?.file, source);
  assert.equal(next.state.Inputs[0]?.mode, 'text');
  assert.equal(next.state.Inputs[0]?.file, null);
  assert.equal(next.state.Inputs[1], state.Inputs[1]);
  assert.equal(retainedPhotoBytes(next.state), source.size);
  assert.match(next.state.Status, /Encoding needs the photo encoder/);
  assert.deepEqual(
    next.effects.filter((effect) => effect.type !== 'rememberView'),
    [{ type: 'downloadModels', includePhoto: false }],
  );
});

test('editing useful generation text keeps the deferred source; resume restores exact source and requires photo approval', () => {
  const paused = pause().state;
  const edited = reduce(msg('Edit', photo.id, 'A useful face'), paused)!.state;
  assert.equal(edited.Inputs[0]?.value, 'A useful face');
  assert.equal(edited.PausedPhotos?.get(photo.id)?.file, source);
  const resumed = reduce(msg('ResumePhoto', photo.id), edited)!;
  assert.equal(resumed.state.Inputs[0], photo);
  assert.equal(resumed.state.PausedPhotos?.size, 0);
  assert.ok(
    resumed.effects.some(
      (effect) => effect.type === 'dispatch' && effect.message.type === 'RunFace',
    ),
  );
  const run = reduce(msg('RunFace', photo.id), resumed.state)!;
  assert.deepEqual(run.effects, [{ type: 'checkCachedFace', input: photo }]);
  const miss = reduce(msg('CachedFaceChecked', photo, false), run.state)!;
  assert.deepEqual(miss.state.Gate, ['photo', msg('RunFace', photo.id)]);
  assert.equal(miss.state.DownloadConsent.has('photo'), false);
});

test('late resume cannot target a removed face, and Remove/Undo retains the source only until committed', () => {
  const paused = pause().state;
  const removed = reduce(msg('Remove', photo.id), paused)!.state;
  assert.equal(removed.PausedPhotos?.get(photo.id)?.file, source);
  assert.equal(retainedPhotoBytes(removed), source.size);
  assert.deepEqual(reduce(msg('ResumePhoto', photo.id), removed)!.effects, []);
  const undone = reduce(msg('Undo'), removed)!.state;
  assert.equal(undone.PausedPhotos?.get(photo.id)?.file, source);
  const expired = reduce(msg('UndoExpired', removed.Undo!.seq), removed)!.state;
  assert.equal(expired.PausedPhotos?.size, 0);
  assert.equal(retainedPhotoBytes(expired), 0);
});

test('a cancelled chooser preserves the source; a confirmed replacement releases it', () => {
  const paused = pause().state;
  const cancelled = reduce(msg('PickPhoto', photo.id, []), paused)!.state;
  assert.equal(cancelled.PausedPhotos?.get(photo.id)?.file, source);
  const replacement = file('replacement.jpg');
  const replaced = reduce(msg('Cropped', photo.id, 1, replacement), paused, {
    photoRevision: 1,
  })!.state;
  assert.equal(replaced.PausedPhotos?.size, 0);
  assert.equal(replaced.Inputs[0]?.file, replacement);
  assert.equal(retainedPhotoBytes(replaced), replacement.size);
});

test('a selected combined bundle for generation starts optional setup but continues only the original action', () => {
  const pending = msg('RunFace', 'face-2');
  const next = reduce(msg('GateAccept', 'photo'), { ...state, Gate: ['route', pending] })!;
  assert.deepEqual([...next.state.DownloadConsent], ['photo', 'route']);
  assert.equal(next.state.EncoderSetup, 'active');
  assert.deepEqual(next.effects, [
    { type: 'downloadModels', includePhoto: true },
    { type: 'consentToDownload', scope: 'photo' },
    { type: 'dispatch', message: pending },
  ]);
  const unavailable = { ...state, Downloads: { ...state.Downloads, photoAvailable: false } };
  assert.equal(reduce(msg('GateAccept', 'photo'), unavailable)!.state, unavailable);
});

test('Generate-only from optional setup never starts encoder setup', () => {
  const next = reduce(msg('GateAccept', 'route'), {
    ...state,
    Gate: ['photo', msg('DownloadNow', true)],
  })!;
  assert.deepEqual([...next.state.DownloadConsent], ['route']);
  assert.equal(next.state.EncoderSetup, 'cancelled');
  assert.deepEqual(next.effects, [{ type: 'dispatch', message: msg('DownloadNow', false) }]);
});
