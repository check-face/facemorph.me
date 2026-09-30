import {fusedResample} from './fused-resample.js';
const base='/review-artifacts/browser-onnx-fusion/',status=document.querySelector('#status');
const f32=async p=>new Float32Array(await(await fetch(base+p)).arrayBuffer());
const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
async function read(d,b){const s=d.createBuffer({size:b.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=d.createCommandEncoder();e.copyBufferToBuffer(b,0,s,0,b.size);d.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);const out=new Float32Array(s.getMappedRange().slice(0));s.unmap();s.destroy();return out;}
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;const r={started:new Date().toISOString(),scope:'Isolated FP32 b1024.conv0 combined kernel; identical arithmetic; 32/64/128/256 workgroups; 3 orders, 10 completed dispatches per sample',rows:[]};const buffers=[];let d;
 const save=async()=>{document.querySelector('pre').textContent=JSON.stringify(r,null,2);const s=await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(r,null,2)});if(!s.ok)throw Error('Save failed');};
 try{
 const adapter=await navigator.gpu.requestAdapter();r.adapter=adapter.info;d=await adapter.requestDevice({requiredLimits:{maxBufferSize:adapter.limits.maxBufferSize,maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize}});
 const meta=await(await fetch(base+'manifest.json')).json();const tensor=a=>{const b=d.createBuffer({size:a.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(b,0,a);buffers.push(b);return b;};const bindings={};for(const name of ['phase','demod','noise','filter','bias'])bindings[name]=tensor(await f32(name+'.f32'));bindings.output=tensor(new Float32Array(33554432));const kernels={};
 for(const wg of [256,128,64,32]){const t=performance.now();kernels[wg]=await fusedResample(d,bindings,meta,true,wg);r.rows.push({workgroup:wg,compileMs:performance.now()-t,samplesMs:[]});}
 const run=async(wg,n)=>{const e=d.createCommandEncoder();for(let i=0;i<n;i++)kernels[wg].encode(e);d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();};
 for(const wg of [256,128,64,32])await run(wg,3);
 for(const order of [[256,128,64,32],[32,64,128,256],[128,256,32,64]])for(const wg of order){status.textContent='Measure workgroup '+wg;const row=r.rows.find(x=>x.workgroup===wg);const t=performance.now();await run(wg,10);row.samplesMs.push((performance.now()-t)/10);}
 let reference;for(const wg of [256,128,64,32]){await run(wg,1);const a=await read(d,bindings.output),row=r.rows.find(x=>x.workgroup===wg);if(!reference)reference=a;let max=0,unequal=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-reference[i]);max=Math.max(max,delta);if(delta)unequal++;}row.correctness={elements:a.length,maxAbs:max,unequal,exact:unequal===0};row.medianMs=med(row.samplesMs);if(!Number.isFinite(max)||unequal)throw Error('Arithmetic changed');}r.completed=true;status.textContent='Completed workgroup sweep';
 }catch(e){r.error=String(e);status.textContent=r.error;}finally{buffers.forEach(b=>b.destroy());}await save();
};
