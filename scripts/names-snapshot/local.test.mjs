import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLocal } from './restore.mjs';
import { sha256 } from './snapshot.mjs';

test('local snapshot check hashes real files and refuses missing or corrupted inputs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm-snapshot-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('snapshot input');
  const rows = [
    { url: 'https://catalogue.example/data', bytes: bytes.length, sha256: sha256(bytes) },
  ];
  assert.equal(checkLocal(rows, root).complete, false);
  mkdirSync(join(root, 'catalogue.example'));
  writeFileSync(join(root, 'catalogue.example/data'), bytes);
  assert.equal(checkLocal(rows, root).complete, true);
  writeFileSync(join(root, 'catalogue.example/data'), 'corrupted');
  assert.equal(checkLocal(rows, root).complete, false);
  assert.deepEqual(checkLocal(rows, root).mismatch, [rows[0].url]);
});
