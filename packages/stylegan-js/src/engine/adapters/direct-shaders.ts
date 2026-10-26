// The direct WebGPU engine's WGSL (fm-3h3w), copied from the candidate's browser/webgpu-direct.mjs (classic
// a42829b, candidate wgsl-conv-v1/direct-v2) with types added and nothing else changed: register-tiled
// implicit-GEMM convolutions with style modulation folded into the input load and demod/noise/bias/LeakyReLU
// into the store, the 4x4 FIR, ToRGB with the upsampled skip, the affine and demodulation passes, the NCHW
// float output and the on-GPU RGBA8 conversion (identity.mjs semantics, non-finite values counted).

export interface Tile {
  readonly BM: number;
  readonly BN: number;
  readonly BK: number;
  readonly TM: number;
  readonly TN: number;
}
/** [dy, dx, kernel index]. */
export type Tap = [number, number, number];

export const TILES = (co: number): Tile =>
  co >= 64 ? { BM: 128, BN: 64, BK: 16, TM: 8, TN: 4 } : { BM: 256, BN: 32, BK: 16, TM: 16, TN: 4 };

// v3 GEMM (each thread owns TM contiguous pixels x TN contiguous channels; vec4 shared tiles and stores),
// with style modulation at load and the conv epilogue at store. `centre` = 3x3 conv taps, else polyphase taps.
export function gemmShader(
  { BM, BN, BK, TM, TN }: Tile,
  taps: readonly Tap[],
  act: boolean,
  nx = 3,
  centre = 1,
): string {
  const GX = BN / TN,
    GY = BM / TM,
    T = GX * GY,
    NA = (BK * BM) / 4,
    NB = (BK * BN) / 4,
    LA = Math.ceil(NA / T),
    LB = Math.ceil(NB / T),
    M4 = BM / 4,
    N4 = BN / 4,
    TM4 = TM / 4,
    TN4 = TN / 4;
  const gA = NA % T ? `if(li+i*${T}u>=${NA}u){break;}` : '',
    gB = NB % T ? `if(li+i*${T}u>=${NB}u){break;}` : '';
  return /* wgsl */ `
struct P{Hin:u32,Win:u32,Ci:u32,Co:u32,Ho:u32,Wo:u32,Wd:u32,sy:u32,py:u32,px:u32,strength:f32,alpha:f32,gain:f32,pad0:u32,pad1:u32,pad2:u32}
@group(0)@binding(0) var<storage,read> x:array<vec4f>;
@group(0)@binding(1) var<storage,read> w:array<vec4f>;
@group(0)@binding(2) var<storage,read_write> y:array<vec4f>;
@group(0)@binding(3) var<uniform> p:P;
@group(0)@binding(4) var<storage,read> style:array<vec4f>;
${
  act
    ? `@group(0)@binding(5) var<storage,read> demod:array<vec4f>;
@group(0)@binding(6) var<storage,read> noise:array<f32>;
@group(0)@binding(7) var<storage,read> bias:array<vec4f>;`
    : ''
}
var<workgroup> As:array<vec4f,${BK * M4}>;
var<workgroup> Bs:array<vec4f,${BK * N4}>;
fn loadA(m0:u32,k0:u32,li:u32,i:u32)->vec4f{
 let e=li+i*${T}u; let mm=e/${BK / 4}u; let k4=e%${BK / 4}u; let m=m0+mm;
 let t=k0/p.Ci; let ci=k0%p.Ci+k4*4u;
 let iy=i32(m/p.Wo)+${centre ? 'i32(t/3u)-1' : `-i32(t/${nx}u)`}; let ix=i32(m%p.Wo)+${centre ? 'i32(t%3u)-1' : `-i32(t%${nx}u)`};
 if(m<p.Ho*p.Wo&&iy>=0&&ix>=0&&iy<i32(p.Hin)&&ix<i32(p.Win)){return x[((u32(iy)*p.Win+u32(ix))*p.Ci+ci)/4u]*style[ci/4u];}
 return vec4f(0.0);
}
fn loadB(n0:u32,k0:u32,li:u32,i:u32)->vec4f{let e=li+i*${T}u; let kk=e/${N4}u; let n4=e%${N4}u; return w[((k0+kk)*p.Co+n0)/4u+n4];}
@compute @workgroup_size(${GX},${GY})
fn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) li:u32){
 let m0=wg.x*${BM}u; let n0=wg.y*${BN}u; let K=${taps.length}u*p.Ci;
 var acc:array<vec4f,${TM * TN4}>;
 var ra:array<vec4f,${LA}>; var rb:array<vec4f,${LB}>;
 for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,0u,li,i);}
 for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,0u,li,i);}
 for(var k0=0u;k0<K;k0+=${BK}u){
  for(var i=0u;i<${LA}u;i++){${gA}let e=li+i*${T}u; let mm=e/${BK / 4}u; let k4=e%${BK / 4}u; let v=ra[i]; let c=mm%4u; let q=mm/4u;
   As[(k4*4u)*${M4}u+q][c]=v.x; As[(k4*4u+1u)*${M4}u+q][c]=v.y; As[(k4*4u+2u)*${M4}u+q][c]=v.z; As[(k4*4u+3u)*${M4}u+q][c]=v.w;}
  for(var i=0u;i<${LB}u;i++){${gB}Bs[li+i*${T}u]=rb[i];}
  workgroupBarrier();
  if(k0+${BK}u<K){for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,k0+${BK}u,li,i);} for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,k0+${BK}u,li,i);}}
  for(var kk=0u;kk<${BK}u;kk++){
   var a:array<vec4f,${TM4}>; var b:array<vec4f,${TN4}>;
   for(var i=0u;i<${TM4}u;i++){a[i]=As[kk*${M4}u+l.y*${TM4}u+i];}
   for(var j=0u;j<${TN4}u;j++){b[j]=Bs[kk*${N4}u+l.x*${TN4}u+j];}
   for(var i=0u;i<${TM4}u;i++){for(var c=0u;c<4u;c++){let av=a[i][c];
    for(var j=0u;j<${TN4}u;j++){acc[(i*4u+c)*${TN4}u+j]=fma(vec4f(av),b[j],acc[(i*4u+c)*${TN4}u+j]);}}}
  }
  workgroupBarrier();
 }
 for(var r=0u;r<${TM}u;r++){
  let m=m0+l.y*${TM}u+r; if(m>=p.Ho*p.Wo){continue;}
  let oy=m/p.Wo; let ox=m%p.Wo; let d=(oy*p.sy+p.py)*p.Wd+ox*p.sy+p.px;
  for(var j=0u;j<${TN4}u;j++){
   let n4=n0/4u+l.x*${TN4}u+j; var v=acc[r*${TN4}u+j];
   ${act ? `v=v*demod[n4]; v=v+vec4f(noise[d]*p.strength); v=v+bias[n4]; v=select(v*p.alpha,v,v>=vec4f(0.0))*p.gain;` : ''}
   y[d*(p.Co/4u)+n4]=v;
  }
 }
}`;
}

