// fm-in6a: one test per cancellation boundary, through the real operation service over a held bridge.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationService } from './bridge-service.ts';
import {
  cancelledOutput,
  eventsFor,
  face,
  fakeBridge,
  flush,
  morph,
  output,
} from './fake-bridge.ts';
import type { OperationEvent } from './service.ts';

function setup() {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  return { fake, service, events };
}
const terminal = (types: readonly string[]) =>
  types.filter((type) => ['cancelled', 'failed', 'settled'].includes(type));

test('cancel while queued', async () => {
  const { fake, service, events } = setup();
  const first = service.requestFace(face('a'));
  const queued = service.requestFace(face('b'));
  await flush();
  assert.deepEqual(
    fake.executions.map((e) => e.request.target),
    ['a'],
  );
  service.cancel({ slot: 'b' });
  assert.deepEqual(await queued.done, { status: 'cancelled' });
  assert.deepEqual(terminal(eventsFor(events, queued.requestId)), ['cancelled', 'settled']);
  assert.ok(fake.calls.includes('cancelQueuedFace:b'));
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await first.done).status, 'completed');
  await flush();
  assert.deepEqual(
    fake.executions.map((e) => e.request.target),
    ['a'],
    'a cancelled queued face never reaches the provider',
  );
  assert.equal(service.retry('b').request.kind, 'face', 'Retry stays available');
  await service.dispose();
});

// Acquisition, runtime/session load, canary and inference all run inside the admitted compute
// phase; the runtime reports which one through progress. Each must hold Cancelling until the
// bridge's real execute settles, then settle once, release the provider and install nothing late.
for (const [boundary, stage] of [
  ['cancel during acquisition', 'models-download'],
  ['cancel during runtime/session load', 'route-attempt'],
  ['cancel during canary', 'canary-invalidated'],
  ['cancel during inference (in-flight unit settles, no preemption promised)', 'face'],
] as const)
  test(boundary, async () => {
    const { fake, service, events } = setup();
    const active = service.requestFace(face('a', 'first words'));
    const next = service.requestFace(face('b'));
    await flush();
    const job = fake.executions[0]!.request.jobId;
    fake.progress(job, 'route-admitted', 'cpu');
    fake.progress(job, stage);
    service.cancel({ slot: 'a' });
    await flush();
    assert.ok(fake.calls.includes('cancel'), 'the provider is asked to stop');
    assert.deepEqual(
      terminal(eventsFor(events, active.requestId)),
      [],
      'Cancelling until the in-flight unit settles',
    );
    assert.equal(fake.executions.length, 1, 'no new provider work while the old job runs');
    let settled = false;
    void active.done.then(() => (settled = true));
    await flush();
    assert.equal(settled, false);
    // A late result for the cancelled job arrives as the real bridge's cancellation snapshot,
    // or even as a finished face: neither is installed.
    fake.executions[0]!.resolve(stage === 'face' ? output(['a']) : cancelledOutput());
    assert.deepEqual(await active.done, { status: 'cancelled' });
    const types = eventsFor(events, active.requestId);
    assert.deepEqual(terminal(types), ['cancelled', 'settled'], 'exactly one terminal event');
    assert.ok(!types.includes('compute-ready') && !types.includes('file-ready'));
    await flush();
    assert.deepEqual(
      fake.executions.map((e) => e.request.target),
      ['a', 'b'],
      'the next job is admitted only after settlement',
    );
    assert.equal(fake.files.length, 0, 'no file is prepared for the cancelled face');
    const again = service.retry('a');
    assert.notEqual(again.attemptId, active.attemptId, 'Retry is a new attempt for the same input');
    assert.equal(again.request.kind === 'face' && again.request.source.input.value, 'first words');
    fake.executions[1]!.resolve(output(['b']));
    await flush();
    fake.files[0]?.resolve(output(['b']));
    assert.equal((await next.done).status, 'completed');
    // Disposal waits for in-flight provider work, so the retried job settles first.
    service.cancel({ requestId: again.requestId });
    fake.executions[2]!.resolve(cancelledOutput());
    assert.deepEqual(await again.done, { status: 'cancelled' });
    await service.dispose();
  });

test('cancel during file preparation', async () => {
  const { fake, service, events } = setup();
  const handle = service.requestFace(face('a'));
  await flush();
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  assert.equal(fake.files.length, 1, 'file preparation started');
  assert.ok(eventsFor(events, handle.requestId).includes('compute-ready'));
  // File preparation holds no provider permit: another face computes meanwhile.
  const other = service.requestFace(face('b'));
  await flush();
  assert.deepEqual(
    fake.executions.map((e) => e.request.target),
    ['a', 'b'],
  );
  service.cancel({ slot: 'a' });
  await flush();
  assert.deepEqual(terminal(eventsFor(events, handle.requestId)), []);
  fake.files[0]!.resolve(output(['a']));
  assert.deepEqual(await handle.done, { status: 'cancelled' });
  const types = eventsFor(events, handle.requestId);
  assert.deepEqual(terminal(types), ['cancelled', 'settled']);
  assert.ok(!types.includes('file-ready'), 'the late file is not installed');
  fake.executions[1]!.resolve(output(['b']));
  await flush();
  fake.files[1]!.resolve(output(['b']));
  assert.equal((await other.done).status, 'completed');
  await service.dispose();
});

