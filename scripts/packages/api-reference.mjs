// Generates a package's API reference (docs/api.md) from its emitted .d.ts (bead fm-tohj).
// Every entry of package.json "exports" is loaded through the TypeScript 7 checker (the tsgo-backed
// `typescript/unstable/sync` API: TS 7 ships no in-process compiler API), and every symbol the checker
// reports as exported from the entry module (getExportsOfModule, so `export *` and type-only re-exports
// are included) is written with its kind, its declaration text from the .d.ts and its JSDoc.
//   node scripts/packages/api-reference.mjs [packageDir] [--out <file>] [--check]
// packageDir defaults to packages/stylegan-js and --out to <packageDir>/docs/api.md. The package must be
// built first (npm run build -w <packageDir>). --check regenerates in memory and exits 1 when the file
// differs, naming the exports that are missing from or extra in it.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, SymbolFlags } from 'typescript/unstable/sync';
import { SyntaxKind } from 'typescript/unstable/ast';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPT_PATH = 'scripts/packages/api-reference.mjs';

/** The exports-map entries of a package that declare types: [{ subpath, specifier, dts }]. */
export function entriesOf(packageDir) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const exportsMap = typeof pkg.exports === 'string' ? { '.': pkg.exports } : (pkg.exports ?? {});
  const entries = [];
  for (const [subpath, target] of Object.entries(exportsMap)) {
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    if (typeof types !== 'string') continue;
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
    entries.push({ subpath, specifier, dts: resolve(packageDir, types) });
  }
  return entries;
}

/**
 * Opens a throwaway tsgo project over the given .d.ts files and calls fn(project). The project's tsconfig
 * lives in a temporary directory so nothing is written into the package.
 */
