// Morph length and video size choices (fm-36ag): a Custom frames-per-face count bounded only by the morph frame
// budget, and the video size (Standard 512 × 512 by default, Full quality up to the model's own size).
import { MORPH_FRAME_BUDGET } from '../contracts/ceilings.ts';
import { describeMs as describeMsJs } from '../Next/estimate.mjs';

export const QUALITIES = ['standard', 'full'] as const;
export type VideoQuality = (typeof QUALITIES)[number];
/** The default video size (operator, 26 October): quicker, smaller files that play everywhere. */
export const STANDARD_VIDEO_SIZE = 512;
/** The square video size a quality aims for: never above the model's frame, no upscaling. */
export const targetVideoSize = (quality: VideoQuality, modelSize: number): number =>
  quality === 'full' ? modelSize : Math.min(STANDARD_VIDEO_SIZE, modelSize);

/** The most frames per face a closed loop of `faces` can have within the morph frame budget. */
export const maxFramesPerFace = (faces: number): number =>
  Math.floor(MORPH_FRAME_BUDGET.maxFrames / Math.max(2, faces));

const count = (n: number) => n.toLocaleString('en-US');
/** Why a typed Custom frame count cannot be used, or '' when it can: never clamped silently. */
export function customFramesProblem(text: string, faces: number): string {
  const max = maxFramesPerFace(faces);
  const limit = `Enter a whole number from 2 to ${count(max)}`;
  const value = text.trim();
  if (!/^\d+$/.test(value)) return `${limit} frames per face.`;
  const frames = Number(value);
  if (frames < 2) return `${limit}: a morph needs at least 2 frames per face.`;
  if (frames > max)
    return `${limit}: ${Math.max(2, faces)} faces × ${count(frames)} frames is over the ${count(MORPH_FRAME_BUDGET.maxFrames)}-frame limit for one morph.`;
  return '';
}

/** Long morphs on a measured device also say how long they should take. */
const ESTIMATE_FROM_FRAMES = 64;
/** Total frames, video length and, for long morphs on a measured device, the expected generation time. */
export function morphLengthSummary(
  total: number,
  fps: number,
  frameMs: number | null | undefined,
): string {
  const seconds = total / fps;
  const length = `${count(total)} frames total · ${seconds < 10 ? seconds.toFixed(1) : count(Math.round(seconds))} s video`;
  return frameMs && total > ESTIMATE_FROM_FRAMES
    ? `${length} · ${String(describeMsJs(frameMs * total))} to make on this device`
    : length;
}
