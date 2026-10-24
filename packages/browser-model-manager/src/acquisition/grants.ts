// Grant enforcement (fm-fr9s): the manager transfers bytes only under an AcquisitionGrant the app supplies, only
// for digests inside it, and never more bytes than it approved. Every byte received counts against the grant,
// whichever origin sent it and whichever attempt it belonged to (a retry, an alternate origin, a corrupt chunk's
// refetch), so what the person approved is a bound on what crosses the network. A grant's remaining bytes only
// go down: nothing the manager does (retry, repair, revalidation) adds to them. More scope is a new grant object,
// which only the app can make, after a revised decision.

import type { AcquisitionGrant, GrantAsset, GrantOwnerId } from '../contracts/grant.ts';

export type GrantRefusal =
  /** No grant was supplied: nothing is fetched. */
  | 'no-grant'
  /** The owner is not one the grant names. */
  | 'owner-not-in-grant'
  /** The digest or its size is not in the grant. */
  | 'out-of-scope'
  /** The grant's remaining bytes cannot cover the transfer: a revised grant is needed. */
  | 'revision-required'
  /** Every owner of the shared fetch has left. */
  | 'no-owner';

/** Thrown before any request is made; `refusal` says why. */
export class GrantRefused extends Error {
  readonly refusal: GrantRefusal;
  readonly sha256: string;
  constructor(refusal: GrantRefusal, sha256: string) {
    super(
      refusal === 'revision-required'
        ? 'This download needs more data than was approved. Approve the download again to continue.'
        : `Model file ${sha256.slice(0, 12)} is not covered by an approved download (${refusal}).`,
    );
    this.name = 'GrantRefused';
    this.refusal = refusal;
    this.sha256 = sha256;
  }
}

interface Ledger {
  remaining: number;
  reserved: number;
}
const ledgers = new WeakMap<AcquisitionGrant, Ledger>();
const ledgerOf = (grant: AcquisitionGrant): Ledger => {
  let l = ledgers.get(grant);
  if (!l) {
    if (!Number.isSafeInteger(grant.remainingBytes) || grant.remainingBytes < 0)
      throw new TypeError('A grant needs a non-negative integer remainingBytes');
    l = { remaining: grant.remainingBytes, reserved: 0 };
    ledgers.set(grant, l);
  }
  return l;
};

/** Bytes this grant may still transfer (approved, minus received, minus reserved by attempts in flight). */
export function grantRemaining(grant: AcquisitionGrant): number {
  const l = ledgerOf(grant);
  return l.remaining - l.reserved;
}

/** The asset of `sha256` with exactly `size` bytes in the grant, or a refusal. */
export function grantAsset(
  grant: AcquisitionGrant | undefined,
  owner: GrantOwnerId | undefined,
  sha256: string,
  size: number,
): GrantAsset {
  if (!grant) throw new GrantRefused('no-grant', sha256);
  if (!owner || !grant.owners.includes(owner)) throw new GrantRefused('owner-not-in-grant', sha256);
  const asset = grant.assets.find((a) => a.sha256 === sha256);
  if (!asset || asset.bytes !== size) throw new GrantRefused('out-of-scope', sha256);
  return asset;
}

/** One transfer attempt's claim on a grant: reserved up front, settled at the bytes actually received. */
export interface GrantCharge {
  /** Counts bytes as they arrive; throws once the attempt would pass what it reserved. */
  received(bytes: number): void;
  /** Ends the attempt: received bytes stay spent, the unreceived part of the reservation is returned. */
  settle(): void;
}

/** Reserves `bytes` (one chunk or asset) for an attempt, or refuses with `revision-required`. */
export function chargeGrant(grant: AcquisitionGrant, sha256: string, bytes: number): GrantCharge {
  const l = ledgerOf(grant);
  if (l.remaining - l.reserved < bytes) throw new GrantRefused('revision-required', sha256);
  l.reserved += bytes;
  let got = 0;
  let open = true;
  return {
    received(n) {
      if (!open) return;
      if (got + n > bytes) throw new Error('Asset exceeds declared size');
      got += n;
    },
    settle() {
      if (!open) return;
      open = false;
      l.reserved -= bytes;
      l.remaining -= got;
    },
  };
}
