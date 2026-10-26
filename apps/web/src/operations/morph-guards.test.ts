// fm-fy2.9 (morph.guards): the frame budget, identical-neighbour rule and MP4 probe run at Morph
// acceptance, before any dependency, acquisition or inference. Named after the bead's acceptance rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MORPH_FRAME_BUDGET } from '../contracts/ceilings.ts';
import { MORPH_KINDS } from '../../shell/facade/records.ts';
import { MP4_UNAVAILABLE, probeMp4 } from '../media/mp4-probe.ts';
import { createOperationService } from './bridge-service.ts';
import {
  cancelledOutput,
  eventsFor,
  fakeBridge,
  flush,
  output,
  route,
  settings,
  source,
} from './fake-bridge.ts';
import { morphFrameFailure, overBudgetMessage } from './morph-budget.ts';
import {
  identicalNeighbours,
  morphChecks,
  neighbourFailure,
  neighbourMessage,
  resolveInputIdentity,
  sameFace,
  type FaceIdentity,
  type IdentityResolver,
} from './morph-guards.ts';
import type { OperationEvent, OperationRequest, SourceSnapshot } from './service.ts';

type Morph = Extract<OperationRequest, { kind: 'morph' }>;
const LIMIT = MORPH_FRAME_BUDGET.maxFrames;
const loop = (values: readonly string[], kind: Morph['settings']['kind'] = 'linear'): Morph => ({
  kind: 'morph',
  sources: values.map((value, index) => source(`slot-${index + 1}`, value)),
  route,
  settings: { ...settings, kind },
});
const many = (count: number, frames: number, kind: Morph['settings']['kind']): Morph => ({
  ...loop(
    Array.from({ length: count }, (_, i) => `face ${i}`),
    kind,
  ),
  settings: { ...settings, kind, frames },
});
const evenAtMost = (n: number) => Math.floor(n / 2) * 2;

// ---- Frame budget ----------------------------------------------------------------------------------

test('budget: at, under and over the contract frame budget across shape modes and counts 2, 3, 8, 64, 150', () => {
  assert.equal(LIMIT, 4096, 'the classic 4,096-frame value applies until a measured budget lands');
  for (const kind of MORPH_KINDS)
    for (const count of [2, 3, 8, 64, 150]) {
      const at = evenAtMost(LIMIT / count); // the longest even length that fits (exactly 4,096 where it divides)
      const fits = many(count, at, kind);
      assert.equal(morphFrameFailure(fits), undefined, `${kind} ${count}×${at} fits`);
      if (at > 2)
        assert.equal(morphFrameFailure(many(count, at - 2, kind)), undefined, `${kind} under`);
      const over = many(count, at + 2, kind);
      const before = structuredClone(over);
      const failure = morphFrameFailure(over);
      assert.equal(failure?.kind, 'morph-frames', `${kind} ${count}×${at + 2} is over`);
      if (failure?.kind !== 'morph-frames') continue;
      assert.equal(failure.reason, 'over-budget');
      assert.equal(failure.recovery, 'shorten-morph');
      assert.equal(failure.message, overBudgetMessage(count * (at + 2), LIMIT));
      assert.deepEqual(over, before, 'never truncates the selected faces');
    }
  // Exactly at the budget and one frame over it (the estimate the message names).
  assert.equal(morphFrameFailure(many(2, LIMIT / 2, 'linear')), undefined);
  assert.equal(morphFrameFailure(many(64, LIMIT / 64, 'full-smooth-figure8')), undefined);
  assert.match(overBudgetMessage(LIMIT + 1, LIMIT), /4,097 frames, over the 4,096-frame limit/);
});

test('budget: no face count refusal; the message names the limit, the estimate and reduce length', () => {
  for (const count of [2, 3, 8, 64, 150, 1000])
    assert.equal(morphFrameFailure(many(count, 2, 'linear')), undefined, `${count} faces at 2`);
  const failure = morphFrameFailure(many(150, 32, 'full-smooth-figure8'));
  assert.equal(failure?.kind, 'morph-frames');
  assert.equal(
    failure?.message,
    'This morph would need 4,800 frames, over the 4,096-frame limit for one morph. Choose a shorter Length under More options to reduce it. Your selected faces are kept.',
  );
});

// ---- Identical neighbours (defect 6) -------------------------------------------------------------

const resolveNames =
  (map: Record<string, string>): IdentityResolver =>
  async (s, model) => ({ digest: map[s.input.value] ?? s.input.value, model });
const pairOf = async (values: readonly string[], resolve?: IdentityResolver) =>
  (await neighbourFailure(loop(values), resolve)) ?? null;

