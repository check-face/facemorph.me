// Runs from the trusted default branch. Bot manifests are data; never execute PR source here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DependencyPolicy } from './dependency-freeze.ts';
import { generateOverlay, ORT_FILES } from './ort-mirror.ts';

export interface DependencyPullRequest {
  number: number;
  state: string;
  user: { login: string };
  base: { ref: string; sha: string; repo: { id: number } };
  head: { ref: string; sha: string; repo: { id: number } };
}
export interface QualificationRun {
  id: number;
  event: string;
  path: string;
  head_sha: string;
  head_branch: string;
  status: string;
  conclusion: string | null;
  repository: { id: number };
}
export interface QualificationJob {
  name: string;
  conclusion: string | null;
  status: string;
}

const GROUPS = ['build-tools', 'react-and-ui', 'onnx-runtime', 'test-tools'];
export const ORT_MIRROR_GROUP = 'onnx-runtime';
const MANIFESTS = new Set([
  'package.json',
  'apps/web/package.json',
  'packages/stylegan-js/package.json',
  'packages/browser-model-manager/package.json',
  'packages/cloudflare-model-host/package.json',
  'packages/model-conv/package.json',
  'package-lock.json',
  'import/runtime-mirror.json',
  'tools/browser-harness/requirements.in',
  'tools/browser-harness/requirements.txt',
]);

export function dependencyGroup(pr: DependencyPullRequest, files: string[]): string {
  if (
    pr.state !== 'open' ||
    pr.user.login !== 'dependabot[bot]' ||
    pr.base.ref !== 'main' ||
    pr.head.repo.id !== pr.base.repo.id ||
    !/^[a-f0-9]{40}$/.test(pr.head.sha)
  )
    throw new Error('only an open same-repository Dependabot PR to main can be qualified');
  const prefix = /^dependabot\/(?:npm_and_yarn|pip)\/(.+)$/
    .exec(pr.head.ref)?.[1]
    ?.split('/')
    .at(-1);
  const group = GROUPS.find((name) => prefix === name || prefix?.startsWith(`${name}-`));
  if (!group) throw new Error('unknown dependency group');
  if (!files.length || files.some((path) => !MANIFESTS.has(path)))
    throw new Error(
      'updater changes may touch only dependency manifests, locks and the runtime mirror manifest',
    );
  return group;
}

export function qualificationProblems(
  run: QualificationRun,
  jobs: QualificationJob[],
  pr: DependencyPullRequest,
  files: string[],
  policy: DependencyPolicy,
): string[] {
  const group = dependencyGroup(pr, files);
  const problems: string[] = [];
  if (run.event !== 'workflow_dispatch' || run.path.split('@')[0] !== '.github/workflows/main.yml')
    problems.push('qualification must be an explicit main.yml branch build');
  if (
    run.head_sha !== pr.head.sha ||
    run.head_branch !== pr.head.ref ||
    run.repository.id !== pr.head.repo.id
  )
    problems.push('qualification does not match the current PR head');
  if (run.status !== 'completed' || run.conclusion !== 'success')
    problems.push('main qualification did not pass');
  const required = ['dependency-currency', ...(policy.groups[group]?.requiredChecks ?? [])];
  if (required.length < 2) problems.push('dependency group has no required checks');
  for (const name of required) {
    const matches = jobs.filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      matches[0]!.status !== 'completed' ||
      matches[0]!.conclusion !== 'success'
    )
      problems.push(`required check missing, skipped, ambiguous or failed: ${name}`);
  }
  return problems;
}

