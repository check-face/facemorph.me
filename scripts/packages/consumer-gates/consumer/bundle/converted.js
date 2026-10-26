// Executed from the clean consumer's Vite output: every runtime API comes from its installed packs.
import { FFHQ_1024_DESCRIPTOR } from '@facemorph/stylegan-js';
import * as engine from '@facemorph/stylegan-js/engine';
import * as manager from '@facemorph/browser-model-manager';

const require = (condition, message) => {
  if (!condition) throw Error(message);
};
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
const maximum = (actual, expected, label) => {
  require(actual.length === expected.length, label + ': length differs');
  let max = 0;
  for (let index = 0; index < actual.length; index++) {
    require(Number.isFinite(actual[index]) && Number.isFinite(expected[index]), label +
      ': nonfinite value');
    max = Math.max(max, Math.abs(actual[index] - expected[index]));
  }
  return max;
};
let state;

export async function acquireConverted(config) {
  require(!state, 'Converted consumer already initialized');
  const unpublished = manager.parseModelManifest(config.unpublished, { unpublished: true });
  require(unpublished.ok, 'Unpublished manifest refused: ' + JSON.stringify(unpublished.error));
  const hosted = manager.parseModelManifest(config.model);
  require(hosted.ok, 'Hosted manifest refused: ' + JSON.stringify(hosted.error));
  engine.checkManifest(FFHQ_1024_DESCRIPTOR, config.model);
  const runtimeAssets = engine.cpuRuntimeAssets(config.runtime);
  const assets = Array.from(
    new Map(
      [
        config.model.mapping,
        config.model.synthesis,
        config.model.average,
        ...config.model.noise,
        runtimeAssets.module,
        runtimeAssets.factory,
        runtimeAssets.wasm,
      ].map((asset) => [asset.sha256, asset]),
    ).values(),
  );
  const cache = await manager.createBrowserModelCache();
  require(cache.local.allowRepair === false, 'Engine reader must disable repair');
  state = { config, cache, runtimeAssets, references: [], assets };
  const owner = 'face:packed-ffhq';
  const grant = {
    manifestSha256: config.manifestSha256,
    route: 'cpu',
    purpose: 'generate',
    owners: [owner],
    assets: assets.map((asset) => ({
      sha256: asset.sha256,
      bytes: asset.size,
      priority: 'foreground-required',
    })),
    remainingBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
  };
  for (const asset of assets) await cache.acquire(asset, { grant, owner });
  for (const sample of config.reference.cases) {
    const row = { seed: sample.seed };
    for (const key of ['z', 'w', 'raw']) {
      const asset = sample[key];
      const response = await fetch('/converted/reference/' + asset.file);
      require(response.ok, 'Reference fetch failed: ' + asset.file);
      const bytes = await response.arrayBuffer();
      require(bytes.byteLength === asset.size, 'Reference size differs: ' + asset.file);
      require((await digest(bytes)) === asset.sha256, 'Reference digest differs: ' + asset.file);
      require(asset.shape.reduce((n, value) => n * value, 1) * 4 ===
        bytes.byteLength, 'Reference shape differs: ' + asset.file);
      row[key] = new Float32Array(bytes);
    }
    require(row.z.length === 512 &&
      row.w.length === 18 * 512 &&
      row.raw.length === 3 * 1024 * 1024, 'Reference is not a complete FFHQ input/output');
    state.references.push(row);
  }
  return {
    unpublishedManifest: true,
    hostedManifest: true,
    descriptorCompatible: true,
    assets: assets.map((asset) => ({ sha256: asset.sha256, size: asset.size })),
    referenceDigestsVerified: state.references.length * 3,
    allowRepair: cache.local.allowRepair,
  };
}

