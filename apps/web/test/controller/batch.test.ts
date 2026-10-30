// The batch view (fm-id4c item 12, fm-q5b9): several files open one view; picks follow the global click order
// across files; Cancel changes nothing; OK runs one admission check, then the first pick takes the originating face
// and the rest follow it in click order. Saved faces install without inference; damaged stills only as an explicit
// photo; other-model stills stay selectable as held media; with photo encoding unavailable the saved subset still
// confirms and photos say why, with no detector work. Plain reducer values only, no browser or model evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg, type ClassifiedStill } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { refusalMessage } from '../../src/controller/admission.ts';
import { parseBatchSelection } from '../../src/contracts/batch.ts';
import { selection } from '../../src/controller/reducers/batch.ts';
import type { Effect } from '../../src/controller/effects.ts';
import type { State } from '../../src/controller/state.ts';
import { state as base } from './photo-inputs.ts';
import { offerFor } from './batch-flow.ts';
import { cropRect } from '../../src/controller/geometry.ts';

const sized = (size: number, name: string, type = 'image/jpeg'): File =>
  Object.defineProperty(new File([], name, { type }), 'size', { value: size });
const entry = (
  index: number,
  file: File,
  kind: ClassifiedStill['kind'],
  extra: Partial<ClassifiedStill> = {},
): ClassifiedStill => ({
  index,
  file,
  bytes: file.size,
  kind,
  reason:
    kind === 'missing' || kind === 'matching'
      ? null
      : {
          reasonKey: `still-${kind}`,
          text: `A ${kind} still.`,
          helpAnchor: '#help-keep-originals',
        },
  ...extra,
});
const ready = (state: State, photoReady = true, photoAvailable = true): State => ({
  ...state,
  Downloads: { ...state.Downloads, known: true, photoReady, photoAvailable },
});
const types = (effects: readonly Effect[]) => effects.map((e) => e.type);
const NO_INFERENCE = ['execute', 'downloadModels', 'consentToDownload', 'detectBatchFaces'];

/** Picks on face-2 of R (saved), A (group photo), B (portrait) and D (corrupt), in that file order. */
function openOn(state: State) {
  const R = sized(4000, 'r.png', 'image/png');
  const A = sized(9000, 'a.jpg');
  const B = sized(7000, 'b.jpg');
  const D = sized(100, 'd.jpg');
  const picked = reduce(msg('PickPhoto', 'face-2', [A, B, R, D]), state)!;
  assert.deepEqual(
    types(picked.effects).filter((t) => t !== 'rememberView'),
    ['invalidatePhotoSelections', 'classifyStills'],
  );
  const entries = [
    entry(0, A, 'missing'),
    entry(1, B, 'missing'),
    entry(2, R, 'matching'),
    entry(3, D, 'missing'),
  ];
  const opened = reduce(
    msg('Classified', 'face-2', picked.state.StillSeq!, true, 'face-2', entries),
    picked.state,
  )!;
  return { R, A, B, D, opened, before: picked.state };
}

/** A detected face whose aligned square is its box's centred square, upright. */
const face = (box: { x: number; y: number; width: number; height: number }) => ({
  ...box,
  align: { cx: box.x + box.width / 2, cy: box.y + box.height / 2, side: box.width, rotation: 0 },
});

