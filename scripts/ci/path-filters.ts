#!/usr/bin/env node
// Path-filter coverage and lane conventions (fm-o8xn), from scripts/ci/path-filters.json:
// - every top-level code root of the tree is covered by the shared list or excluded with a reason;
// - each registered lane's push filter is exactly its declared shared narrowing, its extras, its workflow file and
//   the shared actions; its concurrency group is '<lane>-${{ github.ref }}' with cancel-in-progress false;
//   its cache keys hash the lockfile or a manifest digest, never a branch, ref, run or date.
//   node scripts/ci/path-filters.ts [--root <tree>]       one JSON line; exit 1 on any problem
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface Lane {
  readonly workflow: string;
  readonly shared: readonly string[];
  readonly extra: readonly string[];
}
export interface Filters {
  readonly shared: readonly string[];
  readonly excluded: Readonly<Record<string, string>>;
  readonly lanes: Readonly<Record<string, Lane>>;
}
export interface Problem {
  readonly rule: string;
  readonly detail: string;
}

const CODE = /\.(ts|tsx|mts|mjs|cjs|js|jsx|py|sh|json|ya?ml|html|css|scss|toml|fs)$/;
export const SHARED_ACTIONS = '.github/actions/**';

/** Top-level roots that hold code (a root of prose only is not one), from a list of repo-relative files. Pure. */
export function codeRoots(files: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    const [top, ...rest] = f.split('/');
    if (rest.length && top && CODE.test(f)) roots.add(top);
  }
  return [...roots].sort();
}

/** Code roots that neither a shared glob covers nor an exclusion names. Pure. */
export function uncovered(roots: readonly string[], filters: Filters): string[] {
  return roots.filter(
    (r) =>
      !(r in filters.excluded) &&
      !filters.shared.some((g) => matchesGlob(`${r}/x`, g) || g.startsWith(`${r}/`)),
  );
}

/** The push `paths:` of a workflow (flow or block list). Pure. */
export function pushPaths(yaml: string): string[] | null {
  const push = /^ {2}push:\s*\n((?: {4,}.*\n?)*)/m.exec(yaml)?.[1];
  if (!push) return null;
  const flow = /^ {4}paths:\s*\n?\s*\[([^\]]*)\]/m.exec(push);
  const items = flow
    ? (flow[1] ?? '').split(',')
    : (/^ {4}paths:\s*\n((?: {6}- .*\n?)*)/m.exec(push)?.[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/^\s*- /, ''));
  return items.map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** Problems of one lane's workflow text against its declaration. Pure. */
export function laneProblems(name: string, lane: Lane, filters: Filters, yaml: string): Problem[] {
  const out: Problem[] = [];
  for (const g of lane.shared)
    if (!filters.shared.includes(g))
      out.push({ rule: 'narrowing', detail: `${name}: ${g} is not in the shared list` });
  const expected = new Set([...lane.shared, ...lane.extra, lane.workflow, SHARED_ACTIONS]);
  const actual = pushPaths(yaml);
  if (!actual) out.push({ rule: 'paths', detail: `${name}: ${lane.workflow} has no push paths` });
  else {
    for (const p of expected)
      if (!actual.includes(p)) out.push({ rule: 'paths', detail: `${name}: push paths lack ${p}` });
    for (const p of actual)
      if (!expected.has(p))
        out.push({ rule: 'paths', detail: `${name}: push path ${p} is not declared` });
  }
  const group = /^ {2}group:\s*(.+)$/m
    .exec(yaml)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  if (group !== `${name}-\${{ github.ref }}`)
    out.push({
      rule: 'concurrency',
      detail: `${name}: group is ${group}, not ${name}-\${{ github.ref }}`,
    });
  if (!/^ {2}cancel-in-progress:\s*false\s*$/m.test(yaml))
    out.push({
      rule: 'concurrency',
      detail: `${name}: cancel-in-progress must be false (newest-only)`,
    });
  for (const m of yaml.matchAll(/^\s+key:\s*(.+)$/gm)) {
    const key = m[1] ?? '';
    if (
      /github\.(ref|run_id|run_number|sha)|date|\$\(date/.test(key) ||
      !/hashFiles\(|sha256|digest/i.test(key)
    )
      out.push({
        rule: 'cache',
        detail: `${name}: cache key ${key} is not keyed by a lockfile hash or manifest digest`,
      });
  }
  return out;
}

function trackedFiles(root: string): string[] {
  try {
    return execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    const out: string[] = [];
    const walk = (d: string, rel: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === '.git') continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
        else out.push(`${rel}${n}`);
      }
    };
    walk(root, '');
    return out;
  }
}

/** All problems of a tree against the filters. */
export function check(root: string, filters: Filters): { roots: string[]; problems: Problem[] } {
  const roots = codeRoots(trackedFiles(root));
  const problems: Problem[] = uncovered(roots, filters).map((r) => ({
    rule: 'coverage',
    detail: `top-level code root ${r}/ is neither in the shared path filters nor excluded with a reason`,
  }));
  for (const [name, lane] of Object.entries(filters.lanes)) {
    let yaml = '';
    try {
      yaml = readFileSync(join(root, lane.workflow), 'utf8');
    } catch {
      problems.push({ rule: 'paths', detail: `${name}: ${lane.workflow} does not exist` });
      continue;
    }
    problems.push(...laneProblems(name, lane, filters, yaml));
  }
  return { roots, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const filters = JSON.parse(
    readFileSync(join(repo, 'scripts/ci/path-filters.json'), 'utf8'),
  ) as Filters;
  const r = check(values.root ?? repo, filters);
  console.log(JSON.stringify({ event: 'path-filters', ok: !r.problems.length, ...r }));
  process.exitCode = r.problems.length ? 1 : 0;
}
