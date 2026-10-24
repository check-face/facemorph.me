// The Cloudflare product this package publishes to and the limits it is checked against (fm-3osh). Read from
// developers.cloudflare.com on 24 October 2026: /workers/platform/limits/#static-assets and
// /workers/platform/pricing/ (static asset requests are free and unlimited on both plans), and
// /pages/platform/limits/ (the same 25 MiB file limit; larger files belong in R2). The README's limits
// table states the same figures; change both together.

export const MIB = 1024 * 1024;

/** One published file may not exceed this, on every plan. */
export const STATIC_ASSET_FILE_LIMIT_BYTES = 25 * MIB;

/** Inputs above the file limit are cut into chunks of this size (the last is shorter). */
export const CHUNK_BYTES = 16 * MIB;

export type Plan = 'workers-free' | 'workers-paid';

/** Static asset files per Worker version. */
export const STATIC_ASSET_FILES_PER_VERSION: Readonly<Record<Plan, number>> = Object.freeze({
  'workers-free': 20_000,
  'workers-paid': 100_000,
});

/** Products a publication target may name; only the first costs nothing. */
export type HostingProduct = 'workers-static-assets-free' | 'workers-static-assets-paid' | 'r2';

export const PAID_PRODUCTS: readonly HostingProduct[] = ['workers-static-assets-paid', 'r2'];

/** Monthly figures from the pricing page read on the same date, for the README and the delivery inventory. */
export const PRODUCT_COST: Readonly<Record<HostingProduct, string>> = Object.freeze({
  'workers-static-assets-free':
    '$0: static asset requests free and unlimited; 20,000 files per version',
  'workers-static-assets-paid':
    '$5.00 per month Workers Paid subscription; static asset requests free and unlimited',
  r2: 'R2 storage and operations beyond the free allowance (10 GB-month, 1M Class A, 10M Class B); egress free',
});

export interface LimitFinding {
  readonly path: string;
  readonly bytes: number;
  readonly problem: 'over-file-limit' | 'too-many-files';
}

/** Every file must fit the per-file limit, and the count must fit the plan. */
export function limitFindings(
  files: readonly { readonly path: string; readonly bytes: number }[],
  plan: Plan,
): LimitFinding[] {
  const out: LimitFinding[] = files
    .filter((f) => f.bytes > STATIC_ASSET_FILE_LIMIT_BYTES)
    .map((f) => ({ path: f.path, bytes: f.bytes, problem: 'over-file-limit' as const }));
  if (files.length > STATIC_ASSET_FILES_PER_VERSION[plan])
    out.push({ path: '', bytes: files.length, problem: 'too-many-files' });
  return out;
}