test('R -> A2 -> B1 with a corrupt fourth file: Cancel changes nothing; OK lands R, A2, B1 in click order', () => {
  const start = ready(base);
  const { R, A, B, opened } = openOn(start);
  assert.equal(
    opened.state.Inputs,
    start.Inputs,
    'nothing about the faces changes when the view opens',
  );
  const batch = opened.state.Batch!;
  assert.deepEqual(
    batch.groups.map((g) => [g.id, g.role, g.status]),
    [
      ['f0', 'photo', 'loading'],
      ['f1', 'photo', 'loading'],
      ['f2', 'recovered', 'loading'],
      ['f3', 'photo', 'loading'],
    ],
  );
  const stage = opened.effects.find((e) => e.type === 'stageBatch');
  assert.ok(stage && stage.type === 'stageBatch');
  assert.deepEqual(
    stage.files.map((f) => [f.id, f.photo]),
    [
      ['f0', true],
      ['f1', true],
      ['f2', false],
      ['f3', true],
    ],
  );
  let s = opened.state;
  const step = (m: Parameters<typeof reduce>[0], facts = {}) => {
    const t = reduce(m, s, facts)!;
    s = t.state;
    return t;
  };
  // Photos decode, the saved still shows, the fourth file does not decode: it is left out.
  const a = step(msg('BatchStaged', batch.token, 'f0', { ok: true, offer: offerFor(A, 'a') }));
  assert.deepEqual(types(a.effects), ['detectBatchFaces'], 'the detector runs only once ready');
  step(msg('BatchStaged', batch.token, 'f1', { ok: true, offer: offerFor(B, 'b') }));
  const r = step(msg('BatchStaged', batch.token, 'f2', { ok: true, url: 'blob:r' }));
  assert.deepEqual(r.effects, [], 'a saved face needs no detection');
  step(msg('BatchStaged', batch.token, 'f3', { ok: false }));
  assert.equal(s.Batch!.groups[3]!.status, 'unreadable');
  assert.deepEqual(s.Batch!.groups[3]!.candidates, []);
  step(
    msg('BatchDetected', batch.token, 'f0', [
      face({ x: 0.1, y: 0.1, width: 0.3, height: 0.4 }),
      face({ x: 0.55, y: 0.15, width: 0.3, height: 0.4 }),
    ]),
  );
  step(msg('BatchDetected', batch.token, 'f1', []));
  assert.deepEqual(
    s.Batch!.groups.map((g) => g.candidates),
    [['f0#0', 'f0#1'], ['f1#0'], ['f2#0'], []],
  );
  // The click order, not file order, detector order or completion order.
  step(msg('BatchPick', 'f2#0'));
  step(msg('BatchPick', 'f0#1'));
  step(msg('BatchPick', 'f1#0'));
  step(msg('BatchPick', 'f3#0')); // the corrupt file offers nothing to pick
  assert.deepEqual(s.Batch!.order, ['f2#0', 'f0#1', 'f1#0']);
  assert.equal(parseBatchSelection(selection(s.Batch!)).ok, true, 'a valid contract selection');

  // Cancel before OK: the project is exactly as it was, every staged URL is released.
  const open = s;
  const cancelled = reduce(msg('BatchCancel'), open)!;
  assert.equal(cancelled.state.Batch, undefined);
  assert.equal(cancelled.state.Inputs, start.Inputs);
  assert.equal(cancelled.state.Faces, start.Faces);
  assert.deepEqual(cancelled.state.PhotoQueue, start.PhotoQueue);
  assert.equal(cancelled.state.Held, start.Held);
  assert.equal(cancelled.state.PreparingFaces.has('face-2'), false);
  assert.deepEqual(
    cancelled.effects
      .filter((e) => e.type === 'revokeUrl')
      .map((e) => (e as { url: string }).url)
      .sort(),
    ['blob:a', 'blob:b', 'blob:r'],
  );
  assert.ok(!types(cancelled.effects).some((t) => NO_INFERENCE.includes(t) || t === 'selectPhoto'));

  // OK: one check, then R takes face-2 and A2, B1 follow it; face-1 and later faces keep their places.
  const ok = reduce(msg('BatchOk'), open, { newPhotoIds: ['n0', 'n1', 'n2'] })!;
  assert.deepEqual(
    ok.state.Inputs.map((i) => i.id),
    ['face-1', 'face-2', 'n1', 'n2'],
  );
  assert.equal(ok.state.Batch, undefined);
  // R recovers through the bridge's own entry (no inference) first; then A2 and B1 enter the existing crop
  // confirmation one at a time in pick order.
  assert.deepEqual(
    ok.effects.filter((e) => e.type === 'selectPhoto'),
    [{ type: 'selectPhoto', id: 'face-2', files: [R] }],
  );
  assert.deepEqual(ok.state.PhotoQueue, [
    ['n1', A],
    ['n2', B],
  ]);
  // A2's detected box is its proposed crop when its confirmation opens; B1 (one face) keeps the default proposal.
  assert.deepEqual([...(ok.state.CropProposals ?? new Map()).keys()], ['n1']);
  assert.ok(!types(ok.effects).some((t) => NO_INFERENCE.includes(t)), 'no inference at OK');
  // When A2's confirmation opens, its view is the box: zoomed in, centred on the second face.
  const offered = reduce(
    msg('Photo', 'n1', { kind: 'crop', offer: offerFor(A, 'a2') }),
    ok.state,
  )!.state;
  const view = offered.Crop!.view;
  const rect = cropRect(view);
  assert.ok(view.side < 600, 'the proposal is the detected face, not the whole photo');
  assert.ok(
    Math.abs(rect.left - 0.55 * 800) < 1 && Math.abs(rect.top - 0.15 * 600) < 1,
    JSON.stringify(rect),
  );
  assert.equal(offered.CropProposals?.has('n1'), false, 'a proposal is used once');
});

