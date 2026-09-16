import {createWebGpuSession} from './webgpu-engine.mjs';
import {decodeReferencePng,encodeRgbaPng} from './png.mjs';
import {createBrowserModelCache} from '../Assets/model-cache.mjs';
import {inputLatent,truncate,requireLatent,rgba1024} from './identity.mjs';
import {qualifyEncoderReference} from './encoder-preflight.mjs';
let manifest,ort,cache,mapping,synthesis,noise,average,provider,webgl,webgpu,currentId;
const report=(id,stage,extra={})=>postMessage({id,type:'progress',stage,...extra});
async function bytes(asset,id){cache ||= await createBrowserModelCache();report(id,'asset-acquisition',{loaded:0,total:asset.size});const handle=await cache.acquire(asset);const data=await(await handle.open()).arrayBuffer();report(id,'asset-acquisition',{loaded:data.byteLength,total:asset.size});return new Uint8Array(data);}
async function floats(asset,id){const b=await bytes(asset,id);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);}
async function ensureOrt(id){if(ort)return;report(id,'runtime-loading');const assets=manifest.runtime.assets,module=assets.find(a=>a.url===manifest.runtime.moduleUrl),factory=assets.find(a=>a.url.endsWith('/ort-wasm-simd-threaded.mjs')),wasm=assets.find(a=>a.url.endsWith('/ort-wasm-simd-threaded.wasm'));if(!module||!factory||!wasm)throw Error('Incomplete pinned runtime bundle');
 // Import exactly the verified bytes, avoiding a second unchecked network request.
 const moduleUrl=URL.createObjectURL(new Blob([await bytes(module,id)],{type:'text/javascript'})),factoryUrl=URL.createObjectURL(new Blob([await bytes(factory,id)],{type:'text/javascript'})),wasmUrl=URL.createObjectURL(new Blob([await bytes(wasm,id)],{type:'application/wasm'}));
 ort=await import(/* webpackIgnore: true */ moduleUrl);ort.env.wasm.numThreads=cpuThreads();ort.env.wasm.wasmPaths={mjs:factoryUrl,wasm:wasmUrl};}
/**
 * The runtime bundle is the threaded build and the site is cross-origin isolated, so the CPU
 * route was running a multi-threaded binary pinned to one thread. Threads are bounded rather
 * than greedy: they add stacks and scheduling pressure on the small devices this path exists
 * for, and the gain flattens quickly. Correctness is not taken on trust — the route is admitted
 * only after the existing canaries match the fixed references, whatever the thread count.
 */
function cpuThreads(){
 if(typeof SharedArrayBuffer!=='function'||!globalThis.crossOriginIsolated)return 1;
 const cores=Number(globalThis.navigator?.hardwareConcurrency);
 if(!Number.isFinite(cores)||cores<2)return 1;
 return Math.max(1,Math.min(4,Math.floor(cores)-1));
}

