// fm-qrfz row 3, type level: a grant cannot be constructed without digests and byte scope.
import { makeGrant, sha256Of, type BoundedGrant, type Sha256 } from './grant-policy.ts';

const digest = sha256Of('a'.repeat(64)) as Sha256;
const base = { id: 1, manifestSha256: 'f'.repeat(64), route: 'cpu', purpose: 'generate' } as const;
const asset = { sha256: digest, bytes: 1, priority: 'synthesis-prerequisite' } as const;
const owners = ['face:1'] as const;

export const ok: BoundedGrant = makeGrant({ ...base, assets: [asset], owners });
export const noAssets = makeGrant({
  ...base,
  // @ts-expect-error No assets: there is no byte scope to approve.
  assets: [],
  owners,
});
export const noBytes = makeGrant({
  ...base,
  // @ts-expect-error An asset without its byte size.
  assets: [{ sha256: digest, priority: 'optional' }],
  owners,
});
export const plainDigest = makeGrant({
  ...base,
  // @ts-expect-error A digest that was never checked.
  assets: [{ ...asset, sha256: 'a'.repeat(64) }],
  owners,
});
export const nullBytes = makeGrant({
  ...base,
  // @ts-expect-error An unknown (null) size is not a byte scope.
  assets: [{ ...asset, bytes: null }],
  owners,
});
export const noOwner = makeGrant({
  ...base,
  assets: [asset],
  // @ts-expect-error No owner: nobody could cancel it.
  owners: [],
});
// @ts-expect-error A grant is never a plain object literal: only makeGrant brands one.
export const literal: BoundedGrant = { ...base, assets: [asset], owners, remainingBytes: 1 };
