import { Sha256 } from './sha256.mjs';
import { openShardStore } from './shard-store.mjs';

export const MODEL_CACHE_NAME = 'checkface-model-blobs-v1'; // Never app-versioned or age-purged.
const aborted = () => new DOMException('Asset acquisition cancelled', 'AbortError');
const check = signal => { if (signal?.aborted) throw signal.reason || aborted(); };
export function validateAsset(asset) {
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0)
    throw new TypeError('Asset requires lowercase SHA-256 and exact nonnegative byte size');
  const url = new URL(asset.url);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new TypeError('Asset acquisition requires an HTTPS URL without embedded credentials');
  let chunks;
  if (asset.chunks !== undefined) {
    if (!Array.isArray(asset.chunks) || !asset.chunks.length || asset.chunks.length > 256)
      throw new TypeError('Invalid asset chunks');
    chunks = asset.chunks.map(part => {
      if (part.chunks !== undefined || part.size <= 0 || part.size > 16 * 1024 * 1024)
        throw new TypeError('Invalid asset chunk');
      return validateAsset(part);
    });
    if (chunks.reduce((sum, part) => sum + part.size, 0) !== asset.size)
      throw new TypeError('Asset chunk sizes do not match');
    Object.freeze(chunks);
  }
  return Object.freeze({ sha256: asset.sha256, size: asset.size, url: url.href, ...(chunks ? { chunks } : {}) });
}

const PIECE_BYTES = 256 * 1024;
const SHARD_UNIT_LIMIT = 64 * 1024 * 1024; // unchunked assets above this stay in Cache Storage
const hex = buffer => Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
/** One pinned chunk, fully read into a buffer of exactly its declared size and checked by the platform digest. */
async function fetchVerifiedChunk(part, download, signal) {
  const body = await download(part, signal);
  if (!body) throw new Error('Asset response has no readable body');
  const out = new Uint8Array(part.size), reader = body.getReader();
  let at = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      check(signal);
      if (done) break;
      if (at + value.byteLength > part.size) throw new Error('Asset exceeds declared size');
      out.set(value, at); at += value.byteLength;
    }
  } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
  if (at !== part.size) throw new Error('Asset integrity mismatch');
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', out));
  check(signal);
  if (digest !== part.sha256) throw new Error('Asset integrity mismatch');
  return out;
}
// Runs with backpressure; errors before EOF prevent Cache.put from committing.
function verifiedStream(body, asset, signal) {
  if (!body) throw new Error('Asset response has no readable body');
  const reader = body.getReader(), hash = new Sha256();
  let size = 0, terminal = false, streamController;
  const cleanup = () => { terminal = true; signal.removeEventListener('abort', onAbort); };
  const onAbort = () => {
    if (terminal) return;
    const reason = signal.reason || aborted(); cleanup();
    streamController.error(reason); void reader.cancel(reason).catch(() => {});
  };
  return new ReadableStream({
    start(controller) { streamController = controller; signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); },
    async pull(controller) {
      try {
        check(signal);
        const { value, done } = await reader.read();
        check(signal);
        if (done) {
          if (size !== asset.size || hash.hex() !== asset.sha256) throw new Error('Asset integrity mismatch');
          cleanup(); controller.close(); return;
        }
        size += value.byteLength;
        if (size > asset.size) throw new Error('Asset exceeds declared size');
        hash.update(value); controller.enqueue(value);
      } catch (error) {
        if (!terminal) { cleanup(); controller.error(error); }
        void reader.cancel(error).catch(() => {});
      }
    },
    cancel(reason) { cleanup(); return reader.cancel(reason); }
  });
}
/**
 * Counts bytes on their way past so an observer can drive a real progress bar. The 158 MB
 * asset used to report {loaded:0} and then {loaded:size}: the bar sat at zero for minutes and
 * then jumped. Ticks are coalesced so a large download costs a bounded number of events.
 */
