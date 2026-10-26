// Runs only in the external consumer: every API below resolves from its installed release packs.
// The fm-3pne ca2f4f8 release packs predate the unscoped npm rename. These imports
// deliberately test those retained bytes; workspace aliases/new packs cannot replace them.
import {
  AFHQ_CAT_512_DESCRIPTOR,
  checkCombinable,
  createLatentPath,
  encodeLosslessWebp,
  encodePng,
  latentDigest,
  modelRecord,
  readRecovery,
} from '@facemorph/stylegan-js';
import * as engine from '@facemorph/stylegan-js/engine';
import * as manager from '@facemorph/browser-model-manager';

const descriptor = AFHQ_CAT_512_DESCRIPTOR;
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
const same = (actual, expected, label) =>
  require(JSON.stringify(actual) === JSON.stringify(expected), label + ': values differ');
const ids = (requestId) => ({ requestId, inputRevision: 0, attemptId: 0 });
const latent = (values) => ({
  space: 'w-plus',
  shape: [descriptor.latent.layers, descriptor.latent.width],
  values,
});
let state;

async function fetched(asset, fallback) {
  const response = await fetch(asset.url ?? fallback);
  require(response.ok, 'Asset fetch failed: ' + (asset.url ?? fallback));
  const bytes = new Uint8Array(await response.arrayBuffer());
  require(bytes.byteLength === asset.size, 'Asset size differs: ' + asset.sha256);
  require((await digest(bytes)) === asset.sha256, 'Asset digest differs: ' + asset.sha256);
  return bytes;
}

// A caller-controlled acquisition with its own buffers, independent of manager Cache Storage/OPFS.
async function callerBytes(asset) {
  let bytes;
  if (asset.chunks?.length) {
    bytes = new Uint8Array(asset.size);
    let offset = 0;
    for (const chunk of asset.chunks) {
      const part = await fetched(chunk);
      require(offset + part.length <= bytes.length, 'Caller chunks exceed the declared asset');
      bytes.set(part, offset);
      offset += part.length;
    }
    require(offset === bytes.length, 'Caller chunks do not fill the declared asset');
    require((await digest(bytes)) === asset.sha256, 'Caller assembled asset digest differs');
  } else bytes = await fetched(asset);
  return bytes;
}

async function referenceFloats(asset, fallback, shape) {
  const size = shape.reduce((product, side) => product * side, 1) * 4;
  const bytes = await fetched({ ...asset, size: asset.size ?? size }, fallback);
  require(bytes.byteLength === size, 'Reference shape and byte length differ');
  return new Float32Array(bytes.buffer);
}

export async function acquireNonface(config) {
  require(!state, 'Non-face consumer already initialized');
  same(config.reference.tolerance, { rawFloat: 0.001, rgb: 1 }, 'AFHQ declared tolerance');
  same(
    config.reference.cases.map((row) => row.seed),
    [0, 1],
    'AFHQ reference seeds',
  );
  require(config.reference.checkpointSha256 ===
    descriptor.identity.modelSha256, 'Independent reference checkpoint differs');
  require(config.morphReference?.checkpointSha256 ===
    descriptor.identity
      .modelSha256, 'Independent native morph reference is required for this checkpoint');
  same(config.morphReference.tolerance, config.reference.tolerance, 'Native morph tolerance');
  const unpublished = manager.parseModelManifest(config.unpublished, { unpublished: true });
  const hosted = manager.parseModelManifest(config.model);
  require(unpublished.ok, 'Unpublished manifest refused: ' + JSON.stringify(unpublished.error));
  require(hosted.ok, 'Hosted manifest refused: ' + JSON.stringify(hosted.error));
  engine.checkManifest(descriptor, config.model);
  require(descriptor.subject === 'non-face' &&
    descriptor.photoEncoder === undefined, 'Non-face descriptor must not carry an encoder');
  same(descriptor.output.shape, [1, 3, 512, 512], 'AFHQ output shape');
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
  require(cache.local.allowRepair === false, 'Manager reader must disable network repair');
  state = {
    config,
    cache,
    runtimeAssets,
    assets,
    references: [],
    direct: new Map(),
    runtime: null,
    generator: null,
    disposed: [],
  };
  const owner = 'nonface:packed-afhqcat';
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
  for (const asset of assets) state.direct.set(asset.sha256, await callerBytes(asset));
  for (const sample of config.reference.cases) {
    const row = { seed: sample.seed };
    for (const key of ['z', 'w', 'raw']) {
      const asset = sample[key];
      row[key] = await referenceFloats(asset, '/converted/reference/' + asset.file, asset.shape);
    }
    require(row.z.length === 512 &&
      row.w.length === 16 * 512 &&
      row.raw.length === 3 * 512 * 512, 'Reference must contain a complete AFHQ input and output');
    state.references.push(row);
  }
  const morph = config.morphReference;
  state.morphLatents = await referenceFloats(
    morph.latents,
    '/converted/morph-reference/' + (morph.latents.file ?? 'latents.f32'),
    morph.latents.shape,
  );
  state.morphFrames = [];
  for (const frame of morph.frames)
    state.morphFrames.push({
      index: frame.index,
      raw: await referenceFloats(
        frame,
        '/converted/morph-reference/' + frame.file,
        [1, 3, 512, 512],
      ),
    });
  return {
    unpublishedManifest: true,
    hostedManifest: true,
    descriptorCompatible: true,
    descriptor: modelRecord(descriptor),
    managerGrant: { owner, assets: grant.assets },
    callerOwnedAssets: assets.map((asset) => ({ sha256: asset.sha256, size: asset.size })),
    callerAcquisitionUsesManager: false,
    referenceDigestsVerified: state.references.length * 3 + state.morphFrames.length + 1,
    allowRepair: false,
  };
}

