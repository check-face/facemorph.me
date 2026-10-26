// Caller-loaded example (fm-1jr7): stylegan-js with no model manager. The caller loads a model
// capability itself from files it serves (a runtime directory: manifest.json and the assets it names), maps a
// seed, synthesizes it, synthesizes a second face and one interpolated latent through the public map/synthesize
// API, and disposes, reporting progress, honouring abort and settling errors as typed values.
//
// Construction and status reads do no I/O. Every byte the engine reads comes through `createVerifyingReader`
// below: the caller's own fetch of the caller's own URL, verified against the manifest's SHA-256 on every read.
// The library never fetches anything itself.
import { blend, FFHQ_1024_DESCRIPTOR, type LatentTensor } from 'stylegan-js';
import {
  browserModuleHost,
  canaryBundle,
  capabilities,
  cpuRuntimeAssets,
  cpuThreads,
  createCanaryQualification,
  createEngine,
  engineError,
  engineGeometry,
  inputLatent,
  loadCpuGenerator,
  loadOrtRuntime,
  loadOrtWebGpuGenerator,
  supportedRoutes,
  type AdmissionReceipt,
  type CanaryManifest,
  type Engine,
  type EngineAsset,
  type Generator,
  type GeneratorManifest,
  type LoadedRuntime,
  type LocalAssetReader,
  type OrtWebGpuBundle,
  LocalAssetUnavailable,
} from 'stylegan-js/engine';

/** The runtime manifest fields this example reads. */
export type RuntimeManifest = GeneratorManifest &
  CanaryManifest & {
    readonly runtime: {
      readonly moduleUrl: string;
      readonly assets: readonly (EngineAsset & { readonly url: string })[];
    };
    readonly webgpu?: OrtWebGpuBundle;
  };

export type Route = 'cpu' | 'webgpu';

export interface Progress {
  readonly phase: 'manifest' | 'load' | 'qualify' | 'map' | 'synthesize' | 'dispose';
  /** Verified bytes read so far by this demo. */
  readonly bytes: number;
  readonly detail?: string;
}

export interface ReadLogEntry {
  readonly url: string;
  readonly bytes: number;
  readonly ms: number;
}

export type LogLine = Record<string, unknown> & { readonly event: string };

export interface DemoOptions {
  /** Base URL of the runtime directory (manifest.json and the asset tree beside it). */
  readonly runtimeBase: string;
  readonly route?: Route;
  /** Run every admission canary before the first face (default true): CI's full qualification. */
  readonly fullQualification?: boolean;
  /**
   * Where an asset URL from the manifest lives under `runtimeBase`. Default: the path after the manifest URL's
   * `/runtime/` segment (how the published runtime names its assets), else the URL's path.
   */
  readonly locate?: (assetUrl: string) => string;
  readonly onLog?: (line: LogLine) => void;
}

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (b: Uint8Array) =>
  hex(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));

export const defaultLocate = (assetUrl: string): string => {
  const path = new URL(assetUrl).pathname;
  const at = path.indexOf('/runtime/');
  return at >= 0 ? path.slice(at + '/runtime/'.length) : path.replace(/^\/+/, '');
};

/**
 * A LocalAssetReader over the caller's own URLs: each chunk and the whole asset are checked for size and SHA-256
 * on every read; a missing file is 'cache-miss', a wrong one 'corrupt', an aborted read 'aborted'. Small assets
 * (canary samples, indices) are kept in memory after their first verified read.
 */
