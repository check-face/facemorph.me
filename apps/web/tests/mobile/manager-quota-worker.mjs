// Native worker storage only. The host applies the real Chrome quota through CDP.
import * as manager from '/packages/browser-model-manager/index.js';

const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const owner = 'face:mobile-quota';
const asset = { sha256, size: 3, url: new URL('/fixture/good', location.origin).href };
const key = new URL('/__checkface_model_blobs__/sha256/' + sha256, location.origin).href;
let root, directory, shards, raw, cache;
let events = [];
const check = (value, message) => {
  if (!value) throw Error(message);
};
const approval = () => ({
  manifestSha256: sha256,
  route: 'cpu',
  purpose: 'generate',
  assets: [{ sha256, bytes: 3, priority: 'foreground-required' }],
  remainingBytes: 3,
  owners: [owner],
});
const operations = {
  async init({ backend, name }) {
    check(backend === 'opfs' || backend === 'cache-storage', 'Unknown native quota backend');
    directory = name;
    root = backend === 'opfs' ? await navigator.storage.getDirectory() : null;
    shards = root
      ? manager.createShardStore(await root.getDirectoryHandle(name, { create: true }))
      : null;
    raw = await caches.open(manager.MODEL_CACHE_NAME);
    await shards?.remove(sha256);
    await raw.delete(key);
    events = [];
    cache = await manager.createBrowserModelCache({
      shards,
      readAhead: 1,
      retryDelaysMs: [],
      timeoutMs: 10000,
      stallMs: 5000,
      report: (event) => events.push(event.status),
    });
    check(!(await cache.has(asset)), 'Quota fixture was not initially cold');
    return { secureContext: isSecureContext, userAgent: navigator.userAgent, backend };
  },
  async acquire() {
    const grant = approval();
    try {
      const handle = await cache.acquire(asset, { owner, grant });
      return {
        acquired: true,
        bytes: Array.from(await handle.bytes()),
        remainingBytes: manager.grantRemaining(grant),
        events: [...events],
      };
    } catch (error) {
      return {
        acquired: false,
        name: error.name,
        typed: error.error,
        cause: error.cause?.name,
        remainingBytes: manager.grantRemaining(grant),
        events: [...events],
      };
    }
  },
  async read() {
    const result = await cache.local.read(asset);
    return result.ok ? { ok: true, bytes: Array.from(result.value) } : result;
  },
  async cleanup() {
    await shards?.remove(sha256);
    await raw?.delete(key);
    if (root && directory) {
      try {
        await root.removeEntry(directory, { recursive: true });
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    }
    root = shards = raw = cache = null;
    return true;
  },
};
self.onmessage = async ({ data }) => {
  try {
    check(Object.hasOwn(operations, data.method), 'Unknown native quota operation');
    self.postMessage({ id: data.id, value: await operations[data.method](data.options) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.stack || error) });
  }
};
