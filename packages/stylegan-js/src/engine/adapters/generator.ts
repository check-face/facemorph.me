// One generator adapter surface over the retained synthesis engines (fm-3h3w): ORT WASM on the CPU, ORT's
// WebGPU execution provider (desktop and phones) and the direct WGSL engine (desktop only). Ported from
// the candidate's ort-worker.mjs load(), run(), faceRgba(), synthesizeFrames(), warmMapping() and
// mappingFor() (classic a42829b).
//
// - Every byte comes from the manager's verified local reader; nothing is fetched or repaired.
// - Mapping (z -> W+) always runs on ORT WASM. On the WebGPU engines its session is created beside the GPU
//   model load (warmMapping: the weights live on the GPU, so it costs a few MiB of WASM heap, not a second
//   working set); on the CPU route loading stays sequential, mapping on first use, which is what keeps an
//   iPhone inside its envelope. The load trace records both orders.
// - Synthesis stage timings end when the output is on the CPU: getData() resolved for ORT, the readback's
//   mapAsync() for the GPU engines. Never at submission.
// - GPU engines keep a face's whole schedule plus its readback queued while the previous face converts, a
//   pipeline at most two deep (the candidate's morph overlap, every frame's floats bit-identical).
// - Disposal releases sessions, buffers, devices and runtime URLs once; an operation that was running
//   rejects with GeneratorUnavailable rather than producing a face. A lost GPU device is reported to
//   onLost() listeners (the manager's handle invalidates with 'device-loss') and fails what is pending.

import type {
  CancellationSignal,
  ComputeRoute,
  LatentSchema,
  LoadedModelCapability,
  ProviderState,
  RequestedRoute,
  UnsupportedCapability,
} from '../../contracts/capability.ts';
import type {
  MappingRequest,
  MappingResult,
  SynthesisRequest,
  SynthesisResult,
} from '../../contracts/operations.ts';
import type { StageCompletionBoundary, StageTimingHook } from '../../contracts/timing.ts';
import type { NoiseMode } from '../canary.ts';
import { FFHQ_LATENT, FFHQ_SIDE, requireLatent, toRgba8, truncate } from '../identity.ts';
import { floats, readLocal, type EngineAsset, type LocalAssetReader } from '../reader.ts';
import type { OrtModule, OrtSession, OrtTensor } from './ort.ts';

export type AdapterEngine = 'ort-wasm' | 'ort-webgpu' | 'direct-webgpu';

export interface NoiseAsset extends EngineAsset {
  readonly name: string;
  readonly shape: readonly number[];
}

/** The runtime-manifest fields every generator reads. */
export interface GeneratorManifest {
  readonly modelSourceSha256: string;
  readonly noiseSha256: string;
  readonly bundleVersion?: string;
  readonly mapping: EngineAsset;
  readonly synthesis: EngineAsset;
  readonly average: EngineAsset;
  readonly noise: readonly NoiseAsset[];
}

export type NoiseSet = Readonly<Record<string, Float32Array>>;

/** One queued face: `done` settles when its output is on the CPU. */
export interface Submitted<T> {
  readonly done: Promise<T>;
}

/** What each synthesis engine supplies to the shared generator. */
export interface SynthesisBackend {
  readonly engine: AdapterEngine;
  readonly route: ComputeRoute;
  readonly boundary: StageCompletionBoundary;
  /** Queues one face and returns once it is queued (GPU) or done (CPU). */
  submitRaw(values: Float32Array, noise: NoiseSet): Promise<Submitted<Float32Array>>;
  /** RGBA8 straight from the engine, where it converts on the GPU (the direct engine). */
  submitRgba?(values: Float32Array, noise: NoiseSet): Promise<Submitted<Uint8ClampedArray>>;
  /** Fires once if the device is lost underneath. */
  onLost?(listener: (message: string) => void): void;
  liveResources(): number;
  dispose(): Promise<void>;
}

export type LoadEvent =
  | 'noise-read'
  | 'synthesis-load-start'
  | 'synthesis-load-done'
  | 'mapping-load-start'
  | 'mapping-load-done';

