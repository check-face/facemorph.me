#!/usr/bin/env node
// Builds the mounted monorepo app once and writes deploy-next/ plus its source and file identity.
// The retained control remains independently fetched by fetch-control.mjs for comparison.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { headersText } from '../hosting/headers.mjs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, git, line, options, sha256 } from '../inventory/lib.mjs';
import { CONTROL_LABEL, digestTree, readControl } from './control.mjs';

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
      repository: 'facemorph-me/facemorph.me',
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
  } else if (identity?.kind === 'destination') {
    if (
      identity.deploySource?.repository !== 'facemorph-me/facemorph.me' ||
      !/^[a-f0-9]{40}$/.test(identity.deploySource?.commit ?? '') ||
      identity.label !== 'destination' ||
      !/^[a-f0-9]{64}$/.test(identity.deploySource?.sourceTreeSha256 ?? '') ||
      typeof identity.deploySource?.sourceTreeClean !== 'boolean'
    )
      out.push({ problem: 'invalid monorepo deploy source' });
    if (
      identity.importedFrom?.commit !== record.source.commit ||
      identity.importedFrom?.repository !== record.source.repository
    )
      out.push({ problem: 'invalid import provenance' });
  } else out.push({ problem: 'unknown build kind', got: identity?.kind });
  if (!Array.isArray(identity?.files) || identity.files.length === 0)
    out.push({ problem: 'identity lists no files' });
  else {
    const recorded = new Map(record.files.map((f) => [f.path, f.sha256]));
    for (const f of identity.files)
      if (identity.kind === 'control' && recorded.get(f.path) !== f.sha256)
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

/** Stage an actual built directory, preserving its bytes and attaching source/import provenance. */
export function stageBuilt({ out, built, source, record = readControl() }) {
  out = resolve(out);
  if (!existsSync(join(built, 'index.html'))) throw Error('No built application index.html');
  if (existsSync(join(out, 'deploy-next')) && readIdentity(out).findings.length)
    throw Error(`deploy-next exists without a valid ${IDENTITY}; refusing to replace it`);
  mkdirSync(out, { recursive: true });
  for (const name of [...ARTIFACT_FILES, IDENTITY])
    rmSync(join(out, name), { recursive: true, force: true });
  cpSync(built, join(out, 'deploy-next'), {
    recursive: true,
    // Vite's build graph is private tooling metadata, never a publication input.
    filter: (path) => path !== join(built, '.vite'),
  });
  cpSync(join(REPO, 'hosting/next-static/catalogue.json'), join(out, 'deploy-next/catalogue.json'));
  writeFileSync(join(out, 'deploy-next/_headers'), headersText());
  writeFileSync(join(out, 'deploy-next/_redirects'), '/* /index.html 200\n');
  const files = digestTree(join(out, 'deploy-next')).map((f) => ({
    ...f,
    path: `deploy-next/${f.path}`,
  }));
  writeFileSync(
    join(out, 'next-site-SHA256SUMS'),
    files.map((f) => `${f.sha256}  ${f.path}\n`).join(''),
  );
  writeFileSync(join(out, 'next-site-source.txt'), source.commit + '\n');
  const identity = {
    schema: IDENTITY_SCHEMA,
    kind: 'destination',
    label: 'destination',
    deploySource: { repository: 'facemorph-me/facemorph.me', ...source },
    importedFrom: {
      repository: record.source.repository,
      commit: record.source.commit,
      controlZipSha256: record.release.sha256,
    },
    files: [
      ...files,
      ...ARTIFACT_FILES.slice(1).map((path) => {
        const bytes = readFileSync(join(out, path));
        return { path, bytes: bytes.length, sha256: sha256(bytes) };
      }),
    ],
  };
  writeFileSync(join(out, IDENTITY), JSON.stringify(identity, null, 2) + '\n');
  const findings = identityFindings(out, identity, record);
  if (findings.length)
    throw Object.assign(Error('Built artifact does not match its identity'), { findings });
  return { out, identity };
}

export async function buildNext({ out = REPO, log = () => {} } = {}) {
  const commit = git(REPO, ['rev-parse', 'HEAD']).trim();
  const sourceTreeClean = !git(REPO, ['status', '--porcelain', '--untracked-files=normal']).trim();
  const inputs = git(REPO, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'apps/web',
    'packages',
    'import',
    'hosting/next-static',
    'scripts/hosting',
    'scripts/import/build-next.mjs',
    'scripts/import/control.mjs',
    'scripts/inventory/lib.mjs',
    'scripts/ci/ort-mirror.ts',
    'scripts/ci/serial-ort.ts',
    'package.json',
    'package-lock.json',
  ])
    .split('\0')
    .filter(Boolean)
    .sort();
  const sourceTreeSha256 = sha256(
    inputs
      .filter((p) => existsSync(join(REPO, p)))
      .map((p) => `${sha256(readFileSync(join(REPO, p)))}  ${p}\n`)
      .join(''),
  );
  const buildId = commit + (sourceTreeClean ? '' : '-dirty');
  const child = spawnSync('npm', ['run', 'build'], {
    cwd: REPO,
    env: { ...process.env, FACEMORPH_SOURCE_SHA: buildId },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  process.stderr.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  if (child.error || child.status !== 0)
    throw child.error ?? Error(`Application build failed: ${child.status}`);
  const result = stageBuilt({
    out,
    built: join(REPO, 'apps/web/dist'),
    source: { commit, buildId, sourceTreeClean, sourceTreeSha256 },
  });
  log({ event: 'built-monorepo', source: result.identity.deploySource });
  return result;
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
    const { identity } = await buildNext({ out, log: line });
    line({
      summary: {
        ok: true,
        out: join(out, 'deploy-next'),
        label: identity.label,
        deploySource: identity.deploySource,
        files: identity.files.length,
        importedControlZipSha256: identity.importedFrom.controlZipSha256,
      },
    });
  } catch (error) {
    for (const f of error.findings ?? []) line(f);
    line({ summary: { ok: false, error: error.message } });
    process.exit(1);
  }
}
