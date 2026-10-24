// A staged model root as its own origin on Workers Static Assets (fm-fy2.14): the test origin the staging
// qualification runs against, deployed with the Cloudflare CLI `cf` in the package root's `model-origin` mode
// (cloudflare.config.ts, vite.config.ts). The root is served under its base path with the model `_headers`
// (src/headers.ts); the Worker has no script, so no request for a model file runs Worker code. Model terms are
// checked first, as for every publication (src/publish.ts). A dry run unless `publish`.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { extensionsOf, modelHeaders, type HeaderPlan } from './headers.ts';
import { listFiles } from './verify.ts';
import { DEFAULT_COMPATIBILITY_DATE, runCf, type DeployResult } from './mirror/deploy.ts';
import { termsRefusal, type TermsChoice } from './publish.ts';

export interface ModelOrigin extends HeaderPlan {
  /** Worker name; with `workersDev` it serves on <name>.<account subdomain>.workers.dev. */
  readonly worker: string;
  readonly workersDev?: boolean;
  readonly domain?: string;
  readonly compatibilityDate?: string;
  /** The model terms the published bytes are redistributed under (required to publish model bytes). */
  readonly terms?: TermsChoice;
}

export interface OriginResult extends DeployResult {
  readonly refused: string | null;
  readonly publicDir: string;
}

/** Builds the public directory (`_headers` and the root linked at its base path) and runs cf deploy for it. */
export function deployModelOrigin(
  root: string,
  origin: ModelOrigin,
  options: { readonly publish?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
): OriginResult {
  if (!origin.worker?.trim()) throw new Error('the model origin needs a Worker name');
  const manifestPath = join(root, 'manifest.json');
  const refused = options.publish
    ? termsRefusal(
        existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null,
        origin.terms,
      )
    : null;
  const publicDir = mkdtempSync(join(tmpdir(), 'model-origin-'));
  const extensions = origin.extensions ?? extensionsOf(listFiles(root).map((f) => f.path));
  writeFileSync(join(publicDir, '_headers'), modelHeaders({ ...origin, extensions }));
  const at = (origin.basePath ?? '/').replace(/^\/+|\/+$/g, '');
  if (at) {
    mkdirSync(dirname(join(publicDir, at)), { recursive: true });
    symlinkSync(resolve(root), join(publicDir, at), 'dir');
  } else throw new Error('a model origin is served under a base path, e.g. /runtime/');
  if (refused) return { published: false, status: null, output: '', refused, publicDir };
  const r = runCf(
    ['deploy', '--mode', 'model-origin', ...(options.publish ? [] : ['--dry-run'])],
    {
      MODEL_ORIGIN_WORKER: origin.worker,
      MODEL_ORIGIN_PUBLIC: publicDir,
      MODEL_ORIGIN_COMPATIBILITY_DATE: origin.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
      ...(origin.workersDev ? { MODEL_ORIGIN_WORKERS_DEV: '1' } : {}),
      ...(origin.domain ? { MODEL_ORIGIN_DOMAIN: origin.domain } : {}),
    },
    options.env,
  );
  return { published: options.publish === true && r.status === 0, ...r, refused: null, publicDir };
}
