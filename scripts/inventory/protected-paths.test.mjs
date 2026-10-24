#!/usr/bin/env node
// fm-p7v: schema tests for inventory/protected-paths.json (pure values + the real committed file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProtectedPaths } from './schema-protected-paths.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const entry = (extra = {}) => ({ path: 'hosting/next-static/stage.py', readers: [{ reader: 'next-site.yml', evidence: 'next-site.yml:176' }], owner: 'ws-hosting', disposition: 'keep', ...extra });

const rules = (doc) => validateProtectedPaths(doc).map((v) => `${v.path ?? '-'}:${v.rule}`);

test('an entry without a reader is rejected', () => {
  assert.deepEqual(rules({ paths: [entry({ readers: [] })] }), ['hosting/next-static/stage.py:reader-missing']);
  assert.deepEqual(rules({ paths: [entry({ readers: [{ evidence: 'x' }] })] }), ['hosting/next-static/stage.py:reader-missing']);
});

test('an entry without an owner is rejected', () => {
  assert.deepEqual(rules({ paths: [entry({ owner: undefined })] }), ['hosting/next-static/stage.py:owner-missing']);
  assert.deepEqual(rules({ paths: [entry({ owner: 'cdilga' })] }), ['hosting/next-static/stage.py:owner-missing']);
});

test('a reader without evidence is rejected, "none attested" with evidence is fine', () => {
  assert.deepEqual(rules({ paths: [entry({ readers: [{ reader: 'x', evidence: '' }] })] }), ['hosting/next-static/stage.py:evidence-missing']);
  assert.deepEqual(rules({ paths: [entry({ readers: [{ reader: 'none attested', evidence: 'grep photo-canary: no match' }] })] }), []);
});

test('duplicate paths and bad dispositions are rejected', () => {
  assert.deepEqual(rules({ paths: [entry(), entry()] }), ['hosting/next-static/stage.py:duplicate-path']);
  assert.deepEqual(rules({ paths: [entry({ disposition: 'delete' })] }), ['hosting/next-static/stage.py:bad-disposition']);
});

test('external sources need url, consumers, terms and provenance; sha256 stays hex or null', () => {
  assert.deepEqual(rules({ paths: [], external_sources: [{ url: 'https://x/y.pkl', consumers: ['a.py:5'], terms: 'MIT', provenance: 'pinned' }] }), []);
  assert.deepEqual(
    rules({ paths: [], external_sources: [{ consumers: [], terms: '', provenance: '', sha256: 'zz' }] }).sort(),
    ['external_sources[0]:bad-sha256', 'external_sources[0]:consumer-missing', 'external_sources[0]:provenance-missing', 'external_sources[0]:terms-missing', 'external_sources[0]:url-missing'].sort()
  );
});

test('the committed inventory passes its own schema', () => {
  const doc = JSON.parse(readFileSync(`${ROOT}inventory/protected-paths.json`, 'utf8'));
  assert.deepEqual(validateProtectedPaths(doc), []);
  assert.ok(doc.paths.length >= 20, 'the protected-path list is populated');
  assert.ok(doc.paths.some((p) => p.path.startsWith('experiment/')), 'experiment/ is on the list');
});
