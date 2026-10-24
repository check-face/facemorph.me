// The mirror Worker's import and configuration (fm-fy2.14), on plain values: its provenance names the frozen classic
// revision and every source file at the digest import/allowlist.json records for it, each destination exists, the
// package source names no FaceMorph host, and the prefix rules. The Worker itself runs in workerd in
// mirror.workerd.ts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mirrored, prefixes } from '../src/mirror/worker.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'));
const provenance = read('packages/cloudflare-model-host/mirror/provenance.json');
const allowlist = read('import/allowlist.json');

test('the provenance names the frozen revision and each source at the allowlist digest; destinations exist', () => {
  assert.equal(provenance.source.commit, allowlist.source.frozen_commit);
  assert.equal(provenance.source.repository, allowlist.source.repository);
  const listed = allowlist.listed_with_digests.filter((f: { source: string }) =>
    f.source.startsWith('hosting/next-mirror/'),
  );
  assert.deepEqual(
    provenance.files.map((f: { source: string }) => f.source).sort(),
    listed.map((f: { source: string }) => f.source).sort(),
    'every listed mirror file has a provenance entry',
  );
  for (const f of provenance.files) {
    const row = listed.find((l: { source: string }) => l.source === f.source);
    assert.equal(f.sha256, row.sha256, f.source);
    assert.equal(f.bytes, row.bytes, f.source);
    assert.ok(f.ported, `${f.source} says what changed`);
    if (f.destination !== null) assert.ok(existsSync(join(REPO, f.destination)), f.destination);
  }
});

test('the package source names no FaceMorph host', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  for (const path of files(join(PACKAGE, 'src')))
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /(next|models)\.facemorph\.me/,
      path.slice(PACKAGE.length),
    );
});

test('prefixes come from configuration only; a path is mirrored under one, never with an empty or .. segment', () => {
  assert.deepEqual(prefixes(undefined), []);
  assert.deepEqual(prefixes(' runtime/chunks , runtime/assets/,'), [
    'runtime/chunks/',
    'runtime/assets/',
  ]);
  const allowed = prefixes('runtime/chunks/');
  assert.equal(mirrored('runtime/chunks/a/part-001.bin', allowed), true);
  assert.equal(mirrored('runtime/chunksx/a', allowed), false);
  assert.equal(mirrored('runtime/manifest.json', allowed), false);
  assert.equal(mirrored('runtime/chunks/../manifest.json', allowed), false);
  assert.equal(mirrored('runtime/chunks//a', allowed), false);
  assert.equal(mirrored('runtime/chunks/', allowed), false);
  assert.equal(mirrored('runtime/chunks/a', []), false);
});
