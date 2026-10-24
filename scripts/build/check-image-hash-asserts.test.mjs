#!/usr/bin/env node
// fm-pud: real subprocess runs of check-image-hash-asserts.mjs over planted fixture files in temp directories.
// Fixture text is assembled from pieces so this file never contains an image-hash assertion itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-image-hash-asserts.mjs');
const HASHER = "createHash('sha" + "256')";
const MARK = 'hash-' + 'assert: ';

function run(name, text) {
  const dir = mkdtempSync(join(tmpdir(), 'fm-pud-hash-'));
  try {
    writeFileSync(join(dir, name), text);
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, '--files', name], {
      encoding: 'utf8',
    });
    const lines = r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return {
      status: r.status,
      findings: lines.slice(0, -1),
      summary: lines.at(-1),
      stderr: r.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const webp = (marker) =>
  `test('export is stable', async () => {\n  const out = await exportWebp(face);\n${marker ? `  // ${marker}\n` : ''}  assert.equal(${HASHER}.update(out).digest('hex'), GOLDEN_WEBP);\n});\n`;

test('a SHA-256 comparison over an encoded WebP output fails until it names its replacement', () => {
  const bare = run('a.test.mjs', webp(''));
  assert.equal(bare.status, 1, bare.stderr);
  assert.equal(bare.findings[0].rule, 'image-hash-assert');
  assert.equal(bare.findings[0].line, 3);
  for (const replacement of ['raw-tolerance', 'prepared-file-reuse', 'corruption-check']) {
    const ok = run('a.test.mjs', webp(`${MARK}replacement=${replacement}; compared as raw pixels`));
    assert.equal(ok.status, 0, JSON.stringify(ok.findings));
    assert.deepEqual(ok.summary, { files: 1, findings: 0 });
  }
});

test('an invalid replacement value still fails, with its own rule', () => {
  const r = run('a.test.mjs', webp(`${MARK}replacement=trust-me; fine`));
  assert.equal(r.status, 1);
  assert.equal(r.findings[0].rule, 'image-hash-assert-bad-replacement');
  assert.equal(run('a.test.mjs', webp(`${MARK}raw-tolerance`)).status, 1);
});

test('the marker may sit on the assertion line', () => {
  const text = `// webp output\nassert.equal(${HASHER}.update(out).digest('hex'), want); // ${MARK}replacement=corruption-check; truncation guard\n`;
  assert.equal(run('a.test.mjs', text).status, 0);
});

test('python and ts assertions are covered', () => {
  const py = `# encoded png output\nself.assertEqual(hashlib.sha${'256'}(png_bytes).hexdigest(), GOLDEN)\n`;
  assert.equal(run('test_a.py', py).status, 1);
  const ts = `const mp4 = await exportClip();\nexpect(sha${'256'}Hex(mp4) === GOLDEN).toBe(true);\n`;
  assert.equal(run('a.test.ts', ts).status, 1);
});

test('hashes with no image output nearby, identity hashes and non-assertions pass', () => {
  assert.equal(
    run('a.test.mjs', `assert.equal(${HASHER}.update('a').digest('hex'), want);\n`).status,
    0,
  );
  assert.equal(
    run('a.test.mjs', `// png\nassert.equal(manifest.modelSha${'256'}, want);\n`).status,
    0,
  );
  assert.equal(
    run('a.test.mjs', `// webp\nconst h = ${HASHER}.update(out).digest('hex');\n`).status,
    0,
  );
  assert.equal(
    run(
      'a.test.mjs',
      `const encoder = 1;\nassert.equal(${HASHER}.update(encoder).digest('hex'), want);\n`,
    ).status,
    0,
  );
});

test('usage errors exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--files'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('the real repository run reports a summary', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  assert.ok(JSON.parse(r.stdout.trim().split('\n').at(-1)).files > 0);
});
