import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as s from './shapes.mjs';

const hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const MODEL = 'a'.repeat(64), GEN = 'b'.repeat(64);
function catalogueOf(names, patch = () => {}) {
  const rows = names.map((name) => {
    const value = name.toLowerCase(), id = hex(value);
    return { name, value, id, latent: { url: `https://x.example/latent/${id}.f32`, sha256: hex(`latent:${value}`), size: 36864, space: 'w-plus', shape: [18, 512], modelSha256: MODEL, generationSha256: GEN } };
  });
  rows.forEach(patch);
  return { latentIdentity: 'pinned-mapping-numpy-z-truncation-0.7-8-v1', names: rows };
}

test('parseCatalogue keeps only the ordered names and the constants once', () => {
  const { rows, identity } = s.parseCatalogue(catalogueOf(['Charlotte', 'Oliver', 'Zoë']));
  assert.deepEqual(rows.map((r) => r.name), ['Charlotte', 'Oliver', 'Zoë']);
  assert.equal(rows[2].value, 'zoë');
  assert.equal(rows[0].id, hex('charlotte'));
  assert.deepEqual(identity, { modelSha256: MODEL, generationSha256: GEN, latentIdentity: 'pinned-mapping-numpy-z-truncation-0.7-8-v1' });
});

test('parseCatalogue refuses rows whose fields are not derivable or constant', () => {
  const cases = {
    'value is not the lowercased name': (r, i) => { if (i === 1) r.value = 'OLIVER'; },
    'id is not SHA-256': (r, i) => { if (i === 1) r.id = hex('other'); },
    'latent modelSha256 is not constant': (r, i) => { if (i === 1) r.latent.modelSha256 = 'c'.repeat(64); },
    'latent URL does not follow from id': (r, i) => { if (i === 1) r.latent.url = 'https://x.example/latent/other.f32'; },
    'latent shape': (r, i) => { if (i === 1) r.latent.shape = [512]; },
  };
  for (const [message, patch] of Object.entries(cases)) assert.throws(() => s.parseCatalogue(catalogueOf(['Charlotte', 'Oliver'], patch)), new RegExp(message));
  assert.throws(() => s.parseCatalogue(catalogueOf(['Ava', 'ava'])), /value is not the lowercased name|duplicate value/);
  assert.throws(() => s.parseCatalogue({ names: [] }), /no names/);
});

test('names text is one display name per line and round-trips to the request values', () => {
  const { rows } = s.parseCatalogue(catalogueOf(['Charlotte', 'Zoë', 'Mary-Jane']));
  const text = s.namesText(rows).toString('utf8');
  assert.equal(text, 'Charlotte\nZoë\nMary-Jane\n');
  assert.deepEqual(text.split('\n').slice(0, -1).map((n) => n.toLowerCase()), rows.map((r) => r.value));
});

test('block shards put row i at offset (i mod size) of shard floor(i / size)', () => {
  const digests = Array.from({ length: 10 }, (_, i) => createHash('sha256').update(String(i)).digest());
  const { size, shards } = s.blockShards(digests, 4);
  assert.equal(size, 3);
  assert.deepEqual(shards.map((b) => b.length), [96, 96, 96, 32]);
  digests.forEach((d, i) => {
    const at = (i % size) * 32;
    assert.deepEqual(shards[s.shardOf(i, size)].subarray(at, at + 32), d);
  });
});

test('integrity placements pin every lookup file from the manifest', () => {
  const digests = Array.from({ length: 9 }, (_, i) => createHash('sha256').update(`r${i}`).digest());
  const byKey = Object.fromEntries(s.integrityPlacements(digests, [3]).map((p) => [p.key, p]));
  assert.deepEqual(Object.keys(byKey), ['header', 'list', 'shards-3', 'inline']);
  assert.equal(byKey.header.files.length, 0);
  assert.equal(byKey.list.manifest.sha256, s.sha256Hex(Buffer.concat(digests)));
  assert.deepEqual(byKey['shards-3'].manifest.shards, byKey['shards-3'].files.map(s.sha256Hex));
  assert.equal(byKey.inline.namesSuffix[4], digests[4].toString('hex'));
});

