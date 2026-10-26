// Remove, Start over and Undo (face.many, fm-id4c), as pure reducers. A removal hides the face and cancels its
// owned work; the facade's invalidateFace is deferred until the notice expires or the next action replaces it,
// so Undo re-shows the same face with no bridge call. One notice at a time (undo depth 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg, type Msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { NEXT_ACTIONS, UNDO_MS } from '../../src/controller/reducers/undo.ts';
import type { Effect } from '../../src/controller/effects.ts';
import type { Face, State } from '../../src/controller/state.ts';
import { recovered, state as initial } from './photo-inputs.ts';
import { createStore } from '../../src/controller/store.ts';
import { cancelled } from '../../src/controller/reducers/jobs.ts';
import { scheduled } from '../../src/controller/reducers/schedule.ts';

const base: State = {
  ...initial,
  Downloads: { ...initial.Downloads, known: true, routeReady: true, photoReady: true },
};
const face = (id: string): Face => ({
  id,
  raw: false,
  url: `blob:${id}`,
  label: id,
  sourceMode: 'text',
  sourceFile: null,
});
const project = (count: number, extra: Partial<State> = {}): State => {
  const inputs = Array.from({ length: count }, (_, i) => ({
    id: `f-${i}`,
    mode: (i % 2 ? 'seed' : 'text') as 'seed' | 'text',
    value: i % 2 ? String(1000 + i) : `words ${i}`,
    file: null,
  }));
  return { ...base, Inputs: inputs, Faces: inputs.map((i) => face(i.id)), ...extra };
};
const ids = (s: State) => s.Inputs.map((i) => i.id);
const invalidations = (effects: readonly Effect[]) =>
  effects.filter((e) => e.type === 'invalidateFace').map((e) => (e as { id: string }).id);
const step = (s: State, m: Msg, facts = {}) => {
  const t = reduce(m, s, facts);
  assert.ok(t, m.type);
  return t;
};
const startOverIds = ['fresh-a', 'fresh-b'] as const;

test('Remove a middle face hides exactly that face; Undo restores it at the same index with the same content', () => {
  const before = project(5);
  const removed = step(before, msg('Remove', 'f-2'));
  assert.deepEqual(ids(removed.state), ['f-0', 'f-1', 'f-3', 'f-4']);
  assert.deepEqual(invalidations(removed.effects), [], 'no invalidateFace while Undo is offered');
  assert.ok(removed.effects.some((e) => e.type === 'invalidateMorph'));
  assert.ok(!removed.state.Faces.some((f) => f.id === 'f-2'));
  assert.equal(removed.state.Undo?.kind, 'remove');
  assert.equal(removed.state.Undo?.index, 2);
  const undone = step(removed.state, msg('Undo'));
  assert.deepEqual(undone.state.Inputs, before.Inputs, 'same index, same text/seed');
  assert.deepEqual(
    undone.state.Faces.find((f) => f.id === 'f-2'),
    before.Faces.find((f) => f.id === 'f-2'),
    'the same retained result (URL) is shown again',
  );
  assert.deepEqual(invalidations(undone.effects), [], 'Undo makes no invalidateFace call');
  assert.ok(!undone.effects.some((e) => e.type === 'execute' || e.type === 'requestNext'));
  assert.equal(undone.state.Undo, undefined);
});

test('the notice ends after its timeout with exactly one invalidateFace; a stale timeout does nothing', () => {
  assert.ok(UNDO_MS >= 5000, 'long enough to read and press');
  const removed = step(project(3), msg('Remove', 'f-1'));
  const seq = removed.state.Undo!.seq;
  assert.ok(removed.effects.some((e) => e.type === 'expireUndo' && e.seq === seq));
  const stale = step(removed.state, msg('UndoExpired', seq - 1));
  assert.equal(stale.state, removed.state);
  const ended = step(removed.state, msg('UndoExpired', seq));
  assert.deepEqual(invalidations(ended.effects), ['f-1']);
  assert.equal(ended.state.Undo, undefined);
  assert.equal(step(ended.state, msg('Undo')).state, ended.state, 'nothing left to undo');
});

