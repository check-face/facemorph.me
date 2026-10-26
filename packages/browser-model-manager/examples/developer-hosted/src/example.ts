// Developer-hosted example: browser-model-manager acquires a converted model and the CPU runtime from a
// static origin you host, only after the person has seen and approved the exact bytes; stylegan-js then
// loads from the manager's verified local reader, which never fetches, and synthesizes one image.
//
// Steps, each a separate call so a page can put a person's decision between them:
//   createDeveloperHostedExample(options)  no I/O
//   status()      local storage only: opens OPFS / Cache Storage, reads persistence and quota; no request
//   review()      fetches the two small manifests from your origin and builds the grant: exact digests and bytes
//   authorize()   records the person's approval of that grant; nothing transfers before it
//   acquire()     downloads, verifies and stores the approved assets, with progress; abort() cancels
//   verify()      reads every asset back through the verified local reader (no request)
//   generate()    loads the engine from verified local bytes under leases and synthesizes one image
//   release()     disposes the engine's sessions and releases the leases
//   evict()       removes the model from storage, skipping anything still leased
import { AFHQ_CAT_512_DESCRIPTOR } from 'stylegan-js';
import {
  browserModuleHost,
  cpuRuntimeAssets,
  cpuThreads,
  inputLatent,
  loadCpuGenerator,
  loadOrtRuntime,
  type Generator,
  type GeneratorManifest,
  type LoadedRuntime,
  type LocalAssetReader,
  type NoiseAsset,
} from 'stylegan-js/engine';
import {
  acquisitionMemoryClass,
  createAcquisitionBudget,
  createAcquisitionSlots,
  createLeaseRegistry,
  createLoadedHandle,
  createModelCache,
  evictUnleased,
  grantRemaining,
  openShardStore,
  slotCount,
  storageStatus,
  type AcquisitionGrant,
  type AcquisitionTotals,
  type BlobStore,
  type GrantOwnerId,
  type LoadedModelHandle,
  type ManagerError,
  type ModelCache,
  type Removable,
  type ShardStore,
} from 'browser-model-manager';

const DESCRIPTOR = AFHQ_CAT_512_DESCRIPTOR;
const OWNER: GrantOwnerId = 'face:developer-hosted-example';
/** This app's own Cache Storage namespace for the fallback backend (used when OPFS is unavailable). */
const CACHE_NAME = 'developer-hosted-example-models-v1';

export interface ExampleOptions {
  /** Base URL of the converted model directory on your static origin (its manifest.json and the files it names). */
  readonly modelBase: string;
  /** Base URL of the CPU runtime directory (manifest.json with a `runtime` section, and its files). */
  readonly runtimeBase: string;
  readonly onProgress?: (totals: AcquisitionTotals) => void;
}

/** An asset with the URL it is downloaded from. */
interface Located {
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
  readonly file?: never;
  readonly chunks?: readonly {
    readonly sha256: string;
    readonly size: number;
    readonly url: string;
  }[];
}
type Model = GeneratorManifest & {
  readonly mapping: Located;
  readonly synthesis: Located;
  readonly average: Located;
  readonly noise: readonly (Omit<NoiseAsset, 'file' | 'chunks'> & Located)[];
};
interface Runtime {
  readonly moduleUrl: string;
  readonly assets: readonly Located[];
}
interface Reviewed {
  readonly model: Model;
  readonly modelSha256: string;
  readonly runtime: Runtime;
  readonly assets: readonly Located[];
  readonly grant: AcquisitionGrant;
}

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const digest = async (b: Uint8Array | Uint8ClampedArray) => {
  const copy = new Uint8Array(b.length);
  copy.set(b);
  return hex(await crypto.subtle.digest('SHA-256', copy));
};
const dir = (u: string) => (u.endsWith('/') ? u : `${u}/`);
const fail = (error: unknown) => ({
  ok: false as const,
  error: {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  },
});

