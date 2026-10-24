// Whole-action progress: one bar per action that only moves forward within an attempt, never resets at a
// stage, counts overlapping work once, and is indeterminate when costs are unknown.

export type ProgressAction = 'face' | 'photo' | 'morph' | 'name-selection';

/** Where each action's bar reaches 100%. Persistence and diagnostics lie outside every boundary. */
export type CompletionBoundary =
  | { readonly action: 'face'; readonly done: 'recovery-bearing-file-ready' }
  | { readonly action: 'photo'; readonly done: 'recovery-bearing-file-ready' }
  | { readonly action: 'morph'; readonly done: 'playable-mp4-with-project-metadata' }
  | { readonly action: 'name-selection'; readonly done: 'validated-static-result-and-prepared-file' };

export const COMPLETION_BOUNDARIES: { readonly [A in ProgressAction]: Extract<CompletionBoundary, { action: A }>['done'] } = Object.freeze({
  face: 'recovery-bearing-file-ready',
  photo: 'recovery-bearing-file-ready',
  morph: 'playable-mp4-with-project-metadata',
  'name-selection': 'validated-static-result-and-prepared-file',
});

export type WholeActionProgress =
  | { readonly kind: 'indeterminate'; readonly attemptId: string; readonly action: ProgressAction }
  | { readonly kind: 'determinate'; readonly attemptId: string; readonly action: ProgressAction; readonly fraction: number };

/** Per confirmed crop in a photo batch. */
export interface PerCropProgress {
  readonly confirmedCropId: string;
  readonly progress: WholeActionProgress;
}

/** The verified face is kept when only its file failed: compute-ready and file-complete are separate facts. */
export type ComputeReadyVsFileComplete =
  | { readonly computeReady: true; readonly file: 'pending' | 'complete' | 'failed' }
  | { readonly computeReady: false; readonly file: 'not-started' };

/**
 * The next bar value: within one attempt it never decreases; a new attempt starts again. `done` and `total`
 * are costs of the whole action with overlapping work counted once; an unknown total is indeterminate.
 */
export function advance(previous: WholeActionProgress | undefined, attemptId: string, action: ProgressAction, done: number, total: number | null): WholeActionProgress {
  if (total === null || !(total > 0) || !Number.isFinite(done)) return { kind: 'indeterminate', attemptId, action };
  const fraction = Math.min(1, Math.max(0, done / total));
  const floor = previous && previous.attemptId === attemptId && previous.kind === 'determinate' ? previous.fraction : 0;
  return { kind: 'determinate', attemptId, action, fraction: Math.max(floor, fraction) };
}

/** Total cost of stages that may overlap: an interval covered twice counts once. */
export function overlapCost(stages: readonly { readonly start: number; readonly end: number }[]): number {
  const sorted = [...stages].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let reach = -Infinity;
  for (const s of sorted) {
    if (s.start >= reach) total += s.end - s.start;
    else if (s.end > reach) total += s.end - reach;
    reach = Math.max(reach, s.end);
  }
  return total;
}
