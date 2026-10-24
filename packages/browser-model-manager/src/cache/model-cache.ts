// The model cache: acquisition, verification and storage of pinned model assets in Cache Storage and OPFS shards.
// Moved from the candidate's src/Next/Assets/model-cache.mjs (classic a42829b) without behaviour change (fm-eulc);
// the comments are the candidate's.
import type { ManagerError, Result } from '../contracts/errors.ts';
import type { AssetDescriptor } from '../contracts/manifest.ts';
import { Sha256 } from './sha256.ts';
import {
  browserGlobals,
  openShardStore,
  type ShardStore,
  type StorageLike,
} from './shard-store.ts';

export const MODEL_CACHE_NAME = 'checkface-model-blobs-v1'; // Never app-versioned or age-purged.

/** An asset as a manifest pins it: lowercase SHA-256, exact size, HTTPS URL, optional chunks. */
export interface AssetInput {
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
  readonly chunks?: readonly AssetInput[] | undefined;
}
export interface Asset {
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
  readonly chunks?: readonly Asset[];
}
/** What observers see: hashes and status only (no URLs or authentication material). */
export interface CacheEvent {
  readonly status: string;
  readonly sha256: string;
  readonly [field: string]: unknown;
}
/** Store contract: get(hash) -> fresh Response|undefined; put(hash, Response) MUST consume the stream and commit
 * atomically only after successful EOF; remove(hash) removes only that corrupt identity. */
export interface BlobStore {
  get(hash: string): Promise<Response | undefined>;
  put(hash: string, response: Response): Promise<void>;
  remove(hash: string): Promise<unknown>;
}
export interface LockManagerLike {
  request<T>(name: string, run: () => Promise<T>): Promise<T>;
  request<T>(name: string, options: { signal: AbortSignal }, run: () => Promise<T>): Promise<T>;
}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface ModelCacheOptions {
  readonly store: BlobStore;
  readonly shards?: ShardStore | null | undefined;
  readonly fetcher?: Fetcher | undefined;
  readonly locks?: LockManagerLike | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly readAhead?: number | undefined;
  readonly retryDelaysMs?: readonly number[] | undefined;
  readonly mirrorOf?: ((url: string) => string | undefined) | undefined;
  readonly report?: ((event: CacheEvent) => void) | undefined;
}
export interface AssetHandle {
  readonly sha256: string;
  readonly size: number;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  open(): Promise<Response>;
}
/** Verified local bytes only: never a fetch, never a repair (contracts/lifecycle.ts VerifiedLocalReader). */
export interface LocalReader {
  readonly allowRepair: false;
  read(asset: AssetDescriptor): Promise<Result<Uint8Array<ArrayBuffer>, ManagerError>>;
}
export interface ModelCache {
  /** Verified local reads with typed misses (fm-eulc). */
  readonly local: LocalReader;
  acquire(input: AssetInput, options?: { signal?: AbortSignal | undefined }): Promise<AssetHandle>;
  readonly records: RecordAccess;
  has(input: AssetInput | string): Promise<boolean>;
  peek(input: AssetInput | string): Promise<Response | null>;
}

type Err = Error & { status?: number; transient?: boolean; reload?: boolean };
const aborted = () => new DOMException('Asset acquisition cancelled', 'AbortError');
/** Why a local-only read has no bytes; the message stays the candidate's. */
type Local = 'absent' | 'corrupt';
const localError = (message: string, local: Local) => Object.assign(new Error(message), { local });
const check = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw signal.reason || aborted();
};

export function validateAsset(asset: AssetInput): Asset {
  if (
    !asset ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 0
  )
    throw new TypeError('Asset requires lowercase SHA-256 and exact nonnegative byte size');
  const url = new URL(asset.url);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new TypeError('Asset acquisition requires an HTTPS URL without embedded credentials');
  let chunks: readonly Asset[] | undefined;
  if (asset.chunks !== undefined) {
    if (!Array.isArray(asset.chunks) || !asset.chunks.length || asset.chunks.length > 256)
      throw new TypeError('Invalid asset chunks');
    chunks = asset.chunks.map((part) => {
      if (part.chunks !== undefined || part.size <= 0 || part.size > 16 * 1024 * 1024)
        throw new TypeError('Invalid asset chunk');
      return validateAsset(part);
    });
    if (chunks.reduce((sum, part) => sum + part.size, 0) !== asset.size)
      throw new TypeError('Asset chunk sizes do not match');
    Object.freeze(chunks);
  }
  return Object.freeze({
    sha256: asset.sha256,
    size: asset.size,
    url: url.href,
    ...(chunks ? { chunks } : {}),
  });
}

const PIECE_BYTES = 256 * 1024;
const SHARD_UNIT_LIMIT = 64 * 1024 * 1024; // unchunked assets above this stay in Cache Storage
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (x) => x.toString(16).padStart(2, '0')).join('');
/** A non-200 answer; `transient` marks the statuses worth asking again (server faults, rate limits).
 * The message is shown to the visitor as it is, so it says what happened and what to do. Model files are immutable
 * and named by digest, so one that is gone (404, 410) belongs to a version the site no longer serves: an open tab
 * that loaded before an update asks for it. That is not retried and no other digest is tried in its place; `reload`
 * tells the page the remedy is a reload, which loads the current version (fm-fy2.14). */
