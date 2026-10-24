// Incremental SHA-256: retains at most one input chunk and a 64-byte block.
// Input is bytes; callers must not mutate a chunk during update().
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotr = (x,n) => (x >>> n) | (x << (32-n));
export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.block = new Uint8Array(64); this.w = new Uint32Array(64); this.used = 0; this.bytes = 0; this.done = false;
  }
  compress(block) {
    const w = this.w, view = new DataView(block.buffer, block.byteOffset, 64);
    for(let i=0;i<16;i++) w[i] = view.getUint32(i*4);
    for(let i=16;i<64;i++) {
      const x=w[i-15], y=w[i-2];
      w[i] = w[i-16] + (rotr(x,7)^rotr(x,18)^(x>>>3)) + w[i-7] + (rotr(y,17)^rotr(y,19)^(y>>>10));
    }
    let a=this.h[0],b=this.h[1],c=this.h[2],d=this.h[3],e=this.h[4],f=this.h[5],g=this.h[6],h=this.h[7];
    for(let i=0;i<64;i++) {
      const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
      const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    this.h[0]+=a;this.h[1]+=b;this.h[2]+=c;this.h[3]+=d;
    this.h[4]+=e;this.h[5]+=f;this.h[6]+=g;this.h[7]+=h;
  }
  update(input) {
    if(this.done) throw new Error('Hash already finalized');
    this.bytes+=input.length;
    for(let offset=0;offset<input.length;) {
      if(this.used===0 && input.length-offset>=64) {this.compress(input.subarray(offset,offset+64));offset+=64;}
      else {
        const n=Math.min(64-this.used,input.length-offset);
        this.block.set(input.subarray(offset,offset+n),this.used);this.used+=n;offset+=n;
        if(this.used===64) {this.compress(this.block);this.used=0;}
      }
    }
  }
  hex() {
    if(this.done) throw new Error('Hash already finalized');
    const bytes=this.bytes;
    this.update(new Uint8Array([128]));
    while(this.used!==56) this.update(new Uint8Array([0]));
    const length=new Uint8Array(8), view=new DataView(length.buffer);
    view.setUint32(0,Math.floor(bytes/0x20000000));view.setUint32(4,(bytes*8)>>>0);
    this.update(length);this.done=true;
    return [...this.h].map(x=>x.toString(16).padStart(8,'0')).join('');
  }
}
