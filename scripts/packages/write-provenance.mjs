// Writes PROVENANCE.json at the root of the package being built (the working directory, as `npm run build -w`
// sets it) (fm-3osh, fm-oagi). The record binds the published version to what built it:
// - name and version from package.json;
// - sourceCommit and sourceTreeClean: the commit the build came from and whether the package's tracked files
//   matched it;
// - sourceIdentity: the package's build identity from scripts/build/identity.mjs (its tracked files, shared
//   configs, lockfile closure and the identities of the workspaces it depends on);
// - distSha256: a digest over every file under dist/ ("<sha256>  <path>\n" per file, sorted by path), which
//   verify-provenance.mjs recomputes from a packed tarball;
// - build: the CI repository, workflow run and attempt when GitHub Actions builds it, otherwise null.
// Read by the tarball content scan's required-file rule and by verify-provenance.mjs; ignored by Git.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'facemorph.package-provenance/2';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function filesUnder(dir, rel = '') {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, p) : e.isFile() ? [p] : [];
  });
}

/** Digest over every file under `dir`: sha256 of the sorted "<sha256>  <path>\n" lines. */
export function distDigest(dir) {
  const lines = filesUnder(dir)
    .sort()
    .map((p) => `${sha256(readFileSync(join(dir, p)))}  ${p}\n`);
  return { sha256: sha256(Buffer.from(lines.join(''))), files: lines.length };
}

export async function provenanceRecord(dir, env = process.env) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  const top = git('rev-parse', '--show-toplevel');
  const dirty = git('status', '--porcelain', '--untracked-files=no', '--', '.');
  let sourceIdentity = null;
  if (top.status === 0) {
    const { rootIdentities } = await import('../build/identity.mjs');
    const workspace = relative(top.stdout.trim(), dir).split('\\').join('/');
    sourceIdentity = rootIdentities().roots[workspace]?.digest ?? null;
  }
  const dist = distDigest(join(dir, 'dist'));
  return {
    schema: SCHEMA,
    name: pkg.name,
    version: pkg.version,
    sourceCommit: head.status === 0 ? head.stdout.trim() : null,
    sourceTreeClean: dirty.status === 0 ? dirty.stdout.trim() === '' : null,
    sourceIdentity,
    distSha256: dist.sha256,
    distFiles: dist.files,
    build: env.GITHUB_ACTIONS
      ? {
          repository: env.GITHUB_REPOSITORY ?? null,
          runId: env.GITHUB_RUN_ID ?? null,
          runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
          workflow: env.GITHUB_WORKFLOW ?? null,
        }
      : null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.cwd();
  const record = await provenanceRecord(dir);
  writeFileSync(join(dir, 'PROVENANCE.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
}
