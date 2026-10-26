// Recovery schema 3 (fm-fzzd, plan: media.schema.core): the dynamic-shape still envelope. Schema 2 records the
// latent's own shape but names the generator only by its model and noise digests, so a reader cannot tell a
// 16 x 512 AFHQ latent from a truncated FFHQ one without knowing every model. Schema 3 adds the generator's
// identity and shapes from its descriptor: name, architecture, subject, W+ layers x width and the output frame.
// It also adds `generationKind: 'blend'` with the weighted-blend recipe (each slot's kind, latent digest and
// weight; never a typed word, seed or file name). The container (PNG tEXt "FaceMorph" / WebP "FMRP"), the
// float32-le-base64 latent and the image/latent SHA-256 integrity hashes are schema 2's, unchanged.
//
// This module is pure: it builds and validates the JSON record. envelope.ts places it in the container and
// reads it back; schema 1 PNG and schema 2 PNG/WebP stay readable there. See docs/formats.md.

import {
  latentFitsDescriptor,
  type ModelDescriptor,
  type Result,
} from '../contracts/descriptor.ts';
import type { LatentTensor } from '../contracts/operations.ts';
import {
  RECOVERY_MAX_LATENT_VALUES,
  RECOVERY_PROVENANCE_KEYS,
  type GenerationKind,
  type RecoveryProvenance,
} from '../contracts/recovery-metadata.ts';

export const RECOVERY_SCHEMA_V3 = 3;
export const RECOVERY_V3_KIND = 'facemorph-image-v3';
/**
 * Schema 3 metadata bound: an 18 x 512 latent is ~49 KiB of base64 and the largest accepted latent
 * (RECOVERY_MAX_LATENT_VALUES) ~131 KiB, leaving room for a recipe of BLEND_RECIPE_MAX_SLOTS slots.
 */
export const RECOVERY_V3_MAX_METADATA_BYTES = 384 * 1024;
/** Most slots a saved recipe records (~110 bytes each). The blend view has no slot limit of its own. */
export const BLEND_RECIPE_MAX_SLOTS = 1024;

export type StillGenerationKind = GenerationKind | 'blend';
export type BlendSlotKind = 'word' | 'seed' | 'name' | 'photo';
export const BLEND_SLOT_KINDS: readonly BlendSlotKind[] = ['word', 'seed', 'name', 'photo'];

/** The generator a schema-3 latent belongs to, copied from its descriptor. */
export interface RecoveryModelRecord {
  readonly name: string;
  readonly architecture: 'stylegan2';
  readonly subject: 'face' | 'non-face';
  readonly modelSha256: string;
  readonly noiseSha256: string;
  readonly latent: { readonly space: 'w-plus'; readonly layers: number; readonly width: number };
  readonly output: { readonly width: number; readonly height: number };
}

export interface BlendRecipeSlot {
  readonly kind: BlendSlotKind;
  /** SHA-256 of the slot latent's little-endian float32 bytes (blend.ts latentDigest). */
  readonly latentSha256: string;
  /** The weight as used, after clamping to [-2, 2]. */
  readonly weight: number;
}

export interface BlendRecipe {
  readonly kind: 'blend-v1';
  readonly slots: readonly BlendRecipeSlot[];
}

