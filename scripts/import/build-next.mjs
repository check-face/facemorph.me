#!/usr/bin/env node
// `npm run build:next` (fm-5ey): writes the deploy-next artifact at the repository root, in classic's layout
// (next-site.yml job `artifact`): deploy-next/, next-site-SHA256SUMS, next-site-source.txt.
//
// Until the rendering port, the artifact IS the pinned control: classic's candidate build, fetched from this
// repository's release asset and verified file by file (fetch-control.mjs). This script never bundles the
// edited monorepo source. next-site-identity.json, beside
// deploy-next/ so it is never served, labels it: the deploy source is classic's commit; this repository's
// commit is recorded only as the one that assembled it.
//   node scripts/import/build-next.mjs [--out <dir>] [--store <unpacked control>]
//   node scripts/import/build-next.mjs --check [--out <dir>]     read and verify an existing artifact
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, git, line, options, sha256 } from '../inventory/lib.mjs';
import { CONTROL_LABEL, digestTree, readControl } from './control.mjs';
import { fetchControl } from './fetch-control.mjs';

export const IDENTITY = 'next-site-identity.json';
export const IDENTITY_SCHEMA = 'facemorph.next-site-identity/1';
const ARTIFACT_FILES = ['deploy-next', 'next-site-SHA256SUMS', 'next-site-source.txt'];

/** The identity of a control build: classic's commit is the deploy source; `assembledBy` is informational. */
export function controlIdentity(record, assembledBy) {
  return {
    schema: IDENTITY_SCHEMA,
    kind: 'control',
    label: record.label,
    deploySource: {
      repository: record.source.repository,
      commit: record.source.commit,
      buildId: record.source.build_id,
      run: record.source.run_url,
    },
    control: {
      release: record.release.url,
      zipSha256: record.release.sha256,
      files: record.files.length,
    },
    assembledBy: {
      repository: 'check-face/facemorph.me',
      commit: assembledBy,
      role: 'fetched and verified the control; built nothing',
    },
    files: record.files,
  };
}

/** Problems with an artifact directory against its identity file; empty means it is the artifact it claims. */
export function identityFindings(dir, identity, record = readControl()) {
  const out = [];
  if (identity?.schema !== IDENTITY_SCHEMA)
    out.push({ problem: 'identity schema', got: identity?.schema });
  if (identity?.kind === 'control') {
    if (identity.label !== CONTROL_LABEL)
      out.push({ problem: 'control build without the control label', got: identity.label });
    if (
      identity.deploySource?.repository !== record.source.repository ||
      identity.deploySource?.commit !== record.source.commit
    )
      out.push({
        problem: 'control build does not name classic as its deploy source',
        got: identity.deploySource,
      });
    if (identity.deploySource?.commit === identity.assembledBy?.commit)
      out.push({ problem: 'control build names the assembling commit as deploy source' });
    if (identity.control?.zipSha256 !== record.release.sha256)
      out.push({
        problem: 'control digest is not the pinned one',
        got: identity.control?.zipSha256,
      });
  } else out.push({ problem: 'unknown build kind', got: identity?.kind });
  if (!Array.isArray(identity?.files) || identity.files.length === 0)
    out.push({ problem: 'identity lists no files' });
  else {
    const recorded = new Map(record.files.map((f) => [f.path, f.sha256]));
    for (const f of identity.files)
      if (recorded.get(f.path) !== f.sha256)
        out.push({ problem: 'identity file digest differs from the pinned control', path: f.path });
    out.push(...artifactFindings(dir, identity.files));
  }
  return out;
}

// The artifact's own paths only: deploy-next/ in full (an extra file there would be served) and the two root files.
function artifactFindings(dir, files) {
  const actual = existsSync(join(dir, 'deploy-next'))
    ? digestTree(join(dir, 'deploy-next')).map((f) => ({ ...f, path: `deploy-next/${f.path}` }))
    : [];
  for (const name of ARTIFACT_FILES.slice(1)) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const bytes = readFileSync(path);
      actual.push({ path: name, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  const byPath = new Map(actual.map((f) => [f.path, f]));
  const out = [];
  for (const f of files) {
    const got = byPath.get(f.path);
    if (!got) out.push({ path: f.path, problem: 'missing', expected: f.sha256 });
    else if (got.sha256 !== f.sha256 || got.bytes !== f.bytes)
      out.push({ path: f.path, problem: 'mismatch', expected: f.sha256, actual: got.sha256 });
    byPath.delete(f.path);
  }
  for (const f of byPath.values()) out.push({ path: f.path, problem: 'extra', actual: f.sha256 });
  return out;
}

export function readIdentity(dir) {
  const path = join(dir, IDENTITY);
  if (!existsSync(path)) return { identity: null, findings: [{ problem: `no ${IDENTITY}` }] };
  const identity = JSON.parse(readFileSync(path, 'utf8'));
  return { identity, findings: identityFindings(dir, identity) };
}

export async function buildNext({
  out = REPO,
  store,
  record = readControl(),
  log = () => {},
} = {}) {
  out = resolve(out);
  const scratch = store ? null : mkdtempSync(join(tmpdir(), 'build-next-'));
  try {
    const { dir } = await fetchControl({ dest: scratch ?? undefined, store, record, log });
    // Replace only what this script writes; never a deploy-next it cannot account for.
    const existing = join(out, IDENTITY);
    if (existsSync(join(out, 'deploy-next')) && !existsSync(existing))
      throw new Error(`${join(out, 'deploy-next')} exists without ${IDENTITY}; move it away first`);
    for (const name of [...ARTIFACT_FILES, IDENTITY])
      rmSync(join(out, name), { recursive: true, force: true });
    for (const name of ARTIFACT_FILES)
      cpSync(join(dir, name), join(out, name), { recursive: true });
    let commit = 'unknown';
    try {
      commit = git(REPO, ['rev-parse', 'HEAD']).trim();
    } catch {}
    const identity = controlIdentity(record, commit);
    writeFileSync(join(out, IDENTITY), JSON.stringify(identity, null, 2) + '\n');
    const findings = identityFindings(out, identity, record);
    if (findings.length)
      throw Object.assign(new Error('built artifact does not match its identity'), { findings });
    return { out, identity };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const out = resolve(opts.out ?? REPO);
  if (opts.check) {
    const { identity, findings } = readIdentity(out);
    for (const f of findings) line(f);
    line({
      summary: {
        ok: !findings.length,
        out,
        kind: identity?.kind ?? null,
        label: identity?.label ?? null,
        deploySource: identity?.deploySource ?? null,
        files: identity?.files?.length ?? 0,
      },
    });
    process.exit(findings.length ? 1 : 0);
  }
  try {
    const { identity } = await buildNext({ out, store: opts.store, log: line });
    line({
      summary: {
        ok: true,
        out: join(out, 'deploy-next'),
        label: identity.label,
        deploySource: identity.deploySource,
        files: identity.files.length,
        controlZipSha256: identity.control.zipSha256,
      },
    });
  } catch (error) {
    for (const f of error.findings ?? []) line(f);
    line({ summary: { ok: false, error: error.message } });
    process.exit(1);
  }
}
