// The estimate's wording (classic Product.fs view, lines 1267-1281). It never says "on this device" about a number
// this device has not produced: a prior from similar devices and a measurement from this one always read differently.

export interface EstimateProps {
  /** Expected ms per face. */
  readonly perFace: number;
  /** Frames in the planned morph (0 when there is none to estimate). */
  readonly frames: number;
  /** True when perFace was measured on this device, false for a prior from similar devices. */
  readonly measuredHere: boolean;
  /** Per-frame wording from the estimator (bridge perFrameText), '' when there is none. */
  readonly perFrame: string;
  /** describeMs / describeMeasuredMs from the candidate's estimate.mjs. */
  readonly describeMs: (ms: number) => string;
  readonly describeMeasuredMs: (ms: number) => string;
}

export function estimateText({ perFace, frames, measuredHere, perFrame, describeMs, describeMeasuredMs }: EstimateProps): string {
  if (measuredHere) {
    return frames > 0
      ? `On this device a face took ${describeMeasuredMs(perFace)}${perFrame === '' ? '' : ` (${perFrame})`}, so a ${frames}-frame morph should take ${describeMs(perFace * frames)}.`
      : `On this device a face took ${describeMeasuredMs(perFace)}.`;
  }
  return frames > 0
    ? `On similar devices a face takes ${describeMs(perFace)}, so a ${frames}-frame morph would take ${describeMs(perFace * frames)}. This device's own timing replaces this estimate after the first face.`
    : `On similar devices a face takes ${describeMs(perFace)}. This device's own timing replaces this estimate after the first face.`;
}
