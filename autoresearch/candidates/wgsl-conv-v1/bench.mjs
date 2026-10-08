import {convShader,convShader2,convShader3,naiveShader} from './conv.mjs';
const adapter=await navigator.gpu.requestAdapter();
const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[],requiredLimits:{maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize,maxComputeInvocationsPerWorkgroup:adapter.limits.maxComputeInvocationsPerWorkgroup,maxComputeWorkgroupSizeX:adapter.limits.maxComputeWorkgroupSizeX,maxComputeWorkgroupSizeY:adapter.limits.maxComputeWorkgroupSizeY,maxComputeWorkgroupStorageSize:adapter.limits.maxComputeWorkgroupStorageSize}});
let lastError=null;device.addEventListener('uncapturederror',e=>{lastError=e.error.message;});
const buf=(size,usage)=>device.createBuffer({size,usage});
const S=GPUBufferUsage.STORAGE,CD=GPUBufferUsage.COPY_DST,CS=GPUBufferUsage.COPY_SRC;
function rand(n,seed,scale){const a=new Float32Array(n);let s=seed;for(let i=0;i<n;i++){s=(s*1664525+1013904223)>>>0;a[i]=((s/4294967296)-.5)*2*scale;}return a;}
async function read(b,size){const r=buf(size,GPUBufferUsage.MAP_READ|CD);const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,size);device.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);const out=new Float32Array(r.getMappedRange().slice(0));r.destroy();return out;}
const pipes=new Map();
function pipeline(code){if(!pipes.has(code))pipes.set(code,device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}}));return pipes.get(code);}
async function time(pipe,bind,wg,reps){
 const qs=device.createQuerySet({type:'timestamp',count:2*reps}),res=buf(16*reps,GPUBufferUsage.QUERY_RESOLVE|CS);
 const e=device.createCommandEncoder();
 for(let r=0;r<reps;r++){const p=e.beginComputePass({timestampWrites:{querySet:qs,beginningOfPassWriteIndex:2*r,endOfPassWriteIndex:2*r+1}});p.setPipeline(pipe);p.setBindGroup(0,bind);p.dispatchWorkgroups(...wg);p.end();}
 e.resolveQuerySet(qs,0,2*reps,res,0);const rb=buf(16*reps,GPUBufferUsage.MAP_READ|CD);e.copyBufferToBuffer(res,0,rb,0,16*reps);device.queue.submit([e.finish()]);
 await rb.mapAsync(GPUMapMode.READ);const t=new BigInt64Array(rb.getMappedRange().slice(0));rb.destroy();qs.destroy();res.destroy();
 const ms=[];for(let r=0;r<reps;r++)ms.push(Number(t[2*r+1]-t[2*r])/1e6);ms.sort((a,b)=>a-b);return ms[Math.floor(ms.length/2)];}
window.benchMain=async({shapes,configs,reps=20})=>{
 const out=[];
 for(const [H,W,Ci,Co] of shapes){
  const xs=rand(H*W*Ci,1,1),ws=rand(9*Ci*Co,2,1/Math.sqrt(9*Ci));
  const X=buf(xs.byteLength,S|CD),Wt=buf(ws.byteLength,S|CD),Y=buf(H*W*Co*4,S|CS),R=buf(H*W*Co*4,S|CS),U=buf(16,GPUBufferUsage.UNIFORM|CD);
  device.queue.writeBuffer(X,0,xs);device.queue.writeBuffer(Wt,0,ws);device.queue.writeBuffer(U,0,new Uint32Array([H,W,Ci,Co]));
  const bg=(pipe,y)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[X,Wt,y,U].map((b,i)=>({binding:i,resource:{buffer:b}}))});
  const np=pipeline(naiveShader),total=H*W*Co,groups=Math.ceil(total/64);
  const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(np);p.setBindGroup(0,bg(np,R));p.dispatchWorkgroups(Math.min(groups,65535),Math.ceil(groups/65535));p.end();device.queue.submit([e.finish()]);
  const ref=await read(R,total*4);let refMax=0;for(const v of ref)refMax=Math.max(refMax,Math.abs(v));
  for(const c of configs){
   if(Co%c.BN||Ci%c.BK){continue;}
   lastError=null;let pipe;try{pipe=pipeline((c.v===3?convShader3:c.v===2?convShader2:convShader)(c));}catch(err){out.push({shape:[H,W,Ci,Co],config:c,error:String(err)});continue;}const b=bg(pipe,Y);const wg=[Math.ceil(H*W/c.BM),Co/c.BN,1];
   const ms=await time(pipe,b,wg,reps);const got=await read(Y,total*4);let err=0;for(let i=0;i<total;i++)err=Math.max(err,Math.abs(got[i]-ref[i]));
   out.push({shape:[H,W,Ci,Co],config:c,ms,tflops:2*H*W*9*Ci*Co/ms/1e9,maxAbsErr:err,refMax,error:lastError});
  }
  [X,Wt,Y,R,U].forEach(b=>b.destroy());
 }
 return out;};
document.title='ready';
