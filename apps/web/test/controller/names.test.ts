import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import type { PhotoSelection } from '../../shell/facade/records.ts';
import { names } from '../../src/controller/reducers/names.ts';
import { inputs } from '../../src/controller/reducers/inputs.ts';
import { compareFields, fixture, fromGolden, replayStatus, verifyControl } from './scaffold.ts';
before(verifyControl);
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
const catalogue = [{ name: 'Ada', value: 'ada', image: '/ada.webp', full: '/ada-full.webp' }];
test('opening names resets query and pagination, loading only an empty catalogue', () => {
  const first = names(msg('BrowseNames', 'face-2'), {
    ...state,
    NameQuery: 'old',
    NameLimit: 144,
  })!;
  assert.equal(first.state.Browse, 'face-2');
  assert.equal(first.state.NameQuery, '');
  assert.equal(first.state.NameLimit, 48);
  assert.deepEqual(first.effects, [{ type: 'openNamesFocus' }, { type: 'loadNames' }]);
  const loaded = names(msg('NamesLoaded', catalogue), first.state)!.state;
  assert.deepEqual(names(msg('BrowseNames', 'face-1'), loaded)!.effects, [
    { type: 'openNamesFocus' },
  ]);
  assert.equal(names(msg('MoreNames'), loaded)!.state.NameLimit, 96);
  const closed = names(msg('CloseNames'), loaded)!;
  assert.equal(closed.state.Browse, null);
  assert.deepEqual(closed.effects, [{ type: 'closeNamesFocus' }]);
});
test('choosing a name fills its slot and asks for its published result, never a generation', () => {
  const selected = names(msg('ChooseName', 'ada'), {
    ...state,
    Browse: 'face-2',
    VideoUrl: 'previous',
    CachedFaces: new Set(['face-2']),
  })!;
  assert.deepEqual(selected.state.Inputs[1], {
    id: 'face-2',
    mode: 'text',
    value: 'ada',
    file: null,
  });
  assert.equal(selected.state.Browse, null);
  assert.equal(selected.state.VideoUrl, '');
  assert.equal(selected.state.CachedFaces.has('face-2'), false);
  assert.deepEqual(selected.effects, [
    { type: 'closeNamesFocus' },
    { type: 'invalidateFace', id: 'face-2' },
    { type: 'publicPreview', id: 'face-2' },
    { type: 'pickName', id: 'face-2' },
  ]);
  assert.ok(
    selected.state.PreparingFaces.has('face-2'),
    'the face shows Loading until the result is in',
  );
  assert.equal(names(msg('ChooseName', 'ada'), state)!.state, state);
});
test('a pick for a face removed while its picker was open writes to no face', () => {
  const open = {
    ...state,
    Browse: 'face-2',
    Inputs: state.Inputs.filter((i) => i.id !== 'face-2'),
  };
  const picked = names(msg('ChooseName', 'ada'), open)!;
  assert.equal(picked.state.Browse, null);
  assert.deepEqual(picked.state.Inputs, open.Inputs);
  assert.deepEqual(picked.effects, [{ type: 'closeNamesFocus' }]);
});
test('preview completion applies only to the current input; failure removes only its preview', () => {
  for (const message of [
    msg('PreviewLoaded', 'missing', 'text', 'hello', '/wrong'),
    msg('PreviewLoaded', 'face-1', 'seed', 'hello', '/wrong'),
    msg('PreviewLoaded', 'face-1', 'text', 'outdated', '/wrong'),
  ])
    assert.equal(names(message, state)!.state, state);
  const next = names(msg('PreviewLoaded', 'face-1', 'text', 'hello', '/new'), state)!.state;
  assert.equal(next.Previews[0]?.url, '/new');
  assert.deepEqual(
    names(msg('PreviewLoaded', 'face-1', 'text', 'hello', ''), next)!.state.Previews,
    [],
  );
});
test('name-text fixture retains exact preview identity on desktop and phone', () => {
  for (const device of ['desktop', 'phone']) {
    const golden = fixture(`names.exact-text/${device}/01-typed.json`).model;
    const prior = fromGolden(golden);
    const preview = prior.Previews.find((p) => p.id === 'face-2');
    assert.ok(preview);
    const result = names(
      msg('PreviewLoaded', preview.id, preview.mode, preview.value, preview.url),
      { ...prior, Previews: prior.Previews.filter((p) => p.id !== preview.id) },
    )!;
    compareFields(result, golden, ['Previews', 'Inputs', 'Browse']);
  }
});
test('unrecorded names modal journeys are explicitly untested', (t) => {
  const status = replayStatus('names.modal');
  assert.equal(status.status, 'untested');
  t.diagnostic(JSON.stringify(status));
  const changed = replayStatus('names.open-pick');
  assert.equal(changed.status, 'owner-graded');
  assert.match(changed.reason!, /ws-names/);
  t.diagnostic(JSON.stringify(changed));
});
test('a failed name list is held for the open picker and cleared by reopening or loading', () => {
  const opened = names(msg('BrowseNames', 'face-1'), state)!;
  assert.deepEqual(opened.effects, [{ type: 'openNamesFocus' }, { type: 'loadNames' }]);
  const failed = names(msg('NamesFailed', 'The name gallery is unavailable.'), opened.state)!;
  assert.equal(failed.state.NamesError, 'The name gallery is unavailable.');
  assert.equal(failed.state.Browse, 'face-1', 'the picker stays open to show the failure');
  assert.deepEqual(failed.effects, []);
  const closed = names(msg('CloseNames'), failed.state)!;
  assert.equal(closed.state.Browse, null);
  const reopened = names(msg('BrowseNames', 'face-1'), closed.state)!;
  assert.equal('NamesError' in reopened.state, false);
  assert.deepEqual(reopened.effects, [{ type: 'openNamesFocus' }, { type: 'loadNames' }]);
  const loaded = names(msg('NamesLoaded', catalogue), failed.state)!.state;
  assert.equal('NamesError' in loaded, false);
  assert.equal('NamesError' in state, false, 'not part of the frozen control model');
});
test('typing describes no request; only an explicit act describes an instant picture', () => {
  for (const value of ['3', '38', '389', 'b', 'ba', 'banana']) {
    const typed = inputs(msg('Edit', 'face-1', value), state)!;
    assert.deepEqual(
      typed.effects.filter((e) => e.type === 'publicPreview' || e.type === 'loadNames'),
      [],
      value,
    );
  }
  const seed = inputs(msg('Mode', 'face-1', 'seed'), state)!;
  assert.deepEqual(
    seed.effects.filter((e) => e.type === 'publicPreview'),
    [{ type: 'publicPreview', id: 'face-1' }],
  );
});
const face = {
  id: 'face-2',
  url: 'blob:ada',
  raw: false,
  label: 'ada',
  sourceMode: 'text',
  sourceFile: null,
};
const recovered = (faces: readonly (typeof face)[]) =>
  ({ kind: 'recovered', output: { faces } }) as unknown as PhotoSelection;