function api<T>(path: string, method = 'GET', body?: unknown): T {
  const args = ['api', '--method', method, path];
  if (body !== undefined) args.push('--input', '-');
  const output = execFileSync('gh', args, {
    encoding: 'utf8',
    input: body === undefined ? undefined : JSON.stringify(body),
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.trim() ? (JSON.parse(output) as T) : (undefined as T);
}

function filesFor(repo: string, number: number): string[] {
  const files: string[] = [];
  for (let page = 1; ; page++) {
    const values = api<{ filename: string }[]>(
      `repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    files.push(...values.map((file) => file.filename));
    if (values.length < 100) return files;
    if (page >= 30) throw new Error('dependency PR file inventory exceeds limit');
  }
}

function jobsFor(repo: string, id: number): QualificationJob[] {
  const jobs: QualificationJob[] = [];
  for (let page = 1; ; page++) {
    const values = api<{ jobs: QualificationJob[] }>(
      `repos/${repo}/actions/runs/${id}/jobs?per_page=100&page=${page}`,
    ).jobs;
    jobs.push(...values);
    if (values.length < 100) return jobs;
    if (page >= 30) throw new Error('qualification job inventory exceeds limit');
  }
}

export function mirrorLockEntry(lock: {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
}) {
  const entries = Object.entries(lock.packages)
    .filter(([path]) => /(?:^|\/)node_modules\/onnxruntime-web$/.test(path))
    .map(([, value]) => value);
  const entry = entries[0];
  if (
    !entry ||
    entries.some((other) => other.version !== entry.version || other.integrity !== entry.integrity)
  )
    throw new Error('one consistent locked ORT version and integrity is required');
  const { version, resolved, integrity } = entry;
  if (
    !version ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    resolved !== `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${version}.tgz` ||
    !integrity ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
  )
    throw new Error('stable canonical npm ORT provenance is required');
  return { version, resolved, integrity };
}

/** Pair the npm update with computed mirror bytes on the same bot branch, before qualification. */
async function prepareOrtMirror(
  repo: string,
  pr: DependencyPullRequest,
): Promise<DependencyPullRequest> {
  const content = api<{ content: string }>(
    `repos/${repo}/contents/package-lock.json?ref=${pr.head.sha}`,
  );
  const entry = mirrorLockEntry(
    JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')),
  );
  const response = await fetch(entry.resolved, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  });
  if (!response.ok || !response.body)
    throw new Error(`ORT tarball fetch failed: ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 256 * 1024 * 1024) throw new Error('ORT tarball exceeds 256 MiB');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity)
    throw new Error('ORT tarball does not match npm lock integrity');
  const scratch = mkdtempSync(join(tmpdir(), 'facemorph-ort-update-'));
  let text: string;
  try {
    const archive = join(scratch, 'ort.tgz');
    const dist = join(scratch, 'package', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(archive, bytes);
    for (const path of ['package.json', ...ORT_FILES.map((name) => `dist/${name}`)]) {
      // Extract only known regular-file contents; never materialize archive paths or links.
      const file = execFileSync('tar', ['-xOf', archive, `package/${path}`], {
        maxBuffer: 128 * 1024 * 1024,
      });
      writeFileSync(join(scratch, 'package', path), file, { flag: 'wx' });
    }
    text = JSON.stringify(generateOverlay(dist, entry), null, 2) + '\n';
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const source = api<{ tree: { sha: string } }>(`repos/${repo}/git/commits/${pr.head.sha}`);
  const tree = api<{ tree: { path: string; sha: string }[]; truncated: boolean }>(
    `repos/${repo}/git/trees/${source.tree.sha}?recursive=1`,
  );
  if (tree.truncated) throw new Error('cannot inspect truncated dependency tree');
  const current = tree.tree.find((file) => file.path === 'import/runtime-mirror.json');
  if (current) {
    const blob = api<{ content: string }>(`repos/${repo}/git/blobs/${current.sha}`);
    if (Buffer.from(blob.content, 'base64').toString('utf8') === text) return pr;
  }
  const blob = api<{ sha: string }>(`repos/${repo}/git/blobs`, 'POST', {
    content: text,
    encoding: 'utf-8',
  });
  const nextTree = api<{ sha: string }>(`repos/${repo}/git/trees`, 'POST', {
    base_tree: source.tree.sha,
    tree: [{ path: 'import/runtime-mirror.json', mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const commit = api<{ sha: string }>(`repos/${repo}/git/commits`, 'POST', {
    message: 'chore: pair ORT npm update with its verified mirror manifest (fm-r4a)',
    tree: nextTree.sha,
    parents: [pr.head.sha],
  });
  api(`repos/${repo}/git/refs/heads/${pr.head.ref}`, 'PATCH', { sha: commit.sha, force: false });
  return api<DependencyPullRequest>(`repos/${repo}/pulls/${pr.number}`);
}

async function main() {
  const mode = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY required');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  if (mode === 'dispatch') {
    const numbers = event.pull_request
      ? [event.pull_request.number as number]
      : api<DependencyPullRequest[]>(`repos/${repo}/pulls?state=open&base=main&per_page=100`)
          .filter((pr) => pr.user.login === 'dependabot[bot]')
          .map((pr) => pr.number);
    for (const number of numbers) {
      let pr = api<DependencyPullRequest>(`repos/${repo}/pulls/${number}`);
      let group: string;
      try {
        group = dependencyGroup(pr, filesFor(repo, number));
      } catch (error) {
        console.log(
          JSON.stringify({ event: 'dependency-pr-refused', number, reason: String(error) }),
        );
        continue;
      }
      const comparison = api<{ merge_base_commit: { sha: string } }>(
        `repos/${repo}/compare/${pr.base.sha}...${pr.head.sha}`,
      );
      if (comparison.merge_base_commit.sha !== pr.base.sha) {
        api(`repos/${repo}/pulls/${number}/update-branch`, 'PUT', {
          expected_head_sha: pr.head.sha,
        });
        console.log(JSON.stringify({ event: 'base-update-requested', number, head: pr.head.sha }));
        continue;
      }
      // GITHUB_TOKEN writes do not emit push/PR workflow events. Dispatch explicitly.
      const existing = api<{ workflow_runs: QualificationRun[] }>(
        `repos/${repo}/actions/workflows/main.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(pr.head.ref)}&per_page=30`,
      ).workflow_runs;
      if (existing.some((run) => run.head_sha === pr.head.sha)) {
        console.log(
          JSON.stringify({ event: 'already-qualified-or-running', number, head: pr.head.sha }),
        );
        continue;
      }
      if (group === ORT_MIRROR_GROUP) pr = await prepareOrtMirror(repo, pr);
      api(`repos/${repo}/actions/workflows/main.yml/dispatches`, 'POST', {
        ref: pr.head.ref,
        inputs: { dependency_group: group, dependency_pr: String(number) },
      });
      console.log(
        JSON.stringify({ event: 'qualification-dispatched', number, group, head: pr.head.sha }),
      );
    }
  } else if (mode === 'merge') {
    const id = event.workflow_run?.id;
    if (!Number.isSafeInteger(id)) throw new Error('workflow_run event required');
    const run = api<QualificationRun>(`repos/${repo}/actions/runs/${id}`);
    if (!run.head_branch.startsWith('dependabot/')) return;
    const owner = repo.split('/')[0];
    const prs = api<DependencyPullRequest[]>(
      `repos/${repo}/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`,
    );
    if (prs.length !== 1) throw new Error('qualification must identify exactly one open PR');
    const pr = api<DependencyPullRequest>(`repos/${repo}/pulls/${prs[0]!.number}`);
    const comparison = api<{ merge_base_commit: { sha: string } }>(
      `repos/${repo}/compare/${pr.base.sha}...${pr.head.sha}`,
    );
    if (comparison.merge_base_commit.sha !== pr.base.sha)
      throw new Error(
        'main advanced beyond the qualified branch; update and requalify before merging',
      );
    const policy = JSON.parse(
      readFileSync(new URL('./dependency-policy.json', import.meta.url), 'utf8'),
    ) as DependencyPolicy;
    const problems = qualificationProblems(
      run,
      jobsFor(repo, id),
      pr,
      filesFor(repo, pr.number),
      policy,
    );
    console.log(
      JSON.stringify({
        event: 'qualification-reviewed',
        run: id,
        pr: pr.number,
        head: pr.head.sha,
        problems,
      }),
    );
    if (problems.length) {
      process.exitCode = 1;
      return;
    }
    // GitHub atomically refuses if a new bot push raced this review. No bypass or admin merge.
    execFileSync(
      'gh',
      [
        'pr',
        'merge',
        String(pr.number),
        '--repo',
        repo,
        '--squash',
        '--match-head-commit',
        pr.head.sha,
      ],
      { stdio: 'inherit' },
    );
  } else throw new Error('usage: dependency-controller.ts dispatch|merge');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
