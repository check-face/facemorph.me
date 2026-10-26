#!/usr/bin/env node
// Imports the application side of classic's hosting/ tree (fm-8tyu): every path the boundary table
// (packages/cloudflare-model-host/README.md, fm-p7v) gives the destination `hosting/`, written byte-identical at the
// same path from classic's Git objects at the frozen revision (import/allowlist.json), never its working tree.
// Refuses any path under `.wrangler/` and any file over the size limit that is not on the size allowlist, whatever
// the table says. Records provenance (source repository and commit, path, mode, size, SHA-256) in
// hosting/PROVENANCE.json.
//   node scripts/hosting/import-hosting.mjs [--classic ../facemorph.me-classic] [--check]
// --check re-verifies the imported files against the provenance and the frozen revision without writing.
// One JSON line per file or problem, then a summary; exit 1 on any problem.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST,
  REPO,
  blob,
  classicDir,
  git,
  line,
  options,
  readJson,
  sha256,
} from '../inventory/lib.mjs';
import { parseBoundaryTable } from '../inventory/check-hosting-boundary.mjs';

export const SIZE_LIMIT = 1024 * 1024;
// Over the limit but needed: the names index staged into the site (stage.py --catalogue; promote.py's rule).
export const SIZE_ALLOWLIST = new Set(['hosting/next-static/catalogue.json']);
export const PROVENANCE = 'hosting/PROVENANCE.json';
const BOUNDARY = 'packages/cloudflare-model-host/README.md';

// Split rows imported now, at their hosting/ path: next-site.yml's compiled-ui job runs the WebGPU bundle contract
// gate (fm-aa8). The model-hosting extraction later moves the check functions to packages/cloudflare-model-host.
export const SPLIT_IMPORTED = new Set([
  'hosting/next-static/webgpu_contract.py',
  'hosting/next-static/webgpu_contract_test.py',
]);

/** Which tree entries to import. Pure: rows from the boundary table, entries {path, mode, size, sha1} from the tree. */
export function plan(rows, entries) {
  const wanted = new Set(
    rows
      .filter(
        (r) =>
          r.destination === 'hosting/' || (r.destination === 'split' && SPLIT_IMPORTED.has(r.path)),
      )
      .map((r) => r.path),
  );
  const imports = [];
  const refused = [];
  for (const e of entries) {
    if (!wanted.has(e.path)) continue;
    if (e.path.split('/').includes('.wrangler'))
      refused.push({ path: e.path, problem: 'wrangler state is never imported' });
    else if (e.size > SIZE_LIMIT && !SIZE_ALLOWLIST.has(e.path))
      refused.push({
        path: e.path,
        problem: `over ${SIZE_LIMIT} bytes and not on the size allowlist`,
        size: e.size,
      });
    else imports.push(e);
  }
  for (const path of wanted)
    if (!entries.some((e) => e.path === path))
      refused.push({ path, problem: 'in the boundary table but not in the frozen tree' });
  return { imports, refused };
}

/** The provenance's ported records by path, and a problem for each lacking its digest, bead or reason. Pure. */
export function portedRecords(files) {
  const ported = new Map(files.filter((f) => f.ported).map((f) => [f.path, f.ported]));
  const problems = [...ported]
    .filter(([, p]) => !(p.sha256 && p.bead && p.reason))
    .map(([path]) => ({ path, problem: 'ported without its digest, bead and reason' }));
  return { ported, problems };
}

/** `git ls-tree -r -l` at a revision: {path, mode, size, sha1} for every blob under hosting/. */
export function treeEntries(classic, commit) {
  return git(classic, ['ls-tree', '-r', '-l', '-z', commit, 'hosting/'])
    .split('\0')
    .filter(Boolean)
    .map((l) => {
      const [meta, path] = l.split('\t');
      const [mode, type, sha1, size] = meta.split(/\s+/);
      return { path, mode, type, sha1, size: Number(size) };
    })
    .filter((e) => e.type === 'blob');
}

