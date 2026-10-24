// Pure logic of the names snapshot (bead fm-old), called with plain values: manifest planning from the two
// inventories, the manifest file format, restore selection and host classification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planManifest,
  formatManifest,
  parseManifest,
  summarize,
  keyOf,
  sha256,
} from './snapshot.mjs';
import { select } from './restore.mjs';
import { classify, tally } from './net-recorder.mjs';

const SEED = 'https://seed.example';
const CAT = 'https://cat.example';
const digest = (s) => sha256(Buffer.from(s));

// Inventories shaped like the published ones, for the given lowercase names.
function inventories(values, { dropLatent } = {}) {
  const names = values.map((v) => ({ name: v, value: v, id: digest(v) }));
  const catalogueJson = { version: 't', names };
  const catalogueBytes = Buffer.from(JSON.stringify(catalogueJson));
  const entries = [
    ...names.map((n) => ({
      identity: `hash-${n.id}`,
      dimension: 200,
      format: 'jpg',
      sha256: digest(`p${n.id}`),
      bytes: 10,
      sourceRelativePath: `outputImages/hash-${n.id.slice(0, 2)}/${n.id.slice(2, 4)}/hash-${n.id}_200.jpg`,
    })),
    {
      identity: `hash-${names[0].id}`,
      dimension: 1024,
      format: 'webp',
      sha256: digest('f0'),
      bytes: 20,
      sourceRelativePath: `outputImages/hash-x/hash-${names[0].id}_1024.webp`,
    },
    {
      identity: 's7',
      dimension: 1024,
      format: 'webp',
      sha256: digest('s7'),
      bytes: 30,
      sourceRelativePath: 'outputImages/s7/7/s7_1024.webp',
    },
    {
      identity: 's8',
      dimension: 1024,
      format: 'webp',
      sha256: digest(''),
      bytes: 0,
      sourceRelativePath: 'outputImages/s8/8/s8_1024.webp',
    },
  ];
  const files = [
    { path: 'catalogue.json', size: catalogueBytes.length, sha256: sha256(catalogueBytes) },
    ...names
      .slice(1)
      .map((n) => ({ path: `full/${n.id}.jpg`, size: 40, sha256: digest(`j${n.id}`) })),
    ...names
      .filter((n) => n.value !== dropLatent)
      .map((n) => ({ path: `latent/${n.id}.f32`, size: 36864, sha256: digest(`l${n.id}`) })),
  ];
  const seedJson = { version: 's', entries };
  const ledgerJson = { publicNameCount: names.length, files };
  return [
    {
      origin: SEED,
      inventory: 'manifest.json',
      bytes: Buffer.from(JSON.stringify(seedJson)),
      json: seedJson,
    },
    {
      origin: CAT,
      inventory: 'ledger.json',
      bytes: Buffer.from(JSON.stringify(ledgerJson)),
      json: ledgerJson,
      catalogueBytes,
      catalogueJson,
    },
  ];
}

test('plan: one row per published object plus both inventories, every name covered', () => {
  const { rows, coverage, defects } = planManifest(
    ...inventories(['charlotte', 'zoë', 'mary ann']),
  );
  // seed: inventory + 3 previews + 1 full + 2 seeds; catalogue: inventory + catalogue.json + 2 full + 3 latents
  assert.equal(rows.length, 7 + 7);
  assert.deepEqual(coverage, { names: 3, preview200: 3, full1024: 3, latent: 3, seeds: 2 });
  assert.deepEqual(defects, [
    {
      url: `${SEED}/outputImages/s8/8/s8_1024.webp`,
      name: 'seed:8',
      defect: 'empty object (published with 0 bytes)',
    },
  ]);
  assert.equal(rows.filter((r) => r.name === 'zoë').length, 3);
  assert.equal(rows.find((r) => r.url.endsWith('/s7_1024.webp')).name, 'seed:7');
  assert.equal(rows.find((r) => r.url === `${SEED}/manifest.json`).name, '');
  const [, cat] = inventories(['charlotte', 'zoë', 'mary ann']);
  assert.equal(rows.find((r) => r.url === `${CAT}/ledger.json`).sha256, sha256(cat.bytes));
});

test('plan: a name whose id is not the SHA-256 of its lowercase value is rejected', () => {
  const [seed, cat] = inventories(['charlotte']);
  cat.catalogueJson.names[0].value = 'Charlotte';
  assert.throws(() => planManifest(seed, cat), /invalid name identity/);
  const [seed2, cat2] = inventories(['charlotte']);
  cat2.catalogueJson.names[0].id = digest('other');
  assert.throws(() => planManifest(seed2, cat2), /invalid name identity|unpublished name/);
});

