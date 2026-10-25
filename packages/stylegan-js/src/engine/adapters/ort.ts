// The onnxruntime-web surface the adapters use, structurally (fm-3h3w). The module is never imported by
// name: in a browser it is imported from the manifest's verified runtime bytes through blob URLs (no
// second, unchecked request), and in Node the caller hands the npm module in. This file is the one place
// a later ORT runtime change touches.

import { readLocal, type EngineAsset, type LocalAssetReader } from '../reader.ts';

export interface OrtTensor {
  getData(): Promise<unknown>;
  dispose(): void;
}
export interface OrtSession {
  readonly inputNames: readonly string[];
  run(
    feeds: Record<string, OrtTensor>,
    fetches?: Record<string, OrtTensor>,
  ): Promise<Record<string, OrtTensor | undefined>>;
  release(): Promise<void>;
}
export interface OrtSessionOptions {
  readonly executionProviders: readonly (
    | string
    | { readonly name: string; readonly device?: unknown }
  )[];
  readonly preferredOutputLocation?: string;
  readonly extra?: Record<string, unknown>;
}
export interface OrtModule {
  readonly Tensor: {
    new (type: 'float32', data: Float32Array, dims: readonly number[]): OrtTensor;
    fromGpuBuffer?(
      buffer: unknown,
      options: { dataType: 'float32'; dims: readonly number[] },
    ): OrtTensor;
  };
  readonly InferenceSession: {
    create(model: Uint8Array, options: OrtSessionOptions): Promise<OrtSession>;
  };
  readonly env: {
    wasm: { numThreads?: number; wasmPaths?: unknown };
    webgpu?: { adapter?: unknown; device?: unknown };
  };
}

/** A runtime bundle as the manifest names it: the ES module, its Emscripten factory and the WASM binary. */
export interface OrtRuntimeAssets {
  readonly module: EngineAsset;
  readonly factory: EngineAsset;
  readonly wasm: EngineAsset;
}

/** The CPU runtime (manifest.runtime): the threaded SIMD build, found by name as ort-worker.mjs ensureOrt() does. */
export function cpuRuntimeAssets(runtime: {
  readonly moduleUrl: string;
  readonly assets: readonly (EngineAsset & { readonly url: string })[];
}): OrtRuntimeAssets {
  const module = runtime.assets.find((a) => a.url === runtime.moduleUrl);
  const factory = runtime.assets.find((a) => a.url.endsWith('/ort-wasm-simd-threaded.mjs'));
  const wasm = runtime.assets.find((a) => a.url.endsWith('/ort-wasm-simd-threaded.wasm'));
  if (!module || !factory || !wasm) throw Error('Incomplete pinned runtime bundle');
  return { module, factory, wasm };
}

/** Blob URLs plus import(), the browser's way to run verified bytes; handed in so Node never needs it. */
export interface ModuleHost {
  url(bytes: Uint8Array, type: string): string;
  revoke(url: string): void;
  import(url: string): Promise<unknown>;
}

export const browserModuleHost = (): ModuleHost => ({
  url: (bytes, type) => URL.createObjectURL(new Blob([bytes as BlobPart], { type })),
  revoke: (url) => URL.revokeObjectURL(url),
  import: (url) => import(/* @vite-ignore */ url),
});

export interface LoadedRuntime {
  readonly ort: OrtModule;
  /** Revokes the runtime's URLs; the module stays usable by sessions already created. */
  release(): void;
}

/**
 * Imports exactly the verified runtime bytes and points ORT's factory and WASM paths at them before any
 * session exists (ORT 1.22 accepts {mjs, wasm}, so the pinned module stays byte-for-byte unchanged).
 */
export async function loadOrtRuntime(
  reader: LocalAssetReader,
  assets: OrtRuntimeAssets,
  host: ModuleHost,
  threads: number,
): Promise<LoadedRuntime> {
  const urls: string[] = [];
  const url = async (asset: EngineAsset, type: string) => {
    const u = host.url(await readLocal(reader, asset), type);
    urls.push(u);
    return u;
  };
  const release = () => {
    for (const u of urls.splice(0)) host.revoke(u);
  };
  try {
    const moduleUrl = await url(assets.module, 'text/javascript');
    const factoryUrl = await url(assets.factory, 'text/javascript');
    const wasmUrl = await url(assets.wasm, 'application/wasm');
    const ort = (await host.import(moduleUrl)) as OrtModule;
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.wasmPaths = { mjs: factoryUrl, wasm: wasmUrl };
    return { ort, release };
  } catch (error) {
    release();
    throw error;
  }
}
