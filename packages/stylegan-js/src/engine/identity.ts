// Latent identity and output conversion (fm-3h3w), ported from the candidate's browser/identity.mjs
// (classic a42829b): NumPy's legacy RandomState (MT19937 with the polar Gaussian, not default_rng) for
// seed and text inputs, the psi truncation in float32 steps, the W+ check, the planar-float to RGBA8
// conversion and the canonical generation identity. Arithmetic is the candidate's, operation for
// operation; the shapes come from the latent schema rather than being assumed.

import { sha256Hex } from '../contracts/sha256.ts';
import type { LatentSchema } from '../contracts/capability.ts';
import { FFHQ_1024_DESCRIPTOR } from '../contracts/descriptor.ts';

/** FFHQ's latent and side, read from its descriptor (the product's defaults; nothing else assumes them). */
export const FFHQ_LATENT: LatentSchema = Object.freeze({ ...FFHQ_1024_DESCRIPTOR.latent });
export const FFHQ_SIDE: number = FFHQ_1024_DESCRIPTOR.output.shape[3];
/** The product's truncation for seed and text faces (FFHQ's descriptor truncation). */
export const SEED_TRUNCATION = Object.freeze({
  psi: FFHQ_1024_DESCRIPTOR.truncation.psi,
  cutoff: FFHQ_1024_DESCRIPTOR.truncation.cutoff,
});

