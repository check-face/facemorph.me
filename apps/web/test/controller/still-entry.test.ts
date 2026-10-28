// fm-4f5m: every chosen or dropped file is classified by the recovery reader before any face changes; held kinds
// are media the face shows and saves as it is, never computed with; late verdicts for a superseded pick or drop
// change nothing. Real fixture bytes; reducer transitions are plain values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { msg, type ClassifiedStill } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import {
  SHIPPED_MODELS,
  classifyStillBytes,
  classifyStills,
  isHeld,
  stillLog,
} from '../../src/media/still-entry.ts';
import { state } from './photo-inputs.ts';
import { confirmAll } from './batch-flow.ts';
import { futureSchemaPng } from '../support/recovery-stills.ts';
import type { State } from '../../src/controller/state.ts';

const at = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const bytes = (path: string) => new Uint8Array(readFileSync(at(path)));
const still = (name: string) => bytes(`apps/web/test/fixtures/verify/stills/${name}`);
const crop = (name: string) => bytes(`tests/crop/fixtures/${name}`);

const asFile = (data: Uint8Array, name: string, type = 'image/png') =>
  new File([data.slice().buffer as ArrayBuffer], name, { type });

test('classification by kind: shipped identity, reasons as data, damage class and version named', () => {
  // The fixture stills were written for test identities (model 2222…/9999…), not the shipped generator.
  assert.equal(classifyStillBytes(still('recovery-v2.png')).kind, 'unknown-model');
  const loaded = { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) };
  const other = { modelSha256: '9'.repeat(64), noiseSha256: '3'.repeat(64) };
  const models = {
    loaded: { ...loaded, latent: SHIPPED_MODELS.loaded.latent },
    known: [loaded, other],
  };
  assert.deepEqual(classifyStillBytes(still('recovery-v2.png'), models), {
    kind: 'matching',
    reason: null,
  });
  assert.equal(classifyStillBytes(still('recovery-v2.webp'), models).kind, 'matching');
  const mismatch = classifyStillBytes(still('model-mismatch-v2.png'), models);
  assert.equal(mismatch.kind, 'incompatible-model');
  assert.equal(mismatch.reason?.reasonKey, 'still-model-mismatch');
  assert.match(mismatch.reason!.text, /different model.*left out of morphs/);
  const unknown = classifyStillBytes(still('model-mismatch-v2.png'));
  assert.equal(unknown.kind, 'unknown-model');
  assert.equal(unknown.reason?.reasonKey, 'still-model-unknown');
  assert.equal(unknown.reason?.helpAnchor, '#help-keep-originals');
  const flipped = classifyStillBytes(still('damaged-v1.png'));
  assert.equal(flipped.kind, 'damaged');
  assert.match(flipped.reason!.reasonKey, /^still-damaged-[a-z-]+$/);
  const v2 = still('recovery-v2.png');
  const truncated = classifyStillBytes(v2.subarray(0, v2.length - 5));
  assert.equal(truncated.kind, 'damaged');
  assert.equal(truncated.reason?.reasonKey, 'still-damaged-container');
  const future = classifyStillBytes(futureSchemaPng(9));
  assert.equal(future.kind, 'incompatible-schema');
  assert.match(future.reason!.text, /version 9/);
  for (const name of ['non-square.jpg', 'no-face.jpg', 'malformed.jpg'])
    assert.equal(classifyStillBytes(crop(name)).kind, 'missing', name);
  assert.equal(
    classifyStillBytes(bytes('packages/stylegan-js/test/vectors/plain.png')).kind,
    'missing',
  );
  assert.deepEqual(
    [
      'matching',
      'missing',
      'damaged',
      'incompatible-schema',
      'incompatible-model',
      'unknown-model',
    ].map((kind) => isHeld(kind as never)),
    [false, false, true, true, true, true],
  );
});

