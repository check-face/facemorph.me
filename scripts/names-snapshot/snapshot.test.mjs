// The names snapshot (bead fm-old) against a real S3-compatible server (SeaweedFS in Docker, pinned) and two
// real local HTTP origins standing in for the two Workers, with a fault switch (404, 500, corrupt bytes,
// truncation) and per-path request counts. Planted files are random bytes. Skips (reported, not passed)
// when Docker is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { run, planManifest, formatManifest, keyOf, readObject, s3Client, sha256 } from './snapshot.mjs';
import { restore, select } from './restore.mjs';
import { checkRestore } from './check-restore.mjs';

const IMAGE = 'chrislusf/seaweedfs:3.97';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let docker = true;
try { execFileSync('docker', ['info'], { stdio: 'ignore' }); } catch { docker = false; }
const skip = !docker && 'docker unavailable';

let container, endpoint;
const client = () => s3Client({ endpoint, accessKeyId: 'test', secretAccessKey: 'test' });

// A static origin: serves planted files, counts requests per path, and applies faults.
// faults: path -> { mode: '404' | '500' | 'corrupt' | 'truncate', times } (times omitted: always)
function origin() {
  const files = new Map();
  const hits = new Map();
  const faults = new Map();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const f = faults.get(path);
    if (f && (f.times === undefined || f.times-- > 0)) {
      if (f.mode === '404') return res.writeHead(404).end();
      if (f.mode === '500') return res.writeHead(500).end();
      const body = files.get(path);
      if (f.mode === 'corrupt') { const b = Buffer.from(body); b[0] ^= 0xff; return res.writeHead(200).end(b); }
      if (f.mode === 'truncate') return res.writeHead(200).end(body.subarray(0, body.length >> 1));
    }
    const body = files.get(path);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-length': body.length }).end(body);
  });
  return {
    files, hits, faults, server,
    total: () => [...hits.values()].reduce((a, b) => a + b, 0),
    reset() { hits.clear(); faults.clear(); },
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
  };
}

const seedOrigin = origin();
const catOrigin = origin();
let rows, seedUrl, catUrl;
const NAMES = ['charlotte', 'zoë', 'mary ann', 'saanvi'];

// Plant both Workers' files and inventories, shaped like the published ones.
function plant() {
  const put = (o, path, bytes) => { o.files.set(`/${path}`, bytes); return { size: bytes.length, sha256: sha256(bytes) }; };
  const names = NAMES.map((v) => ({ name: v, value: v, id: sha256(Buffer.from(v)) }));
  const entries = [];
  for (const n of names) {
    const p = `outputImages/hash-${n.id.slice(0, 2)}/${n.id.slice(2, 4)}/hash-${n.id}_200.jpg`;
    const f = put(seedOrigin, p, randomBytes(700));
    entries.push({ identity: `hash-${n.id}`, dimension: 200, format: 'jpg', sha256: f.sha256, bytes: f.size, sourceRelativePath: p });
  }
  for (const n of names.slice(0, 2)) {
    const p = `outputImages/hash-${n.id.slice(0, 2)}/${n.id.slice(2, 4)}/hash-${n.id}_1024.webp`;
    const f = put(seedOrigin, p, randomBytes(3000));
    entries.push({ identity: `hash-${n.id}`, dimension: 1024, format: 'webp', sha256: f.sha256, bytes: f.size, sourceRelativePath: p });
  }
  for (const s of [0, 1, 2, 3]) {
    const p = `outputImages/s${s}/${s}/s${s}_1024.webp`;
    const f = put(seedOrigin, p, s === 3 ? Buffer.alloc(0) : randomBytes(2500)); // s3: published empty, like one real object
    entries.push({ identity: `s${s}`, dimension: 1024, format: 'webp', sha256: f.sha256, bytes: f.size, sourceRelativePath: p });
  }
  const seedJson = { version: 'test', entries };
  const seedBytes = Buffer.from(JSON.stringify(seedJson));
  put(seedOrigin, 'manifest.json', seedBytes);

  const catalogueJson = { version: 'test', names };
  const catalogueBytes = Buffer.from(JSON.stringify(catalogueJson));
  const files = [{ path: 'catalogue.json', ...put(catOrigin, 'catalogue.json', catalogueBytes) }];
  for (const n of names.slice(2)) files.push({ path: `full/${n.id}.jpg`, ...put(catOrigin, `full/${n.id}.jpg`, randomBytes(2800)) });
  for (const n of names) files.push({ path: `latent/${n.id}.f32`, ...put(catOrigin, `latent/${n.id}.f32`, randomBytes(36864)) });
  const ledgerJson = { publicNameCount: names.length, files };
  const ledgerBytes = Buffer.from(JSON.stringify(ledgerJson));
  put(catOrigin, 'ledger.json', ledgerBytes);

  return planManifest(
    { origin: seedUrl, inventory: 'manifest.json', bytes: seedBytes, json: seedJson },
    { origin: catUrl, inventory: 'ledger.json', bytes: ledgerBytes, json: ledgerJson, catalogueBytes, catalogueJson },
  ).rows;
}

