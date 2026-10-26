# @facemorph/browser-model-manager

Consented acquisition, verification, storage and eviction of browser model assets, and the model manifest schema
(`schema/`). It downloads model files from the static origin you host them on, only under a grant the app or the
developer has approved, checks every byte against the manifest's SHA-256 pins, stores verified bytes in the Origin
Private File System (OPFS) or Cache Storage, and hands an engine such as `@facemorph/stylegan-js` a reader of
verified local bytes that never touches the network.

**No hidden network repair happens during engine operations.** The engine reads only through the verified local
reader (`cache.local`, `allowRepair: false`), which has no network path: a missing, evicted or corrupt asset is a
typed error, and the operations that needed it settle and release their resources. Getting the bytes back is a new
acquisition, which the app starts outside the engine under its own consent policy.

What the package provides: the implemented cache (`createModelCache`, `createBrowserModelCache`), grant
enforcement, the aggregate download budget, whole-acquisition progress, leases, loaded handles, eviction and
cross-tab deletion, plus the contract types (`ModelManager`, `ManagerStatus`, `ManagerError`, …) that an app's own
manager object is written against. The package does not decide consent, priorities or retention; the app does, and
these pieces enforce what it decides.

Every export is listed in the [API reference](docs/api.md). [`examples/developer-hosted`](examples/developer-hosted)
is the complete, tested browser example.

## Install

<!-- docs-test: install -->
```sh
npm install @facemorph/browser-model-manager
```

ESM only, with `.d.ts` declarations. It depends on `@facemorph/stylegan-js` for the engine's types (the loaded
capability and compute routes); importing the manager does no I/O.

## Authorize, then acquire

Construction and status reads trigger no acquisition. Nothing is transferred until the app (or you, as the
developer) supplies an approved `AcquisitionGrant`:

- `createModelCache({ store, shards, fetcher, … })` makes no request and no storage call. Storage backends and the
  fetch function are arguments. `createBrowserModelCache()` opens this origin's Cache Storage and probes OPFS with a
  four-byte local round trip; it makes no network request either.
- `cache.has(asset)`, `cache.local.read(asset)` and `storageStatus()` read local state only.
- `cache.acquire(asset, { grant, owner, signal })` transfers bytes only when the grant names `owner`, names the
  asset's exact digest and size, and still has the bytes. Otherwise it rejects with `GrantRefused` before any request
  (`no-grant`, `owner-not-in-grant`, `out-of-scope`, `revision-required`).

A grant is what a person was shown: the manifest identity, the compute route, the purpose, each asset's digest and
bytes with its priority, the owners, and `remainingBytes`, the bytes still to transfer. Every byte received counts
against it: retries, alternate origins and refetched chunks included. Each chunk is reserved before it is requested,
so a grant that cannot cover the next chunk is refused with `revision-required` before that request. Nothing the
cache does adds to a grant; more scope is a new grant object after a new decision. A grant's ledger lives in the
JS realm that spends it (a window or one worker), so give each worker its own grant for the share it may spend.
`scopeCovers(grant, request)` and `inventoryAction(inventory, decision)` express the same rules for an app's policy
code; an `unknown` inventory means inspect, never fetch.

