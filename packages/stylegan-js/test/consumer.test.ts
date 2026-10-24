// A consumer holding a caller-loaded capability, with no manager import: seed -> mapping ->
// synthesis, and confirmed crop -> encoder input -> encode. The capability below is a minimal
// deterministic model written against the contract (tiny dimensions, plain arithmetic), the
// "types/stubs" consumer this bead asks for; it stands in for no real dependency under test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CROP_PREPROCESSING_POLICY_V1,
  acceptsResult,
  createConfirmedCrop,
  deriveEncoderInput,
  type EncodeRequest,
  type EncodeResult,
  type LatentTensor,
  type LoadedEncoderCapability,
  type LoadedModelCapability,
  type MappingRequest,
  type MappingResult,
  type StageTimingEvent,
  type SynthesisRequest,
  type SynthesisResult,
} from '../src/index.ts';

const LAYERS = 2;
const WIDTH = 4;

function minimalCapability(): LoadedModelCapability {
  const encoder: LoadedEncoderCapability = {
    async encode(request: EncodeRequest): Promise<EncodeResult> {
      const values = new Float32Array(LAYERS * WIDTH).map(
        (_, i) => request.input.tensor[i * 1000]!,
      );
      return {
        ids: request.ids,
        confirmedCropId: request.confirmedCropId,
        wPlus: { space: 'w-plus', shape: [LAYERS, WIDTH], values },
        provider: 'cpu',
        timings: {
          verifiedReadMs: 0,
          sessionCreateMs: 0,
          runMs: 0,
          totalMs: 0,
          wasmHeapBytes: 0,
          maxLiveSessions: 1,
        },
      };
    },
    abort() {},
    async dispose() {},
  };
  return {
    identity: {
      modelSha256: 'a'.repeat(64),
      noiseSha256: 'b'.repeat(64),
      manifestSha256: 'c'.repeat(64),
    },
    latent: { zLength: WIDTH, layers: LAYERS, width: WIDTH },
    image: { width: 2, height: 2 },
    provider: { requested: 'auto', actual: 'cpu', admission: 'admitted', validation: 'validated' },
    unsupported: [{ capability: 'webgpu', reason: 'no adapter' }],
    encoder,
    async map(request: MappingRequest, _signal, onTiming): Promise<MappingResult> {
      const values = new Float32Array(LAYERS * WIDTH).map(
        (_, i) => request.z[i % WIDTH]! * request.truncation.psi,
      );
      onTiming?.({
        ids: request.ids,
        operation: 'map',
        stage: 'mapping',
        route: 'cpu',
        startedAtMs: 1,
        completedAtMs: 2,
        boundary: 'inference-complete',
      });
      return {
        ids: request.ids,
        wPlus: { space: 'w-plus', shape: [LAYERS, WIDTH], values },
        provider: 'cpu',
      };
    },
    async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
      const v = request.wPlus.values;
      const rgba = new Uint8ClampedArray(2 * 2 * 4).map((_, i) =>
        i % 4 === 3 ? 255 : Math.round(128 + 100 * v[i % v.length]!),
      );
      return {
        ids: request.ids,
        width: 2,
        height: 2,
        rgba,
        provider: 'cpu',
        readiness: {
          pixelsAvailable: true,
          fileReady: false,
          persisted: false,
          displayDecoded: false,
          videoPlayable: 'not-applicable',
        },
      };
    },
    async dispose() {},
  };
}

test('seed -> mapping -> synthesis through a caller-loaded capability', async () => {
  const model = minimalCapability();
  const timings: StageTimingEvent[] = [];
  const ids = { requestId: 'face-1', inputRevision: 1, attemptId: 0 };
  const mapped = await model.map(
    { ids, z: Float32Array.of(0.1, -0.2, 0.3, 0), truncation: { psi: 0.7, cutoff: 8 } },
    undefined,
    (e) => timings.push(e),
  );
  const wPlus: LatentTensor = mapped.wPlus;
  assert.deepEqual(wPlus.shape, [model.latent.layers, model.latent.width]);
  const image = await model.synthesize({ ids, wPlus, output: 'rgba' });
  assert.equal(image.rgba.length, model.image.width * model.image.height * 4);
  assert.equal(image.provider, model.provider.actual);
  assert.equal(image.readiness.pixelsAvailable, true);
  assert.equal(timings[0]?.boundary, 'inference-complete');
});

test('confirmed crop -> encoder input -> encode, once, keyed by the crop identity', async () => {
  const model = minimalCapability();
  const size = 256;
  const data = new Uint8ClampedArray(size * size * 4).map((_, i) => (i % 4 === 3 ? 255 : i % 251));
  const crop = createConfirmedCrop({
    sourceRevision: 1,
    sourceDigest: 'd'.repeat(64),
    rect: { left: 0, top: 0, width: size, height: size },
    rotationDegrees: 0,
    exifOrientation: 1,
    exifApplied: false,
    policyVersion: 'crop-preprocessing-v1',
    policyParams: CROP_PREPROCESSING_POLICY_V1,
  });
  const input = deriveEncoderInput({ width: size, height: size, data }, crop);
  const result = await model.encoder!.encode({
    ids: { requestId: 'photo-1', inputRevision: 1, attemptId: 0 },
    input,
    confirmedCropId: crop.confirmedCropId,
  });
  assert.equal(result.confirmedCropId, crop.confirmedCropId);
  assert.deepEqual(result.wPlus.shape, [LAYERS, WIDTH]);
});

test('a late result for an older input revision is superseded', () => {
  assert.equal(acceptsResult(3, { requestId: 'a', inputRevision: 2, attemptId: 0 }), false);
  assert.equal(acceptsResult(3, { requestId: 'b', inputRevision: 3, attemptId: 1 }), true);
  assert.equal(acceptsResult(3, { requestId: 'c', inputRevision: 4, attemptId: 0 }), true);
});
