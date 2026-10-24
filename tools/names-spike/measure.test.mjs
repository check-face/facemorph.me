import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import {
  envelopeChunkBytes,
  selfSignedCert,
  startServer,
  summarizeScroll,
  summaryMarkdown,
} from './measure.mjs';

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, rejectUnauthorized: false, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('the local server counts requests and bytes per run and snapshots them at marks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'names-spike-test-'));
  const files = {
    'names.txt': Buffer.from('Charlotte\nOliver\n'.repeat(100)),
    'previews/a.jpg': Buffer.alloc(700, 1),
    'previews-pack-2/0.bin': Buffer.alloc(1500, 2),
  };
  const { server, port, runs } = await startServer((p) => files[p], selfSignedCert(dir));
  try {
    const names = await get(port, '/r/t1/names.txt', { 'accept-encoding': 'br' });
    assert.equal(names.headers['content-encoding'], 'br');
    assert.deepEqual(brotliDecompressSync(names.body), files['names.txt']);
    assert.equal((await get(port, '/r/t1/previews/a.jpg')).body.length, 700);
    assert.equal((await get(port, '/r/t1/mark?phase=first')).status, 204);
    await get(port, '/r/t1/previews-pack-2/0.bin');
    assert.equal((await get(port, '/r/t1/missing.jpg')).status, 404);
    assert.equal((await get(port, '/r/t2/previews/a.jpg')).status, 200);
    const t1 = runs.get('t1');
    assert.equal(t1.marks.first.requests, 2);
    assert.equal(t1.marks.first.bytes, names.body.length + 700);
    assert.deepEqual(t1.marks.first.byClass.previews, { requests: 1, bytes: 700 });
    assert.equal(t1.requests, 3);
    assert.deepEqual(t1.byClass['previews-pack-2'], { requests: 1, bytes: 1500 });
    assert.equal(runs.get('t2').requests, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the v2 envelope for a 36,864-byte latent is about 50 KB, as in the candidate evidence', () => {
  const latent = Buffer.alloc(36864, 7);
  const bytes = envelopeChunkBytes({
    latent,
    generationSha256: 'b'.repeat(64),
    modelSha256: 'a'.repeat(64),
    noiseSha256: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    bundleVersion: 'next-browser-cpu-v1',
  });
  assert.equal(bytes % 2, 0);
  // base64 of the latent alone is 49,152 bytes; the candidate's measured WebP envelope was 49,802.
  assert.ok(bytes > 49152 + 8 && bytes < 50500, String(bytes));
});

test('scroll summaries take the median over repeats per viewport, speed and alternative', () => {
  const run = (alt, rep, dropped, ms) => ({
    viewport: 'desktop',
    speed: 2400,
    alt,
    repeat: rep,
    network: '4g',
    cpuThrottle: 1,
    visibleTiles: 24,
    firstViewport: { ms, requests: 30, bytes: 1000, visiblePreviewBytes: 500 },
    scroll: {
      requests: 10,
      bytes: 5000,
      dropped,
      frames: 360,
      worstFrameMs: 20,
      longTasks: { count: dropped, ms: dropped * 60 },
      blankTileFraction: 0,
    },
  });
  const summary = summarizeScroll([
    run('files', 0, 1, 700),
    run('files', 1, 5, 900),
    run('files', 2, 2, 800),
    run('pack-24', 0, 0, 600),
  ]);
  assert.equal(summary.length, 2);
  const files = summary.find((x) => x.alt === 'files');
  assert.equal(files.repeats, 3);
  assert.equal(files.droppedFrames, 2);
  assert.equal(files.firstViewportMs, 800);
  assert.equal(files.longTaskMs, 120);
  assert.equal(summary.find((x) => x.alt === 'pack-24').droppedFrames, 0);
});

test('the summary renders without a browser run', () => {
  const md = summaryMarkdown({
    at: 'now',
    host: 'eris',
    browser: null,
    catalogue: {
      sha256: 'f'.repeat(64),
      names: 2,
      candidate: { raw: 10, gzip: 5, br: 4, live: null },
    },
    resultObject: { estimate: 129932 },
    shapes: [],
    previews: { count: 0, bytes: 0, median: null, atlases: {} },
    scrollSummary: [],
  });
  assert.match(md, /Names data-shape spike/);
  assert.match(md, /129932 B \(estimate\)/);
});
