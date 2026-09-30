import {installGpuTrace} from './gpu-trace.js';
const root='/review-artifacts/',gen=root+'browser-onnx-phase1/',models=root+'browser-onnx-profile/',status=document.querySelector('#status');
async function f32(p){const r=await fetch(p);if(!r.ok)throw Error(`${r.status} ${p}`);return new Float32Array(await r.arrayBuffer());}
function diff(a,b){if(a.length!==b.length)throw Error('Shape mismatch');let max=0,rgbMax=0,unequal=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);if(d)unequal++;const pixel=v=>Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(v*127.5)+128))));rgbMax=Math.max(rgbMax,Math.abs(pixel(a[i])-pixel(b[i])));}return {maxFloatDiff:max,rgbMaxDiff:rgbMax,unequal};}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const runId=typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
const saveRoot=['localhost','127.0.0.1','[::1]'].includes(location.hostname)?'/save/':'/save/lan/'+runId+'/';
async function save(r){document.querySelector('pre').textContent=JSON.stringify(r,null,2);await fetch(saveRoot+'browser.json',{method:'POST',body:JSON.stringify(r,null,2)});}
async function read(device,buffer){const b=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange().slice(0);b.unmap();b.destroy();return data;}
async function pixels(device,input,raw){
 const results=[];for(const size of [1024,512]){
  const code=`@group(0) @binding(0) var<storage,read> x:array<f32>;
@group(0) @binding(1) var<storage,read_write> rgba:array<u32>;
fn pixel(v:f32)->u32 { let scaled=v*127.5; return u32(clamp(scaled+128.0,0.0,255.0)); }
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let i=gid.x; if(i>=${size*size}u){return;} let p=(i/${size}u)*${1024*(1024/size)}u+(i%${size}u)*${1024/size}u;
 rgba[i]=pixel(x[p])|(pixel(x[p+1048576u])<<8u)|(pixel(x[p+2097152u])<<16u)|0xff000000u;
}`;
  let t=performance.now();const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
  const output=device.createBuffer({size:size*size*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]});const startupMs=performance.now()-t;
  const run=()=>{const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(Math.ceil(size*size/256));p.end();device.queue.submit([e.finish()]);};
  run();await device.queue.onSubmittedWorkDone();const times=[];for(let i=0;i<20;i++){t=performance.now();run();await device.queue.onSubmittedWorkDone();times.push(performance.now()-t);}
  t=performance.now();const bytes=new Uint8Array(await read(device,output));const readbackMs=performance.now()-t;let max=0,unequal=0;
  for(let i=0;i<size*size;i++)for(let c=0;c<4;c++){const p=Math.floor(i/size)*(1024*1024/size)+(i%size)*(1024/size);const ref=c===3?255:Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(raw[p+c*1048576]*127.5)+128))));const d=Math.abs(bytes[i*4+c]-ref);max=Math.max(max,d);if(d)unequal++;}
  if(max>1)throw Error('GPU pixel conversion failed');if(size===1024){const canvas=document.querySelector('canvas');canvas.width=size;canvas.height=size;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),size,size),0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await fetch(saveRoot+'face.png',{method:'POST',body:blob});}
  results.push({size,startupMs,conversionMedianMs:median(times),timesMs:times,readbackMs,downloadBytes:bytes.length,maxRgbDifference:max,unequal,resize:size===512?'nearest-neighbour diagnostic, not production resampling':'none'});output.destroy();
 }return results;
}
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;const trace=installGpuTrace(),report={runId,userAgent:navigator.userAgent,started:new Date().toISOString(),runtime:'ORT Web 1.24.3',scope:'26 useful 1024px faces; batches 4 execute 28; three repeated runs per pipeline depth; synthesis only',rows:[],visibilityEvents:[]};
 const visibility=()=>report.visibilityEvents.push({ms:performance.now(),state:document.visibilityState});document.addEventListener('visibilitychange',visibility);visibility();let device,submits=0;const original=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...a){if(device&&this===device.queue)submits++;return original.apply(this,a);};
 try{
  ort.env.wasm.numThreads=1;if(!navigator.gpu)throw Error('WebGPU is unavailable: this browser needs a secure context. See the LAN setup instructions below.');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('This browser exposes WebGPU but no GPU adapter is available. Check hardware acceleration and chrome://gpu (or edge://gpu) on this device.');report.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:adapter.info.isFallbackAdapter};
  const manifest=await(await fetch(gen+'manifest.json')).json(),w=await f32(root+'browser-onnx-video/w.f32'),noise=await Promise.all(manifest.noise.map(n=>f32(gen+n.file))),firstRef=await f32(root+'browser-onnx-polyphase/browser-image.f32'),lastRef=await f32(root+'browser-onnx-polyphase/browser-zero.f32');const count=3*1024*1024;
  const cases=[{name:'simplified',batch:1},{name:'spatial',batch:1},...[1,2,4].map(batch=>({name:'polyphase',batch}))];
  for(const cfg of cases){const row={...cfg};report.rows.push(row);let session,buffers=[];
   try{
    status.textContent=`Loading ${cfg.name} batch ${cfg.batch}`;let t=performance.now();const model=models+`synthesis-${cfg.name}${cfg.batch===1?'':'-b'+cfg.batch}.onnx`;
    session=await ort.InferenceSession.create(model,{executionProviders:['webgpu'],preferredOutputLocation:'gpu-buffer',extra:{session:{disable_cpu_ep_fallback:'1'}}});row.loadMs=performance.now()-t;device=ort.env.webgpu.device;row.deviceSource='Captured from ORT after creating this session; own queue awaited';
    const tensor=(data,dims)=>{const buffer=device.createBuffer({size:Math.ceil(data.byteLength/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});device.queue.writeBuffer(buffer,0,data);buffers.push(buffer);return {buffer,tensor:ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims})};};
    t=performance.now();const feeds={};manifest.noise.forEach((n,i)=>feeds[n.name]=tensor(noise[i],n.shape).tensor);const inputs=Array.from({length:4},()=>tensor(w.slice(0,cfg.batch*18*512),[cfg.batch,18,512]));const outputs=Array.from({length:4},()=>tensor(new Float32Array(cfg.batch*count),[cfg.batch,3,1024,1024]));row.residentUploadMs=performance.now()-t;
    let last=outputs[0];async function run(calls,depth){for(let i=0;i<calls;i++){const k=i%depth;feeds.w=inputs[k].tensor;device.queue.writeBuffer(inputs[k].buffer,0,w.subarray(i*cfg.batch*18*512,(i+1)*cfg.batch*18*512));last=outputs[k];await session.run(feeds,{image:last.tensor});if((i+1)%depth===0)await device.queue.onSubmittedWorkDone();}await device.queue.onSubmittedWorkDone();}
    row.warmupMs=[];for(let i=0;i<3;i++){t=performance.now();await run(1,1);row.warmupMs.push(performance.now()-t);}
    const first=new Float32Array(await read(device,last.buffer));row.firstCorrectness=diff(first.subarray(0,count),firstRef);if(row.firstCorrectness.maxFloatDiff>.002||!Number.isFinite(row.firstCorrectness.maxFloatDiff))throw Error('First output mismatch');
    row.memoryBefore=trace.memory;row.measurements=[];
    for(const depth of [1,4]){const times=[],gpuCounts=[],visibility=[];for(let repeat=0;repeat<3;repeat++){status.textContent=`${cfg.name} batch ${cfg.batch}, depth ${depth}, repeat ${repeat+1}/3`;const before=submits,ve=report.visibilityEvents.length;const state=document.visibilityState;t=performance.now();await run(Math.ceil(26/cfg.batch),depth);times.push(performance.now()-t);gpuCounts.push(submits-before);visibility.push({initial:state,changes:report.visibilityEvents.length-ve});}
     const measurement={depth,timesMs:times,msPerUsefulFace:median(times)/26,verifiedDeviceSubmissions:gpuCounts,visibility};row.measurements.push(measurement);
     const raw=new Float32Array(await read(device,last.buffer)),offset=(25%cfg.batch)*count;measurement.lastCorrectness=diff(raw.subarray(offset,offset+count),lastRef);if(measurement.lastCorrectness.maxFloatDiff>.002||!Number.isFinite(measurement.lastCorrectness.maxFloatDiff)||gpuCounts.some(n=>!n))throw Error('Last output/GPU mismatch');
     const tr=document.createElement('tr');for(const v of [cfg.name,cfg.batch,depth,measurement.msPerUsefulFace.toFixed(2),measurement.lastCorrectness.rgbMaxDiff]){const td=document.createElement('td');td.textContent=v;tr.append(td);}document.querySelector('tbody').append(tr);await save(report);
    }
    if(cfg.name==='polyphase'&&cfg.batch===1){await run(1,1);const raw=new Float32Array(await read(device,last.buffer));row.gpuPixels=await pixels(device,last.buffer,raw);}
    row.memoryAfter=trace.memory;row.completed=true;
   }catch(e){row.error=String(e);status.textContent=row.error;}finally{if(session)await session.release();for(const b of buffers)b.destroy();}await save(report);
  }
  report.finished=true;report.completed=report.rows.every(row=>row.completed);status.textContent=report.completed?'Completed — timings and GPU-rendered face below':'Finished with failed cases — inspect the recorded errors below';const download=document.createElement('button');download.textContent='Download this run as JSON';download.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='webgpu-'+runId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};document.querySelector('pre').before(download);
 }catch(e){report.error=String(e);status.textContent=report.error;}finally{GPUQueue.prototype.submit=original;trace.restore();document.removeEventListener('visibilitychange',visibility);}await save(report);
};