export function withProject(dtsFiles, fn) {
  for (const file of dtsFiles) {
    if (!existsSync(file)) {
      throw new Error(
        `${file} is missing: build the package first (npm run build -w <packageDir>)`,
      );
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'api-reference-'));
  const api = new API({ cwd: dir });
  try {
    const config = join(dir, 'tsconfig.json');
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          lib: ['esnext', 'dom', 'webworker'],
          types: [],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
        },
        files: dtsFiles,
      }),
    );
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProjects()[0];
    if (!project) throw new Error('tsgo opened no project for the declaration files');
    return fn(project);
  } finally {
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The symbols the checker reports as exported from one entry .d.ts, by name. */
export function exportedSymbols(project, dts) {
  const sourceFile = project.program.getSourceFile(dts);
  if (!sourceFile) throw new Error(`${dts} is not in the program`);
  const moduleSymbol = project.checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`${dts} has no module symbol (is it a module?)`);
  return project.checker.getExportsOfModule(moduleSymbol);
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function kindOf(node) {
  switch (node.kind) {
    case SyntaxKind.FunctionDeclaration:
      return 'function';
    case SyntaxKind.ClassDeclaration:
      return 'class';
    case SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case SyntaxKind.EnumDeclaration:
      return 'enum';
    case SyntaxKind.ModuleDeclaration:
      return 'namespace';
    case SyntaxKind.SourceFile:
      return 'module';
    case SyntaxKind.VariableDeclaration: {
      const keyword = /\b(const|let|var)\b/.exec(node.parent?.getText() ?? '');
      return keyword ? keyword[1] : 'const';
    }
    default:
      return 'unknown';
  }
}

/** Declaration text as written in the .d.ts, without its leading JSDoc, whitespace-trimmed. */
function declarationText(node) {
  if (node.kind === SyntaxKind.SourceFile) {
    return `// namespace re-export of ${relative(REPO, node.fileName)}`;
  }
  if (node.kind === SyntaxKind.VariableDeclaration) {
    const list = node.parent;
    const statement = list?.parent;
    if (statement && list.declarations?.length === 1) return statement.getText().trim();
    return `declare ${kindOf(node)} ${node.getText().trim()};`;
  }
  return node.getText().trim();
}

function documentation(checker, symbol) {
  const text = checker.getDocumentationCommentOfSymbol(symbol).trim();
  const tags = checker
    .getJsDocTagsOfSymbol(symbol)
    .map((tag) => `@${tag.name}${tag.text ? ` ${tag.text.trim()}` : ''}`);
  return [text, ...tags].filter(Boolean).join('\n\n');
}

/** One entry per export: { name, kinds, declarations, doc }. */
export function describeEntry(project, dts) {
  const { checker } = project;
  return [...exportedSymbols(project, dts)].sort(byName).map((symbol) => {
    const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const nodes = target.declarations.map((handle) => handle.resolve()).filter(Boolean);
    const kinds = [...new Set(nodes.map(kindOf))];
    const declarations = [...new Set(nodes.map(declarationText))];
    return { name: symbol.name, kinds, declarations, doc: documentation(checker, target) };
  });
}

/** Renders the Markdown reference for every entry of the package. */
export function render(packageDir) {
  const entries = entriesOf(packageDir);
  const described = withProject(
    entries.map((entry) => entry.dts),
    (project) => entries.map((entry) => ({ ...entry, exports: describeEntry(project, entry.dts) })),
  );
  const pkgName = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).name;
  const out = [
    `# ${pkgName} API reference`,
    '',
    `Generated by \`${SCRIPT_PATH}\` from the emitted \`.d.ts\` of each \`exports\` entry. Do not edit by hand: rebuild the package and rerun the script.`,
    '',
    ...described.map(
      (entry) =>
        `- [\`${entry.specifier}\`](#${anchor(entry.specifier)}): ${entry.exports.length} exports`,
    ),
    '',
  ];
  for (const entry of described) {
    out.push(`## \`${entry.specifier}\``, '', `Types: \`${relative(packageDir, entry.dts)}\`.`, '');
    for (const item of entry.exports) {
      out.push(`### \`${item.name}\``, '', `Kind: ${item.kinds.join(', ')}`, '');
      for (const text of item.declarations) out.push('```ts', text, '```', '');
      if (item.doc) out.push(item.doc, '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function anchor(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}

/** Parses a rendered reference into Map<entry specifier, Set<export name>>. */
export function parseReference(markdown) {
  const sections = new Map();
  let current;
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    if (fence) continue;
    const entry = /^## `(.+)`$/.exec(line);
    if (entry) {
      current = new Set();
      sections.set(entry[1], current);
      continue;
    }
    const item = /^### `(.+)`$/.exec(line);
    if (item && current) current.add(item[1]);
  }
  return sections;
}

/** Lists `entry: name` exports present in one reference and absent from the other. */
export function differences(expected, actual) {
  const want = parseReference(expected);
  const have = parseReference(actual);
  const missing = [];
  const extra = [];
  for (const [entry, names] of want) {
    for (const name of names) if (!have.get(entry)?.has(name)) missing.push(`${entry}: ${name}`);
  }
  for (const [entry, names] of have) {
    for (const name of names) if (!want.get(entry)?.has(name)) extra.push(`${entry}: ${name}`);
  }
  return { missing, extra };
}

function main(argv) {
  let packageDir = 'packages/stylegan-js';
  let out;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') check = true;
    else if (arg === '--out') out = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else packageDir = arg;
  }
  packageDir = resolve(REPO, packageDir);
  out = out ? resolve(out) : join(packageDir, 'docs', 'api.md');
  const generated = render(packageDir);
  if (!check) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, generated);
    const counts = [...parseReference(generated)].map(([entry, names]) => `${entry} ${names.size}`);
    console.log(`api-reference: wrote ${relative(REPO, out)} (${counts.join(', ')})`);
    return 0;
  }
  const committed = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (committed === generated) {
    console.log(`api-reference: ${relative(REPO, out)} is current`);
    return 0;
  }
  const { missing, extra } = differences(generated, committed);
  console.error(`api-reference: ${relative(REPO, out)} is stale; rerun node ${SCRIPT_PATH}`);
  for (const name of missing) console.error(`  missing export ${name}`);
  for (const name of extra) console.error(`  extra export ${name}`);
  if (!missing.length && !extra.length)
    console.error('  (same exports; declarations or docs differ)');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
