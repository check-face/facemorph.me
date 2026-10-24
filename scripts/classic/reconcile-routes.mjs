#!/usr/bin/env node
// fm-6bj: re-runnable route reconciliation for the frozen classic distribution.
// Reads three sources and prints one JSON line per finding:
//   --inventory  classic self-host/legacy-route-inventory.json (deployed-snapshot route list)
//   --legacy     archived Flask server checkface/src/server/checkface.py (provenance only)
//   --successor  classic self-host/legacy_checkface.py (the PyTorch port that ships)
// A route present in the inventory or the archived server but absent from the successor is a
// GAP unless scripts/classic/route-drops.json records it. Additions in the successor are
// reported but never fail. Exit 1 on any unexplained gap.
//   node scripts/classic/reconcile-routes.mjs [--inventory ...] [--legacy ...] [--successor ...]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Flask decorators spanning one or two lines: @app.route("/api/face/", methods=["GET", "POST"])
export function parseFlaskRoutes(source) {
  const routes = new Map();
  const re = /@app\.route\(\s*['"]([^'"]+)['"]\s*(?:,\s*methods=\[([^\]]*)\])?\)/g;
  for (const m of source.matchAll(re)) {
    const methods = (m[2] ?? "'GET'")
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    const existing = routes.get(m[1]) ?? new Set();
    for (const method of methods) existing.add(method);
    routes.set(m[1], existing);
  }
  return routes;
}

export function reconcile({ inventoryRoutes, legacyRoutes, successorRoutes, drops = [] }) {
  const findings = [];
  const dropReason = new Map(drops.map((d) => [d.path, d.reason]));
  const key = (path) => path.replace(/<rule:[^>]+>/, '<path>');
  const successorKeys = new Set([...successorRoutes.keys()].map(key));
  for (const [path, methods] of inventoryRoutes) {
    if (!successorKeys.has(key(path)) && !dropReason.has(path)) findings.push({ route: path, methods: [...methods], kind: 'gap', source: 'inventory' });
  }
  for (const [path, methods] of legacyRoutes) {
    if (inventoryRoutes.has(path)) continue; // already covered by the inventory pass
    if (!successorKeys.has(key(path)) && !dropReason.has(path)) findings.push({ route: path, methods: [...methods], kind: 'gap', source: 'archived-server' });
  }
  for (const [path, methods] of successorRoutes) {
    if (!inventoryRoutes.has(path) && !legacyRoutes.has(path)) findings.push({ route: path, methods: [...methods], kind: 'addition', source: 'successor' });
  }
  for (const d of drops) {
    const known = inventoryRoutes.has(d.path) || legacyRoutes.has(d.path);
    if (!known) findings.push({ route: d.path, kind: 'stale-drop', detail: d.reason });
  }
  return findings;
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const classic = arg('--classic') ?? `${root}../facemorph.me-classic`;
  const inventoryPath = arg('--inventory') ?? `${classic}/self-host/legacy-route-inventory.json`;
  const legacyPath = arg('--legacy') ?? `${root}../checkface/src/server/checkface.py`;
  const successorPath = arg('--successor') ?? `${classic}/self-host/legacy_checkface.py`;
  const dropsPath = arg('--drops') ?? fileURLToPath(new URL('./route-drops.json', import.meta.url));

  const inventory = loadJson(inventoryPath);
  const inventoryRoutes = new Map(inventory.routes.map((r) => [r.path, new Set(r.methods)]));
  const legacyRoutes = parseFlaskRoutes(readFileSync(legacyPath, 'utf8'));
  const successorRoutes = parseFlaskRoutes(readFileSync(successorPath, 'utf8'));
  const drops = loadJson(dropsPath);

  const findings = reconcile({ inventoryRoutes, legacyRoutes, successorRoutes, drops });
  for (const f of findings) console.log(JSON.stringify(f));
  const gaps = findings.filter((f) => f.kind === 'gap' || f.kind === 'stale-drop');
  const additions = findings.filter((f) => f.kind === 'addition');
  console.error(`route reconciliation: ${inventoryRoutes.size} inventory routes, ${legacyRoutes.size} archived, ${successorRoutes.size} successor; ${gaps.length} gap(s), ${additions.length} addition(s)`);
  if (gaps.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
