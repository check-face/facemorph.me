// The package boundary assertion (fm-7ge) against planted repository trees: a package importing app code, the
// engine importing a network or cache module, and a non-app package importing React each fail; a clean tree and
// an app importing React pass.
//   node --test scripts/packages/consumer-gates/boundaries.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { checkBoundaries } from './boundaries.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A planted monorepo: an app, stylegan-js with an engine, and a manager that depends on stylegan-js. */
function plant(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
  roots.push(root);
  const files = {
    'package.json': JSON.stringify({
      name: 'planted',
      private: true,
      workspaces: ['apps/web', 'packages/stylegan-js', 'packages/browser-model-manager'],
    }),
    'apps/web/package.json': JSON.stringify({ name: '@facemorph/web' }),
    'apps/web/src/app.tsx': "import { useState } from 'react';\nexport const s = useState;\n",
    'packages/stylegan-js/package.json': JSON.stringify({ name: '@facemorph/stylegan-js' }),
    'packages/stylegan-js/src/index.ts': "export * from './contracts/ops.ts';\n",
    'packages/stylegan-js/src/contracts/ops.ts': 'export const op = (x: number) => x + 1;\n',
    'packages/stylegan-js/src/engine/index.ts':
      "import { op } from '../contracts/ops.ts';\nexport { run } from './run.ts';\nexport const two = op(1);\n",
    'packages/stylegan-js/src/engine/run.ts':
      '// fetch( in a comment is not a call\nexport function run(o: { fetch(): void }) { o.fetch(); return { fetch: 1 }; }\n',
    'packages/browser-model-manager/package.json': JSON.stringify({
      name: '@facemorph/browser-model-manager',
      dependencies: { '@facemorph/stylegan-js': '^0.0.0' },
    }),
    'packages/browser-model-manager/src/index.ts':
      "import type { op } from '@facemorph/stylegan-js';\nexport const get = (u: string) => fetch(u);\nexport type Op = typeof op;\n",
    ...overrides,
  };
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const rules = (root) =>
  checkBoundaries({ root }).findings.map((f) => `${f.rule} ${f.file}${f.spec ? ` ${f.spec}` : ''}`);

test('clean tree: no findings; the app may import React and the manager may fetch', () => {
  const r = checkBoundaries({ root: plant() });
  assert.deepEqual(r.findings, []);
  assert.equal(r.packages.find((p) => p.package === '@facemorph/stylegan-js').engineReached, 3);
});

test('a package importing app code fails, by relative path and by the app package name', () => {
  const root = plant({
    'packages/browser-model-manager/src/index.ts':
      "import { s } from '../../../apps/web/src/app.tsx';\nimport type { X } from '@facemorph/web/src/x';\nexport const t = s;\nexport type Y = X;\n",
  });
  assert.deepEqual(rules(root), [
    'imports-app packages/browser-model-manager/src/index.ts ../../../apps/web/src/app.tsx',
    'imports-app packages/browser-model-manager/src/index.ts @facemorph/web/src/x',
  ]);
});

test('a package reaching another package by path, or an undeclared workspace dependency, fails', () => {
  const root = plant({
    'packages/stylegan-js/src/contracts/ops.ts':
      "export { get } from '../../../browser-model-manager/src/index.ts';\nimport type { Op } from '@facemorph/browser-model-manager';\nexport type O = Op;\nexport const op = (x: number) => x + 1;\n",
  });
  assert.deepEqual(rules(root), [
    'escapes-package packages/stylegan-js/src/contracts/ops.ts ../../../browser-model-manager/src/index.ts',
    'undeclared-workspace-dependency packages/stylegan-js/src/contracts/ops.ts @facemorph/browser-model-manager',
    // ops.ts is reached by the engine, so the manager import is an engine cache import as well.
    'engine-network-cache-import packages/stylegan-js/src/contracts/ops.ts @facemorph/browser-model-manager',
  ]);
});

test('the engine importing the manager cache, a network module or an unlisted module fails', () => {
  const root = plant({
    'packages/stylegan-js/src/engine/run.ts': [
      "import { createModelCache } from '@facemorph/browser-model-manager/cache';",
      "import { request } from 'node:https';",
      "import { openDB } from 'idb';",
      "import * as ort from 'onnxruntime-web';",
      'export const run = [createModelCache, request, openDB, ort];',
      '',
    ].join('\n'),
  });
  assert.deepEqual(rules(root), [
    'undeclared-workspace-dependency packages/stylegan-js/src/engine/run.ts @facemorph/browser-model-manager/cache',
    'engine-network-cache-import packages/stylegan-js/src/engine/run.ts @facemorph/browser-model-manager/cache',
    'engine-network-cache-import packages/stylegan-js/src/engine/run.ts node:https',
    'engine-network-cache-import packages/stylegan-js/src/engine/run.ts idb',
    'engine-unlisted-import packages/stylegan-js/src/engine/run.ts onnxruntime-web',
  ]);
});

test('a network or storage helper the engine reaches through a relative import fails', () => {
  const root = plant({
    'packages/stylegan-js/src/engine/run.ts': "export { weights } from '../net/weights.ts';\n",
    'packages/stylegan-js/src/net/weights.ts': [
      'export async function weights(u: string) {',
      '  const r = await globalThis.fetch(u);',
      "  const db = indexedDB.open('w');",
      '  const dir = await navigator.storage.getDirectory();',
      '  return [r, db, dir, caches];',
      '}',
      '',
    ].join('\n'),
  });
  const r = checkBoundaries({ root }).findings;
  assert.deepEqual(
    r.map((f) => `${f.rule} ${f.file}:${f.line} ${f.detail.split(' ')[0]}`),
    [
      'engine-network-cache-global packages/stylegan-js/src/net/weights.ts:2 globalThis.fetch',
      'engine-network-cache-global packages/stylegan-js/src/net/weights.ts:3 indexedDB',
      'engine-network-cache-global packages/stylegan-js/src/net/weights.ts:4 navigator.storage',
      'engine-network-cache-global packages/stylegan-js/src/net/weights.ts:5 caches',
    ],
  );
});

test('the same fetch outside the engine graph is not an engine finding', () => {
  const root = plant({
    'packages/stylegan-js/src/net/weights.ts': 'export const w = (u: string) => fetch(u);\n',
  });
  assert.deepEqual(rules(root), []);
});

test('a non-app package importing React fails, a type-only import and react-dom/client included', () => {
  const root = plant({
    'packages/browser-model-manager/src/index.ts':
      "import type { FC } from 'react';\nimport { createRoot } from 'react-dom/client';\nexport type C = FC;\nexport const r = createRoot;\n",
  });
  assert.deepEqual(rules(root), [
    'imports-react packages/browser-model-manager/src/index.ts react',
    'imports-react packages/browser-model-manager/src/index.ts react-dom/client',
  ]);
});
