// The check-bridge-imports successor (fm-pia9) on planted source trees: a named import or a namespace member the
// .mjs module does not export (directly or through `export *` / `export { } from`) is a finding; real ones pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error untyped .mjs script
import { bridgeImportProblems } from '../../scripts/check-bridge-imports.mjs';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function plant(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-imports-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const modules = {
  'src/bridge.mjs':
    "export function execute(){}\nexport const MESSAGE='x';\nexport * from './more.mjs';\nexport {preview as publicPreview} from './previews.mjs';\n",
  'src/more.mjs': 'export async function loadNames(){}\n',
  'src/previews.mjs': 'export function preview(){}\n',
};

test('real names pass, by named import and by namespace member', () => {
  const root = plant({
    ...modules,
    'shell/a.ts':
      "import { execute, MESSAGE as M, loadNames } from '../src/bridge.mjs';\nimport * as b from '../src/bridge.mjs';\nb.publicPreview();\n",
  });
  assert.deepEqual(bridgeImportProblems([join(root, 'shell/a.ts')]), []);
});

test('a name the module does not export is a finding, both ways', () => {
  const root = plant({
    ...modules,
    'shell/a.ts':
      "import { selectPhoto } from '../src/bridge.mjs';\nimport * as b from '../src/bridge.mjs';\nb.cropPhoto();\n// product-bridge.mjs is not a member use\n",
  });
  const found = bridgeImportProblems([join(root, 'shell/a.ts')])
    .map((p: { wanted: string }) => p.wanted)
    .sort();
  assert.deepEqual(found, ['cropPhoto', 'selectPhoto']);
});

test('removing a real bridge export fails both the source check and strict TypeScript', () => {
  const root = plant({
    'package.json': '{"type":"module"}',
    'src/bridge.mjs': 'export const execute = 1;',
    'shell/a.ts': "import { execute } from '../src/bridge.mjs';\nexport const value = execute;",
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        allowJs: true,
        noEmit: true,
        target: 'ES2024',
        module: 'NodeNext',
        types: [],
      },
      include: ['shell', 'src'],
    }),
  });
  const file = join(root, 'shell/a.ts');
  const compile = () =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../../node_modules/typescript/bin/tsc', import.meta.url)),
        '-p',
        root,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
  assert.deepEqual(bridgeImportProblems([file]), []);
  const good = compile();
  assert.equal(good.status, 0, good.stdout + good.stderr);
  writeFileSync(join(root, 'src/bridge.mjs'), 'export const renamed = 1;');
  assert.equal(bridgeImportProblems([file]).length, 1);
  const bad = compile();
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout + bad.stderr, /no exported member 'execute'/);
});
