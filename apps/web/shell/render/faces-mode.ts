// The many-face layout's decisions as plain functions (face.many, fm-id4c): which presentation a count and width
// get, and which tiles a virtualised strip renders. No DOM here; FacesLayout measures and applies them.

/** Past this many faces the strip renders only the tiles near the view (virtualised). */
export const VIRTUALISE_AFTER = 96;
/** Tiles kept rendered beyond each edge of the view, so Tab and swipes always find the next tile in the DOM. */
export const VIRTUAL_BUFFER = 3;
/** classic's two-face grid starts here (product-ux.scss `@media (min-width: 1000px)`). */
export const PAIR_GRID_MIN_WIDTH = 1000;

export type FacesMode = 'single' | 'pair-stack' | 'pair-grid' | 'strip';

export interface FacesLayoutChoice {
  readonly mode: FacesMode;
  readonly virtual: boolean;
}

/** One face: a lone tile; two: classic's pair (grid from 1,000 px, a stack below); three or more: the strip. */
export function facesMode(count: number, width: number): FacesLayoutChoice {
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError('A project has at least one face');
  if (count === 1) return { mode: 'single', virtual: false };
  if (count === 2)
    return { mode: width >= PAIR_GRID_MIN_WIDTH ? 'pair-grid' : 'pair-stack', virtual: false };
  return { mode: 'strip', virtual: count > VIRTUALISE_AFTER };
}

/**
 * The tiles a virtualised strip renders, as [start, end) indices: those that intersect the view plus
 * `buffer` either side, widened to keep `keep` (a focused or just-removed tile) and its neighbours.
 * `pitch` is one connector plus one tile, in px.
 */
export function visibleRange(
  count: number,
  pitch: number,
  scrollLeft: number,
  viewWidth: number,
  buffer = VIRTUAL_BUFFER,
  keep: number | null = null,
): readonly [number, number] {
  if (count <= 0) return [0, 0];
  const step = Math.max(1, pitch);
  let start = Math.floor(Math.max(0, scrollLeft) / step) - buffer;
  let end = Math.ceil((Math.max(0, scrollLeft) + Math.max(0, viewWidth)) / step) + buffer;
  // A kept tile far from the view is left to the browser (focus scrolls it into view, which moves the window).
  if (keep !== null && keep >= start - 20 && keep <= end + 20) {
    start = Math.min(start, keep - 1);
    end = Math.max(end, keep + 2);
  }
  start = Math.max(0, Math.min(start, count - 1));
  end = Math.min(count, Math.max(end, start + 1));
  return [start, end];
}
