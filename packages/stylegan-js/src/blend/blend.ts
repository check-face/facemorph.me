// Weighted face blend (fm-mtax, plan: compute.blend): the retired API's `num_multi` arithmetic on W+ latents,
// sum(weight_k * W+_k) with each weight clamped to [-2, 2] and not normalised, ready for one synthesis. It matches
// classic LatentByMultiLerp (checkface/src/server/checkface.py) on dlatent inputs; the API's Z-space sums for word
// and seed slots are deliberately not matched, since the app holds every face as W+. Pure arithmetic, shaped by
// the model descriptor (no hard-coded 18 x 512), with any number of slots from 1. Retained-input memory is the
// caller's admission check against the byte budgets, not a slot count here.
import { canonicalJson } from '../contracts/canonical-json.ts';
import {
  latentFitsDescriptor,
  type ModelDescriptor,
  type Result,
} from '../contracts/descriptor.ts';
import type { LatentTensor } from '../contracts/operations.ts';
import { sha256Hex, utf8Bytes } from '../contracts/sha256.ts';

export const BLEND_WEIGHT_MIN = -2;
export const BLEND_WEIGHT_MAX = 2;

export type BlendErrorCode =
  | 'no-slots'
  | 'weight-count'
  | 'weight-not-finite'
  | 'not-w-plus'
  | 'shape-mismatch';

export interface BlendError {
  readonly code: BlendErrorCode;
  /** The offending slot, when one is. */
  readonly slot?: number;
  readonly message: string;
}

export interface BlendResult {
  readonly latent: LatentTensor;
  /** The weights as used, after clamping. */
  readonly weights: readonly number[];
  /** Their sum, which the view shows (the blend is not normalised by it). */
  readonly weightSum: number;
  /** SHA-256 over the model, each slot's latent digest and its clamped weight, in slot order. */
  readonly cacheKey: string;
}

/** A weight clamped to [-2, 2], as the API's `max(-2.0, min(2.0, amount))`. */
export const clampWeight = (w: number): number =>
  Math.max(BLEND_WEIGHT_MIN, Math.min(BLEND_WEIGHT_MAX, w));

/** SHA-256 of a latent's little-endian float32 bytes. */
export function latentDigest(latent: LatentTensor): string {
  const v = latent.values;
  const bytes = new Uint8Array(v.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i]!, true);
  return sha256Hex(bytes);
}

const fail = (
  code: BlendErrorCode,
  message: string,
  slot?: number,
): Result<BlendResult, BlendError> => ({
  ok: false,
  error: slot === undefined ? { code, message } : { code, slot, message },
});

/**
 * Blends W+ latents of one model: sum(clamp(w_k) * latent_k). Refuses no slots, a weight count that differs from
 * the slot count, a non-finite weight, a non-W+ latent and a latent whose shape is not the descriptor's.
 */
export function blend(
  descriptor: ModelDescriptor,
  latents: readonly LatentTensor[],
  weights: readonly number[],
): Result<BlendResult, BlendError> {
  if (latents.length === 0) return fail('no-slots', 'A blend needs at least one face.');
  if (weights.length !== latents.length) return fail('weight-count', 'Give one weight per face.');
  const clamped: number[] = [];
  for (const [k, w] of weights.entries()) {
    if (!Number.isFinite(w)) return fail('weight-not-finite', 'Each weight must be a number.', k);
    clamped.push(clampWeight(w));
  }
  for (const [k, l] of latents.entries()) {
    if ((l as { space?: unknown }).space !== 'w-plus' || !(l.values instanceof Float32Array))
      return fail('not-w-plus', 'Each face must be a W+ latent; map Z first.', k);
    if (!latentFitsDescriptor(l, descriptor))
      return fail(
        'shape-mismatch',
        `Each face must be ${descriptor.latent.layers} x ${descriptor.latent.width} W+.`,
        k,
      );
  }
  const n = descriptor.latent.layers * descriptor.latent.width;
  // Accumulate in float64, then store float32, as one weighted sum over the slots.
  const sum = new Float64Array(n);
  for (const [k, l] of latents.entries()) {
    const w = clamped[k]!;
    const v = l.values;
    for (let i = 0; i < n; i++) sum[i] = sum[i]! + w * v[i]!;
  }
  const values = Float32Array.from(sum);
  const cacheKey = sha256Hex(
    utf8Bytes(
      canonicalJson({
        kind: 'blend-v1',
        model: descriptor.identity.modelSha256,
        slots: latents.map((l, k) => ({ latent: latentDigest(l), weight: clamped[k] })),
      }),
    ),
  );
  return {
    ok: true,
    value: {
      latent: {
        space: 'w-plus',
        shape: [descriptor.latent.layers, descriptor.latent.width],
        values,
      },
      weights: clamped,
      weightSum: clamped.reduce((a, b) => a + b, 0),
      cacheKey,
    },
  };
}
