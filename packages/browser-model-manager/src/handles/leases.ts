// Reference-counted asset leases (fm-ffn7, contracts/leases.ts). A loaded handle leases the verified local assets it
// needs; manager eviction and deletion skip any asset with a count above zero. When the platform takes a leased asset
// anyway (browser eviction, corruption, another tab's deletion, device or worker loss), invalidate() tells every
// holder once, with the contract's mapped error and settlement rule. Leases constrain the manager, not the browser.

import type { ManagerError } from '../contracts/errors.ts';
import {
  LEASE_INVALIDATION,
  type AssetLease,
  type LeaseInvalidationCause,
} from '../contracts/leases.ts';

export interface LeaseHolder {
  /** Called once per holder when any of its assets is invalidated. */
  invalidated(
    cause: LeaseInvalidationCause,
    error: ManagerError & { code: 'invalidated' | 'evicted' | 'corrupt' },
  ): void;
}

export interface LeaseRegistry {
  /** Leases each asset for `holder`; the returned leases release individually (idempotent). */
  lease(assets: readonly { sha256: string; bytes: number }[], holder: LeaseHolder): AssetLease[];
  refCount(sha256: string): number;
  leased(): string[];
  /** The platform took `sha256` from under its holders: each holder hears once. */
  invalidate(sha256: string, cause: LeaseInvalidationCause): number;
}

export function invalidationError(
  sha256: string,
  cause: LeaseInvalidationCause,
): ManagerError & { code: 'invalidated' | 'evicted' | 'corrupt' } {
  const code = LEASE_INVALIDATION[cause].error;
  const message = `asset ${sha256.slice(0, 12)} is no longer available locally (${cause}); nothing is refetched inside an operation`;
  if (code === 'evicted' || code === 'corrupt') return { code, sha256, message };
  return { code: 'invalidated', cause, message };
}

/** The Web Locks API's request(), structurally; across tabs a held lease is a shared lock on its asset. */
export interface AssetLocks {
  request<T>(
    name: string,
    options: { mode: 'shared' | 'exclusive'; ifAvailable?: boolean },
    run: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}
export const lockName = (sha256: string) => `facemorph-model-asset:${sha256}`;

/** With `locks`, every leased asset also holds a shared Web Lock until its last local lease is released, so another
 * tab's eviction (which needs the lock exclusively) keeps it too. */
export function createLeaseRegistry({ locks }: { locks?: AssetLocks } = {}): LeaseRegistry {
  const holders = new Map<string, Map<LeaseHolder, number>>();
  const held = new Map<string, () => void>();
  const hold = (sha256: string) => {
    if (!locks || held.has(sha256)) return;
    let free = () => {};
    const released = new Promise<void>((r) => (free = r));
    held.set(sha256, free);
    void locks.request(lockName(sha256), { mode: 'shared' }, () => released);
  };
  const unhold = (sha256: string) => {
    held.get(sha256)?.();
    held.delete(sha256);
  };
  const count = (sha256: string) =>
    [...(holders.get(sha256)?.values() ?? [])].reduce((a, b) => a + b, 0);
  return {
    lease(assets, holder) {
      return assets.map(({ sha256, bytes }) => {
        const byHolder = holders.get(sha256) ?? new Map<LeaseHolder, number>();
        holders.set(sha256, byHolder);
        hold(sha256);
        byHolder.set(holder, (byHolder.get(holder) ?? 0) + 1);
        let released = false;
        return {
          sha256,
          bytes,
          get refCount() {
            return count(sha256);
          },
          release() {
            if (released) return;
            released = true;
            const n = (byHolder.get(holder) ?? 1) - 1;
            if (n > 0) byHolder.set(holder, n);
            else byHolder.delete(holder);
            if (byHolder.size === 0 && holders.get(sha256) === byHolder) {
              holders.delete(sha256);
              unhold(sha256);
            }
          },
        };
      });
    },
    refCount: count,
    leased: () => [...holders.keys()].sort(),
    invalidate(sha256, cause) {
      const byHolder = holders.get(sha256);
      if (!byHolder) return 0;
      const error = invalidationError(sha256, cause);
      const told = [...byHolder.keys()];
      for (const h of told) h.invalidated(cause, error);
      return told.length;
    },
  };
}

/** Where the manager keeps asset bytes: anything that can remove one asset by digest (shard store, blob store). */
export interface Removable {
  remove(sha256: string): Promise<unknown>;
}

/** Manager-controlled eviction: removes the requested assets from every store except leased ones, in this tab (local
 * count) and, with `locks`, in any tab (an asset whose lock cannot be taken exclusively right now is kept). */
export async function evictUnleased(
  sha256s: readonly string[],
  stores: readonly Removable[],
  registry: LeaseRegistry,
  locks?: AssetLocks,
): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const sha of sha256s) {
    if (registry.refCount(sha) > 0) {
      kept.push(sha);
      continue;
    }
    const remove = async () => {
      for (const store of stores) await store.remove(sha);
      removed.push(sha);
    };
    if (!locks) await remove();
    else
      await locks.request(lockName(sha), { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (lock) await remove();
        else kept.push(sha);
      });
  }
  return { removed, kept };
}
