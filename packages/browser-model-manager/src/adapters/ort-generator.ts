// The generator's ORT session adapter on the manager's handles (fm-ffn7): the first provider adapter compute extraction
// needs. Ported from the candidate's CPU path (classic a42829b src/Next/browser/ort-worker.mjs load(), run(),
// mappingFor(); identity.mjs truncate() and rgba1024()): one WASM synthesis session fed W+ [1,18,512] and the manifest's
// noise tensors, and one mapping session (z [1,512] -> W+) followed by the candidate's truncation. Arithmetic,
// session options, feed names and the noise modes are the candidate's.
//
// The adapter owns its shard reads and its bounded session lifecycle: every byte comes from a VerifiedLocalReader
// (never a fetch, never a repair), the synthesis session is created at load and the mapping session on first use, and
// dispose() releases both. Stage timings are reported when the inference's output has been read back (getData()
// resolved), never when the run was submitted. Load attribution keeps the candidate's split: verified read, session
// create, run, total.

import type {
  CancellationSignal,
  ComputeRoute,
  LoadedModelCapability,
  MappingRequest,
  MappingResult,
  StageTimingHook,
  SynthesisRequest,
  SynthesisResult,
} from '@facemorph/stylegan-js';
import type { ManagerError, Result } from '../contracts/errors.ts';
import type { VerifiedLocalReader } from '../contracts/lifecycle.ts';
import type { AssetDescriptor, NoiseAsset } from '../contracts/manifest.ts';

/** The onnxruntime-web surface the adapter uses, structurally (the module is handed in, never imported here). */
export interface OrtTensor {
  getData(): Promise<unknown>;
  dispose(): void;
}
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor | undefined>>;
  release(): Promise<void>;
}
export interface OrtModule {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[] }): Promise<OrtSession>;
  };
}

/** The runtime-manifest fields the generator path reads. */
export interface GeneratorManifest {
  readonly modelSourceSha256: string;
  readonly noiseSha256: string;
  readonly bundleVersion?: string;
  readonly mapping: AssetDescriptor;
  readonly synthesis: AssetDescriptor;
  readonly average: AssetDescriptor;
  readonly noise: readonly NoiseAsset[];
}

/** The manifest's canary noise modes; 'alternate' is the noise negated (ort-worker.mjs run()). */
export type NoiseMode = 'original' | 'zero' | 'alternate';

export interface LoadTimings {
  readonly verifiedReadMs: number;
  readonly sessionCreateMs: number;
  readonly totalMs: number;
}

export interface OrtGenerator extends LoadedModelCapability {
  /** Every asset this capability reads, for the handle's leases. */
  readonly assets: readonly { sha256: string; bytes: number }[];
  readonly loadTimings: LoadTimings;
  /** The raw float path the canaries use (ort-worker.mjs run(values, id, noiseMode)). */
  synthesizeRaw(values: Float32Array, noiseMode?: NoiseMode): Promise<Float32Array>;
  inspect(): { liveSessions: number; disposed: boolean };
}

const LAYERS = 18,
  WIDTH = 512,
  SIDE = 1024;

/** identity.mjs truncate(): psi blend toward the average on the first `cutoff` layers, in float32 steps. */
export function truncate(
  w: Float32Array,
  average: Float32Array,
  psi = 0.7,
  cutoff = 8,
): Float32Array {
  if (
    w.length !== LAYERS * WIDTH ||
    average.length !== WIDTH ||
    !Number.isFinite(psi) ||
    psi < 0 ||
    psi > 1 ||
    !Number.isInteger(cutoff) ||
    cutoff < 0 ||
    cutoff > LAYERS
  )
    throw Error('Invalid truncation');
  const result = new Float32Array(w);
  for (let l = 0; l < cutoff; l++)
    for (let i = 0; i < WIDTH; i++) {
      const k = l * WIDTH + i;
      result[k] = Math.fround(
        (average[i] as number) +
          Math.fround(Math.fround((w[k] as number) - (average[i] as number)) * Math.fround(psi)),
      );
    }
  return result;
}

