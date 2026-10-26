// The model descriptor as the engine reads it (fm-qjcs): every dimension mapping and synthesis use comes from
// here, not from FFHQ's 1024 px and 18 x 512. A descriptor the engine cannot run is a typed rejection naming
// the field, before any byte is read. FFHQ's numbers live only in its descriptor (contracts/descriptor.ts).

import type { LatentSchema } from '../contracts/capability.ts';
import {
  FFHQ_1024_DESCRIPTOR,
  parseModelDescriptor,
  type ModelDescriptor,
  type NoisePlane,
} from '../contracts/descriptor.ts';

export type DescriptorRejectionCode = 'invalid' | 'unsupported' | 'inconsistent';

/** The engine cannot run this descriptor (or this manifest under it); `field` is the descriptor path at fault. */
export class DescriptorUnsupported extends Error {
  readonly code: DescriptorRejectionCode;
  readonly field: string;
  constructor(code: DescriptorRejectionCode, field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'DescriptorUnsupported';
    this.code = code;
    this.field = field;
  }
}

/** What the generic engine needs from a descriptor. */
export interface EngineGeometry {
  readonly latent: LatentSchema;
  readonly channels: number;
  readonly height: number;
  readonly width: number;
  readonly noise: readonly NoisePlane[];
  readonly truncation: { readonly psi: number; readonly cutoff: number };
}

/** Engines whose kernels or split graphs were built for one checkpoint, and which one. */
export type EngineKind = 'ort-wasm' | 'ort-webgpu' | 'direct-webgpu';
const FIXED_KERNELS: Partial<Record<EngineKind, string>> = {
  // The tiled split graph and its fused-resample boundary (manifest.webgpu) and the WGSL block stream
  // (manifest.webgl) are FFHQ config-F artefacts; another model has no such bundle.
  'ort-webgpu': FFHQ_1024_DESCRIPTOR.identity.modelSha256,
  'direct-webgpu': FFHQ_1024_DESCRIPTOR.identity.modelSha256,
};

/**
 * The geometry of a descriptor this engine can run, or DescriptorUnsupported naming the first field it
 * cannot: an invalid descriptor (the contract's own validation), class conditioning (no label input),
 * anything but 3-channel [-1, 1] NCHW through the product RGB conversion, non-constant noise, or a model
 * an engine with fixed kernels was not built for.
 */
export function engineGeometry(value: unknown, engine: EngineKind = 'ort-wasm'): EngineGeometry {
  const parsed = parseModelDescriptor(value);
  if (!parsed.ok)
    throw new DescriptorUnsupported(
      parsed.error.code === 'inconsistent' ? 'inconsistent' : 'invalid',
      parsed.error.path,
      parsed.error.message,
    );
  const d = parsed.value;
  const unsupported = (field: string, message: string): never => {
    throw new DescriptorUnsupported('unsupported', field, message);
  };
  if (d.conditioning.kind !== 'none')
    unsupported(
      '$.conditioning',
      `class-conditional models (${d.conditioning.kind}) are not supported: the engine has no label input`,
    );
  const [, channels, height, width] = d.output.shape;
  if (channels !== 3)
    unsupported(
      '$.output.shape[1]',
      `${channels} output channels: the product RGB conversion needs exactly 3`,
    );
  if (d.output.range[0] !== -1 || d.output.range[1] !== 1)
    unsupported('$.output.range', 'the RGB conversion expects raw output in [-1, 1]');
  if (d.output.layout !== 'nchw') unsupported('$.output.layout', 'only NCHW output is read');
  if (d.noise.mode !== 'const') unsupported('$.noise.mode', 'only constant noise planes are fed');
  if (d.truncation.cutoff > d.latent.layers)
    unsupported(
      '$.truncation.cutoff',
      `cutoff ${d.truncation.cutoff} exceeds the ${d.latent.layers} W+ layers`,
    );
  const fixed = FIXED_KERNELS[engine];
  if (fixed && d.identity.modelSha256 !== fixed)
    unsupported(
      '$.identity.modelSha256',
      `the ${engine} engine's kernels were built for one checkpoint (${fixed.slice(0, 12)}…), not ${d.identity.name}`,
    );
  return {
    latent: d.latent,
    channels,
    height,
    width,
    noise: d.noise.planes,
    truncation: d.truncation,
  };
}

/** The runtime-manifest fields the descriptor must agree with. */
export interface DescribedManifest {
  readonly modelSourceSha256: string;
  readonly noiseSha256: string;
  readonly noise: readonly { readonly name: string; readonly shape: readonly number[] }[];
}

/** A manifest that does not belong to the descriptor (identity, noise names or shapes) is inconsistent. */
export function checkManifest(d: ModelDescriptor, m: DescribedManifest): void {
  const bad = (field: string, message: string): never => {
    throw new DescriptorUnsupported('inconsistent', field, message);
  };
  if (m.modelSourceSha256 !== d.identity.modelSha256)
    bad('$.identity.modelSha256', 'the manifest is for a different checkpoint');
  if (m.noiseSha256 !== d.identity.noiseSha256)
    bad('$.identity.noiseSha256', 'the manifest carries different noise');
  if (m.noise.length !== d.noise.planes.length)
    bad(
      '$.noise.planes',
      `the manifest has ${m.noise.length} noise planes, the descriptor ${d.noise.planes.length}`,
    );
  d.noise.planes.forEach((p, i) => {
    const n = m.noise[i]!;
    if (
      n.name !== p.name ||
      n.shape.length !== 2 ||
      n.shape[0] !== p.shape[0] ||
      n.shape[1] !== p.shape[1]
    )
      bad(`$.noise.planes[${i}]`, `the manifest's ${n.name} [${n.shape.join(',')}] differs`);
  });
}
