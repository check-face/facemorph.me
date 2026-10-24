#!/usr/bin/env node
// Writes the candidate's JS closure into apps/web from classic's Git objects at the allowlist's frozen commit
// (never classic's working tree, which holds other sessions' edits): every import/allowlist.json file at its
// destination, byte-identical. Provenance stays in import/allowlist.json; nothing of classic's .git is copied.
//   node scripts/import/export-closure.mjs [--classic <dir>] [--root <repo>]
// One JSON line per written file, then a summary; exit 1 if a blob's digest differs from the allowlist.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, REPO, blob, classicDir, line, options, readJson, sha256 } from '../inventory/lib.mjs';

export function exportClosure({ classic, root = REPO, allowlist = readJson(ALLOWLIST), log = () => {} }) {
  const commit = allowlist.source.frozen_commit;
  const mismatches = [];
  for (const f of allowlist.files) {
    const bytes = blob(classic, commit, f.source);
    if (sha256(bytes) !== f.sha256) { mismatches.push({ source: f.source, problem: 'blob differs from the allowlist', expected: f.sha256, actual: sha256(bytes) }); continue; }
    const path = join(root, f.destination);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    log({ wrote: f.destination, sha256: f.sha256 });
  }
  return { commit, files: allowlist.files.length, mismatches };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const result = exportClosure({ classic: classicDir(opts), root: opts.root ?? REPO, log: line });
  for (const m of result.mismatches) line(m);
  line({ summary: { commit: result.commit, files: result.files, mismatches: result.mismatches.length } });
  process.exit(result.mismatches.length ? 1 : 0);
}
