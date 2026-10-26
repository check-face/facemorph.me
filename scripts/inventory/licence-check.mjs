#!/usr/bin/env node
// Licence cross-check: every file in import/allowlist.json and every runtime asset in
// import/build-inputs.json must match at least one row of import/licences.json (a file without one
// fails). A runtime chunk is matched by the asset it belongs to. Rows need their licence, provenance,
// evidence and a redistribution verdict; a notice file must exist in classic at the frozen commit, in
// the runtime, or as a notice added in hosting/PROVENANCE.json with its recorded bytes. Unresolved
// redistribution rights are listed on every run.
//   node scripts/inventory/licence-check.mjs [--classic <dir>]
// One JSON line per finding and per unresolved right, then a summary; exit 1 on any finding.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST,
  BUILD_INPUTS,
  LICENCES,
  classicDir,
  git,
  line,
  matches,
  options,
  readJson,
  REPO,
  sha256,
} from './lib.mjs';

export function coverage(rows, files, assets) {
  const findings = [];
  const used = new Set();
  const check = (set, path, key) => {
    const hits = rows.filter((r) => matches(key, r.applies_to?.[set] ?? []));
    if (!hits.length) findings.push({ uncovered: path, set });
    hits.forEach((r) => used.add(r.id));
  };
  for (const f of files) check('allowlist', f.source, f.source);
  for (const a of assets) check('runtime', a.path, a.of ?? a.path);
  for (const r of rows) {
    const missing = ['id', 'subject', 'licence', 'provenance'].filter((k) => !r[k]);
    if (!r.evidence?.length) missing.push('evidence');
    if (!['permitted', 'unresolved'].includes(r.redistribution)) missing.push('redistribution');
    if (r.redistribution === 'unresolved' && !r.unresolved) missing.push('unresolved');
    if (missing.length) findings.push({ row: r.id, problem: `missing ${missing.join(', ')}` });
    if (!used.has(r.id))
      findings.push({ row: r.id, problem: 'matches no allowlist file or runtime asset' });
  }
  return findings;
}

/** The notices a bead added to this repository (hosting/PROVENANCE.json `addedFiles` with a digest), present with
 * exactly the recorded bytes. `read` gives a path's bytes or null. Pure but for `read`. */
export function addedNotices(provenance, read) {
  return new Set(
    (provenance.addedFiles ?? [])
      .filter(
        (f) =>
          f.sha256 &&
          (() => {
            const bytes = read(f.path);
            return bytes !== null && sha256(bytes) === f.sha256 && bytes.length === f.bytes;
          })(),
      )
      .map((f) => f.path),
  );
}

/** Each row's notice file (`notice_file` and every `notices[].file`) must exist in classic at the frozen commit, be
 * a runtime asset, or be a notice this repository added with recorded bytes (fm-qoc3). */
export function noticeFindings(rows, where) {
  const out = [];
  for (const r of rows) {
    const files = new Set([r.notice_file, ...(r.notices ?? []).map((n) => n.file)].filter(Boolean));
    for (const file of files)
      if (!where.runtime(file) && !where.added(file) && !where.classic(file))
        out.push({
          row: r.id,
          problem: `notice file ${file} is neither in classic at the frozen commit, a runtime asset, nor an added notice with recorded bytes`,
        });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const dir = classicDir(opts);
  const { rows } = readJson(LICENCES);
  const allowlist = readJson(ALLOWLIST);
  const assets = readJson(BUILD_INPUTS).runtime.assets;
  const commit = allowlist.source.frozen_commit;
  const findings = coverage(rows, allowlist.files, assets);
  const runtimePaths = new Set(assets.map((a) => a.path));
  const added = addedNotices(readJson(join(REPO, 'hosting/PROVENANCE.json')), (p) =>
    existsSync(join(REPO, p)) ? readFileSync(join(REPO, p)) : null,
  );
  findings.push(
    ...noticeFindings(rows, {
      runtime: (p) => runtimePaths.has(p),
      classic: (p) => git(dir, ['ls-tree', '--name-only', commit, '--', p]).trim() === p,
      added: (p) => added.has(p),
    }),
  );
  for (const f of findings) line(f);
  const unresolved = rows.filter((r) => r.redistribution === 'unresolved');
  for (const r of unresolved)
    line({ unresolved_rights: r.id, subject: r.subject, question: r.unresolved });
  line({
    summary: {
      rows: rows.length,
      allowlist_files: allowlist.files.length,
      runtime_assets: assets.length,
      findings: findings.length,
      unresolved_rights: unresolved.length,
    },
  });
  process.exit(findings.length ? 1 : 0);
}
