#!/usr/bin/env node
// Real Workers runtime with private, persistent local R2/KV; never contacts a deployed collector.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Reuse the model-host lane's qualified workerd version (its glibc requirement is unchanged).
const fromHost = createRequire(new URL('../../packages/cloudflare-model-host/package.json', import.meta.url));
const { Miniflare } = fromHost('miniflare');

export function localCollector({ port = 0, persist = false, environment = 'local', sink = 'r2' } = {}) {
  const fromMiniflare = createRequire(fromHost.resolve('miniflare'));
  const supported = fromMiniflare('workerd').compatibilityDate;
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('./entry.mjs', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
    compatibilityDate: supported < '2026-09-16' ? supported : '2026-09-16',
    host: '127.0.0.1', port, cf: false,
    bindings: { FREE_PLAN_CONFIRMED: 'true', DIAGNOSTICS_ENVIRONMENT: environment },
    ...(sink === 'r2' ? { r2Buckets: ['DIAGNOSTICS_R2'], r2Persist: persist && resolve(persist, 'r2') } : {}),
    kvNamespaces: ['DIAGNOSTICS'], kvPersist: persist && resolve(persist, 'kv'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8788' }, persist: { type: 'string', default: '.cache/diagnostics-local' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid local port');
  const collector = localCollector({ port, persist: values.persist });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await collector.dispose(); process.exitCode = 0; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const url = await collector.ready;
    process.stdout.write(`${url.origin}/diagnostics/events\n`);
  } catch (error) { await stop(); throw error; }
}
