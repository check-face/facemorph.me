// Self-test for api-reference.mjs (bead fm-tohj, "API reference covers every public export").
// Enumerates each exports entry's names independently through the TS 7 checker (getExportsOfModule on the
// entry source file's module symbol) and compares them with the committed packages/stylegan-js/docs/api.md;
// then runs the script's --check as a real subprocess on the committed file and on a temp copy with one
// export's section removed. Builds the package first when dist/ is missing.
//   node --test scripts/packages/api-reference.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'packages', 'api-reference.mjs');
const PACKAGE = join(REPO, 'packages', 'stylegan-js');
const API_MD = join(PACKAGE, 'docs', 'api.md');
const work = mkdtempSync(join(tmpdir(), 'api-reference-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
const entries = Object.entries(pkg.exports).map(([subpath, target]) => ({
  specifier: subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
  dts: join(PACKAGE, target.types),
}));

/** Map<entry specifier, string[]> straight from the checker, sharing no code with the script. */
function checkerExports() {
  const config = join(mkdtempSync(join(work, 'tsproject-')), 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        types: [],
      },
      files: entries.map((entry) => entry.dts),
    }),
  );
  const api = new API({ cwd: dirname(config) });
  try {
    const [project] = api.updateSnapshot({ openProjects: [config] }).getProjects();
    const result = new Map();
    for (const entry of entries) {
      const moduleSymbol = project.checker.getSymbolAtLocation(
        project.program.getSourceFile(entry.dts),
      );
      const names = project.checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name);
      result.set(entry.specifier, names);
    }
    return result;
  } finally {
    api.close();
  }
}

/** Map<entry specifier, string[]> of `### ` entry headings under each `## ` section of api.md. */
function documented(markdown) {
  const sections = new Map();
  let current;
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    if (fence) continue;
    if (line.startsWith('## ')) sections.set(line.slice(3).replaceAll('`', ''), (current = []));
    else if (line.startsWith('### ') && current) current.push(line.slice(4).replaceAll('`', ''));
  }
  return sections;
}

const runScript = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

describe('api-reference', () => {
  let actual;
  let committed;
  before(() => {
    if (entries.some((entry) => !existsSync(entry.dts))) {
      const build = spawnSync('npm', ['run', 'build', '-w', 'packages/stylegan-js'], {
        cwd: REPO,
        encoding: 'utf8',
      });
      assert.equal(build.status, 0, `package build failed:\n${build.stdout}\n${build.stderr}`);
    }
    actual = checkerExports();
    committed = documented(readFileSync(API_MD, 'utf8'));
  });

  test('every exports entry has a section and every exported name an entry under it', () => {
    assert.deepEqual([...committed.keys()].sort(), [...actual.keys()].sort());
    for (const [specifier, names] of actual) {
      assert.ok(names.length > 0, `${specifier} exports nothing`);
      const headings = new Set(committed.get(specifier));
      const missing = names.filter((name) => !headings.has(name));
      assert.deepEqual(missing, [], `${specifier}: exports missing from api.md`);
    }
  });

  test('no entry is listed that its entry point does not export, and none twice', () => {
    for (const [specifier, headings] of committed) {
      const names = new Set(actual.get(specifier));
      const extra = headings.filter((heading) => !names.has(heading));
      assert.deepEqual(extra, [], `${specifier}: api.md lists names that are not exported`);
      assert.equal(new Set(headings).size, headings.length, `${specifier}: duplicate headings`);
    }
  });

  test('--check passes on the committed api.md', () => {
    const run = runScript('--check');
    assert.equal(run.status, 0, run.stderr);
  });

  test('--check fails, naming the export, when one export section is removed', () => {
    const markdown = readFileSync(API_MD, 'utf8');
    const name = actual.get(entries[0].specifier)[0];
    const heading = `### \`${name}\`\n`;
    const start = markdown.indexOf(heading);
    assert.ok(start >= 0, `no heading for ${name}`);
    const next = markdown.indexOf('\n### ', start + heading.length);
    const stale = markdown.slice(0, start) + markdown.slice(next + 1);
    const out = join(work, 'stale-api.md');
    writeFileSync(out, stale);
    const run = runScript('--check', '--out', out);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, new RegExp(`missing export ${entries[0].specifier}: ${name}\\b`));
  });
});
