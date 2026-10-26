// fm-8w99: Morph is a parent intent with exactly one current result. Every case drives the real
// operation service over a held fake bridge and observes only events, settlements and bridge calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { InputRevision } from '../contracts/inputs.ts';
import { computeAll, eventsFor, face, flush, held, morph, output } from './fake-bridge.ts';
import type { MorphSettings, OperationEvent, OperationRequest } from './service.ts';

/** Every morph result the service delivered, as `event:requestId`, in delivery order. */
const morphResults = (events: readonly OperationEvent[]) =>
  events
    .filter(
      (e) =>
        e.intent.request.kind === 'morph' &&
        (e.type === 'compute-ready' || e.type === 'file-ready'),
    )
    .map((e) => `${e.type}:${e.intent.requestId}`);
const settledCount = (events: readonly OperationEvent[], requestId: string) =>
  eventsFor(events, requestId).filter((type) => type === 'settled').length;
const morphExecutions = (targets: () => string[]) =>
  targets().filter((target) => target === 'morph:').length;
const withSettings = (
  request: Extract<OperationRequest, { kind: 'morph' }>,
  change: Partial<MorphSettings>,
): Extract<OperationRequest, { kind: 'morph' }> => ({
  ...request,
  settings: { ...request.settings, ...change },
});

/** Resolves the two dependency faces of morph('a', 'b'), leaving its frame production in flight. */
async function toFrames({ fake, targets }: ReturnType<typeof held>) {
  for (const index of [0, 1]) {
    const execution = fake.executions[index]!;
    execution.resolve(output([execution.request.target]));
    await flush();
  }
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:'], 'frames are in production');
}

test('morph-intent.single-current-result', async () => {
  const { fake, service, events, targets } = held();
  const older = service.requestMorph(morph('a', 'b'));
  await flush();
  assert.deepEqual(targets(), ['face:a']);
  // Reordering the faces is a newer morph: it supersedes the pending one.
  const newer = service.requestMorph(morph('b', 'a'));
  assert.deepEqual(await older.done, { status: 'superseded' });
  await flush();
  await computeAll(fake, 0);
  assert.deepEqual(
    targets(),
    ['face:a', 'face:b', 'morph:'],
    'the shared faces run once and one frame production runs, for the newer order',
  );
  assert.deepEqual(
    fake.executions.at(-1)!.request.inputs.map((input) => input.id),
    ['b', 'a'],
  );
  assert.equal((await newer.done).status, 'completed');
  assert.deepEqual(
    morphResults(events),
    [`compute-ready:${newer.requestId}`, `file-ready:${newer.requestId}`],
    'exactly one current morph result, and it is the newer one',
  );
  assert.equal(settledCount(events, older.requestId), 1);
  assert.equal(settledCount(events, newer.requestId), 1);
  await service.dispose();
});

test('morph-intent.input-change-invalidates', async (t) => {
  for (const boundary of ['dependency', 'frames', 'after'] as const)
    await t.test(boundary, async () => {
      const lane = held();
      const { fake, service, events, targets } = lane;
      const parent = service.requestMorph(morph('a', 'b'));
      await flush();
      if (boundary !== 'dependency') await toFrames(lane);
      if (boundary === 'after') {
        fake.executions[2]!.resolve(output());
        assert.equal((await parent.done).status, 'completed');
      }
      const before = morphResults(events);
      service.revise(boundary === 'dependency' ? 'a' : 'b', 2 as InputRevision);
      await flush();
      assert.ok(
        fake.calls.includes(`invalidateFace:${boundary === 'dependency' ? 'a' : 'b'}`),
        "the bridge drops the edited face and the morph's prepared video",
      );
      if (boundary === 'after') {
        assert.equal(
          settledCount(events, parent.requestId),
          1,
          'a settled result is not re-settled',
        );
        await service.dispose();
        return;
      }
      assert.ok(fake.calls.includes('cancel'), 'obsolete production is aborted');
      if (boundary === 'dependency')
        assert.ok(
          fake.calls.includes('cancelQueuedFace:b'),
          "the parent's queued face is released",
        );
      // The aborted execution completes late with a real result anyway; it cannot install.
      const late = fake.executions.at(-1)!;
      late.resolve(output(late.request.action === 'face' ? ['a'] : []));
      const result = await parent.done;
      assert.ok(['cancelled', 'superseded'].includes(result.status), result.status);
      await flush();
      assert.deepEqual(
        morphResults(events),
        before,
        'no compute-ready or file-ready after the edit',
      );
      assert.equal(settledCount(events, parent.requestId), 1);
      assert.equal(
        morphExecutions(targets),
        boundary === 'frames' ? 1 : 0,
        'no frame production starts for the old faces',
      );
      await service.dispose();
    });
});