test('shared fetch continues for the remaining owner', async () => {
  const { fake, service, events } = setup();
  const first = service.requestFace(face('a'));
  const second = service.requestFace(face('a'));
  await flush();
  assert.equal(fake.executions.length, 1, 'one operation, two owners');
  service.cancel({ requestId: first.requestId });
  assert.deepEqual(await first.done, { status: 'cancelled' });
  assert.ok(!fake.calls.includes('cancel'), 'the remaining owner keeps the work running');
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await second.done).status, 'completed');
  assert.ok(eventsFor(events, second.requestId).includes('file-ready'));
  await service.dispose();
});

test('last owner cancel stops transfer within the bound', async () => {
  const { fake, service } = setup();
  const first = service.requestFace(face('a'));
  const second = service.requestFace(face('a'));
  await flush();
  fake.progress(fake.executions[0]!.request.jobId, 'models-download');
  service.cancel({ requestId: first.requestId });
  await flush();
  assert.ok(!fake.calls.includes('cancel'));
  service.cancel({ requestId: second.requestId });
  // The bound: the stop request is made synchronously within the cancel call's task.
  assert.ok(fake.calls.includes('cancel'), 'the last owner stops the transfer');
  fake.executions[0]!.resolve(cancelledOutput());
  assert.deepEqual(await second.done, { status: 'cancelled' });
  await service.dispose();
});

test('morph cancel never cancels a separately requested face', async () => {
  const { fake, service, events } = setup();
  const own = service.requestFace(face('a'));
  const parent = service.requestMorph(morph('a', 'b'));
  await flush();
  assert.equal(fake.executions[0]!.request.target, 'a');
  service.cancel({ requestId: parent.requestId });
  assert.deepEqual(await parent.done, { status: 'cancelled' });
  assert.ok(!fake.calls.includes('cancel'), 'the face the visitor asked for keeps running');
  assert.ok(fake.calls.includes('cancelQueuedFace:b'), 'the parent-only dependency is released');
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await own.done).status, 'completed');
  assert.ok(eventsFor(events, own.requestId).includes('file-ready'));
  await flush();
  assert.deepEqual(
    fake.executions.map((e) => e.request.target),
    ['a'],
    'the cancelled parent starts nothing',
  );
  await service.dispose();
});

test('remove releases only that slot', async () => {
  const { fake, service } = setup();
  const done = service.requestFace(face('a'));
  await flush();
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await done.done).status, 'completed');
  const running = service.requestFace(face('b'));
  const queued = service.requestFace(face('c'));
  await flush();
  service.remove('c');
  assert.deepEqual(await queued.done, { status: 'cancelled' });
  assert.ok(fake.calls.includes('invalidateFace:c'));
  assert.ok(!fake.calls.includes('invalidateFace:a'), 'a completed face is untouched');
  assert.ok(!fake.calls.includes('cancel'), 'the running face is untouched');
  fake.executions[1]!.resolve(output(['b']));
  await flush();
  fake.files[1]!.resolve(output(['b']));
  assert.equal((await running.done).status, 'completed');
  await service.dispose();
});

test('Cancel is distinct from Hide', async () => {
  // Hiding a toast or panel is presentation; the service has no hide path, so only an explicit
  // cancel target settles work. Unsubscribing a listener (what a hidden view does) cancels nothing.
  const { fake, service } = setup();
  const handle = service.requestFace(face('a'));
  const hidden: OperationEvent[] = [];
  const unsubscribe = service.subscribe((event) => hidden.push(event));
  await flush();
  unsubscribe();
  assert.ok(!fake.calls.includes('cancel'));
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await handle.done).status, 'completed');
  await service.dispose();
});

test('offline, a job missing its files settles with a typed failure and Retry, not "engine stopped"', async () => {
  const fake = fakeBridge();
  let online = false;
  const service = createOperationService({ bridge: fake.bridge, online: () => online });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const handle = service.requestFace(face('a'));
  await flush();
  fake.executions[0]!.resolve({
    ...output(),
    errorMessage: 'The local generation engine stopped.',
  });
  const result = await handle.done;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed' || result.cause.kind !== 'offline')
    assert.fail('expected a typed offline failure');
  assert.equal(result.cause.recovery, 'retry');
  assert.doesNotMatch(result.cause.message, /engine stopped/i);
  assert.equal(terminal(eventsFor(events, handle.requestId)).join(), 'failed,settled');
  // Back online, Retry is the same input as a new attempt and is not typed as offline.
  online = true;
  const again = service.retry('a');
  await flush();
  fake.executions[1]!.resolve({
    ...output(),
    errorMessage: 'The local generation engine stopped.',
  });
  const second = await again.done;
  assert.ok(
    second.status === 'failed' && second.cause.kind === 'operation',
    'online failures keep their own cause',
  );
  await service.dispose();
});