test('the next action replaces the notice: exactly one invalidateFace, then the action applies', () => {
  for (const type of ['Edit', 'AddAt', 'Run', 'Kind'] as const) {
    const removed = step(project(3), msg('Remove', 'f-0'));
    const action =
      type === 'Edit'
        ? msg('Edit', 'f-1', 'changed')
        : type === 'AddAt'
          ? msg('AddAt', 1)
          : type === 'Run'
            ? msg('Run', 'morph')
            : msg('Kind', removed.state.Kind);
    assert.ok(NEXT_ACTIONS.has(type));
    const next = step(removed.state, action, { newFaceId: 'f-new' });
    assert.deepEqual(invalidations(next.effects).slice(0, 1), ['f-0'], type);
    assert.equal(invalidations(next.effects).filter((id) => id === 'f-0').length, 1, type);
    assert.equal(next.state.Undo, undefined, type);
  }
  // Progress, completions and preview loads are not a person's action: the notice stays.
  const removed = step(project(3), msg('Remove', 'f-0'));
  assert.ok(!NEXT_ACTIONS.has('Progressed') && !NEXT_ACTIONS.has('Completed'));
  assert.ok(step(removed.state, msg('OverflowToggle', true)).state.Undo);
});

test('undo depth is one: a second Remove commits the first; Undo restores only the second', () => {
  const first = step(project(4), msg('Remove', 'f-1'));
  const second = step(first.state, msg('Remove', 'f-2'));
  assert.deepEqual(invalidations(second.effects), ['f-1']);
  const undone = step(second.state, msg('Undo'));
  assert.deepEqual(ids(undone.state), ['f-0', 'f-2', 'f-3']);
});

test('twenty removes from thirty leave exactly ten faces, each released once', () => {
  let s = project(30);
  const released: string[] = [];
  for (let i = 0; i < 20; i++) {
    const t = step(s, msg('Remove', s.Inputs[3]!.id));
    released.push(...invalidations(t.effects));
    s = t.state;
  }
  released.push(...invalidations(step(s, msg('UndoExpired', s.Undo!.seq)).effects));
  assert.equal(s.Inputs.length, 10);
  assert.equal(released.length, 20);
  assert.equal(new Set(released).size, 20);
});

test('the last face is never removed', () => {
  const one = project(1);
  assert.equal(step(one, msg('Remove', 'f-0')).state, one);
  // Hidden faces do not count: two faces, one removed, the other stays.
  const removed = step(project(2), msg('Remove', 'f-0'));
  assert.equal(step(removed.state, msg('Remove', 'f-1')).state, removed.state);
});