export const PROGRESS_INTERVAL_BYTES = 1024 * 1024;
function counted(body, asset, emit) {
  const reader = body.getReader();
  let seen = 0, announced = 0;
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) { controller.close(); return; }
      seen += value.byteLength;
      if (seen - announced >= PROGRESS_INTERVAL_BYTES) {
        announced = seen;
        emit({ status: 'progress', sha256: asset.sha256, loaded: Math.min(seen, asset.size), bytes: asset.size });
      }
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); }
  });
}

/**
 * Small JSON records sharing the asset store's namespace but keyed by their own identity rather
 * than asset bytes: verified-asset markers (C-05) and canary qualification records (C-03). A
 * record that fails to parse or read is dropped, never fatal — the caller re-proves instead.
 */
export function createRecordAccess(store) {
  return {
    async get(key) {
      try {
        const response = await store.get(key);
        if (!response) return undefined;
        const record = await response.json();
        return record && typeof record === 'object' ? record : undefined;
      } catch { return undefined; }
    },
    async put(key, record) { await store.put(key, new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json' } })); },
    async remove(key) { await store.remove(key); }
  };
}

/** Store contract: get(hash) -> fresh Response|undefined; put(hash, Response)
 * MUST consume the stream and commit atomically only after successful EOF;
 * remove(hash) removes only that corrupt identity. Never expose partial writes.
 * Observers receive hashes/status only (no URLs or authentication material).
 */
export function createModelCache({ store, shards = null, fetcher = globalThis.fetch, locks,
  timeoutMs = 300000, maxConcurrent = 2, readAhead = 2, report = () => {} }) {
  if (!store || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1
    || !Number.isInteger(readAhead) || readAhead < 1 || readAhead > 8)
    throw new TypeError('Invalid cache settings');
  const pending = new Map(), queue = [];
  let active = 0;
  const emit = event => { try { report(event); } catch { /* observers cannot break storage */ } };
  const records = createRecordAccess(store);
  async function fetchBody(part, signal) {
    const response = await fetcher(part.url, { signal, credentials: 'omit', cache: 'default', mode: 'cors' });
    check(signal);
    if (!response.ok || response.status !== 200 || response.type === 'opaque') {
      void response.body?.cancel().catch(() => {});
      throw new Error('Asset download requires a readable complete HTTP 200 response');
    }
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
  const usesShards = asset => Boolean(shards) && (asset.chunks || asset.size <= SHARD_UNIT_LIMIT);
  const unitsOf = asset => asset.chunks || [asset];
  const platformHex = async bytes => hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const underLock = (name, run) => locks?.request ? locks.request(`${MODEL_CACHE_NAME}:${name}`, run) : run();
  async function commitUnit(asset, unit, bytes) {
    try { await shards.write(unit.sha256, bytes); }
    catch (error) {
      emit({ status: error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'save-failed', sha256: asset.sha256 });
      throw error;
    }
  }
  // Bounded-concurrency map over units, in order of index; the first failure stops new work.
  async function eachUnit(list, limit, run) {
    let next = 0, failure;
    const lane = async () => { while (next < list.length && !failure) { const i = next++; try { await run(list[i], i); } catch (error) { failure ??= error; } } };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, lane));
    if (failure) throw failure;
  }
  // Bytes saved by the Cache Storage backend move across without a download: each unit is
  // checked against its pin on the way, and the old entry is dropped once every unit is in place
  // (keeping both would double the quota the model takes, which iOS does not have to spare).
  async function migrateLegacy(asset, missing, signal) {
    let response;
    try { response = await store.get(asset.sha256); } catch { return; }
    if (!response?.body) return;
    const wanted = new Set(missing.map(unit => unit.sha256)), reader = response.body.getReader();
    let index = 0, unit = unitsOf(asset)[0], buffer = new Uint8Array(unit.size), at = 0, moved = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        check(signal);
        if (done) break;
        let offset = 0;
        while (offset < value.byteLength && unit) {
          const take = Math.min(unit.size - at, value.byteLength - offset);
          buffer.set(value.subarray(offset, offset + take), at); at += take; offset += take;
          if (at === unit.size) {
            if (wanted.has(unit.sha256) && await platformHex(buffer) === unit.sha256) { await commitUnit(asset, unit, buffer); moved++; }
            unit = unitsOf(asset)[++index]; at = 0; buffer = unit ? new Uint8Array(unit.size) : null;
          }
        }
        if (!unit) break;
      }
    } catch (error) { if (signal.aborted) throw error; } // a broken old entry is not fatal: download what is left
    finally { void reader.cancel().catch(() => {}); }
    if (moved) emit({ status: 'migrated', sha256: asset.sha256, units: moved });
    return moved;
  }
  async function missingUnits(asset) {
    const out = [];
    for (const unit of unitsOf(asset)) if (!(await shards.has(unit.sha256, unit.size))) out.push(unit);
    return out;
  }
  async function ensureShards(asset, signal) {
    let missing = await missingUnits(asset);
    check(signal);
    if (!missing.length) { emit({ status: 'retained', sha256: asset.sha256, bytes: asset.size }); return; }
    // Migration is local: it announces nothing until it is known that the network is needed.
    if (await migrateLegacy(asset, missing, signal)) {
      missing = await missingUnits(asset);
      if (!missing.length) { void store.remove(asset.sha256).catch(() => {}); emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size }); return; }
    }
    check(signal);
    emit({ status: 'missing', sha256: asset.sha256 });
    emit({ status: 'downloading', sha256: asset.sha256 });
    let loaded = asset.size - missing.reduce((sum, unit) => sum + unit.size, 0);
    const stop = new AbortController(), relay = () => stop.abort(signal.reason || aborted());
    signal.addEventListener('abort', relay, { once: true });
    try {
      await eachUnit(missing, readAhead, async unit => {
        try { await commitUnit(asset, unit, await fetchVerifiedChunk(unit, fetchBody, stop.signal)); }
        catch (error) { stop.abort(error); throw error; }
        loaded += unit.size;
        emit({ status: 'progress', sha256: asset.sha256, loaded, bytes: asset.size });
      });
    } finally { signal.removeEventListener('abort', relay); }
    check(signal);
    void store.remove(asset.sha256).catch(() => {}); // a partly migrated old entry is no longer needed
    emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size });
  }
  // Every unit read is digested against its pin, every time. A unit that is absent, uncommitted or
  // wrong is removed and fetched again on its own, under the same lock that guards its writes.
  async function readShards(asset, { allowRepair }) {
    const units = unitsOf(asset), out = units.length === 1 ? null : new Uint8Array(asset.size);
    const offsets = []; units.reduce((at, unit) => { offsets.push(at); return at + unit.size; }, 0);
    let single;
    await eachUnit(units, 4, async (unit, i) => {
      let bytes = await shards.read(unit.sha256, unit.size);
      if (!bytes || await platformHex(bytes) !== unit.sha256) {
        emit({ status: bytes ? 'corrupt-removed' : 'missing-after-acquire', sha256: asset.sha256 });
        if (!allowRepair) throw new Error(bytes ? 'Asset integrity mismatch' : 'Stored asset disappeared; acquire again');
        emit({ status: 'repairing', sha256: asset.sha256 });
        bytes = await underLock(unit.sha256, async () => {
          const again = await shards.read(unit.sha256, unit.size); // another tab may have repaired it
          if (again && await platformHex(again) === unit.sha256) return again;
          await shards.remove(unit.sha256);
          const fresh = await fetchVerifiedChunk(unit, fetchBody, AbortSignal.timeout(timeoutMs));
          await commitUnit(asset, unit, fresh).catch(() => {}); // the verified bytes are served even if saving fails
          return fresh;
        });
      }
      if (out) out.set(bytes, offsets[i]); else single = bytes;
    });
    return out || single;
  }
  // C-05, amended 19 September: the digest of an asset is computed at most once per session.
  // Bytes verified on download (or on first open of bytes stored earlier) carry the in-memory
  // mark; the marker is deliberately NOT durable any more — a durable marker vouches for bytes
  // it cannot see change underneath, and a stale marker served corrupt bytes on iOS 27 Safari
  // and Android Chrome 124. Cost of the fix: one hash per asset per session instead of one per
  // bundle version; correctness outranks the saving. Old durable markers are deleted whenever
  // the identity is touched (openVerified cleanup).
  const VERIFIED_MARKER = 'verified:';
  const verifiedAssets = new Set();
  const markVerified = sha256 => { verifiedAssets.add(sha256); };
  const pump = () => {
    while (active < maxConcurrent && queue.length) {
      const task = queue.shift();
      if (task.signal.aborted) { task.reject(task.signal.reason || aborted()); continue; }
      task.signal.removeEventListener('abort', task.cancel);
      active++;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { active--; pump(); });
    }
  };
  const schedule = (run, signal) => new Promise((resolve, reject) => {
    const task = { run, signal, resolve, reject, cancel: () => {
      const index = queue.indexOf(task);
      if (index >= 0) queue.splice(index, 1);
      reject(signal.reason || aborted());
    } };
    check(signal); queue.push(task); signal.addEventListener('abort', task.cancel, { once: true }); pump();
  });
  async function ensure(asset, signal) {
    check(signal);
    if (usesShards(asset)) return ensureShards(asset, signal);
    let cached;
    try { cached = await store.get(asset.sha256); }
    catch (error) { emit({ status: 'storage-unavailable', sha256: asset.sha256 }); throw error; }
    check(signal);
    if (cached) {
      // C-05: a retained asset is not re-hashed here — that streamed every byte through JS
      // hashing on every session for files already verified when written. Integrity is
      // enforced where it is consumed: open() verifies once per asset identity (see below).
      emit({ status: 'retained', sha256: asset.sha256, bytes: asset.size }); return;
    } else emit({ status: 'missing', sha256: asset.sha256 }); // Missing alone does not prove eviction.
    check(signal);
    emit({ status: 'downloading', sha256: asset.sha256 });
    async function download(part, from = signal) {
      const response = await fetcher(part.url, { signal: from, credentials: 'omit', cache: 'default', mode: 'cors' });
      check(from);
      if (!response.ok || response.status !== 200 || response.type === 'opaque') {
        void response.body?.cancel().catch(() => {});
        throw new Error('Asset download requires a readable complete HTTP 200 response');
      }
      return response.body;
    }
    let body;
    if (asset.chunks && globalThis.crypto?.subtle) {
      // Read-ahead (measured on eris, 150 MiB model prefix): chunks fetched one at a time and hashed in
      // JS twice cost 6.8 s of a cold first face, against a link ceiling of 2.7 s with four in flight.
      // Up to `readAhead` 16 MiB chunks are fetched into memory concurrently; each is checked against
      // its pinned digest by the platform's SHA-256 (8x the speed of sha256.mjs, off this thread) and
      // handed on strictly in order. Memory is bounded by readAhead chunks. The whole-asset digest
      // below is unchanged, and nothing commits until it matches at EOF.
      const ahead = [], stop = new AbortController();
      const relay = () => stop.abort(signal.reason || aborted());
      signal.addEventListener('abort', relay, { once: true });
      const release = reason => { signal.removeEventListener('abort', relay); if (reason !== undefined) stop.abort(reason); };
      let started = 0;
      const fill = () => {
        while (ahead.length < readAhead && started < asset.chunks.length) {
          const part = asset.chunks[started++], task = fetchVerifiedChunk(part, download, stop.signal);
          task.catch(() => {}); // surfaced where it is awaited; a later chunk must not become an unhandled rejection
          ahead.push(task);
        }
      };
      body = new ReadableStream({
        async pull(controller) {
          try {
            check(signal); fill();
            if (!ahead.length) { release(); controller.close(); return; }
            const chunk = await ahead.shift();
            check(signal); fill();
            // Network-sized views, not the whole 16 MiB buffer: Firefox failed the first read-ahead build with a
            // NetworkError (caught by the pre-deploy engine matrix), and the progress bar would move in 16 MiB
            // steps. Views share the buffer, so this copies nothing.
            for (let at = 0; at < chunk.byteLength; at += PIECE_BYTES) controller.enqueue(chunk.subarray(at, Math.min(at + PIECE_BYTES, chunk.byteLength)));
          } catch (error) { release(error); controller.error(error); }
        },
        cancel(reason) { release(reason ?? aborted()); }
      });
    } else if (asset.chunks) {
      // No platform digest (very old engines): one chunk at a time, hashed incrementally as before.
      let index = 0, reader;
      body = new ReadableStream({
        async pull(controller) {
          try {
            check(signal);
            while (true) {
              if (!reader) {
                if (index === asset.chunks.length) { controller.close(); return; }
                const part = asset.chunks[index++];
                reader = verifiedStream(await download(part), part, signal).getReader();
              }
              const result = await reader.read();
              if (result.done) { reader.releaseLock(); reader = undefined; continue; }
              controller.enqueue(result.value); return;
            }
          } catch (error) { controller.error(error); await reader?.cancel(error).catch(() => {}); }
        },
        cancel(reason) { return reader?.cancel(reason); }
      });
    } else body = await download(asset);
    const verified = new Response(verifiedStream(counted(body, asset, emit), asset, signal), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size), 'X-CheckFace-SHA256': asset.sha256 }
    });
    try { await store.put(asset.sha256, verified); }
    catch (error) {
      // A backend can reject before consuming (e.g. quota); cancel the unconsumed network stream.
      if (!verified.body.locked) await verified.body.cancel(error).catch(() => {});
      emit({ status: error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'save-failed', sha256: asset.sha256 });
      throw error;
    }
    // A cancellation at commit may leave a fully verified blob: retain it for a later request.
    emit({ status: 'saved', sha256: asset.sha256, bytes: asset.size }); check(signal);
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
  async function digestFailure(body, asset) {
    if (!body) return new Error('Asset response has no readable body');
    const reader = body.getReader(), hash = new Sha256();
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > asset.size) { void reader.cancel(new Error('Asset exceeds declared size')).catch(() => {}); return new Error('Asset exceeds declared size'); }
      hash.update(value);
    }
    if (size !== asset.size || hash.hex() !== asset.sha256) return new Error('Asset integrity mismatch');
    return null;
  }
  async function openVerified(asset, { allowRepair }) {
    let response;
    try { response = await store.get(asset.sha256); }
    catch (error) { emit({ status: 'storage-unavailable', sha256: asset.sha256 }); throw error; }
    if (!response) {
      emit({ status: 'missing-after-acquire', sha256: asset.sha256 });
      if (!allowRepair) throw new Error('Stored asset disappeared; acquire again');
      emit({ status: 'repairing', sha256: asset.sha256 });
      await ensure(asset, new AbortController().signal);
      return openVerified(asset, { allowRepair: false });
    }
    if (verifiedAssets.has(asset.sha256)) return response;
    const failure = await digestFailure(response.body, asset);
    if (!failure) { markVerified(asset.sha256); emit({ status: 'verified', sha256: asset.sha256, bytes: asset.size }); return await store.get(asset.sha256); }
    // Corrupt: drop the identity and its record, then repair once.
    verifiedAssets.delete(asset.sha256);
    await store.remove(asset.sha256).catch(() => {});
    await records.remove(VERIFIED_MARKER + asset.sha256).catch(() => {});
    emit({ status: 'corrupt-removed', sha256: asset.sha256 });
    if (!allowRepair) throw failure;
    emit({ status: 'repairing', sha256: asset.sha256 });
    await ensure(asset, new AbortController().signal);
    return openVerified(asset, { allowRepair: false });
  }
  function acquire(input, { signal } = {}) {
    let asset;
    try { asset = validateAsset(input); check(signal); } catch (error) { return Promise.reject(error); }
    let task = pending.get(asset.sha256);
    if (task && task.asset.size !== asset.size) return Promise.reject(new Error('Conflicting size for identical hash'));
    if (!task) {
      const controller = new AbortController();
      task = { asset, controller, waiters: 0 };
      const current = task;
      const timer = setTimeout(() => controller.abort(new DOMException('Asset acquisition timed out', 'TimeoutError')), timeoutMs);
      task.promise = schedule(() => locks?.request
        ? locks.request(`${MODEL_CACHE_NAME}:${asset.sha256}`, { signal: controller.signal }, () => ensure(asset, controller.signal))
        : ensure(asset, controller.signal), controller.signal).finally(() => {
        clearTimeout(timer); if (pending.get(asset.sha256) === current) pending.delete(asset.sha256);
      });
      pending.set(asset.sha256, task);
    }
    task.waiters++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); task.waiters--;
        if (error) reject(error);
        else if (usesShards(asset)) resolve(Object.freeze({ sha256: asset.sha256, size: asset.size,
          bytes: () => readShards(asset, { allowRepair: true }),
          open: async () => new Response(await readShards(asset, { allowRepair: true })) }));
        else resolve(Object.freeze({ sha256: asset.sha256, size: asset.size,
          bytes: async () => new Uint8Array(await (await openVerified(asset, { allowRepair: true })).arrayBuffer()),
          open: async () => openVerified(asset, { allowRepair: true }) }));
      };
      const cancel = () => {
        finish(signal.reason || aborted());
        if (task.waiters === 0) {
          task.controller.abort(aborted());
          if (pending.get(asset.sha256) === task) pending.delete(asset.sha256);
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      task.promise.then(() => finish(), finish);
      if (signal?.aborted) cancel();
    });
  }
  // Both take an asset descriptor (or, for Cache Storage only, a bare hash). Bytes still in the
  // old Cache Storage entry count as present: the next acquisition moves them without a download.
  async function has(input) {
    const asset = typeof input === 'string' ? null : input, sha256 = asset ? asset.sha256 : input;
    if (asset && usesShards(asset) && !(await missingUnits(asset).catch(() => [asset])).length) return true;
    try { return Boolean(await store.get(sha256)); } catch { return false; }
  }
  async function peek(input) {
    const asset = typeof input === 'string' ? null : input, sha256 = asset ? asset.sha256 : input;
    if (asset && usesShards(asset)) { try { return new Response(await readShards(asset, { allowRepair: false })); } catch { /* fall through */ } }
    try { return (await store.get(sha256)) || null; } catch { return null; }
  }
  return { acquire, records, has, peek };
}

