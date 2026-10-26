// build:next identity writer/reader (fm-zz2i), on real files in temporary directories: a planted control store
// stands in for the release asset's unpacked tree (planted inputs, not fakes); the pinned record is also checked.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { plant, tempDir } from '../inventory/testing.mjs';
import {
  stageBuilt,
  controlIdentity,
  identityFindings,
  IDENTITY,
  readIdentity,
} from './build-next.mjs';
import { digestTree, readControl } from './control.mjs';

const pinned = readControl();
const source = {
  commit: 'f'.repeat(40),
  buildId: 'f'.repeat(40),
  sourceTreeClean: true,
  sourceTreeSha256: 'a'.repeat(64),
};
const stage = (out, store, record) =>
  stageBuilt({ out, built: join(store, 'deploy-next'), source, record });
function planted() {
  const store = plant(tempDir('build-next-store-'), {
    'deploy-next/index.html': '<!doctype html><title>x</title>',
    'deploy-next/app.abc.js': 'console.log(1)',
    'deploy-next/.vite/manifest.json': '{}',
    'next-site-SHA256SUMS': 'x  deploy-next/index.html\n',
    'next-site-source.txt': `${pinned.source.commit}\n`,
  });
  return { store, record: { ...pinned, files: digestTree(store) } };
}

test('a monorepo build lands in retained layout with destination identity and import provenance', async () => {
  const { store, record } = planted();
  const out = tempDir('build-next-out-');
  const { identity } = stage(out, store, record);
  for (const name of [
    'deploy-next/index.html',
    'next-site-SHA256SUMS',
    'next-site-source.txt',
    IDENTITY,
  ])
    assert.ok(existsSync(join(out, name)), name);
  assert.ok(!existsSync(join(out, 'deploy-next/.vite')));
  assert.equal(identity.label, 'destination');
  assert.equal(identity.deploySource.repository, 'facemorph-me/facemorph.me');
  assert.equal(identity.deploySource.commit, source.commit);
  assert.equal(identity.importedFrom.controlZipSha256, pinned.release.sha256);
  assert.equal(identity.importedFrom.commit, pinned.source.commit);
  assert.deepEqual(identityFindings(out, identity, record), []);
});

test('the identity file is outside deploy-next, so it is never served', async () => {
  const { store, record } = planted();
  const out = tempDir('build-next-out-');
  stage(out, store, record);
  assert.ok(!existsSync(join(out, 'deploy-next', IDENTITY)));
});

test('a changed or missing artifact file fails the reader', async () => {
  const { store, record } = planted();
  const out = tempDir('build-next-out-');
  const { identity } = stage(out, store, record);
  writeFileSync(join(out, 'deploy-next/app.abc.js'), 'console.log(2)');
  assert.ok(
    identityFindings(out, identity, record).some(
      (f) => f.path === 'deploy-next/app.abc.js' && f.problem === 'mismatch',
    ),
  );
  const fresh = tempDir('build-next-out-');
  stage(fresh, store, record);
  assert.ok(readIdentity(tempDir('empty-')).findings.some((f) => f.problem === `no ${IDENTITY}`));
});

test('a mismatched control digest or a monorepo deploy source fails', () => {
  const { store, record } = planted();
  const good = controlIdentity(record, 'f'.repeat(40));
  assert.ok(
    identityFindings(
      store,
      { ...good, control: { ...good.control, zipSha256: '0'.repeat(64) } },
      record,
    ).some((f) => f.problem === 'control digest is not the pinned one'),
  );
  assert.ok(
    identityFindings(
      store,
      {
        ...good,
        deploySource: { repository: 'facemorph-me/facemorph.me', commit: 'f'.repeat(40) },
      },
      record,
    ).some((f) => f.problem === 'control build does not name classic as its deploy source'),
  );
  assert.ok(
    identityFindings(
      store,
      { ...good, assembledBy: { commit: pinned.source.commit } },
      record,
    ).some((f) => f.problem === 'control build names the assembling commit as deploy source'),
  );
  assert.ok(
    identityFindings(store, { ...good, label: 'monorepo build' }, record).some(
      (f) => f.problem === 'control build without the control label',
    ),
  );
  assert.ok(
    identityFindings(store, { ...good, files: [] }, record).some(
      (f) => f.problem === 'identity lists no files',
    ),
  );
});

test('build:next refuses to replace a deploy-next it did not write', async () => {
  const { store, record } = planted();
  const out = plant(tempDir('build-next-out-'), { 'deploy-next/hand-made.html': 'mine' });
  assert.throws(() => stage(out, store, record), /exists without a valid next-site-identity\.json/);
  assert.equal(readFileSync(join(out, 'deploy-next/hand-made.html'), 'utf8'), 'mine');
});

test('the pinned control lists the deploy-next tree and classic identity files', () => {
  const paths = pinned.files.map((f) => f.path);
  assert.ok(paths.includes('deploy-next/index.html'));
  assert.ok(paths.includes('next-site-source.txt'));
  assert.ok(paths.includes('deploy-next/preview/hello-1024.webp'));
});
