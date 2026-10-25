// fm-in6a: the blend parent intent over a held bridge. A blend waits for each weighted slot's latent
// (compute-ready), never its file, holds no permit while waiting, and the newest weights win.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationService } from './bridge-service.ts';
import {
  eventsFor,
  face,
  fakeBridge,
  flush,
  output,
  route,
  settings,
  source,
} from './fake-bridge.ts';
import type { OperationEvent, OperationRequest, SourceSnapshot } from './service.ts';

function held() {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const targets = () => fake.executions.map((e) => `${e.request.action}:${e.request.target}`);
  return { fake, service, events, targets };
}
const blend = (
  slots: readonly (string | SourceSnapshot)[],
  weights: readonly number[],
): Extract<OperationRequest, { kind: 'blend' }> => ({
  kind: 'blend',
  sources: slots.map((slot) => (typeof slot === 'string' ? source(slot) : slot)),
  weights,
  target: 'blend-result',
  route,
  settings,
});
const photo = (slot: string): SourceSnapshot => ({
  ...source(slot),
  input: { id: slot, mode: 'photo', value: '', file: new Blob([`${slot} crop`]) },
});
/** Resolves every provider call made so far (faces as results, the blend as one synthesis). */
async function computeFrom(fake: ReturnType<typeof fakeBridge>, from: number) {
  for (let index = from; index < fake.executions.length; index += 1) {
    const execution = fake.executions[index]!;
    execution.resolve(output([execution.request.target]));
    await flush();
  }
}

test('blend waits for slot latents, not slot files', async () => {
  const { fake, service, targets } = held();
  const slotA = service.requestFace(face('a'));
  const parent = service.requestBlend(blend(['a', 'b'], [1, 1]));
  await flush();
  await computeFrom(fake, 0);
  assert.equal(fake.files.length, 1, "slot a's file is still being prepared");
  assert.deepEqual(targets(), ['face:a', 'face:b', 'blend:blend-result']);
  assert.equal((await parent.done).status, 'completed', 'the blend did not wait for that file');
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await slotA.done).status, 'completed');
  await service.dispose();
});

test('blend holds no permit while awaiting a slot encode', async () => {
  const { fake, service, targets } = held();
  const parent = service.requestBlend(blend([photo('p'), 'a'], [1, 1]));
  await flush();
  assert.deepEqual(targets(), ['face:p'], 'the slot photo encodes first');
  const meanwhile = service.requestFace(face('c'));
  fake.executions[0]!.resolve(output(['p']));
  await flush();
  fake.executions[1]!.resolve(output(['a']));
  await flush();
  assert.deepEqual(
    targets(),
    ['face:p', 'face:a', 'face:c'],
    'a face requested while the blend waited runs before the blend synthesis',
  );
  await computeFrom(fake, 2);
  fake.files[0]!.resolve(output(['c']));
  assert.equal((await meanwhile.done).status, 'completed');
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});

test('weight-0 slots are skipped', async () => {
  const { fake, service, targets } = held();
  const parent = service.requestBlend(blend(['a', 'zero', 'c'], [1, 0, -0.5]));
  await flush();
  await computeFrom(fake, 0);
  assert.deepEqual(
    targets(),
    ['face:a', 'face:c', 'blend:blend-result'],
    'no dependency job for a weight-0 slot',
  );
  const synthesis = fake.executions.at(-1)!.request;
  assert.deepEqual(
    synthesis.inputs.map((input) => input.id),
    ['a', 'c'],
  );
  assert.deepEqual(synthesis.weights, [1, -0.5]);
  assert.equal((await parent.done).status, 'completed');
  await service.dispose();
});

test('all-zero weights refused before any work', async () => {
  const { fake, service, events } = held();
  const parent = service.requestBlend(blend(['a', 'b'], [0, 0]));
  const result = await parent.done;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed' || result.cause.kind !== 'blend-weights')
    assert.fail('expected a typed weight refusal');
  assert.equal(result.cause.recovery, 'adjust-weights');
  assert.deepEqual(eventsFor(events, parent.requestId), ['queued', 'failed', 'settled']);
  await flush();
  assert.deepEqual(fake.executions, [], 'no dependency or synthesis was requested');
  await service.dispose();
});

test('newer weight change supersedes a pending blend', async () => {
  const { fake, service, events, targets } = held();
  const older = service.requestBlend(blend(['a', 'b'], [1, 1]));
  await flush();
  const newer = service.requestBlend(blend(['a', 'b'], [1, 0.5]));
  assert.deepEqual(await older.done, { status: 'superseded' });
  await flush();
  await computeFrom(fake, 0);
  assert.deepEqual(
    targets(),
    ['face:a', 'face:b', 'blend:blend-result'],
    'the slot faces run once and there is one synthesis, for the latest weights',
  );
  assert.deepEqual(fake.executions.at(-1)!.request.weights, [1, 0.5]);
  assert.equal((await newer.done).status, 'completed');
  assert.ok(
    !eventsFor(events, older.requestId).includes('compute-ready'),
    'the superseded result is never installed',
  );
  await service.dispose();
});

test('cancelling the blend leaves slot photo encodes running', async () => {
  const { fake, service, events, targets } = held();
  const encode = service.requestFace({ ...face('p'), source: photo('p') });
  const parent = service.requestBlend(blend([photo('p'), 'a'], [1, 1]));
  await flush();
  assert.deepEqual(targets(), ['face:p']);
  service.cancel({ requestId: parent.requestId }); // leaving the blend view
  assert.deepEqual(await parent.done, { status: 'cancelled' });
  assert.ok(!fake.calls.includes('cancel'), 'the slot photo encode keeps running');
  fake.executions[0]!.resolve(output(['p']));
  await flush();
  fake.files[0]!.resolve(output(['p']));
  assert.equal((await encode.done).status, 'completed');
  assert.ok(eventsFor(events, encode.requestId).includes('file-ready'));
  await flush();
  assert.ok(!targets().includes('blend:blend-result'), 'no blend synthesis after leaving');
  await service.dispose();
});