// 4x4 FIR over the (size+1)^2 phase grid, then the conv epilogue. One thread per pixel and 4 channels.
export const FIR = /* wgsl */ `
struct P{size:u32,C:u32,strength:f32,alpha:f32,gain:f32,pad0:u32,pad1:u32,pad2:u32}
@group(0)@binding(0) var<storage,read> phase:array<vec4f>;
@group(0)@binding(1) var<storage,read_write> y:array<vec4f>;
@group(0)@binding(2) var<uniform> p:P;
@group(0)@binding(3) var<storage,read> f:array<f32,16>;
@group(0)@binding(4) var<storage,read> demod:array<vec4f>;
@group(0)@binding(5) var<storage,read> noise:array<f32>;
@group(0)@binding(6) var<storage,read> bias:array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let C4=p.C/4u; let idx=g.x+g.y*65535u*64u; if(idx>=p.size*p.size*C4){return;}
 let c4=idx%C4; let pix=idx/C4; let py=i32(pix/p.size); let px=i32(pix%p.size); let S=i32(p.size)+1;
 var v=vec4f(0.0);
 for(var ky=0;ky<4;ky++){for(var kx=0;kx<4;kx++){let qy=py+ky-1; let qx=px+kx-1;
  if(qy>=0&&qx>=0&&qy<S&&qx<S){v=v+phase[(u32(qy*S+qx))*C4+c4]*f[ky*4+kx];}}}
 v=v*demod[c4]; v=v+vec4f(noise[pix]*p.strength); v=v+bias[c4]; v=select(v*p.alpha,v,v>=vec4f(0.0))*p.gain;
 y[idx]=v;
}`;

