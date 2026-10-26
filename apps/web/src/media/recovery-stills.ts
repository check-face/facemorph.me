// Recovery in saved stills, as the app writes and reads it (fm-fy2.7): the package's schema core (fm-fzzd,
// @facemorph/stylegan-js media/*) bound to the app's face values. Stills are written as schema 3 (generator record
// and W+ shape from the model descriptor) and read as schema 3, schema 2 PNG/WebP or the candidate's schema 1 PNG.
// Split from recovery-files.ts (fm-s0vi) so the image encoder worker, which only writes stills, does not bundle the
// project-file codec and its contracts; recovery-files.ts re-exports all of this. No DOM: callers pass bytes.
// Nothing here fetches anything, including URLs found in metadata.
import {
  FFHQ_1024_DESCRIPTOR,
  embedRecoveryV3,
  readRecovery,
  type BlendRecipe,
  type LatentTensor,
  type ModelDescriptor,
  type RecoveredStill,
  type RecoveryModelRecord,
  type RecoveryProvenance,
  type StillGenerationKind,
} from '@facemorph/stylegan-js';

/** The generators the app ships; a saved file's model identity selects one. */
export const APP_DESCRIPTORS: readonly ModelDescriptor[] = [FFHQ_1024_DESCRIPTOR];

/** The shipped descriptor for these model and noise digests, or null for a model this app does not ship. */
export function descriptorFor(
  modelSha256: unknown,
  noiseSha256: unknown,
  descriptors: readonly ModelDescriptor[] = APP_DESCRIPTORS,
): ModelDescriptor | null {
  return (
    descriptors.find(
      (d) => d.identity.modelSha256 === modelSha256 && d.identity.noiseSha256 === noiseSha256,
    ) ?? null
  );
}

export type RecoveryFileErrorCode = 'damaged' | 'incompatible-schema' | 'unknown-model';

/** A saved file whose recovery data cannot be used; `detail` is the reader's reason. */
export class RecoveryFileError extends Error {
  readonly code: RecoveryFileErrorCode;
  readonly detail: string;
  constructor(code: RecoveryFileErrorCode, message: string, detail: string) {
    super(message);
    this.name = 'RecoveryFileError';
    this.code = code;
    this.detail = detail;
  }
}

/** A face as the bridge holds it: its latent (values only, or with a shape) and its recovery identity. */
export interface FaceIdentity {
  readonly latent: {
    readonly space?: string;
    readonly shape?: readonly number[];
    readonly values: ArrayLike<number>;
  };
  readonly provenance: RecoveryProvenance;
  readonly generationKind: StillGenerationKind;
  readonly generationSha256: string;
  readonly blend?: BlendRecipe;
}

/** The face's latent as the descriptor's W+ tensor (float32). */
export const latentFor = (latent: FaceIdentity['latent'], d: ModelDescriptor): LatentTensor => ({
  space: 'w-plus',
  shape: [d.latent.layers, d.latent.width],
  values: latent.values instanceof Float32Array ? latent.values : Float32Array.from(latent.values),
});

function seedOf(seed: unknown): number | undefined {
  if (seed === undefined || seed === null || seed === '') return undefined;
  const n = typeof seed === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(seed) ? Number(seed) : seed;
  if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 4294967295)
    throw new Error('Invalid recovery seed.');
  return n as number;
}

/**
 * The still with a fresh schema-3 envelope for `face`. The descriptor is the face's own model (by its provenance
 * digests); the image must be that model's full frame. Only a seed face records its seed.
 */
export function writeStill(
  image: Uint8Array,
  face: FaceIdentity,
  options: { readonly seed?: unknown; readonly descriptor?: ModelDescriptor } = {},
): Uint8Array {
  const descriptor =
    options.descriptor ??
    descriptorFor(face.provenance?.modelSha256, face.provenance?.noiseSha256);
  if (!descriptor)
    throw new Error('This face’s model is not one this app ships; its recovery data is not written.');
  const seed = face.generationKind === 'seed' ? seedOf(options.seed) : undefined;
  return embedRecoveryV3(image, {
    descriptor,
    generationKind: face.generationKind,
    generationSha256: face.generationSha256,
    provenance: face.provenance,
    latent: latentFor(face.latent, descriptor),
    ...(seed === undefined ? {} : { seed }),
    ...(face.blend === undefined ? {} : { blend: face.blend }),
  });
}

