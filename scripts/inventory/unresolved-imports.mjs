#!/usr/bin/env node
// Lists every module specifier in the imported closure that does not resolve inside it, and compares the
// list with import/allowlist.json `unresolved_imports` (expected: exactly the bridge's Fable import).
// Static imports and re-exports come from V8's own module parser (vm.SourceTextModule); dynamic
// `import('…')`, `new Worker(new URL('…', import.meta.url))` and CommonJS `require('…')` with literal
// specifiers are read by pattern. Relative specifiers must name a file in the closure (query and hash
// dropped); `/…` resolves from the app root; a bare specifier resolves if it is a Node builtin or its
// package is in the lock.
//   node scripts/inventory/unresolved-imports.mjs [--classic <dir>]        the allowlist, from Git objects
//   node scripts/inventory/unresolved-imports.mjs --root <dir> [--lock <package-lock.json>] [--expect-none]
//                                                                          a tree on disk (apps/web after import)
// --file-refs also prints `new URL('…', import.meta.url)` file references that do not resolve (they are
// reads, not imports, and do not affect the exit code). One JSON line per finding, then a summary; exit 1
// when the unresolved list differs from the expected one or a module does not parse.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ALLOWLIST, blob, classicDir, line, options, readJson } from './lib.mjs';

const MODULE = /\.(mjs|js)$/;
const SCANNED = /\.(mjs|js|cjs|html|scss)$/;

function staticSpecifiers(source, identifier) {
  const module = new vm.SourceTextModule(source, { identifier });
  return module.moduleRequests?.map((r) => r.specifier) ?? module.dependencySpecifiers;
}

