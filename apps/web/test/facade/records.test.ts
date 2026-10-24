// The facade's record readers (fm-pia9): a bridge payload becomes its typed record or a FacadeError naming the field.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FacadeError,
  readOutput,
  readPhotoSelection,
  readProgress,
} from '../../shell/facade/records.ts';

const output = {
  errorMessage: '',
  faces: [
    { id: 'a', url: 'blob:x', raw: false, label: 'Face', sourceMode: 'text', sourceFile: null },
  ],
  videoUrl: '',
  projectJson: '',
  message: 'Face updated.',
  restored: false,
  inputs: [],
  kind: '',
  width: 0,
  pinch: false,
  frames: 16,
  fps: 16,
};

test('a snapshot-shaped Output reads as the typed record', () => {
  const o = readOutput(output);
  assert.equal(o.faces[0]?.id, 'a');
  assert.equal(o.kind, '');
  assert.equal(o.refusal, null);
  assert.equal(o.cropFace, null);
});

test('a wrong field fails with its record and path', () => {
  assert.throws(
    () => readOutput({ ...output, faces: [{ ...output.faces[0], raw: 'no' }] }),
    (e: unknown) => e instanceof FacadeError && e.record === 'Face' && e.path === 'faces[0].raw',
  );
  assert.throws(() => readOutput({ ...output, kind: 'spiral' }), FacadeError);
  assert.throws(() => readProgress({ jobId: 1.5, stage: 's', text: '', fraction: 0 }), FacadeError);
});

test('photo selection results are told apart by kind', () => {
  assert.deepEqual(readPhotoSelection(null), { kind: 'superseded' });
  const file = new File([new Uint8Array(8)], 'p.png');
  assert.equal(readPhotoSelection(file).kind, 'photo');
  assert.equal(readPhotoSelection({ projectFile: new Blob(['{}']) }).kind, 'project');
  assert.equal(readPhotoSelection({ recovered: true, ...output }).kind, 'recovered');
  assert.equal(
    readPhotoSelection({
      crop: true,
      file,
      blob: file,
      url: 'blob:y',
      sourceWidth: 1,
      sourceHeight: 1,
      previewWidth: 1,
      previewHeight: 1,
      scale: 1,
    }).kind,
    'crop',
  );
  assert.throws(() => readPhotoSelection({ something: 1 }), FacadeError);
});

// Type-level: each union admits exactly its members (checked by tsc -p tsconfig.node.json).
import type {
  Action,
  InputMode,
  MorphKind,
  PhotoSelection,
  RequestedProvider,
} from '../../shell/facade/records.ts';
export const typeChecks = (selection: PhotoSelection): string => {
  const kinds: [InputMode, MorphKind, Action, RequestedProvider] = [
    'photo',
    'linear',
    'morph',
    'webgpu',
  ];
  // @ts-expect-error 'webgl' is not a requested provider any more
  const removed: RequestedProvider = 'webgl';
  // @ts-expect-error a morph kind outside the five is not a MorphKind
  const spiral: MorphKind = 'spiral';
  switch (selection.kind) {
    case 'superseded':
      return kinds.join() + removed + spiral;
    case 'project':
      return String(selection.projectFile.size);
    case 'recovered':
      return selection.output.message;
    case 'photo':
      return String(selection.file.size);
    case 'crop':
      return selection.offer.url;
    default: {
      const never: never = selection;
      return never;
    }
  }
};
