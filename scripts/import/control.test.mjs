// fetch-control and the control store checks, on real files in temporary directories.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { REPO } from '../inventory/lib.mjs';
import { plant, tempDir } from '../inventory/testing.mjs';
import { digestTree } from './control.mjs';
import { fetchControl } from './fetch-control.mjs';

const planted = () => {
  const dir = plant(tempDir('control-'), {
    'deploy-next/index.html': '<!doctype html>',
    'deploy-next/app.js': 'console.log(1)',
    'next-site-source.txt': 'abc\n',
  });
  return { dir, record: { files: digestTree(dir) } };
};

test('a clean store passes', async () => {
  const { dir, record } = planted();
  assert.equal((await fetchControl({ store: dir, record })).findings.length, 0);
});

test('a one-byte tampered copy fails', async () => {
  const { dir, record } = planted();
  const path = join(dir, 'deploy-next/app.js');
  const bytes = readFileSync(path);
  bytes[0] ^= 1;
  writeFileSync(path, bytes);
  await assert.rejects(fetchControl({ store: dir, record }), (e) =>
    e.findings.some((f) => f.path === 'deploy-next/app.js' && f.problem === 'mismatch'),
  );
});

test('a missing file fails, and so does an extra one', async () => {
  const { dir, record } = planted();
  unlinkSync(join(dir, 'deploy-next/index.html'));
  writeFileSync(join(dir, 'deploy-next/extra.js'), '');
  await assert.rejects(
    fetchControl({ store: dir, record }),
    (e) =>
      e.findings.some((f) => f.problem === 'missing') &&
      e.findings.some((f) => f.problem === 'extra'),
  );
});

test('the pinned record names classic as the source and a release asset of this repository', () => {
  const record = JSON.parse(readFileSync(join(REPO, 'import/control-artifact.json'), 'utf8'));
  assert.match(record.label, /^control/);
  assert.equal(record.source.repository_id, 295956585);
  assert.match(
    record.release.url,
    /^https:\/\/github\.com\/(check-face|facemorph-me)\/facemorph\.me\/releases\/download\//,
  );
  assert.equal(record.live_check.differences, 0);
  assert.ok(record.files.some((f) => f.path === 'deploy-next/index.html'));
});

test('every golden, parity or freeze script that reads the control calls fetch-control first', () => {
  // A grader that reads only recorded goldens (scripts/verify/parity-grade.mjs) never touches the control.
  // Classic's own files imported byte-identical (apps/web, import/allowlist.json) are its history, not ours.
  const imported = new Set(
    JSON.parse(readFileSync(join(REPO, 'import/allowlist.json'), 'utf8')).files.map((f) =>
      join(REPO, f.destination),
    ),
  );
  const scripts = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /(golden|parity|freeze)[^/]*\.(mjs|js|ts|py)$/.test(entry.name) &&
        !/\.test\./.test(entry.name) &&
        !imported.has(path)
      )
        scripts.push(path);
    }
  };
  for (const root of ['scripts', 'apps', 'packages', 'tools']) {
    try {
      walk(join(REPO, root));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const readsControl = /control-artifact\.json|deploy-next|startControl\(/;
  for (const path of scripts.filter((p) => readsControl.test(readFileSync(p, 'utf8'))))
    assert.match(
      readFileSync(path, 'utf8'),
      /fetch-control/,
      `${path} must call fetch-control first`,
    );
});