const MIX = [
  () => asFile(crop('non-square.jpg'), 'photo.jpg', 'image/jpeg'),
  () => asFile(still('model-mismatch-v2.png'), 'other.png'),
  () => asFile(still('damaged-v1.png'), 'flipped.png'),
  () => asFile(futureSchemaPng(7), 'future.png'),
  () => asFile(still('recovery-v2.png'), 'test-model.png'),
];
const files = (n: number) => Array.from({ length: n }, (_, i) => MIX[i % MIX.length]!());

test('classifyStills keeps file order and logs only index, size, kind, reason key and revision', async () => {
  const entries = await classifyStills(files(5));
  assert.deepEqual(
    entries.map((e) => [e.index, e.kind]),
    [
      [0, 'missing'],
      [1, 'unknown-model'],
      [2, 'damaged'],
      [3, 'incompatible-schema'],
      [4, 'unknown-model'],
    ],
  );
  const log = stillLog(entries[1]!, 'face-2', 4, true);
  assert.deepEqual(Object.keys(log), [
    'index',
    'bytes',
    'kind',
    'reasonKey',
    'target',
    'revision',
    'applied',
  ]);
  assert.equal(log.bytes, still('model-mismatch-v2.png').length);
  assert.doesNotMatch(JSON.stringify(log), /other\.png/);
});

/** The runner's verdict for a held still: a display URL when it decodes (damaged: none). */
const verdicts = async (list: readonly File[]): Promise<ClassifiedStill[]> =>
  (await classifyStills(list)).map((e) =>
    isHeld(e.kind)
      ? { ...e, decodes: true, url: e.kind === 'damaged' ? '' : `blob:held-${e.index}` }
      : e,
  );

for (const n of [1, 2, 3, 8, 30]) {
  test(`a ${n}-file drop mixing classes classifies every file before any face changes`, async () => {
    const empty: State = {
      ...state,
      Inputs: [{ ...state.Inputs[0]!, value: '' }, state.Inputs[1]!],
    };
    const list = files(n);
    const dropped = reduce(msg('Photos', null, list), empty)!;
    assert.equal(dropped.state.Inputs, empty.Inputs, 'no face changes before classification');
    assert.equal(dropped.state.Faces, empty.Faces);
    assert.deepEqual(
      dropped.effects.filter((e) => e.type !== 'rememberView').map((e) => e.type),
      ['classifyStills'],
    );
    const entries = await verdicts(list);
    const ids = list.map((_, i) => `new-${i}`);
    const next = reduce(
      msg('Classified', '*', dropped.state.StillSeq!, false, null, entries),
      dropped.state,
      { newPhotoIds: ids },
    )!;
    if (n > 1) {
      // Several files open the batch view (fm-id4c, fm-q5b9): no face changes until its OK, every file is
      // offered in drop order, a damaged still offers nothing unless explicitly used as a photo.
      assert.equal(next.state.Inputs, dropped.state.Inputs, 'no face changes before OK');
      assert.deepEqual(
        next.state.Batch!.groups.map((g) => g.entry.kind),
        entries.map((e) => e.kind),
      );
      const confirmed = confirmAll(next.state, { newPhotoIds: ids });
      const picked = entries.filter((e) => e.kind !== 'damaged');
      const placed = ['face-1', ...ids.slice(1, picked.length)];
      assert.deepEqual(
        confirmed.state.Inputs.map((i) => i.id),
        [...placed, 'face-2'],
      );
      const photos = picked.flatMap((e, i) =>
        isHeld(e.kind) ? [] : [[placed[i]!, e.file] as const],
      );
      assert.deepEqual(
        confirmed.effects.filter((e) => e.type === 'selectPhoto'),
        photos.length ? [{ type: 'selectPhoto', id: photos[0]![0], files: [photos[0]![1]] }] : [],
      );
      assert.deepEqual(confirmed.state.PhotoQueue, photos.slice(1));
      picked.forEach((entry, i) => {
        const held = confirmed.state.Held?.get(placed[i]!);
        if (!isHeld(entry.kind)) return assert.equal(held, undefined);
        assert.equal(held?.kind, entry.kind);
        assert.equal(held?.file, entry.file, 'the held file is the original File');
        assert.equal(confirmed.state.Inputs.find((x) => x.id === placed[i])!.mode, 'project');
        assert.equal(held?.url, `blob:held-${entry.index}`);
      });
      assert.ok(
        ![...(confirmed.state.Held?.values() ?? [])].some((h) => h.kind === 'damaged'),
        'a damaged still is never added implicitly',
      );
      assert.ok(
        !confirmed.effects.some((e) => e.type === 'execute' || e.type === 'downloadModels'),
      );
      return;
    }
    const targets = ['face-1', ...ids.slice(0, n - 1)];
    assert.deepEqual(
      next.state.Inputs.map((i) => i.id),
      ['face-1', 'face-2', ...ids.slice(0, n - 1)],
    );
    const photos = entries.flatMap((e, i) =>
      isHeld(e.kind) ? [] : [[targets[i]!, e.file] as const],
    );
    const selected = next.effects.filter((e) => e.type === 'selectPhoto');
    assert.deepEqual(
      selected,
      photos.length ? [{ type: 'selectPhoto', id: photos[0]![0], files: [photos[0]![1]] }] : [],
    );
    assert.deepEqual(next.state.PhotoQueue, photos.slice(1));
    entries.forEach((entry, i) => {
      const id = targets[i]!;
      const held = next.state.Held?.get(id);
      const input = next.state.Inputs.find((x) => x.id === id)!;
      if (!isHeld(entry.kind)) return assert.equal(held, undefined);
      assert.equal(held?.kind, entry.kind);
      assert.equal(held?.file, entry.file, 'the held file is the original File');
      if (entry.kind === 'damaged') {
        // Identity unchanged: a damaged still never replaces what the face was.
        assert.equal(input.mode, i === 0 ? empty.Inputs[0]!.mode : 'text');
        assert.equal(held?.url, '');
      } else {
        assert.equal(input.mode, 'project');
        assert.equal(held?.url, `blob:held-${i}`);
      }
    });
    assert.ok(!next.effects.some((e) => e.type === 'execute' || e.type === 'downloadModels'));
  });
}

