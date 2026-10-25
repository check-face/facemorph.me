// The model cache: acquisition, verification and storage of pinned model assets in Cache Storage and OPFS shards.
// Moved from the candidate's src/Next/Assets/model-cache.mjs (classic a42829b) without behaviour change (fm-eulc);
// the comments are the candidate's. Acquisition primitives (fm-fr9s): every transfer is under an app-supplied grant
// and inside the shared aggregate slot budget, retries alternate with configured origins, a silent connection is
// abandoned, and the asset deadline counts silence, not size (the candidate's 942c807).
import { chargeGrant, grantAsset, GrantRefused } from '../acquisition/grants.ts';
import {
  createAcquisitionSlots,
  PRIORITY_ORDER,
  slotCount,
  type AcquisitionSlots,
  type SlotLocks,
} from '../acquisition/slots.ts';
import { acquisitionMemoryClass } from '../contracts/budgets.ts';
import type { ManagerError, Result } from '../contracts/errors.ts';
import type { AcquisitionGrant, AcquisitionPriority, GrantOwnerId } from '../contracts/grant.ts';
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
  /** An asset that receives nothing for this long fails (TimeoutError); every byte restarts it. */
  readonly timeoutMs?: number | undefined;
  /** A chunk attempt that receives nothing for this long is abandoned and retried (CHUNK_STALL_MS). */
  readonly stallMs?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly readAhead?: number | undefined;
  readonly retryDelaysMs?: readonly number[] | undefined;
  /**
   * HTTPS origins that serve the same files under the same paths. Every other retry of a chunk goes to the next
   * one, in order. Empty by default: then no request leaves the asset's own origin.
   */
  readonly alternateOrigins?: readonly string[] | undefined;
  /** The aggregate chunk budget shared by every worker; null admits every chunk at once (one-worker tests only). */
  readonly slots?: AcquisitionSlots | null | undefined;
  readonly report?: ((event: CacheEvent) => void) | undefined;
}
/** Who an acquisition is for: an owner the grant names. Bytes are transferred only under the grant. */
export interface AcquireOptions {
  readonly grant: AcquisitionGrant;
  readonly owner: GrantOwnerId;
  readonly signal?: AbortSignal | undefined;
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
/** A real storage-quota refusal, separate from execution/provider capability.
 * The DOM name and cause remain available to existing browser-storage callers;
 * `error` is the structured-clone-safe manager result for app/worker boundaries.
 */
export class CacheQuotaExceeded extends Error {
  readonly error: Extract<ManagerError, { code: 'quota' }>;
  constructor(requiredBytes: number, cause: unknown) {
    const message =
      'Not enough browser storage to save this model. Free some storage and try again.';
    super(message, { cause });
    this.name = 'QuotaExceededError';
    this.error = { code: 'quota', requiredBytes, message };
  }
}

export interface ModelCache {
  /** Verified local reads with typed misses (fm-eulc). */
  readonly local: LocalReader;
  /** Rejects with GrantRefused before unauthorized requests, or CacheQuotaExceeded when storage is full. */
  acquire(input: AssetInput, options: AcquireOptions): Promise<AssetHandle>;
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
/** Who pays for an asset's bytes now, and at what priority: the shared fetch's current owners decide both. */
interface Transfer {
  payer(): AcquisitionGrant;
  priority(): AcquisitionPriority;
  /** Bytes arrived: restarts the asset's silence deadline. */
  alive(): void;
}
/** The same path on another origin. */
const onOrigin = (url: string, origin: string) => new URL(new URL(url).pathname, origin).href;
async function fetchVerifiedChunk(
  part: Asset,
  download: Download,
  signal: AbortSignal,
  transfer: Transfer,
  delays: readonly number[] = CHUNK_RETRY_DELAYS_MS,
  alternates: readonly string[] = [],
  stallMs: number = CHUNK_STALL_MS,
): Promise<Uint8Array<ArrayBuffer>> {
  let first: unknown;
  for (let attempt = 0; ; attempt++) {
    const fromMirror = alternates.length > 0 && attempt % 2 === 1;
    try {
      const url = fromMirror
        ? onOrigin(part.url, alternates[((attempt - 1) / 2) % alternates.length]!)
        : attempt
          ? Object.assign(new URL(part.url), { search: `retry=${attempt}` }).href
          : part.url;
      return await fetchChunkOnce(
        attempt ? { ...part, url } : part,
        download,
        signal,
        transfer,
        stallMs,
      );
    } catch (error) {
      check(signal);
      if (error instanceof GrantRefused) throw error; // more attempts would need more than was approved
      first ??= error; // the site's own answer is the one worth reporting
      if (attempt >= delays.length || !(fromMirror || retryable(error)))
        throw fromMirror ? first : error;
      await pauseFor(delays[attempt]!, signal);
    }
  }
}
// 24 October (fm-vf9l, device lab): a connection that goes silent without a reset (a laptop waking from sleep, a
// changed network, a dead NAT mapping) never fails a fetch. An encoder shard sat 106 s without a byte and nothing on
// the page noticed; only the asset deadline would have ended it, and that fails the whole download. An attempt that
// receives nothing for `stallMs` is abandoned and asked again like a dropped connection, so the next try opens a
// fresh request (and every other try goes to the mirror).
export const CHUNK_STALL_MS = 30000;
const stalledError = () =>
  Object.assign(
    new Error(
      'The model download stopped receiving data. Parts already downloaded are kept: try again in a few minutes.',
    ),
    { transient: true, stalled: true },
  );
/** One pinned chunk, fully read into a buffer of exactly its declared size and checked by the platform digest. */
async function fetchChunkOnce(
  part: Asset,
  download: Download,
  signal: AbortSignal,
  transfer: Transfer,
  stallMs: number,
): Promise<Uint8Array<ArrayBuffer>> {
  // Every byte of every attempt counts against the grant; the attempt reserves its chunk before asking.
  const charge = chargeGrant(transfer.payer(), part.sha256, part.size);
  const attempt = new AbortController();
  const stall = stalledError();
  const relay = () => attempt.abort(signal.reason || aborted());
  if (signal.aborted) relay();
  else signal.addEventListener('abort', relay, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = () => {
    clearTimeout(timer);
    timer = setTimeout(() => attempt.abort(stall), stallMs);
  };
  const out = new Uint8Array(part.size);
  let at = 0;
  try {
    quiet();
    const body = await download(part, attempt.signal);
    if (!body) throw new Error('Asset response has no readable body');
    const reader = body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        check(attempt.signal);
        quiet();
        if (done) break;
        transfer.alive();
        charge.received(value.byteLength);
        if (at + value.byteLength > part.size) throw new Error('Asset exceeds declared size');
        out.set(value, at);
        at += value.byteLength;
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    attempt.abort(error); // stop unfinished I/O on failure, not a fully consumed response
    check(signal); // the caller's own cancellation wins over anything below
    throw attempt.signal.reason === stall ? stall : error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relay);
    charge.settle();
  }
  if (at !== part.size) throw new Error('Asset integrity mismatch');
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', out));
  check(signal);
  if (digest !== part.sha256) throw new Error('Asset integrity mismatch');
  return out;
}
/** Validates configured alternate origins: each an HTTPS origin, exactly. */
function validateOrigins(origins: readonly string[]): readonly string[] {
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin)
      throw new TypeError('alternateOrigins must be HTTPS origins (scheme, host and port only)');
  }
  return Object.freeze([...origins]);
}