<!-- docs-test: run examples/readme/authorize-then-acquire.ts -->
```ts
// Construct, read status, authorize, acquire with progress, then read back verified bytes.
// Storage and the network are in memory here so this runs anywhere (the docs test runs it in Node with every
// network API refused). In a browser, use createBrowserModelCache() and the default fetch.
import {
  createAcquisitionBudget,
  createModelCache,
  GrantRefused,
  grantRemaining,
  type AcquisitionGrant,
  type BlobStore,
  type Fetcher,
} from '@facemorph/browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');

// One model file on your own static origin, pinned by digest and exact size.
const file = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) % 251);
const asset = {
  sha256: await sha256(file),
  size: file.byteLength,
  url: 'https://models.example.com/demo/weights.bin',
};

// The network and storage, handed in. Every request is counted.
const requests: string[] = [];
const fetcher: Fetcher = async (url) => {
  requests.push(url);
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= file.byteLength) return c.close();
      c.enqueue(file.slice(at, (at += 256 * 1024))); // arrives in pieces, as over a network
    },
  });
  return new Response(body);
};
const saved = new Map<string, Uint8Array<ArrayBuffer>>();
const store: BlobStore = {
  get: async (hash) => (saved.has(hash) ? new Response(saved.get(hash)) : undefined),
  // Commits only after the whole body has been read, and the cache's verifying stream fails before EOF on a wrong
  // size or digest, so nothing partial or unverified is ever stored.
  put: async (hash, response) => {
    saved.set(hash, new Uint8Array(await response.arrayBuffer()));
  },
  remove: async (hash) => saved.delete(hash),
};

// Progress for the whole acquisition: the cache reports byte-level events to it.
const progress = createAcquisitionBudget();
const bar: string[] = [];
progress.attach((t) => bar.push(`${t.loaded}/${t.total}`));

// 1. Construction and status reads: no request, no transfer.
const cache = createModelCache({ store, fetcher, report: (event) => progress.cacheEvent(event) });
progress.planAsset([asset]);
await progress.probe((a) => cache.has(a));
const before = await cache.local.read(asset);
check(!before.ok && before.error.code === 'cache-miss', 'nothing is stored yet');
check(requests.length === 0, 'construction and status made no request');

// 2. Without an approved grant naming this owner and digest, acquire() refuses before any request.
const declined: AcquisitionGrant = {
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: [],
  assets: [],
  remainingBytes: 0,
};
const refused = await cache.acquire(asset, { grant: declined, owner: 'face:demo' }).then(
  () => null,
  (e: unknown) => e,
);
check(refused instanceof GrantRefused, 'refused without a grant');
check(requests.length === 0, 'a refusal made no request');

// 3. The person approves exactly these bytes (show `remainingBytes` in your consent UI); then acquire.
const grant: AcquisitionGrant = {
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: ['face:demo'],
  assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
  remainingBytes: asset.size,
};
await cache.acquire(asset, { grant, owner: 'face:demo' });

// 4. The verified local reader: exact-length bytes whose SHA-256 matched on this read, and never a fetch.
const after = await cache.local.read(asset);
check(after.ok && (await sha256(after.value)) === asset.sha256, 'verified bytes read back');
check(requests.length === 1, 'one request, made after authorization');
check(grantRemaining(grant) === 0, 'the grant was spent exactly');

console.log(
  JSON.stringify({
    refused: (refused as GrantRefused).refusal,
    requests: requests.length,
    progress: bar,
    grantRemaining: grantRemaining(grant),
    localRead: after.ok ? after.value.byteLength : after.error.code,
  }),
);
```

## Progress, abort and errors

- **Progress.** The cache reports events through its `report` option: status and digest only, never URLs or
  credentials (`missing`, `downloading`, `progress` with `loaded`/`bytes`, `saved`, `retained`, `verified`,
  `migrated`, `quota-exceeded`, `save-failed`, …). `progress` comes after each verified chunk on OPFS, and at
  least every MiB (`PROGRESS_INTERVAL_BYTES`) on the Cache Storage path. `createAcquisitionBudget()` turns them into one
  `{ loaded, total, fetched, fetchedTotal }` for the whole acquisition, so a bar crosses the download once and
  `fetched` counts only bytes that really cross the network.
- **Abort.** Pass an `AbortSignal`; the acquisition rejects with the signal's reason (an `AbortError` by default).
  Several callers acquiring the same digest share one fetch; it stops when the last of them leaves. On OPFS each
  verified chunk is already its own committed file, so it is kept, and a later acquisition under a new approval
  fetches only the chunks that are missing. In Cache Storage an asset commits only as a whole, after its full
  digest matches. Either way a partly acquired asset is never readable: `local.read` reports it unavailable.
- **Timeouts and retries.** A pending network operation that receives nothing for `timeoutMs` (default 300 s)
  fails with a `TimeoutError`; a chunk attempt that receives nothing for `stallMs` (default 30 s,
  `CHUNK_STALL_MS`) is abandoned and retried. A dropped connection or an HTTP 5xx, 429 or 408 is retried after
  1, 4, 10 and 20 s (`CHUNK_RETRY_DELAYS_MS`, `retryDelaysMs`), each retry under a fresh query string.
  `alternateOrigins` (empty by default) sends every other retry to the same path on another HTTPS origin you
  configure; with none configured no request leaves the asset's own origin. HTTP 404 or 410 is not retried: model
  files are named by digest, so a missing one belongs to a version the host no longer serves, and the message asks
  the person to reload. Every response is checked against its pin wherever it came from.
