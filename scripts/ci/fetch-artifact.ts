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
import { setTimeout as delay } from 'node:timers/promises';

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
  readonly stage?: string;
  readonly attempts?: number;
  readonly causeCode?: string;
  constructor(
    code: ErrorName,
    message: string,
    details: { stage?: string; attempts?: number; causeCode?: string } = {},
  ) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = code;
    Object.assign(this, details);
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

export interface ArtifactHttpOptions {
  // The CLI always uses GitHub; explicit overrides let transport tests exercise a real local HTTP server.
  readonly apiOrigin?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
}

type RequestStage = 'run-metadata' | 'artifact-list' | 'archive-download';
const transportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

// Only fixed diagnostic codes escape the request boundary. Error messages can contain signed URLs.
function transportCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'REQUEST_TIMEOUT';
  const coded = error as Error & { code?: unknown; cause?: unknown; errors?: unknown[] };
  if (typeof coded.code === 'string' && transportCodes.has(coded.code)) return coded.code;
  const nested = transportCode(coded.cause) ?? coded.errors?.map(transportCode).find(Boolean);
  if (nested) return nested;
  if (error instanceof TypeError && /^(fetch failed|terminated)$/.test(error.message))
    return 'FETCH_TRANSPORT_ERROR';
  return undefined;
}

/** Retry the whole response read, so a truncated body never reaches metadata parsing or unzip. */
async function requestBytes(
  url: string,
  stage: RequestStage,
  options: ArtifactHttpOptions,
): Promise<{ status: number; bytes: Buffer }> {
  const code = stage === 'archive-download' ? 'DownloadFailed' : 'ApiError';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    let retry = false;
    try {
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${options.token ?? token()}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (response.status >= 500 && response.status <= 599) {
        await response.body?.cancel().catch(() => {});
        if (attempt === 3)
          throw new LookupError(
            code,
            `${stage}: HTTP ${response.status} after ${attempt} attempts`,
            {
              stage,
              attempts: attempt,
              causeCode: `HTTP_${response.status}`,
            },
          );
        retry = true;
      } else {
        // A refusal body is not metadata and must not turn a 401/403/404/410 into a transport retry.
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {});
          return { status: response.status, bytes: Buffer.alloc(0) };
        }
        return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
      }
    } catch (error) {
      if (error instanceof LookupError) throw error;
      const causeCode = controller.signal.aborted ? 'REQUEST_TIMEOUT' : transportCode(error);
      if (!causeCode || attempt === 3)
        throw new LookupError(code, `${stage}: request failed after ${attempt} attempt(s)`, {
          stage,
          attempts: attempt,
          causeCode: causeCode ?? 'REQUEST_ERROR',
        });
      retry = true;
    } finally {
      clearTimeout(deadline);
    }
    if (retry) await delay(retryDelayMs * attempt);
  }
  throw new Error('unreachable artifact request state');
}

function metadata(bytes: Buffer, stage: RequestStage): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new LookupError('ApiError', `${stage}: invalid JSON metadata`, { stage });
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function runMetadata(bytes: Buffer): Run {
  const value = metadata(bytes, 'run-metadata');
  if (
    !record(value) ||
    !Number.isSafeInteger(value.id) ||
    typeof value.created_at !== 'string' ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.head_sha !== 'string' ||
    typeof value.path !== 'string' ||
    !record(value.repository) ||
    !Number.isSafeInteger(value.repository.id) ||
    typeof value.repository.full_name !== 'string'
  )
    throw new LookupError('ApiError', 'run-metadata: malformed metadata', {
      stage: 'run-metadata',
    });
  return value as unknown as Run;
}

function artifactMetadata(bytes: Buffer): Artifact[] {
  const value = metadata(bytes, 'artifact-list');
  if (
    !record(value) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.some(
      (artifact: unknown) =>
        !record(artifact) ||
        !Number.isSafeInteger(artifact.id) ||
        typeof artifact.name !== 'string' ||
        typeof artifact.expired !== 'boolean' ||
        typeof artifact.size_in_bytes !== 'number' ||
        !Number.isSafeInteger(artifact.size_in_bytes) ||
        artifact.size_in_bytes < 0 ||
        typeof artifact.archive_download_url !== 'string',
    )
  )
    throw new LookupError('ApiError', 'artifact-list: malformed metadata', {
      stage: 'artifact-list',
    });
  return value.artifacts as Artifact[];
}

export interface Fetched {
  readonly artifactDir: string;
  readonly artifactDigest: string;
  readonly provenance: Record<string, unknown>;
}

/** Looks the artifact up by its explicit identity, downloads, unpacks and verifies it into out. */
export async function fetchArtifact(
  i: Inputs,
  out: string,
  retentionDays = 14,
  http: ArtifactHttpOptions = {},
): Promise<Fetched> {
  const problems = inputProblems(i);
  if (problems.length) throw new LookupError('InvalidInput', problems.join('; '));
  const runPath = `/repositories/${i.sourceRepoId}/actions/runs/${i.runId}`;
  const apiOrigin = http.apiOrigin ?? 'https://api.github.com';
  const run = await requestBytes(`${apiOrigin}${runPath}`, 'run-metadata', http);
  if (run.status === 404)
    throw new LookupError(
      'RunNotFoundInRepository',
      `repository ${i.sourceRepoId} has no run ${i.runId} (wrong repository ID or run ID)`,
    );
  if (run.status !== 200)
    throw new LookupError('ApiError', `run-metadata: HTTP ${run.status}`, {
      stage: 'run-metadata',
    });
  const sourceRun = runMetadata(run.bytes);
  checkRun(sourceRun, i);
  const list = await requestBytes(
    `${apiOrigin}${runPath}/artifacts?per_page=100&name=${encodeURIComponent(i.artifactName)}`,
    'artifact-list',
    http,
  );
  if (list.status !== 200)
    throw new LookupError('ApiError', `artifact-list: HTTP ${list.status}`, {
      stage: 'artifact-list',
    });
  const artifact = pickArtifact(artifactMetadata(list.bytes), i, {
    runCreatedAt: sourceRun.created_at,
    now: Date.now(),
    retentionDays,
  });
  const zip = await requestBytes(artifact.archive_download_url, 'archive-download', http);
  if (zip.status === 410)
    throw new LookupError(
      'ArtifactExpired',
      `blocked: artifact expired (${i.artifactName}, run ${i.runId})`,
    );
  if (zip.status !== 200)
    throw new LookupError('DownloadFailed', `archive-download: HTTP ${zip.status}`, {
      stage: 'archive-download',
    });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const zipPath = `${out}.zip`;
  const bytes = zip.bytes;
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
      repository: sourceRun.repository.full_name,
      workflow: sourceRun.path,
      runId: Number(i.runId),
      commit: sourceRun.head_sha,
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
    const e = error as LookupError;
    console.log(
      JSON.stringify({
        verdict: 'fail',
        error: e.code ?? 'ApiError',
        message: e.message,
        stage: e.stage,
        attempts: e.attempts,
        causeCode: e.causeCode,
        inputs,
      }),
    );
    process.exitCode = 1;
  }
}
