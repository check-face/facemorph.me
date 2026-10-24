// The mirror Worker's cf project (fm-fy2.14). Every deploy value comes from the MIRROR_* variables that
// `facemorph-model-host mirror-deploy` sets from its arguments (src/mirror/deploy.ts), so this file names no host.
import { bindings, defineConfig } from 'cf/config';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: deploy with facemorph-model-host mirror-deploy`);
  return value;
};

export default defineConfig(() => ({
  worker: {
    name: need('MIRROR_WORKER'),
    compatibilityDate: need('MIRROR_COMPATIBILITY_DATE'),
    entrypoint: './src/mirror/worker.ts',
    workersDev: false,
    ...(process.env['MIRROR_DOMAIN'] ? { domains: [process.env['MIRROR_DOMAIN']] } : {}),
    observability: { enabled: false },
    env: {
      MIRROR: bindings.r2({ name: need('MIRROR_BUCKET') }),
      SITE: process.env['MIRROR_SITE_WORKER']
        ? bindings.worker({ worker: process.env['MIRROR_SITE_WORKER'] })
        : undefined,
      UPSTREAM: bindings.text(need('MIRROR_UPSTREAM')),
      PREFIXES: bindings.text(need('MIRROR_PREFIXES')),
    },
  },
}));
