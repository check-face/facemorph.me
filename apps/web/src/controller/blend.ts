// The blend view's model (face.blend-view, fm-2kse): an ordered list of slots, each a copy of a face input with a
// weight, in the same session as the morph faces. Pure: ids and random numbers come from the caller.
import type { Face, Input } from './state.ts';
import { faceInputProblem } from './derived.ts';

/** Every blend slot id starts with this, so slot work never touches the morph's faces or video. */
export const BLEND_PREFIX = 'blend-';
/** The id the blended result is registered and exported under. */
export const BLEND_RESULT = 'blend-result';
/** The slider's step: 0.05 (the retired page's 0.1 values stay reproducible). */
export const WEIGHT_STEP = 0.05;
/** The sum line is shown outside this band. */
export const SUM_LOW = 0.8;
export const SUM_HIGH = 1.2;

export const isBlendId = (id: string): boolean => id.startsWith(BLEND_PREFIX);

export interface BlendSlot {
  /** The slot's own input; its id is the slot id (BLEND_PREFIX…), never a morph face id. */
  readonly input: Input;
  /** 0 to 1. */
  readonly weight: number;
}
export interface BlendState {
  readonly slots: readonly BlendSlot[];
  /** Finished slot faces and the blended result (BLEND_RESULT), by id. */
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

export const emptyBlend = (): BlendState => ({
  slots: [],
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

/** A morph face that has or can get a latent: valid words or seed, a chosen photo, or a finished face. */
export function latentCapable(input: Input, faces: readonly Face[]): boolean {
  if (faces.some((face) => face.id === input.id)) return true;
  if (input.mode === 'photo') return !!input.file;
  if (input.mode === 'text' || input.mode === 'seed') return !faceInputProblem(input);
  return false;
}

/**
 * First open: copies of every latent-capable morph face, at equal weights. `ids` supplies one fresh slot id per
 * morph input (in order). Returns the slots and which morph face each copied finished face came from.
 */
export function seedSlots(
  inputs: readonly Input[],
  faces: readonly Face[],
  ids: readonly string[],
): {
  readonly slots: readonly BlendSlot[];
  readonly copies: readonly (readonly [string, string])[];
} {
  const chosen = inputs.flatMap((input, index) =>
    latentCapable(input, faces) && ids[index] ? [[input, ids[index]] as const] : [],
  );
  const weight = chosen.length ? 1 / chosen.length : 0;
  const copies: (readonly [string, string])[] = [];
  const slots = chosen.map(([input, id]) => {
    if (faces.some((face) => face.id === input.id)) copies.push([input.id, id]);
    return { input: { ...input, id }, weight };
  });
  return { slots, copies };
}

/** A new slot gets weight 1/N (N counting it); the other weights are left alone. */
export function addSlot(slots: readonly BlendSlot[], id: string): readonly BlendSlot[] {
  return [
    ...slots,
    { input: { id, mode: 'text', value: '', file: null }, weight: 1 / (slots.length + 1) },
  ];
}
export const removeSlot = (slots: readonly BlendSlot[], id: string): readonly BlendSlot[] =>
  slots.filter((slot) => slot.input.id !== id);

export const setWeight = (
  slots: readonly BlendSlot[],
  id: string,
  weight: number,
): readonly BlendSlot[] =>
  slots.map((slot) => (slot.input.id === id ? { ...slot, weight: clampWeight(weight) } : slot));

/** Reset: every weight 1/N (the retired API's default). */
export const resetWeights = (slots: readonly BlendSlot[]): readonly BlendSlot[] =>
  slots.map((slot) => ({ ...slot, weight: 1 / slots.length }));

/** Make it 1: every weight scaled in proportion so the sum is 1. All-zero weights are left as they are. */
export function makeItOne(slots: readonly BlendSlot[]): readonly BlendSlot[] {
  const sum = weightSum(slots);
  if (!(sum > 0)) return slots;
  return slots.map((slot) => ({ ...slot, weight: clampWeight(slot.weight / sum) }));
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
export const withWeights = (
  slots: readonly BlendSlot[],
  weights: readonly number[],
): readonly BlendSlot[] =>
  weights.length !== slots.length
    ? slots
    : slots.map((slot, index) => ({ ...slot, weight: clampWeight(weights[index]!) }));

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

// ---- session persistence (the slot list and weights; photo pixels stay tab-only) ----------------------------------

export interface StoredSlot {
  readonly id: string;
  readonly mode: 'text' | 'seed' | 'photo' | 'project';
  readonly value: string;
  readonly weight: number;
}
export const BLEND_STORAGE_VERSION = 1;
export function storedSlots(blend: BlendState): {
  readonly v: number;
  readonly slots: readonly StoredSlot[];
} {
  return {
    v: BLEND_STORAGE_VERSION,
    slots: blend.slots.map(({ input, weight }) => ({
      id: input.id,
      mode: input.mode,
      // A photo keeps only its file name; its pixels never leave this tab's memory.
      value:
        input.mode === 'photo' ? (input.file instanceof File ? input.file.name : '') : input.value,
      weight,
    })) as StoredSlot[],
  };
}
/** Reads what storedSlots wrote; anything malformed reads as no slots. */
export function restoreSlots(value: unknown): readonly BlendSlot[] {
  const record = value as { v?: unknown; slots?: unknown } | null;
  if (!record || record.v !== BLEND_STORAGE_VERSION || !Array.isArray(record.slots)) return [];
  const slots: BlendSlot[] = [];
  for (const item of record.slots as unknown[]) {
    const slot = item as Partial<StoredSlot> | null;
    if (
      !slot ||
      typeof slot.id !== 'string' ||
      !isBlendId(slot.id) ||
      slot.id === BLEND_RESULT ||
      typeof slot.value !== 'string' ||
      typeof slot.weight !== 'number' ||
      !['text', 'seed', 'photo', 'project'].includes(String(slot.mode))
    )
      return [];
    // A restored photo slot keeps its place, weight and file name; its photo is chosen again in this tab.
    slots.push({
      input: {
        id: slot.id,
        mode: slot.mode === 'photo' || slot.mode === 'project' ? 'photo' : slot.mode!,
        value: slot.mode === 'photo' || slot.mode === 'project' ? '' : slot.value,
        file: null,
      },
      weight: clampWeight(slot.weight),
    });
  }
  return slots;
}
