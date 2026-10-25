import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { PREFLIGHT_BUDGETS } from '../src/contracts/preflight.ts';

/** Count all checker entry dependencies plus its separately emitted worker, not just an entry stub. */
export function checkerSize(directory: string) {
  const manifest = JSON.parse(
    readFileSync(resolve(directory, '.vite/manifest.json'), 'utf8'),
  ) as Record<string, { file: string; imports?: string[]; dynamicImports?: string[] }>;
  const inventory = JSON.parse(
    readFileSync(resolve(directory, 'worker-inventory.json'), 'utf8'),
  ) as { emitted: { source: string; file: string }[] };
  const worker = inventory.emitted.find((w) => w.source === 'src/preflight/cpu-worker.mjs');
  if (!worker) throw Error('Preflight worker missing from built inventory');
  const files = new Set<string>([worker.file]);
  const visited = new Set<string>();
  function walk(key: string) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) throw Error(`Preflight build dependency missing: ${key}`);
    files.add(entry.file);
    for (const next of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) walk(next);
  }
  walk('preflight-check.html');
  const chunks = [...files].map((file) => {
    if (file.startsWith('/') || file.split('/').includes('..'))
      throw Error('Invalid preflight chunk path');
    return { file, gzipBytes: gzipSync(readFileSync(resolve(directory, file))).length };
  });
  const gzipBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  if (gzipBytes > PREFLIGHT_BUDGETS.checkerCodeBytesCompressed)
    throw Error(
      `Preflight checker exceeds ${PREFLIGHT_BUDGETS.checkerCodeBytesCompressed} compressed bytes: ${gzipBytes}`,
    );
  return { gzipBytes, limit: PREFLIGHT_BUDGETS.checkerCodeBytesCompressed, chunks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify(checkerSize(process.argv[2] ?? new URL('../dist/', import.meta.url).pathname)),
  );