// ToRGB (1x1 modulated, no demod) + bias + 4x4 upsampled skip from the previous RGB; vec4 per pixel (rgb, 0).
export const RGB = /* wgsl */ `
struct P{size:u32,C:u32,hasSkip:u32,pad0:u32}
@group(0)@binding(0) var<storage,read> x:array<vec4f>;
@group(0)@binding(1) var<storage,read_write> rgb:array<vec4f>;
@group(0)@binding(2) var<uniform> p:P;
@group(0)@binding(3) var<storage,read> style:array<vec4f>;
@group(0)@binding(4) var<storage,read> wrgb:array<vec4f>;
@group(0)@binding(5) var<storage,read> skip:array<vec4f>;
@group(0)@binding(6) var<storage,read> f:array<f32,16>;
@group(0)@binding(7) var<storage,read> brgb:array<f32,4>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let pix=g.x+g.y*65535u*64u; if(pix>=p.size*p.size){return;}
 let C4=p.C/4u; var s=vec3f(0.0);
 for(var c4=0u;c4<C4;c4++){let v=x[pix*C4+c4]*style[c4];
  s=s+v.x*wrgb[c4*4u].xyz; s=s+v.y*wrgb[c4*4u+1u].xyz; s=s+v.z*wrgb[c4*4u+2u].xyz; s=s+v.w*wrgb[c4*4u+3u].xyz;}
 var up=vec3f(0.0);
 if(p.hasSkip==1u){let py=i32(pix/p.size); let px=i32(pix%p.size); let n=i32(p.size);
  for(var ky=0;ky<4;ky++){for(var kx=0;kx<4;kx++){let qy=py+ky-2; let qx=px+kx-2;
   if(qy<0||qx<0||qy>=n||qx>=n||(qy&1)!=0||(qx&1)!=0){continue;}
   up=up+skip[u32(qy/2)*(p.size/2u)+u32(qx/2)].xyz*f[ky*4+kx];}}}
 let r=s+vec3f(brgb[0],brgb[1],brgb[2]);
 rgb[pix]=vec4f(up+r,0.0);
}`;