/** Explicit download for immediate execution when durable model storage cannot be used.
 * This does not populate a cache or manufacture a local reader/asset handle.
 */
export type UncachedAcquireOptions = Pick<
  ModelCacheOptions,
  'fetcher' | 'timeoutMs' | 'stallMs' | 'retryDelaysMs' | 'alternateOrigins' | 'slots' | 'report'
>;

// Opaque origins cannot use Web Locks. Serialize the bounded chunk workspace in this realm
// when the browser cannot provide cross-realm coordination, rather than admitting every caller.
const localUncachedSlots: AcquisitionSlots = (() => {
  let busy = false;
  const waiting: {
    signal: AbortSignal;
    resolve(release: () => void): void;
    reject(reason: unknown): void;
    cancel(): void;
  }[] = [];
  const pump = () => {
    if (busy) return;
    const next = waiting.shift();
    if (!next) return;
    next.signal.removeEventListener('abort', next.cancel);
    if (next.signal.aborted) {
      next.reject(next.signal.reason || aborted());
      pump();
      return;
    }
    busy = true;
    let released = false;
    next.resolve(() => {
      if (released) return;
      released = true;
      busy = false;
      pump();
    });
  };
  return {
    count: 1,
    take(_priority, signal) {
      check(signal);
      return new Promise((resolve, reject) => {
        const next = {
          signal,
          resolve,
          reject,
          cancel() {
            const at = waiting.indexOf(next);
            if (at >= 0) waiting.splice(at, 1);
            reject(signal.reason || aborted());
          },
        };
        signal.addEventListener('abort', next.cancel, { once: true });
        waiting.push(next);
        pump();
      });
    },
  };
})();

