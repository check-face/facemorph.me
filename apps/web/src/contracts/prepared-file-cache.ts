// Prepared-file cache contract (fm-s9n): which encoded export files the app keeps ready to Save or
// Share, and what happens when they no longer fit. Pure planning over plain values; the I/O that holds
// the bytes (memory, OPFS) applies the plan and owns nothing here.
//
// The cache is bounded only by bytes. There is deliberately no entry-count bound, and no export in
// this module may be named `*_MAX_ENTRIES` (the contract test fails the type check if one appears).

import { canonicalJson } from './export-identity.ts';

/**
 * Name of the byte bound. Its value comes from the ceilings row set by contracts milestone 2; no
 * number is invented here, so every planning function takes `maxBytes` as an argument.
 */
export const PREPARED_FILE_CACHE_MAX_BYTES_NAME = 'PREPARED_FILE_CACHE_MAX_BYTES';

declare const preparedFileCacheMaxBytesBrand: unique symbol;
/** A byte bound taken from the ceilings row (PREPARED_FILE_CACHE_MAX_BYTES, set by contracts milestone 2). */
export type PreparedFileCacheMaxBytes = number & { readonly [preparedFileCacheMaxBytesBrand]: true };

/** Brands a ceilings-row value; refuses anything that is not a positive safe integer. */
export function preparedFileCacheMaxBytes(value: number): PreparedFileCacheMaxBytes {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError('PREPARED_FILE_CACHE_MAX_BYTES must be a positive integer byte count');
  return value as PreparedFileCacheMaxBytes;
}

/** What makes one prepared file: the result revision, the container format and its encoding options. */
export interface PreparedFileKeyFields {
  readonly resultRevision: number;
  readonly format: string;
  /** Plain JSON encoding options (quality, frame rate ...); order of keys never matters. */
  readonly encodingOptions: unknown;
}

/** Stable string key: canonical JSON of the three key fields. */
export function preparedFileKey(fields: PreparedFileKeyFields): string {
  return canonicalJson({
    resultRevision: fields.resultRevision,
    format: fields.format,
    encodingOptions: fields.encodingOptions,
  });
}

export interface PreparedFileEntry {
  readonly key: string;
  readonly bytes: number;
}

export interface PreparedFileCacheState {
  /** Least recently used first. */
  readonly entries: readonly PreparedFileEntry[];
  /** Key of the current selection's file; never evicted while pinned. */
  readonly pinnedKey: string | null;
}

export const EMPTY_PREPARED_FILE_CACHE: PreparedFileCacheState = Object.freeze({
  entries: Object.freeze([]),
  pinnedKey: null,
});

/** Reported when a single file is larger than the whole bound: prepared and handed off, never kept. */
export type PreparedFileNotRetained = 'PreparedFileNotRetained';

export interface CacheInsertPlan {
  readonly state: PreparedFileCacheState;
  /** Keys to drop, in eviction order (least recently used first). */
  readonly evicted: readonly string[];
  readonly retained: boolean;
  /** Set exactly when `retained` is false. */
  readonly notRetained?: PreparedFileNotRetained;
}

export function cacheBytes(state: PreparedFileCacheState): number {
  let total = 0;
  for (const entry of state.entries) total += entry.bytes;
  return total;
}

/**
 * Plans inserting one freshly prepared file. `pin` marks it as the current selection's file (the
 * previous pin is released and becomes evictable). Older entries go least-recently-used first, never
 * the pinned one, until the total fits `maxBytes`. A file larger than `maxBytes`, or one that cannot
 * fit beside the pinned file, is handed off and not retained, and nothing else is evicted for it.
 */
export function planCacheInsert(
  state: PreparedFileCacheState,
  entry: PreparedFileEntry,
  maxBytes: number,
  pin = false,
): CacheInsertPlan {
  const unchanged = (): CacheInsertPlan => ({
    state,
    evicted: [],
    retained: false,
    notRetained: 'PreparedFileNotRetained',
  });
  if (entry.bytes > maxBytes) return unchanged();
  const pinnedKey = pin ? entry.key : state.pinnedKey;
  // A re-prepared key replaces its old record and becomes most recently used.
  const others = state.entries.filter((e) => e.key !== entry.key);
  const evicted: string[] = [];
  const kept: PreparedFileEntry[] = [];
  let total = entry.bytes;
  for (const e of others) total += e.bytes;
  for (const e of others) {
    if (total > maxBytes && e.key !== pinnedKey) {
      evicted.push(e.key);
      total -= e.bytes;
    } else kept.push(e);
  }
  if (total > maxBytes) return unchanged();
  return { state: { entries: [...kept, entry], pinnedKey }, evicted, retained: true };
}

/** Marks a hit as most recently used. Unknown keys leave the state as it was. */
export function touchCacheEntry(state: PreparedFileCacheState, key: string): PreparedFileCacheState {
  const hit = state.entries.find((e) => e.key === key);
  if (hit === undefined) return state;
  return { ...state, entries: [...state.entries.filter((e) => e.key !== key), hit] };
}

/** Moves the pin to the current selection's file (or releases it with null). */
export function pinCacheEntry(
  state: PreparedFileCacheState,
  key: string | null,
): PreparedFileCacheState {
  return { ...state, pinnedKey: key };
}

export type PreparedFileLookup =
  | { readonly status: 'ready'; readonly state: PreparedFileCacheState }
  | {
      readonly status: 'preparing';
      /** Shown while the file is rebuilt. */
      readonly label: 'Preparing file…';
      /** Re-encoded from the retained pixels/frames; the model never runs again. */
      readonly source: 'retained-pixels-or-frames';
      readonly newInference: false;
    };

/** A hit is touched; a miss (evicted or never prepared) is the degraded "Preparing file…" state. */
export function lookupPreparedFile(state: PreparedFileCacheState, key: string): PreparedFileLookup {
  if (state.entries.some((e) => e.key === key))
    return { status: 'ready', state: touchCacheEntry(state, key) };
  return {
    status: 'preparing',
    label: 'Preparing file…',
    source: 'retained-pixels-or-frames',
    newInference: false,
  };
}
