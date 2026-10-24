// Byte-exact decoding of the canary reference PNGs (fm-3h3w), ported from the candidate's browser/png.mjs
// decodeReferencePng() (classic a42829b): 8-bit RGB/RGBA, non-interlaced, every chunk's CRC checked, no
// canvas and no colour conversion, so the encoded samples are what the canary compares against.

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc(bytes: Uint8Array, start: number, end: number): number {
  let n = 0xffffffff;
  for (let i = start; i < end; i++)
    n = (TABLE[(n ^ (bytes[i] as number)) & 255] as number) ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export interface DecodedReference {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export async function decodeReferencePng(
  bytes: Uint8Array,
  {
    expectedWidth = 1024,
    expectedHeight = 1024,
  }: { expectedWidth?: number; expectedHeight?: number } = {},
): Promise<DecodedReference> {
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw Error('Reference PNG compressed size exceeds limit');
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x))
    throw Error('Invalid PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    idatEnded = false,
    chunkCount = 0;
  const parts: Uint8Array[] = [];
  while (pos < bytes.length) {
    if (++chunkCount > 4096) throw Error('Reference PNG chunk count exceeds limit');
    if (pos + 12 > bytes.length) throw Error('Truncated PNG chunk');
    const length = view.getUint32(pos),
      start = pos + 8,
      end = start + length;
    if (end + 4 > bytes.length) throw Error('Truncated PNG chunk data');
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]?.toUpperCase())
      throw Error('Invalid PNG chunk type');
    if (crc(bytes, pos + 4, end) !== view.getUint32(end)) throw Error('PNG CRC mismatch: ' + type);
    if (pos === 8 && type !== 'IHDR') throw Error('PNG must start with IHDR');
    if (type === 'IHDR') {
      if (width || length !== 13) throw Error('Invalid PNG IHDR');
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      const depth = bytes[start + 8],
        color = bytes[start + 9] as number;
      if (
        !width ||
        !height ||
        width > 2048 ||
        height > 2048 ||
        width !== expectedWidth ||
        height !== expectedHeight
      )
        throw Error('Unexpected reference PNG dimensions');
      if (
        depth !== 8 ||
        ![2, 6].includes(color) ||
        bytes[start + 10] ||
        bytes[start + 11] ||
        bytes[start + 12]
      )
        throw Error('Reference decoder requires 8-bit RGB/RGBA noninterlaced PNG');
      channels = color === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      if (idatEnded) throw Error('Noncontiguous PNG IDAT');
      parts.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      if (length !== 0 || !parts.length) throw Error('Invalid PNG IEND');
      ended = true;
      pos = end + 4;
      break;
    } else {
      if (parts.length) idatEnded = true;
      if (['tRNS', 'acTL', 'fcTL', 'fdAT'].includes(type) || !((bytes[pos + 4] as number) & 32))
        throw Error('Unsupported PNG chunk: ' + type);
      // Ancillary colour/gamma metadata intentionally does not change the encoded samples.
    }
    pos = end + 4;
  }
  if (!ended || pos !== bytes.length) throw Error('Missing IEND or trailing PNG bytes');
  const stride = width * channels,
    expected = (stride + 1) * height;
  const filtered = new Uint8Array(expected);
  const reader = new Blob(parts as BlobPart[])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  let offset = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value.byteLength > expected - offset) {
      void reader.cancel().catch(() => {});
      throw Error('PNG inflated data exceeds expected size');
    }
    filtered.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== expected) throw Error('Truncated PNG inflated data');
  const rgba = new Uint8ClampedArray(width * height * 4),
    previous = new Uint8Array(stride),
    current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1),
      filter = filtered[rowStart] as number;
    if (filter > 4) throw Error('Invalid PNG row filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (current[x - channels] as number) : 0,
        b = previous[x] as number,
        c = x >= channels ? (previous[x - channels] as number) : 0;
      current[x] =
        ((filtered[rowStart + 1 + x] as number) +
          (filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? Math.floor((a + b) / 2)
                  : paeth(a, b, c))) &
        255;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4,
        src = x * channels;
      rgba[dst] = current[src] as number;
      rgba[dst + 1] = current[src + 1] as number;
      rgba[dst + 2] = current[src + 2] as number;
      rgba[dst + 3] = channels === 4 ? (current[src + 3] as number) : 255;
    }
    previous.set(current);
  }
  return { width, height, rgba };
}
