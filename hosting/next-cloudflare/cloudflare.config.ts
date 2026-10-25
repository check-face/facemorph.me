// Standalone collector deployment. The combined site can import entry.mjs with the same bindings.
import { bindings, defineConfig, triggers } from 'cf/config';
import { collectorEnvironment } from './environment.mjs';
const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw Error(`Set ${key} explicitly before building or deploying the collector`);
  return value;
};
export default defineConfig(() => {
  const environment = process.env['DIAGNOSTICS_ENVIRONMENT'] || 'next';
  if (!['next', 'production'].includes(environment)) throw Error('Deploy only a named hosted diagnostics environment');
  const endpoint = new URL(collectorEnvironment(environment).collector);
  return {
    worker: {
      name: need('DIAGNOSTICS_WORKER'),
      entrypoint: './entry.mjs',
      compatibilityDate: '2026-09-16',
      workersDev: false,
      observability: { enabled: false },
      triggers: [triggers.fetch({ pattern: endpoint.host + '/diagnostics/*', zone: need('DIAGNOSTICS_ZONE') })],
      env: {
        FREE_PLAN_CONFIRMED: bindings.text(need('FREE_PLAN_CONFIRMED')),
        DIAGNOSTICS_ENVIRONMENT: bindings.text(environment),
        DIAGNOSTICS_R2: bindings.r2({ name: need('DIAGNOSTICS_BUCKET') }),
        ...(process.env['DIAGNOSTICS_NAMESPACE_ID'] ? { DIAGNOSTICS: bindings.kv({ id: process.env['DIAGNOSTICS_NAMESPACE_ID'] }) } : {}),
      },
    },
  };
});