export function createDeveloperHostedExample(options: ExampleOptions) {
  const registry = createLeaseRegistry({ locks: navigator.locks });
  let storage: { cache: ModelCache; shards: ShardStore | null; store: BlobStore } | null = null;
  let reviewed: Reviewed | null = null;
  let authorized: AcquisitionGrant | null = null;
  let controller: AbortController | null = null;
  let progress = createAcquisitionBudget();
  let loaded: { handle: LoadedModelHandle; generator: Generator; runtime: LoadedRuntime } | null =
    null;
  const reads: string[] = [];

  /** Opens local storage once: the OPFS shard store if this browser has a working one, and Cache Storage. */
  async function open() {
    if (storage) return storage;
    const shards = await openShardStore(); // null where OPFS cannot be used: Cache Storage holds everything then
    const blobs = await caches.open(CACHE_NAME);
    const key = (hash: string) => new URL(`/__models__/sha256/${hash}`, location.origin).href;
    // Cache.put commits only after the whole (verifying) body has been read, as the BlobStore contract requires.
    const store: BlobStore = {
      get: (hash) => blobs.match(key(hash)),
      put: (hash, response) => blobs.put(key(hash), response),
      remove: (hash) => blobs.delete(key(hash)),
    };
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cache = createModelCache({
      store,
      shards,
      locks: navigator.locks,
      // One aggregate chunk budget for every worker and tab of this origin.
      slots: createAcquisitionSlots({
        locks: navigator.locks,
        count: slotCount(acquisitionMemoryClass(nav.deviceMemory)),
      }),
      report: (event) => progress.cacheEvent(event),
    });
    storage = { cache, shards, store };
    return storage;
  }

  /** Local reads only: no request. */
  async function status() {
    const { cache, shards } = await open();
    const s = await storageStatus(); // reads persistence; asks for it only with { requestPersistence: true }
    const inventory = reviewed
      ? await Promise.all(reviewed.assets.map(async (a) => (await cache.has(a)) as boolean))
      : null;
    return {
      backend: shards ? 'opfs' : 'cache-storage',
      persistence: s.persistence,
      usage: s.usage ?? null,
      quota: s.quota ?? null,
      reviewed: reviewed !== null,
      authorized: authorized !== null,
      stored: inventory ? inventory.filter(Boolean).length : null,
      loaded: loaded !== null,
      leased: registry.leased().length,
    };
  }

  async function fetchJson(url: string) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      json: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      sha256: await digest(bytes),
    };
  }

  /** Reads the two manifests from your origin and builds the grant the person is asked to approve. */
  async function review() {
    try {
      const { cache } = await open();
      const modelUrl = new URL('manifest.json', dir(options.modelBase)).href;
      const m = await fetchJson(modelUrl);
      // model-conv writes each file as a path relative to its manifest; locate each on your origin.
      interface Raw {
        readonly sha256: string;
        readonly size: number;
        readonly file: string;
        readonly chunks?: readonly {
          readonly sha256: string;
          readonly size: number;
          readonly file: string;
        }[];
      }
      const raw = m.json as {
        readonly modelSourceSha256: string;
        readonly noiseSha256: string;
        readonly mapping: Raw;
        readonly synthesis: Raw;
        readonly average: Raw;
        readonly noise: readonly (Raw & {
          readonly name: string;
          readonly shape: readonly number[];
        })[];
      };
      const at = (file: string) => new URL(file, dir(options.modelBase)).href;
      const locate = <T extends Raw>({ file, chunks, ...rest }: T) => ({
        ...rest,
        url: at(file),
        ...(chunks
          ? { chunks: chunks.map((c) => ({ sha256: c.sha256, size: c.size, url: at(c.file) })) }
          : {}),
      });
      const model: Model = {
        modelSourceSha256: raw.modelSourceSha256,
        noiseSha256: raw.noiseSha256,
        mapping: locate(raw.mapping),
        synthesis: locate(raw.synthesis),
        average: locate(raw.average),
        noise: raw.noise.map(locate),
      };
      if (
        model.modelSourceSha256 !== DESCRIPTOR.identity.modelSha256 ||
        model.noiseSha256 !== DESCRIPTOR.identity.noiseSha256
      )
        throw new Error('This manifest is not the model the descriptor names.');
      // The runtime manifest names its files by URL; keep each file's path below `runtime/` on your origin.
      const r = await fetchJson(new URL('manifest.json', dir(options.runtimeBase)).href);
      const onOrigin = (url: string) => {
        const path = new URL(url).pathname;
        const i = path.indexOf('/runtime/');
        return new URL(
          i >= 0 ? path.slice(i + '/runtime/'.length) : path.slice(1),
          dir(options.runtimeBase),
        ).href;
      };
      const product = r.json as { runtime: { moduleUrl: string; assets: Located[] } };
      const runtime: Runtime = {
        moduleUrl: onOrigin(product.runtime.moduleUrl),
        assets: product.runtime.assets.map((a) => ({
          sha256: a.sha256,
          size: a.size,
          url: onOrigin(a.url),
        })),
      };
      const all = [
        ...runtime.assets,
        model.mapping,
        model.synthesis,
        model.average,
        ...model.noise,
      ];
      const assets = [...new Map(all.map((a) => [a.sha256, a])).values()];
      // What is already stored needs no transfer; the grant covers exactly what is missing, never more.
      const missing = await Promise.all(assets.map(async (a) => !(await cache.has(a))));
      const remainingBytes = assets.reduce((n, a, i) => n + (missing[i] ? a.size : 0), 0);
      const grant: AcquisitionGrant = {
        manifestSha256: m.sha256,
        route: 'cpu',
        purpose: 'generate',
        owners: [OWNER],
        assets: assets.map((a) => ({
          sha256: a.sha256,
          bytes: a.size,
          priority: 'foreground-required',
        })),
        remainingBytes,
      };
      reviewed = { model, modelSha256: m.sha256, runtime, assets, grant };
      authorized = null;
      return {
        ok: true as const,
        origin: new URL(options.modelBase).origin,
        assets: assets.length,
        totalBytes: assets.reduce((n, a) => n + a.size, 0),
        remainingBytes,
        grant,
      };
    } catch (error) {
      return fail(error);
    }
  }

  /** The person approved the reviewed grant. */
  function authorize() {
    if (!reviewed) return fail(new Error('Review the download first.'));
    authorized = reviewed.grant;
    return { ok: true as const, remainingBytes: authorized.remainingBytes };
  }

  /** Downloads the approved assets. Without authorize(), acquire() refuses before any request (GrantRefused). */
  async function acquire() {
    if (!reviewed) return fail(new Error('Review the download first.'));
    const { cache } = await open();
    // An unapproved acquisition still goes through the manager, which refuses it: no grant, no transfer.
    const grant: AcquisitionGrant = authorized ?? {
      ...reviewed.grant,
      owners: [],
      remainingBytes: 0,
    };
    progress = createAcquisitionBudget();
    progress.planAsset(reviewed.assets);
    await progress.probe((a) => cache.has(a));
    progress.attach((totals) => options.onProgress?.(totals));
    controller = new AbortController();
    const started = performance.now();
    try {
      for (const asset of reviewed.assets)
        await cache.acquire(asset, { grant, owner: OWNER, signal: controller.signal });
      return {
        ok: true as const,
        ms: performance.now() - started,
        totals: progress.totals(),
        grantRemaining: grantRemaining(grant),
      };
    } catch (error) {
      // A cancelled or failed acquisition spent part of its grant; continuing needs a new review and approval.
      authorized = null;
      return { ...fail(error), totals: progress.totals() };
    } finally {
      controller = null;
    }
  }

  function abort() {
    controller?.abort();
  }

  /** Every asset through the verified local reader: digested on this read, never fetched. */
  async function verify() {
    if (!reviewed) return fail(new Error('Review the download first.'));
    const { cache } = await open();
    const codes: (ManagerError['code'] | 'ok')[] = [];
    for (const asset of reviewed.assets) {
      const r = await cache.local.read(asset);
      codes.push(r.ok ? 'ok' : r.error.code);
    }
    return { ok: true as const, codes, verified: codes.filter((c) => c === 'ok').length };
  }

  /** Loads the engine from verified local bytes under leases and synthesizes one image. */
  async function generate(seed = 0) {
    if (!reviewed) return fail(new Error('Review the download first.'));
    const { cache } = await open();
    const { model, modelSha256, runtime } = reviewed;
    try {
      // The engine reads only through this reader. It has no network path: a missing or changed asset is a
      // typed error here, and the remedy (a new approval and acquisition) is the app's, outside the engine.
      const reader: LocalAssetReader = {
        allowRepair: false,
        read: (asset) => (reads.push(asset.sha256), cache.local.read(asset as Located)),
      };
      const threads = cpuThreads({
        sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hardwareConcurrency: navigator.hardwareConcurrency,
      });
      const ort = await loadOrtRuntime(
        reader,
        cpuRuntimeAssets(runtime),
        browserModuleHost(),
        threads,
      );
      const generator = await loadCpuGenerator({
        reader,
        manifest: model,
        manifestSha256: modelSha256,
        descriptor: DESCRIPTOR,
        ort: async () => ort.ort,
      });
      // The handle leases every asset the engine read, so eviction leaves them alone while it lives.
      const handle = createLoadedHandle({
        manifestSha256: modelSha256,
        capability: generator,
        assets: [
          ...generator.assets,
          ...runtime.assets.map((a) => ({ sha256: a.sha256, bytes: a.size })),
        ],
        registry,
      });
      loaded = { handle, generator, runtime: ort };
      const ids = (name: string) => ({
        requestId: `${name}-${seed}`,
        inputRevision: 1,
        attemptId: 0,
      });
      const started = performance.now();
      const mapped = await handle.capability.map({
        ids: ids('map'),
        z: inputLatent('seed', String(seed), generator.latent).z,
        truncation: DESCRIPTOR.truncation,
      });
      const face = await handle.capability.synthesize({
        ids: ids('synthesize'),
        wPlus: mapped.wPlus,
        output: 'rgba',
      });
      return {
        ok: true as const,
        provider: generator.provider.actual,
        threads,
        width: face.width,
        height: face.height,
        rgba: face.rgba,
        sha256: await digest(face.rgba),
        ms: performance.now() - started,
        leased: registry.leased().length,
        liveSessions: generator.inspect().liveSessions,
      };
    } catch (error) {
      await release();
      return fail(error);
    }
  }

  /** Disposes the engine (pending operations settle with HandleUnavailable) and releases every lease. */
  async function release() {
    const l = loaded;
    loaded = null;
    if (!l) return { ok: true as const, liveSessions: 0, leased: registry.leased().length };
    await l.handle.release();
    l.runtime.release();
    return {
      ok: true as const,
      liveSessions: l.generator.inspect().liveSessions,
      leased: registry.leased().length,
    };
  }

  /** Removes the model from this origin's storage; leased assets (here and in other tabs) are kept. */
  async function evict() {
    if (!reviewed) return fail(new Error('Review the download first.'));
    const { shards, store } = await open();
    const byDigest = new Map(reviewed.assets.map((a) => [a.sha256, a]));
    // Remove one asset by digest: its OPFS units (each chunk is its own file) and any Cache Storage entry.
    const model: Removable = {
      async remove(sha256) {
        const asset = byDigest.get(sha256);
        if (shards && asset)
          for (const unit of asset.chunks ?? [asset]) await shards.remove(unit.sha256);
        await store.remove(sha256);
      },
    };
    const result = await evictUnleased([...byDigest.keys()], [model], registry, navigator.locks);
    return { ok: true as const, removed: result.removed.length, kept: result.kept.length };
  }

  return {
    status,
    review,
    authorize,
    acquire,
    abort,
    verify,
    generate,
    release,
    evict,
    /** Digests the engine read, in order (all through the verified local reader). */
    reads: () => reads.slice(),
  };
}

export type DeveloperHostedExample = ReturnType<typeof createDeveloperHostedExample>;
