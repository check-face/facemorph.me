#!/usr/bin/env node
// Path-filter coverage and lane conventions (fm-o8xn; the merge queue, fm-98po), from scripts/ci/path-filters.json:
// - every top-level code root of the tree is covered by the shared list or excluded with a reason;
// - main has one pipeline, .github/workflows/main.yml (concurrency group 'main', cancel-in-progress false); no other
//   workflow runs on a push to main;
// - each registered lane is a reusable workflow (workflow_call, no push trigger on main) that main.yml calls when
//   scripts/ci/changes.ts selects it; its declared shared narrowing is inside the shared list; any concurrency it
//   keeps never cancels a run in progress; its cache keys hash the lockfile or a manifest digest, never a branch,
//   ref, run or date.
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
  /** Runs on every change except those matching `ignore` (a lane that had no push path filter). */
  readonly always?: boolean;
  readonly ignore?: readonly string[];
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
export const MAIN = '.github/workflows/main.yml';

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

/** The branches a workflow's push trigger runs on: null when it has none, [] when it has no branch filter. Pure. */
export function pushBranches(yaml: string): string[] | null {
  const push = /^ {2}push:[^\S\n]*\n?((?: {4,}.*\n?)*)/m.exec(yaml);
  if (!push) return null;
  const flow = /^ {4}branches:\s*\[([^\]]*)\]/m.exec(push[1] ?? '');
  const items = flow
    ? (flow[1] ?? '').split(',')
    : (/^ {4}branches:\s*\n((?: {6}- .*\n?)*)/m.exec(push[1] ?? '')?.[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/^\s*- /, ''));
  return items.map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** A push trigger that fires on main (no branch filter, or one naming main). Pure. */
export const pushesMain = (yaml: string): boolean => {
  const b = pushBranches(yaml);
  return b !== null && (b.length === 0 || b.includes('main'));
};

/** Problems of one lane's workflow text against its declaration and main.yml. Pure. */
export function laneProblems(
  name: string,
  lane: Lane,
  filters: Filters,
  yaml: string,
  main: string,
): Problem[] {
  const out: Problem[] = [];
  for (const g of lane.shared)
    if (!filters.shared.includes(g))
      out.push({ rule: 'narrowing', detail: `${name}: ${g} is not in the shared list` });
  if (lane.always && (lane.shared.length || lane.extra.length))
    out.push({ rule: 'paths', detail: `${name}: an always lane declares no paths` });
  if (!lane.always && !lane.shared.length && !lane.extra.length)
    out.push({ rule: 'paths', detail: `${name}: declares no paths and is not always` });
  if (pushesMain(yaml))
    out.push({ rule: 'queue', detail: `${name}: ${lane.workflow} runs on push to main` });
  if (!/^ {2}workflow_call:/m.test(yaml))
    out.push({ rule: 'queue', detail: `${name}: ${lane.workflow} is not a reusable workflow` });
  const when = `contains(fromJSON(needs.changes.outputs.lanes), '${name}')`;
  const job = /^ {2}([\w-]+):\n((?: {4}.*\n?)*)/gm;
  let called = false;
  for (const m of main.matchAll(job))
    if (m[1] === name && m[2]?.includes(`uses: ./${lane.workflow}`) && m[2].includes(when))
      called = true;
  if (!called)
    out.push({
      rule: 'queue',
      detail: `${name}: main.yml has no job ${name} calling ./${lane.workflow} if ${when}`,
    });
  if (/^concurrency:/m.test(yaml) && !/^ {2}cancel-in-progress:\s*false\s*$/m.test(yaml))
    out.push({
      rule: 'concurrency',
      detail: `${name}: cancel-in-progress must be false (a run in progress is never cancelled)`,
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

/** A `uses` step carrying a key only a `run` step may have: GitHub rejects the whole workflow, and since every lane
 * is called from main.yml, main.yml fails at startup with no annotation (dd32439). Pure. */
export function runKeysOnUses(yaml: string): string[] {
  const out: string[] = [];
  const lines = yaml.split('\n');
  lines.forEach((line, i) => {
    const m = /^(\s*)- uses: (\S+)/.exec(line);
    if (!m) return;
    const keyIndent = (m[1] ?? '').length + 2;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? '';
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const indent = l.length - l.trimStart().length;
      if (indent < keyIndent || (indent === keyIndent - 2 && l.trimStart().startsWith('- '))) break;
      const key = indent === keyIndent ? /^\s*([\w-]+):/.exec(l)?.[1] : undefined;
      if (key === 'working-directory' || key === 'shell' || key === 'run')
        out.push(`line ${j + 1}: '${key}' on the uses step ${m[2]}`);
    }
  });
  return out;
}

/** main.yml itself: one group 'main' that never cancels a run in progress. Pure. */
export function mainProblems(main: string): Problem[] {
  const out: Problem[] = [];
  if (!pushesMain(main))
    out.push({ rule: 'queue', detail: 'main.yml does not run on push to main' });
  if (!/^ {2}group:\s*main\s*$/m.test(main))
    out.push({ rule: 'queue', detail: "main.yml's concurrency group is not 'main'" });
  if (!/^ {2}cancel-in-progress:\s*false\s*$/m.test(main))
    out.push({ rule: 'queue', detail: 'main.yml must not cancel a run in progress' });
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
  const files = trackedFiles(root);
  const roots = codeRoots(files);
  const problems: Problem[] = uncovered(roots, filters).map((r) => ({
    rule: 'coverage',
    detail: `top-level code root ${r}/ is neither in the shared path filters nor excluded with a reason`,
  }));
  if (!Object.keys(filters.lanes).length) return { roots, problems };
  let main = '';
  try {
    main = readFileSync(join(root, MAIN), 'utf8');
    problems.push(...mainProblems(main));
  } catch {
    problems.push({ rule: 'queue', detail: `${MAIN} does not exist` });
  }
  for (const [name, lane] of Object.entries(filters.lanes)) {
    let yaml = '';
    try {
      yaml = readFileSync(join(root, lane.workflow), 'utf8');
    } catch {
      problems.push({ rule: 'paths', detail: `${name}: ${lane.workflow} does not exist` });
      continue;
    }
    problems.push(...laneProblems(name, lane, filters, yaml, main));
  }
  for (const f of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    const yaml = readFileSync(join(root, f), 'utf8');
    if (f !== MAIN && pushesMain(yaml))
      problems.push({ rule: 'queue', detail: `${f} runs on push to main outside main.yml` });
    for (const d of runKeysOnUses(yaml)) problems.push({ rule: 'step', detail: `${f}: ${d}` });
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
