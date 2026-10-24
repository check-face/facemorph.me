#!/usr/bin/env node
// fm-p7v: every file in classic's hosting/ tree at the frozen revision must have a destination
// in the boundary table (packages/cloudflare-model-host/README.md):
//   packages/cloudflare-model-host | hosting/ | historical | split (reason names both homes)
// Fails with one JSON line per problem: unassigned (in the tree, not in the table),
// stale (in the table, not in the tree), bad-destination, reason-missing.
//   node scripts/inventory/check-hosting-boundary.mjs [--classic ../facemorph.me-classic] [--rev 6107f80...]
// The table parse/compare logic is exported for tests; the git call is the only I/O.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DESTINATIONS = new Set(['packages/cloudflare-model-host', 'hosting/', 'historical', 'split']);

export function parseBoundaryTable(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === 'path' || /^-{3,}$/.test(cells[0])) continue; // header, separator
    if (!cells[0].includes('/')) continue; // prose rows
    rows.push({ path: cells[0], destination: cells[1], reason: cells.slice(2).join(' | ') });
  }
  return rows;
}

export function compareWithTree(rows, treePaths) {
  const out = [];
  const table = new Map();
  for (const row of rows) {
    if (table.has(row.path)) out.push({ path: row.path, rule: 'duplicate-row', detail: 'assigned twice' });
    table.set(row.path, row);
    if (!DESTINATIONS.has(row.destination)) out.push({ path: row.path, rule: 'bad-destination', detail: row.destination });
    if (row.destination === 'split' && !(row.reason.includes('packages/cloudflare-model-host') && row.reason.includes('hosting/'))) {
      out.push({ path: row.path, rule: 'split-underspecified', detail: 'a split row must name packages/cloudflare-model-host and hosting/ parts in its reason' });
    }
    if (row.reason.length === 0) out.push({ path: row.path, rule: 'reason-missing', detail: 'every assignment needs a reason' });
  }
  const tree = new Set(treePaths);
  for (const p of treePaths) if (!table.has(p)) out.push({ path: p, rule: 'unassigned', detail: 'in hosting/ at the frozen revision, not in the boundary table' });
  for (const p of table.keys()) if (!tree.has(p)) out.push({ path: p, rule: 'stale', detail: 'in the boundary table, not in hosting/ at the frozen revision' });
  return out;
}

export function hostingTree(classicPath, rev) {
  const out = execFileSync('git', ['-C', classicPath, 'ls-tree', '-r', '--name-only', rev, 'hosting/'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const classic = arg('--classic', `${root}../facemorph.me-classic`);
  const rev = arg('--rev', 'a42829bb0582b5a7a55ba6b1045a05861612b8a5');
  const readme = arg('--readme', `${root}packages/cloudflare-model-host/README.md`);

  const violations = compareWithTree(parseBoundaryTable(readFileSync(readme, 'utf8')), hostingTree(classic, rev));
  for (const v of violations) console.log(JSON.stringify(v));
  if (violations.length > 0) {
    console.error(`hosting boundary: ${violations.length} problem(s) between ${readme} and ${classic} hosting/ @ ${rev.slice(0, 7)}`);
    process.exit(1);
  }
  console.error(`hosting boundary: OK (every hosting/ file at ${rev.slice(0, 7)} is assigned)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
