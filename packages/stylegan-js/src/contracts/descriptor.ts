// Model descriptor: everything the engine needs to know about a generator, so that no generic API hides
// FFHQ's 1024 px / 18x512 assumptions. Two fixtures express every field: FFHQ config-F 1024 (the product's
// generator) and AFHQ cat 512 (a real non-face model with a different W+ layer count, converted and verified
// by model-conv, fm-fy2.15). Non-face support stays unqualified, naming its blocker, until the joint proof
// (verify.packages) passes; a type walkthrough proves no runtime behaviour.

import type { LatentSchema } from './capability.ts';
import type { LatentTensor } from './operations.ts';

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type ComputeProvider = 'cpu-wasm' | 'webgpu';

/** Qualified with its evidence, or unqualified naming what blocks it. */
export type DescriptorQualification =
  | { readonly status: 'qualified'; readonly evidence: string }
  | { readonly status: 'unqualified'; readonly blocker: string };

export interface NoisePlane {
  readonly name: string;
  readonly shape: readonly [height: number, width: number];
}

/** A photo encoder bound to one generator (FFHQ e4e works only for the FFHQ generator). */
export interface PhotoEncoderDescriptor {
  readonly sourceSha256: string;
  readonly inputShape: readonly [1, 3, number, number];
  readonly preprocessingSha256: string;
  readonly detector: { readonly sha256: string; readonly bytes: number };
  readonly bytes: number;
}

interface DescriptorBase {
  readonly identity: {
    readonly modelSha256: string;
    readonly noiseSha256: string;
    readonly name: string;
  };
  readonly architecture: 'stylegan2';
  readonly latent: LatentSchema;
  readonly output: {
    readonly shape: readonly [1, channels: number, height: number, width: number];
    readonly layout: 'nchw';
    /** Raw output range before the RGB conversion. */
    readonly range: readonly [-1, 1];
    readonly toRgb: 'mul127.5-add128-trunc-clamp';
  };
  readonly noise: { readonly mode: 'const'; readonly planes: readonly NoisePlane[] };
  readonly truncation: { readonly psi: number; readonly cutoff: number };
  /** Class-conditional models name their class count; this release converts unconditional models only. */
  readonly conditioning:
    | { readonly kind: 'none' }
    | { readonly kind: 'class'; readonly classes: number };
  readonly resources: {
    readonly mappingBytes: number;
    readonly synthesisBytes: number;
    readonly averageBytes: number;
  };
  readonly providers: readonly {
    readonly provider: ComputeProvider;
    readonly qualification: DescriptorQualification;
  }[];
}

/** A face generator may carry its photo encoder; a non-face one never has one (no detector, no e4e). */
export type ModelDescriptor =
  | (DescriptorBase & { readonly subject: 'face'; readonly photoEncoder?: PhotoEncoderDescriptor })
  | (DescriptorBase & { readonly subject: 'non-face'; readonly photoEncoder?: never });

/** One row of the converter compatibility table (packages/model-conv/docs/compatibility.md). */
export interface CompatibilityRow {
  readonly checkpoint: { readonly name: string; readonly sha256: string; readonly url: string };
  readonly serialization: 'tf1-pickle' | 'pytorch-pickle';
  readonly architecture: 'stylegan2' | 'stylegan2-ada' | 'stylegan3';
  readonly conditional: boolean;
  readonly resolution: number;
  readonly channels: number;
  readonly zDim: number;
  readonly wDim: number;
  readonly wPlusLayers: number;
  readonly precision: 'fp32';
  readonly opset: number;
  readonly qualifiedProviders: readonly ComputeProvider[];
  readonly unsupported: readonly { readonly cell: string; readonly reason: string }[];
  readonly conversion: DescriptorQualification;
  readonly terms: string;
}

const planes = (resolution: number): NoisePlane[] => {
  const out: NoisePlane[] = [{ name: 'noise_0', shape: [4, 4] }];
  for (let size = 8; size <= resolution; size *= 2) {
    out.push(
      { name: `noise_${out.length}`, shape: [size, size] },
      { name: `noise_${out.length + 1}`, shape: [size, size] },
    );
  }
  return out;
};

const freezeDescriptor = (d: ModelDescriptor): ModelDescriptor => Object.freeze(d);

