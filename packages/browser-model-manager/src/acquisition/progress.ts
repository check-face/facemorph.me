// Whole-acquisition progress, moved from the candidate's src/Next/browser/acquisition-budget.mjs (classic a42829b)
// without behaviour change (fm-fr9s); the comments are the candidate's. (The candidate called this an "acquisition
// budget"; it counts bytes for one progress bar and bounds nothing: the byte bounds are contracts/budgets.ts.)
//
// One acquisition budget for everything a route needs, so the progress bar crosses the download once instead of
// restarting at every asset (C-10). The inference worker feeds this the manifest assets it plans to fetch plus the
// model cache's byte-level status events, and reports a single {loaded,total} pair for the whole set.
//
// In-flight bytes are tracked per asset rather than in a single slot: two assets downloading concurrently (the
// cache allows bounded parallelism) each advance the bar instead of fighting over one reading, so `loaded` only ever
// increases within an asset and across them.

import type { CacheEvent } from '../cache/model-cache.ts';

export interface PlannedAsset {
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
}

export interface AcquisitionTotals {
  readonly loaded: number;
  readonly total: number;
  readonly fetched: number;
  readonly fetchedTotal: number;
}

export interface AcquisitionProgress {
  planAsset(value: unknown): void;
  probe(has: (asset: PlannedAsset) => Promise<boolean>): Promise<void>;
  totals(): AcquisitionTotals;
  progress(progressOnly: boolean): void;
  cacheEvent(event: CacheEvent): void;
  attach(fn: (totals: AcquisitionTotals, progressOnly: boolean) => void): void;
}

const isPlanned = (value: object): value is PlannedAsset => {
  const v = value as Record<string, unknown>;
  return typeof v.sha256 === 'string' && Number.isSafeInteger(v.size) && typeof v.url === 'string';
};

/**
 * Every asset descriptor inside a manifest fragment, in declaration order.
 *
 * The prefetch lane acquires exactly what the progress budget plans, so both read the manifest through this one
 * walk. A second copy of these rules would drift, and the difference would show up as a bar that never reaches its
 * total.
 */
export function collectAssets(
  value: unknown,
  depth = 0,
  found: PlannedAsset[] = [],
): PlannedAsset[] {
  if (!value || typeof value !== 'object') return found;
  if (isPlanned(value)) {
    found.push(value);
    return found;
  }
  if (depth >= 3) return found;
  for (const item of Array.isArray(value) ? value : Object.values(value))
    collectAssets(item, depth + 1, found);
  return found;
}

export function createAcquisitionBudget(): AcquisitionProgress {
  const planned = new Map<string, number>();
  const completed = new Map<string, number>();
  const inflight = new Map<string, number>();
  // Which assets are actually crossing the network. The bar covers the whole acquisition on purpose — a cache read
  // still costs the visitor time — but the words next to it must not claim a download that is not happening. A warm
  // device reported "Downloading model files… 183 MB of 203 MB" with every one of those bytes already on disk, which
  // is how a cache that was working read as a gigabyte re-downloading on every visit (operator, 22 September).
  const fetching = new Set<string>();
  // Presence answers from the cache, taken when an asset is planned. Without them an asset only joined the fetched
  // set when the cache reached for the network, so the denominator grew asset by asset as the download went on
  // ("40 MB of 60 MB" becoming "of 120 MB").
  const probed = new Map<string, boolean>();
  const descriptors = new Map<string, PlannedAsset>();
  let emitProgress: ((totals: AcquisitionTotals, progressOnly: boolean) => void) | null = null;
  function planAsset(value: unknown) {
    for (const asset of collectAssets(value)) {
      planned.set(asset.sha256, asset.size);
      descriptors.set(asset.sha256, asset);
    }
  }
  function totals(): AcquisitionTotals {
    let total = 0;
    let loaded = 0;
    let fetched = 0;
    let fetchedTotal = 0;
    for (const [sha256, size] of planned) {
      const done = completed.get(sha256) ?? Math.min(inflight.get(sha256) ?? 0, size);
      total += size;
      loaded += done;
      if (fetching.has(sha256) || probed.get(sha256) === false) {
        fetchedTotal += size;
        fetched += done;
      }
    }
    return { loaded, total, fetched, fetchedTotal };
  }
  // progressOnly marks a reading that belongs to the bar and not to the diagnostics ledger: at a megabyte a tick
  // these would be hundreds of POSTs saying nothing the boundaries do not.
  function progress(progressOnly: boolean) {
    if (!emitProgress) return;
    emitProgress(totals(), progressOnly);
  }
  function cacheEvent(event: CacheEvent) {
    // The cache says 'missing' before it reaches for the network and 'downloading' as it does. Nothing else promotes
    // an asset into the fetched set: a retained asset never becomes one, and a repair re-announces itself through the
    // same two statuses.
    if (event.status === 'missing' || event.status === 'downloading') {
      fetching.add(event.sha256);
      progress(true);
      return;
    }
    if (event.status === 'progress') {
      inflight.set(event.sha256, event.loaded as number);
      progress(true);
      return;
    }
    if (event.status === 'retained' || event.status === 'saved' || event.status === 'verified') {
      completed.set(
        event.sha256,
        (event.bytes as number | undefined) ?? planned.get(event.sha256) ?? 0,
      );
      inflight.delete(event.sha256);
      progress(true);
    }
  }
  /** Ask the cache once about every planned asset it has not been asked about yet. */
  async function probe(has: (asset: PlannedAsset) => Promise<boolean>) {
    for (const [sha256, asset] of descriptors) {
      if (probed.has(sha256) || completed.has(sha256)) continue;
      probed.set(sha256, true);
      try {
        probed.set(sha256, (await has(asset)) === true);
      } catch {
        probed.delete(sha256);
      }
    }
  }
  return {
    planAsset,
    probe,
    totals,
    progress,
    cacheEvent,
    attach: (fn) => {
      emitProgress = fn;
    },
  };
}
