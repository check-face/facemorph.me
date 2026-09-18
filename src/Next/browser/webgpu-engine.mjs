// Product extraction of gpu-worker-v11, candidate mobile-boundary-bounded (results.tsv keep row
// mobile-boundary-bounded-phone). fused-resample-v1.mjs is byte-identical to
// experiment/device-lab/fused-resample-boundary-v2.js — no kernel changes; the prefix segment and
// split come from browser-onnx-mobile-fusion so the phase tensor arrives as two 64-channel tiles
// (tile0/tile1), matching the measured 686 ms/face S24 Ultra configuration.
export async function createWebGpuSession({config,noiseManifest,bytes,progress=()=>{}}){
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new DOMException('WebGPU is unavailable.','NotSupportedError');
 const required=134742528;if(adapter.limits.maxStorageBufferBindingSize<required)throw new DOMException('This WebGPU route needs storage bindings larger than128 MiB.','NotSupportedError');
 const sessions=[],buffers=new Set();let device,closing=false,failure;
 const moduleUrl=async(asset,mime='text/javascript')=>URL.createObjectURL(new Blob([await bytes(asset)],{type:mime}));
 const runtimeUrl=await moduleUrl(config.runtime.module),factoryUrl=await moduleUrl(config.runtime.factory),wasmUrl=await moduleUrl(config.runtime.wasm,'application/wasm');
 const ort=await import(/* webpackIgnore: true */ runtimeUrl);ort.env.wasm.numThreads=1;// JSEP executes synthesis on the GPU; only the small CPU prefix stage runs here, so extra wasm threads buy nothing (C-04).ort.env.wasm.wasmPaths={mjs:factoryUrl,wasm:wasmUrl};
 const json=async asset=>JSON.parse(new TextDecoder().decode(await bytes(asset))),floats=async asset=>{const b=await bytes(asset);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
 async function dispose(){closing=true;for(const session of sessions)try{await session.release();}catch{}for(const buffer of buffers)buffer.destroy();buffers.clear();device?.destroy();}
 try{
  const meta=await json(config.metadata),split=await json(config.split),filter=await floats(config.filter),bias=await floats(config.bias);
  progress('gpu-prefix-loading');const options={executionProviders:['webgpu'],preferredOutputLocation:'gpu-buffer',extra:{session:{disable_cpu_ep_fallback:'1'}}};
  const prefix=await ort.InferenceSession.create(await bytes(config.prefix),options);sessions.push(prefix);device=ort.env.webgpu.device;
  if(device.limits.maxStorageBufferBindingSize<required)throw Error('The runtime GPU device cannot bind the required tensor.');
  device.lost.then(info=>{if(!closing)failure=Error('GPU device lost: '+info.reason);});device.addEventListener('uncapturederror',event=>{failure=Error('GPU validation: '+event.error.message);});
  progress('gpu-suffix-loading');const suffix=await ort.InferenceSession.create(await bytes(config.suffix),{...options,executionProviders:[{name:'webgpu',device}]});sessions.push(suffix);if(ort.env.webgpu.device!==device)throw Error('GPU sessions use different devices.');
  function tensor(dims,data){const size=dims.reduce((a,b)=>a*b,4),buffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});buffers.add(buffer);if(data)device.queue.writeBuffer(buffer,0,data);return {buffer,tensor:ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims})};}
  const all={w:tensor([1,18,512])};for(const n of noiseManifest)all[n.name]=tensor(n.shape);
  const outputs=Object.fromEntries(Object.entries(split.prefixOutputs).map(([name,dims])=>[name,tensor(dims)]));
  const external=tensor([1,32,1024,1024]),out=tensor([1,3,1024,1024]),filterBuffer=tensor([16],filter),biasBuffer=tensor([32],bias);
  const feeds=Object.fromEntries(prefix.inputNames.map(name=>[name,all[name].tensor])),preout=Object.fromEntries(Object.entries(outputs).map(([name,item])=>[name,item.tensor]));
  const suffixFeeds=Object.fromEntries(split.suffixInputs.map(name=>[name,name===split.external?external.tensor:(outputs[name]||all[name]).tensor]));
  const kernelUrl=await moduleUrl(config.kernel);const {createBoundaryPipeline}=await import(/* webpackIgnore: true */ kernelUrl);
  const fused=(await createBoundaryPipeline(device,meta,true,256,'bounded')).bind({phase:outputs[meta.phase+'__tile0'].buffer,phaseB:outputs[meta.phase+'__tile1'].buffer,demod:outputs[meta.demod]?.buffer,noise:all.noise_15.buffer,filter:filterBuffer.buffer,bias:biasBuffer.buffer,output:external.buffer});
  return {async infer(values,noise){if(failure)throw failure;if(closing)throw Error('GPU session closed.');device.queue.writeBuffer(all.w.buffer,0,values);for(const n of noiseManifest)device.queue.writeBuffer(all[n.name].buffer,0,noise[n.name]);await prefix.run(feeds,preout);const command=device.createCommandEncoder();fused.encode(command);device.queue.submit([command.finish()]);await suffix.run(suffixFeeds,{image:out.tensor});await device.queue.onSubmittedWorkDone();if(failure)throw failure;
   const readback=device.createBuffer({size:out.buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const copy=device.createCommandEncoder();copy.copyBufferToBuffer(out.buffer,0,readback,0,out.buffer.size);device.queue.submit([copy.finish()]);await readback.mapAsync(GPUMapMode.READ);const raw=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();if(failure)throw failure;return raw;}finally{readback.destroy();}},dispose,provider:'webgpu',runtime:'1.22.0',model:config.prefix.sha256};
 }catch(error){await dispose();throw error;}
}
