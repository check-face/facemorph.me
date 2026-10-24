// An outside consumer: a caller-loaded capability driven through the engine contracts, with no
// manager import. It only has to compile against the packed declarations.
import {
  CROP_PREPROCESSING_POLICY_V1,
  createConfirmedCrop,
  deriveEncoderInput,
  parseRecoveryMetadata,
  type LoadedModelCapability,
  type MappingResult,
  type SynthesisResult,
} from '@facemorph/stylegan-js';

export function minimalCapability(): LoadedModelCapability {
  return {
    identity: { modelSha256: 'a'.repeat(64), noiseSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) },
    latent: { zLength: 4, layers: 2, width: 4 },
    image: { width: 2, height: 2 },
    provider: { requested: 'auto', actual: 'cpu', admission: 'admitted', validation: 'validated' },
    unsupported: [],
    async map(request): Promise<MappingResult> {
      return { ids: request.ids, wPlus: { space: 'w-plus', shape: [2, 4], values: new Float32Array(8) }, provider: 'cpu' };
    },
    async synthesize(request): Promise<SynthesisResult> {
      return {
        ids: request.ids,
        width: 2,
        height: 2,
        rgba: new Uint8ClampedArray(16),
        provider: 'cpu',
        readiness: { pixelsAvailable: true, fileReady: false, persisted: false, displayDecoded: false, videoPlayable: 'not-applicable' },
      };
    },
    async dispose() {},
  };
}

export async function seedToImage(): Promise<number> {
  const model = minimalCapability();
  const ids = { requestId: 'r', inputRevision: 1, attemptId: 0 };
  const mapped = await model.map({ ids, z: new Float32Array(4), truncation: { psi: 0.7, cutoff: 8 } });
  const image = await model.synthesize({ ids, wPlus: mapped.wPlus, output: 'rgba' });
  return image.rgba.length;
}

export function cropToTensor(pixels: Uint8ClampedArray): number {
  const crop = createConfirmedCrop({
    sourceRevision: 1,
    sourceDigest: 'd'.repeat(64),
    rect: { left: 0, top: 0, width: 256, height: 256 },
    rotationDegrees: 0,
    exifOrientation: 1,
    exifApplied: false,
    policyVersion: 'crop-preprocessing-v1',
    policyParams: CROP_PREPROCESSING_POLICY_V1,
  });
  return deriveEncoderInput({ width: 256, height: 256, data: pixels }, crop).tensor.length;
}

export const missing = parseRecoveryMetadata(new Uint8Array(0)).kind;
