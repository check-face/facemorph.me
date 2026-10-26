// The hosting import plan and the hosting scan (fm-8tyu), with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { plan, portedRecords, SIZE_LIMIT } from './import-hosting.mjs';
import { scanFiles } from './scan-hosting.mjs';

const rows = [
  { path: 'hosting/next-static/stage.py', destination: 'hosting/' },
  { path: 'hosting/next-static/catalogue.json', destination: 'hosting/' },
  { path: 'hosting/next-static/huge.json', destination: 'hosting/' },
  { path: 'hosting/next-cloudflare/.wrangler/state/v3/kv/x.sqlite', destination: 'hosting/' },
  { path: 'hosting/next-mirror/worker.mjs', destination: 'packages/cloudflare-model-host' },
];
const entry = (path, size = 100) => ({ path, mode: '100644', type: 'blob', sha1: 'x', size });

test('only hosting/ rows import; .wrangler state and oversized files are refused even when the table says hosting/', () => {
  const { imports, refused } = plan(rows, [
    entry('hosting/next-static/stage.py'),
    entry('hosting/next-static/catalogue.json', 3_405_692),
    entry('hosting/next-static/huge.json', SIZE_LIMIT + 1),
    entry('hosting/next-cloudflare/.wrangler/state/v3/kv/x.sqlite'),
    entry('hosting/next-mirror/worker.mjs'),
  ]);
  assert.deepEqual(
    imports.map((e) => e.path),
    ['hosting/next-static/stage.py', 'hosting/next-static/catalogue.json'],
  );
  assert.deepEqual(refused.map((r) => r.path).sort(), [
    'hosting/next-cloudflare/.wrangler/state/v3/kv/x.sqlite',
    'hosting/next-static/huge.json',
  ]);
  assert.match(refused.find((r) => r.path.includes('.wrangler')).problem, /wrangler/);
});

test('a table row missing from the frozen tree is reported', () => {
  const { refused } = plan([{ path: 'hosting/gone.py', destination: 'hosting/' }], []);
  assert.deepEqual(refused, [
    { path: 'hosting/gone.py', problem: 'in the boundary table but not in the frozen tree' },
  ]);
});

test('the scan finds planted wrangler state, weights, oversized files and credential values, not secret names', () => {
  const f = (path, text, size) => ({ path, bytes: size ? Buffer.alloc(size) : Buffer.from(text) });
  const findings = scanFiles([
    f('hosting/next-cloudflare/.wrangler/state/v3/kv/x.sqlite', 'x'),
    f('hosting/next/model.onnx', 'x'),
    f('hosting/next-static/big.txt', '', SIZE_LIMIT + 1),
    f(
      'hosting/next-static/deploy.py',
      'headers = {"Authorization": "Bearer abcdefghijklmnopqrstuvwxyz0123456789"}',
    ),
    f('hosting/next-static/wrangler.jsonc', '{ "vars": { "TOKEN_NAME": "CLOUDFLARE_API_TOKEN" } }'),
    f(
      'hosting/gallery/cloudflare.config.ts',
      'export const key = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";',
    ),
  ]);
  const by = (p) => findings.filter((x) => x.path === p).map((x) => x.problem);
  assert.deepEqual(by('hosting/next-cloudflare/.wrangler/state/v3/kv/x.sqlite'), [
    'wrangler state',
  ]);
  assert.deepEqual(by('hosting/next/model.onnx'), ['weight or binary file']);
  assert.deepEqual(by('hosting/next-static/big.txt'), ['over the size limit']);
  assert.deepEqual(by('hosting/next-static/deploy.py'), ['credential-looking value (bearer)']);
  assert.deepEqual(by('hosting/next-static/wrangler.jsonc'), []);
  assert.deepEqual(by('hosting/gallery/cloudflare.config.ts'), [
    'credential-looking value (bearer)',
  ]);
});

test('the two split rows the site lane needs import; other split rows do not', () => {
  const rows = [
    { path: 'hosting/next-static/webgpu_contract.py', destination: 'split' },
    { path: 'hosting/next-static/webgpu_contract_test.py', destination: 'split' },
    { path: 'hosting/next-static/restage-runtime.py', destination: 'split' },
  ];
  const entries = rows.map((r) => ({ path: r.path, mode: '100644', size: 10, sha1: 'x' }));
  assert.deepEqual(
    plan(rows, entries).imports.map((e) => e.path),
    ['hosting/next-static/webgpu_contract.py', 'hosting/next-static/webgpu_contract_test.py'],
  );
});

test('a ported record needs its digest, bead and reason', () => {
  const good = {
    sha256: 'a'.repeat(64),
    bytes: 1,
    bead: 'fm-be10',
    reason: 'calls the re-homed verifier',
  };
  const { ported, problems } = portedRecords([
    { path: 'hosting/a.py', ported: good },
    { path: 'hosting/b.py', ported: { sha256: 'b'.repeat(64), bytes: 1 } },
    { path: 'hosting/c.py' },
  ]);
  assert.deepEqual([...ported.keys()], ['hosting/a.py', 'hosting/b.py']);
  assert.deepEqual(problems, [
    { path: 'hosting/b.py', problem: 'ported without its digest, bead and reason' },
  ]);
});

test('a deliberately removed file is ported as removed with its bead and reason, and no digest', () => {
  const { ported, problems } = portedRecords([
    {
      path: 'hosting/a.toml',
      ported: { removed: true, bead: 'fm-a0c1', reason: 'replaced by cf' },
    },
    { path: 'hosting/b.toml', ported: { removed: true, bead: 'fm-a0c1' } },
    {
      path: 'hosting/c.toml',
      ported: { removed: true, sha256: 'c'.repeat(64), bead: 'fm-a0c1', reason: 'x' },
    },
    { path: 'hosting/d.toml', ported: { removed: 'yes', bead: 'fm-a0c1', reason: 'x' } },
  ]);
  assert.equal(ported.size, 4);
  assert.deepEqual(
    problems.map((p) => p.path),
    ['hosting/b.toml', 'hosting/c.toml', 'hosting/d.toml'],
  );
});