export async function inferConverted() {
  require(state?.references.length ===
    3, 'All three reference cases must be acquired before inference');
  const { config, cache, runtimeAssets, references } = state;
  const reads = [];
  const reader = {
    allowRepair: false,
    read: (asset) => {
      reads.push(asset.sha256);
      return cache.local.read(asset);
    },
  };
  const runtime = await engine.loadOrtRuntime(reader, runtimeAssets, engine.browserModuleHost(), 1);
  state.runtime = runtime;
  const generator = await engine.loadCpuGenerator({
    reader,
    manifest: config.model,
    manifestSha256: config.manifestSha256,
    descriptor: FFHQ_1024_DESCRIPTOR,
    ort: async () => runtime.ort,
  });
  state.generator = generator;
  const samples = [];
  try {
    for (const reference of references) {
      const mapped = await generator.map({
        ids: { requestId: 'converted-' + reference.seed, inputRevision: 0, attemptId: 0 },
        z: reference.z,
        truncation: config.reference.truncation,
      });
      const raw = await generator.synthesizeRaw(mapped.wPlus.values, 'original');
      const maxWAbsError = maximum(mapped.wPlus.values, reference.w, 'W+');
      const maxRawAbsError = maximum(raw, reference.raw, 'Raw synthesis');
      const rgba = engine.toRgba8(raw, 1024, 1024);
      const pixels = 1024 * 1024;
      require(rgba.length === pixels * 4, 'RGBA: expected complete 1024x1024x4 output');
      // Independent of the packed conversion: model-conv verify.py's planar float32
      // scale/add, saturation and truncating uint8 cast, interleaved here for comparison.
      const scaled = new Float32Array(1);
      let maxRgbDifference = 0;
      for (let pixel = 0; pixel < pixels; pixel++) {
        for (let channel = 0; channel < 3; channel++) {
          scaled[0] = reference.raw[channel * pixels + pixel] * 127.5;
          scaled[0] += 128;
          const expected = Math.floor(Math.min(255, Math.max(0, scaled[0])));
          const actual = rgba[pixel * 4 + channel];
          require(Number.isFinite(actual), 'RGBA: nonfinite RGB value');
          maxRgbDifference = Math.max(maxRgbDifference, Math.abs(actual - expected));
        }
        require(rgba[pixel * 4 + 3] === 255, 'RGBA: alpha must be 255 at every pixel');
      }
      const sample = {
        seed: reference.seed,
        rawValuesCompared: raw.length,
        rgbaValuesCompared: rgba.length,
        rgbValuesCompared: pixels * 3,
        alphaValuesChecked: pixels,
        maxWAbsError,
        maxRawAbsError,
        maxRgbDifference,
        rgbaSha256: await digest(rgba),
      };
      samples.push(sample);
      require(maxWAbsError <= 0.002 &&
        maxRawAbsError <= 0.002 &&
        maxRgbDifference <= 1, 'Converted FFHQ exceeds frozen tolerances: ' +
        JSON.stringify(sample));
    }
    return {
      samples,
      reads,
      provider: 'ort-wasm',
      numThreads: 1,
      maxRawAbsError: Math.max(...samples.map((sample) => sample.maxRawAbsError)),
      maxRgbDifference: Math.max(...samples.map((sample) => sample.maxRgbDifference)),
    };
  } finally {
    await generator.dispose();
    state.liveSessionsAfterDispose = generator.inspect().liveSessions;
    require(state.liveSessionsAfterDispose === 0, 'Generator sessions leaked');
    runtime.release();
  }
}

export async function cleanupConverted() {
  if (!state) return { cleaned: true, initialized: false };
  await state.generator?.dispose();
  state.runtime?.release();
  const liveSessionsAfterDispose = state.generator?.inspect().liveSessions ?? 0;
  await caches.delete(manager.MODEL_CACHE_NAME);
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(manager.SHARD_DIRECTORY, { recursive: true }).catch((error) => {
      if (error.name !== 'NotFoundError') throw error;
    });
  }
  state = undefined;
  require(liveSessionsAfterDispose === 0, 'Generator sessions leaked during cleanup');
  return { cleaned: true, liveSessionsAfterDispose, nativeCacheDeleted: true };
}
