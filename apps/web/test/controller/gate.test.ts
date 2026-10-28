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
test('unknown inventory asks; the question resolves itself when the device already holds the models (fm-qrfz)', () => {
  const unknown = { ...initial, Downloads: { ...initial.Downloads, known: false } };
  const run = msg('Run', 'morph');
  // Defect 19: an inventory not yet known is never permission to start.
  const asked = reduce(run, unknown)!.state;
  assert.deepEqual(asked.Gate, ['route', run]);
  // The inventory arrives: everything is already here, so the action continues with no consent recorded.
  const ready = { ...initial.Downloads, known: true, routeReady: true, photoReady: true };
  const resolved = reduce(msg('DownloadsChanged', ready), asked)!;
  assert.equal(resolved.state.Gate, null);
  assert.equal(resolved.state.DownloadConsent.size, 0);
  assert.deepEqual(resolved.effects, [{ type: 'dispatch', message: run, continuation: true }]);
  // It arrives with something missing: the question stays open, now with its size.
  const missing = { ...initial.Downloads, known: true, routeReady: false, routeBytes: 62_000_000 };
  const still = reduce(msg('DownloadsChanged', missing), asked)!;
  assert.deepEqual(still.state.Gate, ['route', run]);
  assert.deepEqual(still.effects, []);
  // A question asked with the inventory known is never closed by a later inventory change.
  const known = reduce(msg('DownloadsChanged', ready), { ...state, Gate: ['route', run] })!;
  assert.deepEqual(known.state.Gate, ['route', run]);
});