- **Requests** are made with `credentials: 'omit'` and `mode: 'cors'`. Asset URLs must be HTTPS without embedded
  credentials; chunks are at most 16 MiB each and 256 per asset.

<!-- docs-test: run examples/readme/abort-and-errors.ts -->
```ts
// Abort keeps verified chunks and never yields a partial asset; refusals and failures are typed.
// The shard store and the network are in memory here so this runs anywhere; in a browser, openShardStore() gives
// the OPFS store and createBrowserModelCache() wires it up.
import {
  CacheQuotaExceeded,
  createModelCache,
  GrantRefused,
  type AcquisitionGrant,
  type BlobStore,
  type Fetcher,
  type ShardStore,
} from '@facemorph/browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const MiB = 1024 * 1024;
const base = 'https://models.example.com/demo/';

// A 4 MiB asset published as four 1 MiB chunks, each pinned by its own digest.
const file = new Uint8Array(4 * MiB).map((_, i) => (i * 13) % 251);
const parts = [0, 1, 2, 3].map((i) => file.slice(i * MiB, (i + 1) * MiB));
const chunks = await Promise.all(
  parts.map(async (p, i) => ({
    sha256: await sha256(p),
    size: p.byteLength,
    url: `${base}part-${i}`,
  })),
);
const asset = {
  sha256: await sha256(file),
  size: file.byteLength,
  url: `${base}weights.bin`,
  chunks,
};
const served = new Map(chunks.map((c, i) => [c.url, parts[i]!]));

const requests: string[] = [];
let onRequest = (_url: string) => {};
const fetcher: Fetcher = async (url) => {
  requests.push(url);
  onRequest(url);
  return new Response(served.get(url) ?? null, { status: served.has(url) ? 200 : 404 });
};
// One file per verified unit, as OPFS keeps them.
const units = new Map<string, Uint8Array<ArrayBuffer>>();
let failWrites: DOMException | null = null;
const shards: ShardStore = {
  read: async (sha, size) => (units.get(sha)?.byteLength === size ? units.get(sha) : undefined),
  has: async (sha, size) => units.get(sha)?.byteLength === size,
  write: async (sha, bytes) => {
    if (failWrites) throw failWrites;
    units.set(sha, new Uint8Array(bytes));
  },
  remove: async (sha) => void units.delete(sha),
};
const store: BlobStore = {
  get: async () => undefined,
  put: async () => {},
  remove: async () => {},
};
const cache = createModelCache({ store, shards, fetcher, readAhead: 1 });
const grantFor = (remainingBytes: number, owner: `face:${string}`): AcquisitionGrant => ({
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: [owner],
  assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
  remainingBytes,
});
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

// Abort while the third chunk is being requested: the two verified chunks stay, the asset is not readable.
const controller = new AbortController();
onRequest = (url) => {
  if (url === chunks[2]!.url) controller.abort();
};
const aborted = await outcome(
  cache.acquire(asset, {
    grant: grantFor(asset.size, 'face:a'),
    owner: 'face:a',
    signal: controller.signal,
  }),
);
onRequest = () => {};
check(aborted?.name === 'AbortError', 'the acquisition was cancelled');
const partial = await cache.local.read(asset);
check(!partial.ok, 'a partly acquired asset is never handed out');

// Each chunk is reserved against the grant before it is requested. A grant that cannot cover the next chunk is
// refused before that request: more scope needs a new decision, and nothing the cache does adds to a grant.
const before = requests.length;
const short = await outcome(
  cache.acquire(asset, { grant: grantFor(MiB - 1, 'face:b'), owner: 'face:b' }),
);
check(requests.length === before, 'refused before any request');
check(
  short instanceof GrantRefused && short.refusal === 'revision-required',
  'needs a revised grant',
);

// A new approval for the missing bytes resumes: only the two missing chunks are fetched.
await cache.acquire(asset, { grant: grantFor(2 * MiB, 'face:c'), owner: 'face:c' });
const resumed = requests.slice(before);
const read = await cache.local.read(asset);
check(read.ok && (await sha256(read.value)) === asset.sha256, 'whole asset verified');

// Bytes changed underneath are found by the next local read (every read digests what it returns).
units.get(chunks[1]!.sha256)![0]! ^= 0xff;
const corrupt = await cache.local.read(asset);
check(
  !corrupt.ok && corrupt.error.code === 'corrupt',
  'corruption is a typed error, never a fetch',
);
// The remedy is the app's: remove the bad unit, then acquire again under a new approval.
await shards.remove(chunks[1]!.sha256);
const repairFrom = requests.length;
await cache.acquire(asset, { grant: grantFor(MiB, 'face:e'), owner: 'face:e' });
const repaired = requests.slice(repairFrom);
check((await cache.local.read(asset)).ok, 'readable again');

// A storage refusal is a typed quota error, separate from any execution capability.
units.clear();
failWrites = new DOMException('full', 'QuotaExceededError');
const quota = await outcome(
  cache.acquire(asset, { grant: grantFor(asset.size, 'face:d'), owner: 'face:d' }),
);
check(quota instanceof CacheQuotaExceeded && quota.error.code === 'quota', 'typed quota error');

console.log(
  JSON.stringify({
    aborted: aborted?.name,
    partialRead: partial.ok ? 'ok' : partial.error.code,
    shortGrant: (short as GrantRefused).refusal,
    resumedRequests: resumed.map((u) => u.slice(base.length)),
    corruptRead: corrupt.ok ? 'ok' : corrupt.error.code,
    repairedRequests: repaired.map((u) => u.slice(base.length)),
    quota: (quota as CacheQuotaExceeded).error,
    totalRequests: requests.length,
  }),
);
```

