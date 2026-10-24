// The faces store's ceiling (fm-udut, defect 22): stored originals are bounded by bytes, evicted oldest-first by
// last use, and never a record the current session references or a file being prepared. Pure planning over plain
// values; app-storage.ts applies it to IndexedDB. The ceiling comes from measured record sizes over the standard
// journeys; until that measurement lands it is "measured, no threshold" and the caller passes none.

export interface StoredFace {
  readonly key: string;
  readonly bytes: number;
  /** Milliseconds since the epoch of the record's last read or write. */
  readonly lastUsed: number;
}

export interface EvictionPlan {
  readonly evict: readonly string[];
  readonly keptBytes: number;
  /** True when protected records alone exceed the ceiling: nothing protected is evicted to make room. */
  readonly overByProtected: boolean;
}

/**
 * What to evict so the store fits `ceilingBytes`, oldest last use first, skipping `protectedKeys` (the current
 * session's faces and any file being prepared). With no ceiling (not yet measured) nothing is evicted.
 */
export function planEviction(
  faces: readonly StoredFace[],
  ceilingBytes: number | null,
  protectedKeys: ReadonlySet<string>,
): EvictionPlan {
  const total = faces.reduce((n, f) => n + f.bytes, 0);
  if (ceilingBytes === null) return { evict: [], keptBytes: total, overByProtected: false };
  if (!Number.isSafeInteger(ceilingBytes) || ceilingBytes < 0)
    throw new RangeError('ceilingBytes must be a byte count');
  let kept = total;
  const evict: string[] = [];
  for (const f of [...faces].sort((a, b) => a.lastUsed - b.lastUsed || (a.key < b.key ? -1 : 1))) {
    if (kept <= ceilingBytes) break;
    if (protectedKeys.has(f.key)) continue;
    evict.push(f.key);
    kept -= f.bytes;
  }
  return { evict, keptBytes: kept, overByProtected: kept > ceilingBytes };
}
