// One admission check (face.many, fm-id4c): real budgets only, never a face count. Each budget is checked at,
// under and one over its ceiling; 65 and 150 faces are admitted while the budgets allow; a refused request adds
// nothing (no partial drop) and names the limit in one plain message, from every entry path that adds faces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  admit,
  admitTo,
  refusalMessage,
  retainedPhotoBytes,
  type AdmissionBudget,
} from '../../src/controller/admission.ts';
import { lookupCeiling } from '../../src/contracts/ceilings.ts';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { inputs } from '../../src/controller/reducers/inputs.ts';
import { photo } from '../../src/controller/reducers/photo.ts';
import type { HeldStill, State } from '../../src/controller/state.ts';
import { state } from './photo-inputs.ts';

const limitOf = (name: AdmissionBudget): number => {
  const found = lookupCeiling(name, { kind: 'all-routes' });
  assert.ok(found.admitted);
  return found.ceiling.value;
};
const PHOTO = limitOf('BATCH_RETAINED_INPUT_BYTES');
const SESSION = limitOf('STORED_SESSION_BYTES');
/** A file of `size` bytes without allocating them: reducers only read `size` and pass the File through. */
const sized = (size: number, name = 'photo.jpg'): File =>
  Object.defineProperty(new File([], name, { type: 'image/jpeg' }), 'size', { value: size });
const faces = (count: number, base: State = state): State => ({
  ...base,
  Inputs: Array.from({ length: count }, (_, i) => ({
    id: `f-${i}`,
    mode: 'text' as const,
    value: '',
    file: null,
  })),
});

test('the budgets are the contracts ceilings: 128 MB retained photo input, 32 MB stored session', () => {
  assert.equal(PHOTO, 128 * 2 ** 20);
  assert.equal(SESSION, 32 * 2 ** 20);
  assert.equal(
    refusalMessage('BATCH_RETAINED_INPUT_BYTES', PHOTO),
    'Not added: photos for your faces can use at most 128 MB, and this would go over it. Choose fewer or smaller photos, or remove a photo face.',
  );
  assert.equal(
    refusalMessage('STORED_SESSION_BYTES', SESSION),
    'Not added: a saved session can hold at most 32 MB, and this would go over it. Remove some faces first.',
  );
});

test('retained photo-input bytes: under, at and one over the ceiling', () => {
  const none = { retainedPhotoBytes: 0, storedSessionBytes: 0 };
  assert.deepEqual(admit(none, { files: [sized(PHOTO - 1)] }), { ok: true });
  assert.deepEqual(admit(none, { files: [sized(PHOTO)] }), { ok: true });
  assert.deepEqual(admit({ ...none, retainedPhotoBytes: PHOTO - 10 }, { files: [sized(10)] }), {
    ok: true,
  });
  assert.deepEqual(admit({ ...none, retainedPhotoBytes: PHOTO - 10 }, { files: [sized(11)] }), {
    ok: false,
    budget: 'BATCH_RETAINED_INPUT_BYTES',
    limit: PHOTO,
    requested: PHOTO + 1,
    message: refusalMessage('BATCH_RETAINED_INPUT_BYTES', PHOTO),
  });
});

test('stored-session bytes: under, at and one over the ceiling', () => {
  const at = (stored: number, added = 0) =>
    admit(
      { retainedPhotoBytes: 0, storedSessionBytes: stored },
      { files: [], sessionBytes: added },
    );
  assert.deepEqual(at(SESSION - 1), { ok: true });
  assert.deepEqual(at(SESSION), { ok: true });
  assert.deepEqual(at(SESSION - 5, 5), { ok: true });
  assert.deepEqual(at(SESSION + 1), {
    ok: false,
    budget: 'STORED_SESSION_BYTES',
    limit: SESSION,
    requested: SESSION + 1,
    message: refusalMessage('STORED_SESSION_BYTES', SESSION),
  });
  assert.equal(at(SESSION - 5, 6).ok, false);
  // An amount that is not a byte count is refused, naming the ceiling, never admitted.
  const bad = at(Number.NaN);
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.limit === SESSION);
});

test('no face count: 65 and 150 faces are admitted while the budgets allow', () => {
  for (const count of [64, 65, 150, 1000]) {
    const many = faces(count);
    assert.deepEqual(admitTo(many, { files: [] }), { ok: true }, `${count} faces`);
    assert.deepEqual(admitTo(many, { files: [sized(1024)] }), { ok: true });
  }
});