## Cache behaviour

- **OPFS shards first.** With a working OPFS (`openShardStore()`), each pinned unit, a manifest chunk or an
  unchunked asset up to 64 MiB, is one file in the OPFS directory named by `SHARD_DIRECTORY`: the
  payload followed by a 48-byte trailer (magic, length, digest) written last, so an interrupted write reads as
  missing. The trailer is a commit record, not a verdict: every read digests every unit with the platform SHA-256
  against the manifest's pin, every time.
- **Cache Storage fallback.** `openShardStore()` returns null where OPFS cannot be used (for example Firefox
  private windows, older engines, non-HTTP origins such as native WebViews, denied storage, or an engine that exposes
  `getDirectory` but refuses writes); the cache then keeps everything in the Cache Storage cache named by `MODEL_CACHE_NAME`.
  Unchunked assets over 64 MiB stay in Cache Storage even with OPFS. Writes stream through a verifier and commit only
  after the whole asset's size and digest match. Bytes found in Cache Storage for an asset that now belongs in OPFS
  are moved there without a download, unit by unit, each checked against its pin.
- **Safari worker sync handles.** Where a file handle has no `createWritable()` (older Safari), the shard store
  writes with `createSyncAccessHandle()`, which exists only in dedicated workers: run acquisition in a worker there.
  The payload is flushed before the trailer, so a crash part-way leaves no valid trailer. This path is implemented
  but unqualified: every engine in the test lanes also exposes `createWritable()`, which the store prefers. On the
  main thread,
  `openShardStore({ readOnly: true })` reads the shards workers wrote, never creating the directory and never
  acquiring.
- **Verified local reads.** `cache.local.read(asset)` returns exact-length bytes whose SHA-256 matched on this
  read, or a typed error: `cache-miss` (never stored, as far as this cache can tell), `evicted` (stored before, or
  some of its units remain), `corrupt` (wrong bytes), or `unknown-status` (storage could not be read; retryable,
  never permission to fetch). Presence alone (`has()`, a committed trailer) never vouches for bytes.
- **Names and identity.** Both storage names are fixed, never app-versioned or age-purged; assets are addressed by
  SHA-256, so renaming or moving files on your host does not invalidate what is stored.
- **What `acquire()` returns.** `acquire()` resolves with an `AssetHandle` whose `bytes()` and `open()` may refetch
  a vanished or corrupt unit under that caller's own grant. It is for the app's acquisition code; never hand it to
  an engine. The engine gets `cache.local`.

## Quota and eviction

- `storageStatus()` reports `persistence` (`granted`, `not-granted` or `unavailable`), `usage` and `quota` from
  `navigator.storage`, and `eviction: 'unknown'`: the browser does not say when it will reclaim storage. It asks for
  persistent storage only with `{ requestPersistence: true }`; call that from your UI after the person has approved
  the download, never at startup.
