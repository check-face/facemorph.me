# Browser model asset cache foundation

Implemented 15 September 2026 in `src/Next/Assets/`. This is a tested infrastructure
module, not a wired product workflow or browser/device qualification. It implements
part of the [persistent asset contract](../../checkface/docs/model-asset-cache.md).
Research files, model downloads, app wiring and service-worker behavior are unchanged.

## Integration

Use the existing Elmish effects to call `ModelAssets.createBrowserCache` once per
generation context, then acquire only the selected workflow's manifest assets.
`ModelAssets.fs` is the typed Fable boundary; add it to `App.fsproj` before the
consumer when integrating. It has not yet been compiled with the app. The `.mjs`
modules have no runtime package dependencies or Node imports.

```javascript
import { createBrowserModelCache, storageStatus } from '../src/Next/Assets/model-cache.mjs';
const cache = await createBrowserModelCache({
  timeoutMs: 300000, maxConcurrent: 2,
  report: event => dispatchAssetStatus(event) // hash/status only; no download URLs
});
// First resolve generated-image caches; a displayed cache hit needs no models.
// Asset descriptor comes from a trusted, pinned release manifest:
// { sha256: lowercaseHex, size: exactDecodedBytes, url: immutableHttpsUrl }
const handle = await cache.acquire(descriptor, { signal: jobAbortController.signal });
const response = await handle.open();
// Pass to a streaming consumer when available. A runtime that requires ArrayBuffer
// will allocate the full model here; persistent caching cannot remove that cost.
const modelBytes = await response.arrayBuffer();
// Runtime admission/canaries remain a separate prerequisite to generation.
```

Call `storageStatus({ requestPersistence: true })` from the relevant host UI action.
Display granted/not-granted/unavailable and estimated quota/usage. Saved bytes do
not mean the browser granted protection from eviction. Missing entries do not
identify whether eviction, user removal, partitioning or first use caused the miss.
No local URL, credential or private input appears in cache event metadata.

## Guarantees and boundaries

- Stable `checkface-model-blobs-v1` Cache Storage namespace, keyed solely by SHA-256.
  App updates, bundle versions and CPU/GPU roles cannot change identical blob keys.
  There is no expiry, upgrade purge, eviction policy or automatic retry loop.
- Existing bytes are streamed through exact size and incremental SHA-256 validation
  before a cache hit succeeds. No network request occurs for valid retained bytes.
  `open()` returns a fresh stream, validated again as consumed. Fully consume it
  before handing bytes to inference; do not execute an unverified prefix.
- Downloads stream with backpressure through verification into `Cache.put`.
  Integrity failure errors the response body before EOF. The adapter must guarantee
  successful stream consumption before atomic commit; partial entries are never hits.
  Cache Storage supplies that contract. Fake test adapters explicitly model it.
- At most two distinct acquisitions per cache instance run at once by default.
  Queued work, fetch and verification share a finite configurable acquisition timeout.
  Same-hash callers share work, and a cancelled caller does not cancel other callers.
  The last cancelled caller aborts acquisition. A fully verified blob committed at
  that instant may remain and is intentionally retained.
- Web Locks coordinate the same hash across participating tabs/workers on the same
  origin. Without Web Locks, deduplication is instance-local; races may duplicate
  transfers but successful writes contain identical verified bytes. Distinct-asset
  concurrency bounds are per instance, not a global browser-wide budget.
- The JavaScript verifier retains one input chunk plus bounded SHA state, with no
  full-response clone/tee or concatenation. Browser Cache Storage can internally
  buffer data; real-device peak memory is unmeasured. Synchronous hashing of a large
  network chunk cannot be interrupted until the chunk completes. A worker integration
  and real-model throughput/memory measurement remain necessary on slow devices.
- Cache acquisition fails visibly on storage/quota errors. It never silently deletes
  retained old versions or pretends a transient download was saved. The UI must offer
  storage management/retry or an explicitly implemented nonpersistent mode.
- Cache namespace consistency is required from future service-worker activation code:
  never apply blanket “delete old caches” logic to this model store.

## Remaining contract work

1. Trusted versioned manifest selection, distribution permission, revoked-runtime
   checks and independently preserved origins. Hashes verify bytes, not publisher trust.
2. Range/partial persistence and safe resumption. This version restarts an interrupted
   individual blob; independently checksummed manifest shards already completed are
   reusable. It does **not** claim resumability of a partially downloaded monolithic file.
3. Native per-user storage and Docker volume integration. This browser module does
   not qualify native caches or provide cross-origin/browser/native sharing.
4. User storage management, pinned project dependencies and explicit version removal.
5. Actual browser Cache Storage failure atomicity, cross-tab Web Locks, persistence
   denial, private mode, quota, browser restart, origin changes, service-worker updates,
   corrupt storage and offline generation tests across the declared support matrix.
6. Measure zero warm model-transfer bytes, app-only and A→B→A upgrades, CPU/GPU
   switches, hashing responsiveness and peak memory using real released assets.
   Verify production CORS and immutable HTTP/CDN headers separately.

## Local verification

Run `node --test src/Next/Assets/model-cache.test.mjs` from `facemorph.me`.
The small in-memory adapter suite covers independent SHA vectors/chunk boundaries,
cross-version reuse, old-model retention, new instances, concurrent/cancelled jobs,
corruption, partial responses, quota failure, stream timeout, concurrency bounds,
missing-after-acquisition handling and persistence outcomes. This suite uses no
model files and performs no inference, heavy build or network requests.
