import {createWebGpuSession} from './webgpu-engine.mjs';
import {encodeRgbaPng} from './png.mjs';
import {createBrowserModelCache} from '../Assets/model-cache.mjs';
import {inputLatent,truncate,requireLatent,rgba1024} from './identity.mjs';
import {qualifyEncoderReference} from './encoder-preflight.mjs';
import {createAcquisitionBudget,collectAssets} from './acquisition-budget.mjs';
import {createCanaryQualification} from './canary-qualification.mjs';
let manifest,ort,cache,mapping,synthesis,noise,average,provider,webgl,webgpu,currentId,manifestSha256,qualification,resumeDrain=null;
/**
 * What the encoder leaves behind between photos.
 *
 * Encoding three photos in a row is the ordinary case, and each one used to pay the whole price
 * again: the monolithic path released its session in a `finally`, and the streamed path revoked
 * its runtime URLs and re-imported and recompiled ORT's wasm before touching the first shard.
 * On the e4e path moving weights is 79% of the run, so paying it per photo is most of the wait.
 *
 * Who decides is the host, per request, because it is the half that knows whether it is about to
 * terminate this worker. Told to discard — every phone, and anything that does not state a memory
 * budget — the behaviour is exactly as before: one live model at a time, released before the next
 * is acquired. Told to hold, the encoder stays through synthesis as well, so the peak really is
 * higher: the encoder and the route are both resident. That is the trade, and it is only offered
 * to a device that has said it has the room.
 */
let encoder=null,encoderStream=null;
async function releaseEncoder(){
 shedShards();
 if(encoder){const session=encoder;encoder=null;await session.release().catch(()=>{});}
 if(encoderStream){const held=encoderStream;encoderStream=null;for(const url of held.urls)URL.revokeObjectURL(url);}
}
const report=(id,stage,extra={})=>postMessage({id,type:'progress',stage,...extra});
/**
 * Acquisition accounting. The inference worker used to build its cache with no observer, so the
 * only progress it could report was {loaded:0} and then {loaded:size} per asset: the bar sat at
 * zero through a 118 MB download, jumped to full, and reset for the next file. The cache emits
 * byte-level status; this wires it through and spends it against one budget for the whole set a
 * route needs, so the bar crosses the download once instead of restarting at every asset.
 */

const budget=createAcquisitionBudget();
budget.attach(({loaded,total,fetched,fetchedTotal},progressOnly)=>report(currentId,'asset-acquisition',{loaded,total,fetched,fetchedTotal,progressOnly}));
// The budget only cares about bytes, so every way the cache can fail was dropped here and never
// reached a report. Three photos in a row re-downloaded the 1019 MiB encoder and the 212 MiB
// models three times, and four rounds of reports could not say whether that was a quota refusal,
// an immediate eviction, or a corrupt entry being repaired — because none of those statuses were
// forwarded. They are now, once per status per asset, so the next run names the cause.
const CACHE_TROUBLE=new Set(['quota-exceeded','save-failed','storage-unavailable',
 'missing-after-acquire','repairing','corrupt-removed']);
const troubleSeen=new Set();
const cacheReport=event=>{
 if(CACHE_TROUBLE.has(event.status)){
  const key=event.status+':'+event.sha256;
  if(!troubleSeen.has(key)){troubleSeen.add(key);
   report(currentId,'cache-trouble',{cacheStatus:event.status,bytes:event.bytes});}
 }
 budget.cacheEvent(event);
};
const planAsset=budget.planAsset;
/** Everything the chosen route will ask for before it can produce a face. */
function planRoute(){
 if(!manifest)return;
 planAsset([manifest.runtime,manifest.mapping,manifest.average,manifest.noise]);
 if(provider==='webgpu')planAsset(manifest.webgpu);
 else if(provider==='webgl2')planAsset(manifest.webgl);
 else planAsset(manifest.synthesis);
 // Canary references are only fetched while this device still owes correctness checks; a bundle
 // with a recorded qualification never downloads them (C-03).
 if(!qualification||!qualification.complete())planAsset([manifest.sampleIndices,manifest.canaries]);
}
/**
 * The same set planRoute budgets for, as an ordered list, route models first.
 *
 * Nothing about a 150 MB model segment depends on which face is asked for, so the prefetch lane
 * acquires this list before the first request rather than after it. The route bundle leads
 * because it is the long pole and the only thing a face cannot begin without.
 */
