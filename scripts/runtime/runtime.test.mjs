// Runtime acquisition and pin checks against a real local HTTP server with a fault switch and a real
// temporary Git repository standing in for classic (planted files are inputs, not fakes).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../inventory/lib.mjs';
import { gitRepo, plant, run, tempDir } from '../inventory/testing.mjs';
import { acquire, sourceOf } from './acquire.mjs';
import { pinRows } from './check-pins.mjs';

const ACQUIRE = fileURLToPath(new URL('./acquire.mjs', import.meta.url));
const CHECK_PINS = fileURLToPath(new URL('./check-pins.mjs', import.meta.url));
const served = {
  'assets/aa/model.bin': Buffer.alloc(200000, 7),
  'chunks/bb.bin': Buffer.from('chunk bytes'),
};
const row = (path, bytes, location = `https://next.facemorph.me/runtime/${path}`) => ({
  path,
  sha256: sha256(bytes),
  bytes: bytes.length,
  location,
});

// fault: 'truncate' sends half of a file and drops the connection.
async function server() {
  const state = { fault: null, seen: [] };
  const srv = createServer((req, res) => {
    state.seen.push({ host: req.headers.host, url: req.url });
    const bytes = served[req.url.replace(/^\/runtime\//, '')];
    if (!bytes) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-length': bytes.length });
    if (state.fault === 'truncate' && bytes.length > 1000) {
      res.write(bytes.subarray(0, bytes.length / 2));
      res.destroy();
      return;
    }
    res.end(bytes);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { state, origin: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

function classicRepo() {
  const repo = gitRepo();
  const commit = repo.commit(
    { 'hosting/next-static/runtime-overlay/manifest.json': '{"schemaVersion":1}\n' },
    'overlay',
  );
  return {
    dir: repo.dir,
    commit,
    row: row(
      'manifest.json',
      Buffer.from('{"schemaVersion":1}\n'),
      'classic:hosting/next-static/runtime-overlay/manifest.json',
    ),
  };
}

const rows = () => Object.entries(served).map(([path, bytes]) => row(path, bytes));

test('without accepting the model terms it exits non-zero with the instruction and requests nothing', async () => {
  const s = await server();
  try {
    const r = run(ACQUIRE, ['--cache', tempDir('rt-'), '--origin', s.origin], {
      env: { ...process.env, ACCEPT_MODEL_TERMS: '' },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ACCEPT_MODEL_TERMS=yes/);
    assert.equal(s.state.seen.length, 0);
  } finally {
    s.close();
  }
});

test('a clean acquisition verifies every file, from the site and from classic Git objects, and asks only the site', async () => {
  const s = await server(),
    classic = classicRepo(),
    cache = tempDir('rt-');
  try {
    const result = await acquire({
      rows: [...rows(), classic.row],
      cache,
      origin: s.origin,
      classic: classic.dir,
      commit: classic.commit,
    });
    assert.deepEqual([result.fetched, result.failed.length], [3, 0]);
    assert.deepEqual(result.requests, { [new URL(s.origin).host]: 2 });
    assert.ok(s.state.seen.every((r) => r.url.startsWith('/runtime/')));
    assert.equal(sha256(readFileSync(join(cache, 'manifest.json'))), classic.row.sha256);
  } finally {
    s.close();
  }
});

test('an interrupted acquisition leaves no bad file and the next run fetches only what is missing', async () => {
  const s = await server(),
    cache = tempDir('rt-');
  try {
    s.state.fault = 'truncate';
    const first = await acquire({ rows: rows(), cache, origin: s.origin });
    assert.deepEqual(
      first.failed.map((f) => f.path),
      ['assets/aa/model.bin'],
    );
    assert.ok(
      !existsSync(join(cache, 'assets/aa/model.bin')) &&
        !existsSync(join(cache, 'assets/aa/model.bin.part')),
    );
    s.state.fault = null;
    const second = await acquire({ rows: rows(), cache, origin: s.origin });
    assert.deepEqual([second.kept, second.fetched, second.failed.length], [1, 1, 0]);
  } finally {
    s.close();
  }
});

test('a corrupted cached file is rejected by digest and fetched again', async () => {
  const s = await server(),
    cache = tempDir('rt-');
  try {
    await acquire({ rows: rows(), cache, origin: s.origin });
    writeFileSync(join(cache, 'chunks/bb.bin'), 'tampered');
    const again = await acquire({ rows: rows(), cache, origin: s.origin });
    assert.deepEqual([again.kept, again.replaced], [1, 1]);
    assert.equal(readFileSync(join(cache, 'chunks/bb.bin'), 'utf8'), 'chunk bytes');
  } finally {
    s.close();
  }
});

test('models.facemorph.me and any other host are refused before a request is made', async () => {
  const s = await server();
  try {
    const mirror = row(
      'chunks/bb.bin',
      served['chunks/bb.bin'],
      'https://models.facemorph.me/runtime/chunks/bb.bin',
    );
    assert.throws(() => sourceOf(mirror), /models\.facemorph\.me is not an acquisition source/);
    await assert.rejects(
      acquire({ rows: [...rows(), mirror], cache: tempDir('rt-'), origin: s.origin }),
      /not an acquisition source/,
    );
    assert.equal(s.state.seen.length, 0);
  } finally {
    s.close();
  }
});

test('check-pins fails on an altered runtime file and on an emitted chunk without a pin update, and passes clean', async () => {
  const s = await server(),
    cache = tempDir('rt-');
  try {
    await acquire({ rows: rows(), cache, origin: s.origin });
    const site = plant(tempDir('site-'), {
      '516.d885fffd08bf9a3aec53.js': 'worker',
      '825.d885fffd08bf9a3aec53.js': 'a',
      '744.d885fffd08bf9a3aec53.js': 'b',
    });
    const inputs = {
      runtime: { assets: rows() },
      worker_graphs: {
        emitted: [
          {
            source: 'src/Next/browser/ort-worker.mjs',
            control_chunk: '516.d885fffd08bf9a3aec53.js',
            control_sha256: sha256(Buffer.from('worker')),
          },
          {
            source: 'src/Next/Assets/model-cache.mjs',
            control_chunk:
              '825.d885fffd08bf9a3aec53.js (loaded by app) and 744.d885fffd08bf9a3aec53.js (loaded by workers)',
            control_sha256: `${sha256(Buffer.from('a'))} / ${sha256(Buffer.from('b'))}`,
          },
        ],
      },
    };
    const path = join(tempDir('inputs-'), 'inputs.json');
    writeFileSync(path, JSON.stringify(inputs));
    assert.equal(
      run(CHECK_PINS, ['--runtime', cache, '--emitted', site, '--inputs', path]).status,
      0,
    );
    assert.equal(pinRows(inputs, { emitted: site }).length, 3);
    writeFileSync(join(cache, 'chunks/bb.bin'), 'altered');
    const pinned = run(CHECK_PINS, ['--runtime', cache, '--inputs', path]);
    assert.equal(pinned.status, 1);
    assert.equal(pinned.summary.mismatches, 1);
    writeFileSync(join(site, '744.d885fffd08bf9a3aec53.js'), 'rebuilt');
    const emitted = run(CHECK_PINS, ['--emitted', site, '--inputs', path]);
    assert.equal(emitted.status, 1);
    assert.ok(
      emitted.lines.some(
        (l) =>
          l.graph === 'emitted' &&
          l.path === '744.d885fffd08bf9a3aec53.js' &&
          l.actual !== l.expected,
      ),
    );
  } finally {
    s.close();
  }
});