// Convert the upstream planar float32 output independently of the packed toRgba8 implementation.
function compared(raw, expected, label) {
  const rgba = engine.toRgba8(raw, 512, 512);
  const maxRawAbsError = maximum(raw, expected, label);
  const pixels = 512 * 512,
    scaled = new Float32Array(1);
  let maxRgbDifference = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      scaled[0] = expected[channel * pixels + pixel] * 127.5;
      scaled[0] += 128;
      const reference = Math.floor(Math.min(255, Math.max(0, scaled[0])));
      maxRgbDifference = Math.max(
        maxRgbDifference,
        Math.abs(rgba[pixel * 4 + channel] - reference),
      );
    }
    require(rgba[pixel * 4 + 3] === 255, label + ': alpha differs');
  }
  require(maxRawAbsError <= 0.001 && maxRgbDifference <= 1, label +
    ': AFHQ declared tolerance exceeded: ' +
    JSON.stringify({ maxRawAbsError, maxRgbDifference }));
  return {
    rgba,
    maxRawAbsError,
    maxRgbDifference,
    rawValuesCompared: raw.length,
    rgbValuesCompared: pixels * 3,
    alphaValuesChecked: pixels,
  };
}

async function disposeActive(path) {
  if (state.generator) {
    await state.generator.dispose();
    const liveSessions = state.generator.inspect().liveSessions;
    state.disposed.push({ path, liveSessions });
    state.generator = null;
    require(liveSessions === 0, 'Generator sessions leaked: ' + path);
  }
  state.runtime?.release();
  state.runtime = null;
}

function callerReader(reads) {
  return {
    allowRepair: false,
    async read(asset) {
      reads.push(asset.sha256);
      const bytes = state.direct.get(asset.sha256);
      if (!bytes)
        return { ok: false, error: { code: 'cache-miss', message: 'Caller does not own asset' } };
      if (bytes.length !== asset.size || (await digest(bytes)) !== asset.sha256)
        return {
          ok: false,
          error: { code: 'cache-corrupt', message: 'Caller asset no longer matches digest' },
        };
      return { ok: true, value: bytes.slice() };
    },
  };
}