const literal = (re, source) => [...source.matchAll(re)].map((m) => m[2]);
const DYNAMIC = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;
const WORKER = /\bnew\s+(?:Shared)?Worker\(\s*new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const REQUIRE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
const FILE_REF = /\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SASS = /^\s*@(?:import|use|forward)\s+(['"])([^'"]+)\1/gm;

// An html-webpack-plugin page is a lodash template: `<% code %>`, `<%= value %>`, `<%- escaped %>`.
// Rendering it with the build's options yields the page the build emits.
export function renderTemplate(source, templateOptions) {
  let body = "let __p = '';\n";
  let at = 0;
  for (const m of source.matchAll(/<%([=-]?)([\s\S]+?)%>/g)) {
    body += `__p += ${JSON.stringify(source.slice(at, m.index))};\n`;
    body += m[1] ? `__p += String((${m[2]}) ?? '');\n` : `${m[2]}\n`;
    at = m.index + m[0].length;
  }
  body += `__p += ${JSON.stringify(source.slice(at))};\n__p`;
  return new vm.Script(body).runInNewContext({ htmlWebpackPlugin: { options: templateOptions } });
}

// Every specifier a file uses, as {specifier, kind}; file references are kind 'file-ref'.
export function specifiers(path, input, page = {}) {
  const source = page.template_options ? renderTemplate(input, page.template_options) : input;
  const out = [];
  const add = (kind, list) => list.forEach((specifier) => out.push({ specifier, kind }));
  const ofModule = (code, id) => {
    add('static', staticSpecifiers(code, id));
    add('dynamic', literal(DYNAMIC, code));
    const workers = literal(WORKER, code);
    add('worker', workers);
    add('file-ref', literal(FILE_REF, code).filter((s) => !workers.includes(s)));
  };
  if (path.endsWith('.cjs')) add('require', literal(REQUIRE, source));
  else if (path.endsWith('.scss')) add('scss', literal(SASS, source));
  else if (path.endsWith('.html')) {
    for (const [, attrs, body] of source.matchAll(SCRIPT)) {
      const src = attrs.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/);
      if (src) add('script', [src[2]]);
      else if (/\btype\s*=\s*(['"])module\1/.test(attrs)) ofModule(body, path);
    }
  } else if (MODULE.test(path)) ofModule(source, path);
  return out;
}

// Package names a lockfile (v1-v3) installs.
export function lockPackages(lock) {
  const names = new Set(Object.keys(lock?.dependencies ?? {}));
  for (const key of Object.keys(lock?.packages ?? {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at >= 0) names.add(key.slice(at + 'node_modules/'.length));
  }
  return names;
}

// Sass loads `x` as x, x.scss, _x.scss, x.css or x/_index.scss, relative to the importing file first;
// webpack's sass-loader reads `~pkg/…` from node_modules.
const sassCandidates = (path) => {
  const dir = posix.dirname(path);
  const base = posix.basename(path);
  return [path, `${path}.scss`, posix.join(dir, `_${base}.scss`), `${path}.css`, posix.join(path, '_index.scss')];
};

// null when the specifier resolves, otherwise the reason it does not.
export function resolveSpecifier(importer, specifier, files, packages, kind = 'static') {
  const target = specifier.replace(/[?#].*$/, '');
  const bare = (spec) => {
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return packages.has(name) ? null : 'package-not-in-lock';
  };
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('node:')) return 'url';
  if (kind === 'scss') {
    if (target.startsWith('~')) return bare(target.slice(1));
    const local = sassCandidates(posix.join(posix.dirname(importer), target)).some((p) => files.has(p));
    return local ? null : bare(target);
  }
  if (target.startsWith('node:') || isBuiltin(target)) return null;
  if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) {
    const path = target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.join(posix.dirname(importer), target);
    return files.has(path) ? null : 'missing-file';
  }
  return bare(target);
}

// files: Map of app-root-relative path → source text; pages: {path: {served_at?, template_options?}} for
// HTML pages served from somewhere other than their file location or rendered as templates.
export function unresolvedImports(files, packages, pages = {}) {
  const unresolved = [];
  const fileRefs = [];
  const parseErrors = [];
  let count = 0;
  const known = new Set(files.keys());
  for (const [path, source] of files) {
    if (!SCANNED.test(path)) continue;
    const page = pages[path] ?? {};
    let found;
    try { found = specifiers(path, source, page); } catch (error) { parseErrors.push({ file: path, error: error.message }); continue; }
    for (const { specifier, kind } of found) {
      count++;
      const reason = resolveSpecifier(page.served_at ?? path, specifier, known, packages, kind);
      if (!reason) continue;
      (kind === 'file-ref' ? fileRefs : unresolved).push({ importer: path, specifier, kind, reason });
    }
  }
  return { unresolved, fileRefs, parseErrors, specifiers: count };
}

function walk(root, dir = root, out = new Map()) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(root, path, out);
    else out.set(relative(root, path).split('\\').join('/'), SCANNED.test(entry) ? readFileSync(path, 'utf8') : '');
  }
  return out;
}

const key = (r) => `${r.importer} → ${r.specifier}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!vm.SourceTextModule) {
    // V8's module parser is behind a flag; re-run with it rather than guessing at syntax.
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  const opts = options(process.argv.slice(2), { allowlist: ALLOWLIST });
  const allowlist = readJson(opts.allowlist);
  const prefix = allowlist.destination_root;
  let files;
  let lock;
  if (opts.root) {
    files = walk(opts.root);
    lock = readJson(opts.lock ?? join(opts.root, 'package-lock.json'));
  } else {
    const dir = classicDir(opts);
    const commit = allowlist.source.frozen_commit;
    const strip = (p) => p.slice(prefix.length + 1);
    files = new Map(allowlist.files.map((f) => [strip(f.destination), SCANNED.test(f.source) ? blob(dir, commit, f.source).toString('utf8') : '']));
    lock = JSON.parse(blob(dir, commit, 'package-lock.json').toString('utf8'));
  }
  const result = unresolvedImports(files, lockPackages(lock), allowlist.html_pages);
  const withPrefix = (r) => ({ ...r, importer: `${prefix}/${r.importer}` });
  const expected = new Set(opts['expect-none'] ? [] : allowlist.unresolved_imports.map(key));
  const found = result.unresolved.map(withPrefix);
  for (const r of found) line({ ...r, expected: expected.has(key(r)) });
  for (const e of result.parseErrors) line({ parse_error: e });
  if (opts['file-refs']) for (const r of result.fileRefs) line({ file_ref: withPrefix(r) });
  const unexpected = found.filter((r) => !expected.has(key(r))).length;
  const missingExpected = [...expected].filter((k) => !found.some((r) => key(r) === k));
  for (const k of missingExpected) line({ expected_but_resolved: k });
  line({ summary: { files: files.size, specifiers: result.specifiers, unresolved: found.length, unexpected, missing_expected: missingExpected.length, parse_errors: result.parseErrors.length, unresolved_file_refs: result.fileRefs.length } });
  process.exit(unexpected || missingExpected.length || result.parseErrors.length ? 1 : 0);
}
