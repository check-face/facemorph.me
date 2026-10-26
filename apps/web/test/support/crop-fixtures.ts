// Synthetic photo fixtures for the confirmed-crop built-UI acceptance (fm-d4mw), generated at test time from files
// already in Git (no personal photos): the limit files are drawn shapes or noise, the qualification photo is solved
// from the e4e qualification input seed-0 (a generated face), and the EXIF variants rewrite only the orientation
// value of tests/crop/fixtures/oriented.jpg. Large files are never committed; each run records their digests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pillowBilinearRgb } from 'stylegan-js';

const repo = new URL('../../../../', import.meta.url).pathname;

const table = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let n = i;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    t[i] = n >>> 0;
  }
  return t;
})();
/** Table CRC for large chunks (the bitwise one above is fine for small ones). */
function crcFast(type: Buffer, data: Uint8Array): number {
  let n = 0xffffffff;
  for (const b of type) n = table[(n ^ b) & 0xff]! ^ (n >>> 8);
  for (let i = 0; i < data.length; i++) n = table[(n ^ data[i]!) & 0xff]! ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crcFast(Buffer.from(type, 'latin1'), data), 0);
  return Buffer.concat([head, data, tail]);
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (width: number, height: number, colorType: 0 | 2) => {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = 8;
  b[9] = colorType;
  return b;
};

/**
 * A PNG of `width` x `height` 8-bit pixels (`channels` 1 grey or 3 RGB), filter 0 on every row. `pixel(y, row)`
 * fills one row. With `padTo`, a private ancillary chunk (ignored by decoders) brings the file to exactly that size.
 */
export function png(
  width: number,
  height: number,
  channels: 1 | 3,
  pixel: (y: number, row: Uint8Array) => void,
  { level = 6, padTo }: { level?: number; padTo?: number } = {},
): Buffer {
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) pixel(y, raw.subarray(y * stride + 1, (y + 1) * stride));
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr(width, height, channels === 1 ? 0 : 2)),
    chunk('IDAT', deflateSync(raw, { level })),
  ];
  const iend = chunk('IEND', new Uint8Array(0));
  const size = parts.reduce((n, p) => n + p.length, 0) + iend.length;
  if (padTo !== undefined) {
    const fill = padTo - size - 12;
    if (fill < 0) throw Error(`png: ${size} bytes already exceeds ${padTo}`);
    parts.push(chunk('fmPd', Buffer.alloc(fill, 0x2e)));
  }
  return Buffer.concat([...parts, iend]);
}

/** A PNG whose header declares `width` x `height` but carries only a token of pixel data. */
export function headerOnlyPng(width: number, height: number): Buffer {
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr(width, height, 0)),
    chunk('IDAT', deflateSync(Buffer.alloc(width + 1))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Deterministic noise (xorshift32), so a large file compresses to about its raw size. */
export function noise(seed = 0x9e3779b9) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s & 0xff;
  };
}

/** seed-0 (512 x 512 packed RGB), the e4e qualification photo (packages/stylegan-js/test/vectors). */
export const seed0Rgb = () =>
  new Uint8Array(
    readFileSync(`${repo}packages/stylegan-js/test/vectors/candidate-preprocessing/seed-0.rgb`),
  );

/**
 * A noise photo of about `bytes` (stored deflate) with seed-0 pasted in the middle: large enough that the old
 * alignment route (25 MB) would refuse it, small enough for the crop path (64 MiB).
 */
export function largeNoisePhoto(bytes: number): {
  file: Buffer;
  width: number;
  height: number;
} {
  const width = 3000;
  // Rows of stored deflate (5 bytes per 64 KiB block) under `bytes`, the rest made up by the padding chunk.
  const height = Math.floor((bytes - 64 * 1024) / ((width * 3 + 1) * (1 + 5 / 65535)));
  const face = seed0Rgb();
  const next = noise();
  const x0 = (width - 512) >> 1,
    y0 = (height - 512) >> 1;
  const file = png(
    width,
    height,
    3,
    (y, row) => {
      for (let i = 0; i < row.length; i++) row[i] = next();
      if (y >= y0 && y < y0 + 512)
        row.set(face.subarray((y - y0) * 512 * 3, (y - y0 + 1) * 512 * 3), x0 * 3);
    },
    { level: 0, padTo: bytes },
  );
  return { file, width, height };
}

/**
 * A 1024 x 1024 RGB image whose confirmed-crop derivation (Pillow bilinear 1024 -> 256, both passes rounded) is
 * exactly Pillow bilinear 512 -> 256 of seed-0: the e4e qualification case seed-0-unaligned, whose native W+ the
 * runtime ships as its reference. It is seed-0 doubled by pixel repetition: the 4x triangle over doubled pixels has
 * the 2x triangle's weights pairwise, all dyadic, so both fixed-point passes agree to the bit (checked here). A
 * manual crop of the whole image in the built UI therefore encodes a tensor with a known native answer.
 */
export function qualificationPhoto(): { rgb: Uint8Array; file: Buffer } {
  const seed = seed0Rgb();
  const big = 1024;
  const rgb = new Uint8Array(big * big * 3);
  for (let y = 0; y < big; y++)
    for (let x = 0; x < big; x++)
      rgb.set(
        seed.subarray(((y >> 1) * 512 + (x >> 1)) * 3, ((y >> 1) * 512 + (x >> 1)) * 3 + 3),
        (y * big + x) * 3,
      );
  const want = pillowBilinearRgb(seed, 512, 512, 256, 256);
  if (!Buffer.from(pillowBilinearRgb(rgb, big, big, 256, 256)).equals(Buffer.from(want)))
    throw Error('qualificationPhoto: the doubled image does not reduce to seed-0-unaligned');
  return {
    rgb,
    file: png(big, big, 3, (y, row) => row.set(rgb.subarray(y * big * 3, (y + 1) * big * 3))),
  };
}

/** oriented.jpg with its EXIF Orientation value replaced by `value` (1-8); every other byte unchanged. */
export function withOrientation(jpeg: Uint8Array, value: number): Buffer {
  const out = Buffer.from(jpeg);
  let at = 2;
  while (at + 4 <= out.length) {
    if (out[at] !== 0xff) break;
    const marker = out[at + 1]!;
    const size = out.readUInt16BE(at + 2);
    if (marker === 0xe1 && out.toString('latin1', at + 4, at + 8) === 'Exif') {
      const base = at + 10;
      const little = out.toString('latin1', base, base + 2) === 'II';
      const u16 = (p: number) => (little ? out.readUInt16LE(p) : out.readUInt16BE(p));
      const u32 = (p: number) => (little ? out.readUInt32LE(p) : out.readUInt32BE(p));
      const dir = base + u32(base + 4);
      for (let j = 0, count = u16(dir); j < count; j++) {
        const p = dir + 2 + j * 12;
        if (u16(p) === 0x0112) {
          if (little) out.writeUInt16LE(value, p + 8);
          else out.writeUInt16BE(value, p + 8);
          return out;
        }
      }
    }
    at += 2 + size;
  }
  throw Error('withOrientation: no EXIF orientation tag');
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
