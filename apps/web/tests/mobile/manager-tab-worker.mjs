// Two actual tabs share native storage, Web Locks and the package deletion channel.
// No loaded engine capability or inference session is fabricated by this component.
import * as manager from '/packages/browser-model-manager/index.js';

const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const bytes = new TextEncoder().encode('abc');
const asset = { sha256, size: 3, url: new URL('/fixture/offline', location.origin).href };
let root, directory, shards, raw, cache, registry, channel, unsubscribe;
let leases = [],
  invalidations = [];
const key = new URL('/__checkface_model_blobs__/sha256/' + sha256, location.origin).href;
const check = (value, message) => {
  if (!value) throw Error(message);
};
const store = {
  remove: async () => {
    await shards?.remove(sha256);
    await raw?.delete(key);
  },
};
const operations = {
  async init({ backend, name }) {
    directory = name;
    root = backend === 'opfs' ? await navigator.storage.getDirectory() : null;
    shards = root
      ? manager.createShardStore(await root.getDirectoryHandle(name, { create: true }))
      : null;
    raw = await caches.open(manager.MODEL_CACHE_NAME);
    cache = await manager.createBrowserModelCache({ shards, retryDelaysMs: [] });
    registry = manager.createLeaseRegistry({ locks: navigator.locks });
    invalidations = [];
    channel = new BroadcastChannel(manager.DELETION_CHANNEL);
    unsubscribe = manager.listenForDeletions(channel, registry);
    return { userAgent: navigator.userAgent, secureContext: isSecureContext };
  },
  async seed() {
    await store.remove();
    if (shards) await shards.write(sha256, bytes);
    else await raw.put(key, new Response(bytes));
    return true;
  },
  async read() {
    const result = await cache.local.read(asset);
    return result.ok ? { ok: true, bytes: Array.from(result.value) } : result;
  },
  async lease() {
    leases = registry.lease([{ sha256, bytes: 3 }], {
      invalidated(cause, error) {
        invalidations.push({ cause, code: error.code });
      },
    });
    // Observe native lock acquisition; a queued request alone cannot prove a held lease.
    for (let i = 0; i < 500; i++) {
      if (
        (await navigator.locks.query()).held.some((lock) => lock.name === manager.lockName(sha256))
      )
        return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error('Native shared asset lock never became held');
  },
  evict: () => manager.evictUnleased([sha256], [store], registry, navigator.locks),
  remove: () => manager.deleteAssets([sha256], [store], channel),
  invalidations: () => invalidations,
  release() {
    for (const lease of leases) lease.release();
    leases = [];
    return registry?.leased() || [];
  },
  async exclusive() {
    return navigator.locks.request(
      manager.lockName(sha256),
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => !!lock,
    );
  },
  async cleanup() {
    operations.release();
    unsubscribe?.();
    channel?.close();
    await store.remove();
    if (root && directory) {
      try {
        await root.removeEntry(directory, { recursive: true });
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    }
    return true;
  },
};
self.onmessage = async ({ data }) => {
  try {
    check(Object.hasOwn(operations, data.method), 'Unknown native tab operation');
    self.postMessage({ id: data.id, value: await operations[data.method](data.options) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.stack || error) });
  }
};
