/**
 * One acquisition budget for everything a route needs, so the progress bar crosses the download
 * once instead of restarting at every asset (C-10). The inference worker feeds this the manifest
 * assets it plans to fetch plus the model cache's byte-level status events, and reports a single
 * {loaded,total} pair for the whole set.
 *
 * In-flight bytes are tracked per asset rather than in a single slot: two assets downloading
 * concurrently (the cache allows bounded parallelism) each advance the bar instead of fighting
 * over one reading, so `loaded` only ever increases within an asset and across them.
 */
/**
 * Every asset descriptor inside a manifest fragment, in declaration order.
 *
 * The prefetch lane acquires exactly what the progress budget plans, so both read the manifest
 * through this one walk. A second copy of these rules would drift, and the difference would show
 * up as a bar that never reaches its total.
 */
export function collectAssets(value, depth = 0, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (typeof value.sha256 === 'string' && Number.isSafeInteger(value.size) && typeof value.url === 'string') { found.push(value); return found; }
  if (depth >= 3) return found;
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectAssets(item, depth + 1, found);
  return found;
}

export function createAcquisitionBudget() {
  const planned = new Map(), completed = new Map(), inflight = new Map();
  // Which assets are actually crossing the network. The bar covers the whole acquisition on
  // purpose — a cache read still costs the visitor time — but the words next to it must not
  // claim a download that is not happening. A warm device reported "Downloading model files…
  // 183 MB of 203 MB" with every one of those bytes already on disk, which is how a cache that
  // was working read as a gigabyte re-downloading on every visit (operator, 22 September).
  const fetching = new Set();
  let emitProgress = null;
  function planAsset(value) {
    for (const asset of collectAssets(value)) planned.set(asset.sha256, asset.size);
  }
  function totals() {
    let total = 0, loaded = 0, fetched = 0, fetchedTotal = 0;
    for (const [sha256, size] of planned) {
      const done = completed.get(sha256) ?? Math.min(inflight.get(sha256) ?? 0, size);
      total += size; loaded += done;
      if (fetching.has(sha256)) { fetchedTotal += size; fetched += done; }
    }
    return { loaded, total, fetched, fetchedTotal };
  }
  // progressOnly marks a reading that belongs to the bar and not to the diagnostics ledger: at a
  // megabyte a tick these would be hundreds of POSTs saying nothing the boundaries do not.
  function progress(progressOnly) {
    if (!emitProgress) return;
    const { loaded, total, fetched, fetchedTotal } = totals();
    emitProgress({ loaded, total, fetched, fetchedTotal }, progressOnly);
  }
  function cacheEvent(event) {
    // The cache says 'missing' before it reaches for the network and 'downloading' as it does.
    // Nothing else promotes an asset into the fetched set: a retained asset never becomes one,
    // and a repair re-announces itself through the same two statuses.
    if (event.status === 'missing' || event.status === 'downloading') { fetching.add(event.sha256); progress(true); return; }
    if (event.status === 'progress') { inflight.set(event.sha256, event.loaded); progress(true); return; }
    if (event.status === 'retained' || event.status === 'saved' || event.status === 'verified') {
      completed.set(event.sha256, event.bytes ?? planned.get(event.sha256) ?? 0);
      inflight.delete(event.sha256);
      progress(true);
    }
  }
  return { planAsset, totals, progress, cacheEvent, attach: fn => { emitProgress = fn; } };
}
