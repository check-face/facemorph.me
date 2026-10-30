// Self-test for verify-provenance.mjs and write-provenance.mjs's digest (fm-oagi), on real planted tarballs.
//   node --test scripts/packages/verify-provenance.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { distDigest, provenanceRecord, SCHEMA } from './write-provenance.mjs';
import { verifyTarball } from './verify-provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'verify-provenance-test-'));
after(() => rmSync(work, { recursive: true, force: true }));
const COMMIT = 'a'.repeat(40);
let n = 0;

function pack({ dist = { 'index.js': 'export {};\n' }, record = {} } = {}) {
  const root = join(work, `p${n++}`);
  const pkg = join(root, 'package');
  for (const [p, t] of Object.entries(dist)) {
    mkdirSync(dirname(join(pkg, 'dist', p)), { recursive: true });
    writeFileSync(join(pkg, 'dist', p), t);
  }
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0' }));
  const d = distDigest(join(pkg, 'dist'));
  const full = {
    schema: SCHEMA,
    name: 'x',
    version: '0.1.0',
    sourceCommit: COMMIT,
    sourceTreeClean: true,
    sourceIdentity: 'b'.repeat(64),
    distSha256: d.sha256,
    distFiles: d.files,
    build: null,
    ...record,
  };
  writeFileSync(join(pkg, 'PROVENANCE.json'), JSON.stringify(full));
  const tgz = `${root}.tgz`;
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', root, 'package']).status, 0);
  return { tgz, pkg };
}

test('a matching record passes and reports the npm integrity', () => {
  const r = verifyTarball(pack().tgz, COMMIT);
  assert.equal(r.outcome, 'match', r.problems.join('; '));
  assert.match(r.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
});

for (const [why, record, commit] of [
  ['another commit', {}, 'c'.repeat(40)],
  ['a dirty tree', { sourceTreeClean: false }],
  ['another version', { version: '0.2.0' }],
  ['a dist digest that is not this dist', { distSha256: '0'.repeat(64) }],
  ['no build identity', { sourceIdentity: null }],
  ['the old schema', { schema: 'facemorph.package-provenance/1' }],
]) {
  test(`mismatch: ${why}`, () => {
    assert.equal(verifyTarball(pack({ record }).tgz, commit ?? COMMIT).outcome, 'mismatch');
  });
}

test('a dist file changed after the record was written is a mismatch', () => {
  const { pkg } = pack();
  writeFileSync(join(pkg, 'dist', 'index.js'), 'export const changed = 1;\n');
  const tgz = join(work, 'changed.tgz');
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', dirname(pkg), 'package']).status, 0);
  assert.equal(verifyTarball(tgz, COMMIT).outcome, 'mismatch');
});

test('provenanceRecord on a real workspace package names its commit, identity and dist digest', async () => {
  const dir = join(here, '../../packages/cloudflare-model-host');
  const r = await provenanceRecord(dir, {});
  assert.match(r.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(r.sourceIdentity, /^[0-9a-f]{64}$/);
  assert.equal(r.distSha256, distDigest(join(dir, 'dist')).sha256);
  assert.equal(r.build, null);
  assert.equal(
    (await provenanceRecord(dir, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '7' })).build.runId,
    '7',
  );
});