test('retained photo bytes count each held Blob once, and leave out the face being replaced', () => {
  const a = sized(100, 'a.jpg');
  const b = sized(30, 'b.jpg');
  const c = sized(7, 'c.jpg');
  const s: State = {
    ...state,
    Inputs: [
      { id: 'one', mode: 'photo', value: 'a.jpg', file: a },
      { id: 'two', mode: 'text', value: '', file: null },
    ],
    PhotoQueue: [['two', b]],
    Crop: null,
    CropQueue: [],
    Held: new Map([['three', { file: c } as HeldStill]]),
  };
  assert.equal(retainedPhotoBytes(s), 137);
  assert.equal(retainedPhotoBytes({ ...s, PhotoQueue: [['one', a]] }), 107, 'the same Blob once');
  assert.equal(retainedPhotoBytes(s, 'one'), 37);
  // Replacing face one's photo releases its bytes, so a same-size replacement at the limit is admitted.
  const full: State = {
    ...s,
    Inputs: [{ id: 'one', mode: 'photo', value: 'a.jpg', file: sized(PHOTO - 37) }],
  };
  assert.equal(admitTo(full, { files: [sized(1)] }).ok, false);
  assert.equal(admitTo(full, { files: [sized(PHOTO - 37)], replacing: 'one' }).ok, true);
});

test('AddAt beyond 64: the 65th and 151st faces are added at their position', () => {
  for (const count of [64, 150]) {
    const many = faces(count);
    const next = inputs(msg('AddAt', 1), many, { newFaceId: 'fresh' })!;
    assert.equal(next.state.Inputs.length, count + 1);
    assert.equal(next.state.Inputs[1]?.id, 'fresh');
    assert.deepEqual(next.effects, [
      { type: 'invalidateArrivalRestore' },
      { type: 'invalidateMorph' },
    ]);
  }
});

test('AddAt over the stored-session budget adds nothing and names the limit', () => {
  const many = faces(64);
  const refusedAt = inputs(msg('AddAt', 64), many, {
    newFaceId: 'fresh',
    storedSessionBytes: SESSION + 1,
  })!;
  assert.equal(refusedAt.state.Inputs, many.Inputs, 'no face added');
  assert.equal(refusedAt.state.NextId, many.NextId);
  assert.equal(refusedAt.state.Status, refusalMessage('STORED_SESSION_BYTES', SESSION));
  assert.deepEqual(refusedAt.effects, [
    { type: 'admissionRefused', budget: 'STORED_SESSION_BYTES' },
  ]);
  const atLimit = inputs(msg('AddAt', 64), many, {
    newFaceId: 'fresh',
    storedSessionBytes: SESSION,
  })!;
  assert.equal(atLimit.state.Inputs.length, 65);
});

test('a drop over the photo budget is refused whole, before classification, and names the limit', () => {
  const files = [sized(PHOTO / 2), sized(PHOTO / 2), sized(1)];
  for (const target of [null, 'face-1']) {
    const dropped = photo(msg('Photos', target, files), state)!;
    assert.equal(dropped.state.Inputs, state.Inputs);
    assert.equal(dropped.state.StillChecks, state.StillChecks, 'no classification starts');
    assert.equal(dropped.state.Status, refusalMessage('BATCH_RETAINED_INPUT_BYTES', PHOTO));
    assert.deepEqual(
      dropped.effects,
      [{ type: 'admissionRefused', budget: 'BATCH_RETAINED_INPUT_BYTES' }],
      'no classification or bridge call; the refusal is traced',
    );
  }
  // The same files without the one extra byte are admitted and go on to classification.
  const ok = photo(msg('Photos', null, files.slice(0, 2)), state)!;
  assert.equal(ok.effects[0]?.type, 'classifyStills');
});

test('a drop admitted before classification but over budget when its faces are added adds nothing', () => {
  const files = Array.from({ length: 3 }, (_, i) => sized(PHOTO / 4, `p${i}.jpg`));
  const dropped = photo(msg('Photos', null, files), state)!;
  assert.equal(dropped.effects[0]?.type, 'classifyStills');
  // Meanwhile another face took a photo: the three no longer fit.
  const meanwhile: State = {
    ...dropped.state,
    Inputs: [
      { ...dropped.state.Inputs[0]!, mode: 'photo', file: sized(PHOTO / 2) },
      dropped.state.Inputs[1]!,
    ],
  };
  const entries = files.map((file, index) => ({
    index,
    file,
    bytes: file.size,
    kind: 'missing' as const,
    reason: null,
    url: `blob:p${index}`,
  }));
  const next = photo(
    msg('Classified', '*', dropped.state.StillSeq!, false, null, entries),
    meanwhile,
    {
      newPhotoIds: ['n0', 'n1', 'n2'],
    },
  )!;
  assert.equal(next.state.Inputs, meanwhile.Inputs, 'no partial insertion');
  assert.deepEqual(next.state.PhotoQueue, meanwhile.PhotoQueue);
  assert.equal(next.state.StillChecks?.has('*'), false, 'the check is settled');
  assert.equal(next.state.Status, refusalMessage('BATCH_RETAINED_INPUT_BYTES', PHOTO));
  assert.deepEqual(
    next.effects,
    [
      ...entries.map((e) => ({ type: 'revokeUrl', url: e.url })),
      { type: 'admissionRefused', budget: 'BATCH_RETAINED_INPUT_BYTES' },
    ],
    'display URLs released, nothing selected, the refusal traced',
  );
});

