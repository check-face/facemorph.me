// Staging qualification of a deployed model origin (fm-fy2.14), read-only: every file of the staged root is fetched
// from the origin and must be byte-identical to the staged file and carry the required headers (src/headers.ts);
// every chunked asset must reconstruct from the chunks the origin serves; the manifest the origin serves must pass
// the manager's contract and, given a reference (the qualified runtime the engine's canaries ran on), name exactly
// its asset digests, so manager and engine agree on schema and hashes. The mirror fallback with the primary failing
// is the browser case in test/staging.e2e.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeHeaders, type HeaderFinding, type HeaderPlan } from './headers.ts';
import { assets, checkContract } from './manifest.ts';
import { listFiles } from './verify.ts';

export interface QualifyOptions extends HeaderPlan {
  readonly root: string;
  /** The origin, e.g. https://staging.example.org */
  readonly origin: string;
  /** The qualified runtime's manifest, whose asset digests the served manifest must name exactly. */
  readonly reference?: unknown;
  readonly parallel?: number;
}

export interface QualifyReport {
  readonly origin: string;
  readonly ok: boolean;
  readonly files: number;
  readonly bytes: number;
  readonly mismatched: readonly { readonly path: string; readonly status: number }[];
  readonly headers: readonly HeaderFinding[];
  readonly chunked: number;
  readonly unreconstructed: readonly string[];
  readonly contract: string | null;
  readonly digests: {
    readonly missing: readonly string[];
    readonly extra: readonly string[];
  } | null;
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const digestSet = (manifest: unknown) => new Set(assets(manifest).map((a) => a.asset.sha256));

export async function qualifyOrigin(options: QualifyOptions): Promise<QualifyReport> {
  const base = (options.basePath ?? '/').replace(/\/?$/, '/');
  const files = listFiles(options.root);
  const served = new Map<string, string>(); // path -> served digest
  const mismatched: { path: string; status: number }[] = [];
  const headers: HeaderFinding[] = [];
  let bytes = 0;
  const queue = [...files];
  await Promise.all(
    Array.from({ length: options.parallel ?? 8 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const path = `${base}${f.path}`;
        const r = await fetch(new URL(path, options.origin));
        const body = new Uint8Array(await r.arrayBuffer());
        bytes += body.byteLength;
        headers.push(...judgeHeaders(options, path, r.status, r.headers));
        const digest = sha(body);
        served.set(f.path, digest);
        if (r.status !== 200 || digest !== sha(readFileSync(join(options.root, f.path))))
          mismatched.push({ path: f.path, status: r.status });
      }
    }),
  );
  const manifest = JSON.parse(readFileSync(join(options.root, 'manifest.json'), 'utf8')) as unknown;
  // A chunked asset reconstructs when its chunks, as served, have the declared digests and sizes and concatenate to
  // the asset's digest. Chunk files are content-addressed under chunks/<sha256>.bin.
  const unreconstructed: string[] = [];
  let chunked = 0;
  for (const { asset } of assets(manifest)) {
    if (!asset.chunks) continue;
    chunked++;
    const whole = createHash('sha256');
    let ok = true;
    for (const c of asset.chunks) {
      const path = `chunks/${c.sha256}.bin`;
      if (served.get(path) !== c.sha256) ok = false;
      else whole.update(readFileSync(join(options.root, path)));
    }
    if (!ok || whole.digest('hex') !== asset.sha256) unreconstructed.push(asset.sha256);
  }
  const contract = checkContract(manifest);
  let digests: QualifyReport['digests'] = null;
  if (options.reference !== undefined) {
    const want = digestSet(options.reference);
    const got = digestSet(manifest);
    digests = {
      missing: [...want].filter((d) => !got.has(d)).sort(),
      extra: [...got].filter((d) => !want.has(d)).sort(),
    };
  }
  mismatched.sort((a, b) => (a.path < b.path ? -1 : 1));
  const report = {
    origin: options.origin,
    files: files.length,
    bytes,
    mismatched,
    headers,
    chunked,
    unreconstructed,
    contract: contract.ok ? null : `${contract.error.code} at ${contract.error.path}`,
    digests,
  };
  return {
    ...report,
    ok:
      !mismatched.length &&
      !headers.length &&
      !unreconstructed.length &&
      report.contract === null &&
      (!digests || (!digests.missing.length && !digests.extra.length)),
  };
}
