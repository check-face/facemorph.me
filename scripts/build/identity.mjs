#!/usr/bin/env node
// Build and snapshot identity (fm-pud, plan: build.identity-map). Pure hashing over files on disk; git only lists
// tracked files. Three parts:
// - roots: each workspace (apps/web and every package) hashed over its tracked files, the shared configs, its
//   transitive lockfile entries and the identities of the workspaces it depends on, so an edit anywhere in a root
//   (or in a workspace it uses) changes its identity. Each root records its exact required test invocation and
//   the workflows whose push paths select it.
// - workers: the two worker graphs (apps/web/build/worker-inventory.ts). Every emitted app worker and each local
//   chunk it imports transitively must exist and be hashed; every hosted pinned module must match its pin, and a
//   sibling it references by file name (WASM, codec, photo) must itself be pinned.
// - artifact: repository ID, commit, workflow/run and build identity for the artifact a lane serves. A control
//   artifact keeps classic's identity and its control label; this repository is never named as its source.
//   node scripts/build/identity.mjs                      roots and required checks, as JSON
//   node scripts/build/identity.mjs --changed <file>...  the roots and checks those changes select
//   node scripts/build/identity.mjs --workers <dist> --hosted <runtime dir>   worker graph findings
//   node scripts/build/identity.mjs --artifact <dir>     artifact identity for a deploy-next/ layout
//   node scripts/build/identity.mjs --coverage           every mapped path is selected by the shared path filters
// Exit 0 ok, 1 findings, 2 usage error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, matchesGlob, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from '../ci/fetch-artifact.ts';
import { WORKSPACES } from './check-scaffold.mjs';
import { runtimeIdentity } from '../../apps/web/build/runtime-identity.ts';
import { workerInventory } from '../../apps/web/build/worker-inventory.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const REPOSITORY_ID = 1413979666;
export const CLASSIC_REPOSITORY_ID = 295956585;
/** Files outside any workspace that every root's build and checks read. */
export const SHARED_CONFIGS = [
  'package.json',
  'tsconfig.base.json',
  'tsconfig.dom.json',
  'tsconfig.node.json',
  'tsconfig.worker.json',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  '.nvmrc',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Tracked files under `dir` (repository-relative), sorted. */
export function trackedFiles(root, dir) {
  const r = spawnSync('git', ['ls-files', '-z', '--', dir], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files ${dir}: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean).sort();
}

/** The lockfile entries a workspace resolves, transitively, keyed as in package-lock.json. Pure over the lock. */
export function lockClosure(lock, workspace) {
  const packages = lock.packages ?? {};
  const seen = new Map();
  const resolve = (from, name) => {
    // Node's lookup: <dir>/node_modules/<name> from the requiring package outwards, then the root.
    let at = from;
    for (;;) {
      const key = at ? `${at}/node_modules/${name}` : `node_modules/${name}`;
      if (packages[key]) return key;
      if (!at) return null;
      const nested = at.lastIndexOf('/node_modules/');
      at =
        nested >= 0
          ? at.slice(0, nested)
          : at.includes('/')
            ? at.slice(0, at.lastIndexOf('/'))
            : '';
    }
  };
  const visit = (key) => {
    if (seen.has(key)) return;
    const entry = packages[key];
    if (!entry) return;
    seen.set(key, entry);
    if (entry.link && entry.resolved) return; // a workspace link: its own root identity covers it
    const deps = {
      ...entry.dependencies,
      ...entry.devDependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const found = resolve(key, name);
      if (found) visit(found);
    }
  };
  visit(workspace);
  seen.delete(workspace);
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** Workspaces a root depends on (by name, from its package.json), as workspace directories. */
function workspaceDeps(root, dir, names) {
  const pkg = readJson(join(root, dir, 'package.json'));
  const deps = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  });
  return deps.map((d) => names.get(d)).filter(Boolean);
}

