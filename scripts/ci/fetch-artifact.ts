#!/usr/bin/env node
// Shared CI artifact lookup with explicit provenance (fm-o8xn). Every input is required and none is inherited:
// the source repository by numeric ID (an owner/name is refused; never context.repo or a corrected org prefix), the
// workflow file, the run ID, the full commit SHA and the artifact name. The run is read from the REST API and
// refused when its repository ID, head SHA or workflow file differ; the artifact is downloaded, its
// next-site-SHA256SUMS checked file by file and next-site-source.txt compared with the commit. Nothing is rebuilt.
// Fails closed with a named error; one JSON verdict line per call.
//   node scripts/ci/fetch-artifact.ts --source-repo-id 295956585 --workflow .github/workflows/next-site.yml \
//     --run-id 40056009101 --commit <40 hex> --artifact-name next-site-<sha> --out <dir> [--github-output <file>]
//     [--retention-days 14]   the source's artifact retention: a missing artifact on an older run is expired
// Token: GITHUB_TOKEN or GH_TOKEN (the job token, or a read-only token for a private source).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type ErrorName =
  | 'InvalidInput'
  | 'ApiError'
  | 'RunNotFoundInRepository'
  | 'RepositoryMismatch'
  | 'CommitMismatch'
  | 'WorkflowMismatch'
  | 'ArtifactNotFound'
  | 'ArtifactExpired'
  | 'DownloadFailed'
  | 'MissingSums'
  | 'DigestMismatch'
  | 'SourceMismatch';

export class LookupError extends Error {
  readonly code: ErrorName;
  constructor(code: ErrorName, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = code;
  }
}

export interface Inputs {
  readonly sourceRepoId: string;
  readonly workflow: string;
  readonly runId: string;
  readonly commit: string;
  readonly artifactName: string;
}

export interface Run {
  readonly id: number;
  readonly created_at: string;
  readonly head_sha: string;
  readonly path: string;
  readonly repository: { readonly id: number; readonly full_name: string };
}

export interface Artifact {
  readonly id: number;
  readonly name: string;
  readonly expired: boolean;
  readonly size_in_bytes: number;
  readonly archive_download_url: string;
}

/** Input problems, before any request. Pure. */
export function inputProblems(i: Partial<Inputs>): string[] {
  const out: string[] = [];
  if (!i.sourceRepoId) out.push('source_repo_id is required');
  else if (!/^\d+$/.test(i.sourceRepoId))
    out.push(
      `source_repo_id must be the numeric repository ID, not ${JSON.stringify(i.sourceRepoId)}`,
    );
  if (!i.workflow) out.push('workflow is required');
  else if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(i.workflow))
    out.push(
      `workflow must be the workflow file path (.github/workflows/<file>.yml), not ${i.workflow}`,
    );
  if (!i.runId || !/^\d+$/.test(i.runId)) out.push('run_id must be a numeric run ID');
  if (!i.commit || !/^[0-9a-f]{40}$/.test(i.commit)) out.push('commit must be the full 40-hex SHA');
  if (!i.artifactName) out.push('artifact_name is required');
  return out;
}

/** The run must be the one the inputs name: repository ID, head SHA and workflow file. Pure. */
export function checkRun(run: Run, i: Inputs): void {
  if (String(run.repository.id) !== i.sourceRepoId)
    throw new LookupError(
      'RepositoryMismatch',
      `run ${run.id} belongs to repository ${run.repository.id} (${run.repository.full_name}), not ${i.sourceRepoId}`,
    );
  if (run.head_sha !== i.commit)
    throw new LookupError('CommitMismatch', `run ${run.id} built ${run.head_sha}, not ${i.commit}`);
  // The API reports the workflow file, sometimes with an @ref suffix.
  if (run.path.replace(/@.*$/, '') !== i.workflow)
    throw new LookupError('WorkflowMismatch', `run ${run.id} ran ${run.path}, not ${i.workflow}`);
}

/** The named artifact of the run, unexpired. GitHub drops an expired artifact from the listing, so a missing artifact
 * on a run older than the source's retention (classic keeps next-site artifacts 14 days) is reported expired;
 * on a younger run it was never uploaded. Pure: the run's creation time and now are plain values. */