function routeAssets(){
 if(!manifest)return [];
 const bundle=provider==='webgpu'?manifest.webgpu:provider==='webgl2'?manifest.webgl:manifest.synthesis;
 const rest=[[manifest.runtime,manifest.mapping,manifest.average,manifest.noise]];
 if(!qualification||!qualification.complete())rest.push([manifest.sampleIndices,manifest.canaries]);
 const seen=new Set(),ordered=[];
 for(const asset of [...collectAssets(bundle),...rest.flatMap(item=>collectAssets(item))])
  if(!seen.has(asset.sha256)){seen.add(asset.sha256);ordered.push(asset);}
 return ordered;
}
/**
 * Everything a photo needs, in the order it is needed: the face detector, the photo runtime, then
 * the encoder's 108 shards. The shard list is not in the top-level manifest — it lives inside the
 * encoder-stream descriptor — so the descriptor is acquired first and its schedule read.
 *
 * This is ~1.1 GiB, the largest thing the product will ever ask a device for, and none of it
 * depends on which photo is chosen. Reaching for a photo is the earliest honest signal that it
 * will be wanted (AGENTS.md, Performance Philosophy).
 */
async function photoAssets(){
 if(!manifest)return [];
 const ordered=[],seen=new Set();
 const add=value=>{for(const asset of collectAssets(value))if(!seen.has(asset.sha256)){seen.add(asset.sha256);ordered.push(asset);}};
 add([manifest.landmarks,manifest.photoCanary,manifest.photoCanaries]);
 const descriptor=manifest.encoderStream;
 if(descriptor){
  add(descriptor);
  try{add(JSON.parse(new TextDecoder().decode(await bytes(descriptor,currentId))));}
  catch{/* the descriptor is unreadable offline; the real run will report it properly */}
 }
 return ordered;
}
/**
 * Holding encoder shards in memory between photos.
 *
 * Measured, five photos in a row in a desktop browser — photo-runtime/evidence/
 * desktop-browser-five-photos.json: acquisition 19.1 s for the first photo and then 15.7, 15.7,
 * 16.7 and 15.5 s; 108 session creations 0.75 s; inference 4.3 s. Acquisition is 78% of every
 * encode and it does not get cheaper on the second photo, because the same gigabyte is read back
 * out of Cache Storage for each one. Sequential acquisition is what keeps a phone inside its
 * envelope on the first photo; paying it again on the second buys nothing.
 *
 * Partial retention buys nothing either: the schedule walks the 108 shards in order, so anything
 * evicted before the next photo is simply read again. It is all or none, and "all" is about a
 * gigabyte — so it is refused unless the device has stated it can take that with room to spare.
 * `navigator.deviceMemory` is the only budget signal the platform offers and it is undefined on
 * iOS, which is exactly the tier the sequential schedule exists for; undefined means off.
 *
 * Held bytes are given back at every point they could become a liability: when synthesis needs
 * the memory, when a job fails, and after three minutes with no encode — a tab left open is not
 * a tab that should be sitting on a gigabyte.
 */
