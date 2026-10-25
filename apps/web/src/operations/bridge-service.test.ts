import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationService } from './bridge-service.ts';
import type { ScheduledJob } from './service.ts';

test('serial scheduling skips photo decisions, preserves tails, and resumes them when ready', async () => {
  const service = createOperationService();
  const jobs: ScheduledJob[] = [
    { kind: 'face', id: 'crop' },
    { kind: 'face', id: 'b' },
    { kind: 'face', id: 'c' },
  ];
  assert.equal(service.requestNext(jobs, { busy: true }), -1);
  assert.equal(
    service.requestNext([{ kind: 'face', id: 'active', phase: 'compute' }, ...jobs]),
    -1,
  );
  assert.equal(service.requestNext(jobs, { blockedFaces: ['crop'] }), 1);
  jobs.splice(1, 1);
  assert.deepEqual(
    jobs.map((j) => j.kind === 'face' && j.id),
    ['crop', 'c'],
  );
  assert.equal(service.requestNext(jobs, { blockedFaces: ['crop'] }), 1);
  assert.equal(service.requestNext(jobs), 0);
  await service.dispose();
});
test('an eligible morph keeps its position ahead of newly queued faces', async () => {
  const service = createOperationService();
  const jobs: ScheduledJob[] = [
    { kind: 'face', id: 'a' },
    { kind: 'morph' },
    { kind: 'face', id: 'b' },
  ];
  jobs.shift();
  assert.equal(service.requestNext(jobs), 0);
  assert.equal(service.requestNext(jobs, { blockMorph: true }), 1);
  assert.equal(service.requestNext([{ kind: 'morph' }], { blockMorph: true }), -1);
  await service.dispose();
});

test('file preparation yields compute admission without letting later faces overtake an eligible morph', async () => {
  const service = createOperationService();
  const jobs: ScheduledJob[] = [
    { kind: 'face', id: 'encoded', phase: 'file' },
    { kind: 'morph', phase: 'queued' },
    { kind: 'face', id: 'next', phase: 'queued' },
  ];
  assert.equal(service.requestNext(jobs), 1);
  assert.equal(service.requestNext(jobs, { busy: true }), -1);
  assert.equal(service.requestNext(jobs, { blockMorph: true }), 2);
  assert.equal(service.requestNext([{ kind: 'face', id: 'encoded', phase: 'file' }]), -1);
  await service.dispose();
});

test('bulk faces capture every source as one cancellable intent', async () => {
  const service = createOperationService();
  const revision = 1 as import('../contracts/inputs.ts').InputRevision;
  const sources = ['bulk-a', 'bulk-b'].map((slot) => ({
    slot,
    revision,
    input: { id: slot, mode: 'text' as const, value: slot, file: null },
  }));
  const handle = service.requestFaces({
    kind: 'faces',
    sources,
    route: {
      requested: 'cpu',
      fallbackScope: 'none',
      runtimeSha256: 'runtime',
      modelSha256: 'model',
    },
    settings: { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 },
  });
  sources[0]!.input.value = 'edited after approval';
  assert.equal(handle.request.kind, 'faces');
  if (handle.request.kind !== 'faces') throw new Error('bulk request lost its kind');
  assert.equal(handle.request.sources[0]!.input.value, 'bulk-a');
  service.cancel({ slot: 'bulk-b' });
  assert.equal((await handle.done).status, 'cancelled');
  assert.equal(service.requestNext([{ kind: 'faces' }], { blockMorph: true }), 0);
  await service.dispose();
});

test('queued cancellation and Retry settle through the public service without starting blocked work', async () => {
  const service = createOperationService();
  const revision = 1 as import('../contracts/inputs.ts').InputRevision;
  service.setBlocked({ blockedFaces: ['held'] });
  const request = {
    kind: 'face' as const,
    source: {
      slot: 'held',
      revision,
      input: { id: 'held', mode: 'text' as const, value: 'name', file: null },
    },
    route: {
      requested: 'cpu' as const,
      fallbackScope: 'none' as const,
      runtimeSha256: 'runtime',
      modelSha256: 'model',
    },
    settings: { kind: 'linear' as const, width: 1, pinch: false, frames: 8, fps: 16 },
  };
  const events: import('./service.ts').OperationEvent[] = [];
  const off = service.subscribe((event) => {
    structuredClone(event);
    events.push(event);
  });
  const first = service.requestFace(request);
  service.cancel({ slot: 'held' });
  assert.equal((await first.done).status, 'cancelled');
  const retry = service.retry('held');
  assert.notEqual(retry.attemptId, first.attemptId);
  service.remove('held');
  assert.equal((await retry.done).status, 'cancelled');
  assert.throws(() => service.retry('held'), /No retryable/);
  assert.deepEqual(
    events.map((e) => e.type),
    ['queued', 'cancelled', 'settled', 'queued', 'cancelled', 'settled'],
  );
  off();
  await service.dispose();
  assert.throws(() => service.requestFace(request), /disposed/);
});

test('an import replacement cancels a blocked morph at commit and cannot commit twice', async () => {
  const service = createOperationService();
  service.setBlocked({ blockMorph: true });
  const rev = 1 as import('../contracts/inputs.ts').InputRevision;
  const sources = ['a', 'b'].map((slot) => ({
    slot,
    revision: rev,
    input: { id: slot, mode: 'text' as const, value: slot, file: null },
  }));
  const route = {
    requested: 'cpu',
    fallbackScope: 'none',
    runtimeSha256: 'runtime',
    modelSha256: 'model',
  } as const;
  const settings = { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 } as const;
  const job = service.requestMorph({ kind: 'morph', sources, settings, route });
  const replacement = service.stageReplacement('import', ['a', 'b']);
  assert.equal(service.commitReplacement(replacement, []), true);
  assert.equal((await job.done).status, 'cancelled');
  assert.equal(service.commitReplacement(replacement, []), false);
  await service.dispose();
});