const reset = () => { seedOrigin.reset(); catOrigin.reset(); };
const originHits = () => seedOrigin.total() + catOrigin.total();
const hitsFor = (url) => (url.startsWith(seedUrl) ? seedOrigin : catOrigin).hits.get(new URL(url).pathname) ?? 0;
const fault = (url, f) => (url.startsWith(seedUrl) ? seedOrigin : catOrigin).faults.set(new URL(url).pathname, f);
let bucketN = 0;
async function bucket() {
  const b = `snap${++bucketN}`;
  await client().send(new CreateBucketCommand({ Bucket: b }));
  return b;
}
// A fresh bucket holding the complete snapshot, faults cleared.
async function storedBucket() {
  const b = await bucket();
  reset();
  assert.equal((await run({ rows, client: client(), bucket: b })).complete, true);
  return b;
}

before(async () => {
  seedUrl = await seedOrigin.listen();
  catUrl = await catOrigin.listen();
  rows = plant();
  if (!docker) return;
  container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::8333', IMAGE, 'server', '-s3', '-dir=/data', '-ip.bind=0.0.0.0'], { encoding: 'utf8' }).trim();
  const port = execFileSync('docker', ['port', container, '8333/tcp'], { encoding: 'utf8' }).trim().split('\n')[0].split(':').pop();
  endpoint = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { await client().send(new CreateBucketCommand({ Bucket: 'probe' })); return; } catch { await sleep(1000); }
  }
  throw new Error('SeaweedFS did not start');
});
after(() => {
  seedOrigin.server.close();
  catOrigin.server.close();
  if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
});

test('first run stores every object, each fetched once and read back with its digest', { skip }, async () => {
  const b = await bucket();
  reset();
  const r = await run({ rows, client: client(), bucket: b });
  assert.equal(r.complete, true);
  assert.equal(r.fetched, rows.length);
  assert.equal(originHits(), rows.length);
  for (const row of rows) assert.equal(sha256(await readObject(client(), b, keyOf(row.url))), row.sha256);
});

test('a re-run downloads nothing already verified', { skip }, async () => {
  const b = await storedBucket();
  reset();
  const r = await run({ rows, client: client(), bucket: b });
  assert.equal(r.complete, true);
  assert.equal(r.verified, rows.length);
  assert.equal(r.fetched, 0);
  assert.equal(originHits(), 0);
});

test('a corrupted object is detected by digest and re-fetched; nothing else is fetched', { skip }, async () => {
  const b = await storedBucket();
  const victim = rows.find((r) => r.url.includes('/latent/'));
  const bad = Buffer.from(await readObject(client(), b, keyOf(victim.url)));
  bad[100] ^= 0x01; // same size, one bit flipped
  await client().send(new PutObjectCommand({ Bucket: b, Key: keyOf(victim.url), Body: bad }));
  reset();
  const verify = await run({ rows, client: client(), bucket: b, verifyOnly: true });
  assert.deepEqual(verify.problems.corrupt, [victim.url]);
  assert.equal(originHits(), 0);
  const r = await run({ rows, client: client(), bucket: b });
  assert.equal(r.complete, true);
  assert.equal(r.refetchedCorrupt, 1);
  assert.equal(r.verified, rows.length - 1);
  assert.equal(originHits(), 1);
  assert.equal(hitsFor(victim.url), 1);
  assert.equal(sha256(await readObject(client(), b, keyOf(victim.url))), victim.sha256);
});

test('an object missing at the source is reported and the run is incomplete; the rest are stored', { skip }, async () => {
  const b = await bucket();
  const victim = rows.find((r) => r.url.endsWith('_200.jpg'));
  reset();
  fault(victim.url, { mode: '404' });
  const r = await run({ rows, client: client(), bucket: b });
  assert.equal(r.complete, false);
  assert.deepEqual(r.problems.missing, [victim.url]);
  assert.equal(r.fetched, rows.length - 1);
  assert.equal(await readObject(client(), b, keyOf(victim.url)), null);
  reset();
  const v = await run({ rows, client: client(), bucket: b, verifyOnly: true });
  assert.deepEqual(v.problems.absent, [victim.url]);
  assert.equal(originHits(), 0);
});