test('pick costs: one result fetch plus at most one integrity lookup', () => {
  const digests = Array.from({ length: 100 }, (_, i) => createHash('sha256').update(`r${i}`).digest());
  const placements = Object.fromEntries(s.integrityPlacements(digests, [10]).map((p) => [p.key, p]));
  const cost = (key) => s.shapeCosts({ namesWire: 1000, manifestWire: 200, placement: placements[key], resultBytes: 120000, rowCount: 100 });
  assert.deepEqual(cost('header').firstPick, { requests: 1, bytes: 120000, integrityBytes: 0 });
  assert.deepEqual(cost('list').firstPick, { requests: 2, bytes: 123200, integrityBytes: 3200 });
  assert.deepEqual(cost('list').laterPick, { requests: 1, bytes: 120000 });
  assert.equal(cost('shards-10').firstPick.integrityBytes, 320);
  assert.equal(cost('shards-10').firstPick.requests, 2);
  for (const key of Object.keys(placements)) assert.ok(cost(key).firstPick.requests <= 2);
  assert.deepEqual(cost('header').firstPaint, { requests: 2, bytes: 1200 });
  assert.equal(cost('header').perNameFloor, 0);
  assert.equal(cost('list').perNameFloor, 3200);
});

test('wire sizes are deterministic and compress text', () => {
  const text = Buffer.from('Charlotte\nOliver\nAva\n'.repeat(200));
  const a = s.wire(text), b = s.wire(text);
  assert.deepEqual(a, b);
  assert.equal(a.raw, text.length);
  assert.ok(a.br < a.gzip && a.gzip < a.raw);
});

test('packs are byte-exact and reject damage', () => {
  const files = [Buffer.from([0xff, 0xd8, 1]), Buffer.alloc(7000, 9), Buffer.from('x')];
  const packed = s.pack(files);
  assert.equal(packed.length, 8 + 4 * 3 + 7004);
  assert.deepEqual(s.unpack(packed).map((v) => Buffer.from(v)), files);
  assert.throws(() => s.unpack(packed.subarray(0, packed.length - 1)), /Truncated pack body/);
  assert.throws(() => s.unpack(packed.subarray(0, 12)), /Truncated pack header/);
  assert.throws(() => s.unpack(Buffer.concat([packed, Buffer.from([0])])), /Trailing bytes/);
  assert.throws(() => s.unpack(Buffer.from('JUNKJUNK')), /Not a preview pack/);
  const all = s.packAll([files[0], files[1], files[2], files[0], files[1]], 2);
  assert.deepEqual(all.map((p) => s.unpack(p).length), [2, 2, 1]);
});

test('atlas grids tile exactly where K factorises', () => {
  assert.deepEqual(s.atlasGrid(24), { cols: 6, rows: 4 });
  assert.deepEqual(s.atlasGrid(12), { cols: 4, rows: 3 });
  assert.deepEqual(s.atlasGrid(48), { cols: 8, rows: 6 });
  assert.deepEqual(s.atlasGrid(7), { cols: 3, rows: 3 });
});

test('asset counts include the previous result set during a generation change', () => {
  const c = s.assetCount({ rowCount: 5055, integrityFiles: 64, previewFiles: 5055 });
  assert.equal(c.steady, 2 + 5055 + 64 + 5055);
  assert.equal(c.transition, c.steady + 5055 + 64 + 1);
  assert.equal(c.fits, true);
  assert.equal(s.assetCount({ rowCount: 9000, integrityFiles: 0, previewFiles: 2000 }).fits, false);
});

test('dropped frames count missed vsync intervals', () => {
  const t = [0, 17, 33, 67, 83, 150];
  assert.deepEqual(s.droppedFrames(t, 16.7), { frames: 5, dropped: 1 + 3, worstFrameMs: 67 });
  assert.equal(s.droppedFrames([0, 17, 33, 50], 16.7).dropped, 0);
  assert.equal(s.droppedFrames([0, 2 * (1000 / 120)], 1000 / 120).dropped, 1);
});

test('median', () => {
  assert.equal(s.median([3, 1, 2]), 2);
  assert.equal(s.median([4, 1, 2, 3]), 2.5);
  assert.equal(s.median([]), null);
});