test('deselect removes and reselect appends: A1, B2, deselect A1, reselect A1 gives B2, A1', () => {
  const { A, B, opened } = openOn(ready(base));
  let s = opened.state;
  const token = s.Batch!.token;
  s = reduce(msg('BatchStaged', token, 'f0', { ok: true, offer: offerFor(A, 'a') }), s)!.state;
  s = reduce(msg('BatchStaged', token, 'f1', { ok: true, offer: offerFor(B, 'b') }), s)!.state;
  const two = [
    face({ x: 0, y: 0, width: 0.4, height: 0.5 }),
    face({ x: 0.5, y: 0, width: 0.4, height: 0.5 }),
  ];
  s = reduce(msg('BatchDetected', token, 'f0', two), s)!.state;
  s = reduce(msg('BatchDetected', token, 'f1', two), s)!.state;
  for (const c of ['f0#0', 'f1#1', 'f0#0', 'f0#0'] as const)
    s = reduce(msg('BatchPick', c), s)!.state;
  assert.deepEqual(s.Batch!.order, ['f1#1', 'f0#0']);
});

test('zero picks: OK does nothing; the view stays open', () => {
  const { opened } = openOn(base);
  const ok = reduce(msg('BatchOk'), opened.state, { newPhotoIds: [] })!;
  assert.equal(ok.state, opened.state);
  assert.deepEqual(ok.effects, []);
});

test('without photo processing ready, photos are offered whole and no detector runs; ready later, it looks', () => {
  const { A, opened } = openOn(base);
  const token = opened.state.Batch!.token;
  const staged = reduce(
    msg('BatchStaged', token, 'f0', { ok: true, offer: offerFor(A, 'a') }),
    opened.state,
  )!;
  assert.deepEqual(staged.effects, []);
  assert.deepEqual(staged.state.Batch!.groups[0]!.candidates, ['f0#0']);
  const now = reduce(
    msg('DownloadsChanged', {
      ...staged.state.Downloads,
      known: true,
      photoAvailable: true,
      photoReady: true,
    }),
    staged.state,
  )!;
  assert.deepEqual(
    now.effects
      .filter((e) => e.type === 'detectBatchFaces')
      .map((e) => (e as { group: string }).group),
    ['f0'],
  );
  assert.equal(now.state.Batch!.groups[0]!.detection, 'running');
});

test('damaged recovery: nothing to pick; Use as photo only explicitly, and only when its pixels decode', () => {
  const D = sized(5000, 'damaged.png', 'image/png');
  const S = sized(6000, 'saved.png', 'image/png');
  const dropped = reduce(msg('Photos', null, [D, S]), base)!;
  const opened = reduce(
    msg('Classified', '*', dropped.state.StillSeq!, false, null, [
      entry(0, D, 'damaged', { decodes: true, url: '' }),
      entry(1, S, 'matching'),
    ]),
    dropped.state,
  )!;
  const token = opened.state.Batch!.token;
  assert.deepEqual(opened.state.Batch!.groups[0]!.candidates, []);
  assert.equal(reduce(msg('BatchPick', 'f0#0'), opened.state)!.state.Batch!.order.length, 0);
  const used = reduce(msg('BatchUseAsPhoto', 'f0'), opened.state)!;
  assert.deepEqual(used.effects, [
    { type: 'stageBatch', token, files: [{ id: 'f0', file: D, photo: true }] },
  ]);
  const asPhoto = reduce(
    msg('BatchStaged', token, 'f0', { ok: true, offer: offerFor(D, 'd') }),
    used.state,
  )!.state;
  assert.deepEqual(asPhoto.Batch!.groups[0]!.candidates, ['f0#0']);
  // Undecodable damaged pixels never offer the photo action.
  const D2 = sized(50, 'broken.png', 'image/png');
  const d2 = reduce(msg('Photos', null, [D2, S]), base)!;
  const o2 = reduce(
    msg('Classified', '*', d2.state.StillSeq!, false, null, [
      entry(0, D2, 'damaged', { decodes: false, url: '' }),
      entry(1, S, 'matching'),
    ]),
    d2.state,
  )!;
  assert.equal(reduce(msg('BatchUseAsPhoto', 'f0'), o2.state)!.state, o2.state);
});

