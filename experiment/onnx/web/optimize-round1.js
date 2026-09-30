const root='/review-artifacts/',gen=root+'browser-onnx-phase1/',base=root+'browser-onnx-optimization/';const status=document.querySelector('#status');
async function f32(url){const r=await fetch(url);if(!r.ok)throw Error(url+' '+r.status);return new Float32Array(await r.arrayBuffer());}
function difference(raw,reference){let max=0,sum=0,rgbMax=0,rgbCount=0;for(let i=0;i<raw.length;i++){const d=Math.abs(raw[i]-reference[i]);max=Math.max(max,d);sum+=d;const pixel=v=>Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(v*127.5)+128))));const a=pixel(raw[i]),b=pixel(reference[i]);if(a!==b)rgbCount++;rgbMax=Math.max(rgbMax,Math.abs(a-b));}return {maxFloatDiff:max,meanFloatDiff:sum/raw.length,rgbMaxDiff:rgbMax,rgbUnequal:rgbCount};}
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;const report={started:new Date().toISOString(),userAgent:navigator.userAgent,runtime:'1.24.3',scope:'26 unique 1024px synthesis outputs, excludes mapping and codecs; mixed precision explicitly labelled',rows:[]};
 let device,submits=0,ownSubmits=0;const originalSubmit=GPUQueue.prototype.submit;
 try{
 const adapter=await navigator.gpu.requestAdapter();report.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:adapter.info.isFallbackAdapter};
 ort.env.wasm.numThreads=1;GPUQueue.prototype.submit=function(...a){submits++;if(device&&this===device.queue)ownSubmits++;return originalSubmit.apply(this,a);};
 const manifest=await(await fetch(gen+'manifest.json')).json(),w=await f32(root+'browser-onnx-video/w.f32'),noise=[];
 for(const n of manifest.noise)noise.push(await f32(gen+n.file));
 let reference,referenceLast;
 const cases=[{name:'original-resident',model:gen+'synthesis.onnx'},
 {name:'simplified-resident',model:base+'synthesis-simplified.onnx'},
 {name:'simplified-capture-queued',model:base+'synthesis-simplified.onnx',capture:true,queued:true},
 {name:'nchw-capture-queued',model:base+'synthesis-simplified.onnx',capture:true,queued:true,layout:'NCHW'},
 {name:'mixed-capture-queued',model:base+'synthesis-mixed.onnx',capture:true,queued:true,mixed:true}];
 for(const cfg of cases){const row={...cfg};let session;const buffers=[];
 try{
 status.textContent='Loading '+cfg.name;let t=performance.now();session=await ort.InferenceSession.create(cfg.model,{executionProviders:[{name:'webgpu',...(cfg.layout?{preferredLayout:cfg.layout}:{})}],enableGraphCapture:!!cfg.capture,preferredOutputLocation:'gpu-buffer'});row.loadMs=performance.now()-t;
 device=ort.env.webgpu.device;row.deviceSource='Actual ORT session device, captured after creation';row.deviceFeatures=[...device.features];
 function tensor(data,dims){const buffer=device.createBuffer({size:Math.ceil(data.byteLength/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});device.queue.writeBuffer(buffer,0,data);buffers.push(buffer);return {buffer,tensor:ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims})};}
 const feeds={};manifest.noise.forEach((n,i)=>feeds[n.name]=tensor(noise[i],n.shape).tensor);
 const input=tensor(w.slice(0,18*512),[1,18,512]);feeds.w=input.tensor;
 const output=tensor(new Float32Array(3*1024*1024),[1,3,1024,1024]);
 async function read(){const staging=device.createBuffer({size:output.buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output.buffer,0,staging,0,output.buffer.size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();return data;}
 status.textContent='Warmup '+cfg.name;t=performance.now();for(let i=0;i<3;i++){await session.run(feeds,{image:output.tensor});await device.queue.onSubmittedWorkDone();}row.warmupMs=performance.now()-t;
 const raw=await read();if(!reference)reference=raw;row.correctness=difference(raw,reference);if(!Number.isFinite(row.correctness.maxFloatDiff)||(!cfg.mixed&&row.correctness.maxFloatDiff>.002))throw Error('Correctness failed');
 const before=submits,ownBefore=ownSubmits;await device.queue.onSubmittedWorkDone();t=performance.now();
 for(let i=0;i<26;i++){status.textContent=cfg.name+': '+i+'/26';device.queue.writeBuffer(input.buffer,0,w.subarray(i*18*512,(i+1)*18*512));await session.run(feeds,{image:output.tensor});if(!cfg.queued)await device.queue.onSubmittedWorkDone();}
 await device.queue.onSubmittedWorkDone();row.totalMs=performance.now()-t;row.msPerFace=row.totalMs/26;row.gpuQueueSubmissions=submits-before;row.verifiedDeviceSubmissions=ownSubmits-ownBefore;
 const last=await read();if(!referenceLast)referenceLast=last;row.lastFaceCorrectness=difference(last,referenceLast);row.lastFaceDiffers=last.some((v,i)=>v!==raw[i]);
 if(!row.verifiedDeviceSubmissions||!row.lastFaceDiffers||!Number.isFinite(row.lastFaceCorrectness.maxFloatDiff)||(!cfg.mixed&&row.lastFaceCorrectness.maxFloatDiff>.002))throw Error('Final output or GPU execution validation failed');
 row.completed=true;
 const tr=document.createElement('tr');for(const v of [cfg.name,(row.msPerFace/1000).toFixed(3),(row.totalMs/1000).toFixed(2),row.verifiedDeviceSubmissions,row.correctness.rgbMaxDiff]){const td=document.createElement('td');td.textContent=v;tr.append(td);}document.querySelector('tbody').append(tr);
 }catch(e){row.error=String(e);row.completed=false;const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent=cfg.name+': '+row.error;tr.append(td);document.querySelector('tbody').append(tr);}finally{if(session)await session.release();for(const b of buffers)b.destroy();}
 report.rows.push(row);await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(report,null,2)});
 }
 report.completed=true;status.textContent='Completed';
 }catch(e){report.error=String(e);status.textContent=String(e);}finally{GPUQueue.prototype.submit=originalSubmit;}
 document.querySelector('pre').textContent=JSON.stringify(report,null,2);await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(report,null,2)});
};
