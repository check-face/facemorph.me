// Breadth-first morph frame order (fm-suaa), ported from the app's infill.mjs: every segment endpoint first,
// then the midpoints of ever smaller intervals, so a preview fills in evenly while frames render.

import type { LatentPath, MorphPathSpec } from './latent-path.ts';

export interface InfillFrame {
  readonly index: number;
  readonly segment: number;
  readonly u: number;
  readonly visitId: string | null;
  readonly values: Float64Array;
}

/** Canonical frame indices, endpoints first then breadth-first midpoints. */
export function* infillIndices(
  total: number,
  perSegment: number,
): Generator<number, void, undefined> {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(perSegment) || perSegment < 2)
    throw new RangeError('Invalid morph frame counts');
  const seen = new Set<number>();
  for (let i = 0; i < total; i += perSegment) {
    seen.add(i);
    yield i;
  }
  let intervals: [number, number][] = [];
  for (let left = 0; left < total; left += perSegment)
    intervals.push([left, Math.min(total, left + perSegment)]);
  while (intervals.length) {
    const next: [number, number][] = [];
    for (const [left, right] of intervals) {
      if (right - left < 2) continue;
      const mid = Math.floor((left + right) / 2);
      if (!seen.has(mid)) {
        seen.add(mid);
        yield mid;
      }
      next.push([left, mid], [mid, right]);
    }
    intervals = next;
  }
}

/**
 * The path's frames in infill order. An open path's final frame (index segments * framesPerSegment) is the last
 * segment at u = 1, as in `frames()`; the app module asked for segment `segments` there and threw.
 */
export function* infillFrames(
  path: Pick<LatentPath, 'totalFrames' | 'segments' | 'sample'>,
  morph: Pick<MorphPathSpec, 'framesPerSegment' | 'controls'>,
): Generator<InfillFrame, void, undefined> {
  const perSegment = morph.framesPerSegment;
  for (const index of infillIndices(path.totalFrames, perSegment)) {
    const end = index === path.segments * perSegment;
    const segment = end ? path.segments - 1 : Math.floor(index / perSegment),
      u = end ? 1 : (index % perSegment) / perSegment;
    const visitId =
      u === 0 ? morph.controls[segment]!.visitId : end ? morph.controls.at(-1)!.visitId : null;
    yield { index, segment, u, visitId, values: path.sample(segment, u) };
  }
}