/** FFHQ config-F, the product's generator, with its e4e encoder (candidate runtime manifest d9e37e50...). */
export const FFHQ_1024_DESCRIPTOR: ModelDescriptor = freezeDescriptor({
  subject: 'face',
  identity: {
    name: 'stylegan2-ffhq-config-f',
    modelSha256: 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d',
    noiseSha256: 'e76258b02e159f69788bd941c9cd087200647eeb9d38f022b756143ad7fcb191',
  },
  architecture: 'stylegan2',
  latent: { zLength: 512, layers: 18, width: 512 },
  output: {
    shape: [1, 3, 1024, 1024],
    layout: 'nchw',
    range: [-1, 1],
    toRgb: 'mul127.5-add128-trunc-clamp',
  },
  noise: { mode: 'const', planes: planes(1024) },
  truncation: { psi: 0.7, cutoff: 8 },
  conditioning: { kind: 'none' },
  resources: { mappingBytes: 8411270, synthesisBytes: 123805596, averageBytes: 2048 },
  providers: [
    {
      provider: 'cpu-wasm',
      qualification: {
        status: 'qualified',
        evidence: 'product canaries (canary-qualification.mjs) on the candidate CPU route',
      },
    },
    {
      provider: 'webgpu',
      qualification: {
        status: 'qualified',
        evidence: 'product canaries on qualified WebGPU routes',
      },
    },
  ],
  photoEncoder: {
    sourceSha256: 'd525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1',
    inputShape: [1, 3, 256, 256],
    preprocessingSha256: '3cc958b232e8616db831b8429eea4446c990a845738320270b47121a2d2dbdfe',
    detector: {
      sha256: 'fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f',
      bytes: 99693937,
    },
    bytes: 1068862265,
  },
});

/** AFHQ cat 512 (model-conv stylegan2-ada-afhqcat): 16 W+ layers, 15 noise planes; non-face, unqualified. */
export const AFHQ_CAT_512_DESCRIPTOR: ModelDescriptor = freezeDescriptor({
  subject: 'non-face',
  identity: {
    name: 'stylegan2-ada-afhqcat',
    modelSha256: 'f62fd750c51f649147ba355844833c0f2a37081f7c032194f52fd74a016c3a29',
    noiseSha256: '86b548bdf4b058fd0364d7a633faa1ad173fc23d52cf2fabe63696e9b5635e4c',
  },
  architecture: 'stylegan2',
  latent: { zLength: 512, layers: 16, width: 512 },
  output: {
    shape: [1, 3, 512, 512],
    layout: 'nchw',
    range: [-1, 1],
    toRgb: 'mul127.5-add128-trunc-clamp',
  },
  noise: { mode: 'const', planes: planes(512) },
  truncation: { psi: 0.7, cutoff: 8 },
  conditioning: { kind: 'none' },
  resources: { mappingBytes: 8411270, synthesisBytes: 123411406, averageBytes: 2048 },
  providers: [
    {
      provider: 'cpu-wasm',
      qualification: {
        status: 'unqualified',
        blocker: 'joint non-face proof (verify.packages) not yet run',
      },
    },
    {
      provider: 'webgpu',
      qualification: {
        status: 'unqualified',
        blocker: 'joint non-face proof (verify.packages) not yet run',
      },
    },
  ],
});

export type DescriptorErrorCode = 'not-an-object' | 'invalid-field' | 'inconsistent';
export interface DescriptorError {
  readonly code: DescriptorErrorCode;
  readonly path: string;
  readonly message: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v: unknown, max = 1 << 20): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;

class Reject extends Error {
  readonly error: DescriptorError;
  constructor(code: DescriptorErrorCode, path: string, message: string) {
    super(message);
    this.error = { code, path, message };
  }
}
const bad = (path: string, message: string): never => {
  throw new Reject('invalid-field', path, message);
};

function qualification(v: unknown, path: string): void {
  if (!isRecord(v)) bad(path, 'a qualification');
  const q = v as Record<string, unknown>;
  if (
    q.status === 'qualified'
      ? typeof q.evidence !== 'string' || q.evidence === ''
      : q.status !== 'unqualified' || typeof q.blocker !== 'string' || q.blocker === ''
  ) {
    bad(path, 'qualified with evidence, or unqualified with a blocker');
  }
}