- A storage refusal rejects with `CacheQuotaExceeded` (`name` `QuotaExceededError`, the original `cause`, and
  `error: { code: 'quota', requiredBytes, message }`, which is structured-clone safe). It is separate from execution
  capability: the model can still run without durable storage.
- Without usable storage at all (`createBrowserModelCache()` throws where Cache Storage is unavailable),
  `acquireUncachedBytes(asset, { grant, owner, signal })` downloads and verifies one asset for immediate use without
  reading or writing persistent storage, still under the grant and the aggregate budget.
- `evictUnleased(digests, stores, registry, locks?)` removes the assets you name from the stores you pass, skipping
  every leased one; with `navigator.locks` it also skips assets leased in other tabs. A store is anything with
  `remove(sha256)`; remember that on OPFS each chunk is its own unit (the example's `evict()` removes an asset's
  units). Eviction only touches the model stores you pass: app records such as exports or recovery data are never
  part of them.
- Leases constrain the manager, not the browser: the browser can still clear the origin's storage. The next
  verified read then reports `evicted` or `cache-miss`, and the lease holder is told (below).

## Leases and typed invalidation

`createLeaseRegistry({ locks: navigator.locks })` counts holders per digest; each leased asset also holds a shared
Web Lock until its last local lease is released, which is what other tabs' eviction checks. `createLoadedHandle({
manifestSha256, capability, assets, registry })` wraps an engine capability (for example a stylegan-js `Generator`)
with leases on the assets it reads. When a leased asset goes away, `registry.invalidate(sha256, cause)` tells every
holder once, with one manager error and settlement rule per cause (`LEASE_INVALIDATION`):

| Cause | Error | Settlement |
| --- | --- | --- |
| `browser-eviction` | `evicted` | `fail-pending-and-release` |
| `corruption` | `corrupt` | `fail-pending-and-release` |
| `cross-tab-deletion` | `invalidated` | `fail-pending-and-release` |
| `device-loss` | `invalidated` | `fail-pending-and-dispose-handle` |
| `worker-loss` | `invalidated` | `fail-pending-and-dispose-handle` |

`createLoadedHandle` applies both rules the same way, because the asset is gone either way: the handle rejects its
pending and later `map`/`synthesize` calls with `HandleUnavailable` (its `error` is the structured manager error),
disposes the capability's sessions, releases its leases and calls its `onInvalidated` listeners. Nothing is refetched. Explicit deletion, the person's "clear the model cache", is
`deleteAssets(digests, stores, channel)`: it removes the assets even while leased and announces them on a
`BroadcastChannel(DELETION_CHANNEL)`; `listenForDeletions(channel, registry)` in every other tab invalidates its
leases with `cross-tab-deletion`.

<!-- docs-test: run examples/readme/leases-and-eviction.ts -->
```ts
// Reference-counted leases, eviction that skips leased assets, and typed invalidation when an asset goes anyway.
// Two lease registries stand for two tabs; BroadcastChannel carries an explicit deletion between them.
import {
  createLeaseRegistry,
  deleteAssets,
  DELETION_CHANNEL,
  evictUnleased,
  LEASE_INVALIDATION,
  listenForDeletions,
  type LeaseHolder,
  type Removable,
} from '@facemorph/browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const [x, y] = ['a'.repeat(64), 'b'.repeat(64)]; // asset digests
const stored = new Set([x, y]);
const store: Removable = { remove: async (sha) => stored.delete(sha) };

// A holder hears once, with the cause and the mapped manager error.
const heard: string[] = [];
const holder: LeaseHolder = {
  invalidated: (cause, error) => heard.push(`${cause}:${error.code}`),
};

// Tab A leases x twice (two handles share it) and y once.
const tabA = createLeaseRegistry();
const [x1, y1] = tabA.lease(
  [
    { sha256: x, bytes: 10 },
    { sha256: y, bytes: 20 },
  ],
  holder,
);
const [x2] = tabA.lease([{ sha256: x, bytes: 10 }], holder);
check(tabA.refCount(x) === 2, 'x has two leases');

// Manager eviction never removes a leased asset.
const first = await evictUnleased([x, y], [store], tabA);
check(first.removed.length === 0 && stored.size === 2, 'leased assets are kept');

// Released leases make an asset evictable again; release is idempotent.
y1!.release();
y1!.release();
const second = await evictUnleased([x, y], [store], tabA);
check(second.removed[0] === y && second.kept[0] === x, 'only the unleased asset is evicted');