export async function createBrowserModelCache(options = {}) {
  if (!globalThis.caches || !globalThis.location?.origin) throw new Error('Persistent Cache Storage unavailable');
  const cache = await caches.open(MODEL_CACHE_NAME);
  // Native WebViews use tauri:// origins, which Cache Storage rejects as keys.
  // This HTTPS namespace is a local storage key only; no request is sent here.
  const origin = /^https?:\/\//.test(location.origin) ? location.origin : 'https://next.facemorph.me';
  const key = hash => new URL(`/__checkface_model_blobs__/sha256/${hash}`, origin).href;
  const shards = options.shards !== undefined ? options.shards : await openShardStore();
  return createModelCache({ ...options, shards, locks: globalThis.navigator?.locks,
    store: {
      get: hash => cache.match(key(hash)),
      put: (hash, response) => cache.put(key(hash), response),
      remove: hash => cache.delete(key(hash))
    }
  });
}

// Request explicitly from the host UI; no persistence prompt at module import/startup.
export async function storageStatus({ requestPersistence = false, storage = globalThis.navigator?.storage } = {}) {
  if (!storage) return { persistence: 'unavailable', eviction: 'unknown' };
  try {
    const granted = requestPersistence && storage.persist ? await storage.persist() : await storage.persisted?.();
    const estimate = await storage.estimate?.();
    return { persistence: granted === true ? 'granted' : granted === false ? 'not-granted' : 'unavailable',
      usage: estimate?.usage, quota: estimate?.quota, eviction: 'unknown' };
  } catch { return { persistence: 'unavailable', eviction: 'unknown' }; }
}