test('an incompatible-model still is selectable; it lands held, shown and saved with compute disabled', () => {
  const M = sized(5000, 'other.png', 'image/png');
  const P = sized(6000, 'p.jpg');
  const dropped = reduce(msg('Photos', 'face-1', [M, P]), base)!;
  const opened = reduce(
    msg('Classified', 'face-1', dropped.state.StillSeq!, false, 'face-1', [
      entry(0, M, 'incompatible-model', { decodes: true, url: 'blob:m' }),
      entry(1, P, 'missing'),
    ]),
    dropped.state,
  )!;
  assert.deepEqual(opened.state.Batch!.groups[0]!.candidates, ['f0#0']);
  const picked = reduce(msg('BatchPick', 'f0#0'), opened.state)!.state;
  const ok = reduce(msg('BatchOk'), picked, { newPhotoIds: ['x'] })!;
  const held = ok.state.Held?.get('face-1');
  assert.equal(held?.kind, 'incompatible-model');
  assert.equal(held?.file, M);
  assert.equal(held?.url, 'blob:m', 'its display URL is kept for the face');
  assert.equal(ok.state.Inputs.find((i) => i.id === 'face-1')!.mode, 'project');
  assert.ok(!ok.effects.some((e) => e.type === 'revokeUrl' && e.url === 'blob:m'));
  assert.ok(!types(ok.effects).some((t) => NO_INFERENCE.includes(t) || t === 'selectPhoto'));
});

test('photo encoding unavailable: photos say why and offer nothing, no detector; the saved subset confirms', () => {
  const unavailable = ready(base, false, false);
  const { R, opened } = openOn(unavailable);
  const batch = opened.state.Batch!;
  assert.deepEqual(
    batch.groups.map((g) => g.status),
    ['unavailable', 'unavailable', 'loading', 'unavailable'],
  );
  let s = opened.state;
  for (const id of ['f0', 'f1', 'f3'])
    s = reduce(msg('BatchStaged', batch.token, id, { ok: true, offer: offerFor(R, id) }), s)!.state;
  const r = reduce(msg('BatchStaged', batch.token, 'f2', { ok: true, url: 'blob:r' }), s)!;
  assert.ok(!types(r.effects).includes('detectBatchFaces'));
  s = r.state;
  assert.deepEqual(
    s.Batch!.groups.map((g) => g.candidates),
    [[], [], ['f2#0'], []],
  );
  s = reduce(msg('BatchPick', 'f0#0'), s)!.state;
  s = reduce(msg('BatchPick', 'f2#0'), s)!.state;
  assert.deepEqual(s.Batch!.order, ['f2#0']);
  const ok = reduce(msg('BatchOk'), s, { newPhotoIds: ['n0'] })!;
  assert.deepEqual(
    ok.state.Inputs.map((i) => i.id),
    ['face-1', 'face-2'],
  );
  assert.deepEqual(
    ok.effects.filter((e) => e.type === 'selectPhoto'),
    [{ type: 'selectPhoto', id: 'face-2', files: [R] }],
  );
  assert.ok(!types(ok.effects).some((t) => NO_INFERENCE.includes(t) || t === 'chooseDetectedFace'));
});

test('a single saved still dropped alone keeps the direct recovery path: no batch view', () => {
  const R = sized(4000, 'r.png', 'image/png');
  const dropped = reduce(msg('Photos', 'face-1', [R]), base)!;
  const next = reduce(
    msg('Classified', 'face-1', dropped.state.StillSeq!, false, 'face-1', [
      entry(0, R, 'matching'),
    ]),
    dropped.state,
    { newPhotoIds: ['unused'] },
  )!;
  assert.equal(next.state.Batch, undefined);
  assert.deepEqual(
    next.effects.filter((e) => e.type === 'selectPhoto'),
    [{ type: 'selectPhoto', id: 'face-1', files: [R] }],
  );
});