export function pickArtifact(
  artifacts: readonly Artifact[],
  i: Inputs,
  age: { runCreatedAt: string; now: number; retentionDays: number },
): Artifact {
  const found = artifacts.filter((a) => a.name === i.artifactName);
  const live = found.find((a) => !a.expired);
  if (live) return live;
  const days = (age.now - Date.parse(age.runCreatedAt)) / 86_400_000;
  if (found.length || days > age.retentionDays)
    throw new LookupError(
      'ArtifactExpired',
      `blocked: artifact expired (${i.artifactName}, run ${i.runId}, ${Math.floor(days)} days old, retention ${age.retentionDays} days)`,
    );
  throw new LookupError('ArtifactNotFound', `run ${i.runId} has no artifact ${i.artifactName}`);
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function files(dir: string, root = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, root, out);
    else out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

/** The identity digest of a deploy-next directory: SHA-256 of its sorted '<sha256>  <path>' listing (the same
 * tree digest as scripts/hosting/stage.mjs and the research drivers). */
export function treeDigest(dir: string): string {
  const lines = files(dir).map((p) => `${sha256(readFileSync(join(dir, p)))}  ${p}\n`);
  return sha256(Buffer.from(lines.join('')));
}

/** Verifies an unpacked artifact: the sums file covers every deploy-next file with matching digests, and the
 * source file names the commit. Returns the identity digest. */
export function verifyUnpacked(root: string, commit: string): { digest: string; files: number } {
  const sums = join(root, 'next-site-SHA256SUMS');
  if (!existsSync(sums)) throw new LookupError('MissingSums', `no next-site-SHA256SUMS in ${root}`);
  const listed = new Map<string, string>();
  for (const line of readFileSync(sums, 'utf8').split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new LookupError('MissingSums', `unreadable sums line: ${line}`);
    listed.set(m[2] ?? '', m[1] ?? '');
  }
  const present = files(join(root, 'deploy-next')).map((p) => `deploy-next/${p}`);
  const problems: string[] = [];
  for (const p of present) {
    const want = listed.get(p);
    if (!want) problems.push(`${p} is not in the sums file`);
    else if (want !== sha256(readFileSync(join(root, p))))
      problems.push(`${p} does not match its sum`);
  }
  for (const p of listed.keys()) if (!present.includes(p)) problems.push(`${p} is missing`);
  if (problems.length) throw new LookupError('DigestMismatch', problems.join('; '));
  const source = join(root, 'next-site-source.txt');
  const named = existsSync(source) ? readFileSync(source, 'utf8').trim() : '(none)';
  if (named !== commit)
    throw new LookupError('SourceMismatch', `next-site-source.txt names ${named}, not ${commit}`);
  return { digest: treeDigest(join(root, 'deploy-next')), files: present.length };
}

function token(): string {
  const t = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (!t) throw new LookupError('InvalidInput', 'GITHUB_TOKEN or GH_TOKEN is required');
  return t;
}

async function api<T>(path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  return { status: r.status, body: (await r.json()) as T };
}

export interface Fetched {
  readonly artifactDir: string;
  readonly artifactDigest: string;
  readonly provenance: Record<string, unknown>;
}

/** Looks the artifact up by its explicit identity, downloads, unpacks and verifies it into out. */
export async function fetchArtifact(i: Inputs, out: string, retentionDays = 14): Promise<Fetched> {
  const problems = inputProblems(i);
  if (problems.length) throw new LookupError('InvalidInput', problems.join('; '));
  const runPath = `/repositories/${i.sourceRepoId}/actions/runs/${i.runId}`;
  const run = await api<Run & { message?: string }>(runPath);
  if (run.status === 404)
    throw new LookupError(
      'RunNotFoundInRepository',
      `repository ${i.sourceRepoId} has no run ${i.runId} (wrong repository ID or run ID)`,
    );
  if (run.status !== 200)
    throw new LookupError('ApiError', `GET ${runPath}: ${run.status} ${run.body.message ?? ''}`);
  checkRun(run.body, i);
  const list = await api<{ artifacts: Artifact[]; message?: string }>(
    `${runPath}/artifacts?per_page=100&name=${encodeURIComponent(i.artifactName)}`,
  );
  if (list.status !== 200)
    throw new LookupError(
      'ApiError',
      `GET ${runPath}/artifacts: ${list.status} ${list.body.message ?? ''}`,
    );
  const artifact = pickArtifact(list.body.artifacts, i, {
    runCreatedAt: run.body.created_at,
    now: Date.now(),
    retentionDays,
  });
  const zip = await fetch(artifact.archive_download_url, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (zip.status === 410)
    throw new LookupError(
      'ArtifactExpired',
      `blocked: artifact expired (${i.artifactName}, run ${i.runId})`,
    );
  if (!zip.ok)
    throw new LookupError('DownloadFailed', `artifact ${artifact.id}: HTTP ${zip.status}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const zipPath = `${out}.zip`;
  const bytes = Buffer.from(await zip.arrayBuffer());
  writeFileSync(zipPath, bytes);
  const u = spawnSync('unzip', ['-q', '-o', zipPath, '-d', out], { encoding: 'utf8' });
  rmSync(zipPath, { force: true });
  if (u.status !== 0)
    throw new LookupError('DownloadFailed', `unzip: ${u.stderr.trim() || u.status}`);
  const { digest, files: count } = verifyUnpacked(out, i.commit);
  return {
    artifactDir: join(realpathSync(out), 'deploy-next'),
    artifactDigest: digest,
    provenance: {
      sourceRepoId: Number(i.sourceRepoId),
      repository: run.body.repository.full_name,
      workflow: run.body.path,
      runId: Number(i.runId),
      commit: run.body.head_sha,
      artifactName: artifact.name,
      artifactId: artifact.id,
      zipSha256: sha256(bytes),
      files: count,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: v } = parseArgs({
    options: {
      'source-repo-id': { type: 'string' },
      workflow: { type: 'string' },
      'run-id': { type: 'string' },
      commit: { type: 'string' },
      'artifact-name': { type: 'string' },
      out: { type: 'string', default: '.cache/fetched-artifact' },
      'github-output': { type: 'string' },
      'retention-days': { type: 'string', default: '14' },
    },
  });
  const inputs: Inputs = {
    sourceRepoId: v['source-repo-id'] ?? '',
    workflow: v.workflow ?? '',
    runId: v['run-id'] ?? '',
    commit: v.commit ?? '',
    artifactName: v['artifact-name'] ?? '',
  };
  try {
    const r = await fetchArtifact(
      inputs,
      v.out ?? '.cache/fetched-artifact',
      Number(v['retention-days']),
    );
    console.log(JSON.stringify({ verdict: 'ok', inputs, ...r }));
    if (v['github-output'])
      appendFileSync(
        v['github-output'],
        `artifact_dir=${r.artifactDir}\nartifact_digest=${r.artifactDigest}\nprovenance_json=${JSON.stringify(r.provenance)}\n`,
      );
  } catch (error) {
    const e = error as Error & { code?: ErrorName };
    console.log(
      JSON.stringify({ verdict: 'fail', error: e.code ?? 'ApiError', message: e.message, inputs }),
    );
    process.exitCode = 1;
  }
}