async function encodeStream(tensor,id,qualifiedEncoderSha256){
 const started=performance.now();const descriptor=manifest.encoderStream,config=JSON.parse(new TextDecoder().decode(await bytes(descriptor,id)));
 if(config.sourceEncoderSha256!==descriptor.sourceEncoderSha256||config.sourceEncoderSha256!==manifest.encoder?.sha256||config.preprocessingSha256!==manifest.alignmentSha256||config.preprocessingSha256!==descriptor.preprocessingSha256||config.runtime?.unshared!==true||config.runtime.maxWasmBytes!==268435456)throw Error('Streamed encoder identity mismatch.');
 const urls=[];const verifiedModule=async asset=>{const url=URL.createObjectURL(new Blob([await bytes(asset,id)],{type:'text/javascript'}));urls.push(url);return url;};
 try{
  const apiUrl=await verifiedModule(config.runtime.module),factoryUrl=await verifiedModule(config.runtime.factory),wasmUrl=URL.createObjectURL(new Blob([await bytes(config.runtime.wasm,id)],{type:'application/wasm'}));urls.push(wasmUrl);
  const observerUrl=URL.createObjectURL(new Blob([`import factory from ${JSON.stringify(factoryUrl)};let ref;export default async function(config){const m=await factory(config);ref=new WeakRef(m);return m;}export function snapshot(){const buffer=ref?.deref()?.HEAPU8?.buffer;return {available:Boolean(buffer),shared:Object.prototype.toString.call(buffer)==='[object SharedArrayBuffer]',currentBytes:buffer?.byteLength};}`],{type:'text/javascript'}));urls.push(observerUrl);
  const observer=await import(/* webpackIgnore: true */ observerUrl),encoderOrt=await import(/* webpackIgnore: true */ apiUrl),executor=await import(/* webpackIgnore: true */ await verifiedModule(config.executor));encoderOrt.env.wasm.numThreads=1;encoderOrt.env.wasm.wasmPaths={mjs:observerUrl,wasm:wasmUrl};
  const execute=input=>executor.executeEncoderStream({ort:encoderOrt,manifest:config,tensor:input,acquireBytes:asset=>bytes(asset,id),snapshotMemory:observer.snapshot,onProgress:event=>report(id,event.stage,event)});
  const encoderQualification=qualifiedEncoderSha256===descriptor.sha256?{passed:true,manifestSha256:descriptor.sha256,reusedRuntimeAdmission:true}:await qualifyEncoderReference({config,manifestSha256:descriptor.sha256,execute,acquireBytes:asset=>bytes(asset,id),onProgress:event=>report(id,event.stage,event)});
  const result=await execute(tensor);result.encoderQualification=encoderQualification;
  requireLatent(result.values);const totals=result.encoderStats.steps.reduce((a,s)=>({acquireMs:a.acquireMs+s.acquireMs,createMs:a.createMs+s.createMs,runMs:a.runMs+s.runMs}),{acquireMs:0,createMs:0,runMs:0});report(id,'encoder-loaded',{elapsedMs:totals.createMs,scope:'Sum of108 sequential ORT session creations',acquisitionMs:totals.acquireMs});report(id,'encoding-complete',{elapsedMs:totals.runMs,scope:'Sum of108 session inference calls',totalWallMs:performance.now()-started});return result;
 }finally{for(const url of urls)URL.revokeObjectURL(url);}
}

async function load(id){if(synthesis||webgl||webgpu)return;cache ||= await createBrowserModelCache();noise={};for(const item of manifest.noise)noise[item.name]=await floats(item,id);
 report(id,'model-loading');const started=performance.now();
 if(provider==='webgpu'){if(!manifest.webgpu)throw Error('WebGPU bundle unavailable');webgpu=await createWebGpuSession({config:manifest.webgpu,noiseManifest:manifest.noise,bytes:asset=>bytes(asset,currentId),progress:stage=>report(currentId,stage)});}
 else if(provider==='webgl2'){
   if(!manifest.webgl)throw Error('WebGL bundle unavailable');
   // Persistent acquisition verifies every input before the frozen engine fetches it.
   // A scoped fetch adapter supplies verified responses without modifying its kernels.
   const known=new Map(manifest.webgl.assets.map(a=>[a.url,a]));const originalFetch=self.fetch.bind(self);
   self.fetch=async(input,options)=>{const url=typeof input==='string'?input:input.url;const asset=known.get(url);if(!asset)return originalFetch(input,options);const handle=await cache.acquire(asset,{signal:options?.signal});return handle.open();};
   const moduleUrl=URL.createObjectURL(new Blob([await bytes(manifest.webgl.module,id)],{type:'text/javascript'}));let mod;try{mod=await import(/* webpackIgnore: true */ moduleUrl);}finally{URL.revokeObjectURL(moduleUrl);}webgl=await mod.createHybridSession({assetBase:manifest.webgl.assetBase,variant:'pure',vectorizedInputs:true,drawBatchSize:16,checkpoint:async(stage,state)=>report(currentId,'gpu-stage',{name:stage,state})});
 }else{await ensureOrt(id);synthesis=await ort.InferenceSession.create(await bytes(manifest.synthesis,id),{executionProviders:['wasm']});}
 report(id,'model-loaded',{elapsedMs:performance.now()-started});
}
async function run(values,id,noiseMode='original'){await load(id);requireLatent(values);const selected={};for(const [name,data] of Object.entries(noise))selected[name]=noiseMode==='original'?data:noiseMode==='zero'?new Float32Array(data.length):Float32Array.from(data,x=>-x);report(id,'synthesis');const start=performance.now();if(webgl||webgpu){const raw=await (webgl||webgpu).infer(values,selected);report(id,'synthesis-complete',{elapsedMs:performance.now()-start});return raw;}const feeds={w:new ort.Tensor('float32',values,[1,18,512])};for(const item of manifest.noise)feeds[item.name]=new ort.Tensor('float32',selected[item.name],item.shape);let output;try{output=(await synthesis.run(feeds)).image;const raw=new Float32Array(await output.getData());report(id,'synthesis-complete',{elapsedMs:performance.now()-start});return raw;}finally{for(const t of Object.values(feeds))t.dispose();output?.dispose();}}