test('neighbour-rule.aa', async () => {
  const failure = await pairOf(['alpha', 'alpha']);
  assert.equal(failure?.kind, 'morph-neighbours');
  if (failure?.kind === 'morph-neighbours') assert.deepEqual(failure.faces, [1, 2]);
});
test('neighbour-rule.abb', async () => {
  const failure = await pairOf(['alpha', 'beta', 'beta']);
  if (failure?.kind !== 'morph-neighbours') assert.fail('expected a refusal');
  assert.deepEqual(failure.faces, [2, 3]);
  assert.deepEqual(failure.slots, ['slot-2', 'slot-3']);
});
test('neighbour-rule.aba-closing-pair', async () => {
  const failure = await pairOf(['alpha', 'beta', 'alpha']);
  if (failure?.kind !== 'morph-neighbours') assert.fail('the closing pair 3 -> 1 is adjacent');
  assert.deepEqual(failure.faces, [3, 1]);
});
test('neighbour-rule.abac-allowed', async () => {
  assert.equal(await pairOf(['alpha', 'beta', 'alpha', 'gamma']), null);
});
test('neighbour-rule.abc-allowed', async () => {
  assert.equal(await pairOf(['alpha', 'beta', 'gamma']), null);
});
test('neighbour-rule.same-latent-different-words', async () => {
  // Two words resolving to one latent are the same face: labels are never compared.
  const resolve = resolveNames({ 'Ada Lovelace': 'latent-1', ada: 'latent-1' });
  assert.equal((await pairOf(['Ada Lovelace', 'ada', 'beta'], resolve))?.kind, 'morph-neighbours');
  // And the real model-free derivation: a word and the seed it does not equal are different faces,
  // while the same word typed twice resolves to one Z latent.
  const a = await resolveInputIdentity(source('x', 'same words'), 'model');
  const b = await resolveInputIdentity(source('y', 'same words'), 'model');
  assert.ok(a && b && sameFace(a, b));
});
test('neighbour-rule.same-word-different-model', () => {
  const a: FaceIdentity = { digest: 'z:abc', model: 'model-a', values: [1, 2] };
  const b: FaceIdentity = { digest: 'z:abc', model: 'model-b', values: [1, 2] };
  assert.equal(sameFace(a, b), false);
  assert.equal(identicalNeighbours([a, b]), undefined);
});
test('neighbour-rule.near-identical-below-1e-12', () => {
  const base = Array.from({ length: 512 }, (_, i) => Math.sin(i));
  const near = base.map((x, i) => (i === 7 ? x + 1e-13 : x));
  const far = base.map((x, i) => (i === 7 ? x + 1e-9 : x));
  const id = (values: number[], digest: string): FaceIdentity => ({ digest, model: 'm', values });
  assert.equal(sameFace(id(base, 'a'), id(near, 'b')), true, 'below 1e-12 is the same face');
  assert.equal(sameFace(id(base, 'a'), id(far, 'b')), false);
  assert.deepEqual(identicalNeighbours([id(base, 'a'), id(far, 'c'), id(near, 'b')]), {
    first: 2,
    second: 0,
  });
});
test('neighbour-rule.message-names-faces', () => {
  assert.equal(
    neighbourMessage({ first: 2, second: 0 }),
    'Faces 3 and 1 are the same, and the loop goes from face 3 back to face 1. Change one of them or add a different face between them.',
  );
  assert.equal(
    neighbourMessage({ first: 1, second: 2 }),
    'Faces 2 and 3 are the same, and they are next to each other in the loop. Change one of them or add a different face between them.',
  );
});

