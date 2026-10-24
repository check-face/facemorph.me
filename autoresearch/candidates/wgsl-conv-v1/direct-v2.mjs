// Direct WebGPU synthesis (no ORT): the pinned pure-WebGL block stream's schedule and coefficients
// (manifest.webgl, full31-qualified in WebGL), re-expressed as compute passes over NHWC fp32 buffers.
//  - styles: affine + demod per layer, on the GPU
//  - conv1: implicit-GEMM 3x3 conv, input scaled by style at load, epilogue demod/noise/bias/lrelu/gain
//  - conv0: transposed 3x3 stride-2 conv as four polyphase GEMMs into the (2n+1)^2 phase grid, then the
//    4x4 FIR with the same epilogue
//  - torgb + skip: per-pixel 1x1 modulated conv, bias, and the 4x4 upsampled previous RGB
// Output matches the ORT engine's contract: Float32Array NCHW [3,1024,1024].

const TILES = co => co >= 64 ? {BM:128,BN:64,BK:16,TM:8,TN:4} : {BM:256,BN:32,BK:16,TM:16,TN:4};

// v3 GEMM (each thread owns TM contiguous pixels x TN contiguous channels; vec4 shared tiles and stores),
// with style modulation at load and the conv epilogue at store. `centre` = 3x3 conv taps, else polyphase taps.
function gemmShader({BM,BN,BK,TM,TN}, taps, act, nx=3, centre=1){
 const GX=BN/TN,GY=BM/TM,T=GX*GY,NA=BK*BM/4,NB=BK*BN/4,LA=Math.ceil(NA/T),LB=Math.ceil(NB/T),M4=BM/4,N4=BN/4,TM4=TM/4,TN4=TN/4;
 const gA=NA%T?`if(li+i*${T}u>=${NA}u){break;}`:'',gB=NB%T?`if(li+i*${T}u>=${NB}u){break;}`:'';
 return /* wgsl */`
struct P{Hin:u32,Win:u32,Ci:u32,Co:u32,Ho:u32,Wo:u32,Wd:u32,sy:u32,py:u32,px:u32,strength:f32,alpha:f32,gain:f32,pad0:u32,pad1:u32,pad2:u32}
@group(0)@binding(0) var<storage,read> x:array<vec4f>;
@group(0)@binding(1) var<storage,read> w:array<vec4f>;
@group(0)@binding(2) var<storage,read_write> y:array<vec4f>;
@group(0)@binding(3) var<uniform> p:P;
@group(0)@binding(4) var<storage,read> style:array<vec4f>;
${act?`@group(0)@binding(5) var<storage,read> demod:array<vec4f>;
@group(0)@binding(6) var<storage,read> noise:array<f32>;
@group(0)@binding(7) var<storage,read> bias:array<vec4f>;`:''}
var<workgroup> As:array<vec4f,${BK*M4}>;
var<workgroup> Bs:array<vec4f,${BK*N4}>;
fn loadA(m0:u32,k0:u32,li:u32,i:u32)->vec4f{
 let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let m=m0+mm;
 let t=k0/p.Ci; let ci=k0%p.Ci+k4*4u;
 let iy=i32(m/p.Wo)+${centre?'i32(t/3u)-1':`-i32(t/${nx}u)`}; let ix=i32(m%p.Wo)+${centre?'i32(t%3u)-1':`-i32(t%${nx}u)`};
 if(m<p.Ho*p.Wo&&iy>=0&&ix>=0&&iy<i32(p.Hin)&&ix<i32(p.Win)){return x[((u32(iy)*p.Win+u32(ix))*p.Ci+ci)/4u]*style[ci/4u];}
 return vec4f(0.0);
}
fn loadB(n0:u32,k0:u32,li:u32,i:u32)->vec4f{let e=li+i*${T}u; let kk=e/${N4}u; let n4=e%${N4}u; return w[((k0+kk)*p.Co+n0)/4u+n4];}
@compute @workgroup_size(${GX},${GY})
fn main(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) li:u32){
 let m0=wg.x*${BM}u; let n0=wg.y*${BN}u; let K=${taps.length}u*p.Ci;
 var acc:array<vec4f,${TM*TN4}>;
 var ra:array<vec4f,${LA}>; var rb:array<vec4f,${LB}>;
 for(var i=0u;i<${LA}u;i++){${gA}ra[i]=loadA(m0,0u,li,i);}
 for(var i=0u;i<${LB}u;i++){${gB}rb[i]=loadB(n0,0u,li,i);}
 for(var k0=0u;k0<K;k0+=${BK}u){
  for(var i=0u;i<${LA}u;i++){${gA}let e=li+i*${T}u; let mm=e/${BK/4}u; let k4=e%${BK/4}u; let v=ra[i]; let c=mm%4u; let q=mm/4u;
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
   ${act?`v=v*demod[n4]; v=v+vec4f(noise[d]*p.strength); v=v+bias[n4]; v=select(v*p.alpha,v,v>=vec4f(0.0))*p.gain;`:''}
   y[d*(p.Co/4u)+n4]=v;
  }
 }
}`;}

