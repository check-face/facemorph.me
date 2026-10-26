// face.many's sweep lists (fm-id4c): the harness's own SWEEP_WIDTHS and GRID_COUNTS (fm-48bj), re-exported, never
// copied, plus the cell list face-many.e2e.ts runs: every sweep width and every built breakpoint at -1, 0 and +1 px.
import { aroundBreakpoints, GRID_COUNTS, SWEEP_WIDTHS } from './harness.ts';

export const FACE_MANY_WIDTHS = SWEEP_WIDTHS;
export const FACE_MANY_COUNTS = GRID_COUNTS;
/** Widths at or below this run with touch emulation (the phone/tablet breakpoint the harness tests use). */
export const FACE_MANY_TOUCH_BREAKPOINT = 599;

/** The matrix widths: sweep widths plus each built breakpoint +/-1 px, from 280 px, sorted. */
export function faceManyWidths(builtBreakpoints: readonly number[]): number[] {
  return [...new Set([...FACE_MANY_WIDTHS, ...aroundBreakpoints(builtBreakpoints)])]
    .filter((w) => w >= 280)
    .sort((a, b) => a - b);
}
