#!/usr/bin/env node
// Verifies the imported research tree against docs/research-import/digest-list.json (bead fm-86u): every
// imported file present with its size, SHA-256 and mode; no unlisted file Git would track inside a frozen
// directory; the list's own count and bytes equal the snapshot census. Exit 0 pass, 1 fail.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkImport } from './research-import/lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const list = JSON.parse(readFileSync(resolve(root, 'docs/research-import/digest-list.json'), 'utf8'));
const r = checkImport(list, root);
console.log(JSON.stringify({ event: 'check-research-import', ok: r.ok, imported: r.imported, importedBytes: r.importedBytes, census: list.census.files, problems: r.problems.length }));
for (const p of r.problems) console.log(JSON.stringify({ event: 'problem', ...p }));
process.exitCode = r.ok ? 0 : 1;
