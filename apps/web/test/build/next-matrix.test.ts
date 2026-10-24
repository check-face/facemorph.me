// The cross-engine matrix's stage logic (scripts/next-matrix-stages.mjs), with plain values and real files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STAGES,
  classifyStage,
  encoderRan,
  hasRecoveryMetadata,
  rowVerdict,
  stageRecord,
} from '../../scripts/next-matrix-stages.mjs';

const fixtures = new URL('../fixtures/next-matrix/', import.meta.url);

/** Every stage passed, then the given stages replaced by a record of the given outcome. */
const row = (replace: Record<string, Parameters<typeof stageRecord>[0]> = {}) =>
  Object.fromEntries(STAGES.map((name) => [name, stageRecord(replace[name] ?? 'passed')]));

test('the stage list is classic a42829b with none dropped or renamed', () => {
  // classic-stage-ids.txt holds the stage('...') lines of facemorph.me-classic a42829b scripts/next-matrix.mjs.
  const classic = [
    ...readFileSync(new URL('classic-stage-ids.txt', fixtures), 'utf8').matchAll(/stage\('(\w+)'/g),
  ].map((m) => m[1]);
  assert.deepEqual(classic, [
    'nameSeed',
    'repeatOriginal',
    'photoE4e',
    'localCrop',
    'projectSaveReopen',
    'morphExport',
    'morphPlayback',
  ]);
  assert.deepEqual([...STAGES], classic);
});

test('a stage whose control is absent is incomplete-not-shipped, never passed', () => {
  const outcome = classifyStage({ data: { notShipped: true, skipped: 'no control' } });
  assert.equal(outcome, 'incomplete-not-shipped');
  const record = stageRecord(outcome);
  assert.equal(record.passed, false);
});

test('a row with the project and H.264 stages absent is not passed and lists them', () => {
  const verdict = rowVerdict(
    row({
      projectSaveReopen: 'incomplete-not-shipped',
      morphExport: 'incomplete-not-shipped',
      morphPlayback: 'incomplete-not-shipped',
    }),
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.status, 'incomplete');
  assert.deepEqual(verdict.incompleteNotShipped, [
    'projectSaveReopen',
    'morphExport',
    'morphPlayback',
  ]);
  assert.deepEqual(verdict.failed, []);
});

test('a record claiming passed while its outcome says not shipped does not pass the row', () => {
  const stages = row({ projectSaveReopen: 'incomplete-not-shipped' });
  const forged = {
    ...stages,
    projectSaveReopen: { outcome: 'incomplete-not-shipped', passed: true },
  };
  assert.equal(rowVerdict(forged).passed, false);
  const hand = { ...stages, projectSaveReopen: { outcome: 'passed' } };
  assert.equal(rowVerdict(hand).passed, false);
});

test('a build limitation is not a pass and holds the row incomplete', () => {
  const outcome = classifyStage({ data: { buildLimitation: true } });
  assert.equal(outcome, 'buildLimitation');
  const verdict = rowVerdict(row({ morphPlayback: 'buildLimitation' }));
  assert.equal(verdict.passed, false);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.buildLimited, ['morphPlayback']);
});

test('control absence wins over a build limitation, and neither is a failure', () => {
  assert.equal(
    classifyStage({ data: { notShipped: true, buildLimitation: true } }),
    'incomplete-not-shipped',
  );
  assert.equal(rowVerdict(row({ projectSaveReopen: 'incomplete-not-shipped' })).ok, true);
});

test('a row passes only when every stage passed', () => {
  const verdict = rowVerdict(row());
  assert.equal(verdict.passed, true);
  assert.equal(verdict.status, 'passed');
});

test('a missing, failed or unsupported stage fails the row', () => {
  const { photoE4e: _dropped, ...partial } = row();
  assert.deepEqual(rowVerdict(partial).missing, ['photoE4e']);
  assert.equal(rowVerdict(partial).status, 'failed');
  assert.equal(rowVerdict(row({ localCrop: 'failed' })).status, 'failed');
  assert.deepEqual(rowVerdict(row({ localCrop: 'unsupported' })).unsupported, ['localCrop']);
  assert.equal(rowVerdict(row({ localCrop: 'unsupported' })).passed, false);
});

test('a thrown error is a failure, or unsupported only for an optional stage that says so', () => {
  assert.equal(classifyStage({ error: new Error('boom') }), 'failed');
  assert.equal(classifyStage({ error: new Error('NotSupportedError'), optional: false }), 'failed');
  assert.equal(
    classifyStage({ error: new Error('NotSupportedError'), optional: true }),
    'unsupported',
  );
  assert.equal(classifyStage({ data: { sha256: 'x' } }), 'passed');
});

test('the photo fixture carries no recovery metadata, and a file with it is caught', () => {
  const photo = readFileSync(new URL('photo-no-metadata.webp', fixtures));
  assert.equal(hasRecoveryMetadata(photo), false);
  assert.equal(hasRecoveryMetadata(Buffer.concat([photo, Buffer.from('FMRP')])), true);
  assert.equal(hasRecoveryMetadata(Buffer.from('\x89PNG\r\n\x1a\n....tEXtFaceMorph\0v')), true);
});

test('only an encode request with a completed encoder counts as the encoder running', () => {
  assert.equal(encoderRan([{ posted: 'encode-aligned' }, { stage: 'encoding-complete' }]), true);
  assert.equal(encoderRan([{ stage: 'encoding-complete' }]), false);
  assert.equal(encoderRan([{ posted: 'encode-aligned' }, { stage: 'encoder-loaded' }]), false);
  assert.equal(encoderRan([]), false);
});
