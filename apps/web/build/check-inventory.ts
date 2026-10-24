// After `vite build`: the recorded worker inventory matches the built bytes, every emitted app worker the shell
// declares is in it, and its identity follows from its lists. Exit 1 on any finding.
import { readFileSync } from 'node:fs';
import { inventoryFindings, type WorkerInventory } from './worker-inventory.ts';

const dist = new URL('../dist/', import.meta.url);
const inventory = JSON.parse(
  readFileSync(new URL('worker-inventory.json', dist), 'utf8'),
) as WorkerInventory;
const declared = [
  'src/Next/browser/ort-worker.mjs',
  'src/Next/image-encoder-worker.mjs',
  'src/Next/video-worker.mjs',
  'src/Next/photo/selection-worker.mjs',
];
const findings = inventoryFindings(inventory, dist.pathname);
for (const source of declared)
  if (!inventory.emitted.some((w) => w.source === source))
    findings.push(`${source}: declared in shell/workers.ts but not emitted`);
for (const f of findings) console.log(JSON.stringify({ finding: f }));
console.log(
  JSON.stringify({
    summary: {
      emitted: inventory.emitted.length,
      hosted: inventory.hosted.length,
      identity: inventory.identity,
      findings: findings.length,
    },
  }),
);
process.exit(findings.length ? 1 : 0);