test('a late verdict for a superseded drop, pick or edited face is discarded and its URLs revoked', async () => {
  const [a, b] = [files(2), files(2)];
  const first = reduce(msg('Photos', null, a), state)!;
  const second = reduce(msg('Photos', null, b), first.state)!;
  const late = await verdicts(a);
  const stale = reduce(
    msg('Classified', '*', first.state.StillSeq!, false, null, late),
    second.state,
    { newPhotoIds: ['x', 'y'] },
  )!;
  assert.equal(stale.state, second.state);
  assert.deepEqual(stale.effects, [{ type: 'revokeUrl', url: 'blob:held-1' }]);
  // A pick superseded by an edit of the same face.
  const pick = reduce(msg('PickPhoto', 'face-2', [a[1]!]), state)!;
  const edited = reduce(msg('Edit', 'face-2', 'typed instead'), pick.state)!;
  const [verdict] = await verdicts([a[1]!]);
  const dropped = reduce(
    msg('Classified', 'face-2', pick.state.StillSeq!, true, 'face-2', [verdict!]),
    edited.state,
  )!;
  assert.equal(dropped.state, edited.state);
  assert.equal(dropped.state.Held?.has('face-2') ?? false, false);
  // The current pick applies.
  const applied = reduce(
    msg('Classified', 'face-2', pick.state.StillSeq!, true, 'face-2', [verdict!]),
    pick.state,
  )!;
  assert.equal(applied.state.Held?.get('face-2')?.kind, 'unknown-model');
  assert.equal(applied.state.PreparingFaces.has('face-2'), false);
});