/** Workflows whose push `paths` select any of `files` (a workflow without paths selects everything). */
export function selectingWorkflows(root, files) {
  const dir = join(root, '.github/workflows');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    if (!/^\s*push:/m.test(text)) continue;
    const block =
      /^\s*push:[\s\S]*?^\s*paths:\s*\[([\s\S]*?)\]/m.exec(text) ??
      /^\s*push:[\s\S]*?^\s*paths:\s*\n((?:\s*-\s*.+\n)+)/m.exec(text);
    if (!block) {
      out.push(`.github/workflows/${name}`);
      continue;
    }
    const globs = [...block[1].matchAll(/['"]?([^'",\n\s-][^'",\n]*?)['"]?\s*(?:,|\n|$)/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    const include = globs.filter((g) => !g.startsWith('!'));
    if (files.some((f) => include.some((g) => matchesGlob(f, g))))
      out.push(`.github/workflows/${name}`);
  }
  return out;
}

/** Identity of every root. `files` maps a root to its file list (default: tracked files). */
export function rootIdentities(root = ROOT, { files = (dir) => trackedFiles(root, dir) } = {}) {
  const lock = readJson(join(root, 'package-lock.json'));
  const names = new Map(WORKSPACES.map((w) => [readJson(join(root, w, 'package.json')).name, w]));
  const shared = SHARED_CONFIGS.filter((f) => existsSync(join(root, f))).map(
    (f) => `${f} ${sha256(readFileSync(join(root, f)))}`,
  );
  const memo = new Map();
  const identity = (dir, stack = []) => {
    if (memo.has(dir)) return memo.get(dir);
    if (stack.includes(dir)) throw new Error(`workspace cycle: ${[...stack, dir].join(' -> ')}`);
    const list = files(dir).filter(
      (f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile(),
    );
    const own = list.map((f) => `${f} ${sha256(readFileSync(join(root, f)))}`);
    const locked = lockClosure(lock, dir).map(
      ([k, e]) => `${k} ${e.version ?? ''} ${e.integrity ?? e.resolved ?? ''}`,
    );
    const deps = workspaceDeps(root, dir, names).map(
      (d) => `${d} ${identity(d, [...stack, dir]).digest}`,
    );
    const pkg = readJson(join(root, dir, 'package.json'));
    const test = pkg.scripts?.test ? `npm test -w ${dir}  # ${pkg.scripts.test}` : null;
    const lines = [
      ...shared.map((l) => `shared ${l}`),
      ...own.map((l) => `file ${l}`),
      ...locked.map((l) => `lock ${l}`),
      ...deps.map((l) => `workspace ${l}`),
      `test ${test}`,
    ];
    const result = {
      digest: sha256(`${lines.join('\n')}\n`),
      files: own.length,
      lockEntries: locked.length,
      workspaces: deps.map((l) => l.split(' ')[0]),
      test,
      workflows: selectingWorkflows(root, list),
    };
    memo.set(dir, result);
    return result;
  };
  const roots = Object.fromEntries(WORKSPACES.map((w) => [w, identity(w)]));
  return {
    schema: 'facemorph.build-identity/1',
    roots,
    digest: sha256(
      Object.entries(roots)
        .map(([w, r]) => `${w} ${r.digest}`)
        .join('\n'),
    ),
  };
}

/** The roots and required checks a set of changed files selects: the roots containing them and their dependents. */
export function selectChecks(identities, changed) {
  const direct = Object.keys(identities.roots).filter((w) =>
    changed.some((f) => f === w || f.startsWith(`${w}/`)),
  );
  const sharedHit = changed.some((f) => SHARED_CONFIGS.includes(f) || f === 'package-lock.json');
  const selected = new Set(sharedHit ? Object.keys(identities.roots) : direct);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [w, r] of Object.entries(identities.roots))
      if (!selected.has(w) && r.workspaces.some((d) => selected.has(d))) {
        selected.add(w);
        grew = true;
      }
  }
  const roots = [...selected].sort();
  return {
    roots,
    tests: roots.map((w) => identities.roots[w].test).filter(Boolean),
    workflows: [...new Set(roots.flatMap((w) => identities.roots[w].workflows))].sort(),
  };
}

/**
 * Paths the identity maps that no push filter would select: each must match the shared path-filter list
 * (scripts/ci/path-filters.json), so a change that alters an identity always triggers the lanes that check it.
 */
export function uncoveredPaths(root, identities, shared) {
  const mapped = [
    ...SHARED_CONFIGS,
    'package-lock.json',
    ...Object.keys(identities.roots).flatMap((w) => trackedFiles(root, w)),
  ];
  // GitHub's path filters let ** match dot-files (apps/web/.gitignore); Node's matchesGlob does not, so a path is
  // also tried with its leading dots masked.
  const dotless = (f) => f.replace(/(^|\/)\./g, '$1_');
  return mapped.filter(
    (f) =>
      existsSync(join(root, f)) &&
      !shared.some((g) => matchesGlob(f, g) || matchesGlob(dotless(f), g)),
  );
}