function downloadRefused(response: Response): Err {
  void response.body?.cancel().catch(() => {});
  const status = response.type === 'opaque' ? 'opaque response' : `HTTP ${response.status}`;
  const transient = response.status >= 500 || response.status === 429 || response.status === 408;
  const reload = response.status === 404 || response.status === 410;
  const error = new Error(
    transient
      ? `The model download server had a temporary fault (${status}). Parts already downloaded are kept: try again in a few minutes.`
      : reload
        ? `A model file could not be downloaded (${status}): this page is older than the site, which has been updated since it loaded. Reload the page to continue.`
        : `A model file could not be downloaded (${status}).`,
  );
  return Object.assign(error, { status: response.status, transient, reload });
}
// 20 October: one Cloudflare edge answered HTTP 500 for a single 9 MB encoder chunk for twenty-five
// minutes (part-033, then part-091; the same files were 200 everywhere else), and every attempt
// failed the whole photo on that one chunk out of a hundred. A server fault or a dropped connection
// is asked again after a pause, under a fresh query string so neither the browser nor the edge
// replays the bad answer. When a mirror is known (models.facemorph.me, R2: separate storage), every
// other retry goes there instead, and any failure of the mirror just moves on to the next attempt.
// Bytes are checked against the pin wherever they come from, so a retry cannot admit wrong ones.
export const CHUNK_RETRY_DELAYS_MS: readonly number[] = Object.freeze([1000, 4000, 10000, 20000]);
const retryable = (error: unknown) =>
  (error as Err | null)?.transient === true || error instanceof TypeError; // fetch reports a dropped connection as TypeError
const pauseFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      reject(signal.reason || aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', done);
      resolve();
    }, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
