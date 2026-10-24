// The check-bridge-imports successor (fm-pia9) on planted source trees: a named import or a namespace member the
// .mjs module does not export (directly or through `export *` / `export { } from`) is a finding; real ones pass.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error untyped .mjs script
import { bridgeImportProblems } from '../../scripts/check-bridge-imports.mjs';

function plant(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-imports-'));
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