export function importHosting({ classic, root = REPO, check = false, log = () => {} }) {
  const commit = readJson(ALLOWLIST).source.frozen_commit;
  const rows = parseBoundaryTable(readFileSync(join(root, BOUNDARY), 'utf8'));
  const { imports, refused } = plan(rows, treeEntries(classic, commit));
  const problems = refused
    .filter((r) => r.problem !== 'wrangler state is never imported')
    .map((r) => ({ ...r }));
  const files = [];
  // A file a later bead changed on purpose keeps its classic digest (provenance) and carries
  // `ported: {sha256, bytes, bead, reason}` in the provenance; it is checked against those bytes and never
  // overwritten. A ported record without its digest, bead and reason is itself a problem (as verify-closure).
  const recordedFiles = existsSync(join(root, PROVENANCE))
    ? JSON.parse(readFileSync(join(root, PROVENANCE), 'utf8')).files
    : [];
  const { ported, problems: portedProblems } = portedRecords(recordedFiles);
  problems.push(...portedProblems);
  for (const e of imports) {
    const bytes = blob(classic, commit, e.path);
    const digest = sha256(bytes);
    const dest = join(root, e.path);
    const port = ported.get(e.path);
    const expected = port?.sha256 ?? digest;
    if (check) {
      if (!existsSync(dest)) problems.push({ path: e.path, problem: 'missing' });
      else if (sha256(readFileSync(dest)) !== expected)
        problems.push({
          path: e.path,
          problem: port ? 'differs from its ported bytes' : 'differs from the frozen revision',
        });
    } else if (port) {
      if (!existsSync(dest) || sha256(readFileSync(dest)) !== port.sha256)
        problems.push({ path: e.path, problem: 'differs from its ported bytes; not overwritten' });
    } else {
      if (existsSync(dest) && sha256(readFileSync(dest)) !== digest) {
        problems.push({
          path: e.path,
          problem: 'destination exists with other bytes; not overwritten',
        });
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes, { mode: e.mode === '100755' ? 0o755 : 0o644 });
    }
    files.push({
      path: e.path,
      mode: e.mode,
      size: bytes.length,
      sha256: digest,
      ...(port ? { ported: port } : {}),
    });
    log({ file: e.path, sha256: digest, size: bytes.length });
  }
  const provenance = {
    schema: 'facemorph.hosting-import/1',
    bead: 'fm-8tyu',
    source: { repository: 'facemorph-me/facemorph.me-classic', commit, tree: 'hosting/' },
    boundary: BOUNDARY,
    rule: 'every boundary-table path with destination hosting/, at the same path, and the split rows in SPLIT_IMPORTED (fm-aa8); .wrangler/ never; files over 1 MiB only if size-allowlisted',
    sizeAllowlist: [...SIZE_ALLOWLIST],
    notImported: refused.map(({ path, problem }) => ({ path, reason: problem })),
    files,
  };
  if (check) {
    const recorded = existsSync(join(root, PROVENANCE))
      ? JSON.parse(readFileSync(join(root, PROVENANCE), 'utf8'))
      : null;
    if (!recorded) problems.push({ path: PROVENANCE, problem: 'missing' });
    else if (JSON.stringify(recorded.files) !== JSON.stringify(files))
      problems.push({ path: PROVENANCE, problem: 'does not match the frozen revision' });
  } else if (!problems.length)
    writeFileSync(join(root, PROVENANCE), JSON.stringify(provenance, null, 1) + '\n');
  for (const p of problems) log(p);
  return { commit, files, refused, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const result = importHosting({
    classic: classicDir(opts),
    check: Boolean(opts.check),
    log: line,
  });
  line({
    summary: {
      ok: !result.problems.length,
      commit: result.commit,
      files: result.files.length,
      bytes: result.files.reduce((s, f) => s + f.size, 0),
      notImported: result.refused.length,
      problems: result.problems.length,
    },
  });
  process.exit(result.problems.length ? 1 : 0);
}
