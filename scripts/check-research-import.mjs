#!/usr/bin/env node
// Verifies the imported research tree against docs/research-import/digest-list.json (bead fm-86u): every
// imported file present with its size, SHA-256 and mode; no unlisted file Git would track inside a frozen
// directory; the list's own count and bytes equal the snapshot census; and provenance.md gives every required
// family, source invariant and negative lesson a disposition and a destination check or gap owner. Exit 0 pass, 1 fail.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkImport, checkProvenance } from './research-import/lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const list = JSON.parse(
  readFileSync(resolve(root, 'docs/research-import/digest-list.json'), 'utf8'),
);
const r = checkImport(list, root);
const provenance = checkProvenance(
  readFileSync(resolve(root, 'docs/research-import/provenance.md'), 'utf8'),
);
const ok = r.ok && provenance.length === 0;
console.log(
  JSON.stringify({
    event: 'check-research-import',
    ok,
    imported: r.imported,
    importedBytes: r.importedBytes,
    census: list.census.files,
    problems: r.problems.length,
    provenanceProblems: provenance.length,
  }),
);
for (const p of [...r.problems, ...provenance])
  console.log(JSON.stringify({ event: 'problem', ...p }));
process.exitCode = ok ? 0 : 1;