// 4x4 FIR over the (size+1)^2 phase grid, then the conv epilogue. One thread per pixel and 4 channels.
const FIR=/* wgsl */`
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
const RGB=/* wgsl */`
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

const AFFINE=/* wgsl */`
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
const DEMOD=/* wgsl */`
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
const OUT=/* wgsl */`
@group(0)@binding(0) var<storage,read> rgb:array<vec4f>;
@group(0)@binding(1) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3u){
 let pix=g.x+g.y*65535u*64u; if(pix>=1048576u){return;}
 let v=rgb[pix]; y[pix]=v.x; y[1048576u+pix]=v.y; y[2097152u+pix]=v.z;
}`;

// conv1 taps (correlation, q = p + (ky-1, kx-1)), tap order ky-major.
const TAPS3=[];for(let ky=0;ky<3;ky++)for(let kx=0;kx<3;kx++)TAPS3.push([ky-1,kx-1,ky*3+kx]);
// conv0 transposed: phase(p) += in((p-k)/2) for even p-k; for parity (py,px) the taps with ky≡py, kx≡px (mod 2),
// input offset dy = -(ky>>1) relative to r where p = 2r + py.
function parityTaps(py,px){const t=[];for(let ky=py;ky<3;ky+=2)for(let kx=px;kx<3;kx+=2)t.push([-(ky>>1),-(kx>>1),ky*3+kx]);return t;}
// [Co/4][Ci*9][4] -> [tap*Ci+ci][Co] for the given tap list
function repack(src,Ci,Co,taps){const out=new Float32Array(taps.length*Ci*Co);
 for(let t=0;t<taps.length;t++){const k=taps[t][2];for(let ci=0;ci<Ci;ci++){const row=(t*Ci+ci)*Co;for(let co=0;co<Co;co++)out[row+co]=src[((co>>2)*(Ci*9)+ci*9+k)*4+(co&3)];}}
 return out;}

