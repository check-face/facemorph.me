#!/usr/bin/env node
// TypeScript check of a pushed commit, for the pre-push gate (check.mjs). It reads only the commit, never the working
// tree, so other sessions' uncommitted edits in a shared checkout neither hide nor cause an error.
// - The commit's tree is exported with `git archive` into a temp directory. node_modules entries are links to the
//   checkout's installed dependencies, except @facemorph/*, which point at the exported packages.
// - The workspaces the push touches are checked, with every workspace that depends on them, and so are the
//   repository-level `tsc -p` projects the workflows run (scripts/ci, apps/web/src/media, …) under touched paths. A
//   root TypeScript config, package.json or the lock touches everything.
// - Workspaces read their sibling packages' built declarations (dist/), as CI's `npm run typecheck` builds them first.
//   Each package's dist is built once per package tree hash and cached under ~/.cache/facemorph-hooks/dist, so an
//   unchanged package costs nothing and a changed one is built exactly from the pushed source.
//   node scripts/hooks/typecheck.mjs <commit> [<base>]     exit 0 clean, 1 type errors, 2 usage
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_CONFIGS = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'tsconfig.dom.json',
  'tsconfig.node.json',
  'tsconfig.worker.json',
]);
const TYPED = /\.(?:[cm]?[jt]sx?|json)$/;

/** Workspaces of the tree: directory, package name, @facemorph dependencies and the typecheck commands. */
export function workspaces(read) {
  const root = JSON.parse(read('package.json'));
  return (root.workspaces ?? []).flatMap((dir) => {
    let meta;
    try {
      meta = JSON.parse(read(`${dir}/package.json`));
    } catch {
      return [];
    }
    const deps = Object.keys({
      ...meta.dependencies,
      ...meta.devDependencies,
      ...meta.peerDependencies,
    }).filter((name) => name.startsWith('@facemorph/'));
    const script = meta.scripts?.typecheck ?? '';
    const projects = script
      .split('&&')
      .map((part) => /^\s*tsc -p (\S+)\s*$/.exec(part)?.[1])
      .filter(Boolean)
      .map((p) => posix.normalize(`${dir}/${p}`));
    return [{ dir, name: meta.name, deps, projects, script }];
  });
}

/** `tsc -p <repo path>` projects the workflows run directly. */
export function workflowProjects(read, list) {
  const out = new Set();
  for (const file of list('.github/workflows')) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const m of read(`.github/workflows/${file}`).matchAll(/\btsc -p ([\w./-]+\/[\w./-]+)/g))
      out.add(posix.normalize(m[1]));
  }
  return [...out].sort();
}

/** What a set of changed paths makes worth checking. */
export function affected(files, ws, extra) {
  const all = files.some((f) => ROOT_CONFIGS.has(f));
  const typed = files.filter((f) => TYPED.test(f));
  const inside = (dir) => typed.some((f) => f === dir || f.startsWith(`${dir}/`));
  const hit = new Set(ws.filter((w) => all || inside(w.dir)).map((w) => w.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const w of ws)
      if (!hit.has(w.name) && w.deps.some((d) => hit.has(d))) {
        hit.add(w.name);
        grew = true;
      }
  }
  const chosen = ws.filter((w) => hit.has(w.name));
  const projects = new Set(chosen.flatMap((w) => w.projects));
  for (const p of extra) {
    const owner = ws.find((w) => p === w.dir || p.startsWith(`${w.dir}/`));
    const dir = p.endsWith('.json') ? posix.dirname(p) : p;
    if (all || inside(dir) || (owner && hit.has(owner.name))) projects.add(p);
  }
  return { workspaces: chosen, projects: [...projects].sort() };
}

const run = (cmd, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (status) => resolve({ status, output }));
  });

