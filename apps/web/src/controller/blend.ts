// The blend view's model (face.blend-view fm-2kse, fm-56e6): Blend and Morph share ONE list of faces (the session's
// Inputs); Blend adds a weight per face, keyed by face id. A face with no weight set has an equal share (1/N). Pure.
import type { Face, Input } from './state.ts';
import { faceInputProblem } from './derived.ts';

/** The id the blended result is registered and exported under (never a face of the shared list). */
export const BLEND_RESULT = 'blend-result';
/** The slider's step: 0.05 (the retired page's 0.1 values stay reproducible). */
export const WEIGHT_STEP = 0.05;
/** The sum line is shown outside this band. */
export const SUM_LOW = 0.8;
export const SUM_HIGH = 1.2;

/** Weights set in the blend view, by face id; a face without one has an equal share. */
export type BlendWeights = Readonly<Record<string, number>>;
/** A face of the shared list as the blend view shows it: the face and its effective weight. */
export interface BlendSlot {
  readonly input: Input;
  /** 0 to 1. */
  readonly weight: number;
}
export interface BlendState {
  readonly weights: BlendWeights;
  /** The blended result (BLEND_RESULT) once there is one. */
  readonly faces: readonly Face[];
  /** The newest requested blend; 0 before the first. */
  readonly revision: number;
  /** The revision whose synthesis is pending, or null when none is. */
  readonly running: number | null;
  /** One plain line: a refusal or a failure (with Retry), or ''. */
  readonly error: string;
  /** Whether the failure in `error` offers Retry. */
  readonly retry: boolean;
}

export const emptyBlend = (weights: BlendWeights = {}): BlendState => ({
  weights,
  faces: [],
  revision: 0,
  running: null,
  error: '',
  retry: false,
});

/** Clamped to 0-1; values outside are never exposed (the engine's [-2, 2] is for library callers). */
export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(1, Math.max(0, weight));
}
/** A slider or keyboard step: the nearest 0.05 within 0-1. */
export const stepWeight = (weight: number): number =>
  Math.round(clampWeight(weight) / WEIGHT_STEP) / Math.round(1 / WEIGHT_STEP);

export const weightSum = (slots: readonly BlendSlot[]): number =>
  slots.reduce((sum, slot) => sum + slot.weight, 0);

/** Two decimals, without trailing noise from floating point sums. */
export const formatWeight = (weight: number): string => (Math.round(weight * 100) / 100).toFixed(2);

/** The one line shown when the sum is outside 0.8-1.2, or null. */
export function sumLine(slots: readonly BlendSlot[]): string | null {
  if (!slots.length) return null;
  const sum = Math.round(weightSum(slots) * 1e6) / 1e6;
  return sum < SUM_LOW || sum > SUM_HIGH
    ? `Weights add up to ${formatWeight(sum)}. Faces usually look most natural at 1.`
    : null;
}

/** The shared faces with their effective weights, in the list's order. */
export function blendSlots(inputs: readonly Input[], weights: BlendWeights): readonly BlendSlot[] {
  const share = inputs.length ? 1 / inputs.length : 0;
  return inputs.map((input) => ({
    input,
    weight: Object.hasOwn(weights, input.id) ? clampWeight(weights[input.id]!) : share,
  }));
}

/** One face's weight set (0-1); every other weight is left as it is. */
export const setWeight = (weights: BlendWeights, id: string, weight: number): BlendWeights => ({
  ...weights,
  [id]: clampWeight(weight),
});

/** Reset: no weights set, so every face has an equal share (1/N, the retired API's default). */
export const resetWeights = (): BlendWeights => ({});

/** Make it 1: every effective weight scaled in proportion so the sum is 1. All-zero weights stay as they are. */
export function makeItOne(slots: readonly BlendSlot[], weights: BlendWeights): BlendWeights {
  const sum = weightSum(slots);
  if (!(sum > 0)) return weights;
  return Object.fromEntries(slots.map((slot) => [slot.input.id, clampWeight(slot.weight / sum)]));
}

/** Shuffle: random weights within 0-1 that add up to 1 (uniform on the simplex). `random` returns [0, 1). */
export function shuffleWeights(count: number, random: () => number): readonly number[] {
  if (count <= 0) return [];
  const draws = Array.from({ length: count }, () => -Math.log(1 - random()) + 1e-12);
  const total = draws.reduce((a, b) => a + b, 0);
  const weights = draws.map((draw) => draw / total);
  // The last weight takes the rounding remainder so the sum is 1 to floating precision.
  const rest = weights.slice(0, -1).reduce((a, b) => a + b, 0);
  weights[count - 1] = clampWeight(1 - rest);
  return weights;
}
/** Every face's weight at once, in the list's order (Shuffle weights). */
export const withWeights = (
  inputs: readonly Input[],
  current: BlendWeights,
  weights: readonly number[],
): BlendWeights =>
  weights.length !== inputs.length
    ? current
    : Object.fromEntries(inputs.map((input, index) => [input.id, clampWeight(weights[index]!)]));

/** The slots a blend uses: weight-0 slots are skipped. */
export const usedSlots = (slots: readonly BlendSlot[]): readonly BlendSlot[] =>
  slots.filter((slot) => slot.weight !== 0);

/** Why this blend cannot run, in one plain line, or null. There is no slot count limit. */
export function blendRefusal(slots: readonly BlendSlot[]): string | null {
  if (!slots.length) return 'Add a face to blend.';
  const used = usedSlots(slots);
  if (!used.length) return 'Give at least one face a weight other than 0.';
  for (const slot of used) {
    const index = slots.indexOf(slot) + 1;
    if (slot.input.mode === 'photo' && !slot.input.file)
      return `Face ${index}: choose its photo again.`;
    const problem = faceInputProblem(slot.input);
    if (problem) return `Face ${index}: ${problem}`;
  }
  return null;
}

// ---- session persistence (weights by face id; the faces themselves are the morph session's) ----------------------

export const BLEND_STORAGE_VERSION = 2;
export function storedWeights(blend: BlendState): {
  readonly v: number;
  readonly weights: BlendWeights;
} {
  return { v: BLEND_STORAGE_VERSION, weights: blend.weights };
}
/**
 * Reads what storedWeights wrote. A version-1 record (separate blend slots, before fm-56e6) is migrated: its slots
 * are dropped in favour of the shared list, and a slot's weight is kept where its id is a face id. Anything
 * malformed reads as no weights.
 */
export function restoreWeights(value: unknown): BlendWeights {
  const record = value as { v?: unknown; weights?: unknown; slots?: unknown } | null;
  const out: Record<string, number> = {};
  const keep = (id: unknown, weight: unknown) => {
    if (typeof id === 'string' && id && id !== BLEND_RESULT && typeof weight === 'number')
      out[id] = clampWeight(weight);
  };
  if (record?.v === BLEND_STORAGE_VERSION && record.weights && typeof record.weights === 'object')
    for (const [id, weight] of Object.entries(record.weights as Record<string, unknown>))
      keep(id, weight);
  else if (record?.v === 1 && Array.isArray(record.slots))
    for (const slot of record.slots as { id?: unknown; weight?: unknown }[])
      keep(slot?.id, slot?.weight);
  return out;
}
