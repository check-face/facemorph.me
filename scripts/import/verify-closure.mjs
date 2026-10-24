#!/usr/bin/env node
// Checks the imported closure on disk against import/allowlist.json: every allowlisted file present at its
// destination with its sha256, and no other file under the destination root. A later bead that adds files
// beside the closure names them with --allow (a glob relative to the destination root, repeatable). A file the port
// changes on purpose keeps its classic sha256 (provenance) and carries `ported: { sha256, bytes, bead, reason }`; it is
// checked against those new bytes, and a `ported` record without its bead and reason is itself a finding. A file a
// bead removed carries `ported: { removed: true, bead, reason }` and must be absent; a file it moved carries
// `ported: { destination, sha256, bytes, bead, reason }` and is checked at its new path (inside the destination root).
//   node scripts/import/verify-closure.mjs [--root <repo>] [--allow <glob>]...
// One JSON line per finding, then a summary {files, mismatches, missing, extra}; exit 1 on any finding.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, REPO, line, matches, readJson } from '../inventory/lib.mjs';
import { storeFindings } from './control.mjs';

export function closureFindings({ root = REPO, allowlist = readJson(ALLOWLIST), allow = [] }) {
  const base = allowlist.destination_root;
  const prefix = `${base}/`;
  const dir = join(root, base);
  const files = allowlist.files
    .filter((f) => !f.ported?.removed)
    .map((f) => ({
      path: (f.ported?.destination ?? f.destination).slice(prefix.length),
      sha256: f.ported?.sha256 ?? f.sha256,
      bytes: f.ported?.bytes ?? f.bytes,
    }));
  const records = [
    ...allowlist.files
      .filter(
        (f) =>
          f.ported && !((f.ported.sha256 || f.ported.removed) && f.ported.bead && f.ported.reason),
      )
      .map((f) => ({ path: f.destination, problem: 'ported without its digest, bead and reason' })),
    ...allowlist.files
      .filter((f) => f.ported?.destination && !f.ported.destination.startsWith(prefix))
      .map((f) => ({ path: f.ported.destination, problem: 'moved outside the destination root' })),
    ...allowlist.files
      .filter((f) => f.ported?.removed && existsSync(join(root, f.destination)))
      .map((f) => ({ path: f.destination, problem: 'removed file is present' })),
  ];
  if (!existsSync(dir))
    return [
      ...records,
      ...files.map((f) => ({ path: prefix + f.path, problem: 'missing', expected: f.sha256 })),
    ];
  return [
    ...records,
    ...storeFindings(dir, files)
      .filter((f) => !(f.problem === 'extra' && matches(f.path, allow)))
      .map((f) => ({ ...f, path: prefix + f.path })),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const allow = argv.flatMap((a, i) => (a === '--allow' ? [argv[i + 1]] : []));
  const root = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO;
  const findings = closureFindings({ root, allow });
  for (const f of findings) line(f);
  const count = (p) => findings.filter((f) => f.problem === p).length;
  const files = readJson(ALLOWLIST).files.length;
  line({
    summary: {
      files,
      mismatches: count('mismatch'),
      missing: count('missing'),
      extra: count('extra'),
    },
  });
  process.exit(findings.length ? 1 : 0);
}
