// Manager lifecycle: construct, authorise, acquire, verify, load, lease, invalidate, dispose.
//
// Survey inputs (classic a42829b): Assets/model-cache.mjs (acquire/bytes/open with network repair,
// per-read platform SHA, exact-length buffers, unit corruption repair, URL-independent pinned reuse,
// Cache Storage fallback) and Assets/shard-store.mjs (OPFS shards, Safari worker sync handles). Those
// mechanisms are retained inside the manager. What crosses to the engine is only a loaded handle
// over verified local bytes: the repair-capable handle never does, and neither do status() or
// capabilities(), which read state without starting any acquisition. Candidate cache identities
// (checkface-model-blobs-v1) and on-origin result/session formats stay compatible; model caches are
// separate from app retention, and model-cache eviction never deletes exports or recovery records.
// An in-flight app uses one immutable manifest identity.

import type { CancellationSignal, LoadedModelCapability } from 'stylegan-js';
import type { AcquisitionBudget, LiveResidencyLimit } from './budgets.ts';
import type { ManagerError, Result } from './errors.ts';
import type { AcquisitionGrant, GrantDecision, GrantOwnerId } from './grant.ts';
import type { AssetLease, LeaseInvalidationCause } from './leases.ts';
import type { AssetDescriptor, ModelManifestV1 } from './manifest.ts';

/** Inventory of one asset as last observed; `unknown` never authorises a fetch. */
export type AssetInventory = 'verified-local' | 'partial' | 'absent' | 'unknown';

export interface ManagerStatus {
  readonly manifestSha256: string;
  readonly assets: readonly {
    readonly sha256: string;
    readonly size: number;
    readonly inventory: AssetInventory;
    readonly leased: boolean;
  }[];
  /** Bytes still to transfer for the approved scope, or null when inventory is unknown. */
  readonly remainingBytes: number | null;
  readonly persistentStorage: 'granted' | 'not-granted' | 'unknown';
}

export interface ManagerCapabilities {
  readonly opfs: boolean;
  readonly opfsSyncHandles: boolean;
  readonly cacheStorage: boolean;
}

/**
 * Reads verified local bytes only. `allowRepair` is fixed at false across OPFS and Cache Storage: a
 * missing or corrupt unit is an error, never a fetch. (`readOnly`, `has()` or `peek()` alone are not
 * this boundary; the type is.)
 */
export interface VerifiedLocalReader {
  readonly allowRepair: false;
  /** Exact-length bytes whose platform SHA-256 matched on this read. */
  read(asset: AssetDescriptor): Promise<Result<Uint8Array, ManagerError>>;
}

/** A loaded model: the engine capability plus the leases that keep its bytes. */
export interface LoadedModelHandle {
  readonly manifestSha256: string;
  readonly capability: LoadedModelCapability;
  readonly leases: readonly AssetLease[];
  /** Fired once when any lease is invalidated; the handle's pending operations then settle. */
  onInvalidated(listener: (cause: LeaseInvalidationCause) => void): void;
  release(): Promise<void>;
}

export interface ModelManager {
  /** Acquisition-free. */
  status(): Promise<Result<ManagerStatus, ManagerError>>;
  /** Acquisition-free. */
  capabilities(): ManagerCapabilities;
  /** Records the app's decision on a grant; only `approved` lets acquire() transfer bytes. */
  authorize(grant: AcquisitionGrant, decision: GrantDecision): void;
  /** Transfers the grant's scope within its budget; verified chunks are kept on cancel. */
  acquire(owner: GrantOwnerId, budget: AcquisitionBudget): Promise<Result<void, ManagerError>>;
  /** Re-hashes local bytes; a corrupt unit is removed and reported, not refetched here. */
  verify(assets: readonly AssetDescriptor[]): Promise<Result<void, ManagerError>>;
  /** Builds a loaded handle over verified local bytes only. */
  load(
    manifest: ModelManifestV1,
    reader: VerifiedLocalReader,
    residency: LiveResidencyLimit,
  ): Promise<Result<LoadedModelHandle, ManagerError>>;
  /** Leases the assets a handle needs; the manager will not evict them while held. */
  lease(sha256: readonly string[]): Result<readonly AssetLease[], ManagerError>;
  /** Called by the platform adapters when a leased asset goes away underneath. */
  invalidate(sha256: string, cause: LeaseInvalidationCause): void;
  /** Cancels this owner's acquisition; a shared fetch stops when its last approved owner leaves. */
  cancel(owner: GrantOwnerId): void;
  dispose(): Promise<void>;
}

/**
 * The manager is constructed with no globals and no I/O: storage backends and the fetch function
 * arrive as arguments, and nothing starts until a grant is authorised.
 */
export type CreateModelManager = (options: {
  readonly manifest: ModelManifestV1;
  readonly manifestSha256: string;
  readonly storage: ManagerStorage;
  readonly fetcher: ManagerFetcher;
}) => ModelManager;

/** Storage backends handed in by the caller (OPFS root, Cache Storage), typed by the implementation bead. */
export interface ManagerStorage {
  readonly opfsRoot?: object;
  readonly cacheStorage?: object;
}

/** The network, handed in; only acquire() under an approved grant calls it. */
export type ManagerFetcher = (
  url: string,
  init: { readonly signal?: CancellationSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly body: object | null }>;
