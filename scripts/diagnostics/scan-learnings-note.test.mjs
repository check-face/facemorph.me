import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { scanText, KEY_LIST_DIGEST } from './scan-learnings-note.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const classes = (text, opts) => scanText(text, opts).map((f) => f.class);

test('each identifier class is detected', () => {
  const cases = {
    uuid: 'session 3f2a9c1e-7b4d-4e2a-9c1f-0a1b2c3d4e5f seen',
    'r2-key': 'object runs/k3x9qv2mzt1/abc',
    email: 'mail someone@example.org about it',
    ipv4: 'from 203.0.113.42 today',
    ipv6: 'from 2001:db8:85a3:0:0:8a2e:370:7334 today',
    'user-agent': 'Mozilla/5.0 (X11) Chrome/141.0.7390.54 Safari/537.36',
    hex: 'device 9f86d081884c7d659a2feaa0',
    base64: 'token eyJhbGciOiJIUzI1NiJ9xQ2a in the log',
  };
  for (const [cls, line] of Object.entries(cases)) assert.ok(classes(line).includes(cls), `${cls} not detected in: ${line}`);
});

test('the allowlisted key-list digest and ordinary prose are not flagged', () => {
  assert.deepEqual(scanText(`Key-list digest: \`${KEY_LIST_DIGEST}\``), []);
  assert.deepEqual(scanText('quota/usage/persistence and docs/findings/diagnostics-learnings-2026-10-18.md, 1,040 MB at 08:02 UTC'), []);
});

test('matched text is redacted in the findings', () => {
  const [f] = scanText('device 9f86d081884c7d659a2feaa0');
  assert.equal(f.line, 1);
  assert.ok(!f.match.includes('9f86d081884c7d659a2feaa0'));
});

test('ids held in memory are found even without the generic classes', () => {
  const f = scanText('receipt line mentions abcRUN123', { classes: false, ids: ['abcRUN123'] });
  assert.equal(f.length, 1);
  assert.equal(f[0].class, 'bucket-id');
});

test('the committed learnings note passes at HEAD and at 7875aaf', () => {
  const repo = resolve(here, '../..');
  const path = 'docs/findings/diagnostics-learnings-2026-10-18.md';
  assert.deepEqual(scanText(readFileSync(resolve(repo, path), 'utf8')), []);
  const old = execFileSync('git', ['-C', repo, 'show', `7875aaf:${path}`], { encoding: 'utf8' });
  assert.deepEqual(scanText(old), []);
});