export async function createDirectSession({manifest,assetBase,bytes,device:given,profile=false}){
 const adapter=given?null:await navigator.gpu.requestAdapter();
 const device=given||await adapter.requestDevice({requiredFeatures:profile&&adapter.features.has('timestamp-query')?['timestamp-query']:[],
  requiredLimits:{maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize,maxComputeInvocationsPerWorkgroup:adapter.limits.maxComputeInvocationsPerWorkgroup,maxComputeWorkgroupSizeX:adapter.limits.maxComputeWorkgroupSizeX,maxComputeWorkgroupSizeY:adapter.limits.maxComputeWorkgroupSizeY,maxComputeWorkgroupStorageSize:adapter.limits.maxComputeWorkgroupStorageSize,maxStorageBuffersPerShaderStage:Math.min(10,adapter.limits.maxStorageBuffersPerShaderStage)}});
 let failure=null;device.addEventListener('uncapturederror',e=>{failure=failure||Error('GPU validation: '+e.error.message);});
 const S=GPUBufferUsage.STORAGE,CD=GPUBufferUsage.COPY_DST,CS=GPUBufferUsage.COPY_SRC,U=GPUBufferUsage.UNIFORM;
 const all=[];const buffer=(size,usage=S|CD)=>{const b=device.createBuffer({size:Math.max(16,Math.ceil(size/16)*16),usage});all.push(b);return b;};
 const upload=(data,usage=S|CD)=>{const b=buffer(data.byteLength,usage);device.queue.writeBuffer(b,0,data);return b;};
 const uniform=(u32s,f32s=[])=>{const a=new ArrayBuffer(Math.ceil((u32s.length+f32s.length)*4/16)*16);const v=new DataView(a);let o=0;for(const x of u32s){v.setUint32(o,x,true);o+=4;}for(const x of f32s){v.setFloat32(o,x,true);o+=4;}return upload(new Uint8Array(a),U|CD);};
 const pipes=new Map();const pipeline=code=>{if(!pipes.has(code))pipes.set(code,device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}}));return pipes.get(code);};
 const bind=(pipe,list)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:list.map((b,i)=>({binding:i,resource:{buffer:b}}))});
 const steps=[]; // {name,pipe,group,wg}
 const step=(name,code,list,wg)=>{const pipe=pipeline(code);steps.push({name,pipe,group:bind(pipe,list),wg});};
 const grid=n=>{const g=Math.ceil(n/64);return [Math.min(g,65535),Math.ceil(g/65535)];};
 const f32=async a=>{const b=await bytes(a);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};

 const latent=buffer(9216*4);
 const noiseBuf={};for(const b of manifest.blocks)for(const n of Object.values(b.noise))noiseBuf[n.name]=buffer(n.shape[0]*n.shape[1]*4);
 const dummy=buffer(16);
 // learned input NCHW [512,4,4] -> NHWC
 const learned=await f32({url:assetBase+manifest.learnedInput.file,sha256:manifest.learnedInput.sha256,size:manifest.learnedInput.bytes});
 const nhwc=new Float32Array(16*512);for(let c=0;c<512;c++)for(let i=0;i<16;i++)nhwc[i*512+c]=learned[c*16+i];
 let features=upload(nhwc),skip=null,coefficientBytes=0;
 for(const block of manifest.blocks){
  const raw=await bytes({url:assetBase+block.coefficients.file,sha256:block.coefficients.sha256,size:block.coefficients.bytes});coefficientBytes+=raw.byteLength;
  const arr=Object.fromEntries(Object.entries(block.coefficients.arrays).map(([k,r])=>[k,new Float32Array(raw.buffer,raw.byteOffset+r.offset,r.bytes/4)]));
  const k=block.constants,size=block.size,inC=block.inChannels,outC=block.outChannels;
  const styleOf=(suffix,C,plan)=>{const s=buffer(C*4);step(block.id+' affine'+suffix,AFFINE,[latent,upload(arr['affineWeight'+suffix]),upload(arr['affineBias'+suffix]),s,uniform([C,plan.wIndex],[plan.styleMultiplier])],[Math.ceil(C/64),1]);return s;};
  const demodOf=(suffix,s,Ci,Co,plan)=>{const d=buffer(Co*4);step(block.id+' demod'+suffix,DEMOD,[s,upload(arr['energy'+suffix]),d,uniform([Ci,Co],[plan.demodulation.epsilon,plan.demodulation.numerator])],[Math.ceil(Co/64),1]);return d;};
  let act=features;
  if(block.hasConv0){
   const plan=block.stylePlans.conv0,s0=styleOf('0',inC,plan),d0=demodOf('0',s0,inC,outC,plan),n=block.inSize,P=size+1;
   const phase=buffer(P*P*outC*4);
   for(const [py,px] of [[0,0],[0,1],[1,0],[1,1]]){
    const taps=parityTaps(py,px),Ho=py?n:n+1,Wo=px?n:n+1,t=TILES(outC);
    const w=upload(repack(arr.weight0,inC,outC,taps));
    step(`${block.id} conv0 p${py}${px}`,gemmShader(t,taps,false,px?1:2,0),[features,w,phase,uniform([n,n,inC,outC,Ho,Wo,P,2,py,px],[0,0,0]),s0],[Math.ceil(Ho*Wo/t.BM),outC/t.BN,1]);
   }
   act=buffer(size*size*outC*4);
   step(block.id+' fir',FIR,[phase,act,uniform([size,outC],[k.noiseStrength0,k.leakyAlpha0,k.gain0]),upload(arr.filter0),d0,noiseBuf[block.noise.conv0.name],upload(arr.bias0)],grid(size*size*outC/4));
  }
  const plan1=block.stylePlans.conv1,c1In=block.hasConv0?outC:inC,s1=styleOf('1',c1In,plan1),d1=demodOf('1',s1,c1In,outC,plan1),t=TILES(outC);
  const out=buffer(size*size*outC*4);
  step(block.id+' conv1',gemmShader(t,TAPS3,true),[act,upload(repack(arr.weight1,c1In,outC,TAPS3)),out,uniform([size,size,c1In,outC,size,size,size,1,0,0],[k.noiseStrength1,k.leakyAlpha1,k.gain1]),s1,d1,noiseBuf[block.noise.conv1.name],upload(arr.bias1)],[Math.ceil(size*size/t.BM),outC/t.BN,1]);
  const sr=styleOf('Rgb',outC,block.stylePlans.torgb),rgb=buffer(size*size*16);
  const brgb=new Float32Array(4);brgb.set(arr.biasRgb);
  step(block.id+' torgb',RGB,[out,rgb,uniform([size,outC,block.hasSkip?1:0]),sr,upload(arr.weightRgb),skip||dummy,block.hasSkip?upload(arr.filterRgb):upload(new Float32Array(16)),upload(brgb)],grid(size*size));
  features=out;skip=rgb;
 }
 const output=buffer(3*1048576*4,S|CS);
 step('output',OUT,[skip,output],grid(1048576));
 const spare=[];const marks=[];let lastNoise=null;
 let qs=null,qbuf=null;if(profile&&device.features.has('timestamp-query')){qs=device.createQuerySet({type:'timestamp',count:2*steps.length});qbuf=buffer(16*steps.length,GPUBufferUsage.QUERY_RESOLVE|CS);}
 function encode(){const e=device.createCommandEncoder();
  if(qs){steps.forEach((s,i)=>{const p=e.beginComputePass({timestampWrites:{querySet:qs,beginningOfPassWriteIndex:2*i,endOfPassWriteIndex:2*i+1}});p.setPipeline(s.pipe);p.setBindGroup(0,s.group);p.dispatchWorkgroups(...s.wg);p.end();});e.resolveQuerySet(qs,0,2*steps.length,qbuf,0);}
  else{const p=e.beginComputePass();for(const s of steps){p.setPipeline(s.pipe);p.setBindGroup(0,s.group);p.dispatchWorkgroups(...s.wg);}p.end();}
  return e;}
 async function submit(values,noise){
  if(failure)throw failure;device.queue.writeBuffer(latent,0,values);
  if(noise!==lastNoise){for(const [name,b] of Object.entries(noiseBuf))device.queue.writeBuffer(b,0,noise[name]);lastNoise=noise;}
  const e=encode();let readback=spare.pop()||device.createBuffer({size:output.size,usage:GPUBufferUsage.MAP_READ|CD});
  e.copyBufferToBuffer(output,0,readback,0,output.size);
  let tq=null;if(qs){tq=device.createBuffer({size:qbuf.size,usage:GPUBufferUsage.MAP_READ|CD});e.copyBufferToBuffer(qbuf,0,tq,0,qbuf.size);}
  device.queue.submit([e.finish()]);const mapped=readback.mapAsync(GPUMapMode.READ),tmapped=tq?.mapAsync(GPUMapMode.READ);
  return {raw:(async()=>{await mapped;const r=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();if(spare.length<2)spare.push(readback);else readback.destroy();
   if(tq){await tmapped;const t=new BigInt64Array(tq.getMappedRange().slice(0));marks.length=0;steps.forEach((s,i)=>marks.push([s.name,Number(t[2*i+1]-t[2*i])/1e6]));tq.unmap();tq.destroy();}
   if(failure)throw failure;return r;})()};
 }
 async function gpuOnly(values,noise,n){for(let i=0;i<n;i++){device.queue.writeBuffer(latent,0,values);if(noise!==lastNoise){for(const [name,b] of Object.entries(noiseBuf))device.queue.writeBuffer(b,0,noise[name]);lastNoise=noise;}device.queue.submit([encode().finish()]);}await device.queue.onSubmittedWorkDone();}
 return {submit,gpuOnly,async infer(v,n){return (await submit(v,n)).raw;},marks,coefficientBytes,steps:steps.length,dispose(){for(const b of all)b.destroy();for(const b of spare)b.destroy();device.destroy();}};
}