test('Start over: two empty faces in one action; Undo restores every face in order with content', () => {
  for (const count of [3, 30, 64, 150]) {
    const before = project(count);
    const over = step(before, msg('StartOver'), { startOverIds });
    assert.deepEqual(over.state.Inputs, [
      { id: 'fresh-a', mode: 'text', value: '', file: null },
      { id: 'fresh-b', mode: 'text', value: '', file: null },
    ]);
    assert.deepEqual(over.state.Faces, []);
    assert.deepEqual(invalidations(over.effects), [], `${count}: nothing released yet`);
    const undone = step(over.state, msg('Undo'));
    assert.deepEqual(undone.state.Inputs, before.Inputs, `${count}: order and content`);
    assert.deepEqual(
      [...undone.state.Faces].sort((a, b) => a.id.localeCompare(b.id)),
      [...before.Faces].sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(invalidations(undone.effects), []);
    const ended = step(over.state, msg('UndoExpired', over.state.Undo!.seq));
    assert.equal(invalidations(ended.effects).length, count, `${count}: each released once`);
  }
  assert.throws(() => reduce(msg('StartOver'), project(3)), /two fresh face IDs/);
});

test('removing a generating face cancels its owned work; siblings keep theirs; a late result is not installed', () => {
  const running = project(3, {
    Busy: true,
    JobId: 9,
    ActiveFace: 'f-1',
    Stage: 'face',
    PendingFaces: ['f-2'],
    PendingJobs: [msg('RunFace', 'f-2')],
    Faces: [face('f-0')],
  });
  const removed = step(running, msg('Remove', 'f-1'));
  const types = removed.effects.map((e) => `${e.type}${'id' in e ? `:${e.id}` : ''}`);
  for (const expected of ['cancelQueuedFace:f-1', 'cancelSlot:f-1', 'cancelWork'])
    assert.ok(types.includes(expected), expected);
  assert.ok(!types.some((t) => t.endsWith(':f-2')), 'the sibling keeps its queued job');
  assert.deepEqual(removed.state.PendingJobs, [msg('RunFace', 'f-2')]);
  assert.equal(removed.state.Stage, 'cancelling');
  // The cancelled job's late completion carries f-1: it is not installed while hidden.
  const late = step(
    removed.state,
    msg('Completed', 9, { ...recovered, faces: [face('f-0'), face('f-1')] }),
  );
  assert.ok(!late.state.Faces.some((f) => f.id === 'f-1'));
  // Removing a queued (not active) face cancels only its slot, never the running job.
  const queued = step(running, msg('Remove', 'f-2'));
  assert.ok(!queued.effects.some((e) => e.type === 'cancelWork'));
  assert.ok(queued.effects.some((e) => e.type === 'cancelSlot' && e.id === 'f-2'));
});

test('Create Morph excludes the hidden face during the Undo window', () => {
  const removed = step(project(3), msg('Remove', 'f-1'));
  const run = step(removed.state, msg('Run', 'morph'));
  const execute = run.effects.find((e) => e.type === 'execute') as
    | Extract<Effect, { type: 'execute' }>
    | undefined;
  const sent = execute?.request.inputs ?? run.state.RunInputs;
  assert.ok(sent.length > 0);
  assert.ok(!sent.some((i) => i.id === 'f-1'));
});

test('automatic sibling continuation preserves Remove Undo; a subsequent user action commits it once', () => {
  for (const routeReady of [true, false]) {
    const effects: Effect[] = [];
    const store = createStore(
      project(3, {
        Downloads: { ...base.Downloads, routeReady },
        Busy: true,
        JobId: 9,
        ActiveFace: 'f-1',
        Stage: 'face',
        PendingFaces: ['f-2'],
        PendingJobs: [msg('RunFace', 'f-2')],
        Faces: [face('f-0')],
      }),
      {
        runEffects(batch) {
          effects.push(...batch);
          for (const effect of batch) {
            if (effect.type === 'requestNext') store.update((s) => scheduled(s, 0));
            if (effect.type === 'dispatch')
              store.dispatch(effect.message, 'continuation' in effect ? effect : undefined);
            if (effect.type === 'checkCachedFace')
              store.dispatch(msg('CachedFaceChecked', effect.input, true));
          }
        },
      },
    );
    store.dispatch(msg('Remove', 'f-1'));
    const notice = store.getState().Undo;
    assert.ok(notice);
    store.update((s) => cancelled(s, 9));
    assert.equal(store.getState().ActiveFace, 'f-2', 'the sibling really starts');
    assert.equal(store.getState().Undo, notice, 'queued work is not a new user action');
    assert.deepEqual(invalidations(effects), []);
    store.dispatch(msg('Edit', 'f-0', 'new words'));
    assert.equal(store.getState().Undo, undefined);
    assert.equal(invalidations(effects).filter((id) => id === 'f-1').length, 1);
    store.dispatch(msg('UndoExpired', notice.seq));
    assert.equal(invalidations(effects).filter((id) => id === 'f-1').length, 1);
    store.dispose();
  }
});

test('automatic readiness after Remove preserves Undo through a pending queued action', () => {
  const removed = step(project(3), msg('Remove', 'f-1')).state;
  const ready = step(
    {
      ...removed,
      Downloads: { ...base.Downloads, known: false },
      Gate: ['route', msg('RunFace', 'f-2')],
      Faces: [face('f-0')],
    },
    msg('DownloadsChanged', base.Downloads),
  );
  const resume = ready.effects.find((effect) => effect.type === 'dispatch');
  assert.ok(resume && 'continuation' in resume && resume.continuation);
  const continued = reduce(resume.message, ready.state, { continuation: resume.continuation })!;
  assert.equal(continued.state.ActiveFace, 'f-2');
  assert.equal(continued.state.Undo, removed.Undo);
  assert.deepEqual(invalidations([...ready.effects, ...continued.effects]), []);
});
