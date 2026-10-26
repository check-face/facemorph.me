// The weighted-blend recipe saved with a blend (fm-fzzd, PLAN.md "Weighted face blend (advanced mode)"): per
// slot, its kind (word, seed, name or photo), the SHA-256 of its W+ latent and its weight as used. Typed words,
// seeds and file names are never part of it: a slot is identified only by its latent digest, so the blend view
// can restore the weight of a slot whose latent matches. The recipe digest is blend()'s cacheKey, so a saved
// blend's generation identity and the engine's cache key are one value.
import { canonicalJson } from '../contracts/canonical-json.ts';
import type { ModelDescriptor, Result } from '../contracts/descriptor.ts';
import type { LatentTensor } from '../contracts/operations.ts';
import { sha256Hex, utf8Bytes } from '../contracts/sha256.ts';
import {
  BLEND_RECIPE_MAX_SLOTS,
  BLEND_SLOT_KINDS,
  type BlendRecipe,
  type BlendSlotKind,
} from '../media/recovery-v3.ts';
import { blend, latentDigest, type BlendError, type BlendResult } from './blend.ts';

/** SHA-256 over the model and each slot's latent digest and weight, in slot order (blend()'s cacheKey). */
export function blendRecipeDigest(modelSha256: string, recipe: BlendRecipe): string {
  return sha256Hex(
    utf8Bytes(
      canonicalJson({
        kind: 'blend-v1',
        model: modelSha256,
        slots: recipe.slots.map((s) => ({ latent: s.latentSha256, weight: s.weight })),
      }),
    ),
  );
}

export interface BlendSlotInput {
  readonly kind: BlendSlotKind;
  readonly latent: LatentTensor;
}

export interface BlendWithRecipe {
  readonly result: BlendResult;
  readonly recipe: BlendRecipe;
  /** The saved still's generationSha256: the recipe digest (equal to result.cacheKey). */
  readonly generationSha256: string;
}

/** blend() plus the recipe a saved blend carries. Refuses an unknown slot kind and an oversized recipe. */
export function blendWithRecipe(
  descriptor: ModelDescriptor,
  slots: readonly BlendSlotInput[],
  weights: readonly number[],
): Result<BlendWithRecipe, BlendError> {
  for (const [slot, s] of slots.entries())
    if (!BLEND_SLOT_KINDS.includes(s.kind))
      return { ok: false, error: { code: 'not-w-plus', slot, message: 'Unknown slot kind.' } };
  if (slots.length > BLEND_RECIPE_MAX_SLOTS)
    return {
      ok: false,
      error: {
        code: 'weight-count',
        message: `A saved blend records at most ${BLEND_RECIPE_MAX_SLOTS} faces.`,
      },
    };
  const r = blend(
    descriptor,
    slots.map((s) => s.latent),
    weights,
  );
  if (!r.ok) return r;
  const recipe: BlendRecipe = Object.freeze({
    kind: 'blend-v1',
    slots: Object.freeze(
      slots.map((s, k) =>
        Object.freeze({
          kind: s.kind,
          latentSha256: latentDigest(s.latent),
          weight: r.value.weights[k]!,
        }),
      ),
    ),
  });
  return {
    ok: true,
    value: {
      result: r.value,
      recipe,
      generationSha256: blendRecipeDigest(descriptor.identity.modelSha256, recipe),
    },
  };
}

/**
 * What a blend contributes to its export identity (apps/web contracts exportIdentity): ordered inputs naming
 * each slot's kind, latent digest and weight, so blends differing in any weight get different identities,
 * and the filename label `blend-<n>-faces`.
 */
export function blendExportInputs(recipe: BlendRecipe): {
  readonly orderedInputs: readonly string[];
  readonly label: string;
} {
  return {
    orderedInputs: recipe.slots.map(
      (s) => `blend:${s.kind}:${s.latentSha256}:${JSON.stringify(s.weight)}`,
    ),
    label: `blend-${recipe.slots.length}-faces`,
  };
}

/** The recipe slots whose latent digest matches `latent`, for restoring weights in the blend view. */
export function recipeSlotsFor(recipe: BlendRecipe, latent: LatentTensor): readonly number[] {
  const digest = latentDigest(latent);
  return recipe.slots.flatMap((s, i) => (s.latentSha256 === digest ? [i] : []));
}