test('a published result installs as that face for the exact picked text, without a job', () => {
  const picked = names(msg('ChooseName', 'ada'), { ...state, Browse: 'face-2' })!.state;
  const done = names(msg('NamePicked', 'face-2', 'ada', recovered([face])), picked)!;
  assert.deepEqual(done.state.Faces, [face]);
  assert.equal(done.state.PreparingFaces.has('face-2'), false);
  assert.equal(done.state.Inputs[1]!.value, 'ada');
  assert.ok(
    !done.effects.some((e) => e.type === 'execute' || e.type === 'dispatch'),
    'no inference',
  );
});
test('a result for text edited or a face removed since the pick installs nothing', () => {
  const picked = names(msg('ChooseName', 'ada'), { ...state, Browse: 'face-2' })!.state;
  const edited = {
    ...picked,
    Inputs: picked.Inputs.map((i) => (i.id === 'face-2' ? { ...i, value: 'adam' } : i)),
  };
  const late = names(msg('NamePicked', 'face-2', 'ada', recovered([face])), edited)!;
  assert.deepEqual(late.state.Faces, edited.Faces);
  assert.equal(late.state.PreparingFaces.has('face-2'), false);
  const removed = { ...picked, Inputs: picked.Inputs.filter((i) => i.id !== 'face-2') };
  assert.deepEqual(
    names(msg('NamePicked', 'face-2', 'ada', recovered([face])), removed)!.state.Faces,
    removed.Faces,
  );
  const superseded = names(msg('NamePicked', 'face-2', 'ada', { kind: 'superseded' }), picked)!;
  assert.deepEqual(superseded.state.Faces, picked.Faces);
});
