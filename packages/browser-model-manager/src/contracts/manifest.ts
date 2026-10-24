// Model manifest compatibility. The manager owns the producer-facing JSON schema
// (schema/model-manifest.v1.schema.json); cloudflare-model-host and model-conv validate the manifests
// they emit against it as a dev-dependency, so the manager never depends on them at runtime. Weights
// stay out of tarballs and private source provenance stays out of published manifests. Descriptor and
// content identities survive renames: assets are addressed by SHA-256 (the WebGL coefficient assets
// also feed direct WebGPU, so they stay even though WebGL execution is gone).
//
// Shape (the candidate runtime manifest, next.facemorph.me /runtime/manifest.json, SHA-256 d9e37e50…):
// schemaVersion 1; generator assets mapping, synthesis, average, noise[]; identities modelSourceSha256
// and noiseSha256; optional runtime/webgpu/webgl/codec bundles, canaries, the photo encoder (encoder,
// encoderStream with phoneAdmitted and maxWasmBytes), alignment (landmarks, photo, alignmentSha256)
// and kernel provenance (candidateId, sourceHash). Fields beyond these are allowed within major 1.

import type { Result } from './errors.ts';

export const MANIFEST_SCHEMA_MAJOR = 1;
/** The bounded e4e stream's WASM heap limit (encoderStream.maxWasmBytes in the candidate). */
export const E4E_MAX_WASM_BYTES = 268435456;

/** One downloadable file, addressed by content; large files arrive as verified chunks. */
export interface AssetDescriptor {
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly chunks?: readonly {
    readonly url: string;
    readonly sha256: string;
    readonly size: number;
  }[];
}

export interface NoiseAsset extends AssetDescriptor {
  readonly name: string;
  readonly shape: readonly number[];
}

export interface EncoderStreamDescriptor extends AssetDescriptor {
  readonly sourceEncoderSha256: string;
  readonly preprocessingSha256: string;
  /** Admitted on phones (by its measured memory), never a blanket phone rule. */
  readonly phoneAdmitted: boolean;
  readonly maxWasmBytes: number;
}

/** Which kernel candidate produced the shipped kernel, and from what source. */
export interface KernelProvenance {
  readonly candidateId: string;
  readonly sourceHash: string;
  readonly sha256: string;
}

export interface ModelManifestV1 {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_MAJOR;
  readonly bundleVersion: string;
  readonly modelSourceSha256: string;
  readonly noiseSha256: string;
  readonly mapping: AssetDescriptor;
  readonly synthesis: AssetDescriptor;
  readonly average?: AssetDescriptor;
  readonly noise: readonly NoiseAsset[];
  readonly encoder?: AssetDescriptor;
  readonly encoderStream?: EncoderStreamDescriptor;
  readonly landmarks?: AssetDescriptor;
  readonly alignmentSha256?: string;
  readonly kernel?: KernelProvenance;
  readonly releaseQualified?: boolean;
  /** Everything else in major 1, kept as parsed JSON. */
  readonly [extra: string]: unknown;
}

/** The app's runtime manifest: a model manifest that names its kernel provenance. */
export type RuntimeManifest = ModelManifestV1 & { readonly kernel: KernelProvenance };

/** Generator, photo encoder and preprocessing identities, kept separate. */
export interface AssetIdentity {
  readonly generator: {
    readonly modelSourceSha256: string;
    readonly noiseSha256: string;
    readonly mappingSha256: string;
    readonly synthesisSha256: string;
  };
  readonly photoEncoder?: { readonly sourceEncoderSha256: string; readonly streamSha256: string };
  readonly preprocessing?: { readonly alignmentSha256: string };
}

export type ManifestErrorCode =
  | 'not-an-object'
  | 'newer-major'
  | 'unsupported-major'
  | 'invalid-field'
  | 'invalid-asset';