/** identity.mjs rgba1024(): planar float RGB [-1, 1] to interleaved RGBA8, alpha 255. */
export function rgba1024(raw: Float32Array): Uint8ClampedArray {
  const n = SIDE * SIDE;
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

const requireLatent = (values: Float32Array) => {
  if (
    !(values instanceof Float32Array) ||
    values.length !== LAYERS * WIDTH ||
    !values.every(Number.isFinite)
  )
    throw new TypeError('Expected finite float32 W+ [1,18,512].');
  return values;
};

const floats = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

/** Loads the generator from verified local bytes only. A missing or corrupt asset is a typed error, never a fetch. */
export async function loadOrtGenerator({
  ort,
  reader,
  manifest,
  manifestSha256,
  now = () => performance.now(),
}: {
  ort: OrtModule;
  reader: VerifiedLocalReader;
  manifest: GeneratorManifest;
  manifestSha256: string;
  now?: () => number;
}): Promise<Result<OrtGenerator, ManagerError>> {
  const started = now();
  let readMs = 0;
  const read = async (asset: AssetDescriptor) => {
    const t = now();
    const r = await reader.read(asset);
    readMs += now() - t;
    return r;
  };
  const noise: Record<string, Float32Array> = {};
  for (const item of manifest.noise) {
    const r = await read(item);
    if (!r.ok) return r;
    noise[item.name] = floats(r.value);
  }
  const synthesisBytes = await read(manifest.synthesis);
  if (!synthesisBytes.ok) return synthesisBytes;
  const createStarted = now();
  let synthesis: OrtSession | null = await ort.InferenceSession.create(synthesisBytes.value, {
    executionProviders: ['wasm'],
  });
  const sessionCreateMs = now() - createStarted;
  let mapping: OrtSession | null = null;
  let average: Float32Array | null = null;
  let disposed = false;
  const live = () => (synthesis ? 1 : 0) + (mapping ? 1 : 0);

  const route: ComputeRoute = 'cpu';
  const assertLive = () => {
    if (disposed) throw Error('The generator was disposed.');
  };
  const aborted = (signal?: CancellationSignal) => {
    if (signal?.aborted) throw signal.reason ?? Error('Cancelled');
  };

  async function synthesizeRaw(
    values: Float32Array,
    noiseMode: NoiseMode = 'original',
  ): Promise<Float32Array> {
    assertLive();
    requireLatent(values);
    const feeds: Record<string, OrtTensor> = {
      w: new ort.Tensor('float32', values, [1, LAYERS, WIDTH]),
    };
    for (const item of manifest.noise) {
      const data = noise[item.name] as Float32Array;
      const selected =
        noiseMode === 'original'
          ? data
          : noiseMode === 'zero'
            ? new Float32Array(data.length)
            : Float32Array.from(data, (x) => -x);
      feeds[item.name] = new ort.Tensor('float32', selected, item.shape);
    }
    let output: OrtTensor | undefined;
    try {
      output = (await (synthesis as OrtSession).run(feeds))['image'];
      if (!output) throw Error('Synthesis produced no image output');
      return new Float32Array((await output.getData()) as Float32Array);
    } finally {
      for (const t of Object.values(feeds)) t.dispose();
      output?.dispose();
    }
  }

  const generator: OrtGenerator = {
    identity: {
      modelSha256: manifest.modelSourceSha256,
      noiseSha256: manifest.noiseSha256,
      manifestSha256,
      ...(manifest.bundleVersion ? { bundleVersion: manifest.bundleVersion } : {}),
    },
    latent: { zLength: WIDTH, layers: LAYERS, width: WIDTH },
    image: { width: SIDE, height: SIDE },
    provider: { requested: 'cpu', actual: route, admission: 'admitted', validation: 'unvalidated' },
    unsupported: [
      { capability: 'webgpu', reason: 'This adapter runs the CPU (WASM) sessions only.' },
      { capability: 'encode', reason: 'The photo encoder is a separate adapter.' },
    ],
    assets: [manifest.synthesis, manifest.mapping, manifest.average, ...manifest.noise].map(
      (a) => ({
        sha256: a.sha256,
        bytes: a.size,
      }),
    ),
    loadTimings: { verifiedReadMs: readMs, sessionCreateMs, totalMs: now() - started },
    synthesizeRaw,

    async map(
      request: MappingRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<MappingResult> {
      assertLive();
      aborted(signal);
      if (!mapping) {
        const avg = await reader.read(manifest.average);
        if (!avg.ok) throw Object.assign(Error(avg.error.message), { managerError: avg.error });
        assertLive(); // disposed while reading: read nothing more
        const bytes = await reader.read(manifest.mapping);
        if (!bytes.ok)
          throw Object.assign(Error(bytes.error.message), { managerError: bytes.error });
        assertLive(); // disposed while reading: create nothing
        average = new Float32Array(floats(avg.value));
        const session = await ort.InferenceSession.create(bytes.value, {
          executionProviders: ['wasm'],
        });
        if (disposed) {
          // Disposed while the session was being created: release it, so dispose() leaves no session behind.
          await session.release();
          throw Error('The generator was disposed.');
        }
        mapping = session;
      }
      const startedAtMs = now();
      const input = new ort.Tensor('float32', request.z, [1, WIDTH]);
      let out: OrtTensor | undefined;
      try {
        out = (await mapping.run({ z: input }))['w'];
        if (!out) throw Error('Mapping produced no w output');
        const w = (await out.getData()) as Float32Array;
        onTiming?.({
          ids: request.ids,
          operation: 'map',
          stage: 'mapping',
          route,
          startedAtMs,
          completedAtMs: now(),
          boundary: 'readback-complete',
        });
        const values = truncate(
          new Float32Array(w),
          average as Float32Array,
          request.truncation.psi,
          request.truncation.cutoff,
        );
        return {
          ids: request.ids,
          wPlus: { space: 'w-plus', shape: [LAYERS, WIDTH], values },
          provider: route,
        };
      } finally {
        input.dispose();
        out?.dispose();
      }
    },

    async synthesize(
      request: SynthesisRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<SynthesisResult> {
      assertLive();
      aborted(signal);
      const startedAtMs = now();
      const raw = await synthesizeRaw(request.wPlus.values);
      onTiming?.({
        ids: request.ids,
        operation: 'synthesize',
        stage: 'synthesis',
        route,
        startedAtMs,
        completedAtMs: now(),
        boundary: 'readback-complete',
      });
      aborted(signal);
      return {
        ids: request.ids,
        width: SIDE,
        height: SIDE,
        rgba: rgba1024(raw),
        ...(request.output === 'rgba-and-raw-float' ? { rawFloat: raw } : {}),
        provider: route,
        readiness: {
          pixelsAvailable: true,
          fileReady: false,
          persisted: false,
          displayDecoded: false,
          videoPlayable: 'not-applicable',
        },
      };
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      const sessions = [synthesis, mapping];
      synthesis = null;
      mapping = null;
      for (const s of sessions) await s?.release();
    },
    inspect: () => ({ liveSessions: live(), disposed }),
  };
  return { ok: true, value: generator };
}
