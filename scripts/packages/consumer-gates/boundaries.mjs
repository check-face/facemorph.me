#!/usr/bin/env node
// Package boundaries as a dependency-graph assertion over source (fm-7ge, gate 4). For every non-app workspace
// (a workspace outside apps/), over the code it ships: src/** and the top-level code files its package.json
// `files` lists (cloudflare-model-host's cloudflare.config.ts and vite.config.ts):
//   imports-app       a relative import that lands in apps/ or an app workspace, or a bare import of an app
//                     workspace's package name (@facemorph/web), any subpath. Type-only imports count.
//   escapes-package   a relative import that leaves the package root: another package is reached only by its
//                     declared name, never by path.
//   undeclared-workspace-dependency  a bare import of another workspace package the importer does not declare in
//                     dependencies, peerDependencies or optionalDependencies.
//   imports-react     a non-app package names react, react-dom, react-native, preact, scheduler or @types/react*.
// The stylegan-js engine (packages/stylegan-js/src/engine/**) and everything it reaches through relative imports:
//   engine-network-cache-import  a bare import of a network or cache module: @facemorph/browser-model-manager (its
//                     cache, shard store and acquisition live there), node:http/https/http2/net/tls/dgram/dns,
//                     node:fs, node:sqlite, undici, ws, node-fetch, cross-fetch, axios, ky, idb, idb-keyval, dexie,
//                     localforage.
//   engine-unlisted-import       any other bare import. The engine's allowlist is empty: it receives
//                     onnxruntime-web, the verified local reader and the GPU device from its caller. A non-literal
//                     import() (browserModuleHost importing a blob: URL of verified bytes) names no module; it is
//                     listed in the report (engineNonLiteralImports), not failed.
//   engine-network-cache-global  a network/storage global access in a reached file: fetch, XMLHttpRequest,
//                     WebSocket, EventSource, indexedDB, caches, localStorage, sessionStorage, navigator.storage
//                     (OPFS), directly or through globalThis/self/window (ast.mjs globalAccesses).
//   node scripts/packages/consumer-gates/boundaries.mjs [--root <repo>]   one JSON report; exit 0 clean, 1 findings.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalAccesses, lineOf, references } from './ast.mjs';

export const REACT = /^(?:react|react-dom|react-native|preact|scheduler|@types\/react(?:-dom)?)$/;
export const ENGINE = { package: '@facemorph/stylegan-js', dir: 'src/engine' };
export const ENGINE_ALLOWED_BARE = [];
export const NETWORK_CACHE_MODULES =
  /^(?:@facemorph\/browser-model-manager|(?:node:)?(?:https?|http2|net|tls|dgram|dns|fs|sqlite)|undici|ws|node-fetch|cross-fetch|axios|ky|idb|idb-keyval|dexie|localforage)(?:\/.*)?$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/;

export const packageName = (spec) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

function codeFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...codeFiles(p));
    else if (CODE.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** The workspaces of a repository root: [{dir, name, app, pkg}]. */
export function workspaces(root) {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return (rootPkg.workspaces ?? []).map((w) => {
    const dir = resolve(root, w);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { dir, name: pkg.name, app: inside(dir, join(root, 'apps')), pkg };
  });
}

/** The code a package ships from source: src/** plus top-level code files named in `files`. */
export function shippedSources(ws) {
  const top = (ws.pkg.files ?? [])
    .filter((f) => !f.includes('/') && CODE.test(f))
    .map((f) => join(ws.dir, f))
    .filter((f) => existsSync(f));
  return [...codeFiles(join(ws.dir, 'src')), ...top];
}

function resolveRelative(from, spec) {
  const p = resolve(dirname(from), spec);
  const candidates = [
    p,
    p.replace(/\.([cm]?)js$/, '.$1ts'),
    p.replace(/\.js$/, '.tsx'),
    `${p}.ts`,
    `${p}.tsx`,
    join(p, 'index.ts'),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const refsCache = new Map();
function fileRefs(file) {
  if (!refsCache.has(file)) {
    const text = readFileSync(file, 'utf8');
    refsCache.set(file, { text, refs: references(file, text) });
  }
  return refsCache.get(file);
}

/** Pure over the files under `root`. Returns {packages: [...], findings: [{rule, file, line, spec, detail}]}. */
export function checkBoundaries({ root }) {
  refsCache.clear();
  const all = workspaces(root);
  const apps = all.filter((w) => w.app);
  const appNames = new Set(apps.map((w) => w.name));
  const wsNames = new Set(all.map((w) => w.name));
  const findings = [];
  const rel = (f) => relative(root, f).split(sep).join('/');
  const add = (rule, file, text, ref, detail) =>
    findings.push({ rule, file: rel(file), line: lineOf(text, ref.start), spec: ref.spec, detail });
  const summary = [];

  for (const ws of all.filter((w) => !w.app)) {
    const declared = new Set(
      Object.keys({
        ...ws.pkg.dependencies,
        ...ws.pkg.peerDependencies,
        ...ws.pkg.optionalDependencies,
      }),
    );
    const files = shippedSources(ws);
    summary.push({ package: ws.name, files: files.length });
    for (const file of files) {
      const { text, refs } = fileRefs(file);
      for (const ref of refs) {
        const spec = ref.spec;
        if (spec === null) continue;
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          if (inside(target, join(root, 'apps')) || apps.some((a) => inside(target, a.dir)))
            add('imports-app', file, text, ref, `${spec} resolves into app code`);
          else if (!inside(target, ws.dir))
            add('escapes-package', file, text, ref, `${spec} leaves ${ws.name}`);
          continue;
        }
        if (spec.startsWith('/') || spec.startsWith('file:')) {
          add('escapes-package', file, text, ref, `${spec} is an absolute path`);
          continue;
        }
        const name = packageName(spec);
        if (appNames.has(name)) add('imports-app', file, text, ref, `${spec} is an app workspace`);
        else if (wsNames.has(name) && name !== ws.name && !declared.has(name))
          add(
            'undeclared-workspace-dependency',
            file,
            text,
            ref,
            `${ws.name} does not declare ${name}`,
          );
        if (REACT.test(name))
          add('imports-react', file, text, ref, `${ws.name} is not an app package`);
      }
    }

    if (ws.name !== ENGINE.package) continue;
    const engineDir = join(ws.dir, ENGINE.dir);
    const pending = codeFiles(engineDir);
    const reached = new Set(pending);
    const nonLiteral = [];
    while (pending.length) {
      const file = pending.pop();
      const { text, refs } = fileRefs(file);
      for (const ref of refs) {
        const spec = ref.spec;
        if (spec === null) {
          // Not a module the engine depends on: browserModuleHost's import(blobUrl) runs verified local bytes.
          // Listed in the report so a new one is visible in review.
          nonLiteral.push(`${rel(file)}:${lineOf(text, ref.start)}`);
          continue;
        }
        if (spec.startsWith('.')) {
          const target = resolveRelative(file, spec);
          if (target && inside(target, ws.dir) && !reached.has(target)) {
            reached.add(target);
            pending.push(target);
          }
          continue;
        }
        if (NETWORK_CACHE_MODULES.test(spec))
          add('engine-network-cache-import', file, text, ref, `the engine reaches ${spec}`);
        else if (!ENGINE_ALLOWED_BARE.includes(packageName(spec)))
          add(
            'engine-unlisted-import',
            file,
            text,
            ref,
            `${spec} is not on the engine's import allowlist${isBuiltin(spec) ? ' (Node builtin)' : ''}`,
          );
      }
      for (const g of globalAccesses(file, text))
        findings.push({
          rule: 'engine-network-cache-global',
          file: rel(file),
          line: lineOf(text, g.start),
          spec: null,
          detail: `${g.name} in a file the engine reaches`,
        });
    }
    Object.assign(
      summary.find((s) => s.package === ws.name),
      { engineReached: reached.size, engineNonLiteralImports: nonLiteral },
    );
  }
  return { packages: summary, findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = resolve(
    i > 0 ? process.argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '../../..'),
  );
  const r = checkBoundaries({ root });
  console.log(JSON.stringify({ event: 'package-boundaries', ok: r.findings.length === 0, ...r }));
  if (r.findings.length) process.exitCode = 1;
}