export interface GeneratorInspection {
  readonly disposed: boolean;
  readonly liveSessions: number;
  readonly backendResources: number;
  readonly pending: number;
}

export type InvalidationKind = 'device-loss' | 'worker-loss' | 'disposed';

/** An operation stopped because the generator is gone (disposed, or its device lost). */
export class GeneratorUnavailable extends Error {
  readonly kind: InvalidationKind;
  constructor(kind: InvalidationKind, message: string) {
    super(message);
    this.name = 'GeneratorUnavailable';
    this.kind = kind;
  }
}

export interface Generator extends LoadedModelCapability {
  readonly engine: AdapterEngine;
  readonly route: ComputeRoute;
  /** Every asset this generator reads, for the handle's leases. */
  readonly assets: readonly { readonly sha256: string; readonly bytes: number }[];
  /** Load order, for the sequential-CPU / overlapped-WebGPU check. */
  readonly loadTrace: readonly LoadEvent[];
  /** The canaries' raw float path, with the manifest's noise modes ('alternate' negates the noise). */
  synthesizeRaw(values: Float32Array, noise?: NoiseMode): Promise<Float32Array>;
  /**
   * Faces in order, each handed to `onFace` as it lands; on the GPU engines face N+1 is queued before
   * face N is delivered. Rejects on the first failure, with every queued face's readback settled.
   */
  synthesizeSequence(
    latents: readonly Float32Array[],
    onFace: (index: number, rgba: Uint8ClampedArray) => void | Promise<void>,
    signal?: CancellationSignal,
  ): Promise<number>;
  /** Mapping session ready (WebGPU warms it during the load; CPU on first use). */
  mappingReady(): Promise<void>;
  onLost(listener: (kind: InvalidationKind, message: string) => void): void;
  inspect(): GeneratorInspection;
}

export interface CpuMapping {
  /** The CPU ORT module for the mapping session (and, on the CPU route, synthesis). */
  readonly ort: () => Promise<OrtModule>;
}

const aborted = (signal?: CancellationSignal) => {
  if (signal?.aborted) throw signal.reason ?? new GeneratorUnavailable('disposed', 'Cancelled');
};

/** Applies a canary noise mode to the manifest's noise (ort-worker.mjs run()). */
export function noiseFor(noise: NoiseSet, mode: NoiseMode): NoiseSet {
  if (mode === 'original') return noise;
  const out: Record<string, Float32Array> = {};
  for (const [name, data] of Object.entries(noise))
    out[name] =
      mode === 'zero' ? new Float32Array(data.length) : Float32Array.from(data, (x) => -x);
  return out;
}

