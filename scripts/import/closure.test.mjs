// Import exclusion and module-resolution checks on planted trees in temporary directories (planted files are inputs, not fakes), run as
// real processes where the check is a command.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { plant, run, tempDir } from '../inventory/testing.mjs';
import { scanTree } from './scan-exclusions.mjs';

const UNRESOLVED = fileURLToPath(new URL('../inventory/unresolved-imports.mjs', import.meta.url));
const files = {
  'src/Next/a.mjs': 'export const a = 1;\n',
  'src/Next/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n",
};
const tree = (extra = {}) => {
  const root = tempDir('closure-');
  plant(join(root, 'apps/web'), { ...files, ...extra });
  return root;
};

test('a planted Foo.fs.js and a planted .wrangler/ each fail the exclusion scan; a clean tree passes', () => {
  assert.deepEqual(scanTree(join(tree(), 'apps/web')).findings, []);
  assert.deepEqual(
    scanTree(join(tree({ 'src/Next/Foo.fs.js': '' }), 'apps/web')).findings.map((f) => f.class),
    ['fable-output'],
  );
  assert.deepEqual(
    scanTree(join(tree({ '.wrangler/state/v3/x': '' }), 'apps/web')).findings.map((f) => f.class),
    ['wrangler-state'],
  );
});

test("provenance: a local home path fails, the product's public contact address does not", () => {
  const clean = scanTree(join(tree({ 'faq.html': 'Write to checkfaceml@gmail.com' }), 'apps/web'), {
    provenance: true,
  });
  assert.deepEqual(clean.findings, []);
  const leaky = scanTree(
    join(tree({ 'app.js.map': '"sources":["/home/someone/dev/x.js"]' }), 'apps/web'),
    { provenance: true },
  );
  assert.deepEqual(
    leaky.findings.map((f) => f.pattern),
    ['local-home-path'],
  );
});

test('only the bridge Fable import may stay unresolved: a planted second one fails, the expected one passes', () => {
  const bridge = {
    'src/Next/product-bridge.mjs': "import * as P from './ProjectJson.fs.js';\nexport { P };\n",
    'package-lock.json': '{"lockfileVersion":3,"packages":{"":{}}}',
  };
  const ok = run(UNRESOLVED, ['--root', join(tree(bridge), 'apps/web')]);
  assert.equal(ok.status, 0, JSON.stringify(ok.lines));
  const second = run(UNRESOLVED, [
    '--root',
    join(tree({ ...bridge, 'src/Next/c.mjs': "import './gone.mjs';\n" }), 'apps/web'),
  ]);
  assert.equal(second.status, 1);
  assert.ok(second.lines.some((l) => l.specifier === './gone.mjs'));
});
