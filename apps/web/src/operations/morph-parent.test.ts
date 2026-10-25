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
