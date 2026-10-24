// The package's cf project (fm-fy2.14), in two modes. Every deploy value comes from variables the package's commands
// set from their arguments, so this file names no host.
// - default: the mirror Worker (MIRROR_*, set by `facemorph-model-host mirror-deploy`, src/mirror/deploy.ts);
// - model-origin: a staged model root on Workers Static Assets with no Worker script (MODEL_ORIGIN_*, set by
//   src/origin-deploy.ts); vite.config.ts makes the root the assets.
import { bindings, defineConfig } from 'cf/config';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: deploy with facemorph-model-host`);
  return value;
};
const optional = (name: string) => process.env[name] || undefined;

export default defineConfig(({ mode }) =>
  mode === 'model-origin'
    ? {
        worker: {
          name: need('MODEL_ORIGIN_WORKER'),
          compatibilityDate: need('MODEL_ORIGIN_COMPATIBILITY_DATE'),
          workersDev: process.env['MODEL_ORIGIN_WORKERS_DEV'] === '1',
          ...(optional('MODEL_ORIGIN_DOMAIN') ? { domains: [need('MODEL_ORIGIN_DOMAIN')] } : {}),
          observability: { enabled: false },
        },
      }
    : {
        worker: {
          name: need('MIRROR_WORKER'),
          compatibilityDate: need('MIRROR_COMPATIBILITY_DATE'),
          entrypoint: './src/mirror/worker.ts',
          workersDev: false,
          ...(optional('MIRROR_DOMAIN') ? { domains: [need('MIRROR_DOMAIN')] } : {}),
          observability: { enabled: false },
          env: {
            MIRROR: bindings.r2({ name: need('MIRROR_BUCKET') }),
            SITE: optional('MIRROR_SITE_WORKER')
              ? bindings.worker({ worker: need('MIRROR_SITE_WORKER') })
              : undefined,
            UPSTREAM: bindings.text(need('MIRROR_UPSTREAM')),
            PREFIXES: bindings.text(need('MIRROR_PREFIXES')),
          },
        },
      },
);