/** NumPy RandomState legacy MT19937 + polar Gaussian, seeded by an integer or a uint32 key. */
export function randomState(seed: number | readonly number[]): { normal(): number } {
  const mt = new Uint32Array(624);
  let index = 624;
  let spare: number | undefined;
  const at = (i: number) => mt[i] as number;
  const init = (value: number) => {
    mt[0] = value >>> 0;
    for (let i = 1; i < 624; i++)
      mt[i] = (Math.imul(1812433253, at(i - 1) ^ (at(i - 1) >>> 30)) + i) >>> 0;
  };
  if (typeof seed === 'number') init(seed);
  else {
    init(19650218);
    let i = 1,
      j = 0;
    for (let k = Math.max(624, seed.length); k; k--) {
      mt[i] =
        ((at(i) ^ Math.imul(at(i - 1) ^ (at(i - 1) >>> 30), 1664525)) + (seed[j] as number) + j) >>>
        0;
      if (++i >= 624) {
        mt[0] = at(623);
        i = 1;
      }
      if (++j >= seed.length) j = 0;
    }
    for (let k = 623; k; k--) {
      mt[i] = ((at(i) ^ Math.imul(at(i - 1) ^ (at(i - 1) >>> 30), 1566083941)) - i) >>> 0;
      if (++i >= 624) {
        mt[0] = at(623);
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }
  function uint(): number {
    if (index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = (at(i) & 0x80000000) | (at((i + 1) % 624) & 0x7fffffff);
        mt[i] = at((i + 397) % 624) ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let y = at(index++);
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
  const uniform = () => ((uint() >>> 5) * 67108864 + (uint() >>> 6)) / 9007199254740992;
  return {
    normal() {
      if (spare !== undefined) {
        const v = spare;
        spare = undefined;
        return v;
      }
      let x: number, y: number, r: number;
      do {
        x = 2 * uniform() - 1;
        y = 2 * uniform() - 1;
        r = x * x + y * y;
      } while (r >= 1 || r === 0);
      const f = Math.sqrt((-2 * Math.log(r)) / r);
      spare = f * x;
      return f * y;
    },
  };
}

export type LatentInputMode = 'seed' | 'text';
export type LatentInputIdentity = { readonly seed: number } | { readonly sha256: string };

export interface InputLatent {
  readonly identity: LatentInputIdentity;
  readonly z: Float32Array;
}

/**
 * z for a seed (a whole number 0 to 4294967295) or a text (at most 512 UTF-8 bytes, keyed by its SHA-256
 * read as eight little-endian uint32 words), as identity.mjs inputLatent(). Invalid input is a TypeError.
 */
export function inputLatent(
  mode: LatentInputMode,
  value: string,
  schema: LatentSchema = FFHQ_LATENT,
): InputLatent {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : null;
  if (!bytes || bytes.length > 512) throw new TypeError('Use at most 512 bytes of text.');
  let seed: number | number[];
  let identity: LatentInputIdentity;
  if (mode === 'seed') {
    if (
      !/^[0-9]+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > 4294967295
    )
      throw new TypeError('Seed must be a whole number from 0 to 4294967295.');
    seed = Number(value);
    identity = { seed };
  } else if (mode === 'text') {
    const hex = sha256Hex(bytes);
    const digest = Uint8Array.from({ length: 32 }, (_, i) =>
      parseInt(hex.slice(i * 2, i * 2 + 2), 16),
    );
    const view = new DataView(digest.buffer);
    const words = Array.from({ length: 8 }, (_, i) => view.getUint32(i * 4, true));
    seed = words;
    identity = { sha256: hex };
  } else throw new TypeError('Choose seed or text.');
  const rng = randomState(seed);
  return { identity, z: Float32Array.from({ length: schema.zLength }, () => rng.normal()) };
}

/** Psi blend toward the average on the first `cutoff` layers, in float32 steps (identity.mjs truncate). */
export function truncate(
  w: Float32Array,
  average: Float32Array,
  psi: number = SEED_TRUNCATION.psi,
  cutoff: number = SEED_TRUNCATION.cutoff,
  schema: LatentSchema = FFHQ_LATENT,
): Float32Array {
  const { layers, width } = schema;
  if (
    w.length !== layers * width ||
    average.length !== width ||
    !Number.isFinite(psi) ||
    psi < 0 ||
    psi > 1 ||
    !Number.isInteger(cutoff) ||
    cutoff < 0 ||
    cutoff > layers
  )
    throw Error('Invalid truncation');
  const result = new Float32Array(w);
  const p = Math.fround(psi);
  for (let l = 0; l < cutoff; l++)
    for (let i = 0; i < width; i++) {
      const k = l * width + i;
      const a = average[i] as number;
      result[k] = Math.fround(a + Math.fround(Math.fround((w[k] as number) - a) * p));
    }
  return result;
}

/** A finite float32 W+ of the schema's shape, or a TypeError (identity.mjs requireLatent). */
export function requireLatent(values: unknown, schema: LatentSchema = FFHQ_LATENT): Float32Array {
  if (
    !(values instanceof Float32Array) ||
    values.length !== schema.layers * schema.width ||
    !values.every(Number.isFinite)
  )
    throw new TypeError(`Expected finite float32 W+ [1,${schema.layers},${schema.width}].`);
  return values;
}

/** Planar float RGB in [-1, 1] to interleaved RGBA8, alpha 255: trunc(clamp(v * 127.5 + 128)). */
export function toRgba8(
  raw: Float32Array,
  width = FFHQ_SIDE,
  height = FFHQ_SIDE,
): Uint8ClampedArray {
  const n = width * height;
  if (raw.length !== 3 * n) throw Error('Synthesis output shape mismatch');
  const rgba = new Uint8ClampedArray(4 * n);
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 3; c++) {
      const v = raw[c * n + p] as number;
      if (!Number.isFinite(v)) throw Error('Nonfinite synthesis output');
      rgba[p * 4 + c] = Math.trunc(
        Math.max(0, Math.min(255, Math.fround(Math.fround(v * 127.5) + 128))),
      );
    }
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

export interface Sha256Asset {
  readonly sha256: string;
}
export interface IdentityManifest {
  readonly synthesis: Sha256Asset;
  readonly mapping: Sha256Asset;
  readonly average: Sha256Asset;
  readonly noise: readonly {
    readonly name: string;
    readonly shape: readonly number[];
    readonly sha256: string;
  }[];
  readonly encoder?: Sha256Asset;
  readonly encoderStream?: Sha256Asset & { readonly sourceEncoderSha256?: string };
  readonly alignmentSha256?: string;
}

/**
 * What a face is a function of (identity.mjs generationIdentity): transport locations, canary choice and
 * release labels never change it. Key order is the candidate's, so the JSON (and its digest) match the
 * originals already stored on visitors' devices.
 */
export function generationIdentity(manifest: IdentityManifest, kind: 'seed' | 'photo' | 'latent') {
  return {
    schema: 'canonical-face-v1',
    synthesis: manifest.synthesis.sha256,
    mapping: kind === 'seed' ? manifest.mapping.sha256 : null,
    average: kind === 'seed' ? manifest.average.sha256 : null,
    // `||` and a possibly undefined value as the candidate wrote them: an absent key is not a null one.
    encoder:
      kind === 'photo'
        ? manifest.encoderStream?.sourceEncoderSha256 || manifest.encoder?.sha256
        : null,
    ...(kind === 'photo' && manifest.encoderStream
      ? { encoderStream: manifest.encoderStream.sha256 }
      : {}),
    alignment: kind === 'photo' ? manifest.alignmentSha256 : null,
    noise: manifest.noise.map((n) => ({ name: n.name, shape: n.shape, sha256: n.sha256 })),
    truncation:
      kind === 'seed' ? { psi: SEED_TRUNCATION.psi, cutoff: SEED_TRUNCATION.cutoff } : null,
    outputPipeline: 'nchw-f32-mul127.5-add128-trunc-rgba8-raw-png-v1',
  };
}