/** A recovered still in the bridge's face shape (blob bytes, latent, identity), plus what schema 3 adds. */
export interface RecoveredFace {
  readonly schemaVersion: 1 | 2 | 3;
  readonly mime: 'image/png' | 'image/webp';
  /** The image without its envelope, as saved. */
  readonly image: Uint8Array;
  readonly latent: {
    readonly space: 'w-plus';
    readonly shape: readonly [number, number];
    readonly values: Float32Array;
  };
  readonly provenance: RecoveryProvenance;
  readonly generationKind?: StillGenerationKind;
  readonly generationSha256?: string;
  readonly imageSha256: string;
  readonly latentSha256: string;
  readonly seed?: number;
  /** The generator the latent belongs to: schema 3's record, else the shipped descriptor its digests name. */
  readonly model: RecoveryModelRecord | null;
  readonly blend?: BlendRecipe;
}

const modelOf = (d: ModelDescriptor): RecoveryModelRecord => {
  const [, , height, width] = d.output.shape;
  return {
    name: d.identity.name,
    architecture: d.architecture,
    subject: d.subject,
    modelSha256: d.identity.modelSha256,
    noiseSha256: d.identity.noiseSha256,
    latent: { space: 'w-plus', layers: d.latent.layers, width: d.latent.width },
    output: { width, height },
  };
};

function faceOf(r: RecoveredStill): RecoveredFace {
  const shipped = descriptorFor(r.provenance.modelSha256, r.provenance.noiseSha256);
  return {
    schemaVersion: r.schemaVersion,
    mime: r.mime,
    image: r.baseImage,
    latent: { space: 'w-plus', shape: [r.latent.shape[0], r.latent.shape[1]], values: r.latent.values },
    provenance: r.provenance,
    ...(r.generationKind === undefined ? {} : { generationKind: r.generationKind }),
    ...(r.generationSha256 === undefined ? {} : { generationSha256: r.generationSha256 }),
    imageSha256: r.imageSha256,
    latentSha256: r.latentSha256,
    ...(r.seed === undefined ? {} : { seed: r.seed }),
    model: r.model ?? (shipped ? modelOf(shipped) : null),
    ...(r.blend === undefined ? {} : { blend: r.blend }),
  };
}

/**
 * A saved still's recovery data: null when the file carries none (or is not a PNG/WebP); a RecoveryFileError
 * when it is damaged or of a schema this app does not read.
 */
export function readStill(bytes: Uint8Array): RecoveredFace | null {
  const r = readRecovery(bytes);
  if (r.kind === 'missing') return null;
  if (r.kind === 'damaged')
    throw new RecoveryFileError(
      'damaged',
      r.reason === 'integrity'
        ? 'FaceMorph image or latent failed its integrity check.'
        : 'Damaged FaceMorph recovery metadata.',
      `${r.reason}: ${r.detail}`,
    );
  if (r.kind === 'incompatible-schema')
    throw new RecoveryFileError(
      'incompatible-schema',
      'Unsupported FaceMorph recovery metadata.',
      `schema ${JSON.stringify(r.schemaVersion)}`,
    );
  return faceOf(r.recovered);
}

/** A saved face may join this runtime's faces only when its generator is this runtime's model and shape. */
export function checkFaceModel(
  face: RecoveredFace,
  runtime: { readonly modelSha256: string; readonly noiseSha256: string },
): void {
  const m = face.model;
  if (
    face.provenance.modelSha256 !== runtime.modelSha256 ||
    face.provenance.noiseSha256 !== runtime.noiseSha256 ||
    !m ||
    m.modelSha256 !== runtime.modelSha256 ||
    m.latent.layers !== face.latent.shape[0] ||
    m.latent.width !== face.latent.shape[1]
  )
    throw new RecoveryFileError(
      'unknown-model',
      'This saved face uses a different model.',
      `model ${String(face.provenance.modelSha256)}`,
    );
}
