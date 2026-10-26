import assert from 'node:assert/strict';
import test from 'node:test';
import { MORPH_FRAME_BUDGET } from '../contracts/ceilings.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import { createOperationService } from './bridge-service.ts';
import {
  cancelledOutput,
  eventsFor,
  face,
  fakeBridge,
  flush,
  morph as morphOf,
  output,
  source,
} from './fake-bridge.ts';
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
  for (const frames of [0, 1, NaN, Infinity, 2.5]) {
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

// Parent-intent behaviour over a held bridge: each provider call stays pending until the test settles it.
function held() {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const targets = () => fake.executions.map((e) => `${e.request.action}:${e.request.target}`);
  return { fake, service, events, targets };
}
const computeAll = async (fake: ReturnType<typeof fakeBridge>, from: number) => {
  for (let index = from; index < fake.executions.length; index += 1) {
    const execution = fake.executions[index]!;
    execution.resolve(
      output(execution.request.action === 'face' ? [execution.request.target] : []),
    );
    await flush();
  }
};

test('morph yields its permit while awaiting dependency faces', async () => {
  const { fake, service, targets } = held();
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  assert.deepEqual(targets(), ['face:a']);
  const meanwhile = service.requestFace(face('c'));
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.executions[1]!.resolve(output(['b']));
  await flush();
  assert.deepEqual(
    targets(),
    ['face:a', 'face:b', 'face:c'],
    'a face requested while the morph waited is admitted before its frame lease',
  );
  fake.executions[2]!.resolve(output(['c']));
  await flush();
  assert.deepEqual(targets().at(-1), 'morph:');
  fake.files[0]!.resolve(output(['c']));
  fake.executions[3]!.resolve(output());
  assert.equal((await parent.done).status, 'completed');
  assert.equal((await meanwhile.done).status, 'completed');
  await service.dispose();
});

test('morph holds no permit while awaiting download consent', async () => {
  const { fake, service, events, targets } = held();
  service.setBlocked({ blockMorph: true }); // the consent gate is open
  const parent = service.requestMorph(morphOf('a', 'b'));
  const independent = service.requestFace(face('c'));
  await flush();
  assert.deepEqual(targets(), ['face:c'], 'the waiting morph holds nothing the face needs');
  assert.deepEqual(eventsFor(events, parent.requestId), ['queued']);
  fake.executions[0]!.resolve(output(['c']));
  await flush();
  fake.files[0]!.resolve(output(['c']));
  assert.equal((await independent.done).status, 'completed');
  service.setBlocked({}); // consent granted
  await flush();
  await computeAll(fake, 1);
  assert.deepEqual(targets(), ['face:c', 'face:a', 'face:b', 'morph:']);
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});

test('explicit face request for a slot already being auto-generated joins the existing operation (one inference, two owners)', async () => {
  const { fake, service, events, targets } = held();
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  const explicit = service.requestFace(face('a'));
  await flush();
  assert.deepEqual(targets(), ['face:a'], 'no second inference for the same slot and revision');
  await computeAll(fake, 0);
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await explicit.done).status, 'completed');
  assert.ok(eventsFor(events, explicit.requestId).includes('file-ready'));
  assert.equal((await parent.done).status, 'completed');
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:']);
  await service.dispose();
});

test("morph joins a dependency's compute-ready milestone, not its file", async () => {
  const { fake, service, targets } = held();
  const explicit = service.requestFace(face('a'));
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  await computeAll(fake, 0);
  assert.equal(fake.files.length, 1, "a's file is still being prepared");
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:'], 'frames start before that file');
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await parent.done).status, 'completed');
  assert.equal((await explicit.done).status, 'completed');
  await service.dispose();
});

test('face-file preparation failure does not block morph', async () => {
  const { fake, service, targets } = held();
  const explicit = service.requestFace(face('a'));
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  await computeAll(fake, 0);
  fake.files[0]!.reject(Error('file encoder failed'));
  const result = await explicit.done;
  assert.equal(result.status, 'failed');
  assert.equal((await parent.done).status, 'completed');
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:'], 'no inference reruns');
  await service.dispose();
});

