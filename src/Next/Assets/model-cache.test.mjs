import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from './sha256.mjs';
import { createModelCache, storageStatus } from './model-cache.mjs';

const bytes = new TextEncoder().encode('synthetic model fixture');
const digest = value => createHash('sha256').update(value).digest('hex');
const asset = (value = bytes, url = 'https://models.example/immutable') => ({ sha256: digest(value), size: value.length, url });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(fetcher = async () => new Response(bytes)) {
  const entries = new Map(), events = [], calls = [];
  const store = {
    get: async hash => entries.has(hash) ? new Response(entries.get(hash)) : undefined,
    put: async (hash, response) => { const complete = new Uint8Array(await response.arrayBuffer()); entries.set(hash, complete); },
    remove: async hash => entries.delete(hash)
  };
  const options = { store, fetcher: async (...args) => { calls.push(args[0]); return fetcher(...args); }, report: event => events.push(event) };
  return { entries, events, calls, store, options, cache: createModelCache(options) };
}

test('incremental hash matches independent crypto for vectors and arbitrary chunk boundaries', () => {
  for (const data of [new Uint8Array(), bytes, new TextEncoder().encode('abc'), new Uint8Array(1000000).fill(97), randomBytes(8193)]) {
    for (const stride of [1, 55, 64, 71, 4096]) {
      const hash = new Sha256();
      for(let i=0;i<data.length;i+=stride) hash.update(data.subarray(i,i+stride));
      assert.equal(hash.hex(), digest(data));
    }
  }
});
test('release A/B and CPU/GPU manifests reuse shared hashes, retain old assets, and survive cache instance replacement', async () => {
  const other = new TextEncoder().encode('new GPU graph');
  const f = fixture(async url => new Response(url.endsWith('/new') ? other : bytes));
  await f.cache.acquire(asset());
  await f.cache.acquire(asset(bytes, 'https://models.example/version-b/shared'));
  await f.cache.acquire(asset(other, 'https://models.example/new'));
  const restarted = createModelCache(f.options);
  const handle = await restarted.acquire(asset());
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), bytes);
  assert.equal(f.calls.length, 2); assert.equal(f.entries.size, 2);
});
test('concurrent subscribers share download; cancelling one does not cancel another', async () => {
  let release;
  const f = fixture(async () => { await new Promise(resolve => { release = resolve; }); return new Response(bytes); });
  const controller = new AbortController();
  const first = f.cache.acquire(asset(), { signal: controller.signal });
  const failed = assert.rejects(first, { name: 'AbortError' });
  const second = f.cache.acquire(asset());
  await pause(); controller.abort(); release(); await failed; await second;
  assert.equal(f.calls.length, 1); assert.equal(f.entries.size, 1);
});
test('all subscribers cancel; immediate fresh request succeeds without inheriting cancelled task', async () => {
  let attempt = 0;
  const f = fixture(async (_, { signal }) => {
    if (++attempt > 1) return new Response(bytes);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const first = f.cache.acquire(asset(), { signal: controller.signal });
  const failed = assert.rejects(first, { name: 'AbortError' });
  await pause(); controller.abort(); const next = f.cache.acquire(asset());
  await failed; await next; assert.equal(f.calls.length, 2);
});
test('corrupt retained bytes are removed and replaced; invalid network data never commits', async () => {
  const f = fixture(); f.entries.set(asset().sha256, new Uint8Array(bytes.length));
  await f.cache.acquire(asset()); assert.equal(f.calls.length, 1);
  assert.ok(f.events.some(e => e.status === 'corrupt-removed'));
  for (const wrong of [new Uint8Array(bytes.length), bytes.slice(1), new Uint8Array(bytes.length+1)]) {
    const bad = fixture(async () => new Response(wrong));
    await assert.rejects(bad.cache.acquire(asset()), /integrity|declared size/);
    assert.equal(bad.entries.size, 0);
  }
});
test('mid-stream cancellation prevents partial commits and completes promptly', async () => {
  let cancelled = false;
  const f = fixture(async () => new Response(new ReadableStream({
    start(c) { c.enqueue(bytes.slice(0, 2)); }, cancel() { cancelled = true; }
  })));
  const controller = new AbortController();
  const result = f.cache.acquire(asset(), { signal: controller.signal });
  const failed = assert.rejects(result, { name: 'AbortError' });
  await pause(); controller.abort(); await failed; await pause();
  assert.equal(f.entries.size, 0); assert.equal(cancelled, true);
});
test('quota rejection is visible, preserves old entries, and does not trigger a retry loop', async () => {
  const f = fixture(); f.entries.set('old-project-model', bytes);
  f.store.put = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
  await assert.rejects(f.cache.acquire(asset()), { name: 'QuotaExceededError' });
  assert.equal(f.calls.length, 1); assert.equal(f.entries.size, 1);
  assert.equal(f.events.at(-1).status, 'quota-exceeded');
});
test('bounded timeout aborts a stalled response body', async () => {
  const f = fixture(async () => new Response(new ReadableStream({ start() {} })));
  const cache = createModelCache({ ...f.options, timeoutMs: 15 });
  await assert.rejects(cache.acquire(asset()), { name: 'TimeoutError' });
  assert.equal(f.entries.size, 0);
});
test('bounded concurrency and cancellation while queued avoid excess transfers', async () => {
  let release;
  const f = fixture(async () => { await new Promise(resolve => { release=resolve; }); return new Response(bytes); });
  const cache = createModelCache({ ...f.options, maxConcurrent: 1 });
  const first = cache.acquire(asset());
  const controller = new AbortController();
  const second = cache.acquire(asset(new Uint8Array([1])), { signal: controller.signal });
  const failed = assert.rejects(second, { name: 'AbortError' });
  await pause(); controller.abort(); await failed; release(); await first;
  assert.equal(f.calls.length, 1);
});
test('cancelled retained-file validation must not evict the stored asset', async () => {
  const f = fixture(); f.entries.set(asset().sha256, bytes);
  f.store.get = async () => new Response(new ReadableStream({ start() {} }));
  const controller = new AbortController();
  const first = f.cache.acquire(asset(), { signal: controller.signal });
  const failed = assert.rejects(first, { name: 'AbortError' });
  await pause(); controller.abort(); await failed; await pause();
  assert.equal(f.entries.size, 1); assert.equal(f.calls.length, 0);
});
test('eviction after acquire is reported without pretending to know its cause', async () => {
  const f = fixture(); const handle = await f.cache.acquire(asset());
  f.entries.clear(); await assert.rejects(handle.open(), /disappeared/);
  assert.equal(f.events.at(-1).status, 'missing-after-acquire');
  await f.cache.acquire(asset()); assert.equal(f.calls.length, 2);
});
test('persistence granted/denied/unsupported/failure is explicit', async () => {
  assert.equal((await storageStatus({ storage: {} })).persistence, 'unavailable');
  assert.equal((await storageStatus({ storage: { persisted: async () => false } })).persistence, 'not-granted');
  const result = await storageStatus({ requestPersistence: true, storage: { persist: async () => true, estimate: async () => ({ usage: 4, quota: 9 }) } });
  assert.deepEqual(result, { persistence: 'granted', usage: 4, quota: 9, eviction: 'unknown' });
  assert.equal((await storageStatus({ storage: { persisted: async () => { throw Error(); } } })).persistence, 'unavailable');
});
test('rejects opaque/partial responses and invalid identities', async () => {
  const f = fixture(async () => new Response(bytes, { status: 206 }));
  await assert.rejects(f.cache.acquire(asset()), /HTTP 200/);
  await assert.rejects(f.cache.acquire({ ...asset(), sha256: 'latest' }), TypeError);
  await assert.rejects(f.cache.acquire({ ...asset(), url: 'http://models.example/a' }), TypeError);
  assert.equal(f.entries.size, 0);
});
test('cooperating instances recheck shared storage inside the per-hash lock', async () => {
  const f = fixture(); let tail = Promise.resolve();
  const locks = { request: async (name, { signal }, run) => {
    assert.ok(name.endsWith(asset().sha256));
    const prior = tail; let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await prior;
    try { if (signal.aborted) throw signal.reason; return await run(); }
    finally { unlock(); }
  } };
  const a = createModelCache({ ...f.options, locks }), b = createModelCache({ ...f.options, locks });
  await Promise.all([a.acquire(asset()), b.acquire(asset())]);
  assert.equal(f.calls.length, 1);
});
test('handle read detects bytes changed by another context after acquisition', async () => {
  const f = fixture(); const handle = await f.cache.acquire(asset());
  f.entries.set(asset().sha256, new Uint8Array(bytes.length));
  await assert.rejects((await handle.open()).arrayBuffer(), /integrity/);
});
test('conflicting sizes cannot join pending work for the same hash', async () => {
  const f = fixture(); const first = f.cache.acquire(asset());
  await assert.rejects(f.cache.acquire({ ...asset(), size: bytes.length + 1 }), /Conflicting size/);
  await first; assert.equal(f.calls.length, 1);
});
