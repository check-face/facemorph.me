#!/usr/bin/env node
// Clean-clone staging of the site (fm-8tyu): classic's deploy job ("Verify", "Rebuild the runtime", "Stage") re-homed
// onto this repository's inputs, with every step logged (input and output digests, bytes fetched by host class).
//   1. artifact   deploy-next/ verified against its identity (npm run build:next -- --check)
//   2. runtime    the acquired runtime (scripts/runtime/acquire.mjs cache) checked file by file against
//                 import/build-inputs.json runtime.assets; nothing is fetched here
//   3. catalogue  hosting/next-static/catalogue.json equals the artifact's (promote.py's rule)
//   4. stage      the imported hosting/next-static/stage.py, unchanged
//   5. record     the staged file list with sizes and SHA-256s, and the staging output fields
// Every input must resolve inside the clone or the declared acquisition cache (symlinks included); anything else fails.
//   node scripts/hosting/stage.mjs [--runtime .cache/runtime] [--out .cache/staging] [--record staging.json]
import { headersText } from './headers.mjs';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INPUTS, REPO, line, options, readJson, sha256 } from '../inventory/lib.mjs';
import { acquiredFindings } from '../inventory/check-build-inputs.mjs';

const inside = (path, roots) => roots.some((r) => path === r || path.startsWith(r + sep));

/** Every regular file under dir as {path, size, sha256}, sorted; refuses symlinks that leave the allowed roots. */
export function digestTree(dir, roots) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const p = join(at, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink() && !inside(realpathSync(p), roots))
        throw new Error(`input ${p} links outside the clone and the cache`);
      if (statSync(p).isDirectory()) walk(p);
      else
        out.push({
          path: relative(dir, p).split(sep).join('/'),
          size: statSync(p).size,
          sha256: sha256(readFileSync(p)),
        });
    }
  };
  walk(dir);
  return out;
}

export const treeDigest = (files) =>
  sha256(Buffer.from(files.map((f) => `${f.sha256}  ${f.path}\n`).join('')));

/** Differences between two staged trees by path and digest. Pure. */
export function compareTrees(a, b) {
  const ma = new Map(a.map((f) => [f.path, f.sha256]));
  const mb = new Map(b.map((f) => [f.path, f.sha256]));
  const out = [];
  for (const [p, d] of ma)
    if (!mb.has(p)) out.push({ path: p, problem: 'only in the first' });
    else if (mb.get(p) !== d) out.push({ path: p, problem: 'different bytes' });
  for (const p of mb.keys()) if (!ma.has(p)) out.push({ path: p, problem: 'only in the second' });
  return out;
}

/** The notices a later bead ported (hosting/PROVENANCE.json `ported` records under hosting/next/notices/), as
 * the staged runtime/notices/ path with the frozen and the ported digest and size. stage.py copies these over the
 * runtime's own notices, so classic's staging carries the frozen bytes and this clone's the ported ones. */
export function portedNotices(provenance = readJson(join(REPO, 'hosting/PROVENANCE.json'))) {
  const prefix = 'hosting/next/notices/';
  return provenance.files
    .filter((f) => f.path.startsWith(prefix) && f.ported?.sha256)
    .map((f) => ({
      path: 'runtime/notices/' + f.path.slice(prefix.length),
      classic: f.sha256,
      sha256: f.ported.sha256,
      size: f.ported.bytes,
      bead: f.ported.bead,
    }));
}

/** The declared migrations from frozen staging: the shared production header policy (fm-zz2i) and each notice a
 * bead ported (portedNotices). Every other path/byte remains compared to classic. A wrong candidate header or
 * notice still fails, and so does a classic record whose notice is not the frozen bytes the port replaced.
 */
export function publicationReference(other, notices = portedNotices()) {
  if (!/^[a-f0-9]{40}$/.test(other.classicCommit ?? '')) return other;
  const bytes = Buffer.from(headersText());
  const header = other.files.find((f) => f.path === '_headers');
  if (!header || header.sha256 !== other.fields.headersSha256)
    throw Error('Classic staging reference has no consistent header record');
  const ports = new Map(notices.map((n) => [n.path, n]));
  const noticeMigration = [];
  const files = other.files.map((f) => {
    if (f.path === '_headers') return { ...f, size: bytes.length, sha256: sha256(bytes) };
    const port = ports.get(f.path);
    if (!port) return f;
    if (f.sha256 !== port.classic)
      throw Error(`Classic staging reference ${f.path} is not the frozen notice its port replaced`);
    noticeMigration.push({ path: f.path, classic: f.sha256, ported: port.sha256, bead: port.bead });
    return { ...f, size: port.size, sha256: port.sha256 };
  });
  return {
    ...other,
    files,
    headerMigration: { classic: header.sha256, production: sha256(bytes), bead: 'fm-zz2i' },
    ...(noticeMigration.length ? { noticeMigration } : {}),
    fields: {
      ...other.fields,
      bytes: files.reduce((n, f) => n + f.size, 0),
      headersSha256: sha256(bytes),
      treeSha256: treeDigest(files),
    },
  };
}