const RESIDENT_IDLE_MS=180000;
const residency={mode:'off',bytes:new Map(),held:0,budget:0,timer:null};
// The host decides, per request, because it is the half that knows whether it is about to throw
// this worker away: retaining bytes in a thread that is terminated a second later buys nothing
// and two rules that could disagree would be worse than one.
function residencyBudget(){return residency.mode==='on'?Infinity:0;}
function shedShards(){
 if(residency.timer){clearTimeout(residency.timer);residency.timer=null;}
 if(!residency.held)return;
 const freed=residency.held;
 residency.bytes.clear();residency.held=0;
 report(currentId,'cache-trouble',{cacheStatus:'storage-unavailable',bytes:freed,scope:'Released retained encoder shards'});
}
function touchResidency(){
 if(residency.timer)clearTimeout(residency.timer);
 residency.timer=residency.held?setTimeout(shedShards,RESIDENT_IDLE_MS):null;
}
async function bytes(asset,id,retainable=false){
 if(retainable){
  const held=residency.bytes.get(asset.sha256);
  // A detached buffer reads as zero length: never hand back something ORT may have taken.
  if(held&&held.byteLength===asset.size){
   budget.cacheEvent({status:'retained',sha256:asset.sha256,bytes:asset.size});budget.progress(false);
   touchResidency();return held;
  }
  if(held)residency.held-=held.byteLength,residency.bytes.delete(asset.sha256);
 }
 cache ||= await createBrowserModelCache({report:cacheReport});
 planAsset(asset);budget.progress(false);
 const handle=await cache.acquire(asset);const data=await(await handle.open()).arrayBuffer();
 budget.cacheEvent({status:'saved',sha256:asset.sha256,bytes:asset.size});
 budget.progress(false);
 const out=new Uint8Array(data);
 if(retainable){
  residency.budget=residencyBudget();
  if(residency.held+out.byteLength<=residency.budget){
   residency.bytes.set(asset.sha256,out);residency.held+=out.byteLength;touchResidency();
  }
 }
 return out;}

async function floats(asset,id){const b=await bytes(asset,id);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);}
/**
 * Warm the device's model cache for the route this device would choose, before anything is asked
 * of it. Bytes are committed through `acquire` alone and never materialised as an ArrayBuffer —
 * the point is a populated cache, not a loaded model, and a 150 MB segment must not sit in the
 * heap of a worker that may be terminated a moment later.
 *
 * This is best effort by construction: it creates no session, runs no canary, and decides no
 * route. A failure here is swallowed, because the real run must be the one that reports an
 * acquisition problem in the user's words and drops the route on the evidence.
 */
async function inventory(scope){
 cache ||= await createBrowserModelCache({report:cacheReport});
 let list,estimated=false;
 if(scope==='photo'){
  const descriptor=manifest.encoderStream;
  if(descriptor&&!(await cache.has(descriptor.sha256))){
   list=collectAssets([manifest.landmarks,manifest.photoCanary,manifest.photoCanaries,descriptor]);
   const total=list.reduce((sum,asset)=>sum+asset.size,0)+(manifest.encoder?.size||0);
   return {scope,provider,present:0,total,ready:false,estimated:true};
  }
  list=await photoAssets();
 }else list=routeAssets();
 let present=0,total=0;
 for(const asset of list){total+=asset.size;if(await cache.has(asset.sha256))present+=asset.size;}
 return {scope,provider,present,total,ready:list.length>0&&present===total,estimated};
}
async function prefetchRoute(id,scope='route'){
 cache ||= await createBrowserModelCache({report:cacheReport});
 const list=scope==='photo'?await photoAssets():routeAssets();
 if(scope==='photo')planAsset(list);else planRoute();
 budget.progress(false);
 let assets=0,acquired=0;
 for(const asset of list){
  assets++;
  try{await cache.acquire(asset);acquired++;budget.progress(false);}
  catch{break;} // offline, evicted mid-run, or out of quota: the real run will say so properly
 }
 return {provider,scope,assets,acquired,...budget.totals()};
}
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
// The encoder stays single-threaded on purpose. Giving it two threads was measured on this
// machine and moved photo timing from 87.6 to 87.1 seconds, which is noise: the cost there is
// not ORT inference. Threads would add memory pressure on the devices this path serves for no
// gain anyone can observe.
function cpuThreads(){
 if(typeof SharedArrayBuffer!=='function'||!globalThis.crossOriginIsolated)return 1;
 const cores=Number(globalThis.navigator?.hardwareConcurrency);
 if(!Number.isFinite(cores)||cores<2)return 1;
 return Math.max(1,Math.min(4,Math.floor(cores)-1));
}

