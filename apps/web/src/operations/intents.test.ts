import test from 'node:test';
import assert from 'node:assert/strict';
import { IntentRegistry } from './intents.ts';
import { capture, type OperationRequest, type SourceSnapshot } from './service.ts';
import type { InputRevision } from '../contracts/inputs.ts';

const revision = (n: number) => n as InputRevision;
const source = (slot = 'a', n = 1): SourceSnapshot => ({
  slot,
  revision: revision(n),
  input: { id: slot, mode: 'text', value: slot, file: null },
});
const settings = { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 } as const;
const route = {
  requested: 'cpu',
  fallbackScope: 'none',
  runtimeSha256: 'runtime',
  modelSha256: 'model',
} as const;
const face = (slot = 'a', n = 1): Extract<OperationRequest, { kind: 'face' }> => ({
  kind: 'face',
  source: source(slot, n),
  settings,
  route,
});
const morph = (): OperationRequest => ({
  kind: 'morph',
  sources: [source('a'), source('b')],
  settings,
  route,
});
function verified(r: IntentRegistry<string>, slot = 'a') {
  const intent = r.queue(face(slot));
  r.begin(intent.requestId);
  assert.equal(r.complete(intent.requestId, 'old pixels'), true);
}

test('selector change after queueing keeps the queued snapshot', () => {
  const r = new IntentRegistry<string>();
  const selection = { ...route };
  const input = { ...source().input };
  const options = { ...settings };
  const request = {
    ...face(),
    route: selection,
    settings: options,
    source: { ...source(), input },
  };
  const intent = r.queue(request);
  Object.assign(selection, { requested: 'webgpu', fallbackScope: 'cpu-once' });
  Object.assign(options, { frames: 32 });
  input.value = 'changed';
  assert.equal(intent.request.route.requested, 'cpu');
  assert.equal(intent.request.settings.frames, 8);
  assert.equal(intent.request.kind === 'face' && intent.request.source.input.value, 'a');
  assert.deepEqual(structuredClone(intent), intent);
});
test('late completion for an old revision is discarded', () => {
  const r = new IntentRegistry<string>();
  const old = r.queue(face());
  r.begin(old.requestId);
  assert.deepEqual(r.revise('a', revision(2)), [old.requestId]);
  assert.equal(r.complete(old.requestId, 'late'), false);
  assert.equal(r.slot('a')?.verified, undefined);
});
test('remove while generating stops and releases the job', () => {
  const r = new IntentRegistry<string>();
  const old = r.queue(face());
  r.begin(old.requestId);
  assert.deepEqual(r.remove('a'), [old.requestId]);
  assert.equal(r.slot('a'), undefined);
  assert.equal(r.complete(old.requestId, 'late'), false);
  r.forget(old.requestId);
  assert.equal(r.status(old.requestId), undefined);
  assert.throws(() => r.queue(face()), /Input changed/);
  r.queue(face('a', 2));
});
test('MP4 drop never leaves Morph queued forever', () => {
  const r = new IntentRegistry<string>();
  const job = r.queue(morph());
  const token = r.stageReplacement('import', ['a', 'b']);
  assert.deepEqual(
    r.commitReplacement(token, [{ slot: 'new', revision: revision(1), verified: 'imported' }]),
    [job.requestId],
  );
  assert.equal(r.status(job.requestId), 'cancelled');
  assert.equal(r.begin(job.requestId), false);
});
test('MP4 drop does not replace faces before its commit point', () => {
  const r = new IntentRegistry<string>();
  verified(r);
  const token = r.stageReplacement('import', ['a']);
  assert.equal(r.slot('a')?.verified?.value, 'old pixels');
  r.abandonReplacement(token);
  assert.equal(r.commitReplacement(token, []), null);
  assert.equal(r.slot('a')?.verified?.value, 'old pixels');
});
test('photo replacement checks the new photo before destroying the face', () => {
  const r = new IntentRegistry<string>();
  verified(r);
  const token = r.stageReplacement('photo', ['a']);
  assert.throws(
    () => r.commitReplacement(token, [{ slot: 'a', revision: revision(0) }]),
    /advance/,
  );
  assert.equal(r.slot('a')?.verified?.value, 'old pixels');
  assert.deepEqual(
    r.commitReplacement(token, [{ slot: 'a', revision: revision(2), verified: 'checked photo' }]),
    [],
  );
  assert.equal(r.slot('a')?.verified?.value, 'checked photo');
});
test('cancelling a queued re-generate leaves the previous verified image or an empty retryable target', () => {
  const r = new IntentRegistry<string>();
  verified(r);
  r.revise('a', revision(2));
  const queued = r.queue(face('a', 2));
  r.cancel(queued.requestId);
  assert.equal(r.slot('a')?.verified?.value, 'old pixels');
  assert.equal(r.slot('a')?.verified?.revision, 1);
  const empty = r.queue(face('empty'));
  r.cancel(empty.requestId);
  assert.equal(r.slot('empty')?.revision, 1);
  assert.equal(r.slot('empty')?.verified, undefined);
});
test('Retry creates a new attempt ID', () => {
  const r = new IntentRegistry<string>();
  const first = r.queue(face());
  r.fail(first.requestId);
  const retry = r.queue(first.request);
  assert.notEqual(first.attemptId, retry.attemptId);
  assert.notEqual(first.requestId, retry.requestId);
});
test('staged replacements reject changes and new-slot races without partial mutation', () => {
  const r = new IntentRegistry<string>();
  verified(r);
  const photo = r.stageReplacement('photo', ['new']);
  r.revise('new', revision(1));
  assert.equal(r.commitReplacement(photo, [{ slot: 'new', revision: revision(2) }]), null);
  const imported = r.stageReplacement('import', ['a']);
  r.queue(face('b'));
  assert.equal(r.commitReplacement(imported, []), null);
  assert.equal(r.slot('a')?.verified?.value, 'old pixels');
  const changed = r.stageReplacement('photo', ['a']);
  r.revise('a', revision(2));
  assert.equal(r.commitReplacement(changed, [{ slot: 'a', revision: revision(3) }]), null);
});
test('invalid requests cannot create some slots before failing on another', () => {
  const r = new IntentRegistry<string>();
  r.revise('b', revision(2));
  assert.throws(() => r.queue(morph()), /Input changed/);
  assert.equal(r.slot('a'), undefined);
  assert.throws(
    () => r.queue({ ...morph(), kind: 'morph', sources: [source(), source()] }),
    /Duplicate/,
  );
});
test('captured blobs retain their immutable content without storing callbacks', async () => {
  const blob = new Blob(['photo']);
  const request = capture({
    ...face(),
    source: { ...source(), input: { ...source().input, mode: 'photo', file: blob } },
  });
  assert.equal(request.kind === 'face' && (await request.source.input.file?.text()), 'photo');
  assert.equal(Object.isFrozen(request.route), true);
});
