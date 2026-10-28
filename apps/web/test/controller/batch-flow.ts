// Drives an open batch view (fm-id4c, fm-q5b9) the way its operated UI does: each file's display arrives
// (a photo's preview, a saved still's URL), then a pick per offered face in file order, then OK.
import assert from 'node:assert/strict';
import { msg } from '../../src/controller/msg.ts';
import { reduce, type ControllerFacts } from '../../src/controller/reducers/index.ts';
import type { State } from '../../src/controller/state.ts';
import type { CropOffer } from '../../shell/facade/records.ts';

export const offerFor = (file: Blob, name = 'preview'): CropOffer => ({
  file,
  blob: new Blob([], { type: 'image/png' }),
  url: `blob:${name}`,
  sourceWidth: 800,
  sourceHeight: 600,
  previewWidth: 800,
  previewHeight: 600,
  scale: 1,
  resized: false,
});

/** Every loading file staged (decodes); returns the state with all candidates offered. */
export function stageAll(state: State): State {
  const batch = state.Batch;
  assert.ok(batch, 'the batch view is open');
  let next = state;
  for (const group of batch.groups)
    if (group.status === 'loading')
      next = reduce(
        msg(
          'BatchStaged',
          batch.token,
          group.id,
          group.role === 'recovered'
            ? { ok: true, url: `blob:still-${group.id}` }
            : { ok: true, offer: offerFor(group.entry.file, group.id) },
        ),
        next,
      )!.state;
  return next;
}

/** Stages, picks every offered face in file order and presses OK. */
export function confirmAll(state: State, facts: ControllerFacts = {}) {
  let next = stageAll(state);
  for (const group of next.Batch!.groups)
    for (const candidate of group.candidates)
      next = reduce(msg('BatchPick', candidate), next)!.state;
  const count = next.Batch!.order.length;
  return reduce(msg('BatchOk'), next, {
    newPhotoIds: Array.from({ length: count }, (_, i) => `new-${i}`),
    ...facts,
  })!;
}