/** What a schema-3 still export embeds; the integrity hashes are computed over the payload when written. */
export interface RecoveryMetadataV3 {
  readonly descriptor: ModelDescriptor;
  readonly generationKind: StillGenerationKind;
  readonly generationSha256: string;
  readonly provenance: RecoveryProvenance;
  readonly latent: LatentTensor;
  /** Only for `seed`; a blend never carries one. */
  readonly seed?: number;
  /** Required for `blend`, absent otherwise. */
  readonly blend?: BlendRecipe;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v: unknown, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;

/** The model record a descriptor implies. */
export function modelRecord(descriptor: ModelDescriptor): RecoveryModelRecord {
  const [, , height, width] = descriptor.output.shape;
  return {
    name: descriptor.identity.name,
    architecture: descriptor.architecture,
    subject: descriptor.subject,
    modelSha256: descriptor.identity.modelSha256,
    noiseSha256: descriptor.identity.noiseSha256,
    latent: { space: 'w-plus', layers: descriptor.latent.layers, width: descriptor.latent.width },
    output: { width, height },
  };
}

/** Validates a parsed model record; the error names the failing field. */
export function validateModelRecord(v: unknown): Result<RecoveryModelRecord, string> {
  const fail = (e: string): Result<RecoveryModelRecord, string> => ({ ok: false, error: e });
  if (!isRecord(v)) return fail('model');
  const { name, architecture, subject, modelSha256, noiseSha256, latent, output } = v;
  if (typeof name !== 'string' || name.length < 1 || name.length > 128) return fail('model.name');
  if (architecture !== 'stylegan2') return fail('model.architecture');
  if (subject !== 'face' && subject !== 'non-face') return fail('model.subject');
  if (typeof modelSha256 !== 'string' || !HEX64.test(modelSha256)) return fail('model.modelSha256');
  if (typeof noiseSha256 !== 'string' || !HEX64.test(noiseSha256)) return fail('model.noiseSha256');
  if (
    !isRecord(latent) ||
    latent.space !== 'w-plus' ||
    !posInt(latent.layers, 64) ||
    !posInt(latent.width, 4096) ||
    latent.layers * latent.width > RECOVERY_MAX_LATENT_VALUES
  )
    return fail('model.latent');
  if (!isRecord(output) || !posInt(output.width, 16384) || !posInt(output.height, 16384))
    return fail('model.output');
  return {
    ok: true,
    value: Object.freeze({
      name,
      architecture,
      subject,
      modelSha256,
      noiseSha256,
      latent: Object.freeze({ space: 'w-plus', layers: latent.layers, width: latent.width }),
      output: Object.freeze({ width: output.width, height: output.height }),
    }),
  };
}

/** Validates a parsed recipe: 1 to BLEND_RECIPE_MAX_SLOTS slots of a known kind, a digest and a finite weight. */
export function validateBlendRecipe(v: unknown): Result<BlendRecipe, string> {
  const fail = (e: string): Result<BlendRecipe, string> => ({ ok: false, error: e });
  if (!isRecord(v) || v.kind !== 'blend-v1' || !Array.isArray(v.slots)) return fail('blend');
  if (Object.keys(v).some((k) => k !== 'kind' && k !== 'slots')) return fail('blend fields');
  if (v.slots.length < 1 || v.slots.length > BLEND_RECIPE_MAX_SLOTS) return fail('blend.slots');
  const slots: BlendRecipeSlot[] = [];
  for (const [i, s] of (v.slots as unknown[]).entries()) {
    if (!isRecord(s) || Object.keys(s).length !== 3) return fail(`blend.slots[${i}]`);
    if (!BLEND_SLOT_KINDS.includes(s.kind as BlendSlotKind)) return fail(`blend.slots[${i}].kind`);
    if (typeof s.latentSha256 !== 'string' || !HEX64.test(s.latentSha256))
      return fail(`blend.slots[${i}].latentSha256`);
    if (typeof s.weight !== 'number' || !Number.isFinite(s.weight) || Math.abs(s.weight) > 2)
      return fail(`blend.slots[${i}].weight`);
    slots.push(
      Object.freeze({
        kind: s.kind as BlendSlotKind,
        latentSha256: s.latentSha256,
        weight: s.weight,
      }),
    );
  }
  return { ok: true, value: Object.freeze({ kind: 'blend-v1', slots: Object.freeze(slots) }) };
}

/** Writer-side checks of a schema-3 export; throws a plain Error naming the problem. */
export function checkRecoveryV3(
  meta: RecoveryMetadataV3,
  image: { width: number; height: number },
): void {
  const { descriptor, generationKind, generationSha256, provenance, latent, seed, blend } = meta;
  const model = modelRecord(descriptor);
  if (
    !['seed', 'photo', 'latent', 'blend'].includes(generationKind) ||
    !HEX64.test(generationSha256)
  )
    throw new Error('Invalid recovery generation identity.');
  if (provenance.modelSha256 !== model.modelSha256 || provenance.noiseSha256 !== model.noiseSha256)
    throw new Error('Recovery provenance must name the descriptor’s model and noise digests.');
  if (latent.space !== 'w-plus' || !latentFitsDescriptor(latent, descriptor))
    throw new Error(`Recovery latent must be ${model.latent.layers} x ${model.latent.width} W+.`);
  if (image.width !== model.output.width || image.height !== model.output.height)
    throw new Error(
      `A saved still is the full model frame (${model.output.width} x ${model.output.height}).`,
    );
  if (
    seed !== undefined &&
    (generationKind !== 'seed' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295)
  )
    throw new Error('Invalid recovery seed.');
  if ((generationKind === 'blend') !== (blend !== undefined))
    throw new Error('A blend carries its recipe, and only a blend does.');
  if (blend !== undefined) {
    const r = validateBlendRecipe(blend);
    if (!r.ok) throw new Error(`Invalid blend recipe (${r.error}).`);
  }
}

/** The schema-3 record (without the latent data and integrity hashes, which the envelope writer adds). */
export function recordV3Fields(meta: RecoveryMetadataV3): Record<string, unknown> {
  const { descriptor, generationKind, generationSha256, provenance, seed, blend } = meta;
  return {
    schema: RECOVERY_SCHEMA_V3,
    kind: RECOVERY_V3_KIND,
    generationKind,
    generationSha256,
    model: modelRecord(descriptor),
    provenance: Object.fromEntries(
      RECOVERY_PROVENANCE_KEYS.filter((k) => provenance[k] !== undefined).map((k) => [
        k,
        provenance[k],
      ]),
    ),
    ...(seed === undefined ? {} : { seed }),
    ...(blend === undefined
      ? {}
      : {
          blend: {
            kind: 'blend-v1',
            slots: blend.slots.map((s) => ({
              kind: s.kind,
              latentSha256: s.latentSha256,
              weight: s.weight,
            })),
          },
        }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Combining recovered inputs

/** One morph or blend input as recovered: the identity it claims and its latent. */
export interface RecoveredInput {
  readonly modelSha256: string;
  readonly noiseSha256: string;
  readonly latent: LatentTensor;
}

export type CombineErrorCode = 'too-few' | 'mixed-model' | 'shape-mismatch';
export interface CombineError {
  readonly code: CombineErrorCode;
  readonly index?: number;
  readonly message: string;
}

/**
 * Whether these inputs may be combined (morphed or blended) by `descriptor`'s generator. Every input must
 * name that generator's model and noise digests and have its W+ shape. An equal-shaped latent from another
 * checkpoint is refused as `mixed-model`, never silently combined.
 */
export function checkCombinable(
  descriptor: ModelDescriptor,
  inputs: readonly RecoveredInput[],
  minimum = 2,
): Result<true, CombineError> {
  if (inputs.length < minimum)
    return { ok: false, error: { code: 'too-few', message: `Add at least ${minimum} faces.` } };
  for (const [index, input] of inputs.entries()) {
    if (
      input.modelSha256 !== descriptor.identity.modelSha256 ||
      input.noiseSha256 !== descriptor.identity.noiseSha256
    )
      return {
        ok: false,
        error: {
          code: 'mixed-model',
          index,
          message:
            'This face was made with a different model, so it cannot be combined with these faces.',
        },
      };
    if (input.latent.space !== 'w-plus' || !latentFitsDescriptor(input.latent, descriptor))
      return {
        ok: false,
        error: {
          code: 'shape-mismatch',
          index,
          message: `Each face must be ${descriptor.latent.layers} x ${descriptor.latent.width} W+.`,
        },
      };
  }
  return { ok: true, value: true };
}