test('one admission check at OK: over the photo budget nothing is added, the view keeps the picks to reduce', () => {
  const big = 50 * 2 ** 20;
  const A = sized(big, 'a.jpg');
  const B = sized(big, 'b.jpg');
  const dropped = reduce(msg('Photos', null, [A, B]), base)!;
  // Two photos fit the drop's check, but not at OK once another face meanwhile took a 60 MB photo.
  const opened = reduce(
    msg('Classified', '*', dropped.state.StillSeq!, false, null, [
      entry(0, A, 'missing'),
      entry(1, B, 'missing'),
    ]),
    dropped.state,
  )!;
  let s = opened.state;
  for (const [id, f] of [
    ['f0', A],
    ['f1', B],
  ] as const)
    s = reduce(
      msg('BatchStaged', s.Batch!.token, id, { ok: true, offer: offerFor(f, id) }),
      s,
    )!.state;
  s = reduce(msg('BatchPick', 'f0#0'), s)!.state;
  s = reduce(msg('BatchPick', 'f1#0'), s)!.state;
  s = {
    ...s,
    Inputs: [s.Inputs[0]!, { ...s.Inputs[1]!, mode: 'photo', file: sized(60 * 2 ** 20, 'm.jpg') }],
  };
  const ok = reduce(msg('BatchOk'), s, { newPhotoIds: ['n0', 'n1'] })!;
  assert.equal(ok.state.Inputs, s.Inputs, 'nothing added, not even part of the selection');
  assert.deepEqual(ok.state.PhotoQueue, s.PhotoQueue);
  const message = refusalMessage('BATCH_RETAINED_INPUT_BYTES', 128 * 2 ** 20);
  assert.equal(ok.state.Batch?.refused, message, 'the view names the limit');
  assert.deepEqual(ok.effects, [
    { type: 'admissionRefused', budget: 'BATCH_RETAINED_INPUT_BYTES' },
  ]);
  // Reducing the selection clears the message and then fits.
  const fewer = reduce(msg('BatchPick', 'f1#0'), ok.state)!.state;
  assert.equal(fewer.Batch?.refused, undefined);
  const added = reduce(msg('BatchOk'), fewer, { newPhotoIds: ['n0'] })!;
  assert.equal(added.state.Batch, undefined);
  assert.ok(added.effects.some((e) => e.type === 'selectPhoto' && e.files[0] === A));
});

test('no face count at OK: a batch takes 64 faces to 65 and 150 to 152', () => {
  for (const count of [64, 150]) {
    const many: State = {
      ...base,
      Inputs: Array.from({ length: count }, (_, i) => ({
        id: `f-${i}`,
        mode: 'text' as const,
        value: `w${i}`,
        file: null,
      })),
    };
    const A = sized(1000, 'a.jpg');
    const S = sized(1000, 's.png', 'image/png');
    const picked = reduce(msg('PickPhoto', `f-${count - 1}`, [A, S]), many)!;
    let s = reduce(
      msg('Classified', `f-${count - 1}`, picked.state.StillSeq!, true, `f-${count - 1}`, [
        entry(0, A, 'missing'),
        entry(1, S, 'matching'),
      ]),
      picked.state,
    )!.state;
    s = reduce(
      msg('BatchStaged', s.Batch!.token, 'f0', { ok: true, offer: offerFor(A) }),
      s,
    )!.state;
    s = reduce(msg('BatchStaged', s.Batch!.token, 'f1', { ok: true, url: 'blob:s' }), s)!.state;
    s = reduce(msg('BatchPick', 'f1#0'), s)!.state;
    s = reduce(msg('BatchPick', 'f0#0'), s)!.state;
    const ok = reduce(msg('BatchOk'), s, { newPhotoIds: ['x0', 'x1'] })!;
    assert.equal(ok.state.Inputs.length, count + 1);
    assert.deepEqual(
      ok.state.Inputs.slice(-2).map((i) => i.id),
      [`f-${count - 1}`, 'x1'],
    );
  }
});

test('the originating face removed while the view is open: OK adds nothing', () => {
  const { A, opened } = openOn(base);
  let s = reduce(
    msg('BatchStaged', opened.state.Batch!.token, 'f0', { ok: true, offer: offerFor(A) }),
    opened.state,
  )!.state;
  s = reduce(msg('BatchPick', 'f0#0'), s)!.state;
  const gone: State = { ...s, Inputs: s.Inputs.filter((i) => i.id !== 'face-2') };
  const ok = reduce(msg('BatchOk'), gone, { newPhotoIds: ['n0'] })!;
  assert.equal(ok.state.Inputs, gone.Inputs);
  assert.equal(ok.state.Batch, undefined);
  assert.match(ok.state.Error ?? '', /removed, so nothing was added/);
  assert.ok(!types(ok.effects).includes('selectPhoto'));
});

test('a late display or detection for a closed or superseded view changes nothing and releases its URL', () => {
  const { A, opened } = openOn(base);
  const token = opened.state.Batch!.token;
  const closed = reduce(msg('BatchCancel'), opened.state)!.state;
  const late = reduce(
    msg('BatchStaged', token, 'f0', { ok: true, offer: offerFor(A, 'late') }),
    closed,
  )!;
  assert.equal(late.state, closed);
  assert.deepEqual(late.effects, [{ type: 'revokeUrl', url: 'blob:late' }]);
  assert.equal(reduce(msg('BatchDetected', token, 'f0', []), closed)!.state, closed);
});
