// Dependency updates cannot alter their own numerical or platform acceptance rules.
// Compare with the policy from the trusted base revision, never just the candidate's copy.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

export interface DependencyPolicy {
  schema: string;
  activeNodeMajor: number;
  updater: string;
  reason: string;
  groups: Record<
    string,
    { patterns: string[]; excludePatterns?: string[]; requiredChecks: string[] }
  >;
  excludedPaths: string[];
  toleranceFiles: Record<string, string>;
  requiredJobs: Record<string, string[]>;
  requiredMatrices: Record<string, Record<string, Record<string, unknown>>>;
  planRevision: null | { date: string; decision: string };
}

const GROUPS = ['build-tools', 'react-and-ui', 'onnx-runtime', 'test-tools'];
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

export function policyProblems(policy: DependencyPolicy): string[] {
  const problems: string[] = [];
  if (policy.schema !== 'facemorph.dependency-policy/1') problems.push('unknown dependency policy');
  if (!isDeepStrictEqual(Object.keys(policy.groups).sort(), [...GROUPS].sort()))
    problems.push('exactly the four dependency groups are required');
  for (const [group, value] of Object.entries(policy.groups)) {
    if (!value.patterns?.length) problems.push(`${group}: package patterns are required`);
    if (!value.requiredChecks?.length || value.requiredChecks.some((s) => !s.trim()))
      problems.push(`${group}: required checks are missing`);
    if (new Set(value.requiredChecks).size !== value.requiredChecks.length)
      problems.push(`${group}: duplicate required check`);
  }
  if (policy.activeNodeMajor !== 24) problems.push('active LTS Node major is 24');
  for (const path of ['classic/**', 'self-host/**'])
    if (!policy.excludedPaths.includes(path))
      problems.push(`missing frozen distribution exclusion: ${path}`);
  if (!Object.keys(policy.toleranceFiles).length)
    problems.push('missing frozen numerical tolerances');
  for (const [path, hash] of Object.entries(policy.toleranceFiles))
    if (!/^[a-f0-9]{64}$/.test(hash)) problems.push(`${path}: invalid tolerance digest`);
  if (!Object.keys(policy.requiredJobs).length) problems.push('missing required CI jobs');
  return problems;
}

/** A plan revision must name a dated operator decision added to PLAN.md in this same change. */
export function declaredPlanRevision(policy: DependencyPolicy, planDiff: string): boolean {
  const revision = policy.planRevision;
  if (!revision || !/^\d{4}-\d{2}-\d{2}$/.test(revision.date) || !revision.decision.trim())
    return false;
  return planDiff
    .split('\n')
    .some(
      (line) =>
        line.startsWith('+|') &&
        line.includes(revision.date) &&
        /operator/i.test(line) &&
        line.includes(revision.decision),
    );
}

/** Find the preceding snapshot even when stacked commits deleted and restored the policy. */
export function previousPolicyRevision(root: string, head: string): string | undefined {
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('head must be an immutable Git SHA');
  const path = 'scripts/ci/dependency-policy.json';
  const revisions = execFileSync('git', ['-C', root, 'rev-list', `${head}^`, '--', path], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const revision of revisions) {
    try {
      execFileSync('git', ['-C', root, 'cat-file', '-e', `${revision}:${path}`], {
        stdio: 'ignore',
      });
      return revision;
    } catch {
      /* A deletion is not permission to replace the preceding snapshot. */
    }
  }
  return undefined;
}

export function frozenProblems(
  trusted: DependencyPolicy,
  candidate: DependencyPolicy,
  read: (path: string) => string,
  planDiff = '',
): string[] {
  const problems = policyProblems(candidate);
  const revised = declaredPlanRevision(candidate, planDiff);
  if (!isDeepStrictEqual(trusted, candidate) && !revised)
    problems.push('frozen policy changed without a dated operator decision in PLAN.md');
  // A declared revision replaces the frozen reference explicitly; otherwise the base always wins.
  const policy = revised ? candidate : trusted;
  for (const [path, hash] of Object.entries(policy.toleranceFiles)) {
    try {
      if (digest(read(path)) !== hash)
        problems.push(`${path}: frozen numerical tolerance digest changed`);
    } catch {
      problems.push(`${path}: frozen numerical tolerance file missing`);
    }
  }
  const workflows = new Map<string, any>();
  for (const path of new Set([
    ...Object.keys(policy.requiredJobs),
    ...Object.keys(policy.requiredMatrices),
  ])) {
    try {
      workflows.set(path, parse(read(path)));
    } catch {
      problems.push(`${path}: required workflow missing or invalid`);
    }
  }
  for (const [path, ids] of Object.entries(policy.requiredJobs)) {
    const workflow = workflows.get(path);
    for (const id of ids) {
      const job = workflow?.jobs?.[id];
      if (!job) problems.push(`${path}: required job ${id} removed`);
      else {
        if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
          problems.push(`${path}: required job ${id} allows failure`);
        if (
          job.if === false ||
          String(job.if)
            .trim()
            .match(/^(?:\$\{\{\s*)?false(?:\s*\}\})?$/)
        )
          problems.push(`${path}: required job ${id} disabled`);
        if (!job.uses && !job.steps?.length)
          problems.push(`${path}: required job ${id} has no work`);
      }
    }
  }
  for (const [path, jobs] of Object.entries(policy.requiredMatrices)) {
    for (const [id, expected] of Object.entries(jobs)) {
      const actual = workflows.get(path)?.jobs?.[id]?.strategy?.matrix;
      for (const [axis, values] of Object.entries(expected)) {
        if (!Array.isArray(values) || !Array.isArray(actual?.[axis])) {
          problems.push(`${path}: required matrix ${id}.${axis} missing`);
          continue;
        }
        for (const value of values) {
          if (!actual[axis].some((cell: unknown) => isDeepStrictEqual(cell, value)))
            problems.push(`${path}: required cell ${id}.${axis} removed: ${JSON.stringify(value)}`);
        }
      }
      if (actual?.exclude?.length) problems.push(`${path}: required matrix ${id} excludes cells`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const head = args[1];
  const base =
    args[0] === '--previous-policy' && head
      ? (previousPolicyRevision(process.cwd(), head) ?? head)
      : args[0];
  if (!base || !head || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head))
    throw new Error(
      'usage: node scripts/ci/dependency-freeze.ts <base SHA>|--previous-policy <head SHA>',
    );
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
  const path = 'scripts/ci/dependency-policy.json';
  const trusted = JSON.parse(git(['show', `${base}:${path}`])) as DependencyPolicy;
  const candidate = JSON.parse(git(['show', `${head}:${path}`])) as DependencyPolicy;
  const problems = frozenProblems(
    trusted,
    candidate,
    (file) => git(['show', `${head}:${file}`]),
    git(['diff', base, head, '--', 'PLAN.md']),
  );
  console.log(JSON.stringify({ schema: 'facemorph.dependency-freeze/1', base, head, problems }));
  if (problems.length) process.exitCode = 1;
}
