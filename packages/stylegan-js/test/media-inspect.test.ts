// inspectStill: every kind, named as the bead's reader tests, on candidate-written fixtures and on files the
// package's own writers produce. The reader takes plain bytes and identities: it holds no engine, encoder or
// detector, so the only way a latent could reach compute is the `recovered` field, present only on matching.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/index.ts';
import { embedRecovery, inspectStill, type StillInspection } from '../src/index.ts';

const vector = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./vectors/${name}`, import.meta.url)));
const LOADED = { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) };
const OTHER = { modelSha256: '9'.repeat(64), noiseSha256: '3'.repeat(64) };
const models = { loaded: LOADED, known: [LOADED, OTHER] };
const inspect = (bytes: Uint8Array, m = models) => inspectStill(bytes, m);

function nonMatching(r: StillInspection, kind: StillInspection['kind'], bytes: Uint8Array) {
  assert.equal(r.kind, kind);
  assert.equal(r.recovered, undefined, `${kind} must not expose a latent`);
  assert.equal(r.image, bytes, `${kind} keeps the original bytes for Save/Share`);
  assert.ok(r.reason && r.reason.length > 10, `${kind} gives a plain reason`);
}

test('inspect-still.missing', () => {
  const plain = vector('plain.png');
  nonMatching(inspect(plain), 'missing', plain);
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70);
  const r = inspect(jpeg);
  nonMatching(r, 'missing', jpeg);
  assert.equal(r.container, 'other');
  assert.equal(r.photoActionAllowed, true); // offered as an explicit action, never automatic
});

test('inspect-still.damaged-truncated / -bitflip / -oversized', () => {
  const png = vector('stills/recovery-v2.png');
  const truncated = png.subarray(0, png.length - 30);
  nonMatching(inspect(truncated), 'damaged', truncated);
  const damaged = vector('stills/damaged-v1.png');
  nonMatching(inspect(damaged), 'damaged', damaged);
  const flip = png.slice();
  flip[Buffer.from(png).indexOf('latentSha256') + 20]! ^= 1;
  nonMatching(inspect(flip), 'damaged', flip);
  const big = embedRecovery(vector('plain.png'), {
    generationKind: 'seed',
    generationSha256: 'a'.repeat(64),
    provenance: LOADED,
    latent: { space: 'w-plus', shape: [18, 512], values: new Float32Array(18 * 512) },
  });
  // An envelope over the 512 KiB bound before any schema check.
  const pad = Buffer.concat([
    Buffer.from(big.subarray(0, big.length - 12)),
    chunk('tEXt', Buffer.concat([Buffer.from('FaceMorph\0'), Buffer.alloc(600 * 1024, 32)])),
    Buffer.from(big.subarray(big.length - 12)),
  ]);
  const r = inspect(new Uint8Array(pad));
  assert.equal(r.kind, 'damaged');
});

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  let n = 0xffffffff;
  for (const b of out.subarray(4, out.length - 4)) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  out.writeUInt32BE((n ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}

test('inspect-still.incompatible-schema', () => {
  const plain = vector('plain.png');
  const iend = plain.length - 12;
  const bytes = new Uint8Array(
    Buffer.concat([
      Buffer.from(plain.subarray(0, iend)),
      chunk('tEXt', Buffer.from('FaceMorph\0{"schema":9}')),
      Buffer.from(plain.subarray(iend)),
    ]),
  );
  const r = inspect(bytes);
  nonMatching(r, 'incompatible-schema', bytes);
  assert.match(r.reason!, /version 9/);
});

test('inspect-still.incompatible-model and .unknown-model', () => {
  const other = vector('stills/model-mismatch-v2.png');
  const r = inspect(other);
  nonMatching(r, 'incompatible-model', other);
  assert.deepEqual(r.modelIdentity, OTHER);
  const unknown = inspect(other, { loaded: LOADED, known: [LOADED] });
  nonMatching(unknown, 'unknown-model', other);
});

test('inspect-still.matching-schema1-png / -schema2-png / -schema2-webp', () => {
  const values = [];
  for (const name of [
    'stills/recovery-v1.png',
    'stills/recovery-v2.png',
    'stills/recovery-v2.webp',
  ]) {
    const r = inspect(vector(name));
    assert.equal(r.kind, 'matching', name);
    assert.equal(r.photoActionAllowed, false); // installs with its latent: no detector, no encoder
    values.push(r.recovered!.latent.values);
  }
  assert.deepEqual(values[0], values[1]);
  assert.deepEqual(values[1], values[2]);
});

test('inspect-still.mismatch-save-bytes-unchanged and .mismatch-latent-not-used', () => {
  for (const name of ['stills/model-mismatch-v2.png', 'stills/damaged-v1.png']) {
    const bytes = vector(name);
    const before = Buffer.from(bytes);
    const r = inspect(bytes);
    assert.notEqual(r.kind, 'matching');
    assert.ok(Buffer.from(r.image).equals(before), 'Save/Share hands over the original bytes');
    assert.equal(
      r.recovered,
      undefined,
      'no latent exists on a mismatch, so none can reach the engine',
    );
    assert.ok(Buffer.from(bytes).equals(before), 'the input is not modified');
  }
  // The reader's whole surface: it takes bytes and identities, and exports nothing that runs compute.
  assert.equal(inspectStill.length, 2);
  assert.ok(!('engine' in api) && !('encode' in api) && !('detect' in api));
});

test('inspect-still.no-metadata-url-fetch: URLs in metadata are inert', () => {
  const withUrl = embedRecovery(vector('plain.png'), {
    generationKind: 'seed',
    generationSha256: 'a'.repeat(64),
    provenance: {
      ...LOADED,
      bundleVersion: 'https://evil.example/model.onnx',
      route: 'https://evil.example/x',
    },
    latent: { space: 'w-plus', shape: [18, 512], values: new Float32Array(18 * 512) },
  });
  assert.equal(inspect(withUrl).kind, 'matching');
  // No module on the reader's path can reach the network (the browser test intercepts requests too).
  for (const file of [
    'src/media/inspect-still.ts',
    'src/media/envelope.ts',
    'src/contracts/recovery-metadata.ts',
    'src/contracts/sha256.ts',
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(
      /\/\/.*$/gm,
      '',
    );
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(/,
      file,
    );
  }
});