for (const boundary of ['queued', 'acquiring', 'loading', 'inferring', 'file prep'] as const)
  test(`parent Cancel at the ${boundary} dependency boundary settles the parent and leaves independently requested faces running`, async () => {
    const { fake, service, events, targets } = held();
    const independent = service.requestFace(face('a'));
    const parent = service.requestMorph(morphOf('b', 'a'));
    await flush();
    // Faces run in request order: the independent face first, then the parent's own dependency.
    const job = fake.executions[0]!.request.jobId;
    if (boundary === 'acquiring') fake.progress(job, 'models-download');
    if (boundary === 'loading') fake.progress(job, 'route-attempt');
    if (boundary === 'inferring') fake.progress(job, 'face');
    if (boundary === 'file prep') {
      fake.executions[0]!.resolve(output(['a']));
      await flush();
      assert.equal(fake.files.length, 1);
      assert.deepEqual(targets(), ['face:a', 'face:b']);
    }
    service.cancel({ requestId: parent.requestId });
    await flush();
    if (boundary === 'file prep') {
      // The parent-only dependency was already running: it settles before the parent does.
      fake.executions[1]!.resolve(cancelledOutput());
    }
    assert.deepEqual(await parent.done, { status: 'cancelled' });
    assert.equal(
      eventsFor(events, parent.requestId).filter((type) => type === 'settled').length,
      1,
    );
    if (boundary !== 'file prep') {
      assert.ok(!fake.calls.includes('cancel'), 'the independent face keeps computing');
      assert.ok(fake.calls.includes('cancelQueuedFace:b'), 'the parent-only face is released');
      fake.executions[0]!.resolve(output(['a']));
      await flush();
    }
    fake.files[0]!.resolve(output(['a']));
    assert.equal((await independent.done).status, 'completed');
    await flush();
    assert.ok(!targets().includes('morph:'), 'the cancelled parent never takes a frame lease');
    await service.dispose();
  });

test('capability loss while queued settles with a recovery action', async () => {
  const { fake, service } = held();
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  fake.executions[0]!.resolve({
    ...output(),
    refusal: {
      reasonKey: 'generator-not-admitted',
      text: 'This device cannot run faces.',
      helpAnchor: 'routes',
    },
  });
  const result = await parent.done;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed' || result.cause.kind !== 'dependency')
    assert.fail('expected a dependency recovery');
  assert.equal(result.cause.slot, 'a');
  assert.equal(result.cause.recovery, 'choose-supported-route');
  await flush();
  assert.deepEqual(
    fake.executions.map((e) => e.request.target),
    ['a'],
    'nothing further runs for the settled parent',
  );
  await service.dispose();
});

test('photo -> queued Morph', async () => {
  const { fake, service, targets } = held();
  const photo = {
    ...source('p'),
    input: { id: 'p', mode: 'photo' as const, value: '', file: new Blob(['confirmed crop']) },
  };
  const parent = service.requestMorph({ ...morphOf('a'), sources: [photo, source('a')] });
  await flush();
  assert.deepEqual(targets(), ['face:p'], 'the confirmed photo is encoded as a dependency first');
  assert.equal(fake.executions[0]!.request.inputs[0]?.file, photo.input.file);
  await computeAll(fake, 0);
  assert.deepEqual(targets(), ['face:p', 'face:a', 'morph:']);
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});

test('no deadlock with sparse preview anchors', async () => {
  // Display-only previews on some slots are not results: every unfinished slot becomes a dependency
  // and the morph still settles, whichever anchors had a preview.
  const { fake, service, targets } = held();
  const parent = service.requestMorph(morphOf('anchor-1', 'gap', 'anchor-2', 'gap-2'));
  await flush();
  await computeAll(fake, 0);
  assert.deepEqual(targets(), [
    'face:anchor-1',
    'face:gap',
    'face:anchor-2',
    'face:gap-2',
    'morph:',
  ]);
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});

test('newer face edit abandons the old morph', async () => {
  const { fake, service, events } = held();
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  service.revise('b', 2 as never);
  await flush();
  assert.ok(fake.calls.includes('cancelQueuedFace:b'), 'the edited slot leaves the queue');
  assert.ok(fake.calls.includes('cancel'), "the parent's running dependency is stopped");
  // The parent settles once its in-flight dependency unit has settled.
  fake.executions[0]!.resolve(cancelledOutput());
  const result = await parent.done;
  assert.ok(['cancelled', 'superseded'].includes(result.status), result.status);
  await flush();
  assert.equal(eventsFor(events, parent.requestId).filter((t) => t === 'settled').length, 1);
  assert.ok(!fake.executions.some((e) => e.request.action === 'morph'));
  await service.dispose();
});

test("photo encode is not held by a pending morph's frame budget", async () => {
  const { fake, service, targets } = held();
  const parent = service.requestMorph(morphOf('a', 'b'));
  await flush();
  const photo = service.requestFace({
    ...face('p'),
    source: {
      ...source('p'),
      input: { id: 'p', mode: 'photo', value: '', file: new Blob(['confirmed crop']) },
    },
  });
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.executions[1]!.resolve(output(['b']));
  await flush();
  assert.deepEqual(targets(), ['face:a', 'face:b', 'face:p'], 'the photo encode runs first');
  await computeAll(fake, 2);
  fake.files[0]!.resolve(output(['p']));
  assert.equal((await photo.done).status, 'completed');
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});
