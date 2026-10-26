// Gate 1's packed-import check (fm-7ge) against planted package directories: repository aliases, paths out of the
// package, app imports, undeclared dependencies and missing export targets fail; a clean package passes; and a
// seeded repository-alias import fails the packed-package gate end to end (npm pack, fresh consumer install).
//   node --test scripts/packages/consumer-gates/packed-imports.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { checkPackedImports, missingExportTargets } from './packed-imports.mjs';
import { gateInstalledPackage, installConsumer, pack } from './run.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

const PKG = {
  name: '@planted/lib',
  version: '0.0.0',
  type: 'module',
  exports: {
    '.': { source: './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' },
    './worker': { types: './dist/worker.d.ts', default: './dist/worker.js' },
  },
  dependencies: { 'planted-dep': '^1.0.0' },
  files: ['dist'],
};

function plant(files, pkg = PKG) {
  const dir = temp('packed-');
  const all = {
    'package.json': JSON.stringify(pkg),
    'dist/index.js':
      "import { a } from './util.js';\nimport dep from 'planted-dep/sub';\nimport { readFileSync } from 'node:fs';\nexport const w = new URL('./worker.js', import.meta.url);\nexport { a, dep, readFileSync };\n",
    'dist/index.d.ts': "export { a } from './util.ts';\nexport declare const w: URL;\n",
    'dist/util.js': 'export const a = 1;\n',
    'dist/util.d.ts': 'export declare const a = 1;\n',
    'dist/worker.js': 'export const worker = true;\n',
    'dist/worker.d.ts': 'export declare const worker = true;\n',
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return { dir, pkg };
}

const rules = (p) => checkPackedImports(p).findings.map((f) => `${f.rule} ${f.file} ${f.spec}`);

test('a clean package: no findings; the unpacked source condition is reported apart', () => {
  const p = plant({});
  assert.deepEqual(rules(p), []);
  const t = missingExportTargets(p);
  assert.deepEqual(t.missing, []);
  assert.deepEqual(
    t.unpackedConditions.map((u) => `${u.subpath} ${u.conditions} ${u.target}`),
    ['. source ./src/index.ts'],
  );
});

test("a seeded repository alias fails: apps/web's ~ alias, @/ and an undeclared #import", () => {
  const p = plant({
    'dist/util.js':
      "export { x } from '~/apps/web/src/Next/media.mjs';\nexport { y } from '@/lib/y.js';\nexport { z } from '#internal';\nexport const a = 1;\n",
  });
  assert.deepEqual(rules(p), [
    'repository-alias dist/util.js ~/apps/web/src/Next/media.mjs',
    'repository-alias dist/util.js @/lib/y.js',
    'repository-alias dist/util.js #internal',
  ]);
});

test('a declared #import is a package specifier, not an alias', () => {
  const p = plant(
    {
      'dist/util.js': "export { z } from '#internal';\nexport const a = 1;\n",
      'dist/z.js': 'export const z = 1;\n',
    },
    { ...PKG, imports: { '#internal': './dist/z.js' } },
  );
  assert.deepEqual(rules(p), []);
});

test('paths out of the package, absolute paths, repository source and app imports fail', () => {
  const p = plant({
    'dist/util.js': [
      "import '../../../apps/web/src/main.tsx';",
      "import '/home/someone/checkout/packages/x.js';",
      "import 'stylegan-js/src/index.ts';",
      "import '@facemorph/web';",
      "export const u = new URL('../../model.onnx', import.meta.url);",
      'export const a = 1;',
      '',
    ].join('\n'),
    'dist/index.d.ts': "export { a } from '../../src/util.ts';\nexport declare const w: URL;\n",
  });
  assert.deepEqual(rules(p), [
    'escapes-package dist/index.d.ts ../../src/util.ts',
    'escapes-package dist/util.js ../../../apps/web/src/main.tsx',
    'ts-source-import dist/util.js ../../../apps/web/src/main.tsx',
    'repository-path dist/util.js ../../../apps/web/src/main.tsx',
    'absolute-specifier dist/util.js /home/someone/checkout/packages/x.js',
    'repository-path dist/util.js stylegan-js/src/index.ts',
    'imports-app dist/util.js @facemorph/web',
    'escapes-package dist/util.js ../../model.onnx',
  ]);
});

test('an undeclared dependency, a missing file and an emitted .ts import fail', () => {
  const p = plant({
    'dist/util.js':
      "import 'left-pad';\nimport './gone.js';\nimport './worker.ts';\nexport const a = 1;\n",
  });
  assert.deepEqual(rules(p), [
    'undeclared-dependency dist/util.js left-pad',
    'missing-target dist/util.js ./gone.js',
    'missing-target dist/util.js ./worker.ts',
    'ts-source-import dist/util.js ./worker.ts',
  ]);
});

test('an exports target the package does not contain fails', () => {
  const p = plant({ 'dist/worker.js': null });
  assert.deepEqual(
    missingExportTargets(p).missing.map((m) => `${m.subpath} ${m.target}`),
    ['./worker ./dist/worker.js'],
  );
});

test('a seeded repository-alias import fails the packed-package gate end to end; the clean one passes', () => {
  const src = temp('packed-src-');
  const packs = temp('packed-packs-');
  const tarballs = [];
  for (const [name, index] of [
    ['planted-clean', "import { a } from './util.js';\nexport { a };\n"],
    ['planted-alias', "import { a } from '~/packages/planted/src/util.ts';\nexport { a };\n"],
  ]) {
    const dir = join(src, name);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, version: '0.0.0', type: 'module', exports: './dist/index.js' }),
    );
    writeFileSync(join(dir, 'dist/index.js'), index);
    writeFileSync(join(dir, 'dist/util.js'), 'export const a = 1;\n');
    tarballs.push(pack(dir, packs));
  }
  const consumer = join(temp('packed-install-'), 'consumer');
  installConsumer(consumer, tarballs);
  const clean = gateInstalledPackage({ consumer, name: 'planted-clean' });
  assert.equal(clean.ok, true, JSON.stringify(clean));
  const alias = gateInstalledPackage({ consumer, name: 'planted-alias' });
  assert.equal(alias.ok, false);
  assert.ok(
    alias.failures.includes(
      'repository-alias: dist/index.js:1 ~/packages/planted/src/util.ts (a repository path alias, not a package specifier)',
    ),
    JSON.stringify(alias.failures),
  );
  assert.ok(alias.failures.includes('planted-alias did not load'));
});
