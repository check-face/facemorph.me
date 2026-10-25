// Preserve the existing Worker, two routes and SQLite Durable Object class.
import { bindings, defineConfig, exports, triggers } from 'cf/config';
const worker = 'facemorph-stats';
export default defineConfig({
  worker: {
    name: worker,
    entrypoint: './entry.mjs',
    compatibilityDate: '2026-09-16',
    workersDev: false,
    observability: { enabled: false },
    triggers: [
      triggers.fetch({ pattern: 'next.facemorph.me/stats/*', zone: 'facemorph.me' }),
      triggers.fetch({ pattern: 'facemorph.me/stats/*', zone: 'facemorph.me' }),
    ],
    exports: { StatsCounters: exports.durableObject({ storage: 'sqlite' }) },
    env: { COUNTERS: bindings.durableObject({ worker, exportName: 'StatsCounters' }) },
  },
});