test('a 150-face drop is admitted when the budgets allow and appends every face in order', () => {
  const files = Array.from({ length: 150 }, (_, i) => sized(1000, `p${i}.jpg`));
  const empty = faces(0, state);
  const dropped = photo(msg('Photos', null, files), empty)!;
  const ids = files.map((_, i) => `n${i}`);
  const next = photo(
    msg(
      'Classified',
      '*',
      dropped.state.StillSeq!,
      false,
      null,
      files.map((file, index) => ({
        index,
        file,
        bytes: file.size,
        kind: 'missing' as const,
        reason: null,
      })),
    ),
    dropped.state,
    { newPhotoIds: ids },
  )!;
  assert.deepEqual(
    next.state.Inputs.map((i) => i.id),
    ids,
  );
});

test('a pick or paste onto a face goes through the same check', () => {
  const full: State = {
    ...state,
    Inputs: [{ ...state.Inputs[0]!, mode: 'photo', file: sized(PHOTO) }, state.Inputs[1]!],
  };
  const pasted = reduce(msg('PickPhoto', 'face-2', [sized(1)]), full)!;
  assert.equal(pasted.state.Inputs, full.Inputs);
  assert.equal(pasted.state.PreparingFaces.has('face-2'), false);
  assert.equal(pasted.state.Status, refusalMessage('BATCH_RETAINED_INPUT_BYTES', PHOTO));
  assert.deepEqual(pasted.effects, [
    { type: 'admissionRefused', budget: 'BATCH_RETAINED_INPUT_BYTES' },
  ]);
  // Replacing the photo face's own file is admitted: its old bytes are released.
  const replaced = reduce(msg('PickPhoto', 'face-1', [sized(PHOTO)]), full)!;
  assert.equal(replaced.effects.at(-1)?.type, 'classifyStills');
});

test('source scan: the admission check never counts faces, and no fixed face cap remains in app or package source', () => {
  const root = new URL('../../../../', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
  const admission = read('apps/web/src/controller/admission.ts');
  assert.doesNotMatch(admission, /Inputs\.length|\.length\s*[<>]=?\s*\d|faceCount|MAX_FACES/);
  // Every entry path that adds faces calls the one check.
  assert.match(
    read('apps/web/src/controller/reducers/inputs.ts'),
    /case 'AddAt': \{[\s\S]*?admitTo\(/,
  );
  const photoSource = read('apps/web/src/controller/reducers/photo.ts');
  for (const path of ["case 'PickPhoto'", "case 'Photos'", 'function classified('])
    assert.match(
      photoSource,
      new RegExp(`${path.replace(/[()]/g, '\\$&')}[\\s\\S]*?admitTo\\(`),
      path,
    );
  // No MaxControls-style constant anywhere in app or package source (comments may name classic's).
  const code = (text: string) =>
    text
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join('\n');
  const walk = (dir: string): string[] =>
    readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === 'node_modules' || e.name === 'dist' || e.name === 'evidence'
          ? []
          : walk(`${dir}/${e.name}`)
        : /\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.|\.test-d\./.test(e.name)
          ? [`${dir}/${e.name}`]
          : [],
    );
  const sources = ['apps/web/src', 'apps/web/shell', 'packages/stylegan-js/src'].flatMap(walk);
  assert.ok(sources.length > 100, `${sources.length} source files scanned`);
  for (const path of sources)
    assert.doesNotMatch(code(read(path)), /MaxControls|MAX_CONTROLS|exceeds 64 controls/, path);
  const files = [
    'apps/web/src/controller/reducers/inputs.ts',
    'apps/web/src/controller/reducers/photo.ts',
    'apps/web/src/project/project-json.ts',
    'apps/web/src/project/project-json.schema.ts',
    'apps/web/src/Next/geometry/latent-path.mjs',
    'apps/web/src/Next/analytics.mjs',
    'apps/web/shell/render/MorphSlot.tsx',
    'packages/stylegan-js/src/media/mp4-project.ts',
    'packages/stylegan-js/src/morph/latent-path.ts',
  ];
  for (const path of files) {
    const text = read(path);
    assert.doesNotMatch(text, /MaxControls|MAX_CONTROLS|exceeds 64 controls|2–64 control/, path);
    assert.doesNotMatch(text, /(Inputs|faces|controls)(\.length)?\s*>=?\s*64\b/, path);
    assert.doesNotMatch(text, /faces:\s*\[0,\s*64\]|controls:\s*64\b/, path);
  }
});
