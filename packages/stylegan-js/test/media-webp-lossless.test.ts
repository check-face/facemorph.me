import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEBP_LOSSLESS_MAX_EDGE, encodeVp8lWebp } from '../src/media/webp-lossless.ts';

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const noise = (width: number, height: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4);
  let state = 12345;
  for (let i = 0; i < rgba.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    rgba[i] = state >>> 24;
  }
  return rgba;
};

test('writes RIFF, WEBP and a single VP8L chunk with consistent lengths', () => {
  for (const [width, height] of [
    [1, 1],
    [3, 7],
    [64, 33],
  ] as const) {
    const file = encodeVp8lWebp(noise(width, height), width, height);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    assert.equal(ascii(file, 0, 4), 'RIFF');
    assert.equal(view.getUint32(4, true), file.length - 8);
    assert.equal(ascii(file, 8, 4), 'WEBP');
    assert.equal(ascii(file, 12, 4), 'VP8L');
    const chunk = view.getUint32(16, true);
    assert.equal(file.length, 20 + chunk + (chunk & 1));
    assert.equal(file.length % 2, 0);
  }
});

test('header holds signature, 14-bit size minus one, alpha bit and version 0', () => {
  const opaque = new Uint8Array(300 * 17 * 4).fill(255);
  const a = encodeVp8lWebp(opaque, 300, 17);
  assert.equal(a[20], 0x2f);
  const bits = new DataView(a.buffer, a.byteOffset + 21, 4).getUint32(0, true);
  assert.equal(bits & 0x3fff, 299);
  assert.equal((bits >>> 14) & 0x3fff, 16);
  assert.equal((bits >>> 28) & 1, 0);
  assert.equal(bits >>> 29, 0);

  const translucent = opaque.slice();
  translucent[3] = 7;
  const b = encodeVp8lWebp(translucent, 300, 17);
  assert.equal((new DataView(b.buffer, b.byteOffset + 21, 4).getUint32(0, true) >>> 28) & 1, 1);
});

test('accepts the largest edge and a Uint8ClampedArray', () => {
  const wide = encodeVp8lWebp(
    new Uint8ClampedArray(WEBP_LOSSLESS_MAX_EDGE * 4),
    WEBP_LOSSLESS_MAX_EDGE,
    1,
  );
  const bits = new DataView(wide.buffer, wide.byteOffset + 21, 4).getUint32(0, true);
  assert.equal(bits & 0x3fff, WEBP_LOSSLESS_MAX_EDGE - 1);
  assert.ok(wide.length < 200);
});

test('flat images compress to far fewer bytes than the pixels', () => {
  const flat = new Uint8Array(512 * 512 * 4).fill(200);
  assert.ok(encodeVp8lWebp(flat, 512, 512).length < 1000);
});

test('rejects wrong lengths and sizes with a plain Error', () => {
  assert.throws(() => encodeVp8lWebp(new Uint8Array(15), 2, 2), {
    name: 'Error',
    message: /needs 16/,
  });
  assert.throws(() => encodeVp8lWebp(new Uint8Array(0), 0, 0), /outside 1\.\.16384/);
  assert.throws(() => encodeVp8lWebp(new Uint8Array(4), 1.5, 1), /outside 1\.\.16384/);
  assert.throws(() => encodeVp8lWebp(new Uint8Array(4), 16385, 1), /outside 1\.\.16384/);
  assert.throws(() => encodeVp8lWebp(new Uint8Array(4), 1, -1), /outside 1\.\.16384/);
});