/** Builds the generator around a backend. Internal: the route-specific loaders call it. */
export async function assembleGenerator(o: {
  readonly reader: LocalAssetReader;
  readonly manifest: GeneratorManifest;
  readonly manifestSha256: string;
  readonly requested: RequestedRoute;
  readonly mapping: CpuMapping;
  readonly backend: (noise: NoiseSet, trace: (e: LoadEvent) => void) => Promise<SynthesisBackend>;
  readonly extraAssets: readonly EngineAsset[];
  readonly unsupported: readonly UnsupportedCapability[];
  readonly now?: () => number;
  readonly latent?: LatentSchema;
  /** WebGPU engines: create the mapping session beside the GPU model load. The CPU route stays sequential. */
  readonly warmMapping: boolean;
  readonly release?: () => void;
}): Promise<Generator> {
  const { reader, manifest } = o;
  const now = o.now ?? (() => performance.now());
  const schema = o.latent ?? FFHQ_LATENT;
  const trace: LoadEvent[] = [];
  const noise: Record<string, Float32Array> = {};
  for (const item of manifest.noise)
    noise[item.name] = new Float32Array(floats(await readLocal(reader, item)));
  trace.push('noise-read');

  let disposed = false;
  let lost: { kind: InvalidationKind; message: string } | null = null;
  let mapping: OrtSession | null = null;
  let mappingOrt: OrtModule | null = null;
  let average: Float32Array | null = null;
  let mappingLoad: Promise<void> | null = null;
  const pending = new Set<(e: GeneratorUnavailable) => void>();
  const lostListeners: ((kind: InvalidationKind, message: string) => void)[] = [];

  const unavailable = () =>
    lost
      ? new GeneratorUnavailable(lost.kind, lost.message)
      : new GeneratorUnavailable('disposed', 'The generator was disposed.');
  const assertLive = () => {
    if (disposed || lost) throw unavailable();
  };
  /** Runs `work`, settling early as failed if the generator is disposed or its device lost meanwhile. */
  function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      assertLive();
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise<T>((resolve, reject) => {
      const stop = (e: GeneratorUnavailable) => reject(e);
      pending.add(stop);
      work().then(
        (v) => {
          if (pending.delete(stop)) resolve(v);
        },
        (e: unknown) => {
          if (pending.delete(stop)) reject(e);
        },
      );
    });
  }
  const failPending = () => {
    const e = unavailable();
    for (const stop of pending) stop(e);
    pending.clear();
  };

  function loadMapping(): Promise<void> {
    mappingLoad ??= (async () => {
      trace.push('mapping-load-start');
      const ort = await o.mapping.ort();
      assertLive();
      const avg = new Float32Array(floats(await readLocal(reader, manifest.average)));
      assertLive();
      const bytes = await readLocal(reader, manifest.mapping);
      assertLive();
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      if (disposed || lost) {
        // Disposed while the session was being created: release it, so nothing outlives dispose().
        await session.release();
        throw unavailable();
      }
      mappingOrt = ort;
      average = avg; // set before `mapping`, so a visible mapping always has its average
      mapping = session;
      trace.push('mapping-load-done');
    })().catch((error: unknown) => {
      mappingLoad = null; // a failed warm-up retries in line on the first map()
      throw error;
    });
    return mappingLoad;
  }

  if (o.warmMapping) void loadMapping().catch(() => {}); // a failure here retries in line on the first map()
  trace.push('synthesis-load-start');
  let backend: SynthesisBackend;
  try {
    backend = await o.backend(noise, (e) => trace.push(e));
  } catch (error) {
    if (mappingLoad) await (mappingLoad as Promise<void>).catch(() => {});
    await (mapping as OrtSession | null)?.release();
    o.release?.();
    throw error;
  }
  trace.push('synthesis-load-done');
  const route = backend.route;
  backend.onLost?.((message) => {
    if (disposed || lost) return;
    lost = { kind: 'device-loss', message };
    failPending();
    for (const l of lostListeners) l('device-loss', message);
  });

  const submitRaw = async (values: Float32Array, mode: NoiseMode) => {
    assertLive();
    requireLatent(values, schema);
    return backend.submitRaw(values, noiseFor(noise, mode));
  };
  const submitRgba = async (values: Float32Array): Promise<Submitted<Uint8ClampedArray>> => {
    assertLive();
    requireLatent(values, schema);
    if (backend.submitRgba) return backend.submitRgba(values, noise);
    const raw = await backend.submitRaw(values, noise);
    return { done: raw.done.then((r) => toRgba8(r)) };
  };

  const provider: ProviderState = {
    requested: o.requested,
    actual: route,
    admission: 'admitted',
    validation: 'unvalidated',
  };

  let disposing: Promise<void> | null = null;
  const generator: Generator = {
    engine: backend.engine,
    route,
    identity: {
      modelSha256: manifest.modelSourceSha256,
      noiseSha256: manifest.noiseSha256,
      manifestSha256: o.manifestSha256,
      ...(manifest.bundleVersion ? { bundleVersion: manifest.bundleVersion } : {}),
    },
    latent: schema,
    image: { width: FFHQ_SIDE, height: FFHQ_SIDE },
    provider,
    unsupported: o.unsupported,
    assets: [manifest.mapping, manifest.average, ...manifest.noise, ...o.extraAssets].map((a) => ({
      sha256: a.sha256,
      bytes: a.size,
    })),
    loadTrace: trace,

    synthesizeRaw: (values, mode = 'original') =>
      guarded(async () => (await submitRaw(values, mode)).done),

    mappingReady: () => guarded(() => loadMapping()),

    map(
      request: MappingRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<MappingResult> {
      return guarded(async () => {
        aborted(signal);
        if (request.z.length !== schema.zLength || !request.z.every(Number.isFinite))
          throw new TypeError(`Expected finite float32 z [1,${schema.zLength}].`);
        await loadMapping();
        aborted(signal);
        const ort = mappingOrt as OrtModule;
        const startedAtMs = now();
        const input = new ort.Tensor('float32', request.z, [1, schema.zLength]);
        let out: OrtTensor | undefined;
        try {
          out = (await (mapping as OrtSession).run({ z: input }))['w'];
          if (!out) throw Error('Mapping produced no w output');
          const w = new Float32Array((await out.getData()) as Float32Array);
          onTiming?.({
            ids: request.ids,
            operation: 'map',
            stage: 'mapping',
            route: 'cpu',
            startedAtMs,
            completedAtMs: now(),
            boundary: 'readback-complete',
          });
          const values = truncate(
            w,
            average as Float32Array,
            request.truncation.psi,
            request.truncation.cutoff,
            schema,
          );
          // Mapping is ORT WASM on every route; the result records where it actually ran.
          return {
            ids: request.ids,
            wPlus: { space: 'w-plus', shape: [schema.layers, schema.width], values },
            provider: 'cpu',
          };
        } finally {
          input.dispose();
          out?.dispose();
        }
      });
    },

    synthesize(
      request: SynthesisRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<SynthesisResult> {
      return guarded(async () => {
        aborted(signal);
        const values = requireLatent(request.wPlus.values, schema);
        const startedAtMs = now();
        let rgba: Uint8ClampedArray;
        let rawFloat: Float32Array | undefined;
        if (request.output === 'rgba-and-raw-float') {
          rawFloat = await (await submitRaw(values, 'original')).done;
          rgba = toRgba8(rawFloat);
        } else rgba = await (await submitRgba(values)).done;
        onTiming?.({
          ids: request.ids,
          operation: 'synthesize',
          stage: 'synthesis',
          route,
          startedAtMs,
          completedAtMs: now(),
          boundary: backend.boundary,
        });
        aborted(signal);
        return {
          ids: request.ids,
          width: FFHQ_SIDE,
          height: FFHQ_SIDE,
          rgba,
          ...(rawFloat ? { rawFloat } : {}),
          provider: route,
          readiness: {
            pixelsAvailable: true,
            fileReady: false,
            persisted: false,
            displayDecoded: false,
            videoPlayable: 'not-applicable',
          },
        };
      });
    },

    synthesizeSequence(latents, onFace, signal) {
      return guarded(async () => {
        if (!latents.length) return 0;
        for (const v of latents) requireLatent(v, schema);
        let current = await submitRgba(latents[0] as Float32Array);
        for (let i = 0; i < latents.length; i++) {
          let next: Submitted<Uint8ClampedArray> | null = null;
          try {
            aborted(signal);
            // Queue the next face before this one lands, so the GPU is not idle through the conversion.
            next = i + 1 < latents.length ? await submitRgba(latents[i + 1] as Float32Array) : null;
            await onFace(i, await current.done);
          } catch (error) {
            current.done.catch(() => {});
            next?.done.catch(() => {});
            throw error;
          }
          current = next as Submitted<Uint8ClampedArray>;
        }
        return latents.length;
      });
    },

    onLost(listener) {
      lostListeners.push(listener);
    },

    inspect: () => ({
      disposed,
      liveSessions: (mapping ? 1 : 0) + backend.liveResources(),
      backendResources: backend.liveResources(),
      pending: pending.size,
    }),

    dispose() {
      disposing ??= (async () => {
        disposed = true;
        failPending();
        // A load still in flight sees `disposed` and releases its own session.
        await (mappingLoad as Promise<void> | null)?.catch(() => {});
        const m = mapping as OrtSession | null;
        mapping = null;
        await m?.release();
        await backend.dispose();
        o.release?.();
      })();
      return disposing;
    },
  };
  return generator;
}