export interface ManifestError {
  readonly code: ManifestErrorCode;
  /** JSON path of the offending value. */
  readonly path: string;
  readonly message: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

class Reject extends Error {
  readonly error: ManifestError;
  constructor(code: ManifestErrorCode, path: string, message: string) {
    super(message);
    this.error = { code, path, message };
  }
}

const field = (path: string, message: string): never => {
  throw new Reject('invalid-field', path, message);
};

function httpsUrl(v: unknown, path: string): void {
  if (typeof v !== 'string' || !/^https:\/\/[^/@\s]+\/\S*$/.test(v))
    throw new Reject('invalid-asset', path, 'an https URL without credentials');
}

function asset(v: unknown, path: string): AssetDescriptor {
  if (!isRecord(v)) throw new Reject('invalid-asset', path, 'an asset descriptor');
  httpsUrl(v.url, `${path}.url`);
  if (typeof v.sha256 !== 'string' || !HEX64.test(v.sha256))
    throw new Reject('invalid-asset', `${path}.sha256`, 'lowercase hex SHA-256');
  if (!Number.isSafeInteger(v.size) || (v.size as number) < 0)
    throw new Reject('invalid-asset', `${path}.size`, 'a non-negative integer');
  if (v.chunks !== undefined) {
    if (!Array.isArray(v.chunks) || v.chunks.length === 0)
      throw new Reject('invalid-asset', `${path}.chunks`, 'a non-empty list');
    let total = 0;
    v.chunks.forEach((c: unknown, i: number) => {
      const p = `${path}.chunks[${i}]`;
      if (!isRecord(c)) throw new Reject('invalid-asset', p, 'a chunk');
      httpsUrl(c.url, `${p}.url`);
      if (typeof c.sha256 !== 'string' || !HEX64.test(c.sha256))
        throw new Reject('invalid-asset', `${p}.sha256`, 'lowercase hex SHA-256');
      if (!Number.isSafeInteger(c.size) || (c.size as number) <= 0)
        throw new Reject('invalid-asset', `${p}.size`, 'a positive integer');
      total += c.size as number;
    });
    if (total !== v.size)
      throw new Reject(
        'invalid-asset',
        `${path}.chunks`,
        'chunk sizes do not add up to the asset size',
      );
  }
  return v as unknown as AssetDescriptor;
}

/** Every nested asset descriptor (anything with url, sha256 and size), as the candidate's collectAssets walks them. */
function eachAsset(v: unknown, path: string, depth = 0): void {
  if (!isRecord(v) && !Array.isArray(v)) return;
  if (isRecord(v) && 'sha256' in v && 'size' in v && 'url' in v) {
    asset(v, path);
    return;
  }
  if (depth >= 4) return;
  for (const [k, item] of Object.entries(v))
    eachAsset(item, Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, depth + 1);
}

const hex = (v: unknown, path: string) => {
  if (typeof v !== 'string' || !HEX64.test(v)) field(path, 'lowercase hex SHA-256');
};

function manifest(v: unknown): ModelManifestV1 {
  if (!isRecord(v)) throw new Reject('not-an-object', '$', 'a manifest is a JSON object');
  const major = v.schemaVersion;
  if (!Number.isSafeInteger(major)) field('$.schemaVersion', 'an integer major version');
  if ((major as number) > MANIFEST_SCHEMA_MAJOR)
    throw new Reject(
      'newer-major',
      '$.schemaVersion',
      `major ${String(major)} is newer than this manager (${MANIFEST_SCHEMA_MAJOR})`,
    );
  if (major !== MANIFEST_SCHEMA_MAJOR)
    throw new Reject(
      'unsupported-major',
      '$.schemaVersion',
      `major ${String(major)} is not supported`,
    );
  if (typeof v.bundleVersion !== 'string' || v.bundleVersion === '')
    field('$.bundleVersion', 'a non-empty string');
  hex(v.modelSourceSha256, '$.modelSourceSha256');
  hex(v.noiseSha256, '$.noiseSha256');
  asset(v.mapping, '$.mapping');
  asset(v.synthesis, '$.synthesis');
  if (!Array.isArray(v.noise) || v.noise.length === 0) field('$.noise', 'a non-empty list');
  (v.noise as unknown[]).forEach((n, i) => {
    asset(n, `$.noise[${i}]`);
    const r = n as Record<string, unknown>;
    if (
      typeof r.name !== 'string' ||
      !Array.isArray(r.shape) ||
      !r.shape.every((d) => Number.isSafeInteger(d) && d > 0)
    )
      field(`$.noise[${i}]`, 'name and shape');
  });
  if (v.releaseQualified !== undefined && typeof v.releaseQualified !== 'boolean')
    field('$.releaseQualified', 'a boolean');
  if (v.alignmentSha256 !== undefined) hex(v.alignmentSha256, '$.alignmentSha256');
  const s = v.encoderStream;
  if (s !== undefined) {
    asset(s, '$.encoderStream');
    const e = s as Record<string, unknown>;
    hex(e.sourceEncoderSha256, '$.encoderStream.sourceEncoderSha256');
    hex(e.preprocessingSha256, '$.encoderStream.preprocessingSha256');
    if (typeof e.phoneAdmitted !== 'boolean') field('$.encoderStream.phoneAdmitted', 'a boolean');
    if (
      !Number.isSafeInteger(e.maxWasmBytes) ||
      (e.maxWasmBytes as number) <= 0 ||
      (e.maxWasmBytes as number) > E4E_MAX_WASM_BYTES
    )
      field('$.encoderStream.maxWasmBytes', `1 to ${E4E_MAX_WASM_BYTES}`);
  }
  const k = v.kernel;
  if (k !== undefined) {
    if (!isRecord(k) || typeof k.candidateId !== 'string' || k.candidateId === '')
      field('$.kernel.candidateId', 'a candidate id');
    hex((k as Record<string, unknown>).sourceHash, '$.kernel.sourceHash');
    hex((k as Record<string, unknown>).sha256, '$.kernel.sha256');
  }
  eachAsset(v, '$');
  return v as unknown as ModelManifestV1;
}

/** Validates a manifest from the network or a producer. An unknown or newer major is rejected. */
export function parseModelManifest(value: unknown): Result<ModelManifestV1, ManifestError> {
  try {
    return { ok: true, value: manifest(value) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.error };
    throw e;
  }
}

export function assetIdentity(m: ModelManifestV1): AssetIdentity {
  return {
    generator: {
      modelSourceSha256: m.modelSourceSha256,
      noiseSha256: m.noiseSha256,
      mappingSha256: m.mapping.sha256,
      synthesisSha256: m.synthesis.sha256,
    },
    ...(m.encoderStream
      ? {
          photoEncoder: {
            sourceEncoderSha256: m.encoderStream.sourceEncoderSha256,
            streamSha256: m.encoderStream.sha256,
          },
        }
      : {}),
    ...(m.alignmentSha256 ? { preprocessing: { alignmentSha256: m.alignmentSha256 } } : {}),
  };
}