type Download = (part: Asset, signal: AbortSignal) => Promise<ReadableStream<Uint8Array> | null>;
async function fetchVerifiedChunk(
  part: Asset,
  download: Download,
  signal: AbortSignal,
  delays: readonly number[] = CHUNK_RETRY_DELAYS_MS,
  mirrorOf: (url: string) => string | undefined = () => undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const mirror = mirrorOf(part.url);
  let first: unknown;
  for (let attempt = 0; ; attempt++) {
    const fromMirror = Boolean(mirror) && attempt % 2 === 1;
    try {
      const url = fromMirror
        ? (mirror as string)
        : attempt
          ? Object.assign(new URL(part.url), { search: `retry=${attempt}` }).href
          : part.url;
      return await fetchChunkOnce(attempt ? { ...part, url } : part, download, signal);
    } catch (error) {
      check(signal);
      first ??= error; // the site's own answer is the one worth reporting
      if (attempt >= delays.length || !(fromMirror || retryable(error)))
        throw fromMirror ? first : error;
      await pauseFor(delays[attempt]!, signal);
    }
  }
}
/** The mirror copy of a same-origin runtime file on a facemorph.me page; none elsewhere (local, native, tests). */
export const RUNTIME_MIRROR = 'https://models.facemorph.me';
export function runtimeMirror(
  location: { hostname?: string; origin?: string } | undefined = browserGlobals.location,
): (url: string) => string | undefined {
  return (url) => {
    const page = location?.hostname || '';
    const target = new URL(url);
    if (
      !(page === 'facemorph.me' || page.endsWith('.facemorph.me')) ||
      target.origin !== location?.origin ||
      !target.pathname.startsWith('/runtime/')
    )
      return undefined;
    return RUNTIME_MIRROR + target.pathname;
  };
}
/** One pinned chunk, fully read into a buffer of exactly its declared size and checked by the platform digest. */
async function fetchChunkOnce(
  part: Asset,
  download: Download,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = await download(part, signal);
  if (!body) throw new Error('Asset response has no readable body');
  const out = new Uint8Array(part.size);
  const reader = body.getReader();
  let at = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      check(signal);
      if (done) break;
      if (at + value.byteLength > part.size) throw new Error('Asset exceeds declared size');
      out.set(value, at);
      at += value.byteLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  }
  if (at !== part.size) throw new Error('Asset integrity mismatch');
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', out));
  check(signal);
  if (digest !== part.sha256) throw new Error('Asset integrity mismatch');
  return out;
}
// Runs with backpressure; errors before EOF prevent Cache.put from committing.
function verifiedStream(
  body: ReadableStream<Uint8Array> | null,
  asset: Asset,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  if (!body) throw new Error('Asset response has no readable body');
  const reader = body.getReader();
  const hash = new Sha256();
  let size = 0;
  let terminal = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => {
    terminal = true;
    signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    if (terminal) return;
    const reason = signal.reason || aborted();
    cleanup();
    streamController.error(reason);
    void reader.cancel(reason).catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        check(signal);
        const { value, done } = await reader.read();
        check(signal);
        if (done) {
          if (size !== asset.size || hash.hex() !== asset.sha256)
            throw new Error('Asset integrity mismatch');
          cleanup();
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > asset.size) throw new Error('Asset exceeds declared size');
        hash.update(value);
        controller.enqueue(value);
      } catch (error) {
        if (!terminal) {
          cleanup();
          controller.error(error);
        }
        void reader.cancel(error).catch(() => {});
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
}
/**
 * Counts bytes on their way past so an observer can drive a real progress bar. The 158 MB
 * asset used to report {loaded:0} and then {loaded:size}: the bar sat at zero for minutes and
 * then jumped. Ticks are coalesced so a large download costs a bounded number of events.
 */
export const PROGRESS_INTERVAL_BYTES = 1024 * 1024;
function counted(
  body: ReadableStream<Uint8Array>,
  asset: Asset,
  emit: (event: CacheEvent) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let seen = 0;
  let announced = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen - announced >= PROGRESS_INTERVAL_BYTES) {
        announced = seen;
        emit({
          status: 'progress',
          sha256: asset.sha256,
          loaded: Math.min(seen, asset.size),
          bytes: asset.size,
        });
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export interface RecordAccess {
  get(key: string): Promise<Record<string, unknown> | undefined>;
  put(key: string, record: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
/**
 * Small JSON records sharing the asset store's namespace but keyed by their own identity rather
 * than asset bytes: verified-asset markers (C-05) and canary qualification records (C-03). A
 * record that fails to parse or read is dropped, never fatal — the caller re-proves instead.
 */
export function createRecordAccess(store: BlobStore): RecordAccess {
  return {
    async get(key) {
      try {
        const response = await store.get(key);
        if (!response) return undefined;
        const record: unknown = await response.json();
        return record && typeof record === 'object'
          ? (record as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    },
    async put(key, record) {
      await store.put(
        key,
        new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json' } }),
      );
    },
    async remove(key) {
      await store.remove(key);
    },
  };
}

interface Task {
  readonly run: () => Promise<void>;
  readonly signal: AbortSignal;
  readonly resolve: (value: void) => void;
  readonly reject: (reason: unknown) => void;
  readonly cancel: () => void;
}
interface Pending {
  readonly asset: Asset;
  readonly controller: AbortController;
  waiters: number;
  promise: Promise<void>;
}

/** Store contract: get(hash) -> fresh Response|undefined; put(hash, Response)
 * MUST consume the stream and commit atomically only after successful EOF;
 * remove(hash) removes only that corrupt identity. Never expose partial writes.
 * Observers receive hashes/status only (no URLs or authentication material).
 */
export function createModelCache({
  store,
  shards = null,
  fetcher = globalThis.fetch,
  locks,
  timeoutMs = 300000,
  maxConcurrent = 2,
  readAhead = 2,
  retryDelaysMs = CHUNK_RETRY_DELAYS_MS,
  mirrorOf = () => undefined,
  report = () => {},
}: ModelCacheOptions): ModelCache {
  if (
    !store ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    !Number.isInteger(readAhead) ||
    readAhead < 1 ||
    readAhead > 8
  )
    throw new TypeError('Invalid cache settings');
  const pending = new Map<string, Pending>();
  const queue: Task[] = [];
  let active = 0;
  // Identities this cache has seen stored (saved, retained, or read locally): an absent one is then evicted.
  const stored = new Set<string>();
  const emit = (event: CacheEvent) => {
    if (event.status === 'saved' || event.status === 'retained') stored.add(event.sha256);
    try {
      report(event);
    } catch {
      /* observers cannot break storage */
    }
  };
  const records = createRecordAccess(store);
  async function fetchBody(part: Asset, signal: AbortSignal) {
    const response = await fetcher(part.url, {
      signal,
      credentials: 'omit',
      cache: 'default',
      mode: 'cors',
    });
    check(signal);
    if (!response.ok || response.status !== 200 || response.type === 'opaque')
      throw downloadRefused(response);
    return response.body;
  }
  // ---- Shard store (OPFS) -------------------------------------------------------------------
  // Each pinned unit (a manifest chunk, or a small unchunked asset) is its own file, and every
  // read digests every unit with the platform SHA-256 against the manifest's pin. There is no
  // verified marker of any kind: what vouches for bytes is a hash of those bytes, taken when they
  // are handed out. Measured on eris (autoresearch/candidates/opfs-shard-cache-v1) this replaces
  // a JS hash of the whole asset plus a second full read; a bad unit costs one unit's re-fetch.
  // The whole-asset digest is not recomputed: the chunk list comes from the same pinned manifest
  // as the whole digest, so every byte is already bound to it through its chunk.
  const usesShards = (asset: Asset) =>
    Boolean(shards) && Boolean(asset.chunks || asset.size <= SHARD_UNIT_LIMIT);
  const unitsOf = (asset: Asset): readonly Asset[] => asset.chunks || [asset];
  const platformHex = async (bytes: Uint8Array<ArrayBuffer>) =>
    hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const underLock = <T>(name: string, run: () => Promise<T>): Promise<T> =>
    locks?.request ? locks.request(`${MODEL_CACHE_NAME}:${name}`, run) : run();
  async function commitUnit(asset: Asset, unit: Asset, bytes: Uint8Array) {
    try {
      await shards!.write(unit.sha256, bytes);
    } catch (error) {
      emit({
        status:
          (error as Err | null)?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'save-failed',
        sha256: asset.sha256,
      });
      throw error;
    }
  }
  // Bounded-concurrency map over units, in order of index; the first failure stops new work.
  async function eachUnit(
    list: readonly Asset[],
    limit: number,
    run: (unit: Asset, i: number) => Promise<void>,
  ) {
    let next = 0;
    let failure: unknown;
    const lane = async () => {
      while (next < list.length && !failure) {
        const i = next++;
        try {
          await run(list[i]!, i);
        } catch (error) {
          failure ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, lane));
    if (failure) throw failure;
  }
  // Bytes saved by the Cache Storage backend move across without a download: each unit is
  // checked against its pin on the way, and the old entry is dropped once every unit is in place
  // (keeping both would double the quota the model takes, which iOS does not have to spare).
  async function migrateLegacy(asset: Asset, missing: readonly Asset[], signal: AbortSignal) {
    let response: Response | undefined;
    try {
      response = await store.get(asset.sha256);
    } catch {
      return;
    }
    if (!response?.body) return;
    const wanted = new Set(missing.map((unit) => unit.sha256));
    const reader = response.body.getReader();
    let index = 0;
    let unit: Asset | undefined = unitsOf(asset)[0];
    let buffer: Uint8Array<ArrayBuffer> | null = new Uint8Array(unit!.size);
    let at = 0;
    let moved = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        check(signal);
        if (done) break;
        let offset = 0;
        while (offset < value.byteLength && unit) {
          const take = Math.min(unit.size - at, value.byteLength - offset);
          buffer!.set(value.subarray(offset, offset + take), at);
          at += take;
          offset += take;
          if (at === unit.size) {
            if (wanted.has(unit.sha256) && (await platformHex(buffer!)) === unit.sha256) {
              await commitUnit(asset, unit, buffer!);
              moved++;
            }
            unit = unitsOf(asset)[++index];
            at = 0;
            buffer = unit ? new Uint8Array(unit.size) : null;
          }
        }
        if (!unit) break;
      }
    } catch (error) {
      if (signal.aborted) throw error;
    } finally {
      // a broken old entry is not fatal: download what is left
      void reader.cancel().catch(() => {});
    }
    if (moved) emit({ status: 'migrated', sha256: asset.sha256, units: moved });
    return moved;
  }
  async function missingUnits(asset: Asset): Promise<Asset[]> {
    const out: Asset[] = [];
    for (const unit of unitsOf(asset))
      if (!(await shards!.has(unit.sha256, unit.size))) out.push(unit);
    return out;
  }
  async function ensureShards(asset: Asset, signal: AbortSignal) {
    let missing = await missingUnits(asset);
    check(signal);
    if (!missing.length) {
      emit({ status: 'retained', sha256: asset.sha256, bytes: asset.size });
      return;
    }
    // Migration is local: it announces nothing until it is known that the network is needed.
    if (await migrateLegacy(asset, missing, signal)) {
      missing = await missingUnits(asset);
      if (!missing.length) {
        void Promise.resolve(store.remove(asset.sha256)).catch(() => {});
        emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size });
        return;
      }
    }
    check(signal);
    emit({ status: 'missing', sha256: asset.sha256 });
    emit({ status: 'downloading', sha256: asset.sha256 });
    let loaded = asset.size - missing.reduce((sum, unit) => sum + unit.size, 0);
    const stop = new AbortController();
    const relay = () => stop.abort(signal.reason || aborted());
    signal.addEventListener('abort', relay, { once: true });
    try {
      await eachUnit(missing, readAhead, async (unit) => {
        try {
          await commitUnit(
            asset,
            unit,
            await fetchVerifiedChunk(unit, fetchBody, stop.signal, retryDelaysMs, mirrorOf),
          );
        } catch (error) {
          stop.abort(error);
          throw error;
        }
        loaded += unit.size;
        emit({ status: 'progress', sha256: asset.sha256, loaded, bytes: asset.size });
      });
    } finally {
      signal.removeEventListener('abort', relay);
    }
    check(signal);
    void Promise.resolve(store.remove(asset.sha256)).catch(() => {}); // a partly migrated old entry is no longer needed
    emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size });
  }
  // Every unit read is digested against its pin, every time. A unit that is absent, uncommitted or
  // wrong is removed and fetched again on its own, under the same lock that guards its writes.
  async function readShards(
    asset: Asset,
    { allowRepair }: { allowRepair: boolean },
  ): Promise<Uint8Array<ArrayBuffer>> {
    const units = unitsOf(asset);
    const out = units.length === 1 ? null : new Uint8Array(asset.size);
    const offsets: number[] = [];
    units.reduce((at, unit) => {
      offsets.push(at);
      return at + unit.size;
    }, 0);
    let single: Uint8Array<ArrayBuffer> | undefined;
    await eachUnit(units, 4, async (unit, i) => {
      let bytes = await shards!.read(unit.sha256, unit.size);
      if (!bytes || (await platformHex(bytes)) !== unit.sha256) {
        emit({ status: bytes ? 'corrupt-removed' : 'missing-after-acquire', sha256: asset.sha256 });
        if (!allowRepair)
          throw bytes
            ? localError('Asset integrity mismatch', 'corrupt')
            : localError('Stored asset disappeared; acquire again', 'absent');
        emit({ status: 'repairing', sha256: asset.sha256 });
        bytes = await underLock(unit.sha256, async () => {
          const again = await shards!.read(unit.sha256, unit.size); // another tab may have repaired it
          if (again && (await platformHex(again)) === unit.sha256) return again;
          await shards!.remove(unit.sha256);
          const fresh = await fetchVerifiedChunk(
            unit,
            fetchBody,
            AbortSignal.timeout(timeoutMs),
            retryDelaysMs,
            mirrorOf,
          );
          await commitUnit(asset, unit, fresh).catch(() => {}); // the verified bytes are served even if saving fails
          return fresh;
        });
      }
      if (out) out.set(bytes, offsets[i]);
      else single = bytes;
    });
    return out || single!;
  }
  // C-05, amended 19 September: the digest of an asset is computed at most once per session.
  // Bytes verified on download (or on first open of bytes stored earlier) carry the in-memory
  // mark; the marker is deliberately NOT durable any more — a durable marker vouches for bytes
  // it cannot see change underneath, and a stale marker served corrupt bytes on iOS 27 Safari
  // and Android Chrome 124. Cost of the fix: one hash per asset per session instead of one per
  // bundle version; correctness outranks the saving. Old durable markers are deleted whenever
  // the identity is touched (openVerified cleanup).
  const VERIFIED_MARKER = 'verified:';
  const verifiedAssets = new Set<string>();
  const markVerified = (sha256: string) => {
    verifiedAssets.add(sha256);
  };
  const pump = () => {
    while (active < maxConcurrent && queue.length) {
      const task = queue.shift()!;
      if (task.signal.aborted) {
        task.reject(task.signal.reason || aborted());
        continue;
      }
      task.signal.removeEventListener('abort', task.cancel);
      active++;
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  const schedule = (run: () => Promise<void>, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const task: Task = {
        run,
        signal,
        resolve,
        reject,
        cancel: () => {
          const index = queue.indexOf(task);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason || aborted());
        },
      };
      check(signal);
      queue.push(task);
      signal.addEventListener('abort', task.cancel, { once: true });
      pump();
    });
  async function ensure(asset: Asset, signal: AbortSignal): Promise<void> {
    check(signal);
    if (usesShards(asset)) return ensureShards(asset, signal);
    let cached: Response | undefined;
    try {
      cached = await store.get(asset.sha256);
    } catch (error) {
      emit({ status: 'storage-unavailable', sha256: asset.sha256 });
      throw error;
    }
    check(signal);
    if (cached) {
      // C-05: a retained asset is not re-hashed here — that streamed every byte through JS
      // hashing on every session for files already verified when written. Integrity is
      // enforced where it is consumed: open() verifies once per asset identity (see below).
      emit({ status: 'retained', sha256: asset.sha256, bytes: asset.size });
      return;
    } else emit({ status: 'missing', sha256: asset.sha256 }); // Missing alone does not prove eviction.
    check(signal);
    emit({ status: 'downloading', sha256: asset.sha256 });
    async function download(part: Asset, from: AbortSignal = signal) {
      const response = await fetcher(part.url, {
        signal: from,
        credentials: 'omit',
        cache: 'default',
        mode: 'cors',
      });
      check(from);
      if (!response.ok || response.status !== 200 || response.type === 'opaque')
        throw downloadRefused(response);
      return response.body;
    }
    let body: ReadableStream<Uint8Array> | null;
    const chunks = asset.chunks;
    if (chunks && globalThis.crypto?.subtle) {
      // Read-ahead (measured on eris, 150 MiB model prefix): chunks fetched one at a time and hashed in
      // JS twice cost 6.8 s of a cold first face, against a link ceiling of 2.7 s with four in flight.
      // Up to `readAhead` 16 MiB chunks are fetched into memory concurrently; each is checked against
      // its pinned digest by the platform's SHA-256 (8x the speed of sha256.mjs, off this thread) and
      // handed on strictly in order. Memory is bounded by readAhead chunks. The whole-asset digest
      // below is unchanged, and nothing commits until it matches at EOF.
      const ahead: Promise<Uint8Array<ArrayBuffer>>[] = [];
      const stop = new AbortController();
      const relay = () => stop.abort(signal.reason || aborted());
      signal.addEventListener('abort', relay, { once: true });
      const release = (reason?: unknown) => {
        signal.removeEventListener('abort', relay);
        if (reason !== undefined) stop.abort(reason);
      };
      let started = 0;
      const fill = () => {
        while (ahead.length < readAhead && started < chunks.length) {
          const part = chunks[started++]!;
          const task = fetchVerifiedChunk(part, download, stop.signal, retryDelaysMs, mirrorOf);
          task.catch(() => {}); // surfaced where it is awaited; a later chunk must not become an unhandled rejection
          ahead.push(task);
        }
      };
      body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            check(signal);
            fill();
            if (!ahead.length) {
              release();
              controller.close();
              return;
            }
            const chunk = await ahead.shift()!;
            check(signal);
            fill();
            // Network-sized views, not the whole 16 MiB buffer: Firefox failed the first read-ahead build with a
            // NetworkError (caught by the pre-deploy engine matrix), and the progress bar would move in 16 MiB
            // steps. Views share the buffer, so this copies nothing.
            for (let at = 0; at < chunk.byteLength; at += PIECE_BYTES)
              controller.enqueue(chunk.subarray(at, Math.min(at + PIECE_BYTES, chunk.byteLength)));
          } catch (error) {
            release(error);
            controller.error(error);
          }
        },
        cancel(reason) {
          release(reason ?? aborted());
        },
      });
    } else if (chunks) {
      // No platform digest (very old engines): one chunk at a time, hashed incrementally as before.
      let index = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            check(signal);
            while (true) {
              if (!reader) {
                if (index === chunks.length) {
                  controller.close();
                  return;
                }
                const part = chunks[index++]!;
                reader = verifiedStream(await download(part), part, signal).getReader();
              }
              const result = await reader.read();
              if (result.done) {
                reader.releaseLock();
                reader = undefined;
                continue;
              }
              controller.enqueue(result.value);
              return;
            }
          } catch (error) {
            controller.error(error);
            await reader?.cancel(error).catch(() => {});
          }
        },
        cancel(reason) {
          return reader?.cancel(reason);
        },
      });
    } else body = await download(asset);
    const verified = new Response(verifiedStream(counted(body!, asset, emit), asset, signal), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(asset.size),
        'X-CheckFace-SHA256': asset.sha256,
      },
    });
    try {
      await store.put(asset.sha256, verified);
    } catch (error) {
      // A backend can reject before consuming (e.g. quota); cancel the unconsumed network stream.
      if (verified.body && !verified.body.locked) await verified.body.cancel(error).catch(() => {});
      emit({
        status:
          (error as Err | null)?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'save-failed',
        sha256: asset.sha256,
      });
      throw error;
    }
    // A cancellation at commit may leave a fully verified blob: retain it for a later request.
    emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size });
    check(signal);
    // The bytes just committed were verified stream-incrementally; record that once (C-05).
    markVerified(asset.sha256);
  }
  // open(): bytes stored by THIS session were verified at write time and are returned as-is.
  // Anything else is hashed on first open of the session — the durable verified marker was
  // removed 19 September because it vouched for bytes it could not see change underneath
  // (a stale marker served corrupt bytes on iOS 27 Safari and Android Chrome 124; see the
  // mobile suite's corrupt-cache-repair check). A first-open mismatch, or a vanished entry,
  // is repaired once: the bad identity is removed and re-acquired before bytes are handed
  // back. Model bytes never buffer whole in JS: pass 1 hashes the stored stream, pass 2
  // returns a fresh store read.
  async function digestFailure(
    body: ReadableStream<Uint8Array> | null,
    asset: Asset,
  ): Promise<Error | null> {
    if (!body) return new Error('Asset response has no readable body');
    const reader = body.getReader();
    const hash = new Sha256();
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > asset.size) {
        void reader.cancel(new Error('Asset exceeds declared size')).catch(() => {});
        return new Error('Asset exceeds declared size');
      }
      hash.update(value);
    }
    if (size !== asset.size || hash.hex() !== asset.sha256)
      return new Error('Asset integrity mismatch');
    return null;
  }
  async function openVerified(
    asset: Asset,
    { allowRepair }: { allowRepair: boolean },
  ): Promise<Response> {
    let response: Response | undefined;
    try {
      response = await store.get(asset.sha256);
    } catch (error) {
      emit({ status: 'storage-unavailable', sha256: asset.sha256 });
      throw error;
    }
    if (!response) {
      emit({ status: 'missing-after-acquire', sha256: asset.sha256 });
      if (!allowRepair) throw localError('Stored asset disappeared; acquire again', 'absent');
      emit({ status: 'repairing', sha256: asset.sha256 });
      await ensure(asset, new AbortController().signal);
      return openVerified(asset, { allowRepair: false });
    }
    if (verifiedAssets.has(asset.sha256)) return response;
    // A stored body that cannot be read (NotReadableError: Android Chrome loses the file behind a
    // Cache Storage entry) is corrupt like a wrong digest, and is repaired the same way.
    const failure = await digestFailure(response.body, asset).catch((error: Error) => error);
    if (!failure) {
      markVerified(asset.sha256);
      emit({ status: 'verified', sha256: asset.sha256, bytes: asset.size });
      return (await store.get(asset.sha256))!;
    }
    // Corrupt: drop the identity and its record, then repair once.
    verifiedAssets.delete(asset.sha256);
    await Promise.resolve(store.remove(asset.sha256)).catch(() => {});
    await records.remove(VERIFIED_MARKER + asset.sha256).catch(() => {});
    emit({ status: 'corrupt-removed', sha256: asset.sha256 });
    if (!allowRepair) throw Object.assign(failure, { local: 'corrupt' as const });
    emit({ status: 'repairing', sha256: asset.sha256 });
    await ensure(asset, new AbortController().signal);
    return openVerified(asset, { allowRepair: false });
  }
  // Bytes verified earlier this session are handed back without a second digest, so a file that
  // became unreadable since is only found here: drop the identity and repair it once.
  async function readVerified(asset: Asset): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return new Uint8Array(await (await openVerified(asset, { allowRepair: true })).arrayBuffer());
    } catch (error) {
      if ((error as Err | null)?.name !== 'NotReadableError') throw error;
      verifiedAssets.delete(asset.sha256);
      await Promise.resolve(store.remove(asset.sha256)).catch(() => {});
      emit({ status: 'corrupt-removed', sha256: asset.sha256 });
      emit({ status: 'repairing', sha256: asset.sha256 });
      await ensure(asset, new AbortController().signal);
      return new Uint8Array(
        await (await openVerified(asset, { allowRepair: false })).arrayBuffer(),
      );
    }
  }
  function acquire(
    input: AssetInput,
    { signal }: { signal?: AbortSignal | undefined } = {},
  ): Promise<AssetHandle> {
    let asset: Asset;
    try {
      asset = validateAsset(input);
      check(signal);
    } catch (error) {
      return Promise.reject(error);
    }
    let task = pending.get(asset.sha256);
    if (task && task.asset.size !== asset.size)
      return Promise.reject(new Error('Conflicting size for identical hash'));
    if (!task) {
      const controller = new AbortController();
      const current: Pending = { asset, controller, waiters: 0, promise: Promise.resolve() };
      task = current;
      const timer = setTimeout(
        () => controller.abort(new DOMException('Asset acquisition timed out', 'TimeoutError')),
        timeoutMs,
      );
      current.promise = schedule(
        () =>
          locks?.request
            ? locks.request(
                `${MODEL_CACHE_NAME}:${asset.sha256}`,
                { signal: controller.signal },
                () => ensure(asset, controller.signal),
              )
            : ensure(asset, controller.signal),
        controller.signal,
      ).finally(() => {
        clearTimeout(timer);
        if (pending.get(asset.sha256) === current) pending.delete(asset.sha256);
      });
      pending.set(asset.sha256, current);
    }
    const shared = task;
    shared.waiters++;
    return new Promise<AssetHandle>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        shared.waiters--;
        if (error) reject(error);
        else if (usesShards(asset))
          resolve(
            Object.freeze({
              sha256: asset.sha256,
              size: asset.size,
              bytes: () => readShards(asset, { allowRepair: true }),
              open: async () => new Response(await readShards(asset, { allowRepair: true })),
            }),
          );
        else
          resolve(
            Object.freeze({
              sha256: asset.sha256,
              size: asset.size,
              bytes: () => readVerified(asset),
              open: async () => openVerified(asset, { allowRepair: true }),
            }),
          );
      };
      const cancel = () => {
        finish(signal!.reason || aborted());
        if (shared.waiters === 0) {
          shared.controller.abort(aborted());
          if (pending.get(asset.sha256) === shared) pending.delete(asset.sha256);
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      shared.promise.then(() => finish(), finish);
      if (signal?.aborted) cancel();
    });
  }
  // Both take an asset descriptor (or, for Cache Storage only, a bare hash). Bytes still in the
  // old Cache Storage entry count as present: the next acquisition moves them without a download.
  async function has(input: AssetInput | string): Promise<boolean> {
    const asset = typeof input === 'string' ? null : (input as Asset);
    const sha256 = asset ? asset.sha256 : (input as string);
    if (asset && usesShards(asset) && !(await missingUnits(asset).catch(() => [asset])).length)
      return true;
    try {
      return Boolean(await store.get(sha256));
    } catch {
      return false;
    }
  }
  async function peek(input: AssetInput | string): Promise<Response | null> {
    const asset = typeof input === 'string' ? null : (input as Asset);
    const sha256 = asset ? asset.sha256 : (input as string);
    if (asset && usesShards(asset)) {
      try {
        return new Response(await readShards(asset, { allowRepair: false }));
      } catch {
        /* fall through */
      }
    }
    try {
      return (await store.get(sha256)) || null;
    } catch {
      return null;
    }
  }
  // ---- Verified local reads (fm-eulc) ------------------------------------------------------
  // No network, ever: readShards and openVerified run with allowRepair false, and nothing here reaches the
  // fetcher. Every read digests what it returns: each OPFS unit by readShards, and Cache Storage bytes once
  // more here, because open() trusts bytes it verified earlier in the session and a local read must not.
  // Presence alone (has(), a committed trailer) never vouches for bytes. An absent asset is `evicted` when
  // it was stored before as far as this cache can tell (some of its units remain, or this cache saw it
  // stored this session) and `cache-miss` otherwise: after a whole-origin eviction a new session cannot
  // tell the two apart.
  const unitsPresent = async (asset: Asset) =>
    (
      await Promise.all(unitsOf(asset).map((u) => shards!.has(u.sha256, u.size).catch(() => false)))
    ).filter(Boolean).length;
  async function readLocal(
    input: AssetDescriptor,
  ): Promise<Result<Uint8Array<ArrayBuffer>, ManagerError>> {
    const asset = validateAsset(input as AssetInput);
    const fail = (error: ManagerError) => ({ ok: false as const, error });
    try {
      let bytes: Uint8Array<ArrayBuffer>;
      const legacy = async () => {
        const body = new Uint8Array(
          await (await openVerified(asset, { allowRepair: false })).arrayBuffer(),
        );
        if (body.byteLength !== asset.size || (await platformHex(body)) !== asset.sha256) {
          await Promise.resolve(store.remove(asset.sha256)).catch(() => {});
          throw localError('Asset integrity mismatch', 'corrupt');
        }
        return body;
      };
      if (usesShards(asset)) {
        // Bytes still in the old Cache Storage entry (not yet migrated) are read from there, verified.
        const fromLegacy =
          !(await unitsPresent(asset)) &&
          Boolean(await store.get(asset.sha256).catch(() => undefined));
        bytes = fromLegacy ? await legacy() : await readShards(asset, { allowRepair: false });
      } else bytes = await legacy();
      stored.add(asset.sha256);
      return { ok: true, value: bytes };
    } catch (error) {
      const e = error as Err & { local?: Local };
      if (e?.local === 'corrupt' || e?.name === 'NotReadableError') {
        stored.delete(asset.sha256); // a removed identity is not an eviction
        return fail({ code: 'corrupt', sha256: asset.sha256, message: e.message });
      }
      if (e?.local === 'absent') {
        const partial = usesShards(asset) && (await unitsPresent(asset)) > 0;
        return fail({
          code: partial || stored.has(asset.sha256) ? 'evicted' : 'cache-miss',
          sha256: asset.sha256,
          message: e.message,
        });
      }
      return fail({
        code: 'unknown-status',
        retryable: true,
        message: String(e?.message ?? error),
      });
    }
  }
  const local: LocalReader = Object.freeze({ allowRepair: false as const, read: readLocal });
  return { acquire, records, has, peek, local };
}