test('source faults: a transient 500 and a truncated body are retried; persistently wrong bytes are never stored', { skip }, async () => {
  const b = await bucket();
  const [flaky, cut, wrong] = rows.filter((r) => r.url.includes('/outputImages/s'));
  reset();
  fault(flaky.url, { mode: '500', times: 1 });
  fault(cut.url, { mode: 'truncate', times: 1 });
  fault(wrong.url, { mode: 'corrupt' });
  const r = await run({ rows, client: client(), bucket: b, attempts: 2 });
  assert.equal(r.complete, false);
  assert.deepEqual(r.problems['source-mismatch'], [wrong.url]);
  assert.equal(await readObject(client(), b, keyOf(wrong.url)), null);
  assert.equal(sha256(await readObject(client(), b, keyOf(flaky.url))), flaky.sha256);
  assert.equal(sha256(await readObject(client(), b, keyOf(cut.url))), cut.sha256);
  assert.equal(hitsFor(flaky.url), 2);
  assert.equal(hitsFor(cut.url), 2);
});

test('a write that does not land is caught by the read-back; nothing is counted stored', { skip }, async () => {
  reset();
  // SeaweedFS accepts a PutObject to a bucket that does not exist, but the object is never readable.
  const r = await run({ rows, client: client(), bucket: 'no-such-bucket-fm-old' });
  assert.equal(r.complete, false);
  assert.equal(r.problems['store-mismatch'].length, rows.length);
  assert.equal(r.fetched, 0);
});

test('an unreachable store reports each row as a store error without aborting the run', async () => {
  const closed = createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r)); // nothing listens on this port now
  reset();
  const dead = s3Client({ endpoint: `http://127.0.0.1:${port}`, accessKeyId: 'test', secretAccessKey: 'test' });
  const r = await run({ rows: rows.slice(0, 3), client: dead, bucket: 'any' });
  assert.equal(r.complete, false);
  assert.equal(r.problems['store-error'].length, 3);
  assert.equal(originHits(), 0);
});

test('restore rebuilds a sample from the snapshot with matching hashes; a corrupted object is refused', { skip }, async () => {
  const b = await storedBucket();
  const out = mkdtempSync(join(tmpdir(), 'fm-old-restore-test-'));
  try {
    const sample = select(rows, { sample: 6 });
    const r = await restore({ rows: sample, client: client(), bucket: b, out });
    assert.equal(r.complete, true);
    assert.equal(r.restored, 6);
    for (const row of sample) assert.equal(sha256(readFileSync(join(out, keyOf(row.url)))), row.sha256);

    const victim = rows.find((x) => x.name === 'saanvi' && x.url.includes('/latent/'));
    await client().send(new PutObjectCommand({ Bucket: b, Key: keyOf(victim.url), Body: randomBytes(victim.bytes) }));
    const out2 = join(out, 'second');
    const r2 = await restore({ rows: select(rows, { names: ['saanvi'] }), client: client(), bucket: b, out: out2 });
    assert.equal(r2.complete, false);
    assert.deepEqual(r2.mismatch, [victim.url]);
    assert.equal(existsSync(join(out2, keyOf(victim.url))), false);
    assert.equal(r2.restored, 2); // preview and full still restore
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('restore check: intercepted connections show zero to api.facemorph.me, checkface.facemorph.me or a source Worker', { skip }, async () => {
  const b = await storedBucket();
  const dir = mkdtempSync(join(tmpdir(), 'fm-old-check-test-'));
  try {
    const manifest = join(dir, 'manifest.tsv');
    writeFileSync(manifest, formatManifest(rows));
    const env = { ...process.env, S3_ENDPOINT: endpoint, S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test' };
    const sources = [new URL(seedUrl).host, new URL(catUrl).host];
    const store = new URL(endpoint).host;
    reset();
    const r = await checkRestore({ args: [`--bucket=${b}`, `--manifest=${manifest}`, '--names=charlotte,zoë'], env, store, sources });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.pass, true);
    assert.equal(r.result.restored, 6);
    assert.ok(r.byClass.store.connections > 0 && r.byClass.store.bytes > r.result.bytes);
    assert.deepEqual(r.byClass['retired-api'], { connections: 0, bytes: 0 });
    assert.deepEqual(r.byClass['source-worker'], { connections: 0, bytes: 0 });
    assert.equal(originHits(), 0);

    // Control: the same recorder classifies a connection to a source origin; a restore that reached one fails.
    const probe = join(dir, 'probe.mjs');
    writeFileSync(probe, `await (await fetch(${JSON.stringify(`${catUrl}/ledger.json`)})).arrayBuffer();`);
    const record = join(dir, 'probe.jsonl');
    // Async: the origin answering this probe runs in this process.
    await promisify(execFile)(process.execPath, ['--import', new URL('./net-recorder.mjs', import.meta.url).pathname, probe], { env: { ...env, NET_RECORD: record } });
    const { classify, tally } = await import('./net-recorder.mjs');
    const seen = tally(readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), (c) => classify(c, { store, sources }));
    assert.equal(seen['source-worker'].connections, 1);
    assert.ok(seen['source-worker'].bytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
