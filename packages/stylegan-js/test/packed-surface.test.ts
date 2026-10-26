// The packed surface from the tarball (fm-1jr7): every documented entry point in the exports map (main, types, and
// the worker entry points serveEngine/connectEngine on ./engine) resolves from an `npm pack` installed into a clean
// project outside the monorepo; a consumer type-checks against the emitted declarations only; the shipped JS names
// no workspace alias, repository path, app or React/DOM-framework import. The module-reference check is the
// consumer gates' own (scripts/packages/consumer-gates/packed-imports.mjs), reused unchanged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  compileClean,
  installClean,
  PACKAGE_NAME,
  packFresh,
  REPO,
  repoVersion,
} from './support/packed.ts';

type ExportsMap = Record<string, Record<string, string>>;
// The entry points the package documents: its exports map, as this bead's acceptance and README name them.
const DOCUMENTED = ['.', './engine', './engine/webgpu'];
const WORKER_ENTRIES = ['serveEngine', 'connectEngine'];

const work = mkdtempSync(join(tmpdir(), 'stylegan-js-packed-surface-'));
after(() => rmSync(work, { recursive: true, force: true }));
const tarball = packFresh(work);
const consumer = join(work, 'consumer');
installClean(consumer, tarball, [`typescript@${repoVersion('typescript')}`]);
const installed = join(consumer, 'node_modules', PACKAGE_NAME);
const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) as {
  exports: ExportsMap;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const specifier = (subpath: string) =>
  subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`;

const shipped = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? shipped(dir, p) : [p];
  });

test('the exports map lists every documented entry point, each with types and default targets in the tarball', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [...DOCUMENTED].sort());
  for (const subpath of DOCUMENTED) {
    const entry = pkg.exports[subpath]!;
    for (const condition of ['types', 'default']) {
      const target = entry[condition];
      assert.ok(target, `${subpath} has a ${condition} condition`);
      assert.ok(
        existsSync(join(installed, target)),
        `${subpath} [${condition}] ${target} is in the tarball`,
      );
    }
    // `source` is the workspace's own development condition; it must not be what a consumer resolves.
    assert.ok(!existsSync(join(installed, 'src')), 'no sources shipped');
  }
});

test('Node resolves and imports every entry point from the clean project', () => {
  const script = DOCUMENTED.map(
    (s, i) =>
      `const m${i} = await import(${JSON.stringify(specifier(s))}); out.push([${JSON.stringify(s)}, import.meta.resolve(${JSON.stringify(specifier(s))}), Object.keys(m${i}).length]);`,
  ).join('\n');
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const out = [];\n${script}\nconsole.log(JSON.stringify(out));`],
    { cwd: consumer, encoding: 'utf8' },
  );
  const rows = JSON.parse(out) as [string, string, number][];
  for (const [subpath, url, count] of rows) {
    const condition = pkg.exports[subpath]!['default']!.slice(2);
    assert.ok(url.endsWith(`/node_modules/${PACKAGE_NAME}/${condition}`), `${subpath} -> ${url}`);
    assert.ok(count > 0, `${subpath} exports something`);
  }
});

test('a consumer type-checks every entry point against the emitted declarations only', () => {
  const src = join(consumer, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        lib: ['ES2024', 'DOM', 'DOM.Iterable'],
        types: [],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        noEmit: true,
      },
      include: ['src'],
    }),
  );
  writeFileSync(
    join(src, 'entries.ts'),
    [
      `import * as main from '${PACKAGE_NAME}';`,
      `import * as engine from '${PACKAGE_NAME}/engine';`,
      `import type { LoadedModelCapability, LatentTensor, OperationSettlement, SynthesisResult } from '${PACKAGE_NAME}';`,
      `import type { Engine, LocalAssetReader, Generator } from '${PACKAGE_NAME}/engine';`,
      // Type-level: the documented functions have the documented shapes.
      `export const create: (o: { generator: LoadedModelCapability }) => Engine = engine.createEngine;`,
      `export const worker: [typeof engine.serveEngine, typeof engine.connectEngine] = [${WORKER_ENTRIES.map((n) => `engine.${n}`).join(', ')}];`,
      `export type Synth = OperationSettlement<SynthesisResult>;`,
      `export type Pieces = [LatentTensor, LocalAssetReader, Generator];`,
      `export const blend: typeof main.blend = main.blend;`,
      `export const descriptor = main.FFHQ_1024_DESCRIPTOR.latent.layers satisfies number;`,
      '',
    ].join('\n'),
  );
  const r = compileClean(consumer);
  assert.equal(r.status, 0, r.output);
  assert.ok(r.declarations.length > 0, 'the compiler read the package');
  assert.deepEqual(r.sources, [], 'only .d.ts files of the package were read');
});

test('no workspace alias, repository path, app or React import in the emitted JS or declarations', async () => {
  // The consumer gates' reference check (AST, not regex), reused as-is.
  const gates = (await import(
    join(REPO, 'scripts/packages/consumer-gates/packed-imports.mjs')
  )) as {
    checkPackedImports(o: { dir: string; pkg: unknown }): {
      findings: { rule: string; file: string; spec: string }[];
      scanned: string[];
    };
  };
  const r = gates.checkPackedImports({ dir: installed, pkg });
  assert.ok(r.scanned.length > 20, `scanned ${r.scanned.length} files`);
  assert.deepEqual(r.findings, []);
  assert.deepEqual({ ...pkg.dependencies, ...pkg.peerDependencies }, {}, 'no runtime dependencies');
  // And a plain text check over every shipped JS/.d.ts file, which a broken parser could not hide.
  const banned = [
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:react|react-dom|preact|@facemorph\/web)(?:\/[^"']*)?["']/,
    /(?:from\s*|import\s*\(\s*)["'](?:~|@\/)/,
    /["'](?:\.\.\/)+(?:apps|packages)\//,
    /["']@facemorph\/[\w-]+\/src\//,
  ];
  const files = shipped(installed).filter((f) => /\.(?:js|d\.ts)$/.test(f));
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = readFileSync(join(installed, f), 'utf8');
    for (const re of banned) assert.doesNotMatch(text, re, `${f} matches ${re}`);
  }
});