test('plan: a published name without a latent is rejected', () => {
  assert.throws(
    () => planManifest(...inventories(['charlotte', 'saanvi'], { dropLatent: 'saanvi' })),
    /1 published name\(s\) lack/,
  );
});

test('plan: catalogue.json bytes must match their ledger row', () => {
  const [seed, cat] = inventories(['charlotte']);
  cat.catalogueBytes = Buffer.from('{}');
  assert.throws(() => planManifest(seed, cat), /catalogue.json does not match/);
});

test('plan: an unknown path in either inventory is rejected rather than skipped', () => {
  const [seed, cat] = inventories(['charlotte']);
  cat.json.files.push({ path: 'extra/x.bin', size: 1, sha256: digest('x') });
  assert.throws(() => planManifest(seed, cat), /unknown name-catalogue path/);
  const [seed2, cat2] = inventories(['charlotte']);
  seed2.json.entries.push({
    identity: 'guid-1',
    dimension: 1024,
    format: 'jpg',
    sha256: digest('g'),
    bytes: 1,
    sourceRelativePath: 'outputImages/g.jpg',
  });
  assert.throws(() => planManifest(seed2, cat2), /unknown seed-gallery identity/);
});

test('manifest: TSV round trip keeps every field; summary counts and bytes', () => {
  const { rows } = planManifest(...inventories(['charlotte', 'mary ann']));
  const text = formatManifest(rows);
  assert.equal(text.split('\n')[0], 'source_url\tname\tbytes\tsha256');
  assert.deepEqual(parseManifest(text), rows);
  const s = summarize(rows);
  assert.equal(s.objects, rows.length);
  assert.equal(
    s.bytes,
    rows.reduce((t, r) => t + r.bytes, 0),
  );
  assert.deepEqual(
    s.sources.map((x) => x.origin),
    [SEED, CAT],
  );
  assert.throws(() => parseManifest('url\tx\n'), /not a names-snapshot manifest/);
});

test('key: the source URL without its scheme, port kept', () => {
  assert.equal(
    keyOf('https://facemorph-name-catalogue.cdilga.workers.dev/latent/ab.f32'),
    'facemorph-name-catalogue.cdilga.workers.dev/latent/ab.f32',
  );
  assert.equal(keyOf('http://127.0.0.1:8080/full/x.jpg'), '127.0.0.1:8080/full/x.jpg');
});

test('restore selection: by names, a spread sample, or all; unknown names reported', () => {
  const { rows } = planManifest(...inventories(['charlotte', 'zoë', 'mary ann']));
  const byName = select(rows, { names: ['zoë', 'nobody'] });
  assert.equal(byName.length, 3);
  assert.deepEqual(byName.unknown, ['nobody']);
  const sample = select(rows, { sample: 4 });
  assert.equal(sample.length, 4);
  assert.equal(new Set(sample.map((r) => r.url)).size, 4);
  assert.equal(select(rows, { all: true }).length, rows.length);
  assert.throws(() => select(rows, {}), /select names/);
});

test('host classes: retired API hosts, source Workers, the store and other', () => {
  const opts = { store: 'acct.r2.cloudflarestorage.com', sources: ['127.0.0.1:9001'] };
  assert.equal(classify({ host: 'api.facemorph.me', port: 443 }, opts), 'retired-api');
  assert.equal(classify({ host: 'CheckFace.facemorph.me.', port: 443 }, opts), 'retired-api');
  assert.equal(classify({ host: 'x.api.facemorph.me', port: 443 }, opts), 'retired-api');
  assert.equal(classify({ host: 'facemorph.me', port: 443 }, opts), 'other');
  assert.equal(
    classify({ host: 'facemorph-seed-gallery.cdilga.workers.dev', port: 443 }, opts),
    'source-worker',
  );
  assert.equal(classify({ host: '127.0.0.1', port: 9001 }, opts), 'source-worker');
  assert.equal(classify({ host: '127.0.0.1', port: 9002 }, opts), 'other');
  assert.equal(classify({ host: 'acct.r2.cloudflarestorage.com', port: 443 }, opts), 'store');
  const t = tally(
    [
      { host: 'api.facemorph.me', port: 443, bytesWritten: 5, bytesRead: 7 },
      { host: 'acct.r2.cloudflarestorage.com', port: 443, bytesWritten: 1, bytesRead: 2 },
    ],
    (c) => classify(c, opts),
  );
  assert.deepEqual(t['retired-api'], { connections: 1, bytes: 12 });
  assert.deepEqual(t.store, { connections: 1, bytes: 3 });
});