function descriptor(v: unknown): ModelDescriptor {
  if (!isRecord(v)) throw new Reject('not-an-object', '$', 'a descriptor is an object');
  if (v.subject !== 'face' && v.subject !== 'non-face') bad('$.subject', 'face or non-face');
  if (v.architecture !== 'stylegan2') bad('$.architecture', 'stylegan2');
  const id = v.identity as Record<string, unknown> | undefined;
  if (
    !isRecord(id) ||
    typeof id.name !== 'string' ||
    id.name === '' ||
    typeof id.modelSha256 !== 'string' ||
    !HEX64.test(id.modelSha256) ||
    typeof id.noiseSha256 !== 'string' ||
    !HEX64.test(id.noiseSha256)
  ) {
    bad('$.identity', 'name, modelSha256 and noiseSha256');
  }
  const l = v.latent as Record<string, unknown> | undefined;
  if (!isRecord(l) || !posInt(l.zLength, 4096) || !posInt(l.layers, 64) || !posInt(l.width, 4096))
    bad('$.latent', 'zLength, layers and width');
  const o = v.output as Record<string, unknown> | undefined;
  const shape = o?.shape;
  if (
    !isRecord(o) ||
    !Array.isArray(shape) ||
    shape.length !== 4 ||
    shape[0] !== 1 ||
    !shape.slice(1).every((n) => posInt(n, 16384)) ||
    o.layout !== 'nchw' ||
    o.toRgb !== 'mul127.5-add128-trunc-clamp'
  ) {
    bad('$.output', 'shape [1, channels, height, width], nchw, the product RGB conversion');
  }
  const r = v.resources as Record<string, unknown> | undefined;
  if (
    !isRecord(r) ||
    !posInt(r.mappingBytes, 2 ** 40) ||
    !posInt(r.synthesisBytes, 2 ** 40) ||
    !posInt(r.averageBytes, 2 ** 40)
  )
    bad('$.resources', 'byte sizes');
  const t = v.truncation as Record<string, unknown> | undefined;
  if (
    !isRecord(t) ||
    typeof t.psi !== 'number' ||
    !(t.psi >= 0 && t.psi <= 1) ||
    !Number.isSafeInteger(t.cutoff) ||
    (t.cutoff as number) < 0
  )
    bad('$.truncation', 'psi in [0, 1] and an integer cutoff');
  const c = v.conditioning as Record<string, unknown> | undefined;
  if (!isRecord(c) || (c.kind !== 'none' && !(c.kind === 'class' && posInt(c.classes, 100000))))
    bad('$.conditioning', 'none or a class count');
  const n = v.noise as Record<string, unknown> | undefined;
  if (!isRecord(n) || n.mode !== 'const' || !Array.isArray(n.planes) || n.planes.length === 0)
    bad('$.noise', 'const planes');
  (n!.planes as unknown[]).forEach((p, i) => {
    const q = p as Record<string, unknown>;
    if (
      !isRecord(q) ||
      typeof q.name !== 'string' ||
      !Array.isArray(q.shape) ||
      q.shape.length !== 2 ||
      !q.shape.every((d) => posInt(d, 16384))
    )
      bad(`$.noise.planes[${i}]`, 'name and [height, width]');
  });
  if (!Array.isArray(v.providers)) bad('$.providers', 'a list');
  (v.providers as unknown[]).forEach((p, i) => {
    const q = p as Record<string, unknown>;
    if (!isRecord(q) || (q.provider !== 'cpu-wasm' && q.provider !== 'webgpu'))
      bad(`$.providers[${i}].provider`, 'cpu-wasm or webgpu');
    qualification(q.qualification, `$.providers[${i}].qualification`);
  });
  if (v.subject === 'non-face' && v.photoEncoder !== undefined)
    throw new Reject(
      'inconsistent',
      '$.photoEncoder',
      'a non-face model has no photo encoder or face detector',
    );
  if (v.photoEncoder !== undefined) {
    const e = v.photoEncoder as Record<string, unknown>;
    if (
      !isRecord(e) ||
      typeof e.sourceSha256 !== 'string' ||
      !HEX64.test(e.sourceSha256) ||
      typeof e.preprocessingSha256 !== 'string' ||
      !HEX64.test(e.preprocessingSha256) ||
      !posInt(e.bytes, 2 ** 40) ||
      !isRecord(e.detector)
    ) {
      bad('$.photoEncoder', 'encoder and detector identities');
    }
  }
  // The shapes must agree with each other: StyleGAN2 has two W per resolution from 4 px plus the last toRGB,
  // and one constant noise plane per synthesis conv layer.
  const resolution = (shape as number[])[2]!;
  if (
    (shape as number[])[3] !== resolution ||
    (resolution & (resolution - 1)) !== 0 ||
    resolution < 8
  )
    throw new Reject('inconsistent', '$.output.shape', 'a square power-of-two resolution');
  const doublings = Math.log2(resolution);
  if (l!.layers !== 2 * doublings - 2)
    throw new Reject(
      'inconsistent',
      '$.latent.layers',
      `a ${resolution} px StyleGAN2 has ${2 * doublings - 2} W+ layers`,
    );
  if ((n!.planes as unknown[]).length !== 2 * doublings - 3)
    throw new Reject(
      'inconsistent',
      '$.noise.planes',
      `a ${resolution} px StyleGAN2 has ${2 * doublings - 3} noise planes`,
    );
  return v as unknown as ModelDescriptor;
}