async function png(raw){return encodeRgbaPng(rgba1024(raw));}
async function mappingFor(z,id){await load(id);await ensureOrt(id);if(!mapping){report(id,'mapping-loading');mapping=await ort.InferenceSession.create(await bytes(manifest.mapping,id),{executionProviders:['wasm']});average=await floats(manifest.average,id);}report(id,'mapping');const input=new ort.Tensor('float32',z,[1,512]);let out;try{out=(await mapping.run({z:input})).w;return truncate(await out.getData(),average);}finally{input.dispose();out?.dispose();}}
async function qualify(id){const checks=[];for(const c of manifest.canaries){report(id,'canary',{name:c.name,loaded:checks.length,total:manifest.canaries.length});const raw=await run(await floats(c.w,id),id,c.noise),indices=new Uint32Array((await bytes(manifest.sampleIndices,id)).buffer),samples=await floats(c.samples,id),decoded=await decodeReferencePng(await bytes(c.reference,id));const expected=decoded.rgba,actual=rgba1024(raw);let maxRgb=0,maxFloat=0;for(let i=0;i<actual.length;i++)if(i%4!==3)maxRgb=Math.max(maxRgb,Math.abs(actual[i]-expected[i]));for(let i=0;i<indices.length;i++)maxFloat=Math.max(maxFloat,Math.abs(raw[indices[i]]-samples[i]));const check={name:c.name,maxRgb,maxFloat,passed:Number.isFinite(maxFloat)&&maxRgb<=1&&maxFloat<=.002};checks.push(check);if(!check.passed)throw Error(`Device correctness check failed: ${c.name}`);}return {checks,provider,deviceValidated:true,releaseQualified:manifest.releaseQualified===true};}
self.onmessage=async({data:{id,type,...request}})=>{currentId=id;try{let result;if(type==='initialize'){manifest=request.manifest;provider=request.provider;result={provider};}else if(type==='qualify')result=await qualify(id);else if(type==='generate'){const input=await inputLatent(request.mode,request.value),values=await mappingFor(input.values,id);result={blob:await png(await run(values,id)),values,shape:[1,18,512],space:'w-plus',identity:input.identity};}else if(type==='synthesize'){const values=requireLatent(request.values);result={blob:await png(await run(values,id)),values,shape:[1,18,512],space:'w-plus'};}else if(type==='encode-aligned'){
 // Sequential residency: e4e is released before loading synthesis.
 if(!manifest.encoder&&!manifest.encoderStream)throw Error('The browser encoder bundle is not available.');
 await synthesis?.release();synthesis=null;await webgl?.dispose();webgl=null;await webgpu?.dispose();webgpu=null;await mapping?.release();mapping=null;noise=null;
 cache ||= await createBrowserModelCache();
 if(!(request.tensor instanceof Float32Array)||request.tensor.length!==196608||!request.tensor.every(Number.isFinite))throw Error('Invalid aligned photo tensor');
 if(manifest.encoderStream){result=await encodeStream(request.tensor,id,request.qualifiedEncoderSha256);}else{await ensureOrt(id);report(id,'encoder-loading');let encoder,input,out,values;try{encoder=await ort.InferenceSession.create(await bytes(manifest.encoder,id),{executionProviders:['wasm']});input=new ort.Tensor('float32',request.tensor,[1,3,256,256]);report(id,'encoding');out=(await encoder.run({image:input})).w;values=requireLatent(new Float32Array(await out.getData()));}finally{out?.dispose();input?.dispose();await encoder?.release();}result={values,shape:[1,18,512],space:'w-plus',encoderProvider:'wasm'};}
 }else throw Error('Unknown runtime operation');postMessage({id,type:'complete',result});}catch(error){postMessage({id,type:'error',error:{name:error.name,message:error.message}});}};