/** Waits (real time, bounded) for asynchronous pre-checks such as the SHA-256 identity digest. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await flush();
  assert.ok(ready(), 'condition not reached');
}

function held(checks: NonNullable<Parameters<typeof createOperationService>[0]>['morphChecks']) {
  const fake = fakeBridge();
  const service = createOperationService({
    bridge: fake.bridge,
    ...(checks ? { morphChecks: checks } : {}),
  });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  return { fake, service, events };
}

test('neighbour-rule.no-work-before-refusal (zero model requests, zero inference)', async () => {
  for (const values of [
    ['alpha', 'alpha'],
    ['alpha', 'beta', 'alpha'],
    ['seed words', 'seed words', 'gamma'],
  ]) {
    let probed = 0;
    const { fake, service, events } = held(
      morphChecks({
        probe: async () => {
          probed++;
          return probeMp4({ fps: 16, webcodecs: async () => true, ffmpeg: async () => 'absent' });
        },
      }),
    );
    const handle = service.requestMorph(loop(values));
    const result = await handle.done;
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') continue;
    assert.equal(result.cause.kind, 'morph-neighbours');
    assert.deepEqual(eventsFor(events, handle.requestId), ['queued', 'failed', 'settled']);
    assert.deepEqual(fake.calls, [], 'no provider call: no acquisition, no inference');
    assert.equal(probed, 0, 'the refusal comes before the MP4 probe');
    await service.dispose();
  }
});

test('neighbour-rule: a valid change clears the refusal and Morph proceeds', async () => {
  const { fake, service } = held(morphChecks({}));
  const refused = await service.requestMorph(loop(['alpha', 'beta', 'alpha'])).done;
  assert.equal(refused.status, 'failed');
  const changed = loop(['alpha', 'beta', 'gamma']);
  const sources: SourceSnapshot[] = changed.sources.map((s, i) =>
    i === 2 ? { ...s, revision: (s.revision + 1) as SourceSnapshot['revision'] } : s,
  );
  service.revise('slot-3', sources[2]!.revision);
  const handle = service.requestMorph({ ...changed, sources });
  await until(() => fake.executions.length > 0);
  assert.deepEqual(
    fake.executions.map((e) => `${e.request.action}:${e.request.target}`),
    ['face:slot-1'],
    'dependency work starts once the loop is valid',
  );
  service.cancel({ requestId: handle.requestId });
  for (const e of fake.executions) e.resolve(cancelledOutput());
  await handle.done;
  await service.dispose();
});

// ---- MP4 probe in the service ------------------------------------------------------------------------

test('mp4-probe.probe-before-synthesis: no dependency or frame work until the probe answers', async () => {
  let answer!: (supported: boolean) => void;
  const { fake, service, events } = held(
    morphChecks({
      probe: () =>
        probeMp4({
          fps: 16,
          webcodecs: () => new Promise<boolean>((resolve) => (answer = resolve)),
          ffmpeg: async () => 'absent',
        }),
    }),
  );
  const handle = service.requestMorph(loop(['alpha', 'beta']));
  await until(() => answer !== undefined);
  await flush();
  assert.deepEqual(fake.calls, [], 'nothing runs while the probe is pending');
  answer(true);
  await until(() => fake.calls.length > 0);
  assert.deepEqual(
    (fake.calls as string[]).filter((c) => c.startsWith('execute:')),
    ['execute:face:slot-1'],
  );
  assert.ok(!eventsFor(events, handle.requestId).includes('disclosure'), '1024 needs no notice');
  service.cancel({ requestId: handle.requestId });
  for (const e of fake.executions) e.resolve(cancelledOutput());
  await handle.done;
  await service.dispose();
});

test('mp4-probe.none in the service: zero synthesis, an explanation, faces untouched', async () => {
  const { fake, service, events } = held(
    morphChecks({
      probe: () => probeMp4({ fps: 16, webcodecs: null, ffmpeg: async () => 'absent' }),
    }),
  );
  const handle = service.requestMorph(loop(['alpha', 'beta']));
  const result = await handle.done;
  if (result.status !== 'failed') assert.fail('expected the no-route refusal');
  assert.deepEqual(result.cause, {
    kind: 'mp4-route',
    message: MP4_UNAVAILABLE,
    recovery: 'save-faces',
  });
  assert.doesNotMatch(MP4_UNAVAILABLE, /video is ready|exported/i);
  assert.deepEqual(eventsFor(events, handle.requestId), ['queued', 'failed', 'settled']);
  assert.deepEqual(fake.calls, []);
  await service.dispose();
});

test('mp4-probe.disclosure-512 in the service: Morph status says 512 × 512 before frames start', async () => {
  const { fake, service, events } = held(
    morphChecks({
      probe: () =>
        probeMp4({
          fps: 16,
          webcodecs: async (s) => s.width === 512,
          ffmpeg: async () => 'absent',
        }),
    }),
  );
  const handle = service.requestMorph(loop(['alpha', 'beta']));
  await until(() => fake.executions.length > 0);
  const types = eventsFor(events, handle.requestId);
  assert.deepEqual(types.slice(0, 2), ['queued', 'disclosure']);
  const notice = events.find((e) => e.type === 'disclosure');
  assert.ok(notice?.type === 'disclosure' && /512 × 512/.test(notice.text) && notice.width === 512);
  for (let i = 0; i < fake.executions.length; i++) {
    const e = fake.executions[i]!;
    e.resolve(output(e.request.action === 'face' ? [e.request.target] : []));
    await flush();
  }
  await flush();
  const at = (type: string) => events.findIndex((e) => e.type === type);
  assert.ok(at('disclosure') < at('admitted') || at('admitted') === -1);
  service.cancel({ requestId: handle.requestId });
  for (const e of fake.executions) e.resolve(cancelledOutput());
  await handle.done;
  await service.dispose();
});
