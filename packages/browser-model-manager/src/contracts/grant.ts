// Acquisition grants: what a person approved the device to download, for which purpose and owners.
//
// Approval covers deferred stages and retries within the unchanged scope only; extra or replacement
// scope needs a revised decision, and cache revalidation cannot silently inflate it. Cancelling
// releases that owner; a shared fetch stops when its last approved owner leaves; verified chunks are
// kept and cancelled transfers are never revived. Requests deduplicate by digest, and acquisition
// holds no compute permit while it waits. Unknown cache or manifest status gives bounded inspection
// or a retryable error, never permission to fetch (the candidate's unknown inventory bypassed
// gateScope). The manager supplies these primitives; the policy that uses them lives in the app.

import type { ComputeRoute } from 'stylegan-js';
import type { AssetInventory } from './lifecycle.ts';

export type GrantPurpose = 'generate' | 'generate-and-encode' | 'prepare-encoder';

/** Who holds a share of an acquisition: a face slot, a photo crop, or speculative warming. */
export type GrantOwnerId = `${'face' | 'photo' | 'warming' | 'export'}:${string}`;

export type GrantDecision = 'approved' | 'declined' | 'cancelled' | 'revision-required';

export type AcquisitionPriority =
  | 'foreground-required'
  | 'synthesis-prerequisite'
  | 'detector-prerequisite'
  | 'optional'
  | 'speculative-warming';

export interface GrantAsset {
  readonly sha256: string;
  readonly bytes: number;
  readonly priority: AcquisitionPriority;
}

export interface AcquisitionGrant {
  readonly manifestSha256: string;
  readonly route: ComputeRoute;
  readonly purpose: GrantPurpose;
  readonly assets: readonly GrantAsset[];
  /** Bytes still to transfer that the person was shown; the grant never covers more. */
  readonly remainingBytes: number;
  readonly owners: readonly GrantOwnerId[];
}

/** Speculative warming yields to every foreground priority and is cancelled first under pressure. */
export interface WarmingOwnership {
  readonly owner: `warming:${string}`;
  readonly priority: 'speculative-warming';
  readonly yieldsTo: readonly Exclude<AcquisitionPriority, 'speculative-warming'>[];
}

/** A request is covered only by the same manifest, route and digests within the advertised bytes. */
export function scopeCovers(
  grant: AcquisitionGrant,
  request: {
    readonly manifestSha256: string;
    readonly route: ComputeRoute;
    readonly assets: readonly { readonly sha256: string; readonly bytes: number }[];
  },
): 'covered' | 'revision-required' {
  if (request.manifestSha256 !== grant.manifestSha256 || request.route !== grant.route)
    return 'revision-required';
  const granted = new Map(grant.assets.map((a) => [a.sha256, a.bytes]));
  const unique = new Map(request.assets.map((a) => [a.sha256, a.bytes]));
  let bytes = 0;
  for (const [sha256, size] of unique) {
    if (granted.get(sha256) !== size) return 'revision-required';
    bytes += size;
  }
  return bytes <= grant.remainingBytes ? 'covered' : 'revision-required';
}

export interface SharedFetch {
  readonly sha256: string;
  readonly owners: readonly GrantOwnerId[];
}

/** Removes `owner` from every fetch; a fetch with no owner left stops (its verified chunks are kept). */
export function cancelOwner(
  fetches: readonly SharedFetch[],
  owner: GrantOwnerId,
): { readonly continuing: readonly SharedFetch[]; readonly stopped: readonly string[] } {
  const continuing: SharedFetch[] = [];
  const stopped: string[] = [];
  for (const f of fetches) {
    const owners = f.owners.filter((o) => o !== owner);
    if (owners.length) continuing.push({ sha256: f.sha256, owners });
    else stopped.push(f.sha256);
  }
  return { continuing, stopped };
}

/** What may happen to an asset given its inventory and the grant decision. */
export function inventoryAction(
  inventory: AssetInventory,
  decision: GrantDecision,
): 'none' | 'fetch' | 'inspect' | 'wait-for-decision' {
  if (inventory === 'verified-local') return 'none';
  if (inventory === 'unknown') return 'inspect';
  return decision === 'approved' ? 'fetch' : 'wait-for-decision';
}
