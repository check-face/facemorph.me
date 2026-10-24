// Incremental SHA-256: retains at most one input chunk and a 64-byte block.
// Input is bytes; callers must not mutate a chunk during update().
// Moved from the candidate's src/Next/Assets/sha256.mjs (classic a42829b) without behaviour change (fm-eulc).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private used = 0;
  private bytes = 0;
  private done = false;

  private compress(block: Uint8Array): void {
    const w = this.w;
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      w[i] =
        w[i - 16]! +
        (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) +
        w[i - 7]! +
        (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    const s = this.h;
    let a = s[0]!,
      b = s[1]!,
      c = s[2]!,
      d = s[3]!,
      e = s[4]!,
      f = s[5]!,
      g = s[6]!,
      h = s[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    s[0]! += a;
    s[1]! += b;
    s[2]! += c;
    s[3]! += d;
    s[4]! += e;
    s[5]! += f;
    s[6]! += g;
    s[7]! += h;
  }

  update(input: Uint8Array): void {
    if (this.done) throw new Error('Hash already finalized');
    this.bytes += input.length;
    for (let offset = 0; offset < input.length;) {
      if (this.used === 0 && input.length - offset >= 64) {
        this.compress(input.subarray(offset, offset + 64));
        offset += 64;
      } else {
        const n = Math.min(64 - this.used, input.length - offset);
        this.block.set(input.subarray(offset, offset + n), this.used);
        this.used += n;
        offset += n;
        if (this.used === 64) {
          this.compress(this.block);
          this.used = 0;
        }
      }
    }
  }

  hex(): string {
    if (this.done) throw new Error('Hash already finalized');
    const bytes = this.bytes;
    this.update(new Uint8Array([128]));
    while (this.used !== 56) this.update(new Uint8Array([0]));
    const length = new Uint8Array(8);
    const view = new DataView(length.buffer);
    view.setUint32(0, Math.floor(bytes / 0x20000000));
    view.setUint32(4, (bytes * 8) >>> 0);
    this.update(length);
    this.done = true;
    return [...this.h].map((x) => x.toString(16).padStart(8, '0')).join('');
  }
}