export function createVerifyingReader(o: {
  readonly base: string;
  readonly locate: (assetUrl: string) => string;
  readonly signal: () => AbortSignal | undefined;
  readonly onRead: (entry: ReadLogEntry) => void;
}): LocalAssetReader {
  const small = new Map<string, Uint8Array>();
  const fail = (code: string, sha: string, message: string) =>
    ({ ok: false, error: { code, sha256: sha, message } }) as const;
  return {
    allowRepair: false,
    async read(asset) {
      const kept = small.get(asset.sha256);
      if (kept) return { ok: true, value: kept } as const;
      const parts = asset.chunks?.length ? asset.chunks : [asset];
      const buffers: Uint8Array[] = [];
      for (const part of parts) {
        const signal = o.signal();
        if (signal?.aborted) return fail('aborted', asset.sha256, 'The read was aborted.');
        if (!part.url) return fail('cache-miss', asset.sha256, `${part.sha256} has no URL`);
        const url = new URL(o.locate(part.url), o.base).href;
        const started = performance.now();
        let bytes: Uint8Array;
        try {
          const res = await fetch(url, signal ? { signal } : {});
          if (!res.ok) return fail('cache-miss', asset.sha256, `${url}: HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch (error) {
          if (signal?.aborted) return fail('aborted', asset.sha256, 'The read was aborted.');
          return fail('cache-miss', asset.sha256, `${url}: ${String(error)}`);
        }
        o.onRead({ url, bytes: bytes.length, ms: performance.now() - started });
        if (bytes.length !== part.size || (await sha256(bytes)) !== part.sha256)
          return fail('corrupt', asset.sha256, `${url} failed verification`);
        buffers.push(bytes);
      }
      let whole = buffers[0] ?? new Uint8Array(0);
      if (buffers.length > 1) {
        whole = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0));
        let at = 0;
        for (const b of buffers) {
          whole.set(b, at);
          at += b.length;
        }
      }
      if (whole.length !== asset.size || (await sha256(whole)) !== asset.sha256)
        return fail('corrupt', asset.sha256, `${asset.sha256} failed verification`);
      if (whole.length <= 1 << 20) small.set(asset.sha256, whole);
      return { ok: true, value: whole } as const;
    },
  };
}

export type Settled<T> =
  | { readonly status: 'completed'; readonly ms: number; readonly value: T }
  | { readonly status: 'cancelled' | 'superseded'; readonly ms: number }
  | {
      readonly status: 'failed';
      readonly ms: number;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface Face {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
  readonly rawFloat?: Float32Array;
  readonly provider: string;
  readonly sha256: string;
}

export interface LoadReport {
  readonly route: Route;
  readonly engine: string;
  readonly provider: string;
  readonly manifestSha256: string;
  readonly threads: number;
  readonly loadMs: number;
  readonly loadTrace: readonly string[];
  readonly receipt: AdmissionReceipt | null;
  readonly qualifyMs: number;
}

export interface RunReport {
  readonly seeds: readonly [string, string];
  readonly mapA: Settled<LatentTensor>;
  readonly mapB: Settled<LatentTensor>;
  readonly faceA: Settled<Face>;
  readonly faceB: Settled<Face>;
  readonly interpolated: Settled<Face>;
}

/** The demo: construct (no I/O), read status (no I/O), load, run, dispose. */
export function createCallerLoadedDemo(options: DemoOptions) {
  const route: Route = options.route ?? 'cpu';
  const locate = options.locate ?? defaultLocate;
  const base = options.runtimeBase.endsWith('/') ? options.runtimeBase : `${options.runtimeBase}/`;
  const log = (line: LogLine) => options.onLog?.(line);
  const reads: ReadLogEntry[] = [];
  let bytesRead = 0;
  let currentSignal: AbortSignal | undefined;
  let onProgress: ((p: Progress) => void) | undefined;
  let phase: Progress['phase'] = 'manifest';
  const progress = (p: Progress['phase'], detail?: string) => {
    phase = p;
    onProgress?.({ phase: p, bytes: bytesRead, ...(detail ? { detail } : {}) });
  };
  const reader = createVerifyingReader({
    base,
    locate,
    signal: () => currentSignal,
    onRead: (entry) => {
      reads.push(entry);
      bytesRead += entry.bytes;
      log({ event: 'read', ...entry });
      onProgress?.({ phase, bytes: bytesRead, detail: entry.url });
    },
  });

  let manifest: RuntimeManifest | null = null;
  let generator: Generator | null = null;
  let engine: Engine | null = null;
  let runtime: LoadedRuntime | null = null;
  let revision = 0;
  const geometry = engineGeometry(
    FFHQ_1024_DESCRIPTOR,
    route === 'cpu' ? 'ort-wasm' : 'ort-webgpu',
  );
  const ids = (name: string) => ({
    requestId: `${name}-${++revision}`,
    inputRevision: revision,
    attemptId: 0,
  });

  /** Pure reads: what this browser and descriptor allow. No request, no storage, no worker. */
  function status() {
    const facts = {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      gpu: 'gpu' in navigator,
    };
    const caps = capabilities(facts);
    return {
      route,
      loaded: engine !== null,
      capabilities: caps,
      supportedRoutes: supportedRoutes(caps),
      threads: cpuThreads({
        sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hardwareConcurrency: navigator.hardwareConcurrency,
      }),
      geometry: { width: geometry.width, height: geometry.height, layers: geometry.latent.layers },
      engineState: engine?.state() ?? null,
      reads: reads.length,
      bytesRead,
    };
  }

  /** Loads the caller's capability: manifest, ORT runtime, generator, then the admission canaries. */
  async function load(o: { signal?: AbortSignal; onProgress?: (p: Progress) => void } = {}) {
    currentSignal = o.signal;
    onProgress = o.onProgress;
    const started = performance.now();
    try {
      progress('manifest');
      const res = await fetch(new URL('manifest.json', base), o.signal ? { signal: o.signal } : {});
      if (!res.ok)
        throw new LocalAssetUnavailable({
          code: 'cache-miss',
          message: `manifest.json: HTTP ${res.status}`,
        });
      const bytes = new Uint8Array(await res.arrayBuffer());
      reads.push({ url: res.url, bytes: bytes.length, ms: performance.now() - started });
      bytesRead += bytes.length;
      const manifestSha256 = await sha256(bytes);
      manifest = JSON.parse(new TextDecoder().decode(bytes)) as RuntimeManifest;
      progress('load');
      const threads = status().threads;
      const host = browserModuleHost();
      const cpuOrt = async () =>
        (runtime ??= await loadOrtRuntime(
          reader,
          cpuRuntimeAssets(manifest!.runtime),
          host,
          threads,
        )).ort;
      const loadStarted = performance.now();
      if (route === 'cpu')
        generator = await loadCpuGenerator({ reader, manifest, manifestSha256, ort: cpuOrt });
      else {
        if (!navigator.gpu) throw Error('WebGPU is not available in this browser.');
        if (!manifest.webgpu) throw Error('The runtime has no WebGPU bundle.');
        generator = await loadOrtWebGpuGenerator({
          reader,
          manifest: manifest as RuntimeManifest & { webgpu: OrtWebGpuBundle },
          manifestSha256,
          gpu: navigator.gpu,
          host,
          cpuOrt,
        });
      }
      await generator.mappingReady();
      const loadMs = performance.now() - loadStarted;
      log({
        event: 'load',
        ms: loadMs,
        engine: generator.engine,
        provider: generator.provider.actual,
      });
      progress('qualify');
      const records = new Map<string, unknown>();
      const g = generator;
      const qualification = createCanaryQualification({
        manifest,
        manifestSha256,
        route: g.route,
        bundle: canaryBundle<unknown>(manifest, g.route, 'ort'),
        records: { get: async (k) => records.get(k), put: async (k, v) => void records.set(k, v) },
        reader,
        synthesizeRaw: (values, noise) => g.synthesizeRaw(values, noise),
        full: options.fullQualification ?? true,
      });
      engine = createEngine({ generator: g, qualification });
      const qStarted = performance.now();
      const receipt = await engine.admit();
      const qualifyMs = performance.now() - qStarted;
      log({
        event: 'qualify',
        ms: qualifyMs,
        ran: receipt?.ran ?? 0,
        checks: receipt?.checks ?? [],
      });
      return {
        ok: true,
        report: {
          route,
          engine: g.engine,
          provider: g.provider.actual,
          manifestSha256,
          threads,
          loadMs,
          loadTrace: g.loadTrace,
          receipt,
          qualifyMs,
        } satisfies LoadReport,
      } as const;
    } catch (error) {
      // Typed, clone-safe: an aborted or missing read is route-failed with the reader's code as the cause.
      const e = engineError(error);
      log({ event: 'load-failed', ms: performance.now() - started, error: e });
      await release();
      return { ok: false, error: e } as const;
    } finally {
      currentSignal = undefined;
    }
  }

  async function map(seed: string, signal?: AbortSignal): Promise<Settled<LatentTensor>> {
    const started = performance.now();
    if (!engine)
      return { status: 'failed', ms: 0, error: { code: 'not-loaded', message: 'Load first.' } };
    let z: Float32Array;
    try {
      z = inputLatent('seed', seed).z;
    } catch (error) {
      return {
        status: 'failed',
        ms: 0,
        error: { code: 'invalid-request', message: String(error) },
      };
    }
    progress('map', seed);
    const s = await engine.map(
      { ids: ids('map'), z, truncation: { psi: 0.7, cutoff: 8 } },
      {
        slot: `map:${seed}`,
        ...(signal ? { signal } : {}),
      },
    );
    const ms = performance.now() - started;
    log({ event: 'map', seed, ms, status: s.status });
    if (s.status === 'completed') return { status: 'completed', ms, value: s.result.wPlus };
    if (s.status === 'failed') return { status: 'failed', ms, error: s.error };
    return { status: s.status, ms };
  }

  async function synthesize(
    wPlus: LatentTensor,
    o: { signal?: AbortSignal; raw?: boolean; slot?: string } = {},
  ): Promise<Settled<Face>> {
    const started = performance.now();
    if (!engine)
      return { status: 'failed', ms: 0, error: { code: 'not-loaded', message: 'Load first.' } };
    progress('synthesize', o.slot);
    const s = await engine.synthesize(
      { ids: ids('synthesize'), wPlus, output: o.raw ? 'rgba-and-raw-float' : 'rgba' },
      { slot: o.slot ?? `synthesize-${revision}`, ...(o.signal ? { signal: o.signal } : {}) },
    );
    const ms = performance.now() - started;
    if (s.status === 'completed') {
      const r = s.result;
      const face: Face = {
        width: r.width,
        height: r.height,
        rgba: r.rgba,
        ...(r.rawFloat ? { rawFloat: r.rawFloat } : {}),
        provider: r.provider,
        sha256: await sha256(new Uint8Array(r.rgba.buffer, r.rgba.byteOffset, r.rgba.byteLength)),
      };
      log({ event: 'synthesize', slot: o.slot, ms, provider: r.provider, sha256: face.sha256 });
      return { status: 'completed', ms, value: face };
    }
    log({
      event: 'synthesize',
      slot: o.slot,
      ms,
      status: s.status,
      ...(s.status === 'failed' ? { error: s.error } : {}),
    });
    if (s.status === 'failed') return { status: 'failed', ms, error: s.error };
    return { status: s.status, ms };
  }

  /** Seed A, seed B and their midpoint in W+, through the public map/synthesize API. */
  async function run(
    o: {
      seeds?: readonly [string, string];
      signal?: AbortSignal;
      onProgress?: (p: Progress) => void;
    } = {},
  ): Promise<RunReport> {
    onProgress = o.onProgress;
    const seeds = o.seeds ?? (['7', '1234'] as const);
    const notRun: Settled<never> = { status: 'cancelled', ms: 0 };
    const mapA = await map(seeds[0], o.signal);
    const faceA =
      mapA.status === 'completed' ? await synthesize(mapA.value, { ...o, slot: 'face-a' }) : notRun;
    const mapB = await map(seeds[1], o.signal);
    const faceB =
      mapB.status === 'completed' ? await synthesize(mapB.value, { ...o, slot: 'face-b' }) : notRun;
    let interpolated: Settled<Face> = notRun;
    if (mapA.status === 'completed' && mapB.status === 'completed') {
      const mid = blend(FFHQ_1024_DESCRIPTOR, [mapA.value, mapB.value], [0.5, 0.5]);
      interpolated = mid.ok
        ? await synthesize(mid.value.latent, { ...o, slot: 'interpolated' })
        : { status: 'failed', ms: 0, error: { code: mid.error.code, message: mid.error.message } };
    }
    return { seeds: [seeds[0], seeds[1]], mapA, mapB, faceA, faceB, interpolated };
  }

  async function release() {
    const e = engine;
    const g = generator;
    engine = null;
    generator = null;
    if (e) await e.dispose();
    else await g?.dispose();
    runtime?.release();
    runtime = null;
  }

  /** Settles anything pending as cancelled, releases sessions, buffers and runtime URLs. */
  async function dispose() {
    const started = performance.now();
    progress('dispose');
    const g = generator;
    await release();
    const inspect = g?.inspect() ?? null;
    log({ event: 'dispose', ms: performance.now() - started, inspect });
    return inspect;
  }

  return {
    status,
    load,
    map,
    synthesize,
    run,
    dispose,
    /** Every verified read this demo made (the caller's own requests). */
    reads: () => reads.slice(),
    manifest: () => manifest,
    /** The live generator, for inspection only. */
    generator: () => generator,
  };
}

export type CallerLoadedDemo = ReturnType<typeof createCallerLoadedDemo>;
