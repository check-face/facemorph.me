// The closure checks on planted trees in temporary directories (planted files are inputs, not fakes), run as
// real processes where the check is a command.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../inventory/lib.mjs';
import { plant, run, tempDir } from '../inventory/testing.mjs';
import { closureFindings } from './verify-closure.mjs';
import { scanTree } from './scan-exclusions.mjs';

const UNRESOLVED = fileURLToPath(new URL('../inventory/unresolved-imports.mjs', import.meta.url));
const files = {
  'src/Next/a.mjs': 'export const a = 1;\n',
  'src/Next/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n",
};
const allowlist = {
  destination_root: 'apps/web',
  files: Object.entries(files).map(([path, text]) => ({
    destination: `apps/web/${path}`,
    sha256: sha256(Buffer.from(text)),
    bytes: Buffer.byteLength(text),
  })),
};
const tree = (extra = {}) => {
  const root = tempDir('closure-');
  plant(join(root, 'apps/web'), { ...files, ...extra });
  return root;
};

test('a clean closure passes', () => {
  assert.deepEqual(closureFindings({ root: tree(), allowlist }), []);
});

test('a digest mismatch is detected', () => {
  const findings = closureFindings({
    root: tree({ 'src/Next/a.mjs': 'export const a = 2;\n' }),
    allowlist,
  });
  assert.deepEqual(
    findings.map((f) => [f.path, f.problem]),
    [['apps/web/src/Next/a.mjs', 'mismatch']],
  );
});

test('an extra file is detected unless a later bead allows it', () => {
  const root = tree({ 'src/Next/extra.mjs': '' });
  assert.deepEqual(
    closureFindings({ root, allowlist }).map((f) => f.problem),
    ['extra'],
  );
  assert.deepEqual(closureFindings({ root, allowlist, allow: ['src/Next/extra.mjs'] }), []);
});

test('a missing file is detected', () => {
  const root = tempDir('closure-');
  plant(join(root, 'apps/web'), { 'src/Next/a.mjs': files['src/Next/a.mjs'] });
  assert.deepEqual(
    closureFindings({ root, allowlist }).map((f) => f.problem),
    ['missing'],
  );
});

test('a ported file is checked against its new bytes, and a ported record must name its bead and reason', () => {
  const ported = 'export const a = 3;\n';
  const portedList = {
    ...allowlist,
    files: allowlist.files.map((f) =>
      f.destination.endsWith('a.mjs')
        ? {
            ...f,
            ported: { sha256: sha256(Buffer.from(ported)), bytes: 20, bead: 'fm-x', reason: 'r' },
          }
        : f,
    ),
  };
  assert.deepEqual(
    closureFindings({ root: tree({ 'src/Next/a.mjs': ported }), allowlist: portedList }),
    [],
  );
  assert.deepEqual(
    closureFindings({ root: tree(), allowlist: portedList }).map((f) => [f.path, f.problem]),
    [['apps/web/src/Next/a.mjs', 'mismatch']],
    "classic's bytes no longer pass for a ported file",
  );
  const unnamed = {
    ...allowlist,
    files: portedList.files.map((f) =>
      f.ported ? { ...f, ported: { sha256: f.ported.sha256 } } : f,
    ),
  };
  assert.deepEqual(
    closureFindings({ root: tree({ 'src/Next/a.mjs': ported }), allowlist: unnamed }).map(
      (f) => f.problem,
    ),
    ['ported without its digest, bead and reason'],
  );
});

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