export function stage({ runtime, out, log = () => {} }) {
  runtime = resolve(runtime);
  out = resolve(out);
  const roots = [realpathSync(REPO), realpathSync(runtime)];
  const step = (name, fields) => log({ step: name, ...fields });
  for (const input of [runtime, join(REPO, 'deploy-next'), join(REPO, 'hosting')])
    if (!inside(realpathSync(input), roots))
      throw new Error(`input ${input} is outside the clone and the declared cache`);

  const check = spawnSync(
    process.execPath,
    [join(REPO, 'scripts/import/build-next.mjs'), '--check'],
    { encoding: 'utf8' },
  );
  const identity = JSON.parse(check.stdout.trim().split('\n').at(-1)).summary;
  if (check.status !== 0) throw new Error('deploy-next/ does not verify against its identity');
  const frontend = digestTree(join(REPO, 'deploy-next'), roots);
  step('artifact', {
    kind: identity.kind,
    deploySource: identity.deploySource?.commit,
    files: frontend.length,
    treeSha256: treeDigest(frontend),
  });

  const { out: findings, files } = acquiredFindings(runtime, readJson(BUILD_INPUTS).runtime.assets);
  if (findings.length || !files)
    throw new Error(
      `the runtime at ${runtime} is not the acquired set (${findings.length} findings)`,
    );
  const runtimeTree = digestTree(runtime, roots);
  step('runtime', {
    files: runtimeTree.length,
    bytes: runtimeTree.reduce((s, f) => s + f.size, 0),
    treeSha256: treeDigest(runtimeTree),
    fetchedBytesByHost: {},
    note: 'verified acquisition cache; nothing fetched in this step',
  });

  const catalogue = join(REPO, 'hosting/next-static/catalogue.json');
  if (!readFileSync(catalogue).equals(readFileSync(join(REPO, 'deploy-next/catalogue.json'))))
    throw new Error("hosting/next-static/catalogue.json is not the artifact's names index");
  step('catalogue', { sha256: sha256(readFileSync(catalogue)) });

  rmSync(out, { recursive: true, force: true });
  const s = spawnSync(
    'python3',
    [
      join(REPO, 'hosting/next-static/stage.py'),
      '--runtime',
      runtime,
      '--frontend',
      join(REPO, 'deploy-next'),
      '--catalogue',
      catalogue,
      '--output',
      out,
    ],
    { encoding: 'utf8' },
  );
  if (s.status !== 0) throw new Error(`stage.py failed: ${s.stderr || s.stdout}`);
  const staged = digestTree(out, [...roots, realpathSync(out)]);
  const fields = {
    files: staged.length,
    bytes: staged.reduce((sum, f) => sum + f.size, 0),
    runtimeFiles: staged.filter((f) => f.path.startsWith('runtime/')).length,
    headersSha256: sha256(readFileSync(join(out, '_headers'))),
    treeSha256: treeDigest(staged),
  };
  step('stage', {
    stagePy: sha256(readFileSync(join(REPO, 'hosting/next-static/stage.py'))),
    output: s.stdout.trim().replace(out, '<out>'),
    ...fields,
  });
  return { staged, fields };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  try {
    const { staged, fields } = stage({
      runtime: opts.runtime ?? join(REPO, '.cache/runtime'),
      out: opts.out ?? join(REPO, '.cache/staging'),
      log: line,
    });
    if (opts.record)
      writeFileSync(opts.record, JSON.stringify({ fields, files: staged }, null, 1) + '\n');
    if (opts.compare) {
      const other = publicationReference(JSON.parse(readFileSync(opts.compare, 'utf8')));
      if (other.headerMigration) line({ headerMigration: other.headerMigration });
      for (const m of other.noticeMigration ?? []) line({ noticeMigration: m });
      const diffs = compareTrees(staged, other.files);
      for (const d of diffs) line(d);
      const fieldDiffs = Object.keys(fields).filter((k) => fields[k] !== other.fields[k]);
      line({
        summary: {
          ok: !diffs.length && !fieldDiffs.length,
          ...fields,
          differences: diffs.length,
          fieldDifferences: fieldDiffs,
        },
      });
      process.exit(diffs.length || fieldDiffs.length ? 1 : 0);
    }
    line({ summary: { ok: true, ...fields } });
  } catch (error) {
    line({ summary: { ok: false, error: error.message } });
    process.exit(1);
  }
}
