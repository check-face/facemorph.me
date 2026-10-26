// Qualification inputs must fail before model tests can silently skip a requested candidate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquiredManifest, PINNED_MANIFEST_SHA256 } from './support/runtime.ts';

test('staged runtime identity is explicit and checked against bytes on disk', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ort-qualified-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = JSON.stringify({ schemaVersion: 1, runtime: { version: '1.30.0' } }) + '\n';
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.throws(() => acquiredManifest(root, digest), /Requested runtime manifest is missing/);
  writeFileSync(join(root, 'manifest.json'), bytes);
  assert.deepEqual(acquiredManifest(root, digest), { manifest: JSON.parse(bytes), sha256: digest });
  assert.throws(() => acquiredManifest(root, PINNED_MANIFEST_SHA256), /SHA-256 mismatch/);
  writeFileSync(join(root, 'manifest.json'), bytes + ' ');
  assert.throws(() => acquiredManifest(root, digest), /SHA-256 mismatch/);
  for (const invalid of ['', 'latest', '../manifest.json', digest.toUpperCase()])
    assert.throws(() => acquiredManifest(root, invalid), /must be a lowercase SHA-256 digest/);
});

test('the environment selects a staged runtime and a wrong explicit pin fails the test process', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ort-qualified-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = '{"runtime":{"version":"1.30.0"}}\n';
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(root, 'manifest.json'), bytes);
  const script = `import {acquiredManifest} from ${JSON.stringify(new URL('./support/runtime.ts', import.meta.url).href)}; console.log(JSON.stringify(acquiredManifest()));`;
  const invoke = (pin?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, FACEMORPH_RUNTIME_CACHE: root };
    delete env['FACEMORPH_RUNTIME_SHA256'];
    if (pin !== undefined) env['FACEMORPH_RUNTIME_SHA256'] = pin;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  assert.equal(JSON.parse(invoke(digest)).sha256, digest);
  assert.throws(() => invoke(PINNED_MANIFEST_SHA256), /SHA-256 mismatch/);
  assert.equal(JSON.parse(invoke()), null, 'an absent default control remains explicitly untested');
});
