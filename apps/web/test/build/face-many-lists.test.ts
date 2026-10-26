// face.many (fm-id4c) uses the integrated-verification harness's lists (fm-48bj): the same arrays, imported, not
// a second copy; and the layout decisions it sweeps (mode by count and width, the virtualised window).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRID_COUNTS, SWEEP_WIDTHS } from '../verify/harness.ts';
import { FACE_MANY_COUNTS, FACE_MANY_WIDTHS, faceManyWidths } from '../verify/face-many.ts';
import {
  facesMode,
  PAIR_GRID_MIN_WIDTH,
  VIRTUALISE_AFTER,
  visibleRange,
} from '../../shell/render/faces-mode.ts';

test("face.many's widths and counts are the harness's own lists", () => {
  assert.equal(FACE_MANY_WIDTHS, SWEEP_WIDTHS);
  assert.equal(FACE_MANY_COUNTS, GRID_COUNTS);
  assert.deepEqual([...FACE_MANY_COUNTS], [1, 2, 3, 4, 8, 30, 64, 150]);
  // No second list in face.many's sources: they import, never spell the numbers out.
  for (const file of ['../verify/face-many.ts', '../e2e/face-many.e2e.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /320,\s*360,\s*390/, `${file} copies SWEEP_WIDTHS`);
    assert.doesNotMatch(source, /1,\s*2,\s*3,\s*4,\s*8,\s*30/, `${file} copies GRID_COUNTS`);
  }
  const widths = faceManyWidths([600, 1000]);
  for (const w of [...SWEEP_WIDTHS, 599, 601, 999, 1001]) assert.ok(widths.includes(w), `${w}`);
});

test('layout mode by count and width: one tile, the pair (grid from 1,000 px), then the strip', () => {
  assert.deepEqual(facesMode(1, 390), { mode: 'single', virtual: false });
  assert.deepEqual(facesMode(2, PAIR_GRID_MIN_WIDTH - 1), { mode: 'pair-stack', virtual: false });
  assert.deepEqual(facesMode(2, PAIR_GRID_MIN_WIDTH), { mode: 'pair-grid', virtual: false });
  for (const width of SWEEP_WIDTHS)
    for (const count of GRID_COUNTS.filter((c) => c >= 3))
      assert.deepEqual(facesMode(count, width), {
        mode: 'strip',
        virtual: count > VIRTUALISE_AFTER,
      });
  assert.equal(facesMode(64, 390).virtual, false);
  assert.equal(facesMode(150, 390).virtual, true);
  assert.throws(() => facesMode(0, 390), RangeError);
});

test('the virtualised window covers the view plus a buffer, and keeps a focused tile', () => {
  // 150 tiles of 400 px, a 1,000 px view at 20,000 px: tiles 50-52 show; 3 either side are kept.
  assert.deepEqual(visibleRange(150, 400, 20_000, 1000, 3), [47, 56]);
  assert.deepEqual(visibleRange(150, 400, 0, 1000, 3), [0, 6]);
  assert.deepEqual(visibleRange(150, 400, 59_000, 1000, 3), [144, 150]);
  // A focused tile just past the window widens it to keep the tile and its neighbours.
  assert.deepEqual(visibleRange(150, 400, 20_000, 1000, 3, 60), [47, 62]);
  // One far away is left to the browser (focus scrolls it into view): the window stays bounded.
  assert.deepEqual(visibleRange(150, 400, 20_000, 1000, 3, 140), [47, 56]);
  assert.deepEqual(visibleRange(0, 400, 0, 1000), [0, 0]);
});