// The person clears the model cache in tab B: deletion removes even leased assets and tells the other tabs,
// whose leases are invalidated with a typed cause. Nothing is refetched.
const tabB = new BroadcastChannel(DELETION_CHANNEL);
const listening = new BroadcastChannel(DELETION_CHANNEL);
const delivered = new Promise<void>((resolve) =>
  listening.addEventListener('message', () => resolve(), { once: true }),
);
const stop = listenForDeletions(listening, tabA);
await deleteAssets([x], [store], tabB);
await delivered;
stop();
tabB.close();
listening.close();
check(!stored.has(x), 'deleted');
check(heard[0] === 'cross-tab-deletion:invalidated', 'the holder heard a typed invalidation');

// Browser eviction or corruption found underneath a lease maps to its own error the same way.
tabA.invalidate(x, 'browser-eviction');
x1!.release();
x2!.release();
check(tabA.leased().length === 0, 'every lease released');

console.log(
  JSON.stringify({
    firstEviction: first,
    secondEviction: { removed: second.removed.length, kept: second.kept.length },
    heard,
    mapping: LEASE_INVALIDATION,
  }),
);
```

## Disposal

`handle.release()` (or the wrapped `capability.dispose()`) settles every pending operation with `HandleUnavailable`,
disposes the engine's sessions, then releases the leases; it is idempotent. Released assets become evictable. A
`LeaseRegistry` lease's own `release()` is idempotent too. The cache itself holds no sessions; dropping it is enough
once no acquisition is in flight (abort those first).

## Scheduling

Acquisitions are bounded per tab and per origin. `maxConcurrent` (default 2) assets download at once, each with
`readAhead` (default 2, at most 8) chunks in flight. `createAcquisitionSlots({ locks: navigator.locks, count })` adds
one aggregate budget shared by every worker and tab of the origin, sized by `slotCount(acquisitionMemoryClass(
navigator.deviceMemory))` (2 chunks, or 4 with 8 GiB or more); `createBrowserModelCache()` sets it up. Each grant
asset carries a priority (`foreground-required`, `synthesis-prerequisite`, `detector-prerequisite`, `optional`,
`speculative-warming`); optional work never waits in a lock queue ahead of required work. `satisfyAction(lookup,
acquire)` serves an action from the app's own output cache first and acquires only on a miss.

## Manifests

`parseModelManifest(json)` validates a model manifest (major version 1) and returns a typed result: an unknown or
newer major is rejected, asset locations must be HTTPS URLs without credentials (or relative files with
`{ unpublished: true }`, as a converter checks its own output), digests are lowercase hex SHA-256 and chunk sizes
must add up. The JSON schema producers validate against is `schema/model-manifest.v1.schema.json`.

## Errors

| Error | Where | Meaning |
| --- | --- | --- |
| `GrantRefused` (`refusal`, `sha256`) | `acquire`, `acquireUncachedBytes` | No approved scope for this transfer; thrown before the request. `revision-required` needs a new approval. |
| `AbortError` (`DOMException`) | `acquire` | The caller's signal aborted. |
| `TimeoutError` (`DOMException`) | `acquire` | A pending network operation got no data for `timeoutMs`. |
| `Error`, message "The model download stopped receiving data…" | `acquire` | A chunk stayed silent for `stallMs` on every retry. |
| `Error`, message "Asset integrity mismatch" or "Asset exceeds declared size" | `acquire` | Bytes did not match the pin; nothing was stored. |
| `Error` with an HTTP status in its message | `acquire` | The host refused; 5xx/429/408 were retried first, 404/410 ask for a reload. |
| `CacheQuotaExceeded` (`error.code: 'quota'`) | `acquire` | Storage refused the write. |
| `ManagerError` result: `cache-miss`, `evicted`, `corrupt`, `unknown-status` | `local.read` | Typed local outcome; never a fetch. |
| `HandleUnavailable` (`error`: `ManagerError`) | loaded handle operations | The handle was released or invalidated. |
| `ManifestError` result (`code`, `path`) | `parseModelManifest` | `not-an-object`, `newer-major`, `unsupported-major`, `invalid-field`, `invalid-asset`. |

`ManagerError` and `Result` values are plain objects, safe to post between a worker and the page.

## Example: a model from your own static origin

[`examples/developer-hosted`](examples/developer-hosted) is a page that constructs the cache and reads its status
with zero requests; on "Review download" fetches the two small manifests from your static origin and shows the
grant's exact bytes; on approval acquires the converted model and the CPU runtime with a progress bar and an Abort
button; reads every asset back through the verified local reader; loads `@facemorph/stylegan-js` on the CPU from
those reads alone, under leases, and synthesizes one image; and then releases and evicts. Its test
(`test/example.test.ts`) runs it from freshly packed tarballs in a clean project with Playwright Chromium against a
local static HTTPS host and checks each of those steps by the requests actually made.

## Supported browsers

Qualified by this package's own browser tests:

| Lane | Engines | What runs |
| --- | --- | --- |
| Linux, Playwright builds (`manager-cache` CI) | Chromium, Firefox, WebKit | Verified local reads on OPFS and Cache Storage, acquisition (grants, retries, slots, cancellation, deadlines), cross-tab leases and deletion, worker OPFS storage, persistence-request timing, storage refusal and uncached runs; the loaded CPU handle lifecycle |
| Hosted macOS (`manager-macos`) | Playwright WebKit, Firefox | The same component files, and the loaded CPU handle lifecycle |
| Android Emulator (`manager-mobile`) | Chrome | Native mobile component cells |
| iOS Simulator (`manager-mobile`) | Safari | Native mobile component cells |

Explicitly untested in those lanes, and so unqualified: the quota-override cells outside Chromium (they need
Chromium's quota controller), Safari's sync-handle-only write path where the engine also exposes `createWritable`
(current engines do, so the package uses that), physical-phone OPFS throughput and quota, and some native quota cells
on iOS. Every other browser, version and platform, including Edge and Windows, is unqualified.

## Troubleshooting

- **`GrantRefused` with no request.** The grant does not name this owner, digest or exact size, or it is spent. Build
  a new grant from the current manifest and ask again; a cancelled or partly spent grant is never topped up.
- **The bar sits at the full size with nothing downloading.** Assets already stored are `retained`; `fetched` and
  `fetchedTotal` from `createAcquisitionBudget()` count only real downloads.
- **CORS or opaque-response errors.** Serve model files with `Access-Control-Allow-Origin` for your app's origin, and
  with `Cross-Origin-Resource-Policy: cross-origin` if the app is cross-origin isolated. An opaque response is
  refused.
- **`corrupt` from `local.read`.** The bytes on disk changed. On OPFS the unit stays until you remove it: remove the
  asset (or its units) and acquire again under a new approval, as `abort-and-errors.ts` shows.
- **`evicted` or `cache-miss` after a restart.** The browser reclaimed storage or a partial acquisition was
  cancelled. Ask for persistence after approval, check `storageStatus()`, and acquire again.
- **No OPFS (`openShardStore()` returns null).** Expected in private windows and some WebViews; Cache Storage is used.
  On older Safari, acquire in a dedicated worker so sync access handles exist.
- **Quota.** Show `CacheQuotaExceeded`'s message, free space or run uncached with `acquireUncachedBytes`.
- **The CPU route runs single-threaded.** That is the engine: serve the app with `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

## Licence and model weights

The code is MIT licensed (`LICENSE`; bundled third-party code in `THIRD_PARTY_NOTICES`). **No model weights are
included.** The manager downloads them from a model host only after consent, and they come under their own terms,
separate from this package's licence and limited to non-commercial use:

<!-- model-terms:start -->
- NVIDIA StyleGAN2 licence: [upstream text](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-NC.txt`
- NVIDIA StyleGAN2-ADA licence: [upstream text](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-ADA.txt`
- FFHQ dataset terms: [upstream text](https://github.com/NVlabs/ffhq-dataset#licenses); served beside the weights as `notices/FFHQ-terms.txt`
- e4e MIT licence: [upstream text](https://github.com/omertov/encoder4editing/blob/main/LICENSE); served beside the weights as `notices/e4e-MIT.txt`
- dlib landmark model notice: [upstream text](https://www.dlib.net/face_landmark_detection_ex.cpp.html); served beside the weights as `notices/index.html#dlib-landmarks`
<!-- model-terms:end -->

A host publishes these texts beside the weights, under `notices/` next to the runtime manifest, and the manifest's
`distribution.notices` points at their index. Show that link where you ask for download consent.
