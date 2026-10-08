// Cross-engine storage suite for opfs-shard-cache-v1: the real model-cache.mjs + shard-store.mjs, no inference.
// Runs where it is imported (a dedicated worker, or the page's main thread) and reports what that context supports.
import { createModelCache, MODEL_CACHE_NAME } from '/src/Next/Assets/model-cache.mjs';
import { openShardStore, SHARD_DIRECTORY } from '/src/Next/Assets/shard-store.mjs';
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const sha = async b => hex(await crypto.subtle.digest('SHA-256', b));
const equal = (a, b) => a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
function bytesOf(n, seed) { const out = new Uint8Array(n); let x = seed >>> 0 || 1; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; out[i] = x; } return out; }
async function makeAsset(name, chunkBytes, count, seed) {
  const chunks = [], parts = [];
  for (let i = 0; i < count; i++) { const b = bytesOf(chunkBytes, seed + i); parts.push(b); chunks.push({ sha256: await sha(b), size: b.length, url: `https://models.test/${name}.${i}` }); }
  const whole = new Uint8Array(chunkBytes * count); parts.forEach((p, i) => whole.set(p, i * chunkBytes));
  return { whole, parts, asset: { sha256: await sha(whole), size: whole.length, url: `https://models.test/${name}`, chunks } };
}
export async function run() {
  const out = { context: typeof window === 'undefined' ? 'worker' : 'main', ua: navigator.userAgent, steps: [] };
  const step = (name, ok, extra = {}) => out.steps.push({ name, ok, ...extra });
  const shards = await openShardStore();
  out.backend = shards ? 'opfs' : 'cache-storage';
  if (!shards) { out.ok = true; return out; } // fallback is the existing, separately tested path
  const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle(SHARD_DIRECTORY);
  for await (const [name] of dir.entries()) await dir.removeEntry(name);
  const legacy = await caches.open(MODEL_CACHE_NAME);
  const small = await makeAsset('small', 64 * 1024, 3, 7);
  const serve = new Map(small.asset.chunks.map((c, i) => [c.url, small.parts[i]]));
  let calls = [];
  const fetcher = async url => { calls.push(url); return new Response(serve.get(url)); };
  const legacyKey = h => `https://next.facemorph.me/__checkface_model_blobs__/sha256/${h}`;
  const store = { get: h => legacy.match(legacyKey(h)), put: (h, r) => legacy.put(legacyKey(h), r), remove: h => legacy.delete(legacyKey(h)) };
  const cache = () => createModelCache({ store, shards, fetcher, locks: navigator.locks });
  await (await cache().acquire(small.asset));
  step('download writes one file per unit', calls.length === 3, { calls: calls.length });
  calls = [];
  step('later session reads with no network', equal(await (await cache().acquire(small.asset)).bytes(), small.whole) && calls.length === 0);
  // Damage three ways through the platform's own file API.
  const [a, b, c] = small.asset.chunks;
  { const h = await dir.getFileHandle(a.sha256), bytes = new Uint8Array(await (await h.getFile()).arrayBuffer()); bytes[100] ^= 0xff; await overwrite(h, bytes); }
  { const h = await dir.getFileHandle(b.sha256), bytes = new Uint8Array(await (await h.getFile()).slice(0, b.size).arrayBuffer()); await overwrite(h, bytes); }
  await dir.removeEntry(c.sha256);
  calls = [];
  const c2 = cache(), repaired = await (await c2.acquire(small.asset)).bytes();
  step('flipped byte, missing trailer and deleted unit repair exactly those units', equal(repaired, small.whole) && calls.length === 3, { calls: calls.length });
  calls = [];
  step('repaired units stay hits', equal(await (await cache().acquire(small.asset)).bytes(), small.whole) && calls.length === 0);
  // Migration from the Cache Storage backend.
  for await (const [name] of dir.entries()) await dir.removeEntry(name);
  await store.put(small.asset.sha256, new Response(small.whole));
  calls = [];
  await cache().acquire(small.asset);
  step('Cache Storage bytes migrate without a download and the old entry is dropped', calls.length === 0 && !(await store.get(small.asset.sha256)) && equal(await (await cache().acquire(small.asset)).bytes(), small.whole));
  // Throughput: 10 x 16 MiB, written once, then read + digest-verified by a fresh cache instance.
  const big = await makeAsset('big', 16 * 1024 * 1024, 10, 99);
  big.asset.chunks.forEach((ch, i) => serve.set(ch.url, big.parts[i]));
  await cache().acquire(big.asset);
  const times = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); const got = await (await cache().acquire(big.asset)).bytes(); times.push(performance.now() - t); if (i === 0) step('160 MiB round trip is exact', equal(got, big.whole)); }
  const tJs = performance.now(); { const { Sha256 } = await import('/src/Next/Assets/sha256.mjs'); const h = new Sha256(); for (const p of big.parts) h.update(p); h.hex(); } const jsMs = performance.now() - tJs;
  out.read160MiBms = times.map(Math.round); out.jsSha160MiBms = Math.round(jsMs);
  for await (const [name] of dir.entries()) await dir.removeEntry(name);
  out.ok = out.steps.every(s => s.ok);
  return out;
}
async function overwrite(handle, bytes) {
  if (handle.createWritable) { const w = await handle.createWritable(); await w.write(bytes); await w.close(); return; }
  const s = await handle.createSyncAccessHandle(); s.truncate(0); s.write(bytes, { at: 0 }); s.flush(); s.close();
}