// ---- Worker graphs.
const RELATIVE_IMPORT =
  /(?:\b(?:import|export)\s*(?:[\w*${}\s,]+\s*from\s*)?|\bimport\s*\(\s*|new\s+URL\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SIBLING_NAME = /["']([\w.-]+\.(?:m?js|wasm))["']/g;

/** Local files an emitted chunk imports or loads by relative URL, resolved inside `dist`. */
export function chunkImports(dist, file) {
  const text = readFileSync(join(dist, file), 'utf8');
  return [
    ...new Set(
      [...text.matchAll(RELATIVE_IMPORT)].map((m) =>
        posix.normalize(posix.join(posix.dirname(file), m[1].split(/[?#]/)[0])),
      ),
    ),
  ];
}

/**
 * A pinned file above the static file limit is published only as chunks: rebuild it from the runtime manifest's
 * chunk list for the asset with that digest, or null when the tree has neither.
 */
function fromChunks(hostedRoot, digest) {
  const manifest = join(hostedRoot, 'manifest.json');
  if (!existsSync(manifest)) return null;
  let found = null;
  const walk = (v) => {
    if (found || typeof v !== 'object' || v === null) return;
    if (v.sha256 === digest && Array.isArray(v.chunks)) found = v.chunks;
    else Object.values(v).forEach(walk);
  };
  walk(readJson(manifest));
  if (!found) return null;
  const parts = found.map((c) =>
    join(hostedRoot, new URL(c.url).pathname.replace(/^\/runtime\//, '')),
  );
  return parts.every((f) => existsSync(f))
    ? Buffer.concat(parts.map((f) => readFileSync(f)))
    : null;
}

/**
 * Findings for both graphs. `inventory` is apps/web's dist/worker-inventory.json; `pinned` the hosted pins
 * ({path, sha256}); `hostedRoot` the acquired runtime tree they resolve in (omit to skip the hosted bytes).
 * Returns the findings and every emitted file in the transitive closure with its digest.
 */
export function workerFindings({ dist, inventory, pinned, hostedRoot }) {
  const findings = [];
  const sortedPins = (rows) =>
    rows
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    !Array.isArray(inventory.hosted) ||
    JSON.stringify(sortedPins(inventory.hosted)) !== JSON.stringify(sortedPins(pinned))
  )
    findings.push({
      graph: 'hosted',
      path: 'worker-inventory.json',
      problem: 'hosted inventory differs from the trusted expected pins',
    });
  if (
    Array.isArray(inventory.hosted) &&
    workerInventory(inventory.emitted, inventory.hosted).identity !== inventory.identity
  )
    findings.push({
      graph: 'inventory',
      path: 'worker-inventory.json',
      problem: 'inventory identity does not follow from its emitted and hosted lists',
    });
  const closure = new Map();
  const walk = (file, from) => {
    if (closure.has(file)) return;
    if (!existsSync(join(dist, file))) {
      findings.push({
        graph: 'emitted',
        path: file,
        problem: `imported by ${from} but not in the build output`,
      });
      return;
    }
    closure.set(file, sha256(readFileSync(join(dist, file))));
    for (const next of chunkImports(dist, file)) walk(next, file);
  };
  for (const w of inventory.emitted) {
    const actual = existsSync(join(dist, w.file)) ? sha256(readFileSync(join(dist, w.file))) : null;
    if (actual !== w.sha256)
      findings.push({
        graph: 'emitted',
        path: w.file,
        problem: `hashes ${actual ?? 'missing'}, pinned ${w.sha256}`,
      });
    walk(w.file, w.source);
  }
  if (hostedRoot) {
    const pins = new Map(pinned.map((p) => [p.path, p.sha256]));
    for (const p of pinned) {
      const full = join(hostedRoot, p.path);
      const bytes = existsSync(full) ? readFileSync(full) : fromChunks(hostedRoot, p.sha256);
      if (!bytes) {
        findings.push({
          graph: 'hosted',
          path: p.path,
          problem: 'pinned but absent from the runtime tree',
        });
        continue;
      }
      if (sha256(bytes) !== p.sha256)
        findings.push({
          graph: 'hosted',
          path: p.path,
          problem: `hashes ${sha256(bytes)}, pinned ${p.sha256}`,
        });
      if (!/\.m?js$/.test(p.path)) continue;
      const dir = posix.dirname(p.path);
      for (const m of bytes.toString('utf8').matchAll(SIBLING_NAME)) {
        const sibling = posix.join(dir, m[1]);
        if (sibling !== p.path && existsSync(join(hostedRoot, sibling)) && !pins.has(sibling))
          findings.push({
            graph: 'hosted',
            path: sibling,
            problem: `loaded by ${p.path} but not pinned`,
          });
      }
    }
  }
  const emitted = [...closure]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, digest]) => ({ path, sha256: digest }));
  return { findings, emitted };
}

/** The CLI trusts reviewed runtime composition, never the built inventory as the source of expected pins. */
export function workerReport({ dist, hostedRoot, root = ROOT }) {
  const inventory = readJson(join(dist, 'worker-inventory.json'));
  const pinned = runtimeIdentity(root).hosted;
  return {
    ...workerFindings({ dist, inventory, pinned, ...(hostedRoot ? { hostedRoot } : {}) }),
    hosted: pinned.length,
  };
}

// ---- Artifact identity.
/** The identity a lane records for the artifact it serves: a deploy-next/ layout with next-site-identity.json. */
export function artifactIdentity(dir, { env = process.env, build = null } = {}) {
  const site = readJson(join(dir, 'next-site-identity.json'));
  const run = {
    workflow: env.GITHUB_WORKFLOW ?? null,
    runId: env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ID) : null,
  };
  // The same tree digest the shared fetch-artifact action reports (scripts/ci/fetch-artifact.ts), so the two agree.
  const artifactDigest = existsSync(join(dir, 'deploy-next'))
    ? treeDigest(join(dir, 'deploy-next'))
    : null;
  if (site.kind === 'control')
    return {
      kind: 'control',
      label: site.label,
      repositoryId: CLASSIC_REPOSITORY_ID,
      repository: site.deploySource.repository,
      commit: site.deploySource.commit,
      workflowRun: {
        workflow: site.deploySource.workflow ?? 'next-site.yml',
        runId: site.deploySource.run ?? site.deploySource.runId ?? null,
      },
      buildIdentity: site.deploySource.buildId ?? null,
      artifactDigest,
      assembledBy: {
        repositoryId: REPOSITORY_ID,
        commit: site.assembledBy?.commit ?? null,
        ...run,
      },
    };
  return {
    kind: site.kind,
    label: site.label ?? null,
    repositoryId: REPOSITORY_ID,
    repository: site.deploySource?.repository ?? null,
    commit: site.deploySource?.commit ?? null,
    workflowRun: run,
    buildIdentity: build ?? site.buildIdentity ?? null,
    artifactDigest,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  if (argv.includes('--workers')) {
    const dist = arg('--workers');
    const hosted = arg('--hosted');
    if (!dist) process.exit(2);
    const r = workerReport({ dist, ...(hosted ? { hostedRoot: hosted } : {}) });
    for (const f of r.findings) console.log(JSON.stringify(f));
    console.log(
      JSON.stringify({
        summary: {
          emitted: r.emitted.length,
          hosted: hosted ? r.hosted : 'not checked',
          findings: r.findings.length,
        },
      }),
    );
    process.exit(r.findings.length ? 1 : 0);
  }
  if (argv.includes('--artifact')) {
    console.log(
      JSON.stringify(
        artifactIdentity(arg('--artifact') ?? ROOT, { build: rootIdentities().digest }),
      ),
    );
    process.exit(0);
  }
  const identities = rootIdentities();
  if (argv.includes('--coverage')) {
    const shared = readJson(join(ROOT, 'scripts/ci/path-filters.json')).shared;
    const missing = uncoveredPaths(ROOT, identities, shared);
    console.log(JSON.stringify({ mapped: 'roots and shared configs', uncovered: missing }));
    process.exit(missing.length ? 1 : 0);
  }
  if (argv.includes('--changed')) {
    const changed = argv.slice(argv.indexOf('--changed') + 1).filter((a) => !a.startsWith('--'));
    console.log(JSON.stringify(selectChecks(identities, changed)));
  } else console.log(JSON.stringify(identities));
}