async function pool(items, size, fn) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/** Type errors of `head` (paths it changed against `base`, or all of it), as {ok, checked, failures, ms}. */
export async function typecheckCommit({ root, head, base, cache, log = () => {} }) {
  const began = Date.now();
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = (
    base
      ? git('diff', '--name-only', '-z', '--diff-filter=ACMRD', base, head)
      : git('ls-tree', '-r', '--name-only', '-z', head)
  )
    .split('\0')
    .filter(Boolean);
  const quiet = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  // A tree without a root package.json or workflows (another repository's hooks, a fixture) has nothing to check.
  const read = (path) => quiet('show', `${head}:${path}`);
  const list = (dir) => {
    try {
      return quiet('ls-tree', '--name-only', `${head}:${dir}`).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  let ws;
  try {
    ws = workspaces(read);
  } catch {
    return { ok: true, checked: [], failures: [], ms: Date.now() - began };
  }
  const extra = workflowProjects(read, list);
  const { workspaces: chosen, projects } = affected(files, ws, extra);
  if (!projects.length) return { ok: true, checked: [], failures: [], ms: Date.now() - began };

  const temp = mkdtempSync(join(tmpdir(), 'facemorph-typecheck-'));
  try {
    execFileSync('sh', ['-c', `git -C "$0" archive "$1" | tar -x -C "$2"`, root, head, temp]);
    // Installed dependencies from the checkout; workspace packages from the commit.
    const modules = join(temp, 'node_modules');
    mkdirSync(join(modules, '@facemorph'), { recursive: true });
    for (const name of readdirSync(join(root, 'node_modules'))) {
      if (name === '@facemorph') continue;
      symlinkSync(join(root, 'node_modules', name), join(modules, name));
    }
    for (const w of ws) {
      const short = w.name.replace('@facemorph/', '');
      if (w.name.startsWith('@facemorph/'))
        symlinkSync(join('..', '..', w.dir), join(modules, '@facemorph', short));
      if (existsSync(join(root, w.dir, 'node_modules')))
        symlinkSync(join(root, w.dir, 'node_modules'), join(temp, w.dir, 'node_modules'));
    }
    // Built declarations for every package a checked workspace reads, in dependency order, cached by tree hash.
    const byName = new Map(ws.map((w) => [w.name, w]));
    const needed = [];
    const visit = (name) => {
      const w = byName.get(name);
      if (!w || needed.includes(w)) return;
      for (const d of w.deps) visit(d);
      needed.push(w);
    };
    for (const w of chosen) for (const d of w.deps) visit(d);
    const tsc = join(root, 'node_modules/.bin/tsc');
    for (const w of needed) {
      if (!existsSync(join(temp, w.dir, 'tsconfig.build.json'))) continue;
      const tree = git('rev-parse', `${head}:${w.dir}`).trim();
      const kept = join(cache, `${w.name.replace('/', '+')}-${tree}`);
      if (!existsSync(join(kept, 'dist'))) {
        log(`building ${w.name} declarations for tree ${tree.slice(0, 12)}`);
        const built = await run(tsc, ['-p', 'tsconfig.build.json'], join(temp, w.dir));
        if (built.status !== 0)
          return {
            ok: false,
            checked: [`${w.dir}/tsconfig.build.json`],
            failures: [{ project: `${w.dir}/tsconfig.build.json`, output: built.output }],
            ms: Date.now() - began,
          };
        mkdirSync(kept, { recursive: true });
        cpSync(join(temp, w.dir, 'dist'), join(kept, 'dist'), { recursive: true });
      } else {
        rmSync(join(temp, w.dir, 'dist'), { recursive: true, force: true });
        cpSync(join(kept, 'dist'), join(temp, w.dir, 'dist'), { recursive: true });
      }
    }
    // Projects that only make sense with their workspace's own non-tsc steps are left to CI; every listed project
    // is a plain `tsc -p`.
    const present = projects.filter((p) => existsSync(join(temp, p)));
    const results = await pool(present, Math.max(2, Math.floor(cpus().length / 2)), async (p) => {
      const t = Date.now();
      const r = await run(tsc, ['-p', p, '--noEmit'], temp);
      log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${p} (${Date.now() - t} ms)`);
      return { project: p, ...r };
    });
    const failures = results
      .filter((r) => r.status !== 0)
      .map((r) => ({ project: r.project, output: r.output.split(temp + '/').join('') }));
    return { ok: !failures.length, checked: present, failures, ms: Date.now() - began };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export const DEFAULT_CACHE = join(homedir(), '.cache/facemorph-hooks/dist');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [head, base] = process.argv.slice(2);
  if (!head) {
    console.error('usage: typecheck.mjs <commit> [<base>]');
    process.exit(2);
  }
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const result = await typecheckCommit({
    root,
    head,
    base,
    cache: DEFAULT_CACHE,
    log: (line) => console.error(`typecheck: ${line}`),
  });
  for (const f of result.failures) process.stdout.write(`\n${f.project}\n${f.output}`);
  console.error(
    `typecheck: ${result.ok ? 'clean' : `${result.failures.length} project(s) failed`}: ${result.checked.length} project(s) in ${result.ms} ms`,
  );
  process.exit(result.ok ? 0 : 1);
}
