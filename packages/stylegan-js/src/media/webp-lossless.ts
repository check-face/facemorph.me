// Lossless WebP (VP8L) encoder for exported images, per the WebP Lossless Bitstream specification
// (RFC 9649). It writes one plain RIFF/WEBP file holding a single VP8L chunk: no VP8X, no metadata,
// so a later module can append its recovery chunk.
//
// Coding choices: the subtract-green transform, one prefix-code group (no meta prefix codes), no
// colour cache, literal ARGB symbols and LZ77 backward references only for "same as the previous
// pixel" (distance code 2) and "same as the pixel above" (distance code 1). Every browser decodes
// this subset; the pixels come back exactly, alpha included.

/** Longest edge VP8L can express (14-bit width and height fields hold size - 1). */
export const WEBP_LOSSLESS_MAX_EDGE = 16384;

/** Longest prefix code VP8L allows for a pixel or distance alphabet. */
const MAX_CODE_LENGTH = 15;
/** Longest code in the code-length code (3 bits per length). */
const MAX_CODE_LENGTH_CODE_LENGTH = 7;
/** Green alphabet: 256 literals plus 24 backward-reference length prefixes (no colour cache). */
const GREEN_ALPHABET = 256 + 24;
const DISTANCE_ALPHABET = 40;
/** Longest backward reference the length prefix code can express. */
const MAX_COPY_LENGTH = 4096;
/** Shorter matches cost more than the literals they replace. */
const MIN_COPY_LENGTH = 4;
/** Order in which the code-length code's own lengths are stored (spec section 6.2.6). */
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** A code for one alphabet: `lengths[s]` bits holding `codes[s]`, already bit-reversed for LSB-first output. */
interface PrefixCode {
  readonly lengths: Uint8Array;
  readonly codes: Uint16Array;
}

/** LSB-first bit sink with a growing byte buffer (VP8L packs bits from the least significant end). */
class BitWriter {
  private bytes = new Uint8Array(1 << 16);
  private length = 0;
  private acc = 0;
  private accBits = 0;

  /** Appends the low `count` bits of `value`, `count` at most 24. */
  write(value: number, count: number): void {
    if (count === 0) return;
    this.acc |= value << this.accBits;
    this.accBits += count;
    while (this.accBits >= 8) {
      if (this.length === this.bytes.length) this.grow();
      this.bytes[this.length++] = this.acc & 0xff;
      this.acc >>>= 8;
      this.accBits -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.accBits > 0) this.write(0, 8 - this.accBits);
    return this.bytes.subarray(0, this.length);
  }

  private grow(): void {
    const next = new Uint8Array(this.bytes.length * 2);
    next.set(this.bytes);
    this.bytes = next;
  }
}

/**
 * Code lengths for `counts`, limited to `limit` bits. A tree deeper than the limit is rebuilt with
 * every count raised to a growing floor (libwebp's approach), which flattens it until it fits.
 * Zero-count symbols get length 0; a lone used symbol gets length 1.
 */
function codeLengths(counts: ArrayLike<number>, limit: number): Uint8Array {
  const lengths = new Uint8Array(counts.length);
  const used: number[] = [];
  for (let s = 0; s < counts.length; s++) if ((counts[s] ?? 0) > 0) used.push(s);
  if (used.length === 0) return lengths;
  if (used.length === 1) {
    lengths[used[0] as number] = 1;
    return lengths;
  }
  const n = used.length;
  for (let floor = 1; ; floor *= 2) {
    const order = used.slice().sort((a, b) => {
      const wa = Math.max(counts[a] ?? 0, floor);
      const wb = Math.max(counts[b] ?? 0, floor);
      return wa - wb || a - b;
    });
    // Two-queue merge: sorted leaves in weight[0..n), merged nodes appended behind them in order.
    const weight = new Float64Array(2 * n - 1);
    const parent = new Int32Array(2 * n - 1);
    for (let i = 0; i < n; i++) weight[i] = Math.max(counts[order[i] as number] ?? 0, floor);
    let leaf = 0;
    let node = n;
    let merged = n;
    for (let made = 0; made < n - 1; made++) {
      const pick = (): number => {
        if (
          leaf < n &&
          (merged === node || (weight[leaf] as number) <= (weight[merged] as number))
        ) {
          return leaf++;
        }
        return merged++;
      };
      const a = pick();
      const b = pick();
      weight[node] = (weight[a] as number) + (weight[b] as number);
      parent[a] = node;
      parent[b] = node;
      node++;
    }
    const depth = new Uint8Array(2 * n - 1);
    let deepest = 0;
    for (let i = 2 * n - 3; i >= 0; i--) {
      const d = (depth[parent[i] as number] as number) + 1;
      depth[i] = d;
      if (d > deepest) deepest = d;
    }
    if (deepest <= limit) {
      for (let i = 0; i < n; i++) lengths[order[i] as number] = depth[i] as number;
      return lengths;
    }
  }
}