test('larger independently requested photo setup opens a revised decision with the measured bytes and its own continuation', () => {
  const crop = { ...state, Crop: { token: 'retained-local-crop' } } as unknown as typeof state;
  const downloads = {
    ...state.Downloads,
    known: true,
    routeReady: true,
    photoBytes: 123456,
    photoApprovalRequired: true,
  };
  const changed = reduce(msg('DownloadsChanged', downloads), {
    ...crop,
    DownloadConsent: new Set(['route', 'photo']),
  })!;
  assert.deepEqual(changed.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.equal(changed.state.Downloads.photoBytes, 123456);
  assert.equal(changed.state.DownloadConsent.has('photo'), false);
  assert.equal(changed.state.DownloadConsent.has('route'), true);
  assert.equal(changed.state.Crop, crop.Crop, 'page preparation does not discard the card crop');
  const accepted = reduce(msg('GateAccept'), changed.state)!;
  assert.equal(accepted.state.Gate, null);
  assert.equal(accepted.state.Downloads.photoApprovalRequired, false);
  assert.deepEqual(
    accepted.effects,
    [{ type: 'dispatch', message: msg('DownloadNow', true) }],
    'one explicit approval is made by DownloadNow, without a second consent effect',
  );
  const resumed = reduce(msg('DownloadNow', true), accepted.state)!;
  assert.deepEqual(resumed.effects, [{ type: 'downloadModels', includePhoto: true }]);
  assert.equal(resumed.state.DownloadConsent.has('photo'), true);
  const cancelled = reduce(msg('GateCancel'), changed.state)!;
  assert.equal(cancelled.state.Gate, null);
  assert.equal(cancelled.state.Crop, crop.Crop);
  assert.equal(cancelled.state.Downloads.photoApprovalRequired, false);
  assert.deepEqual(cancelled.effects, [{ type: 'cancelDownloadSetup' }]);
});

test('a card decision never cancels independent page preparation or gets replaced by its revised decision', () => {
  const pending = msg('RunFace', 'face-1');
  const asked = { ...state, Gate: ['route', pending] as const };
  const changed = reduce(
    msg('DownloadsChanged', { ...state.Downloads, photoApprovalRequired: true }),
    asked,
  )!;
  assert.deepEqual(changed.state.Gate, asked.Gate);
  assert.deepEqual(reduce(msg('GateCancel'), changed.state)!.effects, []);
  for (const decision of [msg('GateCancel'), msg('GateAccept')]) {
    const resolved = reduce(decision, changed.state)!;
    assert.deepEqual(
      resolved.state.Gate,
      ['photo', msg('DownloadNow', true)],
      `${decision.type} surfaces the queued preparation decision without another download event`,
    );
    assert.equal(resolved.state.Downloads.photoApprovalRequired, true);
    assert.ok(
      !resolved.effects.some(
        (effect) =>
          effect.type === 'downloadModels' ||
          (effect.type === 'consentToDownload' && effect.scope === 'photo'),
      ),
      'resolving the card decision never approves independent photo preparation',
    );
  }
  const unknown = {
    ...asked,
    Downloads: { ...state.Downloads, known: false },
  };
  const resolvedByCache = reduce(
    msg('DownloadsChanged', {
      ...state.Downloads,
      known: true,
      routeReady: true,
      photoApprovalRequired: true,
    }),
    unknown,
  )!;
  assert.deepEqual(resolvedByCache.state.Gate, ['photo', msg('DownloadNow', true)]);
  assert.deepEqual(resolvedByCache.effects, [
    { type: 'dispatch', message: pending, continuation: true },
  ]);
});
// fm-9kr8: the video codec fallback is inside the one consent. A Morph press whose probe needs the codec asks for its
// bytes in the Generate row even when the face model is already here; approving them approves the codec.
test('a Morph needing the codec fallback asks for its bytes in Generate before anything is fetched (fm-9kr8)', async () => {
  const { codecMissingBytes } = await import('../../src/controller/derived.ts');
  const { downloadDecision } = await import('../../src/controller/download-decision.ts');
  const ready = {
    ...state,
    Downloads: { ...state.Downloads, routeReady: true, routeBytes: 0 },
    DownloadConsent: new Set(['route']),
  };
  const run = msg('Run', 'morph');
  const checked = reduce(msg('MorphCodecChecked', run, true, 32_344_223), ready)!;
  assert.deepEqual(checked.effects, [{ type: 'dispatch', message: run, continuation: true }]);
  const asked = reduce(run, checked.state, { continuation: true })!;
  assert.deepEqual(asked.state.Gate, ['route', run], 'the codec alone opens the consent');
  assert.equal(asked.state.Busy, false, 'nothing starts before the decision');
  assert.equal(codecMissingBytes(asked.state, run), 32_344_223);
  const decision = downloadDecision({
    downloads: asked.state.Downloads,
    requiredScope: 'route',
    selectedBundle: 'route',
    photoCount: 0,
    codecMissingBytes: codecMissingBytes(asked.state, run),
  });
  assert.equal(decision.rows.length, 1);
  assert.equal(
    decision.rows[0]!.amount,
    '31 MB',
    'the codec bytes in the Generate row, in the shared unit',
  );
  const accepted = reduce(msg('GateAccept'), asked.state)!;
  assert.ok(accepted.state.DownloadConsent.has('codec'));
  assert.deepEqual(accepted.effects, [
    { type: 'consentToDownload', scope: 'codec' },
    { type: 'consentToDownload', scope: 'route' },
    { type: 'dispatch', message: run },
  ]);
  assert.equal(codecMissingBytes(accepted.state, run), 0, 'an approved codec is not asked again');
  // Cancel starts nothing and approves nothing.
  const cancelled = reduce(msg('GateCancel'), asked.state)!;
  assert.equal(cancelled.state.Gate, null);
  assert.ok(!cancelled.state.DownloadConsent.has('codec'));
  assert.deepEqual(cancelled.effects, []);
  // A hardware encoder or a codec already on this device asks nothing more than the models need.
  const none = reduce(msg('MorphCodecChecked', run, false, 32_344_223), ready)!;
  assert.equal(reduce(run, none.state, { continuation: true })!.state.Gate, null);
  // A later press probes again: an earlier answer belongs to its own press.
  assert.equal(codecMissingBytes(checked.state, msg('Run', 'morph')), 0);
});
test('a codec refused by the video worker asks again with its bytes in Generate (fm-9kr8)', async () => {
  const { codecMissingBytes } = await import('../../src/controller/derived.ts');
  const run = msg('Run', 'morph');
  const running = {
    ...state,
    Downloads: { ...state.Downloads, routeReady: true, routeBytes: 0 },
    Busy: true,
    JobId: 9,
    LastRun: run,
    DownloadConsent: new Set(['route']),
  };
  const refused = reduce(
    msg(
      'Failed',
      9,
      'The video codec (32344223 bytes) is not covered by an approved download (codec).',
    ),
    running,
  )!;
  assert.deepEqual(refused.state.Gate, ['route', run]);
  assert.equal(codecMissingBytes(refused.state, run), 32_344_223);
  assert.equal(refused.state.Error, null);
});
