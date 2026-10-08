// Product extraction of gpu-worker-v11, candidate mobile-boundary-bounded (results.tsv keep row
// mobile-boundary-bounded-phone). fused-resample-v1.mjs is byte-identical to
// experiment/device-lab/fused-resample-boundary-v2.js — no kernel changes; the prefix segment and
// split come from browser-onnx-mobile-fusion so the phase tensor arrives as two 64-channel tiles
// (tile0/tile1), matching the measured 686 ms/face S24 Ultra configuration.
export async function createWebGpuSession({config,noiseManifest,bytes,progress=()=>{},importModule=url=>import(/* webpackIgnore: true */ url)}){
 const adapter=await globalThis.navigator?.gpu?.requestAdapter();if(!adapter)throw new DOMException('WebGPU is unavailable.','NotSupportedError');
 // The bounded mobile split needs exactly 128 MiB (32 * 1024 * 1024 float32s),
 // not the older untiled graph's 134742528-byte binding. Keep both adapter and device gates.
 const required=134217728;
 const checkLimits=limits=>{if(limits.maxStorageBufferBindingSize<required||limits.maxBufferSize<required)throw new DOMException('The bounded WebGPU route needs 128 MiB buffers and storage bindings.','NotSupportedError');};
 checkLimits(adapter.limits);
 const sessions=[],buffers=new Set(),urls=new Set();let device,ort,closing=false,failure;
 const moduleUrl=async(asset,mime='text/javascript')=>{const url=URL.createObjectURL(new Blob([await bytes(asset)],{type:mime}));urls.add(url);return url;};
 const json=async asset=>JSON.parse(new TextDecoder().decode(await bytes(asset))),floats=async asset=>{const b=await bytes(asset);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
 async function dispose(){
  if(closing)return;closing=true;
  for(const session of sessions)try{await session.release();}catch{}
  for(const buffer of buffers)buffer.destroy();buffers.clear();
  // Session creation can allocate a device and then reject before assigning our local device.
  device?.destroy();
  for(const url of urls)URL.revokeObjectURL(url);urls.clear();
 }
 try{
  // Research variant: ORT from a local copy of a given onnxruntime-web release (globalThis.__ortBase),
  // instead of the pinned 1.22 JSEP bytes in the manifest. Everything else is the product engine.
  const base=globalThis.__ortBase;ort=await importModule(base+'ort.webgpu.min.mjs');
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=base;
  ort.env.webgpu.adapter=adapter;
  if(globalThis.__ortProfile){ort.env.webgpu.profiling={mode:'default',ondata:d=>globalThis.__ortProfile.push(d)};}
  const meta=await json(config.metadata),split=await json(config.split),filter=await floats(config.filter),bias=await floats(config.bias);
  const options={executionProviders:['webgpu'],preferredOutputLocation:'gpu-buffer',extra:{session:{disable_cpu_ep_fallback:'1'}}};
  // The stage is announced once the bytes are in hand, never before. `bytes()` emits acquisition
  // progress, so announcing first meant the download immediately overwrote the line: the screen
  // sat on "Downloading model files… 183 MB of 212 MB" through the whole silent minute ORT
  // spends deserialising a 150 MB graph, and every report of a hang pointed at the wrong phase.
  const prefixModel=await bytes(config.prefix);progress('gpu-prefix-loading');
  const prefix=await ort.InferenceSession.create(prefixModel,options);sessions.push(prefix);device=await ort.env.webgpu.device;
  checkLimits(device.limits);
  device.lost.then(info=>{if(!closing)failure=Error('GPU device lost: '+info.reason);});device.addEventListener('uncapturederror',event=>{failure=Error('GPU validation: '+event.error.message);});
  const suffixModel=await bytes(config.suffix);progress('gpu-suffix-loading');
  const suffix=await ort.InferenceSession.create(suffixModel,options);sessions.push(suffix);if((await ort.env.webgpu.device)!==device)throw Error('GPU sessions use different devices.');
  function tensor(dims,data){const size=dims.reduce((a,b)=>a*b,4),buffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});buffers.add(buffer);if(data)device.queue.writeBuffer(buffer,0,data);return {buffer,tensor:ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims})};}
  const all={w:tensor([1,18,512])};for(const n of noiseManifest)all[n.name]=tensor(n.shape);
  const outputs=Object.fromEntries(Object.entries(split.prefixOutputs).map(([name,dims])=>[name,tensor(dims)]));
  const external=tensor([1,32,1024,1024]),out=tensor([1,3,1024,1024]),filterBuffer=tensor([16],filter),biasBuffer=tensor([32],bias);
  const feeds=Object.fromEntries(prefix.inputNames.map(name=>[name,all[name].tensor])),preout=Object.fromEntries(Object.entries(outputs).map(([name,item])=>[name,item.tensor]));
  const suffixFeeds=Object.fromEntries(split.suffixInputs.map(name=>[name,name===split.external?external.tensor:(outputs[name]||all[name]).tensor]));
  const kernelUrl=await moduleUrl(config.kernel);const {createBoundaryPipeline}=await importModule(kernelUrl);
  const fused=(await createBoundaryPipeline(device,meta,true,256,'bounded')).bind({phase:outputs[meta.phase+'__tile0'].buffer,phaseB:outputs[meta.phase+'__tile1'].buffer,demod:outputs[meta.demod]?.buffer,noise:all.noise_15.buffer,filter:filterBuffer.buffer,bias:biasBuffer.buffer,output:external.buffer});
  // Split infer: `submit` queues one frame's whole GPU schedule plus the copy into its own readback
  // buffer and starts the map before returning, so the caller can queue the next frame while this
  // one is still on the GPU. Queue order keeps the copy ahead of the next frame's writes to `out`.
  const spare=[];
  async function submit(values,noise){if(failure)throw failure;if(closing)throw Error('GPU session closed.');device.queue.writeBuffer(all.w.buffer,0,values);for(const n of noiseManifest)device.queue.writeBuffer(all[n.name].buffer,0,noise[n.name]);await prefix.run(feeds,preout);const command=device.createCommandEncoder();fused.encode(command);device.queue.submit([command.finish()]);await suffix.run(suffixFeeds,{image:out.tensor});if(failure)throw failure;
   const readback=spare.pop()||device.createBuffer({size:out.buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});const copy=device.createCommandEncoder();copy.copyBufferToBuffer(out.buffer,0,readback,0,out.buffer.size);device.queue.submit([copy.finish()]);const mapped=readback.mapAsync(GPUMapMode.READ);
   return {raw:(async()=>{try{await mapped;}catch(error){readback.destroy();throw failure||error;}const raw=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();if(failure){readback.destroy();throw failure;}if(spare.length<2)spare.push(readback);else readback.destroy();return raw;})()};}
  return {async infer(values,noise){return (await submit(values,noise)).raw;},submit,dispose,provider:'webgpu',runtime:'1.22.0',model:config.prefix.sha256};
 }catch(error){await dispose();throw error;}
}
