// Publication (fm-3osh): a dry run by default. Without `publish: true` nothing is written and nothing is run;
// the plan lists each file the target would receive. A target names its product; a paid product is refused
// unless the target names that same product in `paidServiceApproved`, so publication never turns on a paid
// service by itself. Targets: a directory (a static root the serving side deploys, or a local mirror) and a
// Cloudflare project directory deployed with the `cf` CLI (`cf deploy` in that directory). Model terms are checked
// first: the target names a terms record (rows shaped like the repository's import/licences.json), one row must
// cover the manifest's modelSourceSha256, and a row whose redistribution is not "permitted" refuses publication
// unless the target acknowledges that row by id.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileDigest, freeze } from './chunks.ts';
import { PAID_PRODUCTS, type HostingProduct } from './limits.ts';
import { inside } from './stage.ts';
import { listFiles } from './verify.ts';

/** The model terms a target publishes under: a record file and, for unresolved terms, the row acknowledged. */
export interface TermsChoice {
  readonly record: string;
  readonly acknowledged?: string;
}

export type Target =
  | {
      readonly kind: 'directory';
      readonly path: string;
      readonly product?: HostingProduct;
      readonly paidServiceApproved?: HostingProduct;
      readonly terms?: TermsChoice;
    }
  | {
      readonly kind: 'cloudflare';
      /** Directory holding the Cloudflare project configuration whose static assets directory is the staged root. */
      readonly project: string;
      readonly product: HostingProduct;
      readonly paidServiceApproved?: HostingProduct;
      readonly terms?: TermsChoice;
    };

interface TermsRow {
  readonly id: string;
  readonly redistribution?: string;
  readonly [key: string]: unknown;
}

/** Why the model terms refuse publication of `manifest`, or null when they allow it. */
export function termsRefusal(manifest: unknown, terms: TermsChoice | undefined): string | null {
  const source = (manifest as { modelSourceSha256?: unknown } | null)?.modelSourceSha256;
  if (typeof source !== 'string') return 'the manifest names no modelSourceSha256';
  if (!terms) return 'the target names no model terms record';
  if (!existsSync(terms.record)) return `model terms record not found: ${terms.record}`;
  const rows = (JSON.parse(readFileSync(terms.record, 'utf8')) as { rows?: TermsRow[] }).rows ?? [];
  const row = rows.find((r) => JSON.stringify(r).includes(source));
  if (!row) return `no model terms row covers modelSourceSha256 ${source}`;
  if (row.redistribution !== 'permitted' && terms.acknowledged !== row.id)
    return `model terms row ${row.id} has redistribution "${row.redistribution ?? 'unstated'}"; the target must acknowledge it`;
  return null;
}

export interface PlannedWrite {
  readonly path: string;
  readonly bytes: number;
  readonly action: 'write' | 'unchanged' | 'conflict';
}

export interface PublicationPlan {
  readonly target: Target;
  readonly product: HostingProduct;
  readonly paid: boolean;
  readonly refused: string | null;
  readonly writes: readonly PlannedWrite[];
  readonly bytes: number;
}

export interface PublicationResult extends PublicationPlan {
  readonly published: boolean;
  readonly written: number;
}

const productOf = (t: Target): HostingProduct => t.product ?? 'workers-static-assets-free';

/** What publishing `root` to `target` would do. Reads only. */
export function planPublication(root: string, target: Target): PublicationPlan {
  const product = productOf(target);
  const paid = PAID_PRODUCTS.includes(product);
  const manifestPath = join(root, 'manifest.json');
  const refused =
    paid && target.paidServiceApproved !== product
      ? `${product} is a paid service; the target must name it in paidServiceApproved to publish`
      : termsRefusal(
          existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null,
          target.terms,
        );
  const writes = listFiles(root).map((f): PlannedWrite => {
    if (target.kind !== 'directory') return { ...f, action: 'write' };
    const dest = inside(target.path, f.path);
    if (!existsSync(dest)) return { ...f, action: 'write' };
    const a = fileDigest(dest);
    const b = fileDigest(join(root, f.path));
    return { ...f, action: a.sha256 === b.sha256 && a.size === b.size ? 'unchanged' : 'conflict' };
  });
  const conflicts = writes.filter((w) => w.action === 'conflict');
  return {
    target,
    product,
    paid,
    refused:
      refused ??
      (conflicts.length
        ? `immutable destination changed: ${conflicts.map((c) => c.path).join(', ')}`
        : null),
    writes,
    bytes: writes.reduce((n, w) => n + w.bytes, 0),
  };
}

/** Publishes only when `publish` is true and the plan is not refused; otherwise returns the plan untouched. */
export function publishRoot(
  root: string,
  target: Target,
  options: { readonly publish?: boolean } = {},
): PublicationResult {
  const plan = planPublication(root, target);
  if (!options.publish || plan.refused) return { ...plan, published: false, written: 0 };
  if (target.kind === 'directory') {
    let written = 0;
    for (const w of plan.writes)
      if (w.action === 'write') {
        freeze(inside(target.path, w.path), readFileSync(join(root, w.path)));
        written++;
      }
    return { ...plan, published: true, written };
  }
  const r = spawnSync('cf', ['deploy'], { cwd: target.project, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`cf deploy exited ${r.status}`);
  return { ...plan, published: true, written: plan.writes.length };
}
