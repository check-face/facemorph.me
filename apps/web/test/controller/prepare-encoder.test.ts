// Plain controller lifecycle inputs; acquisition and real pointer journeys are qualified separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { offerCrop } from '../../src/controller/reducers/photo.ts';
import type { State } from '../../src/controller/state.ts';
import { state as initial, offer } from './photo-inputs.ts';

const state: State = {
  ...initial,
  Downloads: { ...initial.Downloads, known: true, photoAvailable: true, photoReady: false },
};
const prepare = (input: State = state) => reduce(msg('PrepareEncoder'), input)!;
const approve = (input: State = state) => reduce(msg('GateAccept'), prepare(input).state)!;

test('Prepare encoder only opens explicit photo consent without acquiring or authorizing anything', () => {
  const asked = prepare();
  assert.deepEqual(asked.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.equal(asked.state.EncoderSetup, 'requested');
  assert.equal(asked.state.DownloadConsent, state.DownloadConsent);
  assert.equal(asked.state.Inputs, state.Inputs);
  assert.deepEqual(asked.effects, []);
  assert.equal(
    prepare(asked.state).state,
    asked.state,
    'a second press cannot replace its question',
  );
  for (const downloads of [
    { ...state.Downloads, known: false },
    { ...state.Downloads, photoAvailable: false },
    { ...state.Downloads, photoReady: true },
  ]) {
    const ineligible = { ...state, Downloads: downloads };
    assert.equal(prepare(ineligible).state, ineligible);
    assert.deepEqual(prepare(ineligible).effects, []);
  }
  const cardQuestion: State = { ...state, Gate: ['route', msg('RunFace', 'face-1')] };
  assert.equal(
    prepare(cardQuestion).state,
    cardQuestion,
    'an unrelated card decision is preserved',
  );
});

test('explicit GateAccept starts only the selected setup through the existing DownloadNow continuation', () => {
  const accepted = approve();
  assert.equal(accepted.state.EncoderSetup, 'active');
  assert.equal(accepted.state.Gate, null);
  assert.deepEqual(accepted.effects, [{ type: 'dispatch', message: msg('DownloadNow', true) }]);
  const started = reduce(msg('DownloadNow', true), accepted.state)!;
  assert.deepEqual(started.effects, [{ type: 'downloadModels', includePhoto: true }]);
  assert.equal(started.state.DownloadConsent.has('route'), true);
  assert.equal(started.state.DownloadConsent.has('photo'), true);
  assert.equal(started.state.EncoderSetup, 'active');
  assert.equal(prepare(started.state).state, started.state, 'active setup cannot be duplicated');
});

test('Cancel setup cancels its acquisition only and retains local source, crop and independent actions', () => {
  const cropped = offerCrop(approve().state, 'face-1', offer('kept.jpg')).state;
  const pending = [msg('RunFace', 'face-2')];
  const owned: State = {
    ...cropped,
    PendingJobs: pending,
    PendingFaces: ['face-2'],
    Gate: ['route', msg('RunFace', 'face-2')],
    DownloadConsent: new Set(['route', 'photo', 'independent']),
  };
  const cancelled = reduce(msg('CancelEncoderSetup'), owned)!;
  assert.deepEqual(cancelled.effects, [{ type: 'cancelDownloadSetup' }]);
  assert.equal(cancelled.state.EncoderSetup, 'cancelled');
  assert.deepEqual([...cancelled.state.DownloadConsent], ['route', 'independent']);
  // The crop stays open with its source; its faces-first detection did not run (fm-k09b), a neutral note.
  assert.deepEqual(cancelled.state.Crop, { ...owned.Crop, detect: 'not-run' });
  assert.equal(cancelled.state.Crop?.file, owned.Crop?.file);
  assert.equal(cancelled.state.Inputs, owned.Inputs);
  assert.equal(cancelled.state.Faces, owned.Faces);
  assert.equal(cancelled.state.Gate, owned.Gate);
  assert.equal(cancelled.state.PendingJobs, pending);
  assert.equal(cancelled.state.PendingFaces, owned.PendingFaces);
  const repeated = reduce(msg('CancelEncoderSetup'), cancelled.state)!;
  assert.equal(repeated.state, cancelled.state);
  assert.deepEqual(repeated.effects, []);
});

test('modal cancellation abandons only the pending setup and a later Prepare asks again', () => {
  const asked = prepare();
  for (const message of [msg('GateCancel'), msg('CancelEncoderSetup')]) {
    const cancelled = reduce(message, asked.state)!;
    assert.equal(cancelled.state.Gate, null);
    assert.equal(cancelled.state.EncoderSetup, 'cancelled');
    assert.equal(cancelled.state.DownloadConsent.has('photo'), false);
    assert.deepEqual(cancelled.effects, [{ type: 'cancelDownloadSetup' }]);
    assert.deepEqual(reduce(msg('GateAccept'), cancelled.state)!.effects, []);
    const askedAgain = prepare(cancelled.state);
    assert.deepEqual(askedAgain.state.Gate, ['photo', msg('DownloadNow', true)]);
    assert.equal(askedAgain.state.EncoderSetup, 'requested');
    assert.deepEqual(askedAgain.effects, []);
  }
});

test('card chooser, add-file chooser and crop cancellation preserve independent page setup', () => {
  const active = approve().state;
  for (const message of [msg('PickPhoto', 'face-1', []), msg('Photos', null, [])]) {
    const cancelled = reduce(message, active)!;
    assert.equal(cancelled.state.EncoderSetup, 'active');
    assert.equal(cancelled.state.DownloadConsent, active.DownloadConsent);
    assert.deepEqual(cancelled.effects, []);
  }
  const cropped = offerCrop(active, 'face-1', offer('cancelled-card.jpg')).state;
  const cancelled = reduce(msg('CropCancel'), cropped)!;
  assert.equal(cancelled.state.Crop, null);
  assert.equal(cancelled.state.EncoderSetup, 'active');
  assert.equal(cancelled.state.DownloadConsent, active.DownloadConsent);
  assert.ok(!cancelled.effects.some((effect) => effect.type === 'cancelDownloadSetup'));
});

test('a revised page setup waits behind a card decision and needs a new explicit approval', () => {
  const active = approve().state;
  const card: State = { ...active, Gate: ['route', msg('RunFace', 'face-2')] };
  const revised = reduce(
    msg('DownloadsChanged', { ...state.Downloads, phase: 'waiting', photoApprovalRequired: true }),
    card,
  )!;
  assert.equal(revised.state.Gate, card.Gate);
  assert.equal(revised.state.EncoderSetup, 'active');
  assert.equal(revised.state.DownloadConsent.has('photo'), false);
  assert.deepEqual(revised.effects, []);
  const dismissedCard = reduce(msg('GateCancel'), revised.state)!;
  assert.deepEqual(dismissedCard.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.equal(dismissedCard.state.EncoderSetup, 'active');
  assert.deepEqual(dismissedCard.effects, []);
  const reapproved = reduce(msg('GateAccept'), dismissedCard.state)!;
  assert.equal(reapproved.state.Downloads.photoApprovalRequired, false);
  assert.deepEqual(reapproved.effects, [{ type: 'dispatch', message: msg('DownloadNow', true) }]);
});

test('late setup revisions cannot revive a cancelled owner or suppress a fresh card photo approval', () => {
  const cancelled = reduce(msg('CancelEncoderSetup'), approve().state)!.state;
  const late = reduce(
    msg('DownloadsChanged', { ...state.Downloads, phase: 'waiting', photoApprovalRequired: true }),
    cancelled,
  )!;
  assert.equal(late.state.Gate, null);
  assert.equal(late.state.EncoderSetup, 'cancelled');
  assert.equal(late.state.Downloads.photoApprovalRequired, false);
  assert.deepEqual(late.effects, []);
  const pending = msg('RunFace', 'face-1');
  const acceptedCard = reduce(msg('GateAccept'), { ...late.state, Gate: ['photo', pending] })!;
  assert.equal(acceptedCard.state.Gate, null);
  assert.equal(acceptedCard.state.DownloadConsent.has('photo'), true);
  assert.deepEqual(acceptedCard.effects, [
    { type: 'consentToDownload', scope: 'photo' },
    { type: 'dispatch', message: pending },
  ]);
  const askedAgain = prepare(late.state);
  assert.equal(askedAgain.state.EncoderSetup, 'requested');
  assert.deepEqual(askedAgain.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.deepEqual(askedAgain.effects, []);
});

test('accepting a retained crop after setup cancellation asks for missing photo assets again', () => {
  const cropped = offerCrop(approve().state, 'face-1', offer('retained-after-stop.jpg')).state;
  const cancelled = reduce(msg('CancelEncoderSetup'), cropped)!.state;
  const acceptedCrop = reduce(msg('CropAccept'), cancelled, { photoRevision: 7 })!;
  assert.ok(acceptedCrop.effects.some((effect) => effect.type === 'cropPhoto'));
  assert.ok(!acceptedCrop.effects.some((effect) => effect.type === 'downloadModels'));
  const file = cropped.Crop!.file;
  const prepared = reduce(msg('Cropped', 'face-1', 7, file), acceptedCrop.state, {
    photoRevision: 7,
  })!;
  assert.ok(
    prepared.effects.some(
      (effect) => effect.type === 'dispatch' && effect.message.type === 'RunFace',
    ),
  );
  const run = reduce(msg('RunFace', 'face-1'), prepared.state)!;
  assert.deepEqual(run.effects, [{ type: 'checkCachedFace', input: prepared.state.Inputs[0] }]);
  const missing = reduce(msg('CachedFaceChecked', prepared.state.Inputs[0]!, false), run.state)!;
  assert.deepEqual(missing.state.Gate, ['photo', msg('RunFace', 'face-1')]);
  assert.equal(missing.state.EncoderSetup, 'cancelled');
  assert.equal(missing.state.DownloadConsent.has('photo'), false);
  assert.equal(missing.state.Inputs[0]?.file, file);
  assert.deepEqual(missing.effects, []);
});

test('photo readiness or a photo failure settles setup; route notifications retain its owner', () => {
  const active = approve().state;
  for (const downloads of [
    { ...state.Downloads, phase: 'done', photoReady: true },
    { ...state.Downloads, phase: 'failed', scope: 'photo' },
    { ...state.Downloads, phase: 'downloading', photoReady: true },
  ]) {
    const settled = reduce(msg('DownloadsChanged', downloads), active)!;
    assert.equal(settled.state.EncoderSetup, undefined);
    assert.deepEqual(settled.effects, []);
  }
  for (const downloads of [
    { ...state.Downloads, phase: 'waiting' },
    { ...state.Downloads, phase: 'done', scope: 'route', routeReady: true },
    { ...state.Downloads, phase: 'failed', scope: 'route' },
    { ...state.Downloads, phase: 'failed', scope: '' },
  ]) {
    const pending = reduce(msg('DownloadsChanged', downloads), active)!;
    assert.equal(pending.state.EncoderSetup, 'active');
    assert.deepEqual(pending.effects, []);
  }
});
