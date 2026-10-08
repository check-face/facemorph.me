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
test('corrupt retained bytes are repaired on open: removed, re-downloaded, good bytes returned; invalid network data never commits', async () => {
  const f = fixture(); f.entries.set(asset().sha256, new Uint8Array(bytes.length));
  const handle = await f.cache.acquire(asset()); assert.equal(f.calls.length, 0, 'a retained hit does not re-download');
  const repaired = new Uint8Array(await (await handle.open()).arrayBuffer());
  assert.deepEqual([...repaired], [...bytes], 'open() must hand back verified bytes, not the corrupt ones');
  assert.equal(f.calls.length, 1, 'repair re-downloaded the identity');
  assert.equal(f.assetEntries().length, 1, 'the repaired bytes are stored');
  assert.ok(f.events.some(e => e.status === 'corrupt-removed'));
  assert.ok(f.events.some(e => e.status === 'repairing'));
  const again = new Uint8Array(await (await f.cache.acquire(asset()).then(h => h.open())).arrayBuffer());
  assert.deepEqual([...again], [...bytes], 'the repaired identity stays a hit');
  assert.equal(f.calls.length, 1);
  for (const wrong of [new Uint8Array(bytes.length), bytes.slice(1), new Uint8Array(bytes.length+1)]) {
    const bad = fixture(async () => new Response(wrong));
    await assert.rejects(bad.cache.acquire(asset()), /integrity|declared size/);
    assert.equal(bad.entries.size, 0);
  }
});
test('a stale durable marker from an older version never bypasses verification: corrupt bytes are repaired and the marker is cleaned', async () => {
  // The 19 September regression: a durable marker vouched for bytes it could not see change
  // underneath, so corrupt bytes were served unverified (iOS 27 Safari, Android Chrome 124).
  const f = fixture();
  f.entries.set(asset().sha256, new Uint8Array(bytes.length)); // corrupt bytes underneath
  f.entries.set('verified:' + asset().sha256,
    new TextEncoder().encode(JSON.stringify({ schema: 'checkface-verified-asset-v1', sha256: asset().sha256 })));
  const served = new Uint8Array(await (await f.cache.acquire(asset()).then(h => h.open())).arrayBuffer());
  assert.deepEqual([...served], [...bytes], 'the stale marker must not vouch for bytes it cannot see');
  assert.equal(f.entries.has('verified:' + asset().sha256), false, 'the stale marker is cleaned on touch');
  assert.ok(f.events.some(e => e.status === 'corrupt-removed'));
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
test('eviction after acquire is reported honestly, then repaired by re-downloading', async () => {
  const f = fixture(); const handle = await f.cache.acquire(asset());
  f.entries.clear();
  const served = new Uint8Array(await (await handle.open()).arrayBuffer());
  assert.deepEqual([...served], [...bytes], 'a vanished entry is repaired, not fatal');
  assert.ok(f.events.some(e => e.status === 'missing-after-acquire'), 'the missing state is reported as itself');
  assert.ok(f.events.some(e => e.status === 'repairing'));
  assert.equal(f.calls.length, 2, 'repair re-downloaded once');
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
test('bytes changed by another context are detected on first open and repaired', async () => {
  const f = fixture(); f.entries.set(asset().sha256, bytes); // stored by an earlier version: no mark yet
  const handle = await f.cache.acquire(asset());
  f.entries.set(asset().sha256, new Uint8Array(bytes.length)); // another context corrupts them
  const served = new Uint8Array(await (await handle.open()).arrayBuffer());
  assert.deepEqual([...served], [...bytes], 'the mismatch is repaired from the network');
  assert.ok(f.events.some(e => e.status === 'corrupt-removed'));
  assert.equal(f.calls.length, 1);
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

test('downloaded bytes are marked verified for the session, so no later open re-hashes them', async () => {
  const f = fixture();
  await f.cache.acquire(asset());
  f.events.length = 0; f.calls.length = 0;
  const handle = await f.cache.acquire(asset());
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), bytes);
  assert.equal(f.events.filter(e => e.status === 'verified').length, 0, 'the download already verified these bytes');
  assert.equal(f.calls.length, 0);
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


// Read-ahead (eris, 150 MiB prefix: sequential chunk fetch + double JS hash = 6.8 s cold; 2.7 s link ceiling).
const pieces = (count, size = 5) => Array.from({ length: count }, (_, i) => Uint8Array.from({ length: size }, (_, j) => (i * 31 + j * 7) & 255));
const joined = parts => Uint8Array.from(parts.flatMap(part => [...part]));
const chunkAsset = parts => ({ ...asset(joined(parts)), chunks: parts.map((part, i) => asset(part, `https://models.example/chunk-${i}`)) });
test('read-ahead fetches up to the window concurrently and commits the exact bytes in order', async () => {
  const parts = pieces(6), waiting = [];
  const f = fixture(url => new Promise(resolve => waiting.push(() => resolve(new Response(parts[Number(url.split('-')[1])])))));
  const cache = createModelCache({ ...f.options, readAhead: 3 });
  const done = cache.acquire(chunkAsset(parts));
  await pause(); await pause();
  assert.equal(f.calls.length, 3, 'three chunks in flight before any has arrived');
  while (waiting.length || f.calls.length < 6) { waiting.splice(0).forEach(release => release()); await pause(); }
  const handle = await done;
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), joined(parts));
  assert.deepEqual(f.calls, parts.map((_, i) => `https://models.example/chunk-${i}`), 'requested in order');
});
test('read-ahead is bounded: a stalled writer holds the window, not the whole model', async () => {
  const parts = pieces(20);
  const f = fixture(async url => new Response(parts[Number(url.split('-')[1])]));
  let release; const gate = new Promise(resolve => { release = resolve; });
  const store = { ...f.store, put: async (hash, response) => { await gate; return f.store.put(hash, response); } };
  const cache = createModelCache({ ...f.options, store, readAhead: 2 });
  const done = cache.acquire(chunkAsset(parts));
  for (let i = 0; i < 20; i++) await pause();
  assert.ok(f.calls.length <= 2 + 3, `fetched ${f.calls.length} chunks with the writer stalled`);
  release(); await done;
  assert.equal(f.calls.length, 20);
});
test('read-ahead hands the store network-sized pieces, never a whole chunk (Firefox NetworkError, pre-deploy matrix)', async () => {
  const parts = pieces(3, 600 * 1024), seen = [];
  const f = fixture(async url => new Response(parts[Number(url.split('-')[1])]));
  const store = { ...f.store, put: async (hash, response) => {
    const reader = response.body.getReader(), got = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; seen.push(value.byteLength); got.push(value); }
    f.entries.set(hash, joined(got));
  } };
  const cache = createModelCache({ ...f.options, store, readAhead: 2 });
  const handle = await cache.acquire(chunkAsset(parts));
  assert.deepEqual(new Uint8Array(await (await handle.open()).arrayBuffer()), joined(parts));
  assert.ok(Math.max(...seen) <= 256 * 1024, `largest piece handed to the store was ${Math.max(...seen)} bytes`);
  assert.ok(seen.length >= 3 * 3, 'progress can move in pieces, not chunk-sized steps');
});
test('a corrupt chunk under read-ahead aborts the other downloads and commits nothing', async () => {
  const parts = pieces(5), signals = [];
  const f = fixture(async (url, init) => {
    signals.push(init.signal); const i = Number(url.split('-')[1]);
    if (i < 3) return new Response(parts[i]);
    if (i === 3) return new Response(new Uint8Array(parts[i].length));
    return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true }); } }));
  });
  const cache = createModelCache({ ...f.options, readAhead: 4 });
  await assert.rejects(cache.acquire(chunkAsset(parts)), /integrity|abort/i);
  await pause();
  assert.equal(f.assetEntries().length, 0);
  assert.ok(signals.length >= 2 && signals.every(signal => signal.aborted), 'every download still in flight was cancelled');
});
test('readAhead is validated', () => {
  const f = fixture();
  for (const bad of [0, -1, 1.5, 9, '2']) assert.throws(() => createModelCache({ ...f.options, readAhead: bad }), /Invalid cache settings/);
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

// ---- OPFS shard store: per-unit files, digest on every read, no marker of any kind ----
import { createShardStore, TRAILER_BYTES } from './shard-store.mjs';
function fakeDirectory({ syncOnly = false } = {}) {
  const files = new Map();
  const handle = name => {
    const h = {
      getFile: async () => { if (!files.has(name)) throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); return new Blob([files.get(name)]); }
    };
    if (syncOnly) h.createSyncAccessHandle = async () => {
      let data = files.get(name) || new Uint8Array();
      return {
        truncate: n => { data = data.slice(0, n); files.set(name, data); },
        write: (bytes, { at }) => { const next = new Uint8Array(Math.max(data.length, at + bytes.byteLength)); next.set(data); next.set(bytes, at); data = next; files.set(name, data); return bytes.byteLength; },
        flush: () => {}, close: () => {}
      };
    };
    else h.createWritable = async () => {
      const parts = [];
      return { write: async bytes => { parts.push(new Uint8Array(bytes)); }, close: async () => { files.set(name, new Uint8Array(await new Blob(parts).arrayBuffer())); }, abort: async () => {} };
    };
    return h;
  };
  return {
    files,
    getFileHandle: async (name, { create = false } = {}) => {
      if (!files.has(name) && !create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      if (!files.has(name)) files.set(name, new Uint8Array());
      return handle(name);
    },
    removeEntry: async name => { if (!files.delete(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); }
  };
}
const shardModel = randomBytes(5000);
const unitPieces = [shardModel.subarray(0, 2048), shardModel.subarray(2048, 4096), shardModel.subarray(4096)];
const chunked = () => ({ sha256: digest(shardModel), size: shardModel.length, url: 'https://models.example/model',
  chunks: unitPieces.map((piece, i) => ({ sha256: digest(piece), size: piece.length, url: `https://models.example/model.${i}` })) });
function shardFixture(options = {}) {
  const dir = fakeDirectory(options), f = fixture(async url => new Response(/\.\d$/.test(url) ? unitPieces[Number(url.split('.').pop())] : bytes));
  const shards = createShardStore(dir);
  return { ...f, dir, shards, cache: createModelCache({ ...f.options, shards }), again: () => createModelCache({ ...f.options, shards }) };
}

for (const syncOnly of [false, true]) test(`shards (${syncOnly ? 'sync access handles' : 'createWritable'}): one file per chunk, later sessions read with no network and no Cache Storage entry`, async () => {
  const f = shardFixture({ syncOnly });
  await f.cache.acquire(chunked());
  assert.equal(f.calls.length, 3); assert.equal(f.assetEntries().length, 0);
  assert.equal(f.dir.files.size, 3);
  for (const piece of unitPieces) assert.equal(f.dir.files.get(digest(piece)).length, piece.length + TRAILER_BYTES);
  const handle = await f.again().acquire(chunked());
  assert.deepEqual(Buffer.from(await handle.bytes()), Buffer.from(shardModel));
  assert.deepEqual(Buffer.from(await (await handle.open()).arrayBuffer()), Buffer.from(shardModel));
  assert.equal(f.calls.length, 3, 'a warm read never touches the network');
});
test('shards: a corrupt unit is caught on read, whatever the trailer says, and only that unit is fetched again', async () => {
  const f = shardFixture(); await f.cache.acquire(chunked());
  const name = digest(unitPieces[1]), stored = f.dir.files.get(name); stored[7] ^= 0xff; // payload byte; trailer intact
  const fresh = f.again(), handle = await fresh.acquire(chunked());
  assert.equal(f.calls.length, 3, 'acquisition trusts presence; integrity is checked when bytes are handed out');
  assert.deepEqual(Buffer.from(await handle.bytes()), Buffer.from(shardModel));
  assert.deepEqual(f.calls.slice(3), ['https://models.example/model.1']);
  assert.ok(f.events.some(e => e.status === 'corrupt-removed')); assert.ok(f.events.some(e => e.status === 'repairing'));
  assert.deepEqual(Buffer.from(await (await fresh.acquire(chunked())).bytes()), Buffer.from(shardModel));
  assert.equal(f.calls.length, 4, 'the repaired unit stays a hit');
});
test('shards: a write cut short (no trailer), a foreign trailer and a deleted unit read as missing and are fetched', async () => {
  const f = shardFixture(); await f.cache.acquire(chunked());
  const [a, b, c] = unitPieces.map(piece => digest(piece));
  f.dir.files.set(a, f.dir.files.get(a).slice(0, 2048));                  // payload only: the commit never happened
    const wrong = new Uint8Array(unitPieces[1].length + TRAILER_BYTES); wrong.set(f.dir.files.get(c).subarray(-TRAILER_BYTES), unitPieces[1].length); f.dir.files.set(b, wrong); // right size, someone else's trailer
  f.dir.files.delete(c);
  const cache = f.again();
  assert.equal(await cache.has(chunked()), false, 'inventory sees the gaps without reading');
  await cache.acquire(chunked());
  assert.deepEqual(Buffer.from(await (await cache.acquire(chunked())).bytes()), Buffer.from(shardModel));
  assert.equal(await cache.has(chunked()), true);
  assert.equal(f.calls.length, 6, 'one re-fetch per bad unit, nothing else');
});
test('shards: bytes saved by the Cache Storage backend move across without a download, and the old entry is dropped', async () => {
  const f = shardFixture(); f.entries.set(digest(shardModel), new Uint8Array(shardModel));
  assert.equal(await f.cache.has(chunked()), true, 'old bytes count as present');
  const handle = await f.cache.acquire(chunked());
  assert.equal(f.calls.length, 0); assert.equal(f.dir.files.size, 3); assert.equal(f.assetEntries().length, 0);
  assert.ok(f.events.some(e => e.status === 'migrated' && e.units === 3));
  assert.deepEqual(Buffer.from(await handle.bytes()), Buffer.from(shardModel));
});
test('shards: a corrupt old entry migrates its good units and downloads the rest', async () => {
  const f = shardFixture(), old = new Uint8Array(shardModel); old[3000] ^= 1; f.entries.set(digest(shardModel), old);
  await f.cache.acquire(chunked());
  assert.deepEqual(f.calls, ['https://models.example/model.1']);
  assert.deepEqual(Buffer.from(await (await f.cache.acquire(chunked())).bytes()), Buffer.from(shardModel));
  assert.equal(f.assetEntries().length, 0);
});
test('shards: small unchunked assets are one unit; peek reads them back verified', async () => {
  const f = shardFixture();
  await f.cache.acquire(asset());
  assert.equal(f.dir.files.size, 1); assert.equal(f.assetEntries().length, 0);
  assert.equal(await (await f.again().peek(asset())).text(), 'synthetic model fixture');
  f.dir.files.get(asset().sha256)[0] ^= 1;
  assert.equal(await f.again().peek(asset()), null, 'peek never hands out unverified bytes');
});
test('shards: invalid network bytes never commit a unit', async () => {
  const dir = fakeDirectory(), shards = createShardStore(dir);
  const f = fixture(async () => new Response(new Uint8Array(2048)));
  await assert.rejects(createModelCache({ ...f.options, shards }).acquire(chunked()), /integrity/);
  assert.equal([...dir.files.values()].filter(v => v.length).length, 0);
});
