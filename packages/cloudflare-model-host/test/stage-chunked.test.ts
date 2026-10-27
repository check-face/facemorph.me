// A bundle whose large asset exists only as its chunks, as model-conv writes it (`file` names the whole asset, which
// is not on disk; `chunks` name the pieces that are). Staging publishes the chunks and must drop `file`, or the staged
// manifest fails the manager's contract (fm-19eb: found by the host docs test staging converted AFHQ cat).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { CHUNK_BYTES, stage } from '../src/index.ts';

const BASE = 'https://models.example.test/runtime';
const scratch = new Set<string>();
const tmp = (p: string) => {
  const root = mkdtempSync(join(tmpdir(), `model-host-${p}-`));
  scratch.add(root);
  return root;
};
after(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function bytes(n: number, seed: string): Buffer {
  const out = Buffer.allocUnsafe(n);
  let block = createHash('sha256').update(seed).digest();
  for (let at = 0; at < n; at += 32) {
    block.copy(out, at, 0, Math.min(32, n - at));
    block = createHash('sha256').update(block).digest();
  }
  return out;
}

test('a chunks-only asset stages to its chunks with no leftover `file`, and the staged manifest passes', () => {
  const dir = tmp('chunks-only');
  const put = (rel: string, b: Buffer) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), b);
    return { file: rel, sha256: sha(b), size: b.length };
  };
  const whole = bytes(2 * CHUNK_BYTES + 12345, 'synthesis');
  const pieces = [
    whole.subarray(0, CHUNK_BYTES),
    whole.subarray(CHUNK_BYTES, 2 * CHUNK_BYTES),
    whole.subarray(2 * CHUNK_BYTES),
  ];
  const chunks = pieces.map((p) => put(`chunks/${sha(p)}.bin`, Buffer.from(p)));
  const noise = put('noise_0.f32', bytes(64, 'noise'));
  const manifest = {
    schemaVersion: 1,
    bundleVersion: 'chunks-only-v1',
    modelSourceSha256: 'a'.repeat(64),
    noiseSha256: sha(Buffer.from(noise.sha256)),
    mapping: put('mapping.onnx', bytes(1000, 'mapping')),
    // The whole synthesis.onnx is deliberately absent from disk: only its chunks exist.
    synthesis: { file: 'synthesis.onnx', sha256: sha(whole), size: whole.length, chunks },
    noise: [{ ...noise, name: 'noise_0', shape: [1, 1, 4, 4] }],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

  const out = tmp('chunks-only-out');
  const r = stage({ source: dir, out, base: BASE });
  assert.equal(r.chunked, 1);
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(m.synthesis.file, undefined, 'the staged asset keeps no source `file`');
  assert.equal(m.synthesis.url, `${BASE}/synthesis.onnx`);
  assert.equal(m.synthesis.chunks.length, 3);
  for (const c of m.synthesis.chunks)
    assert.match(c.url, /^https:\/\/models\.example\.test\/runtime\/chunks\/[0-9a-f]{64}\.bin$/);
});
