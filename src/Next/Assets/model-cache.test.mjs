import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from './sha256.mjs';
import { createModelCache, createBrowserModelCache, storageStatus } from './model-cache.mjs';

const bytes = new TextEncoder().encode('synthetic model fixture');
const digest = value => createHash('sha256').update(value).digest('hex');
const asset = (value = bytes, url = 'https://models.example/immutable') => ({ sha256: digest(value), size: value.length, url });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(fetcher = async () => new Response(bytes)) {
  const entries = new Map(), events = [], calls = [];
  // Derived records (verified markers, canary qualifications) share the store under non-hex
  // keys; asset-byte assertions count only real asset identities.
  const assetEntries = () => [...entries.keys()].filter(key => /^[0-9a-f]{64}$/.test(key));
  const store = {
    get: async hash => entries.has(hash) ? new Response(entries.get(hash)) : undefined,
    put: async (hash, response) => { const complete = new Uint8Array(await response.arrayBuffer()); entries.set(hash, complete); },
    remove: async hash => entries.delete(hash)
  };
  const options = { store, fetcher: async (...args) => { calls.push(args[0]); return fetcher(...args); }, report: event => events.push(event) };
  return { entries, events, calls, assetEntries, store, options, cache: createModelCache(options) };
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
  assert.equal(f.calls.length, 2); assert.equal(f.assetEntries().length, 2);
});
test('concurrent subscribers share download; cancelling one does not cancel another', async () => {
  let release;
  const f = fixture(async () => { await new Promise(resolve => { release = resolve; }); return new Response(bytes); });
  const controller = new AbortController();
  const first = f.cache.acquire(asset(), { signal: controller.signal });
  const failed = assert.rejects(first, { name: 'AbortError' });
  const second = f.cache.acquire(asset());
  await pause(); controller.abort(); release(); await failed; await second;
  assert.equal(f.calls.length, 1); assert.equal(f.assetEntries().length, 1);
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
test('corrupt retained bytes fail on first open, are removed, and the next acquire downloads fresh; invalid network data never commits', async () => {
  const f = fixture(); f.entries.set(asset().sha256, new Uint8Array(bytes.length));
  const handle = await f.cache.acquire(asset()); assert.equal(f.calls.length, 0, 'a retained hit does not re-download');
  await assert.rejects((await handle.open()).arrayBuffer(), /integrity/);
  assert.equal(f.assetEntries().length, 0, 'the corrupt identity is removed');
  assert.ok(f.events.some(e => e.status === 'corrupt-removed'));
  await f.cache.acquire(asset()); assert.equal(f.calls.length, 1);
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
test('a retained hit is answered without reading bytes or the network; its first open verifies once', async () => {
  const f = fixture(); f.entries.set(asset().sha256, bytes);
  f.store.get = async () => new Response(new ReadableStream({ start() {} }));
  const controller = new AbortController();
  const handle = await f.cache.acquire(asset(), { signal: controller.signal });
  controller.abort(); await pause();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.events.map(e => e.status), ['retained'], 'no verification happens at acquire time');
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
test('a handle read detects bytes changed by another context until the asset is verified', async () => {
  const f = fixture(); f.entries.set(asset().sha256, bytes); // stored by an earlier version: no marker yet
  const handle = await f.cache.acquire(asset());
  f.entries.set(asset().sha256, new Uint8Array(bytes.length));
  await assert.rejects((await handle.open()).arrayBuffer(), /integrity/);
  assert.equal(f.assetEntries().length, 0);
});

test('two warm generations perform at most one full-asset digest (C-05)', async () => {
  const f = fixture(); f.entries.set(asset().sha256, bytes); // present but never verified
  const generate = async () => {
    const handle = await f.cache.acquire(asset());
    return new Uint8Array(await (await handle.open()).arrayBuffer());
  };
  assert.deepEqual(await generate(), bytes);
  assert.deepEqual(await generate(), bytes);
  const verified = f.events.filter(e => e.status === 'verified' && e.sha256 === asset().sha256);
  assert.equal(verified.length, 1, `full digests across two warm generations: ${verified.length}`);
  assert.equal(f.calls.length, 0, 'a warm generation never touches the network');
});

test('downloaded bytes are marked verified, so no later open re-hashes them', async () => {
  const f = fixture();
  await f.cache.acquire(asset());
  f.events.length = 0; f.calls.length = 0;
  const handle = await f.cache.acquire(asset());
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), bytes);
  assert.equal(f.events.filter(e => e.status === 'verified').length, 0, 'the download already verified these bytes');
  assert.equal(f.calls.length, 0);
  const record = await f.cache.records.get('verified:' + asset().sha256);
  assert.equal(record?.sha256, asset().sha256, 'the durable verified-asset marker was recorded');
});
test('conflicting sizes cannot join pending work for the same hash', async () => {
  const f = fixture(); const first = f.cache.acquire(asset());
  await assert.rejects(f.cache.acquire({ ...asset(), size: bytes.length + 1 }), /Conflicting size/);
  await first; assert.equal(f.calls.length, 1);
});

test('static-host chunks reconstruct exact model and retain URL-independent cache identity', async () => {
  const parts = [bytes.slice(0, 7), bytes.slice(7)];
  const chunks = parts.map((part, i) => asset(part, `https://models.example/chunk-${i}`));
  const f = fixture(async url => new Response(parts[Number(url.slice(-1))]));
  const handle = await f.cache.acquire({...asset(), chunks});
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), bytes);
  await f.cache.acquire(asset());
  assert.deepEqual(f.calls, chunks.map(part => part.url));
});
test('corrupt chunk cannot commit a partial model', async () => {
  const parts = [bytes.slice(0, 7), bytes.slice(7)];
  const chunks = parts.map((part, i) => asset(part, `https://models.example/chunk-${i}`));
  const f = fixture(async url => new Response(url.endsWith('0') ? parts[0] : new Uint8Array(parts[1].length)));
  await assert.rejects(f.cache.acquire({...asset(), chunks}), /integrity/);
  assert.equal(f.entries.size, 0);
  await assert.rejects(f.cache.acquire({...asset(), chunks: chunks.slice(0, 1)}), /sizes/);
});


test('native WebView uses HTTPS cache keys without fetching the logical key origin', async () => {
  const oldLocation=globalThis.location, oldCaches=globalThis.caches, entries=new Map(), requested=[];
  globalThis.location={origin:'tauri://localhost'};
  globalThis.caches={open:async()=>({match:async key=>entries.get(key)?.clone(),put:async(key,response)=>{assert.match(key,/^https:\/\//);entries.set(key,new Response(await response.arrayBuffer()));},delete:async key=>entries.delete(key)})};
  try {
    const cache=await createBrowserModelCache({fetcher:async url=>{requested.push(url);return new Response(bytes);}});
    const handle=await cache.acquire(asset());
    assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()),bytes);
    assert.deepEqual(requested,[asset().url]);
  } finally {if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;}
});

test('a download reports bytes as they arrive, not just 0 and then the whole asset', async () => {
  // C-10: the observable defect was a bar that sat at zero through a 158 MB download and then
  // jumped. Stream a multi-megabyte asset in realistic chunks and require real intermediate
  // readings that only ever increase and end at the exact declared size.
  const big = randomBytes(5 * 1024 * 1024 + 7);
  const chunk = 256 * 1024;
  const f = fixture(async () => new Response(new ReadableStream({
    start(controller) {
      for (let at = 0; at < big.length; at += chunk) controller.enqueue(new Uint8Array(big.subarray(at, at + chunk)));
      controller.close();
    }
  })));
  const item = asset(big, 'https://models.example/large');
  await f.cache.acquire(item);
  const ticks = f.events.filter(e => e.status === 'progress');
  assert.ok(ticks.length >= 4, `only ${ticks.length} intermediate readings`);
  for (const tick of ticks) { assert.equal(tick.sha256, item.sha256); assert.equal(tick.bytes, item.size); }
  const loaded = ticks.map(t => t.loaded);
  assert.deepEqual(loaded, [...loaded].sort((a, b) => a - b));
  assert.equal(new Set(loaded).size, loaded.length, 'a reading repeated instead of advancing');
  assert.ok(loaded[0] > 0 && loaded.at(-1) <= item.size);
  assert.equal(f.events.at(-1).status, 'saved');
  // Counting never alters the bytes the store commits.
  assert.deepEqual(new Uint8Array(f.entries.get(item.sha256)), new Uint8Array(big));
});

test('an asset already held reports no download ticks at all', async () => {
  const f = fixture();
  await f.cache.acquire(asset());
  f.events.length = 0;
  await f.cache.acquire(asset());
  assert.deepEqual(f.events.map(e => e.status), ['retained']);
});