test('morph-intent.setting-change-invalidates', async (t) => {
  for (const [name, change] of [
    ['kind', { kind: 'pairwise-ellipse' }],
    ['frames', { frames: 6 }],
    ['pinch', { pinch: true }],
  ] as const)
    for (const boundary of ['dependency', 'frames'] as const)
      await t.test(`${name} during ${boundary}`, async () => {
        // Settings changes reach the service as a new morph request with the new settings; the
        // controller's 'invalidateMorph' effect drops the bridge's prepared video directly.
        const lane = held();
        const { fake, service, events, targets } = lane;
        const older = service.requestMorph(morph('a', 'b'));
        await flush();
        if (boundary === 'frames') await toFrames(lane);
        const settled = fake.executions.length;
        const newer = service.requestMorph(withSettings(morph('a', 'b'), change));
        await flush();
        if (boundary === 'frames') {
          assert.ok(fake.calls.includes('cancel'), 'the old frame production is aborted');
          // The old production completes late with a real video; the old result cannot install.
          fake.executions[2]!.resolve(output());
        } else {
          assert.ok(!fake.calls.includes('cancel'), 'the shared dependency keeps computing');
        }
        assert.deepEqual(await older.done, { status: 'superseded' });
        await flush();
        await computeAll(fake, boundary === 'frames' ? settled : 0);
        assert.equal((await newer.done).status, 'completed');
        const productions = fake.executions.filter((e) => e.request.action === 'morph');
        assert.equal(productions.length, boundary === 'frames' ? 2 : 1);
        assert.equal(productions.at(-1)!.request[name], change[name as keyof typeof change]);
        assert.deepEqual(
          morphResults(events),
          [`compute-ready:${newer.requestId}`, `file-ready:${newer.requestId}`],
          'only the newer settings produce a result',
        );
        if (boundary === 'dependency')
          assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:'], 'no face reruns');
        await service.dispose();
      });
});

test('morph-intent.late-completion-rejected', async () => {
  const lane = held();
  const { fake, service, events } = lane;
  const older = service.requestMorph(morph('a', 'b'));
  await flush();
  await toFrames(lane);
  const newer = service.requestMorph(morph('b', 'a'));
  await flush();
  assert.ok(fake.calls.includes('cancel'), 'the superseded frame production is aborted');
  // The superseded execution ignores the abort and resolves with a complete video.
  fake.executions[2]!.resolve({ ...output(), videoUrl: 'blob:old-video' });
  assert.deepEqual(await older.done, { status: 'superseded' });
  await flush();
  assert.deepEqual(eventsFor(events, older.requestId), ['queued', 'cancelled', 'settled']);
  await computeAll(fake, 3);
  const result = await newer.done;
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') assert.notEqual(result.output.videoUrl, 'blob:old-video');
  assert.deepEqual(
    morphResults(events),
    [`compute-ready:${newer.requestId}`, `file-ready:${newer.requestId}`],
    'one result, never the late one',
  );
  for (const event of events)
    if (event.type === 'compute-ready' || event.type === 'file-ready')
      assert.notEqual(event.output.videoUrl, 'blob:old-video');
  await service.dispose();
});

test('morph-intent.repeated-click-no-duplicate', async () => {
  const { fake, service, events, targets } = held();
  const first = service.requestMorph(morph('a', 'b'));
  // Accepted, not yet admitted.
  const accepted = service.requestMorph(morph('a', 'b'));
  await flush();
  assert.deepEqual(targets(), ['face:a']);
  // Running its dependencies.
  const preparing = service.requestMorph(morph('a', 'b'));
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  fake.executions[1]!.resolve(output(['b']));
  await flush();
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:']);
  // Producing frames.
  const rendering = service.requestMorph(morph('a', 'b'));
  await flush();
  for (const repeat of [accepted, preparing, rendering])
    assert.equal(repeat.requestId, first.requestId, 'a repeated click queues no second intent');
  assert.ok(!fake.calls.includes('cancel'), 'the running morph is not restarted');
  fake.executions[2]!.resolve(output());
  assert.equal((await first.done).status, 'completed');
  await flush();
  assert.deepEqual(targets(), ['face:a', 'face:b', 'morph:'], 'one inference per face, one morph');
  assert.deepEqual(
    events.filter((e) => e.intent.request.kind === 'morph' && e.type === 'queued').length,
    1,
  );
  assert.deepEqual(morphResults(events), [
    `compute-ready:${first.requestId}`,
    `file-ready:${first.requestId}`,
  ]);
  assert.equal(settledCount(events, first.requestId), 1, 'one settled result');
  await service.dispose();
});

test('morph-intent.face-failure-keeps-others', async (t) => {
  for (const order of ['fails first', 'fails second'] as const)
    await t.test(order, async () => {
      const { fake, service, events, targets } = held();
      // The morph generates both faces; face a's tile also asked for it, joining the same inference.
      const parent = service.requestMorph(
        order === 'fails first' ? morph('b', 'a') : morph('a', 'b'),
      );
      const tile = service.requestFace(face('a'));
      await flush();
      const [first, second] = order === 'fails first' ? ['b', 'a'] : ['a', 'b'];
      assert.deepEqual(targets(), [`face:${first}`]);
      const settle = (slot: string) => {
        const execution = fake.executions.find((e) => e.request.target === slot)!;
        if (slot === 'b') execution.reject(Error('face b could not finish'));
        else execution.resolve(output(['a']));
      };
      settle(first);
      await flush();
      if (order === 'fails first') {
        assert.deepEqual(targets(), ['face:b', 'face:a'], 'face a still runs after b failed');
      }
      settle(second);
      await flush();
      const result = await parent.done;
      assert.equal(result.status, 'failed');
      if (result.status !== 'failed' || result.cause.kind !== 'dependency')
        assert.fail('expected a dependency recovery');
      assert.equal(result.cause.slot, 'b');
      assert.equal(result.cause.recovery, 'retry-face');
      assert.ok(eventsFor(events, tile.requestId).includes('compute-ready'), 'face a is ready');
      fake.files[0]!.resolve(output(['a']));
      const kept = await tile.done;
      assert.equal(kept.status, 'completed', 'face a stays usable');
      assert.ok(eventsFor(events, tile.requestId).includes('file-ready'));
      assert.equal(morphExecutions(targets), 0, 'no frame production for the failed morph');
      assert.deepEqual(
        targets().filter((target) => target === 'face:a'),
        ['face:a'],
        'face a ran once',
      );
      assert.equal(settledCount(events, parent.requestId), 1);
      await service.dispose();
    });
});