async function morphProof(generator, controls) {
  const reference = state.config.morphReference;
  const spec = {
    ...reference.latents.morph,
    controls: reference.latents.morph.controls.map((id) => {
      const control = controls.find((row) => 'seed-' + row.seed === id);
      require(control, 'Native morph control is unavailable: ' + id);
      return { visitId: id, latent: latent(control.w) };
    }),
  };
  require(spec.controls.length >= 2, 'Morph must have multiple actual mapped inputs');
  const path = createLatentPath(spec, descriptor),
    frames = [...path.frames()];
  require(frames.length === reference.frames.length &&
    frames.length === reference.latents.shape[0], 'Native and consumer morph frame counts differ');
  const results = [];
  for (const frame of frames) {
    const values = Float32Array.from(frame.values);
    const expectedLatent = state.morphLatents.subarray(
      frame.index * 16 * 512,
      (frame.index + 1) * 16 * 512,
    );
    const maxWAbsError = maximum(values, expectedLatent, 'Morph latent ' + frame.index);
    require(maxWAbsError <= 0.001, 'Morph latent exceeds declared model tolerance');
    const native = state.morphFrames.find((row) => row.index === frame.index);
    require(native, 'Native morph frame is missing: ' + frame.index);
    const raw = await generator.synthesizeRaw(values, 'original');
    const { rgba, ...metrics } = compared(raw, native.raw, 'Morph frame ' + frame.index);
    results.push({ index: frame.index, maxWAbsError, ...metrics, rgbaSha256: await digest(rgba) });
  }
  return {
    loadPath: 'manager-grant',
    algorithm: reference.latents.morph,
    controls: spec.controls.map((row) => row.visitId),
    format: 'synthesized-rgba-frame-sequence',
    frames: results,
  };
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

async function exportProof(sample) {
  const values = latent(sample.w),
    sha256 = latentDigest(values);
  const meta = {
    descriptor,
    generationKind: 'seed',
    seed: sample.seed,
    generationSha256: await digest(
      new TextEncoder().encode(
        JSON.stringify({
          model: descriptor.identity.modelSha256,
          seed: sample.seed,
          latentSha256: sha256,
        }),
      ),
    ),
    provenance: {
      modelSha256: descriptor.identity.modelSha256,
      noiseSha256: descriptor.identity.noiseSha256,
      manifestSha256: state.config.manifestSha256,
      bundleVersion: state.config.model.bundleVersion,
      route: 'cpu',
      provider: 'wasm',
      mappingProvider: 'wasm',
      truncationPsi: state.config.reference.truncation.psi,
      truncationCutoff: state.config.reference.truncation.cutoff,
    },
    latent: values,
  };
  const pixels = { width: 512, height: 512, rgba: new Uint8ClampedArray(sample.rgba) };
  const outputs = [
    { format: 'png', mime: 'image/png', bytes: await encodePng(pixels, meta) },
    { format: 'webp', mime: 'image/webp', bytes: encodeLosslessWebp(pixels, meta) },
  ];
  const results = [];
  for (const output of outputs) {
    const reopened = readRecovery(output.bytes);
    require(reopened.kind === 'parsed', 'Export did not reopen: ' +
      output.format +
      ' ' +
      JSON.stringify(reopened));
    const back = reopened.recovered;
    require(back.schemaVersion === 3 &&
      back.generationKind === 'seed' &&
      back.seed === sample.seed, 'Recovered generation metadata differs');
    same(back.model, modelRecord(descriptor), 'Recovered complete model record');
    same(back.latent.shape, [16, 512], 'Recovered latent shape');
    require(maximum(back.latent.values, values.values, 'Recovered W+') === 0 &&
      latentDigest(back.latent) === sha256, 'Recovered float32 latent bytes differ');
    require(back.generationSha256 ===
      meta.generationSha256, 'Recovered generation identity differs');
    for (const [key, value] of Object.entries(meta.provenance))
      require(back.provenance[key] === value, 'Recovered provenance differs: ' + key);
    const bitmap = await createImageBitmap(new Blob([output.bytes], { type: output.mime }));
    let decoded;
    try {
      require(bitmap.width === 512 && bitmap.height === 512, 'Decoded image dimensions differ');
      const canvas = new OffscreenCanvas(512, 512),
        context = canvas.getContext('2d');
      require(context, 'Browser canvas decoding is unavailable');
      context.drawImage(bitmap, 0, 0);
      decoded = context.getImageData(0, 0, 512, 512).data;
    } finally {
      bitmap.close();
    }
    require(maximum(decoded, pixels.rgba, 'Decoded ' + output.format) ===
      0, 'Lossless image pixels changed');
    results.push({
      format: output.format,
      filename: 'afhq-seed-' + sample.seed + '.' + output.format,
      size: output.bytes.length,
      sha256: await digest(output.bytes),
      bytesBase64: base64(output.bytes),
      schemaVersion: back.schemaVersion,
      model: back.model,
      latentSha256: sha256,
      generationSha256: back.generationSha256,
      exactMetadata: true,
      exactRgba: true,
    });
  }
  const input = {
    modelSha256: descriptor.identity.modelSha256,
    noiseSha256: descriptor.identity.noiseSha256,
    latent: values,
  };
  const compatible = checkCombinable(descriptor, [input, input]);
  require(compatible.ok, 'Same-model recovered inputs should combine');
  const mixed = checkCombinable(descriptor, [input, { ...input, modelSha256: '0'.repeat(64) }]);
  require(!mixed.ok &&
    mixed.error.code === 'mixed-model' &&
    mixed.error.index === 1, 'An equal-shaped latent from another checkpoint was not rejected');
  return {
    exports: results,
    crossCheckpoint: { sameShape: [16, 512], acceptedSameModel: true, rejected: mixed.error },
  };
}

export async function inferNonface() {
  require(state?.references.length === 2, 'Both independent references must be acquired');
  const paths = [],
    report = { provider: 'ort-wasm', numThreads: 1, descriptor: modelRecord(descriptor) };
  for (const name of ['manager-grant', 'direct-caller']) {
    const reads = [];
    const reader =
      name === 'manager-grant'
        ? {
            allowRepair: false,
            read: (asset) => {
              reads.push(asset.sha256);
              return state.cache.local.read(asset);
            },
          }
        : callerReader(reads);
    try {
      state.runtime = await engine.loadOrtRuntime(
        reader,
        state.runtimeAssets,
        engine.browserModuleHost(),
        1,
      );
      state.generator = await engine.loadCpuGenerator({
        reader,
        manifest: state.config.model,
        manifestSha256: state.config.manifestSha256,
        descriptor,
        ort: async () => state.runtime.ort,
      });
      const samples = [],
        controls = [];
      for (const reference of state.references) {
        const seeded = engine.inputLatent('seed', String(reference.seed), state.generator.latent);
        require(maximum(seeded.z, reference.z, 'NumPy seed ' + reference.seed) ===
          0, 'Package seed mapping is not NumPy RandomState exact');
        const mapped = await state.generator.map({
          ids: ids(name + '-' + reference.seed),
          z: seeded.z,
          truncation: state.config.reference.truncation,
        });
        same(mapped.wPlus.shape, [16, 512], 'Mapped AFHQ W+ shape');
        const maxWAbsError = maximum(mapped.wPlus.values, reference.w, 'W+ seed ' + reference.seed);
        require(maxWAbsError <= 0.001, 'Mapped W+ exceeds declared model tolerance');
        const raw = await state.generator.synthesizeRaw(mapped.wPlus.values, 'original');
        const { rgba, ...metrics } = compared(raw, reference.raw, name + ' seed ' + reference.seed);
        controls.push({ seed: reference.seed, w: mapped.wPlus.values.slice(), rgba });
        samples.push({
          seed: reference.seed,
          maxWAbsError,
          ...metrics,
          rgbaSha256: await digest(rgba),
        });
      }
      if (name === 'manager-grant') {
        report.morph = await morphProof(state.generator, controls);
        Object.assign(report, await exportProof(controls[0]));
      }
      const allowed = new Set(state.assets.map((asset) => asset.sha256));
      require(reads.length > 0 &&
        reads.every((sha256) =>
          allowed.has(sha256),
        ), 'The generator read an asset outside its own model/runtime');
      paths.push({
        path: name,
        samples,
        reads,
        managerStorageReads: name === 'manager-grant',
        maxRawAbsError: Math.max(...samples.map((sample) => sample.maxRawAbsError)),
        maxRgbDifference: Math.max(...samples.map((sample) => sample.maxRgbDifference)),
      });
    } finally {
      await disposeActive(name);
    }
  }
  return { ...report, paths, disposed: state.disposed, liveSessionsAfterDispose: 0 };
}

export async function cleanupNonface() {
  if (!state) return { cleaned: true, initialized: false, liveSessionsAfterDispose: 0 };
  await disposeActive('cleanup');
  const disposed = state.disposed;
  state.direct.clear();
  await caches.delete(manager.MODEL_CACHE_NAME);
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(manager.SHARD_DIRECTORY, { recursive: true }).catch((error) => {
      if (error.name !== 'NotFoundError') throw error;
    });
  }
  state = undefined;
  return {
    cleaned: true,
    liveSessionsAfterDispose: 0,
    disposed,
    callerOwnedBuffersReleased: true,
    nativeCacheDeleted: true,
  };
}
