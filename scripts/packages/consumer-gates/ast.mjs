// Module references and network/storage global accesses in one JS/TS file, from the Oxc parser rolldown ships
// (fm-7ge package consumer gates). Shared by the source boundary assertion (boundaries.mjs) and the packed-import
// check (packed-imports.mjs), so both read the same parse rather than two regexes.
//
// references(): every module a file names: static import/export-from (type-only included: a type import of app
// code is still an app dependency), import(), TS import types, require(), `import x = require()`, and asset URLs
// `new URL('<literal>', import.meta.url)` (the pattern bundlers turn into an emitted worker/asset). A non-literal
// import()/require() argument is reported with spec null.
//
// globalAccesses(): every runtime use of a network or storage global name (`fetch(u)`, `new WebSocket(u)`,
// `indexedDB.open()`, `[caches]`, `navigator.storage.getDirectory()`, `globalThis.fetch`, `const f = fetch`). A
// property named `fetch` (`o.fetch`, `{ fetch: 1 }`, a class member) and anything in a type are not. A local binding
// of one of these names (a parameter called fetch) is reported too: the engine rule fails closed on the names.
import { parseSync } from 'rolldown/utils';

export const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
export const STORAGE_GLOBALS = ['indexedDB', 'caches', 'localStorage', 'sessionStorage'];
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window']);
const WATCHED = new Set([...NETWORK_GLOBALS, ...STORAGE_GLOBALS]);

export function parse(filename, text) {
  const r = parseSync(filename, text, {});
  const errors = r.errors.filter((e) => e.severity === 'Error');
  // A .d.ts may legitimately hold forms the ambient checker flags; only fail on a syntax error elsewhere.
  if (errors.length && !/\.d\.[cm]?ts$/.test(filename))
    throw new Error(`${filename}: ${errors[0].message}`);
  return r.program;
}

const literal = (n) => {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0)
    return n.quasis.map((q) => q.value.cooked).join('');
  return null;
};

const isImportMetaUrl = (n) =>
  n?.type === 'MemberExpression' &&
  n.object?.type === 'MetaProperty' &&
  n.object.meta?.name === 'import' &&
  n.property?.name === 'url';

/** Depth-first walk calling visit(node, parent, key) for every AST node; a visit returning false prunes. */
export function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit, parent, key);
    return;
  }
  if (typeof node.type !== 'string') return;
  if (visit(node, parent, key) === false) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'start' || k === 'end' || k === 'type') continue;
    if (v && typeof v === 'object') walk(v, visit, node, k);
  }
}

/** [{spec: string|null, kind, typeOnly, start}] for every module reference in the file. */
export function references(filename, text) {
  const program = parse(filename, text);
  const out = [];
  const add = (spec, kind, node, typeOnly = false) =>
    out.push({ spec, kind, typeOnly, start: node.start });
  walk(program, (n) => {
    switch (n.type) {
      case 'ImportDeclaration':
        add(n.source.value, 'import', n, n.importKind === 'type');
        break;
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        if (n.source) add(n.source.value, 'export', n, n.exportKind === 'type');
        break;
      case 'ImportExpression':
        add(literal(n.source), 'dynamic-import', n);
        break;
      case 'TSImportType':
        add(literal(n.source) ?? literal(n.argument?.literal) ?? null, 'type-import', n, true);
        break;
      case 'TSExternalModuleReference':
        add(literal(n.expression), 'import-equals', n);
        break;
      case 'CallExpression':
        if (n.callee?.type === 'Identifier' && n.callee.name === 'require')
          add(literal(n.arguments[0]), 'require', n);
        break;
      case 'NewExpression':
        if (
          n.callee?.type === 'Identifier' &&
          n.callee.name === 'URL' &&
          isImportMetaUrl(n.arguments[1])
        ) {
          const spec = literal(n.arguments[0]);
          if (spec !== null) add(spec, 'asset-url', n);
        }
        break;
    }
  });
  return out;
}

/** TS nodes that hold runtime expressions; every other TS* node is type-only and pruned. */
const TS_RUNTIME = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
  'TSParameterProperty',
  'TSEnumDeclaration',
  'TSEnumBody',
  'TSEnumMember',
  'TSModuleDeclaration',
  'TSModuleBlock',
  'TSExportAssignment',
]);
const KEYED = new Set(['Property', 'MethodDefinition', 'PropertyDefinition', 'AccessorProperty']);

/** [{name, start}] for network/storage global accesses (see the header). */
export function globalAccesses(filename, text) {
  const program = parse(filename, text);
  const out = [];
  const watchedId = (n) => n?.type === 'Identifier' && WATCHED.has(n.name);
  walk(program, (n, parent, key) => {
    if (n.type.startsWith('TS') && !TS_RUNTIME.has(n.type)) return false;
    if (n.type === 'Identifier' && WATCHED.has(n.name)) {
      const name =
        (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (KEYED.has(parent?.type) && key === 'key' && !parent.computed);
      if (!name) out.push({ name: n.name, start: n.start });
    }
    if (n.type === 'MemberExpression' && !n.computed) {
      const obj = n.object;
      if (obj?.type === 'Identifier' && GLOBAL_OBJECTS.has(obj.name) && watchedId(n.property))
        out.push({ name: `${obj.name}.${n.property.name}`, start: n.start });
      if (obj?.type === 'Identifier' && obj.name === 'navigator' && n.property?.name === 'storage')
        out.push({ name: 'navigator.storage', start: n.start });
      if (
        obj?.type === 'MemberExpression' &&
        obj.object?.type === 'Identifier' &&
        GLOBAL_OBJECTS.has(obj.object.name) &&
        obj.property?.name === 'navigator' &&
        n.property?.name === 'storage'
      )
        out.push({ name: `${obj.object.name}.navigator.storage`, start: n.start });
    }
  });
  return out;
}

/** 1-based line of a character offset. */
export const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