async function encodeStream(tensor,id,qualifiedEncoderSha256){
 const started=performance.now();const descriptor=manifest.encoderStream,config=JSON.parse(new TextDecoder().decode(await bytes(descriptor,id)));
 planAsset(config); // 108 shards, known the moment the descriptor is verified: budget for all of them.
 if(config.sourceEncoderSha256!==descriptor.sourceEncoderSha256||config.sourceEncoderSha256!==manifest.encoder?.sha256||config.preprocessingSha256!==manifest.alignmentSha256||config.preprocessingSha256!==descriptor.preprocessingSha256||config.runtime?.unshared!==true||config.runtime.maxWasmBytes!==268435456)throw Error('Streamed encoder identity mismatch.');
 // The runtime is the small half: three modules and a wasm binary, none of which are weights.
 // Holding them across photos skips a re-import and a wasm recompile per encode; the 108 shards
 // are still acquired and released one at a time, which is what keeps the working set bounded.
 if(encoderStream&&encoderStream.sha256!==descriptor.sha256)await releaseEncoder();
 const urls=encoderStream?encoderStream.urls:[];const verifiedModule=async asset=>{const url=URL.createObjectURL(new Blob([await bytes(asset,id)],{type:'text/javascript'}));urls.push(url);return url;};
 {
  if(!encoderStream){
   const apiUrl=await verifiedModule(config.runtime.module),factoryUrl=await verifiedModule(config.runtime.factory),wasmUrl=URL.createObjectURL(new Blob([await bytes(config.runtime.wasm,id)],{type:'application/wasm'}));urls.push(wasmUrl);
   const observerUrl=URL.createObjectURL(new Blob([`import factory from ${JSON.stringify(factoryUrl)};let ref;export default async function(config){const m=await factory(config);ref=new WeakRef(m);return m;}export function snapshot(){const buffer=ref?.deref()?.HEAPU8?.buffer;return {available:Boolean(buffer),shared:Object.prototype.toString.call(buffer)==='[object SharedArrayBuffer]',currentBytes:buffer?.byteLength};}`],{type:'text/javascript'}));urls.push(observerUrl);
   const observer=await import(/* webpackIgnore: true */ observerUrl),encoderOrt=await import(/* webpackIgnore: true */ apiUrl),executor=await import(/* webpackIgnore: true */ await verifiedModule(config.executor));encoderOrt.env.wasm.numThreads=1;encoderOrt.env.wasm.wasmPaths={mjs:observerUrl,wasm:wasmUrl};
   encoderStream={sha256:descriptor.sha256,urls,observer,encoderOrt,executor};
  }
  const {observer,encoderOrt,executor}=encoderStream;
  const execute=input=>executor.executeEncoderStream({ort:encoderOrt,manifest:config,tensor:input,acquireBytes:asset=>bytes(asset,id,true),snapshotMemory:observer.snapshot,onProgress:event=>report(id,event.stage,event)});
  // Operator direction, 21 September: the product does not pay for expensive correctness passes.
  // This one ran the whole 108-shard schedule against a pinned reference before touching a photo
  // and cost 20,920 ms on the operator's Samsung against 7,395 ms for the real encode — the guard
  // was 2.8x the work it guarded. The standing instruction is to assume an encoder that has been
  // seen working on a device anywhere works everywhere, and to keep the verification in the labs.
  //
  // What this gives up, stated plainly: a device whose arithmetic is wrong here will now produce a
  // wrong face from a photo instead of an error. `fullQualify` — set by the device lab and by CI —
  // still runs the pass, so the check continues to exist where it is affordable.
  const encoderQualification=
   fullQualify?await qualifyEncoderReference({config,manifestSha256:descriptor.sha256,execute,acquireBytes:asset=>bytes(asset,id),onProgress:event=>report(id,event.stage,event)})
   :qualifiedEncoderSha256===descriptor.sha256?{passed:true,manifestSha256:descriptor.sha256,reusedRuntimeAdmission:true}
   :{passed:true,manifestSha256:descriptor.sha256,verifiedOnThisDevice:false,scope:'Encoder correctness is verified in the device lab, not per device (operator direction, 21 September)'};
  const result=await execute(tensor);result.encoderQualification=encoderQualification;
  requireLatent(result.values);const totals=result.encoderStats.steps.reduce((a,s)=>({acquireMs:a.acquireMs+s.acquireMs,createMs:a.createMs+s.createMs,runMs:a.runMs+s.runMs}),{acquireMs:0,createMs:0,runMs:0});report(id,'encoder-loaded',{elapsedMs:totals.createMs,scope:'Sum of108 sequential ORT session creations',acquisitionMs:totals.acquireMs});report(id,'encoding-complete',{elapsedMs:totals.runMs,scope:'Sum of108 session inference calls',totalWallMs:performance.now()-started});return result;
 }
}