/** Canonical codes (shorter first, then lower symbol) from complete or single-symbol lengths. */
function canonicalCodes(lengths: Uint8Array): PrefixCode {
  const perLength = new Uint32Array(MAX_CODE_LENGTH + 2);
  for (const len of lengths) perLength[len] = (perLength[len] as number) + 1;
  perLength[0] = 0;
  const next = new Uint32Array(MAX_CODE_LENGTH + 2);
  let code = 0;
  for (let len = 1; len <= MAX_CODE_LENGTH; len++) {
    code = (code + (perLength[len - 1] as number)) << 1;
    next[len] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) {
    const len = lengths[s] as number;
    if (len === 0) continue;
    const forward = next[len] as number;
    next[len] = forward + 1;
    let reversed = 0;
    for (let b = 0; b < len; b++) reversed |= ((forward >>> b) & 1) << (len - 1 - b);
    codes[s] = reversed;
  }
  return { lengths, codes };
}

/** Code-length tokens: symbol 0-15 literal length, 16 repeat previous non-zero, 17/18 zero runs. */
interface LengthTokens {
  readonly symbols: number[];
  readonly extras: number[];
}

function tokenizeLengths(lengths: Uint8Array): LengthTokens {
  let end = lengths.length;
  while (end > 0 && lengths[end - 1] === 0) end--;
  const symbols: number[] = [];
  const extras: number[] = [];
  let previous = 8;
  let i = 0;
  while (i < end) {
    const value = lengths[i] as number;
    let run = 1;
    while (i + run < end && lengths[i + run] === value) run++;
    i += run;
    if (value === 0) {
      while (run >= 3) {
        const take = Math.min(run, 138);
        symbols.push(take >= 11 ? 18 : 17);
        extras.push(take >= 11 ? take - 11 : take - 3);
        run -= take;
      }
      for (; run > 0; run--) {
        symbols.push(0);
        extras.push(0);
      }
    } else {
      if (value !== previous) {
        symbols.push(value);
        extras.push(0);
        previous = value;
        run--;
      }
      while (run >= 3) {
        const take = Math.min(run, 6);
        symbols.push(16);
        extras.push(take - 3);
        run -= take;
      }
      for (; run > 0; run--) {
        symbols.push(value);
        extras.push(0);
      }
    }
  }
  return { symbols, extras };
}

const EXTRA_BITS_OF_LENGTH_TOKEN: Readonly<Record<number, number>> = { 16: 2, 17: 3, 18: 7 };

