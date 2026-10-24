// Manifest walking, contract validation and the private-provenance rule (fm-3osh). The contract is
// @facemorph/browser-model-manager's: its parser here, and its JSON schema in the tests. A published manifest
// names hosted URLs and digests only; local paths, private inventories and source checkouts never appear in it.
import { parseModelManifest, type ManifestError } from '@facemorph/browser-model-manager';

/** A descriptor as it appears anywhere in a manifest: hosted (`url`) or unpublished (`file`). */
export interface AssetNode {
  url?: string;
  file?: string;
  sha256: string;
  size: number;
  chunks?: { url?: string; file?: string; sha256: string; size: number }[];
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a manifest value is an asset descriptor (digest, size and a location). */
export function isAssetNode(v: unknown): v is AssetNode {
  return (
    isRecord(v) &&
    typeof v['sha256'] === 'string' &&
    typeof v['size'] === 'number' &&
    (typeof v['url'] === 'string' || typeof v['file'] === 'string')
  );
}

/** Every asset descriptor in a manifest with its JSON path, depth first in key order. Chunks are not visited. */
export function assets(manifest: unknown): { readonly path: string; readonly asset: AssetNode }[] {
  const out: { path: string; asset: AssetNode }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (isAssetNode(v)) {
      out.push({ path, asset: v });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isRecord(v)) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(manifest, '$');
  return out;
}

export type ContractCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ManifestError };

/** The manager's own parser: a newer or unknown major, or a malformed asset, is rejected. */
export function checkContract(
  manifest: unknown,
  options: { readonly unpublished?: boolean } = {},
): ContractCheck {
  const r = parseModelManifest(manifest, options);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Patterns that mark private provenance: local filesystem paths, sibling checkouts, private inventories. */
export const PRIVATE_PROVENANCE: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'absolute-path', pattern: /(^|[\s"'(=])\/(home|Users|tmp|root|mnt|srv|var)\//u },
  { rule: 'windows-path', pattern: /\b[A-Za-z]:\\\\/u },
  { rule: 'file-url', pattern: /file:\/\//u },
  { rule: 'sibling-checkout', pattern: /\.\.\/[\w.-]+-classic\b|\.\.\/review-artifacts\b/u },
  { rule: 'private-inventory', pattern: /sources\.private\.json|review-artifacts/u },
];

/** Every string in the manifest that matches a private-provenance pattern, plus any `source`-path key. */
export function provenanceFindings(
  manifest: unknown,
): { readonly path: string; readonly rule: string }[] {
  const out: { path: string; rule: string }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      for (const { rule, pattern } of PRIVATE_PROVENANCE)
        if (pattern.test(v)) out.push({ path, rule });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isRecord(v))
      for (const [k, x] of Object.entries(v)) {
        if (/^(source|sourcePath|localPath)$/u.test(k) && typeof x === 'string')
          out.push({ path: `${path}.${k}`, rule: 'source-path-key' });
        walk(x, `${path}.${k}`);
      }
  };
  walk(manifest, '$');
  return out;
}