/** Validates a descriptor from a manifest, a file or a worker. */
export function parseModelDescriptor(value: unknown): Result<ModelDescriptor, DescriptorError> {
  try {
    return { ok: true, value: descriptor(value) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.error };
    throw e;
  }
}

/** Whether a latent has this model's W+ shape (shape agreement alone does not make latents combinable). */
export function latentFitsDescriptor(latent: LatentTensor, d: ModelDescriptor): boolean {
  return (
    latent.shape[0] === d.latent.layers &&
    latent.shape[1] === d.latent.width &&
    latent.values.length === d.latent.layers * d.latent.width
  );
}

/** A latent bound to the model it came from. */
export type IdentifiedLatent<M extends string = string> = LatentTensor & {
  readonly modelSha256: M;
  readonly noiseSha256: string;
};

export interface MorphEndpointError {
  readonly code: 'mixed-model-identity' | 'shape-mismatch' | 'too-few-endpoints';
  readonly index: number;
  readonly message: string;
}

/**
 * Morph endpoints must all come from the descriptor's model: equal-shaped latents from another checkpoint are
 * rejected. At the type level, NoInfer makes every endpoint's model digest literal match the first one's.
 */
export function sameModelEndpoints<M extends string>(
  d: ModelDescriptor & { readonly identity: { readonly modelSha256: M } },
  endpoints: readonly IdentifiedLatent<NoInfer<M>>[],
): Result<readonly IdentifiedLatent<M>[], MorphEndpointError> {
  if (endpoints.length < 2)
    return {
      ok: false,
      error: {
        code: 'too-few-endpoints',
        index: endpoints.length,
        message: 'a morph needs two or more faces',
      },
    };
  for (let i = 0; i < endpoints.length; i++) {
    const e = endpoints[i]!;
    if (e.modelSha256 !== d.identity.modelSha256 || e.noiseSha256 !== d.identity.noiseSha256) {
      return {
        ok: false,
        error: {
          code: 'mixed-model-identity',
          index: i,
          message:
            'this face was made with a different model, so it cannot be morphed with these faces',
        },
      };
    }
    if (!latentFitsDescriptor(e, d))
      return {
        ok: false,
        error: {
          code: 'shape-mismatch',
          index: i,
          message: 'this latent does not have the model’s W+ shape',
        },
      };
  }
  return { ok: true, value: endpoints };
}

/** The external developer journey, step by step, as data a walkthrough type-checks. */
export type DeveloperJourneyStep =
  | { readonly step: 1; readonly kind: 'choose-checkpoint'; readonly row: CompatibilityRow }
  | {
      readonly step: 2;
      readonly kind: 'convert';
      readonly container: 'facemorph/model-conv';
      readonly command: readonly string[];
      readonly verifyReport: 'verify.json';
    }
  | {
      readonly step: 3;
      readonly kind: 'host';
      readonly hosting: 'https-static';
      readonly manifestUrl: `https://${string}`;
    }
  | {
      readonly step: 4;
      readonly kind: 'install-and-load';
      readonly packages: readonly ('stylegan-js' | 'browser-model-manager')[];
      readonly load: 'manager-grant' | 'direct';
      readonly descriptor: ModelDescriptor;
    }
  | {
      readonly step: 5;
      readonly kind: 'export-reopen-morph';
      readonly formats: readonly ('png' | 'webp-lossless')[];
      readonly reopen: 'exact-metadata';
      readonly morphInputs: number;
    };

export type DeveloperJourney = readonly [
  Extract<DeveloperJourneyStep, { step: 1 }>,
  Extract<DeveloperJourneyStep, { step: 2 }>,
  Extract<DeveloperJourneyStep, { step: 3 }>,
  Extract<DeveloperJourneyStep, { step: 4 }>,
  Extract<DeveloperJourneyStep, { step: 5 }>,
];