function uncachedBrowserSlots(): AcquisitionSlots {
  try {
    const locks = browserGlobals.navigator?.locks as SlotLocks | undefined;
    if (!locks) return localUncachedSlots;
    const native = createAcquisitionSlots({
      locks,
      count: slotCount(
        acquisitionMemoryClass(
          (browserGlobals.navigator as { deviceMemory?: number } | undefined)?.deviceMemory,
        ),
      ),
    });
    return {
      count: native.count,
      async take(priority, signal) {
        try {
          return await native.take(priority, signal);
        } catch (error) {
          check(signal);
          if ((error as { name?: string })?.name !== 'SecurityError') throw error;
          return localUncachedSlots.take(priority, signal);
        }
      },
    };
  } catch (error) {
    if ((error as { name?: string })?.name !== 'SecurityError') throw error;
    return localUncachedSlots;
  }
}

/** Returns one verified asset without reading or writing any persistent storage.
 * The caller owns its lifetime. Explicit JS model buffers are one final buffer plus one
 * sequential verified chunk, never an asset map or the encoder's complete shard set. Platform
 * SHA-256 may additionally use native workspace for its input (a whole unchunked asset).
 * All bytes, including
 * failed attempts, spend the supplied grant; a cache failure does not replenish that grant.
 */
export async function acquireUncachedBytes(
  input: AssetInput,
  options: AcquireOptions,
  {
    fetcher = globalThis.fetch,
    timeoutMs = 300000,
    stallMs = CHUNK_STALL_MS,
    retryDelaysMs = CHUNK_RETRY_DELAYS_MS,
    alternateOrigins = [],
    slots = uncachedBrowserSlots(),
    report = () => {},
  }: UncachedAcquireOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const asset = validateAsset(input);
  const { grant, owner, signal } = options ?? ({} as Partial<AcquireOptions>);
  const permission = grantAsset(grant, owner, asset.sha256, asset.size);
  check(signal);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(stallMs) || stallMs <= 0)
    throw new TypeError('Invalid uncached acquisition settings');
  const alternates = validateOrigins(alternateOrigins);
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason || aborted());
  signal?.addEventListener('abort', relay, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new DOMException('Asset acquisition timed out', 'TimeoutError')),
      timeoutMs,
    );
  };
  const emit = (event: CacheEvent) => {
    try {
      report(event);
    } catch {
      /* observers cannot break acquisition */
    }
  };
  const transfer: Transfer = { payer: () => grant!, priority: () => permission.priority, alive };
  let completed = 0;
  const download: Download = async (part, attemptSignal) => {
    const response = await fetcher(part.url, {
      signal: attemptSignal,
      credentials: 'omit',
      cache: 'default',
      mode: 'cors',
    });
    check(attemptSignal);
    if (!response.ok || response.status !== 200 || response.type === 'opaque')
      throw downloadRefused(response);
    return response.body
      ? counted(response.body, part, (event) =>
          emit({
            ...event,
            sha256: asset.sha256,
            loaded: completed + Number(event['loaded']),
            bytes: asset.size,
          }),
        )
      : null;
  };
  try {
    emit({ status: 'downloading', sha256: asset.sha256 });
    const out = asset.chunks ? new Uint8Array(asset.size) : null;
    const parentHash = asset.chunks ? new Sha256() : null;
    for (const part of asset.chunks ?? [asset]) {
      const release = slots ? await slots.take(permission.priority, controller.signal) : () => {};
      try {
        check(controller.signal);
        alive();
        const bytes = await fetchVerifiedChunk(
          part,
          download,
          controller.signal,
          transfer,
          retryDelaysMs,
          alternates,
          stallMs,
        );
        if (!out) {
          emit({ status: 'verified', sha256: asset.sha256, bytes: asset.size });
          return bytes;
        }
        out.set(bytes, completed);
        parentHash!.update(bytes);
        completed += bytes.byteLength;
        emit({ status: 'progress', sha256: asset.sha256, loaded: completed, bytes: asset.size });
      } finally {
        clearTimeout(timer);
        release();
      }
    }
    check(controller.signal);
    if (!out || completed !== asset.size || parentHash!.hex() !== asset.sha256)
      throw new Error('Asset integrity mismatch');
    check(controller.signal);
    emit({ status: 'verified', sha256: asset.sha256, bytes: asset.size });
    return out;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
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

/** Counts a body's bytes against an attempt's grant charge as they pass. */
function charged(
  body: ReadableStream<Uint8Array> | null,
  charge: { received(bytes: number): void },
): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) return controller.close();
        charge.received(value.byteLength);
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        void reader.cancel(error).catch(() => {});
      }
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
  /** The fetch's owners in arrival order, each with its grant and how many acquire calls it has waiting. */
  readonly owners: Map<GrantOwnerId, { readonly grant: AcquisitionGrant; count: number }>;
  readonly transfer: Transfer;
  promise: Promise<void>;
  /** Restarts the silence deadline; set while the work runs. */
  alive?: (() => void) | undefined;
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
  stallMs = CHUNK_STALL_MS,
  maxConcurrent = 2,
  readAhead = 2,
  retryDelaysMs = CHUNK_RETRY_DELAYS_MS,
  alternateOrigins = [],
  slots = null,
  report = () => {},
}: ModelCacheOptions): ModelCache {
  if (
    !store ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(stallMs) ||
    stallMs <= 0 ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    !Number.isInteger(readAhead) ||
    readAhead < 1 ||
    readAhead > 8
  )
    throw new TypeError('Invalid cache settings');
  const alternates = validateOrigins(alternateOrigins);
  /** Holds one aggregate slot for `run`; no slots configured admits at once. */
  const inSlot = async <T>(
    transfer: Transfer,
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> => {
    const release = slots ? await slots.take(transfer.priority(), signal) : () => {};
    try {
      return await run();
    } finally {
      release();
    }
  };
  const chunk = (unit: Asset, signal: AbortSignal, transfer: Transfer) =>
    fetchVerifiedChunk(unit, fetchBody, signal, transfer, retryDelaysMs, alternates, stallMs);
  const pending = new Map<string, Pending>();
  const queue: Task[] = [];
  let active = 0;
  // Identities this cache has seen stored (saved, retained, or read locally): an absent one is then evicted.
  const stored = new Set<string>();
  const emit = (event: CacheEvent) => {
    if (event.status === 'saved' || event.status === 'retained') stored.add(event.sha256);
    if (event.status === 'progress') pending.get(event.sha256)?.alive?.(); // the deadline counts silence, not size
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
      const quota = (error as Err | null)?.name === 'QuotaExceededError';
      emit({
        status: quota ? 'quota-exceeded' : 'save-failed',
        sha256: asset.sha256,
      });
      throw quota ? new CacheQuotaExceeded(asset.size, error) : error;
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
  async function ensureShards(asset: Asset, signal: AbortSignal, transfer: Transfer) {
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
          // The slot spans fetch, digest and write: the chunk's bytes are in memory for all three.
          await inSlot(transfer, stop.signal, async () =>
            commitUnit(asset, unit, await chunk(unit, stop.signal, transfer)),
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
    { allowRepair, transfer }: { allowRepair: boolean; transfer?: Transfer },
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
        if (!allowRepair || !transfer)
          throw bytes
            ? localError('Asset integrity mismatch', 'corrupt')
            : localError('Stored asset disappeared; acquire again', 'absent');
        emit({ status: 'repairing', sha256: asset.sha256 });
        bytes = await underLock(unit.sha256, async () => {
          const again = await shards!.read(unit.sha256, unit.size); // another tab may have repaired it
          if (again && (await platformHex(again)) === unit.sha256) return again;
          await shards!.remove(unit.sha256);
          // The refetch is under the grant that acquired the asset, inside the shared budget.
          const repair = AbortSignal.timeout(timeoutMs);
          return inSlot(transfer, repair, async () => {
            const fresh = await chunk(unit, repair, transfer);
            await commitUnit(asset, unit, fresh).catch(() => {}); // the verified bytes are served even if saving fails
            return fresh;
          });
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
  async function ensure(asset: Asset, signal: AbortSignal, transfer: Transfer): Promise<void> {
    check(signal);
    if (usesShards(asset)) return ensureShards(asset, signal, transfer);
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
    /** Slots held by this asset's chunks still in memory; all are let go when the asset settles. */
    const held = new Set<() => void>();
    const letGo = (release: () => void) => {
      held.delete(release);
      release();
    };
    let body: ReadableStream<Uint8Array> | null;
    let settlePlain: (() => void) | undefined;
    const chunks = asset.chunks;
    if (chunks && globalThis.crypto?.subtle) {
      // Read-ahead (measured on eris, 150 MiB model prefix): chunks fetched one at a time and hashed in
      // JS twice cost 6.8 s of a cold first face, against a link ceiling of 2.7 s with four in flight.
      // Up to `readAhead` 16 MiB chunks are fetched into memory concurrently; each is checked against
      // its pinned digest by the platform's SHA-256 (8x the speed of sha256.mjs, off this thread) and
      // handed on strictly in order. Memory is bounded by readAhead chunks. The whole-asset digest
      // below is unchanged, and nothing commits until it matches at EOF.
      // Each chunk also holds an aggregate slot from before its first byte until the store has taken all of it: the
      // next pull only comes once the consumer has read every piece enqueued before it (fm-fr9s).
      const ahead: Promise<{ bytes: Uint8Array<ArrayBuffer>; release: () => void }>[] = [];
      const stop = new AbortController();
      const relay = () => stop.abort(signal.reason || aborted());
      signal.addEventListener('abort', relay, { once: true });
      const release = (reason?: unknown) => {
        signal.removeEventListener('abort', relay);
        if (reason !== undefined) stop.abort(reason);
      };
      let started = 0;
      let handedOn: (() => void) | undefined;
      const fill = () => {
        while (ahead.length < readAhead && started < chunks.length) {
          const part = chunks[started++]!;
          const task = (async () => {
            const slot = slots ? await slots.take(transfer.priority(), stop.signal) : () => {};
            held.add(slot);
            try {
              return { bytes: await chunk(part, stop.signal, transfer), release: slot };
            } catch (error) {
              letGo(slot);
              throw error;
            }
          })();
          task.catch(() => {}); // surfaced where it is awaited; a later chunk must not become an unhandled rejection
          ahead.push(task);
        }
      };
      body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (handedOn) letGo(handedOn);
            handedOn = undefined;
            check(signal);
            fill();
            if (!ahead.length) {
              release();
              controller.close();
              return;
            }
            const next = await ahead.shift()!;
            handedOn = next.release;
            const piece = next.bytes;
            check(signal);
            fill();
            pending.get(asset.sha256)?.alive?.();
            // Network-sized views, not the whole 16 MiB buffer: Firefox failed the first read-ahead build with a
            // NetworkError (caught by the pre-deploy engine matrix), and the progress bar would move in 16 MiB
            // steps. Views share the buffer, so this copies nothing.
            for (let at = 0; at < piece.byteLength; at += PIECE_BYTES)
              controller.enqueue(piece.subarray(at, Math.min(at + PIECE_BYTES, piece.byteLength)));
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
      let charge: ReturnType<typeof chargeGrant> | undefined;
      let slot: (() => void) | undefined;
      const endChunk = () => {
        charge?.settle();
        charge = undefined;
        if (slot) letGo(slot);
        slot = undefined;
      };
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
                slot = slots ? await slots.take(transfer.priority(), signal) : () => {};
                held.add(slot);
                charge = chargeGrant(transfer.payer(), part.sha256, part.size);
                reader = verifiedStream(await download(part), part, signal).getReader();
              }
              const result = await reader.read();
              if (result.done) {
                reader.releaseLock();
                reader = undefined;
                endChunk();
                continue;
              }
              charge!.received(result.value.byteLength);
              controller.enqueue(result.value);
              return;
            }
          } catch (error) {
            endChunk();
            controller.error(error);
            await reader?.cancel(error).catch(() => {});
          }
        },
        cancel(reason) {
          endChunk();
          return reader?.cancel(reason);
        },
      });
    } else {
      // One unchunked asset streams into the store under one slot and one charge for its whole size.
      const slot = slots ? await slots.take(transfer.priority(), signal) : () => {};
      held.add(slot);
      let charge: ReturnType<typeof chargeGrant> | undefined;
      try {
        charge = chargeGrant(transfer.payer(), asset.sha256, asset.size);
        body = charged(await download(asset), charge);
      } catch (error) {
        charge?.settle();
        letGo(slot); // a refused grant gives its slot back at once
        throw error;
      }
      const settle = charge;
      settlePlain = () => settle.settle();
    }
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
      const quota = (error as Err | null)?.name === 'QuotaExceededError';
      emit({
        status: quota ? 'quota-exceeded' : 'save-failed',
        sha256: asset.sha256,
      });
      throw quota ? new CacheQuotaExceeded(asset.size, error) : error;
    } finally {
      for (const release of held) letGo(release); // deleting the visited entry is safe
      settlePlain?.();
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
    { allowRepair, transfer }: { allowRepair: boolean; transfer?: Transfer },
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
      if (!allowRepair || !transfer)
        throw localError('Stored asset disappeared; acquire again', 'absent');
      emit({ status: 'repairing', sha256: asset.sha256 });
      await ensure(asset, new AbortController().signal, transfer);
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
    if (!allowRepair || !transfer) throw Object.assign(failure, { local: 'corrupt' as const });
    emit({ status: 'repairing', sha256: asset.sha256 });
    await ensure(asset, new AbortController().signal, transfer);
    return openVerified(asset, { allowRepair: false });
  }
  // Bytes verified earlier this session are handed back without a second digest, so a file that
  // became unreadable since is only found here: drop the identity and repair it once.
  async function readVerified(asset: Asset, transfer: Transfer): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return new Uint8Array(
        await (await openVerified(asset, { allowRepair: true, transfer })).arrayBuffer(),
      );
    } catch (error) {
      if ((error as Err | null)?.name !== 'NotReadableError') throw error;
      verifiedAssets.delete(asset.sha256);
      await Promise.resolve(store.remove(asset.sha256)).catch(() => {});
      emit({ status: 'corrupt-removed', sha256: asset.sha256 });
      emit({ status: 'repairing', sha256: asset.sha256 });
      await ensure(asset, new AbortController().signal, transfer);
      return new Uint8Array(
        await (await openVerified(asset, { allowRepair: false })).arrayBuffer(),
      );
    }
  }
  function acquire(input: AssetInput, options: AcquireOptions): Promise<AssetHandle> {
    const { grant, owner, signal } = options ?? ({} as Partial<AcquireOptions>);
    let asset: Asset;
    try {
      asset = validateAsset(input);
      // No grant, an owner it does not name, or a digest outside it: refused before any request.
      grantAsset(grant, owner, asset.sha256, asset.size);
      check(signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const ownerId = owner!;
    let task = pending.get(asset.sha256);
    if (task && task.asset.size !== asset.size)
      return Promise.reject(new Error('Conflicting size for identical hash'));
    if (!task) {
      const controller = new AbortController();
      const owners: Pending['owners'] = new Map();
      // Bytes are charged to the first owner still attached; when it leaves, the next one carries the fetch on
      // under its own grant (ownership transfer). Priority is the highest any owner's grant gives this asset.
      const transfer: Transfer = {
        payer() {
          const first = owners.values().next();
          if (first.done) throw new GrantRefused('no-owner', asset.sha256);
          return first.value.grant;
        },
        priority() {
          let best: AcquisitionPriority = 'speculative-warming';
          for (const { grant: g } of owners.values()) {
            const p: AcquisitionPriority =
              g.assets.find((a) => a.sha256 === asset.sha256)?.priority ?? best;
            if (PRIORITY_ORDER.indexOf(p) < PRIORITY_ORDER.indexOf(best)) best = p;
          }
          return best;
        },
        alive: () => current.alive?.(),
      };
      const current: Pending = {
        asset,
        controller,
        waiters: 0,
        owners,
        transfer,
        promise: Promise.resolve(),
      };
      task = current;
      // The deadline is for an asset that has stopped arriving, not one that is big on a slow link: it starts when
      // the work does (not while queued) and every progress tick restarts it. A wall-clock 300 s made the 158 MB
      // WebGPU prefix unobtainable below 4.2 Mbit/s and the 124 MB CPU model below 3.3 Mbit/s (fm-vf9l).
      let timer: ReturnType<typeof setTimeout> | undefined;
      current.alive = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => controller.abort(new DOMException('Asset acquisition timed out', 'TimeoutError')),
          timeoutMs,
        );
      };
      const run = () => {
        current.alive?.();
        return ensure(asset, controller.signal, transfer);
      };
      current.promise = schedule(
        () =>
          locks?.request
            ? locks.request(
                `${MODEL_CACHE_NAME}:${asset.sha256}`,
                { signal: controller.signal },
                run,
              )
            : run(),
        controller.signal,
      ).finally(() => {
        clearTimeout(timer);
        current.alive = undefined;
        if (pending.get(asset.sha256) === current) pending.delete(asset.sha256);
      });
      pending.set(asset.sha256, current);
    }
    const shared = task;
    shared.waiters++;
    // A revised grant from the same owner (a new decision) pays from now on; the owner keeps its place in line.
    shared.owners.set(ownerId, {
      grant: grant!,
      count: (shared.owners.get(ownerId)?.count ?? 0) + 1,
    });
    // The handle repairs only under this caller's own grant: a later refetch is charged to it.
    const own: Transfer = {
      payer: () => grant!,
      priority: () => grant!.assets.find((a) => a.sha256 === asset.sha256)!.priority,
      alive: () => {},
    };
    return new Promise<AssetHandle>((resolve, reject) => {
      let settled = false;
      const leave = () => {
        const entry = shared.owners.get(ownerId);
        if (entry && --entry.count === 0) shared.owners.delete(ownerId);
      };
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        shared.waiters--;
        leave();
        if (error) reject(error);
        else if (usesShards(asset))
          resolve(
            Object.freeze({
              sha256: asset.sha256,
              size: asset.size,
              bytes: () => readShards(asset, { allowRepair: true, transfer: own }),
              open: async () =>
                new Response(await readShards(asset, { allowRepair: true, transfer: own })),
            }),
          );
        else
          resolve(
            Object.freeze({
              sha256: asset.sha256,
              size: asset.size,
              bytes: () => readVerified(asset, own),
              open: async () => openVerified(asset, { allowRepair: true, transfer: own }),
            }),
          );
      };
      const cancel = () => {
        finish(signal!.reason || aborted());
        // The last owner to leave stops the fetch; verified chunks already stored are kept.
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
  const locks = browserGlobals.navigator?.locks as (LockManagerLike & SlotLocks) | undefined;
  // One aggregate budget for every worker and tab of this origin, sized by the device's memory class.
  const memory = acquisitionMemoryClass(
    (browserGlobals.navigator as { deviceMemory?: number } | undefined)?.deviceMemory,
  );
  return createModelCache({
    slots: locks ? createAcquisitionSlots({ locks, count: slotCount(memory) }) : null,
    ...options,
    shards,
    locks,
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
