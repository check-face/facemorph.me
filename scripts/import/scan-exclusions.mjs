#!/usr/bin/env node
// Scans a tree on disk (the imported apps/web closure, or an unpacked control artifact) for what the import
// must never carry: F# sources and project files, Fable output (*.fs.js), .NET/Fable pins, Webpack config,
// legacy Server/API files, weights (by extension and size), .wrangler/ state and credentials (by name and by
// secret patterns), using the same classes as the allowlist scan. --provenance also flags private provenance
// in text files: local home paths, private hostnames and addresses, and personal email addresses.
//   node scripts/import/scan-exclusions.mjs [--dir <tree>] [--provenance]      (default apps/web)
// One JSON line per finding, then a summary {files, excluded_hits}; exit 1 on any finding.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, line, options } from '../inventory/lib.mjs';
import { classFindings } from '../inventory/scan-allowlist.mjs';
import { digestTree } from './control.mjs';

const PROVENANCE = [
  ['local-home-path', /\/(home|Users)\/(?!runner\/|runneradmin\/)[a-z][\w.-]*\//],
  [
    'private-host',
    /\b(eris|triton)\.(local|lan|home)\b|\b(192\.168|10\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/,
  ],
  ['personal-email', /\b[\w.+-]+@(gmail|outlook|hotmail|icloud|yahoo)\.com\b/gi],
];
// Addresses the product itself publishes (the support contact shown in the app and FAQ).
const PUBLIC_ADDRESSES = new Set(['checkfaceml@gmail.com']);

// A local install and build output (node_modules/, dist/, both ignored by Git) are skipped; CI scans a
// checkout that has neither, so a committed one is still caught there.
const LOCAL_ONLY = ['node_modules/', 'dist/'];
export function scanTree(dir, { provenance = false } = {}) {
  const files = digestTree(dir).filter((f) => !LOCAL_ONLY.some((p) => f.path.startsWith(p)));
  const content = new Map();
  for (const f of files) {
    const bytes = readFileSync(join(dir, f.path));
    if (!bytes.includes(0)) content.set(f.path, bytes.toString('utf8'));
  }
  const findings = classFindings(
    files.map((f) => ({ source: f.path, bytes: f.bytes })),
    content,
  );
  if (provenance) {
    for (const [path, text] of content)
      for (const [name, re] of PROVENANCE) {
        const hit = (text.match(re) ?? []).find((m) => !PUBLIC_ADDRESSES.has(m.toLowerCase()));
        if (hit)
          findings.push({ source: path, class: 'private-provenance', pattern: name, match: hit });
      }
  }
  return { files: files.length, findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const { files, findings } = scanTree(opts.dir ?? join(REPO, 'apps/web'), {
    provenance: Boolean(opts.provenance),
  });
  for (const f of findings) line(f);
  line({ summary: { files, excluded_hits: findings.length } });
  process.exit(findings.length ? 1 : 0);
}
