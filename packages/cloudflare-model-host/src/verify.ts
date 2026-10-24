// Reconstruction verification of a staged or published root (fm-3osh): every asset the manifest names is read
// back from the root by its URL path, a chunked asset through its chunks, and must match its declared digest and
// size; every file in the root must fit the static file limit and the plan's file count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileDigest, reconstruct } from './chunks.ts';
import { limitFindings, type LimitFinding, type Plan } from './limits.ts';
import { assets, checkContract, provenanceFindings } from './manifest.ts';
import { inside } from './stage.ts';

export interface VerifyFinding {
  readonly path: string;
  readonly problem: string;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly assets: number;
  readonly chunked: number;
  readonly chunks: number;
  readonly files: number;
  readonly bytes: number;
  readonly largestFile: { readonly path: string; readonly bytes: number };
  readonly findings: readonly VerifyFinding[];
  readonly limits: readonly LimitFinding[];
}

/** Every regular file under `root`, relative and posix, with its size. */
export function listFiles(root: string): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile())
        out.push({ path: relative(root, full).split('\\').join('/'), bytes: statSync(full).size });
    }
  };
  walk(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Verifies `root` against `root/manifest.json` (or `manifest`), whose URLs start with `base`. */
export function verifyRoot(options: {
  readonly root: string;
  readonly base: string;
  readonly manifest?: string;
  readonly plan?: Plan;
}): VerifyReport {
  const base = options.base.replace(/\/+$/u, '');
  const manifest = JSON.parse(
    readFileSync(join(options.root, options.manifest ?? 'manifest.json'), 'utf8'),
  ) as unknown;
  const findings: VerifyFinding[] = [];
  const contract = checkContract(manifest);
  if (!contract.ok)
    findings.push({ path: contract.error.path, problem: `contract: ${contract.error.code}` });
  for (const p of provenanceFindings(manifest))
    findings.push({ path: p.path, problem: `private provenance: ${p.rule}` });
  const pathOf = (url: string | undefined, where: string): string | undefined => {
    if (typeof url === 'string' && url.startsWith(`${base}/`)) return url.slice(base.length + 1);
    findings.push({ path: where, problem: `url not under ${base}` });
    return undefined;
  };
  let chunked = 0;
  let chunks = 0;
  const found = assets(manifest);
  for (const { path, asset } of found) {
    if (asset.chunks) {
      chunked++;
      chunks += asset.chunks.length;
      const list = asset.chunks.map((c, i) => ({
        path: pathOf(c.url, `${path}.chunks[${i}]`) ?? '',
        sha256: c.sha256,
        size: c.size,
      }));
      const whole = reconstruct(list, options.root);
      for (const p of whole.problems)
        findings.push({ path: `${path} ${p.path}`, problem: p.problem });
      if (whole.sha256 !== asset.sha256 || whole.size !== asset.size)
        findings.push({ path, problem: 'reconstruction differs from the asset digest' });
      continue;
    }
    const rel = pathOf(asset.url, path);
    if (rel === undefined) continue;
    let got: { sha256: string; size: number } | undefined;
    try {
      got = fileDigest(inside(options.root, rel));
    } catch {
      got = undefined;
    }
    if (!got) findings.push({ path, problem: `missing: ${rel}` });
    else if (got.sha256 !== asset.sha256 || got.size !== asset.size)
      findings.push({ path, problem: `digest differs: ${rel}` });
  }
  const files = listFiles(options.root);
  const limits = limitFindings(files, options.plan ?? 'workers-free');
  const largest = files.reduce((a, f) => (f.bytes > a.bytes ? f : a), { path: '', bytes: 0 });
  return {
    ok: findings.length === 0 && limits.length === 0,
    assets: found.length,
    chunked,
    chunks,
    files: files.length,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    largestFile: largest,
    findings,
    limits,
  };
}