export const AFFINE = /* wgsl */ `
struct P{C:u32,wIndex:u32,mult:f32,pad:u32}
@group(0)@binding(0) var<storage,read> lat:array<f32>;
@group(0)@binding(1) var<storage,read> A:array<f32>;
@group(0)@binding(2) var<storage,read> b:array<f32>;
@group(0)@binding(3) var<storage,read_write> s:array<f32>;
@group(0)@binding(4) var<uniform> p:P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let c=g.x; if(c>=p.C){return;}
 var v=0.0; for(var j=0u;j<512u;j++){v=v+lat[p.wIndex*512u+j]*A[((c/4u)*512u+j)*4u+c%4u];}
 s[c]=(v+b[c])*p.mult;
}`;
export const DEMOD = /* wgsl */ `
struct P{Ci:u32,Co:u32,eps:f32,num:f32}
@group(0)@binding(0) var<storage,read> s:array<f32>;
@group(0)@binding(1) var<storage,read> E:array<f32>;
@group(0)@binding(2) var<storage,read_write> d:array<f32>;
@group(0)@binding(3) var<uniform> p:P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let o=g.x; if(o>=p.Co){return;}
 var v=0.0; for(var i=0u;i<p.Ci;i++){v=v+s[i]*s[i]*E[((o/4u)*p.Ci+i)*4u+o%4u];}
 d[o]=p.num/sqrt(v+p.eps);
}`;
/** NHWC RGB to the NCHW float output, for a plane of `pixels` (height x width, from the descriptor). */
export const outShader = (pixels: number) => /* wgsl */ `
@group(0)@binding(0) var<storage,read> rgb:array<vec4f>;
@group(0)@binding(1) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let pix=g.x+g.y*65535u*64u; if(pix>=${pixels}u){return;}
 let v=rgb[pix]; y[pix]=v.x; y[${pixels}u+pix]=v.y; y[${2 * pixels}u+pix]=v.z;
}`;
// The product's own output conversion (identity.mjs rgba1024: trunc(clamp(v*127.5+128))) on the GPU, so a
// face crosses the bus as 4 MB of RGBA8 instead of 12 MB of floats and the worker skips its per-pixel loop.
// Non-finite values are counted rather than silently clamped; a count above zero fails the face as before.
export const rgba8Shader = (pixels: number) => /* wgsl */ `
@group(0)@binding(0) var<storage,read> rgb:array<vec4f>;
@group(0)@binding(1) var<storage,read_write> y:array<u32>;
@group(0)@binding(2) var<storage,read_write> bad:atomic<u32>;
// Always zero, but only known at run time: XOR-ing the product's bits with it makes the compiler round
// v*127.5 to f32 before the add, as identity.mjs does. Without it the two contract into one FMA and the
// handful of values that land exactly on an integer truncate one level lower.
@group(0)@binding(3) var<uniform> zero:vec4u;
fn q(v:f32)->u32{let t=bitcast<f32>(bitcast<u32>(v*127.5)^zero.x); let s=t+128.0; return u32(trunc(clamp(s,0.0,255.0)));}
fn finite(v:vec3f)->bool{return all(v==v)&&all(abs(v)<=vec3f(3.4e38));}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let pix=g.x+g.y*65535u*64u; if(pix>=${pixels}u){return;}
 let v=rgb[pix].xyz; if(!finite(v)){atomicAdd(&bad,1u);}
 y[pix]=q(v.x)|(q(v.y)<<8u)|(q(v.z)<<16u)|(255u<<24u);
}`;

// conv1 taps (correlation, q = p + (ky-1, kx-1)), tap order ky-major.
export const TAPS3: Tap[] = [];
for (let ky = 0; ky < 3; ky++)
  for (let kx = 0; kx < 3; kx++) TAPS3.push([ky - 1, kx - 1, ky * 3 + kx]);
// conv0 transposed: phase(p) += in((p-k)/2) for even p-k; for parity (py,px) the taps with ky≡py, kx≡px (mod 2),
// input offset dy = -(ky>>1) relative to r where p = 2r + py.
export function parityTaps(py: number, px: number): Tap[] {
  const t: Tap[] = [];
  for (let ky = py; ky < 3; ky += 2)
    for (let kx = px; kx < 3; kx += 2) t.push([-(ky >> 1), -(kx >> 1), ky * 3 + kx]);
  return t;
}
// [Co/4][Ci*9][4] -> [tap*Ci+ci][Co] for the given tap list
export function repack(
  src: Float32Array,
  Ci: number,
  Co: number,
  taps: readonly Tap[],
): Float32Array {
  const out = new Float32Array(taps.length * Ci * Co);
  for (let t = 0; t < taps.length; t++) {
    const k = (taps[t] as Tap)[2];
    for (let ci = 0; ci < Ci; ci++) {
      const row = (t * Ci + ci) * Co;
      for (let co = 0; co < Co; co++)
        out[row + co] = src[((co >> 2) * (Ci * 9) + ci * 9 + k) * 4 + (co & 3)] as number;
    }
  }
  return out;
}