export async function createBrowserModelCache(
  options: Partial<ModelCacheOptions> & { readonly readOnly?: boolean } = {},
): Promise<ModelCache> {
  const { caches, location } = browserGlobals;
  if (!caches || !location?.origin) throw new Error('Persistent Cache Storage unavailable');
  const cache = await caches.open(MODEL_CACHE_NAME);
  // Native WebViews use tauri:// origins, which Cache Storage rejects as keys.
  // This HTTPS namespace is a local storage key only; no request is sent here.
  const origin = /^https?:\/\//.test(location.origin)
    ? location.origin
    : 'https://next.facemorph.me';
  const key = (hash: string) => new URL(`/__checkface_model_blobs__/sha256/${hash}`, origin).href;
  const shards =
    options.shards !== undefined
      ? options.shards
      : await openShardStore({ readOnly: options.readOnly === true });
  return createModelCache({
    mirrorOf: runtimeMirror(),
    ...options,
    shards,
    locks: browserGlobals.navigator?.locks as LockManagerLike | undefined,
    store: {
      get: (hash) => cache.match(key(hash)),
      put: (hash, response) => cache.put(key(hash), response),
      remove: (hash) => cache.delete(key(hash)),
    },
  });
}

export interface StorageStatus {
  readonly persistence: 'granted' | 'not-granted' | 'unavailable';
  readonly usage?: number | undefined;
  readonly quota?: number | undefined;
  readonly eviction: 'unknown';
}
// Request explicitly from the host UI; no persistence prompt at module import/startup.
export async function storageStatus({
  requestPersistence = false,
  storage = browserGlobals.navigator?.storage,
}: {
  requestPersistence?: boolean;
  storage?: StorageLike | undefined;
} = {}): Promise<StorageStatus> {
  if (!storage) return { persistence: 'unavailable', eviction: 'unknown' };
  try {
    const granted =
      requestPersistence && storage.persist ? await storage.persist() : await storage.persisted?.();
    const estimate = await storage.estimate?.();
    return {
      persistence: granted === true ? 'granted' : granted === false ? 'not-granted' : 'unavailable',
      usage: estimate?.usage,
      quota: estimate?.quota,
      eviction: 'unknown',
    };
  } catch {
    return { persistence: 'unavailable', eviction: 'unknown' };
  }
}
