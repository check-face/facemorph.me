import init,{BlockRunner} from '../burn-candidate/pkg/facemorph_burn_candidate.js';
import {installGpuTrace} from './gpu-trace.js';
const base='/review-artifacts/browser-onnx-block/',status=document.querySelector('#status');
async function bytes(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`${r.status} ${path}`);return r.arrayBuffer();}
function error(a,b){if(a.length!==b.length)throw Error(`Tensor length mismatch ${a.length} vs ${b.length}`);let max=0,sum=0,unequal=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];max=Math.max(max,Math.abs(d));sum+=d*d;if(d!==0)unequal++;}return {maxAbs:max,rmse:Math.sqrt(sum/a.length),unequal,elements:a.length};}
async function save(r){document.querySelector('pre').textContent=JSON.stringify(r,null,2);const p=await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(r,null,2)});if(!p.ok)throw Error('Save failed');}
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;Error.stackTraceLimit=100;const report={started:new Date().toISOString(),backend:'Burn 0.21 CubeCL Wgpu, fusion disabled, channel-as-batch filtering',scope:'Complete b256.conv0 layer, 26 useful outputs, 4 distinct input fixtures cycling, full FP32',rows:[]};const trace=installGpuTrace();const oldLog=console.log,oldError=console.error;report.logs=[];console.log=(...a)=>{oldLog(...a);if(String(a[0]).startsWith('Burn:')){report.logs.push(a.map(String).join(' '));status.textContent=String(a[0]);save(report);}};console.error=(...a)=>{oldError(...a);report.logs.push(a.map(String).join(' '));save(report);};let submits=0;const original=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...a){submits++;return original.apply(this,a);};
 try{
  let t=performance.now();const wasm=await bytes('../burn-candidate/pkg/facemorph_burn_candidate_bg.wasm?run='+Date.now());report.wasmSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',wasm))].map(v=>v.toString(16).padStart(2,'0')).join('');await init({module_or_path:wasm});report.wasmStartupMs=performance.now()-t;
  const manifest=await(await fetch(base+'manifest.json',{cache:'no-store'})).json();const [xa,wa,na,ya]=await Promise.all(['x.f32','w.f32','noise.f32','native-y.f32'].map(f=>bytes(base+f)));const x=new Float32Array(xa),w=new Float32Array(wa),noise=new Float32Array(na),native=new Float32Array(ya),xsize=256*128*128,ysize=128*256*256;
  ort.env.wasm.numThreads=1;
  for(const runtime of (new URLSearchParams(location.search).get('only')==='burn'?['burn']:['onnx','burn']))for(const batch of (new URLSearchParams(location.search).has('smoke')?[1]:[1,2,4])){
   let session,runner,device,buffers=[];const row={runtime,batch};
   try{
    status.textContent=`Loading ${runtime} batch ${batch}`;t=performance.now();let run,read;
    if(runtime==='onnx'){
     session=await ort.InferenceSession.create(base+`block-b${batch}.onnx`,{executionProviders:[{name:'webgpu'}],preferredOutputLocation:'gpu-buffer'});device=ort.env.webgpu.device;
     const tensor=(data,dims)=>{const b=device.createBuffer({size:Math.ceil(data.byteLength/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);buffers.push(b);return {buffer:b,tensor:ort.Tensor.fromGpuBuffer(b,{dataType:'float32',dims})};};
     const n=tensor(noise,[256,256]);const inputs=[];for(let i=0;i<4;i+=batch)inputs.push({x:tensor(x.subarray(i*xsize,(i+batch)*xsize),[batch,256,128,128]).tensor,w:tensor(w.subarray(i*512,(i+batch)*512),[batch,512]).tensor,noise:n.tensor});
     const outputs=Array.from({length:4},()=>tensor(new Float32Array(batch*ysize),[batch,128,256,256]));let last=outputs[0];
     run=async(calls,depth)=>{for(let i=0;i<calls;i++){last=outputs[i%depth];await session.run(inputs[i%inputs.length],{y:last.tensor});if((i+1)%depth===0)await device.queue.onSubmittedWorkDone();}await device.queue.onSubmittedWorkDone();};
     read=async()=>{const b=device.createBuffer({size:last.buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.copyBufferToBuffer(last.buffer,0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return data;};
    }else{
     const data=new Uint8Array(await bytes(base+`block-b${batch}.bpk`));runner=await BlockRunner.create(data,x,w,noise,batch);run=(n,d)=>runner.run(n,d);read=()=>runner.read();
    }
    row.loadAndUploadMs=performance.now()-t;row.warmupMs=[];
    if(runtime==='burn'&&batch===1&&new URLSearchParams(location.search).has('debug')){
     row.diagnostics=[];const stages=await(await fetch(base+'diagnostics.json',{cache:'no-store'})).json();
     const sequence=new URLSearchParams(location.search).has('repeat')?[2,2,2,8,2,0,1,2,3,2,5,5]:stages.map((_,i)=>i);
     for(const i of sequence){status.textContent='Burn diagnostic '+i+' run '+row.diagnostics.length;const start=performance.now(),before=submits,actual=await runner.debug(i),elapsedMs=performance.now()-start,ref=new Float32Array(await bytes(base+stages[i].file));row.diagnostics.push({stage:i,name:stages[i].name,elapsedMs,gpuSubmissions:submits-before,error:error(actual,ref)});await save({...report,diagnostic:row});}
    }
    for(let j=0;j<6;j++){status.textContent=`Warmup ${runtime} b${batch}: ${j+1}/6`;t=performance.now();await run(1,1);row.warmupMs.push(performance.now()-t);}
    const first=await read();row.firstError=error(first,native.subarray(0,batch*ysize));if(!Number.isFinite(row.firstError.maxAbs)||row.firstError.maxAbs>0.002)throw Error('FP32 accuracy check failed');
    row.memoryBefore=trace.memory;row.measurements=[];
    for(const depth of [1,4]){const times=[];let count=0;for(let repeat=0;repeat<3;repeat++){status.textContent=`${runtime} b${batch}, depth ${depth}, repeat ${repeat+1}/3`;const before=submits;t=performance.now();await run(Math.ceil(26/batch),depth);times.push(performance.now()-t);count+=submits-before;}
     const median=[...times].sort((a,b)=>a-b)[1];const measurement={depth,timesMs:times,medianMs:median,msPerUsefulFace:median/26,gpuSubmissions:count};row.measurements.push(measurement);
     const start=((Math.ceil(26/batch)-1)%(4/batch))*batch;const last=await read();measurement.lastError=error(last,native.subarray(start*ysize,(start+batch)*ysize));if(!count||!Number.isFinite(measurement.lastError.maxAbs)||measurement.lastError.maxAbs>0.002)throw Error('Final output/GPU validation failed');
     const tr=document.createElement('tr');for(const value of [runtime,batch,depth,measurement.msPerUsefulFace.toFixed(2),row.firstError.maxAbs.toExponential(2)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}document.querySelector('tbody').append(tr);
    }
    row.memoryAfter=trace.memory;row.completed=true;
   }catch(e){row.error=String(e);status.textContent=row.error;}finally{if(session)await session.release();if(runner)runner.free();for(const b of buffers)b.destroy();}
   report.rows.push(row);await save(report);
  }
  report.finished=true;report.completed=report.rows.every(r=>r.completed);status.textContent=report.completed?'Layer experiments completed':'Layer experiments finished with validation failures';
 }catch(e){report.error=String(e);status.textContent=report.error;}finally{GPUQueue.prototype.submit=original;trace.restore();console.log=oldLog;console.error=oldError;}
 await save(report);
};