/** Writes one prefix code in the bitstream and returns the code to emit symbols with. */
function writePrefixCode(out: BitWriter, counts: Uint32Array): PrefixCode {
  const alphabet = counts.length;
  let usedCount = 0;
  let first = 0;
  for (let s = 0; s < alphabet; s++) {
    if ((counts[s] as number) > 0) {
      if (usedCount === 0) first = s;
      usedCount++;
    }
  }
  if (usedCount <= 1 && first < 256) {
    // Simple code, one symbol: it takes zero bits per occurrence.
    out.write(1, 1);
    out.write(0, 1);
    if (first < 2) {
      out.write(0, 1);
      out.write(first, 1);
    } else {
      out.write(1, 1);
      out.write(first, 8);
    }
    return { lengths: new Uint8Array(alphabet), codes: new Uint16Array(alphabet) };
  }
  if (usedCount <= 1) {
    // A lone symbol the simple code cannot name: pair it with symbol 0 in a normal code.
    counts = counts.slice();
    counts[0] = Math.max(counts[0] as number, 1);
  }
  const lengths = codeLengths(counts, MAX_CODE_LENGTH);
  const tokens = tokenizeLengths(lengths);
  const tokenCounts = new Uint32Array(19);
  for (const symbol of tokens.symbols) tokenCounts[symbol] = (tokenCounts[symbol] as number) + 1;
  // A single token symbol would need a zero-bit code; a second, unused one keeps the code complete.
  let tokenKinds = 0;
  for (const c of tokenCounts) if (c > 0) tokenKinds++;
  if (tokenKinds === 1) {
    const only = tokenCounts.findIndex((c) => c > 0);
    tokenCounts[only === 0 ? 1 : 0] = 1;
  }
  const lengthCode = canonicalCodes(codeLengths(tokenCounts, MAX_CODE_LENGTH_CODE_LENGTH));

  let codeLengthCodes = 19;
  while (
    codeLengthCodes > 4 &&
    lengthCode.lengths[CODE_LENGTH_ORDER[codeLengthCodes - 1] as number] === 0
  ) {
    codeLengthCodes--;
  }
  out.write(0, 1);
  out.write(codeLengthCodes - 4, 4);
  for (let i = 0; i < codeLengthCodes; i++) {
    out.write(lengthCode.lengths[CODE_LENGTH_ORDER[i] as number] as number, 3);
  }
  // Send only as many tokens as the trimmed list holds: max_symbol counts tokens, not symbols.
  const tokenTotal = tokens.symbols.length;
  let nbitsStep = 0;
  while (tokenTotal - 2 >= 2 ** (2 + 2 * nbitsStep)) nbitsStep++;
  out.write(1, 1);
  out.write(nbitsStep, 3);
  out.write(tokenTotal - 2, 2 + 2 * nbitsStep);
  for (let i = 0; i < tokenTotal; i++) {
    const symbol = tokens.symbols[i] as number;
    out.write(lengthCode.codes[symbol] as number, lengthCode.lengths[symbol] as number);
    const extraBits = EXTRA_BITS_OF_LENGTH_TOKEN[symbol];
    if (extraBits !== undefined) out.write(tokens.extras[i] as number, extraBits);
  }
  return canonicalCodes(lengths);
}

/** Prefix symbol, extra-bit count and extra-bit value for a length or distance code of at least 1. */
function prefixSplit(value: number): { prefix: number; extraBits: number; extra: number } {
  if (value <= 4) return { prefix: value - 1, extraBits: 0, extra: 0 };
  const v = value - 1;
  const high = 31 - Math.clz32(v);
  const second = (v >>> (high - 1)) & 1;
  const extraBits = high - 1;
  return { prefix: 2 * high + second, extraBits, extra: v & ((1 << extraBits) - 1) };
}

/**
 * Encodes straight (non-premultiplied) 8-bit RGBA pixels as a lossless WebP file. Decoding it gives
 * back exactly the same RGBA bytes, including colour under fully transparent pixels.
 */
