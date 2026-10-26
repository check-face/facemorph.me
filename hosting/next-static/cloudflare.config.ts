// The site Worker's cf project (fm-6fx6): the staged public/ tree on Workers Static Assets with the entry Worker
// (worker.mjs) run first only for /diagnostics/*, as classic's wrangler.jsonc. Deployed with the Cloudflare CLI `cf`,
// never Wrangler (operator, 24 October 2026), by scripts/hosting/deploy.mjs site-deploy, which sets every value below
// from hosting/publish-targets.json after the single-publisher guard; this file names no target.
//   SITE_WORKER, SITE_COMPATIBILITY_DATE           Worker name and date (required)
//   SITE_WORKERS_DEV=1                             also serve on <worker>.<account>.workers.dev (a test target)
//   SITE_DIAGNOSTICS_BUCKET, SITE_DIAGNOSTICS_NAMESPACE, DIAGNOSTICS_ENVIRONMENT
//                                                  the collector's R2/KV sinks, only for a target that has them
import { bindings, defineConfig } from 'cf/config';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: deploy with scripts/hosting/deploy.mjs site-deploy`);
  return value;
};
const optional = (name: string) => process.env[name] || undefined;

export default defineConfig(() => ({
  worker: {
    name: need('SITE_WORKER'),
    entrypoint: './worker.mjs',
    compatibilityDate: need('SITE_COMPATIBILITY_DATE'),
    workersDev: process.env['SITE_WORKERS_DEV'] === '1',
    observability: { enabled: false },
    // Only an explicit allowlist runs the Worker: every other request is a free static asset request.
    assets: { notFoundHandling: 'none', runWorkerFirst: ['/diagnostics/*'] },
    env: {
      ASSETS: bindings.assets(),
      FREE_PLAN_CONFIRMED: bindings.text('true'),
      DIAGNOSTICS_ENVIRONMENT: bindings.text(optional('DIAGNOSTICS_ENVIRONMENT') ?? 'next'),
      DIAGNOSTICS_R2: optional('SITE_DIAGNOSTICS_BUCKET')
        ? bindings.r2({ name: need('SITE_DIAGNOSTICS_BUCKET') })
        : undefined,
      DIAGNOSTICS: optional('SITE_DIAGNOSTICS_NAMESPACE')
        ? bindings.kv({ id: need('SITE_DIAGNOSTICS_NAMESPACE') })
        : undefined,
    },
  },
}));
