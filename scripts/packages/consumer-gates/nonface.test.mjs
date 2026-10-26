import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertOnlyDeclaredRequests, runNonfaceProof } from './nonface.mjs';

test('non-face network admission rejects a detector on the same allowed developer host', () => {
  const origin = 'https://127.0.0.1:8765';
  const allowed = ['/converted/mapping.onnx'];
  assert.equal(
    assertOnlyDeclaredRequests({ requests: [{ url: origin + allowed[0] }] }, origin, allowed)
      .outcome,
    'pass',
  );
  assert.throws(
    () =>
      assertOnlyDeclaredRequests(
        { requests: [{ url: origin + '/converted/detector.onnx' }] },
        origin,
        allowed,
      ),
    /undeclared asset/,
  );
  assert.throws(
    () =>
      assertOnlyDeclaredRequests(
        { requests: [{ url: 'https://weights.example' + allowed[0] }] },
        origin,
        allowed,
      ),
    /undeclared origin/,
  );
});

test('a corrupt hand-off archive fails the actual proof before artifact admission or browser work', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nonface-rejected-archive-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const archive = join(root, 'handoff.zip');
  writeFileSync(archive, 'planted changed archive bytes');
  const out = join(root, 'evidence');
  const report = await runNonfaceProof({
    inputs: {
      handoff: { archive, sha256: 'a'.repeat(64) },
      release: { commit: 'b'.repeat(40), artifactDigest: 'c'.repeat(64) },
      releaseArtifact: join(root, 'must-not-be-opened'),
    },
    out,
  });
  assert.equal(report.outcome, 'fail');
  assert.match(report.errors[0], /Hand-off archive digest mismatch/);
  assert.equal(report.network, null);
  assert.equal(report.cells.cleanConsumer.outcome, 'untested');
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'sub-result-3.json'), 'utf8')), report);
});

test('network admission distinguishes runtime hashes that share a sanitized path template', () => {
  const origin = 'https://127.0.0.1:8765';
  const allowed = ['/runtime/assets/' + 'a'.repeat(64) + '/ort.wasm.min.mjs'];
  assert.equal(
    assertOnlyDeclaredRequests({ requests: [{ url: origin + allowed[0] }] }, origin, allowed)
      .outcome,
    'pass',
  );
  assert.throws(
    () =>
      assertOnlyDeclaredRequests(
        { requests: [{ url: origin + '/runtime/assets/' + 'b'.repeat(64) + '/ort.wasm.min.mjs' }] },
        origin,
        allowed,
      ),
    /undeclared asset/,
  );
});
