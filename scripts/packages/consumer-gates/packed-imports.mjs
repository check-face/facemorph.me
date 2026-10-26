// Gate 1's static half (fm-7ge): the module references in what a package actually ships (an installed or unpacked
// tarball), checked for anything that only works inside this repository. Every code file is parsed (ast.mjs):
// emitted .js, .d.ts, and TS shipped as source (cloudflare-model-host's mirror worker and cf/vite configs).
//   absolute-specifier       '/x', 'file:', 'C:\x'
//   repository-alias         '~x' (apps/web's Vite alias), '@/x', or '#x' the package's `imports` does not declare
//   escapes-package          a relative reference (import or new URL(.., import.meta.url)) that leaves the package
//   missing-target           a relative reference to a file the package does not contain
//   repository-path          a specifier naming apps/ or packages/, or reaching into a @facemorph package's src/
//   imports-app              @facemorph/web, any subpath
//   undeclared-dependency    a bare package that is neither a Node builtin, the package itself, nor declared in
//                            dependencies/peerDependencies/optionalDependencies
//   ts-source-import         emitted .js naming a .ts/.tsx/.mts/.cts file (a build that kept source extensions)
// Exports: exportEntries() lists every subpath/condition target, and missingExportTargets() the ones the package
// lacks. The `source` condition (the workspace's own development condition, as the tarball content scan's
// exportsIgnoreConditions) is reported apart as `unpackedConditions` rather than failed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { lineOf, references } from './ast.mjs';
import { packageName } from './boundaries.mjs';

export const WORKSPACE_CONDITIONS = ['source'];
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

function files(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...files(dir, p));
    } else out.push(p);
  }
  return out.sort();
}

const exists = (p) => existsSync(p) && statSync(p).isFile();
function relativeTarget(dir, file, spec, declaration) {
  const p = resolve(dir, dirname(file), spec.split(/[?#]/)[0]);
  const tries = [p];
  if (declaration)
    // TypeScript maps both ./x.js and ./x.ts (rewriteRelativeImportExtensions keeps .ts in declarations) to ./x.d.ts.
    tries.push(p.replace(/\.([cm]?)[jt]sx?$/, '.d.$1ts'), `${p}.d.ts`, join(p, 'index.d.ts'));
  else if (/\.[cm]?ts$/.test(file)) tries.push(p.replace(/\.([cm]?)js$/, '.$1ts'), `${p}.ts`);
  return { path: p, found: tries.some(exists) };
}

/** Findings over an unpacked package directory `dir` with its package.json `pkg`. */
export function checkPackedImports({ dir, pkg }) {
  const declared = new Set(
    Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }),
  );
  const imports = Object.keys(pkg.imports ?? {});
  const findings = [];
  const scanned = [];
  for (const file of files(dir).filter((f) => CODE.test(f))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const declaration = /\.d\.[cm]?ts$/.test(file);
    const emitted = /\.[cm]?js$/.test(file);
    scanned.push(file);
    let refs;
    try {
      refs = references(file, text);
    } catch (e) {
      findings.push({ rule: 'unparseable', file, line: 0, spec: null, detail: e.message });
      continue;
    }
    for (const ref of refs) {
      const spec = ref.spec;
      if (spec === null) continue;
      const add = (rule, detail) =>
        findings.push({ rule, file, line: lineOf(text, ref.start), spec, detail });
      if (/^(?:\/|file:|[A-Za-z]:[\\/])/.test(spec)) {
        add('absolute-specifier', 'absolute path or file: URL');
        continue;
      }
      if (
        /^(?:~|@\/)/.test(spec) ||
        (spec.startsWith('#') && !imports.some((k) => matchesImport(k, spec)))
      ) {
        add('repository-alias', 'a repository path alias, not a package specifier');
        continue;
      }
      if (/^(?:data|blob|https?):/.test(spec)) continue;
      if (spec.startsWith('.') && ref.kind !== 'asset-url') {
        const t = relativeTarget(dir, file, spec, declaration);
        if (!inside(t.path, resolve(dir))) add('escapes-package', `${spec} leaves the package`);
        else if (!t.found) add('missing-target', `${spec} is not in the package`);
        if (emitted && /\.(?:tsx?|[cm]ts)$/.test(spec))
          add('ts-source-import', `${spec} is TypeScript source`);
        if (/(?:^|\/)(?:apps|packages)\//.test(spec))
          add('repository-path', 'names a repository directory');
        continue;
      }
      if (ref.kind === 'asset-url') {
        // new URL('worker.js', import.meta.url) without ./ is still relative to the module; it may name a
        // directory (cloudflare-model-host's package root as the cf project).
        const t = relativeTarget(dir, file, spec, false);
        if (!inside(t.path, resolve(dir))) add('escapes-package', `${spec} leaves the package`);
        else if (!existsSync(t.path)) add('missing-target', `${spec} is not in the package`);
        continue;
      }
      if (spec.startsWith('#')) continue; // a subpath import the package's `imports` declares (checked above)
      const name = packageName(spec);
      if (name === '@facemorph/web') add('imports-app', 'the app workspace');
      else if (
        /^(?:apps|packages)\//.test(spec) ||
        /^(?:@facemorph\/[^/]+|stylegan-js|browser-model-manager|cloudflare-model-host)\/src(?:\/|$)/.test(
          spec,
        )
      )
        add('repository-path', 'reaches into repository source');
      else if (!isBuiltin(spec) && name !== pkg.name && !declared.has(name))
        add('undeclared-dependency', `${name} is not declared by ${pkg.name}`);
    }
  }
  return { scanned, findings };
}

function matchesImport(key, spec) {
  if (!key.includes('*')) return key === spec;
  const [a, b] = key.split('*');
  return spec.startsWith(a) && spec.endsWith(b);
}

/** [{subpath, conditions: [..], target}] for every string target in `exports` (a string or sugar form included). */
export function exportEntries(pkg) {
  const out = [];
  let ex = pkg.exports;
  if (ex === undefined) return out;
  if (
    typeof ex === 'string' ||
    Array.isArray(ex) ||
    !Object.keys(ex).some((k) => k.startsWith('.'))
  )
    ex = { '.': ex };
  const walk = (subpath, v, conditions) => {
    if (typeof v === 'string') out.push({ subpath, conditions, target: v });
    else if (Array.isArray(v)) v.forEach((x) => walk(subpath, x, conditions));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) walk(subpath, x, [...conditions, k]);
  };
  for (const [subpath, v] of Object.entries(ex)) walk(subpath, v, []);
  return out;
}

/** Export targets missing from `dir`: {missing (failures), unpackedConditions (workspace-only, reported)}. */
export function missingExportTargets({ dir, pkg }) {
  const missing = [];
  const unpackedConditions = [];
  for (const e of exportEntries(pkg)) {
    if (e.target.includes('*')) continue;
    const path = resolve(dir, e.target);
    if (inside(path, resolve(dir)) && exists(path)) continue;
    const entry = {
      ...e,
      detail: inside(path, resolve(dir)) ? 'not in the package' : 'leaves the package',
    };
    if (e.conditions.some((c) => WORKSPACE_CONDITIONS.includes(c))) unpackedConditions.push(entry);
    else missing.push(entry);
  }
  return { missing, unpackedConditions };
}
