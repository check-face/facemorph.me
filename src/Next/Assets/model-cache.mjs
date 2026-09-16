import { Sha256 } from './sha256.mjs';

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
async function drain(stream) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* validate without accumulating bytes */ }
}

/** Store contract: get(hash) -> fresh Response|undefined; put(hash, Response)
 * MUST consume the stream and commit atomically only after successful EOF;
 * remove(hash) removes only that corrupt identity. Never expose partial writes.
 * Observers receive hashes/status only (no URLs or authentication material).
 */
export function createModelCache({ store, fetcher = globalThis.fetch, locks,
  timeoutMs = 300000, maxConcurrent = 2, report = () => {} }) {
  if (!store || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1)
    throw new TypeError('Invalid cache settings');
  const pending = new Map(), queue = [];
  let active = 0;
  const emit = event => { try { report(event); } catch { /* observers cannot break storage */ } };
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
    let cached;
    try { cached = await store.get(asset.sha256); }
    catch (error) { emit({ status: 'storage-unavailable', sha256: asset.sha256 }); throw error; }
    check(signal);
    if (cached) {
      try {
        await drain(verifiedStream(cached.body, asset, signal));
        emit({ status: 'retained', sha256: asset.sha256, bytes: asset.size }); return;
      } catch (error) {
        check(signal); // Cancellation must never evict a valid entry.
        await store.remove(asset.sha256);
        emit({ status: 'corrupt-removed', sha256: asset.sha256 });
      }
    } else emit({ status: 'missing', sha256: asset.sha256 }); // Missing alone does not prove eviction.
    check(signal);
    emit({ status: 'downloading', sha256: asset.sha256 });
    async function download(part) {
      const response = await fetcher(part.url, { signal, credentials: 'omit', cache: 'default', mode: 'cors' });
      check(signal);
      if (!response.ok || response.status !== 200 || response.type === 'opaque') {
        void response.body?.cancel().catch(() => {});
        throw new Error('Asset download requires a readable complete HTTP 200 response');
      }
      return response.body;
    }
    let body;
    if (asset.chunks) {
      // Pull one verified chunk at a time. Neither a whole model nor all chunks
      // accumulate in JS memory; the existing atomic store commits only at EOF.
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
    const verified = new Response(verifiedStream(body, asset, signal), {
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
        else resolve(Object.freeze({ sha256: asset.sha256, size: asset.size, open: async () => {
          const response = await store.get(asset.sha256);
          if (!response) { emit({ status: 'missing-after-acquire', sha256: asset.sha256 }); throw new Error('Stored asset disappeared; acquire again'); }
          // Verify on consumption as well, in case another context modified the store.
          return new Response(verifiedStream(response.body, asset, new AbortController().signal), { headers: response.headers });
        } }));
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
  return { acquire };
}

export async function createBrowserModelCache(options = {}) {
  if (!globalThis.caches || !globalThis.location?.origin) throw new Error('Persistent Cache Storage unavailable');
  const cache = await caches.open(MODEL_CACHE_NAME);
  // Native WebViews use tauri:// origins, which Cache Storage rejects as keys.
  // This HTTPS namespace is a local storage key only; no request is sent here.
  const origin = /^https?:\/\//.test(location.origin) ? location.origin : 'https://next.facemorph.me';
  const key = hash => new URL(`/__checkface_model_blobs__/sha256/${hash}`, origin).href;
  return createModelCache({ ...options, locks: globalThis.navigator?.locks,
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