test('a held other-model face: shown, Save asks for its bytes, never generated; Use as photo is explicit', async () => {
  const [verdict] = await verdicts([asFile(still('model-mismatch-v2.png'), 'other.png')]);
  const pick = reduce(msg('PickPhoto', 'face-2', [verdict!.file]), state)!;
  const held = reduce(
    msg('Classified', 'face-2', pick.state.StillSeq!, true, 'face-2', [verdict!]),
    pick.state,
  )!;
  assert.deepEqual(
    held.effects.filter((e) => e.type !== 'rememberView' && e.type !== 'requestNext'),
    [{ type: 'invalidateFace', id: 'face-2' }],
    'no selection, encode, detector or acquisition (requestNext only re-plans already pending work)',
  );
  assert.deepEqual(held.state.PendingJobs, []);
  assert.equal(held.state.Inputs.find((i) => i.id === 'face-2')?.mode, 'project');
  assert.deepEqual(reduce(msg('Save', 'face-2'), held.state)!.effects, [
    { type: 'saveMedia', id: 'face-2' },
  ]);
  const run = reduce(msg('RunFace', 'face-2'), held.state)!;
  assert.ok(!run.effects.some((e) => e.type === 'selectPhoto' || e.type === 'previewPhoto'));
  const use = reduce(msg('UseAsPhoto', 'face-2'), held.state)!;
  assert.deepEqual(use.effects, [
    { type: 'invalidatePhotoSelections', id: 'face-2' },
    { type: 'previewPhoto', id: 'face-2', file: verdict!.file },
  ]);
  // Remove hides the face for its Undo window (fm-id4c); the still is released when the notice ends.
  const removed = reduce(msg('Remove', 'face-2'), held.state)!;
  assert.equal(removed.state.Held?.has('face-2'), true, 'kept while Undo is offered');
  const ended = reduce(msg('UndoExpired', removed.state.Undo!.seq), removed.state)!;
  assert.equal(ended.state.Held?.has('face-2'), false);
  assert.ok(ended.effects.some((e) => e.type === 'revokeUrl' && e.url === 'blob:held-0'));
  // A damaged still that does not decode offers no Use as photo.
  const [damaged] = await classifyStills([
    asFile(still('recovery-v2.png').subarray(0, 4000), 't.png'),
  ]);
  const pick2 = reduce(msg('PickPhoto', 'face-1', [damaged!.file]), state)!;
  const kept = reduce(
    msg('Classified', 'face-1', pick2.state.StillSeq!, true, 'face-1', [
      { ...damaged!, decodes: false, url: '' },
    ]),
    pick2.state,
  )!;
  assert.equal(kept.state.Inputs, state.Inputs, 'identity unchanged');
  assert.equal(kept.state.Held?.get('face-1')?.photoAction, false);
  assert.equal(reduce(msg('UseAsPhoto', 'face-1'), kept.state)!.state, kept.state);
});

test('scan: the entry path never fetches, and no URL from file metadata is followed', () => {
  for (const path of [
    'apps/web/src/media/still-entry.ts',
    'apps/web/src/media/recovery-files.ts',
    'packages/stylegan-js/src/media/inspect-still.ts',
    'packages/stylegan-js/src/media/envelope.ts',
    'packages/stylegan-js/src/contracts/recovery-metadata.ts',
  ]) {
    const code = readFileSync(fileURLToPath(at(path)), 'utf8').replace(
      /\/\/.*$|\/\*[\s\S]*?\*\//gm,
      '',
    );
    assert.doesNotMatch(
      code,
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(|new\s+Image\b|\.src\s*=/,
      path,
    );
  }
  // The runner's classify step reads bytes and decodes pixels only.
  const runner = readFileSync(fileURLToPath(at('apps/web/src/controller/runner.ts')), 'utf8');
  const classify = runner.slice(
    runner.indexOf('async function classify('),
    runner.indexOf('function handOver('),
  );
  assert.ok(classify.length > 100);
  assert.doesNotMatch(classify, /fetch|import\(|\.src\s*=/);
});
