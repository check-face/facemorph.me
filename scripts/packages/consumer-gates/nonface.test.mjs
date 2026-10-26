import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('a pinned terms blocker stops the actual proof before release, model or consumer admission', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nonface-blocked-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const blocked = JSON.stringify({
    outcome: 'unqualified',
    blocker: {
      kind: 'terms',
      reason: 'Redistribution not qualified',
      evidence: 'conversion.qualify recorded terms restriction',
    },
  });
  writeFileSync(join(root, 'blocked.json'), blocked);
  const archive = join(root, 'handoff.zip');
  writeFileSync(archive, 'planted blocked hand-off archive');
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const report = await runNonfaceProof({
    inputs: {
      handoff: {
        archive,
        dir: root,
        sha256: hash(readFileSync(archive)),
        blockedSha256: hash(blocked),
      },
      releaseArtifact: join(root, 'must-not-be-opened'),
    },
    out: join(root, 'evidence'),
  });
  assert.equal(report.outcome, 'untested');
  assert.equal(report.cells.nonface.support, 'unqualified');
  assert.equal(report.cells.nonface.blocker.kind, 'terms');
  assert.equal(report.cells.cleanConsumer.outcome, 'untested');
  assert.equal(report.cells.conversion.outcome, 'untested');
  assert.equal(report.network, null);
  assert.deepEqual(report.errors, []);
});
