#!/usr/bin/env node
// Regenerates every imported file's digest from `git archive <frozen commit>` of classic and compares it
// with import/allowlist.json. Prints one JSON line per file {source, destination, sha256, match} and a
// summary; exits 1 on any mismatch, missing file, or an archive that is not of the frozen commit.
//   node scripts/inventory/allowlist-digests.mjs [--classic <dir>] [--allowlist <path>]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, classicDir, line, options, readJson, sha256, untar } from './lib.mjs';

export function archive(dir, commit, paths) {
  const r = spawnSync('git', ['-C', dir, 'archive', '--format=tar', commit, '--', ...paths], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git archive failed: ${r.stderr.toString().trim()}`);
  return untar(r.stdout);
}

export function compare(rows, archived) {
  const byPath = new Map(archived.map((f) => [f.path, f.bytes]));
  return rows.map(({ source, destination, sha256: expected }) => {
    const bytes = byPath.get(source);
    const actual = bytes ? sha256(bytes) : null;
    return { source, destination, sha256: actual, expected, match: actual === expected };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2), { allowlist: ALLOWLIST });
  const allowlist = readJson(opts.allowlist);
  const commit = allowlist.source.frozen_commit;
  const { comment, files } = archive(classicDir(opts), commit, allowlist.files.map((f) => f.source));
  const results = compare(allowlist.files, files);
  for (const { expected, ...row } of results) line(row.match ? row : { ...row, expected });
  const mismatches = results.filter((r) => !r.match).length;
  const ofCommit = comment === commit;
  line({ summary: { commit, archive_commit: comment, files: results.length, mismatches, archive_is_frozen_commit: ofCommit } });
  process.exit(mismatches || !ofCommit || !results.length ? 1 : 0);
}
