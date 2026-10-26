// Deploying the mirror Worker (fm-fy2.14) with the Cloudflare CLI `cf`, never Wrangler (operator, 24 October 2026).
// The package root is the cf project: cloudflare.config.ts reads the target from MIRROR_* variables, which this sets
// from an explicit target, and builds src/mirror/worker.ts with the Cloudflare Vite plugin. Without `publish` it runs
// `cf deploy --dry-run`, which builds and checks the Worker and its bindings and sends no API request.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the mirror goes: every value FaceMorph (or anyone) deploys with, none built in. */
export interface MirrorTarget {
  /** Worker name. */
  readonly worker: string;
  /** R2 bucket the Worker holds its copies in. */
  readonly bucket: string;
  /** Origin copied from. */
  readonly upstream: string;
  /** Comma-separated immutable path prefixes. */
  readonly prefixes: string;
  /** Worker the SITE service binding points at, when the upstream is a Worker on the same account. */
  readonly site?: string;
  /** Custom domain the Worker serves. */
  readonly domain?: string;
  /** Also serve on <worker>.<account subdomain>.workers.dev (a test mirror). */
  readonly workersDev?: boolean;
  readonly compatibilityDate?: string;
}

export const DEFAULT_COMPATIBILITY_DATE = '2026-09-16';

/** The MIRROR_* variables cloudflare.config.ts reads. Pure. */
export function deployEnv(target: MirrorTarget): Record<string, string> {
  for (const key of ['worker', 'bucket', 'upstream', 'prefixes'] as const)
    if (!target[key]?.trim()) throw new Error(`the mirror target needs ${key}`);
  new URL(target.upstream);
  return {
    MIRROR_WORKER: target.worker,
    MIRROR_BUCKET: target.bucket,
    MIRROR_UPSTREAM: target.upstream,
    MIRROR_PREFIXES: target.prefixes,
    MIRROR_COMPATIBILITY_DATE: target.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
    ...(target.site ? { MIRROR_SITE_WORKER: target.site } : {}),
    ...(target.domain ? { MIRROR_DOMAIN: target.domain } : {}),
    ...(target.workersDev ? { MIRROR_WORKERS_DEV: '1' } : {}),
  };
}

export interface DeployResult {
  readonly published: boolean;
  readonly status: number | null;
  readonly output: string;
}

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Runs the package's own `cf` with `args` in the package root, with `env` added. */
export function runCf(args: readonly string[], env: Record<string, string>, base = process.env) {
  const require = createRequire(join(PACKAGE_ROOT, 'package.json'));
  const pkg = require.resolve('cf/package.json');
  const bin = (require(pkg) as { bin: string | Record<string, string> }).bin;
  const cf = join(dirname(pkg), typeof bin === 'string' ? bin : bin['cf']!);
  // Node strips TypeScript types only outside node_modules, so an installed package's cf project (its .ts config)
  // is run from a copy outside it, beside a link to the node_modules its imports resolve from.
  let cwd = PACKAGE_ROOT;
  if (PACKAGE_ROOT.includes(`${sep}node_modules${sep}`)) {
    cwd = mkdtempSync(join(tmpdir(), 'model-host-cf-'));
    for (const f of [
      'package.json',
      'cloudflare.config.ts',
      'vite.config.ts',
      'src/mirror/worker.ts',
    ])
      cpSync(join(PACKAGE_ROOT, f), join(cwd, f));
    symlinkSync(dirname(dirname(pkg)), join(cwd, 'node_modules'), 'dir');
  }
  const r = spawnSync(process.execPath, [cf, ...args], {
    cwd,
    env: { ...base, ...env, CI: '1' },
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return {
    status: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`,
  };
}

/** Runs `cf deploy` in the package root for `target`; a dry run unless `publish`. */
export function deployMirror(
  target: MirrorTarget,
  options: { readonly publish?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
): DeployResult {
  const r = runCf(
    ['deploy', ...(options.publish ? [] : ['--dry-run'])],
    deployEnv(target),
    options.env,
  );
  return { published: options.publish === true && r.status === 0, ...r };
}