async function load(id){if(synthesis||webgl||webgpu)return;
 // Release before acquire, at the acquire rather than at the end of the job that used it: until
 // something else needs the memory, a second photo gets to use what the first one brought in.
 //
 // Unless the host said to hold it. The flow is encode, face, encode, face, so shedding here
 // would hand the gigabyte back between every photo and the next one would read it all again —
 // which is the cost the holding exists to avoid. A device is only told to hold when it has the
 // room for both.
 if(residency.mode!=='on')await releaseEncoder();
 cache ||= await createBrowserModelCache({report:cacheReport});planRoute();noise={};for(const item of manifest.noise)noise[item.name]=await floats(item,id);
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

// CI and release qualification must always see every canary. The flags arrive on 'initialize'
// from the main thread: a dedicated worker's globalThis is its own scope, so neither the page's
// __FACEMORPH_FULL_QUALIFY__ nor navigator.webdriver is visible here. The host that owns the
// page decides; the worker only honours what it was told. Every other device pays for canaries
// once per bundle (C-03).
let fullQualify=false,forceCanaryFail=false;
async function ensureQualification(id){
 if(qualification)return qualification;
 cache ||= await createBrowserModelCache({report:cacheReport});
 qualification=createCanaryQualification({manifest,manifestSha256,provider,bundle:provider==='webgpu'?manifest.webgpu:provider==='webgl2'?manifest.webgl:manifest.synthesis,records:cache.records,acquireBytes:asset=>bytes(asset,id),runSynthesis:(values,noiseMode)=>run(values,id,noiseMode),full:fullQualify,forceFail:forceCanaryFail});
 await qualification.adopt();
 return qualification;
}
const qualifyResult=(q,extra={})=>({checks:q.checks(),provider,deviceValidated:true,releaseQualified:manifest.releaseQualified===true,...extra});
async function qualify(id){
 const q=await ensureQualification(id);
 if(fullQualify){while(!q.complete())await q.runNext(ev=>report(id,'canary',ev));return qualifyResult(q);}
 if(q.complete())return qualifyResult(q,{cached:q.checks().length>0});
 await q.runNext(ev=>report(id,'canary',ev)); // one canary gates admission; the first face comes before the rest
 return q.complete()?qualifyResult(q):qualifyResult(q,{partial:true});
}
// One inference pipeline serves user operations and background qualification. User operations
// always go first; a background canary runs only while nothing else is queued, so a user
// operation waits out at most the single canary already in flight.
const foreground=[];let backgroundTask=null,pumping=false;
function pump(){
 if(pumping)return;pumping=true;
 (async()=>{
  for(;;){
   const unit=foreground.shift()??backgroundTask;
   if(!unit)break;
   if(unit===backgroundTask)backgroundTask=null;
   try{await unit();}catch{/* handlers report their own failures */}
  }
 })().finally(()=>{pumping=false;});
}
// The runtime sends 'resume' once the first face is delivered. The remaining canaries then run
// here one at a time, preempted by any user operation. A canary that fails now invalidates the
// route loudly: the task reports the error and the runtime drops the route and says so (C-03).
function startResumeDrain(id){
 if(resumeDrain!=null){postMessage({id,type:'complete',result:{checks:[],provider,deviceValidated:false,resumed:true}});return;}
 resumeDrain=id;
 const step=()=>{backgroundTask=async()=>{
  try{
   const q=await ensureQualification(id);
   if(!q.complete())await q.runNext(ev=>report(id,'canary',ev));
   if(!q.complete()){step();return;}
   resumeDrain=null;
   postMessage({id,type:'complete',result:{checks:q.checks(),provider,deviceValidated:true,resumed:true}});
  }catch(error){resumeDrain=null;postMessage({id,type:'error',error:{name:error.name,message:error.message,correctnessFailure:/Device correctness check failed|integrity/i.test(error.message||'')}});}
 };pump();};
 step();
}
self.onmessage=({data})=>{
 const {id,type,...request}=data;currentId=id;
 if(type==='qualify'&&request.resume){startResumeDrain(id);return;}
 foreground.push(async()=>{
  try{
   let result;
   if(type==='initialize'){manifest=request.manifest;provider=request.provider;manifestSha256=request.manifestSha256;fullQualify=request.fullQualify===true||(!request.hostForcedQualify&&request.webdriver===true);forceCanaryFail=request.forceCanaryFail===true;result={provider};}
   else if(type==='qualify')result=await qualify(id);else if(type==='prefetch')result=await prefetchRoute(id,request.scope);else if(type==='inventory')result=await inventory(request.scope);else if(type==='generate'){const input=await inputLatent(request.mode,request.value),values=await mappingFor(input.values,id);result={blob:await png(await run(values,id)),values,shape:[1,18,512],space:'w-plus',identity:input.identity};}else if(type==='synthesize'){const values=requireLatent(request.values);result={blob:await png(await run(values,id)),values,shape:[1,18,512],space:'w-plus'};}else if(type==='encode-aligned'){
 // Sequential residency: e4e is released before loading synthesis.
 if(!manifest.encoder&&!manifest.encoderStream)throw Error('The browser encoder bundle is not available.');
 residency.mode=request.retain===true?'on':'off';
 if(residency.mode==='off')shedShards();
 // Sequential residency, unchanged in its peak: synthesis goes before the encoder is acquired.
 await synthesis?.release();synthesis=null;await webgl?.dispose();webgl=null;await webgpu?.dispose();webgpu=null;await mapping?.release();mapping=null;noise=null;
 cache ||= await createBrowserModelCache({report:cacheReport});
 // The encoder is the largest thing this device will fetch. Budget for it before the first
 // byte arrives, so the bar measures the wait the user is actually in for.
 planAsset(manifest.encoderStream||manifest.encoder);
 if(!(request.tensor instanceof Float32Array)||request.tensor.length!==196608||!request.tensor.every(Number.isFinite))throw Error('Invalid aligned photo tensor');
 if(manifest.encoderStream){result=await encodeStream(request.tensor,id,request.qualifiedEncoderSha256);}else{await ensureOrt(id);let input,out,values;try{if(!encoder){report(id,'encoder-loading');const created=performance.now();encoder=await ort.InferenceSession.create(await bytes(manifest.encoder,id),{executionProviders:['wasm']});report(id,'encoder-loaded',{elapsedMs:Math.round(performance.now()-created)});}input=new ort.Tensor('float32',request.tensor,[1,3,256,256]);report(id,'encoding');const started=performance.now();out=(await encoder.run({image:input})).w;values=requireLatent(new Float32Array(await out.getData()));report(id,'encoding-complete',{elapsedMs:Math.round(performance.now()-started)});}finally{out?.dispose();input?.dispose();}result={values,shape:[1,18,512],space:'w-plus',encoderProvider:'wasm'};}
 }else throw Error('Unknown runtime operation');postMessage({id,type:'complete',result});}catch(error){postMessage({id,type:'error',error:{name:error.name,message:error.message}});}});
 pump();
};
