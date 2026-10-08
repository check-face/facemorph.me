// 3x3 stride-1 pad-1 conv, NHWC fp32, as implicit GEMM: M = H*W pixels, N = Co, K = 9*Ci (k = tap*Ci + ci).
// Weights laid out [K][Co]. Workgroup tile BM x BN, K step BK; each thread TM x TN outputs, strided by the
// thread grid so shared-memory reads and global writes stay coalesced.
export function convShader({BM=64,BN=64,BK=16,TM=4,TN=4}={}){
 const GX=BN/TN,GY=BM/TM,T=GX*GY,LA=BK*BM/T,LB=BK*BN/T;
 return /* wgsl */`
struct P{H:u32,W:u32,Ci:u32,Co:u32}
@group(0)@binding(0) var<storage,read> x:array<f32>;
@group(0)@binding(1) var<storage,read> w:array<f32>;
@group(0)@binding(2) var<storage,read_write> y:array<f32>;
@group(0)@binding(3) var<uniform> p:P;
var<workgroup> As:array<f32,${BK*BM}>;
var<workgroup> Bs:array<f32,${BK*BN}>;
@compute @workgroup_size(${GX},${GY})
fn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) li:u32){
 let m0=wg.x*${BM}u; let n0=wg.y*${BN}u; let K=9u*p.Ci; let M=p.H*p.W;
 var acc:array<f32,${TM*TN}>;
 for(var k0=0u;k0<K;k0+=${BK}u){
  let tap=k0/p.Ci; let ci0=k0%p.Ci; let ky=i32(tap/3u)-1; let kx=i32(tap%3u)-1;   // BK divides Ci: one tap per step
  for(var i=0u;i<${LA}u;i++){
   let e=li+i*${T}u; let mm=e/${BK}u; let kk=e%${BK}u; let m=m0+mm;
   let oy=i32(m/p.W)+ky; let ox=i32(m%p.W)+kx;
   var v=0.0;
   if(m<M&&oy>=0&&ox>=0&&oy<i32(p.H)&&ox<i32(p.W)){v=x[(u32(oy)*p.W+u32(ox))*p.Ci+ci0+kk];}
   As[kk*${BM}u+mm]=v;
  }
  for(var i=0u;i<${LB}u;i++){
   let e=li+i*${T}u; let kk=e/${BN}u; let nn=e%${BN}u;
   Bs[e]=w[(k0+kk)*p.Co+n0+nn];
  }
  workgroupBarrier();
  for(var kk=0u;kk<${BK}u;kk++){
   var a:array<f32,${TM}>; var b:array<f32,${TN}>;
   for(var i=0u;i<${TM}u;i++){a[i]=As[kk*${BM}u+l.y+${GY}u*i];}
   for(var j=0u;j<${TN}u;j++){b[j]=Bs[kk*${BN}u+l.x+${GX}u*j];}
   for(var i=0u;i<${TM}u;i++){for(var j=0u;j<${TN}u;j++){acc[i*${TN}u+j]=fma(a[i],b[j],acc[i*${TN}u+j]);}}
  }
  workgroupBarrier();
 }
 for(var i=0u;i<${TM}u;i++){let m=m0+l.y+${GY}u*i; if(m<M){for(var j=0u;j<${TN}u;j++){y[m*p.Co+n0+l.x+${GX}u*j]=acc[i*${TN}u+j];}}}
}`;}
export const naiveShader=/* wgsl */`
struct P{H:u32,W:u32,Ci:u32,Co:u32}
@group(0)@binding(0) var<storage,read> x:array<f32>;
@group(0)@binding(1) var<storage,read> w:array<f32>;
@group(0)@binding(2) var<storage,read_write> y:array<f32>;
@group(0)@binding(3) var<uniform> p:P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let idx=g.x+g.y*65535u*64u; if(idx>=p.H*p.W*p.Co){return;}
 let n=idx%p.Co; let m=idx/p.Co; let oy=i32(m/p.W); let ox=i32(m%p.W); var s=0.0;
 for(var t=0u;t<9u;t++){let iy=oy+i32(t/3u)-1; let ix=ox+i32(t%3u)-1; if(iy<0||ix<0||iy>=i32(p.H)||ix>=i32(p.W)){continue;}
  for(var c=0u;c<p.Ci;c++){s=fma(x[(u32(iy)*p.W+u32(ix))*p.Ci+c],w[(t*p.Ci+c)*p.Co+n],s);}}
 y[idx]=s;
}`;
// v2: vec4 global loads (Ci and Co contiguous), next K tile prefetched into registers while the current one is
// multiplied, one barrier pair per step. Requires Ci % BK == 0, BK % 4 == 0, Co % 4 == 0.
export function convShader2({BM=128,BN=128,BK=16,TM=8,TN=8}={}){
 const GX=BN/TN,GY=BM/TM,T=GX*GY,NA=BK*BM/4,NB=BK*BN/4,LA=Math.ceil(NA/T),LB=Math.ceil(NB/T);
 if(!Number.isInteger(GX)||!Number.isInteger(GY)||T>1024)throw Error('bad tile '+JSON.stringify({BM,BN,BK,TM,TN}));
 const gA=NA%T?`if(li+i*${T}u>=${NA}u){break;}`:'',gB=NB%T?`if(li+i*${T}u>=${NB}u){break;}`:'';
 return /* wgsl */`
struct P{H:u32,W:u32,Ci:u32,Co:u32}
@group(0)@binding(0) var<storage,read> x:array<vec4f>;
@group(0)@binding(1) var<storage,read> w:array<vec4f>;
@group(0)@binding(2) var<storage,read_write> y:array<f32>;
@group(0)@binding(3) var<uniform> p:P;
var<workgroup> As:array<f32,${BK*BM}>;
var<workgroup> Bs:array<f32,${BK*BN}>;
fn loadA(m0:u32,k0:u32,li:u32,i:u32)->vec4f{
 let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let m=m0+mm;
 let tap=k0/p.Ci; let ci=k0%p.Ci+k4*4u; let oy=i32(m/p.W)+i32(tap/3u)-1; let ox=i32(m%p.W)+i32(tap%3u)-1;
 if(m<p.H*p.W&&oy>=0&&ox>=0&&oy<i32(p.H)&&ox<i32(p.W)){return x[((u32(oy)*p.W+u32(ox))*p.Ci+ci)/4u];}
 return vec4f(0.0);
}
fn loadB(n0:u32,k0:u32,li:u32,i:u32)->vec4f{
 let e=li+i*${T}u; let kk=e/${BN/4}u; let n4=e%${BN/4}u;
 return w[((k0+kk)*p.Co+n0)/4u+n4];
}
@compute @workgroup_size(${GX},${GY})
fn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) li:u32){
 let m0=wg.x*${BM}u; let n0=wg.y*${BN}u; let K=9u*p.Ci;
 var acc:array<f32,${TM*TN}>;
 var ra:array<vec4f,${LA}>; var rb:array<vec4f,${LB}>;
 for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,0u,li,i);}
 for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,0u,li,i);}
 for(var k0=0u;k0<K;k0+=${BK}u){
  for(var i=0u;i<${LA}u;i++){${gA}let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let v=ra[i];
   As[(k4*4u)*${BM}u+mm]=v.x; As[(k4*4u+1u)*${BM}u+mm]=v.y; As[(k4*4u+2u)*${BM}u+mm]=v.z; As[(k4*4u+3u)*${BM}u+mm]=v.w;}
  for(var i=0u;i<${LB}u;i++){${gB}let e=li+i*${T}u; let kk=e/${BN/4}u; let n4=e%${BN/4}u; let v=rb[i]; let o=kk*${BN}u+n4*4u;
   Bs[o]=v.x; Bs[o+1u]=v.y; Bs[o+2u]=v.z; Bs[o+3u]=v.w;}
  workgroupBarrier();
  if(k0+${BK}u<K){for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,k0+${BK}u,li,i);} for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,k0+${BK}u,li,i);}}
  for(var kk=0u;kk<${BK}u;kk++){
   var a:array<f32,${TM}>; var b:array<f32,${TN}>;
   for(var i=0u;i<${TM}u;i++){a[i]=As[kk*${BM}u+l.y+${GY}u*i];}
   for(var j=0u;j<${TN}u;j++){b[j]=Bs[kk*${BN}u+l.x+${GX}u*j];}
   for(var i=0u;i<${TM}u;i++){for(var j=0u;j<${TN}u;j++){acc[i*${TN}u+j]=fma(a[i],b[j],acc[i*${TN}u+j]);}}
  }
  workgroupBarrier();
 }
 for(var i=0u;i<${TM}u;i++){let m=m0+l.y+${GY}u*i; if(m<p.H*p.W){for(var j=0u;j<${TN}u;j++){y[m*p.Co+n0+l.x+${GX}u*j]=acc[i*${TN}u+j];}}}
}`;}
// v3: each thread owns TM contiguous rows and TN contiguous columns; shared tiles stored as vec4 so the inner loop
// issues TM/4 + TN/4 vec4 shared loads per k; output written as vec4. TM, TN multiples of 4.
export function convShader3({BM=128,BN=128,BK=8,TM=8,TN=8}={}){
 const GX=BN/TN,GY=BM/TM,T=GX*GY,NA=BK*BM/4,NB=BK*BN/4,LA=Math.ceil(NA/T),LB=Math.ceil(NB/T),M4=BM/4,N4=BN/4,TM4=TM/4,TN4=TN/4;
 if(!Number.isInteger(GX)||!Number.isInteger(GY)||TM%4||TN%4||T>1024)throw Error('bad tile '+JSON.stringify({BM,BN,BK,TM,TN}));
 const gA=NA%T?`if(li+i*${T}u>=${NA}u){break;}`:'',gB=NB%T?`if(li+i*${T}u>=${NB}u){break;}`:'';
 return /* wgsl */`
struct P{H:u32,W:u32,Ci:u32,Co:u32}
@group(0)@binding(0) var<storage,read> x:array<vec4f>;
@group(0)@binding(1) var<storage,read> w:array<vec4f>;
@group(0)@binding(2) var<storage,read_write> y:array<vec4f>;
@group(0)@binding(3) var<uniform> p:P;
var<workgroup> As:array<vec4f,${BK*M4}>;
var<workgroup> Bs:array<vec4f,${BK*N4}>;
fn loadA(m0:u32,k0:u32,li:u32,i:u32)->vec4f{
 let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let m=m0+mm;
 let tap=k0/p.Ci; let ci=k0%p.Ci+k4*4u; let oy=i32(m/p.W)+i32(tap/3u)-1; let ox=i32(m%p.W)+i32(tap%3u)-1;
 if(m<p.H*p.W&&oy>=0&&ox>=0&&oy<i32(p.H)&&ox<i32(p.W)){return x[((u32(oy)*p.W+u32(ox))*p.Ci+ci)/4u];}
 return vec4f(0.0);
}
fn loadB(n0:u32,k0:u32,li:u32,i:u32)->vec4f{let e=li+i*${T}u; let kk=e/${N4}u; let n4=e%${N4}u; return w[((k0+kk)*p.Co+n0)/4u+n4];}
@compute @workgroup_size(${GX},${GY})
fn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) li:u32){
 let m0=wg.x*${BM}u; let n0=wg.y*${BN}u; let K=9u*p.Ci;
 var acc:array<vec4f,${TM*TN4}>;
 var ra:array<vec4f,${LA}>; var rb:array<vec4f,${LB}>;
 for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,0u,li,i);}
 for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,0u,li,i);}
 for(var k0=0u;k0<K;k0+=${BK}u){
  // A tile stored [k][m/4] as vec4 over 4 consecutive m: scatter the 4 k-components of a loaded vec4.
  for(var i=0u;i<${LA}u;i++){${gA}let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let v=ra[i]; let c=mm%4u; let q=mm/4u;
   As[(k4*4u)*${M4}u+q][c]=v.x; As[(k4*4u+1u)*${M4}u+q][c]=v.y; As[(k4*4u+2u)*${M4}u+q][c]=v.z; As[(k4*4u+3u)*${M4}u+q][c]=v.w;}
  for(var i=0u;i<${LB}u;i++){${gB}let e=li+i*${T}u; Bs[e]=rb[i];}
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
 for(var r=0u;r<${TM}u;r++){let m=m0+l.y*${TM}u+r; if(m<p.H*p.W){for(var j=0u;j<${TN4}u;j++){y[(m*p.Co+n0)/4u+l.x*${TN4}u+j]=acc[r*${TN4}u+j];}}}
}`;}
