// Asset leases. A loaded handle holds reference-counted leases on the verified local assets it needs;
// manager eviction or deletion cannot remove a leased asset. Leases constrain the manager, not the
// browser's ability to reclaim storage: when the platform takes an asset anyway, the lease is
// invalidated, affected operations settle and release their resources, and nothing repairs over the
// network inside an operation. Reacquisition and re-admission happen outside engine execution, under
// the app's consent policy.

import type { ManagerErrorCode } from './errors.ts';

export type LeaseInvalidationCause = 'browser-eviction' | 'corruption' | 'cross-tab-deletion' | 'device-loss' | 'worker-loss';

/** How the operations holding an invalidated lease end. */
export type SettlementRule =
  /** Pending operations settle as failed with the mapped error; resources are released. */
  | 'fail-pending-and-release'
  /** The handle is gone (device or worker): pending operations settle as failed and the handle is unusable. */
  | 'fail-pending-and-dispose-handle';

export interface AssetLease {
  readonly sha256: string;
  readonly bytes: number;
  /** Holders of this asset; manager eviction skips any asset whose count is above zero. */
  readonly refCount: number;
  release(): void;
}

/** Every cause maps to exactly one manager error and settlement rule (exhaustive by its type). */
export const LEASE_INVALIDATION: Readonly<Record<LeaseInvalidationCause, { readonly error: ManagerErrorCode; readonly settlement: SettlementRule }>> = Object.freeze({
  'browser-eviction': { error: 'evicted', settlement: 'fail-pending-and-release' },
  corruption: { error: 'corrupt', settlement: 'fail-pending-and-release' },
  'cross-tab-deletion': { error: 'invalidated', settlement: 'fail-pending-and-release' },
  'device-loss': { error: 'invalidated', settlement: 'fail-pending-and-dispose-handle' },
  'worker-loss': { error: 'invalidated', settlement: 'fail-pending-and-dispose-handle' },
});
