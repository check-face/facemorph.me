import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseRecoveryMetadata, type RecoveryReadResult } from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./vectors/${name}`, import.meta.url)));
const latent = new Float32Array(fixture('recovery-latent.f32').buffer);

function crc32(bytes: Uint8Array): number {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}

/** A PNG with one FaceMorph tEXt chunk holding `json`, inserted before IEND. */
function pngWith(json: string, plain = fixture('plain.png')): Uint8Array {
  const payload = Buffer.concat([Buffer.from('FaceMorph\0'), Buffer.from(json)]);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write('tEXt', 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const iend = plain.length - 12;
  return new Uint8Array(Buffer.concat([plain.subarray(0, iend), chunk, plain.subarray(iend)]));
}

/** The recovery record the candidate embedded in recovery.png. */
function embeddedRecord(): Record<string, unknown> {
  const bytes = Buffer.from(fixture('recovery.png'));
  const at = bytes.indexOf('FaceMorph\0');
  const size = bytes.readUInt32BE(at - 8);
  return JSON.parse(bytes.subarray(at + 10, at - 4 + size + 4).toString('utf8'));
}

const kind = (r: RecoveryReadResult) => (r.kind === 'damaged' ? `damaged:${r.reason}` : r.kind);

test('parsed: the candidate writer\'s PNG and WebP envelopes', () => {
  for (const ext of ['png', 'webp']) {
    const r = parseRecoveryMetadata(fixture(`recovery.${ext}`));
    assert.equal(r.kind, 'parsed', ext);
    if (r.kind !== 'parsed') continue;
    const m = r.metadata;
    assert.equal(m.mime, `image/${ext}`);
    assert.deepEqual([m.width, m.height, m.schemaVersion, m.generationKind, m.seed], [1024, 1024, 2, 'seed', 42]);
    assert.deepEqual(m.latent.shape, [18, 512]);
    assert.deepEqual(m.latent.values, latent);
    assert.equal(m.provenance.modelSha256, '2'.repeat(64));
    assert.equal(m.provenance.truncationPsi, 0.7);
    assert.deepEqual(m.baseImage, fixture(`plain.${ext}`));
  }
});

test('missing: images without an envelope, and formats that cannot carry one', () => {
  for (const bytes of [fixture('plain.png'), fixture('plain.webp'), new Uint8Array(0), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])]) {
    assert.deepEqual(parseRecoveryMetadata(bytes), { kind: 'missing' });
  }
});

test('incompatible-schema: legacy schema 1 and future schemas', () => {
  assert.deepEqual(parseRecoveryMetadata(pngWith('{"schema":1,"latent":[]}')), { kind: 'incompatible-schema', schemaVersion: 1 });
  assert.deepEqual(parseRecoveryMetadata(pngWith(JSON.stringify({ ...embeddedRecord(), schema: 3 }))), { kind: 'incompatible-schema', schemaVersion: 3 });
});

test('damaged: each failure has its reason', () => {
  const png = fixture('recovery.png');
  const crcBroken = png.slice();
  const at = Buffer.from(png).indexOf('FaceMorph\0');
  crcBroken[at + 40]! ^= 1; // inside the chunk, so its CRC no longer matches
  const latentFlip = embeddedRecord();
  const data = (latentFlip.latent as { data: string }).data;
  (latentFlip.latent as { data: string }).data = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
  const twice = pngWith(JSON.stringify(embeddedRecord()), png);
  const cases: [Uint8Array, string][] = [
    [crcBroken, 'damaged:checksum'],
    [png.subarray(0, png.length - 5), 'damaged:container'],
    [twice, 'damaged:duplicate-metadata'],
    [pngWith('{not json'), 'damaged:unreadable-json'],
    [pngWith('[1,2]'), 'damaged:unreadable-json'],
    [pngWith(JSON.stringify(latentFlip)), 'damaged:integrity'],
    [pngWith(JSON.stringify({ ...embeddedRecord(), imageSha256: '0'.repeat(64) })), 'damaged:integrity'],
    [pngWith(JSON.stringify({ ...embeddedRecord(), width: 512 })), 'damaged:dimensions'],
    [pngWith(JSON.stringify({ ...embeddedRecord(), mime: 'image/webp' })), 'damaged:invalid-fields'],
    [pngWith(JSON.stringify({ ...embeddedRecord(), latent: { ...(embeddedRecord().latent as object), shape: [18, 256] } })), 'damaged:invalid-fields'],
    [pngWith(JSON.stringify({ ...embeddedRecord(), provenance: { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64), sourcePhoto: 'x' } })), 'damaged:invalid-fields'],
    [pngWith('{"schema":2,"pad":"' + 'x'.repeat(130 * 1024) + '"}'), 'damaged:metadata-too-large'],
  ];
  for (const [bytes, expected] of cases) assert.equal(kind(parseRecoveryMetadata(bytes)), expected);
});

test('the reader takes the latent shape from the record (no hard-coded 18x512)', () => {
  // A smaller latent with consistent hashes still parses with its own shape.
  const record = embeddedRecord();
  const values = new Float32Array(4 * 8).map((_, i) => i / 8);
  const raw = Buffer.from(values.buffer);
  record.latent = { space: 'w-plus', shape: [4, 8], encoding: 'float32-le-base64', data: raw.toString('base64') };
  record.latentSha256 = createHash('sha256').update(raw).digest('hex');
  const r = parseRecoveryMetadata(pngWith(JSON.stringify(record)));
  assert.equal(r.kind, 'parsed');
  if (r.kind === 'parsed') {
    assert.deepEqual(r.metadata.latent.shape, [4, 8]);
    assert.deepEqual(r.metadata.latent.values, values);
  }
});

test('fuzz (seed 20261024, 3000 cases): every mutation is a typed result, never an exception', () => {
  const random = mulberry32(20261024);
  const sources = [fixture('recovery.png'), fixture('recovery.webp')];
  const seen = new Map<string, number>();
  const cases = 3000;
  for (let i = 0; i < cases; i++) {
    const bytes = sources[i % 2]!.slice();
    const op = Math.floor(random() * 3);
    if (op === 0) for (let k = 0; k < 1 + Math.floor(random() * 8); k++) bytes[Math.floor(random() * bytes.length)]! ^= 1 << Math.floor(random() * 8);
    const mutated = op === 1 ? bytes.subarray(0, Math.floor(random() * bytes.length)) : op === 2 ? bytes.subarray(Math.floor(random() * 64)) : bytes;
    const result = parseRecoveryMetadata(mutated);
    seen.set(kind(result), (seen.get(kind(result)) ?? 0) + 1);
  }
  assert.equal([...seen.values()].reduce((a, b) => a + b), cases);
  for (const k of seen.keys()) assert.match(k, /^(missing|parsed|incompatible-schema|damaged:[a-z-]+)$/);
  console.log(`recovery-metadata fuzz: ${cases} cases`, Object.fromEntries(seen));
});

test('record fuzz (seed 7, 2000 cases): mutated fields inside a valid container are typed results', () => {
  const random = mulberry32(7);
  const record = embeddedRecord();
  const odd: unknown[] = [null, -1, 1.5, '', 'x', [], {}, true, 2 ** 53, '0'.repeat(64), [18, 512], [0, 512], [100000, 512]];
  const paths: string[][] = [['schema'], ['kind'], ['mime'], ['width'], ['height'], ['generationKind'], ['generationSha256'], ['seed'],
    ['imageSha256'], ['latentSha256'], ['provenance'], ['provenance', 'modelSha256'], ['provenance', 'route'], ['latent'],
    ['latent', 'space'], ['latent', 'shape'], ['latent', 'encoding'], ['latent', 'data']];
  const seen = new Map<string, number>();
  const cases = 2000;
  for (let i = 0; i < cases; i++) {
    const copy = structuredClone(record);
    for (let k = 0; k < 1 + Math.floor(random() * 3); k++) {
      const path = paths[Math.floor(random() * paths.length)]!;
      let target = copy as Record<string, unknown>;
      for (const key of path.slice(0, -1)) target = (target[key] && typeof target[key] === 'object' ? target[key] : (target[key] = {})) as Record<string, unknown>;
      const last = path.at(-1)!;
      if (random() < 0.2) delete target[last];
      else target[last] = odd[Math.floor(random() * odd.length)];
    }
    const result = parseRecoveryMetadata(pngWith(JSON.stringify(copy)));
    seen.set(kind(result), (seen.get(kind(result)) ?? 0) + 1);
    // Optional fields (seed, route) may legitimately change and still parse.
    assert.match(kind(result), /^(parsed|incompatible-schema|damaged:[a-z-]+)$/);
    if (result.kind === 'parsed') assert.equal(result.metadata.latent.values.length, result.metadata.latent.shape[0] * result.metadata.latent.shape[1]);
  }
  assert.ok((seen.get('damaged:invalid-fields') ?? 0) > cases / 2, 'the fuzz reaches field validation');
  console.log(`recovery record fuzz: ${cases} cases`, Object.fromEntries(seen));
});