export function encodeVp8lWebp(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > WEBP_LOSSLESS_MAX_EDGE ||
    height > WEBP_LOSSLESS_MAX_EDGE
  ) {
    throw new Error(
      `WebP lossless size ${width}x${height} is outside 1..${WEBP_LOSSLESS_MAX_EDGE} per edge`,
    );
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `WebP lossless input has ${rgba.length} bytes; ${width}x${height} RGBA needs ${width * height * 4}`,
    );
  }
  const total = width * height;

  // ARGB words after the subtract-green transform (red and blue lose the green value).
  const argb = new Uint32Array(total);
  let alphaUsed = false;
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const r = rgba[p] as number;
    const g = rgba[p + 1] as number;
    const b = rgba[p + 2] as number;
    const a = rgba[p + 3] as number;
    if (a !== 255) alphaUsed = true;
    argb[i] = ((a << 24) | (((r - g) & 255) << 16) | (g << 8) | ((b - g) & 255)) >>> 0;
  }

  // Tokens: a literal keeps its pixel in `values`; a copy keeps its length and a distance code (1 above, 2 left).
  const values = new Uint32Array(total);
  const kinds = new Uint8Array(total);
  let tokenCount = 0;
  const greenCounts = new Uint32Array(GREEN_ALPHABET);
  const redCounts = new Uint32Array(256);
  const blueCounts = new Uint32Array(256);
  const alphaCounts = new Uint32Array(256);
  const distanceCounts = new Uint32Array(DISTANCE_ALPHABET);
  for (let i = 0; i < total;) {
    const pixel = argb[i] as number;
    let left = 0;
    let above = 0;
    if (i >= 1) {
      const limit = Math.min(MAX_COPY_LENGTH, total - i);
      while (left < limit && argb[i + left] === argb[i + left - 1]) left++;
    }
    if (i >= width) {
      const limit = Math.min(MAX_COPY_LENGTH, total - i);
      while (above < limit && argb[i + above] === argb[i + above - width]) above++;
    }
    if (left >= MIN_COPY_LENGTH || above >= MIN_COPY_LENGTH) {
      const useLeft = left >= above;
      const length = useLeft ? left : above;
      const distanceCode = useLeft ? 2 : 1;
      const lengthSplit = prefixSplit(length);
      values[tokenCount] = length;
      kinds[tokenCount++] = distanceCode;
      greenCounts[256 + lengthSplit.prefix] = (greenCounts[256 + lengthSplit.prefix] as number) + 1;
      distanceCounts[distanceCode - 1] = (distanceCounts[distanceCode - 1] as number) + 1;
      i += length;
      continue;
    }
    values[tokenCount] = pixel;
    kinds[tokenCount++] = 0;
    const g = (pixel >>> 8) & 255;
    const r = (pixel >>> 16) & 255;
    const b = pixel & 255;
    const a = pixel >>> 24;
    greenCounts[g] = (greenCounts[g] as number) + 1;
    redCounts[r] = (redCounts[r] as number) + 1;
    blueCounts[b] = (blueCounts[b] as number) + 1;
    alphaCounts[a] = (alphaCounts[a] as number) + 1;
    i++;
  }

  const out = new BitWriter();
  out.write(0x2f, 8);
  out.write(width - 1, 14);
  out.write(height - 1, 14);
  out.write(alphaUsed ? 1 : 0, 1);
  out.write(0, 3);
  // One transform: subtract green (type 2); then no more transforms, no colour cache, no meta codes.
  out.write(1, 1);
  out.write(2, 2);
  out.write(0, 1);
  out.write(0, 1);
  out.write(0, 1);
  const green = writePrefixCode(out, greenCounts);
  const red = writePrefixCode(out, redCounts);
  const blue = writePrefixCode(out, blueCounts);
  const alpha = writePrefixCode(out, alphaCounts);
  const distance = writePrefixCode(out, distanceCounts);

  for (let t = 0; t < tokenCount; t++) {
    const value = values[t] as number;
    const kind = kinds[t] as number;
    if (kind === 0) {
      const g = (value >>> 8) & 255;
      const r = (value >>> 16) & 255;
      const b = value & 255;
      const a = value >>> 24;
      out.write(green.codes[g] as number, green.lengths[g] as number);
      out.write(red.codes[r] as number, red.lengths[r] as number);
      out.write(blue.codes[b] as number, blue.lengths[b] as number);
      out.write(alpha.codes[a] as number, alpha.lengths[a] as number);
    } else {
      const split = prefixSplit(value);
      const symbol = 256 + split.prefix;
      out.write(green.codes[symbol] as number, green.lengths[symbol] as number);
      out.write(split.extra, split.extraBits);
      const d = kind - 1;
      out.write(distance.codes[d] as number, distance.lengths[d] as number);
    }
  }

  const bitstream = out.finish();
  const padded = bitstream.length + (bitstream.length & 1);
  const file = new Uint8Array(20 + padded);
  const view = new DataView(file.buffer);
  file.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 12 + padded, true);
  file.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  file.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  view.setUint32(16, bitstream.length, true);
  file.set(bitstream, 20);
  return file;
}
