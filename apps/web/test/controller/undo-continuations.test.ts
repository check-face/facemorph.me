// Asynchronous crop/encode results belong to the original request, not a new person's action (fm-id4c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg, type Msg } from '../../src/controller/msg.ts';
import { reduce, type ControllerFacts } from '../../src/controller/reducers/index.ts';
import type { Effect, Transition } from '../../src/controller/effects.ts';
import type { State } from '../../src/controller/state.ts';
import { MULTIPLE_FACES_MESSAGE } from '../../shell/facade/bridge.ts';
import { file, recovered, state as initial } from './photo-inputs.ts';
import { scheduled, scheduling } from '../../src/controller/reducers/schedule.ts';
import { requestNext } from '../../src/operations/bridge-service.ts';

function removal(id = 'hidden', extra: Partial<State> = {}): State {
  const source: State = {
    ...initial,
    Inputs: [
      { id: 'hidden', mode: 'text', value: 'retained face', file: null },
      { id: 'photo', mode: 'photo', value: 'photo.jpg', file: file('photo.jpg') },
      { id: 'other', mode: 'text', value: 'another face', file: null },
    ],
    Faces: [
      {
        id: 'hidden',
        raw: false,
        url: 'blob:retained',
        label: 'retained',
        sourceMode: 'text',
        sourceFile: null,
      },
    ],
    Downloads: { ...initial.Downloads, known: true, routeReady: true, photoReady: true },
    Busy: true,
    Stage: 'face',
    JobId: 9,
    ActiveFace: 'photo',
    LastRun: msg('RunFace', 'photo'),
    ...extra,
  };
  return reduce(msg('Remove', id), source)!.state;
}

/** Follow only real reducer redispatches, as the runner does, preserving their private continuation metadata. */
function settle(message: Msg, state: State, facts: ControllerFacts = {}): Transition {
  const effects: Effect[] = [];
  const pending: { message: Msg; continuation?: boolean }[] = [{ message }];
  while (pending.length) {
    const next = pending.shift()!;
    const transition = reduce(next.message, state, {
      ...facts,
      ...(next.continuation ? { continuation: true } : {}),
    })!;
    state = transition.state;
    effects.push(...transition.effects);
    for (const effect of transition.effects) {
      if (effect.type === 'dispatch')
        pending.push({
          message: effect.message,
          ...('continuation' in effect && effect.continuation ? { continuation: true } : {}),
        });
    }
  }
  return { state, effects };
}

function preservesHidden(transition: Transition, before: State) {
  assert.equal(transition.state.Undo, before.Undo, 'automatic work keeps the same Undo notice');
  const hidden = new Set(before.Undo!.hidden.map(({ input }) => input.id));
  assert.ok(
    !transition.effects.some((effect) => effect.type === 'invalidateFace' && hidden.has(effect.id)),
  );
  assert.ok(
    !transition.effects.some(
      (effect) =>
        effect.type === 'execute' && effect.request.inputs.some((input) => hidden.has(input.id)),
    ),
  );
}

test('asynchronous completed/multiple-face crop requests preserve unrelated Remove Undo', () => {
  const before = removal();
  for (const message of [
    msg('Completed', 9, { ...recovered, cropFace: 'photo' }),
    msg('Failed', 9, MULTIPLE_FACES_MESSAGE),
  ]) {
    const next = settle(message, before, { multipleFacesMessage: MULTIPLE_FACES_MESSAGE });
    preservesHidden(next, before);
    assert.ok(
      next.effects.some((effect) => effect.type === 'previewPhoto' && effect.id === 'photo'),
    );
    assert.equal(next.state.Busy, false);
  }
});

test('asynchronous confirmed crop starts only its own encoding and preserves unrelated Remove Undo', () => {
  const before = removal('hidden', { Stage: 'cropping', ActiveFace: null });
  const image = file('confirmed.jpg');
  const next = settle(msg('Cropped', 'photo', 2, image), before, { photoRevision: 2 });
  preservesHidden(next, before);
  assert.equal(next.state.ActiveFace, 'photo');
  assert.equal(next.state.Inputs.find((input) => input.id === 'photo')?.file, image);
  const execution = next.effects.find((effect) => effect.type === 'execute');
  assert.ok(execution?.type === 'execute');
  assert.deepEqual(
    execution.request.inputs.map((input) => input.id),
    ['photo'],
  );
});

test('a late crop result for a removed face cannot release its retained Undo result or start encoding', () => {
  const before = removal('photo', {
    Stage: 'cropping',
    ActiveFace: null,
    Faces: [
      {
        id: 'photo',
        raw: false,
        url: 'blob:retained-photo',
        label: 'photo',
        sourceMode: 'photo',
        sourceFile: file('photo.jpg'),
      },
    ],
  });
  assert.equal(before.Undo?.faces[0]?.url, 'blob:retained-photo');
  const next = settle(msg('Cropped', 'photo', 2, file('late.jpg')), before, { photoRevision: 2 });
  preservesHidden(next, before);
  assert.equal(next.state, before);
  assert.deepEqual(next.effects, []);
});

for (const [kind, message] of [
  ['crop completion', msg('Completed', 9, { ...recovered, cropFace: 'photo' })],
  ['multiple-face failure', msg('Failed', 9, MULTIPLE_FACES_MESSAGE)],
] as const)
  test(`a current-job ${kind} for a removed target settles cancellation and schedules its surviving sibling`, () => {
    const before = removal('photo', {
      PendingFaces: ['other'],
      PendingJobs: [msg('RunFace', 'other')],
    });
    const next = settle(message, before, { multipleFacesMessage: MULTIPLE_FACES_MESSAGE });
    preservesHidden(next, before);
    assert.equal(next.state.Busy, false);
    assert.equal(next.state.ActiveFace, null);
    assert.equal(next.state.Status, 'Cancelled. Your completed faces are still available.');
    assert.ok(!next.state.PreparingFaces.has('photo'));
    assert.ok(
      !next.effects.some((effect) => effect.type === 'dispatch' || effect.type === 'previewPhoto'),
    );
    assert.ok(next.effects.some((effect) => effect.type === 'requestNext'));
    const plan = scheduling(next.state);
    const ready = scheduled(next.state, requestNext(plan.jobs, plan.options));
    const dispatch = ready.effects.find((effect) => effect.type === 'dispatch');
    assert.ok(dispatch?.type === 'dispatch' && 'continuation' in dispatch && dispatch.continuation);
    const running = reduce(dispatch.message, ready.state, { continuation: dispatch.continuation })!;
    preservesHidden(running, before);
    assert.equal(running.state.ActiveFace, 'other');
    assert.deepEqual(
      running.state.RunInputs.map((input) => input.id),
      ['other'],
    );
  });

test('explicit Retry and GateAccept still end Undo before their requested face run', () => {
  for (const message of [msg('Retry'), msg('GateAccept')]) {
    const before = removal('hidden', {
      Busy: false,
      ActiveFace: null,
      Gate: ['route', msg('RunFace', 'photo')],
    });
    const next = settle(message, before);
    assert.equal(next.state.Undo, undefined);
    assert.equal(
      next.effects.filter((effect) => effect.type === 'invalidateFace' && effect.id === 'hidden')
        .length,
      1,
    );
    assert.equal(next.state.ActiveFace, 'photo');
  }
});
