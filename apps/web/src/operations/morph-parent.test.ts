import assert from 'node:assert/strict';
import test from 'node:test';
import { MORPH_FRAME_BUDGET } from '../contracts/ceilings.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import { createOperationService } from './bridge-service.ts';
import { morphFrameFailure } from './morph-budget.ts';
import type { OperationEvent, OperationRequest } from './service.ts';

const morph = (count: number, frames: number): Extract<OperationRequest, { kind: 'morph' }> => ({
  kind: 'morph',
  sources: Array.from({ length: count }, (_, index) => {
    const slot = `frame-budget-${index}`;
    return {
      slot,
      revision: 1 as InputRevision,
      input: { id: slot, mode: 'text', value: slot, file: null },
    };
  }),
  settings: { kind: 'linear', width: 1, pinch: false, frames, fps: 16 },
  route: {
    requested: 'cpu',
    fallbackScope: 'cpu-once',
    runtimeSha256: 'runtime',
    modelSha256: 'model',
  },
});

test('morph frame admission uses the inclusive contracts ceiling and every closed-path segment', () => {
  const boundary = morph(MORPH_FRAME_BUDGET.maxFrames / 2, 2);
  assert.equal(morphFrameFailure(boundary), undefined);
  const over = morph(boundary.sources.length + 1, 2);
  const before = structuredClone(over);
  assert.equal(morphFrameFailure(over)?.kind, 'morph-frames');
  assert.deepEqual(over, before, 'no face dropped to fit');
});

test('over-budget morph settles before morph-owned acquisition, even when blocked; photo and face queues are independent', async () => {
  const service = createOperationService();
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const request = morph(2, MORPH_FRAME_BUDGET.maxFrames);
  const before = structuredClone(request);
  service.setBlocked({ blockMorph: true, blockedFaces: ['independent', 'photo'] });
  const handle = service.requestMorph(request);
  const source = request.sources[0]!;
  const independent = service.requestFace({
    ...request,
    kind: 'face',
    source: { ...source, slot: 'independent', input: { ...source.input, id: 'independent' } },
  });
  const photo = service.requestFace({
    ...request,
    kind: 'face',
    source: {
      ...source,
      slot: 'photo',
      input: { id: 'photo', mode: 'photo', value: '', file: new Blob(['photo input']) },
    },
  });
  const result = await handle.done;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail('expected a typed refusal');
  assert.equal(result.cause.kind, 'morph-frames');
  if (result.cause.kind !== 'morph-frames') assert.fail('expected frame recovery');
  assert.equal(result.cause.reason, 'over-budget');
  assert.equal(result.cause.recovery, 'shorten-morph');
  assert.deepEqual(
    events
      .filter((event) => event.intent.requestId === handle.requestId)
      .map((event) => event.type),
    ['queued', 'failed', 'settled'],
    'no admitted, acquisition progress or compute result',
  );
  assert.deepEqual(request, before, 'all selected faces and settings retained');
  assert.deepEqual(handle.request, before);
  for (const job of [independent, photo]) {
    assert.deepEqual(
      events.filter((event) => event.intent.requestId === job.requestId).map((event) => event.type),
      ['queued'],
    );
    service.cancel({ requestId: job.requestId });
    assert.equal((await job.done).status, 'cancelled');
  }
  await service.dispose();
});

test('invalid morph frame settings settle without starting provider work', async () => {
  for (const frames of [0, 1, 3, NaN, Infinity, 2.5]) {
    const service = createOperationService();
    const handle = service.requestMorph(morph(2, frames));
    const result = await handle.done;
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed' || result.cause.kind !== 'morph-frames')
      assert.fail('expected frame refusal');
    assert.equal(result.cause.reason, 'invalid-settings');
    assert.equal(result.cause.recovery, 'adjust-frames');
    await service.dispose();
  }
});

test('parent Cancel detaches from independently requested queued faces and settles once', async () => {
  const service = createOperationService();
  const request = morph(2, 8);
  service.setBlocked({ blockedFaces: request.sources.map((source) => source.slot) });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const parent = service.requestMorph(request);
  const face = service.requestFace({ ...request, kind: 'face', source: request.sources[0]! });
  // Actual microtasks install the queued dependencies; no browser or provider is admitted.
  await Promise.resolve();
  service.cancel({ requestId: parent.requestId });
  assert.equal((await parent.done).status, 'cancelled');
  assert.deepEqual(
    events.filter((event) => event.intent.requestId === face.requestId).map((event) => event.type),
    ['queued'],
  );
  assert.equal(
    events.filter(
      (event) => event.intent.requestId === parent.requestId && event.type === 'settled',
    ).length,
    1,
  );
  service.cancel({ requestId: face.requestId });
  assert.equal((await face.done).status, 'cancelled');
  await service.dispose();
});

test('invalid dependency inputs refuse before parent acquisition, keeping literal values', async () => {
  for (const [mode, value, file, recovery] of [
    ['text', '   ', null, 'edit-input'],
    ['seed', '-1', null, 'edit-input'],
    ['seed', '2026-10-24', null, 'edit-input'],
    ['photo', '', null, 'confirm-photo'],
  ] as const) {
    const service = createOperationService();
    const original = morph(2, 8);
    const bad = {
      ...original.sources[0]!,
      input: { ...original.sources[0]!.input, mode, value, file },
    };
    const request = { ...original, sources: [bad, original.sources[1]!] };
    const events: OperationEvent[] = [];
    service.subscribe((event) => events.push(event));
    const result = await service.requestMorph(request).done;
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed' || result.cause.kind !== 'dependency')
      assert.fail('expected dependency recovery');
    assert.equal(result.cause.slot, bad.slot);
    assert.equal(result.cause.recovery, recovery);
    assert.deepEqual(
      events.map((event) => event.type),
      ['queued', 'failed', 'settled'],
    );
    assert.equal(bad.input.value, value);
    await service.dispose();
  }
});

test('a morph needs two selected faces before any dependency work', async () => {
  for (const count of [0, 1]) {
    const service = createOperationService();
    const events: OperationEvent[] = [];
    service.subscribe((event) => events.push(event));
    const result = await service.requestMorph(morph(count, 8)).done;
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed' || result.cause.kind !== 'morph-frames')
      assert.fail('expected selection recovery');
    assert.equal(result.cause.recovery, 'select-faces');
    assert.deepEqual(
      events.map((event) => event.type),
      ['queued', 'failed', 'settled'],
    );
    await service.dispose();
  }
});
