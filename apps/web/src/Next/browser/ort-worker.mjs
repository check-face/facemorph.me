// Mapping, synthesis, the canaries and the ORT runtime are the stylegan-js engine's (fm-7f2o): this worker keeps the
// acquisition, residency, encoder and message protocol, and hands the engine a reader over its verified bytes.
import {loadCpuGenerator,loadOrtRuntime,cpuRuntimeAssets,browserModuleHost,createCanaryQualification,loadStreamedEncoder,loadEncoderRuntime,engineGeometry} from 'stylegan-js/engine';
import {FFHQ_1024_DESCRIPTOR} from 'stylegan-js';
// The model's dimensions (fm-dmlz): the side, the W+ shape and the pixel bytes come from the descriptor of the
// model this app ships (FFHQ), never from literal 1024 / 18 x 512.
const GEOMETRY=engineGeometry(FFHQ_1024_DESCRIPTOR),SIDE=GEOMETRY.width,BATCH_W_SHAPE=[1,GEOMETRY.latent.layers,GEOMETRY.latent.width];
import {encodeRgbaPng} from './png.mjs';
import {createModelSource} from './model-source.mjs';
import {inputLatent,requireLatent} from './identity.mjs';
import {qualifyEncoderReference} from './encoder-preflight.mjs';
import {createAcquisitionBudget,collectAssets} from './acquisition-budget.mjs';
import {chooseGrant,mergeGrants,widenWithin,BRIDGE_OWNER} from './bridge-grant.mjs';
import {GrantRefused} from '../../../../../packages/browser-model-manager/src/acquisition/grants.ts';
import {createExecutionGate} from './execution-gate.mjs';
import {modelAlternateOrigins} from '../../contracts/model-origins.ts';
// Chunks of a model download in flight at once (16 MiB each). Eight gigabytes stated by the device earns four;
// everything else, including iOS where deviceMemory is undefined, gets two, a 32 MiB window.
const readAhead=(globalThis.navigator?.deviceMemory||0)>=8?4:2;
let gpuEngine='ort',manifest,ort,cache,generator=null,provider,currentId,manifestSha256,qualification,resumeDrain=null;
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
let encoderStream=null;
async function releaseEncoder(){
 shedShards();
 if(encoderStream){const held=encoderStream;encoderStream=null;held.release();}
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
const modelSource=()=>createModelSource({report:cacheReport,readAhead,alternateOrigins:modelAlternateOrigins(self.location.hostname)},
 ()=>{shedShards();report(currentId,'cache-unavailable-detail');});
const planAsset=budget.planAsset;
// Settle the denominator before bytes move: what is already on this device is not a download.
const probePlanned=()=>budget.probe(asset=>cache.has(asset));
/** Everything the chosen route will ask for before it can produce a face. */
// The WebGPU route's model bundle: the direct engine reads the block-stream coefficients (manifest.webgl),
// the ORT engine its split graph (manifest.webgpu).
const gpuBundle=()=>gpuEngine==='direct'?manifest.webgl:manifest.webgpu;
// The WebGPU loaders (WGSL engine, ORT WebGPU glue) arrive only when a WebGPU route loads; CPU workers never fetch them (fm-s0vi).
const webgpuLoaders=()=>import('stylegan-js/engine/webgpu');
function planRoute(){
 if(!manifest)return;
 planAsset([manifest.runtime,manifest.mapping,manifest.average,manifest.noise]);
 if(provider==='webgpu')planAsset(gpuBundle());
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
 const bundle=provider==='webgpu'?gpuBundle():manifest.synthesis;
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
  try{add(admitDescriptor(JSON.parse(new TextDecoder().decode(await bytes(descriptor,currentId,false,{allowUncached:false})))));}
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
let executionGate=null,computeSequence=0;
const computeReplies=new Map();
function computeRequest(id,phase){
 const token=`${id}:${++computeSequence}`;
 return new Promise((resolve,reject)=>{computeReplies.set(token,{resolve,reject});postMessage({id,type:'compute-request',token,phase});});
}
function taskGate(id,admitted){return createExecutionGate(admitted?{acquire:()=>computeRequest(id,'acquire'),release:()=>computeRequest(id,'release')}:{});}
async function gatedTask(id,admitted,run){
 const gate=taskGate(id,admitted);executionGate=gate;currentId=id;
 try{const result=await run();await gate.drain();return result;}finally{gate.close();executionGate=null;}
}
const compute=work=>executionGate?executionGate.compute(work):Promise.resolve().then(work);
const read=work=>executionGate?executionGate.read(work):Promise.resolve().then(work);
const bytes=(...args)=>read(()=>readBytes(...args));
const acquireAsset=asset=>read(()=>cache.acquire(asset,acquireOptions(asset)));
async function readBytes(asset,id,retainable=false,{allowUncached=true}={}){
 if(retainable){
  const held=residency.bytes.get(asset.sha256);
  // A detached buffer reads as zero length: never hand back something ORT may have taken.
  if(held&&held.byteLength===asset.size){
   budget.cacheEvent({status:'retained',sha256:asset.sha256,bytes:asset.size});budget.progress(false);
   touchResidency();return held;
  }
  if(held)residency.held-=held.byteLength,residency.bytes.delete(asset.sha256);
 }
 cache ||= await modelSource();
 planAsset(asset);await probePlanned();budget.progress(false);
 const out=await cache.bytes(asset,acquireOptions(asset),{allowUncached});
 budget.cacheEvent({status:'verified',sha256:asset.sha256,bytes:asset.size});
 budget.progress(false);
 if(retainable&&!cache.uncached){
  residency.budget=residencyBudget();
  if(residency.held+out.byteLength<=residency.budget){
   residency.bytes.set(asset.sha256,out);residency.held+=out.byteLength;touchResidency();
  }
 }
 return out;}

// The grants the app supplies (bridge-grant.mjs appGrants, fm-qrfz): what the person approved, and what is already
// verified on this device. An asset in neither has no grant, so the manager refuses it before any request.
let grants=null;
function acquireOptions(asset){return {grant:chooseGrant(grants,asset)??undefined,owner:BRIDGE_OWNER,signal:executionGate?.signal};}
// The streamed encoder's descriptor (pinned by the manifest's digest, read verified) names its shards: they are
// admitted against the bytes approved for it, never beyond (bridge-grant.mjs widenWithin).
function admitDescriptor(config){
 if(grants?.approved)grants={...grants,approved:widenWithin(grants.approved,manifest.encoderStream?.sha256,config)};
 // Learn the complete cost before fetching any shard. A partially admitted schedule cannot finish encoding.
 for(const asset of collectAssets(config))if(!chooseGrant(grants,asset))throw new GrantRefused('revision-required',asset.sha256);
 return config;
}
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
async function prefetchRoute(id,scope='route'){
 cache ||= await modelSource();
 if(cache.uncached)return {provider,scope,assets:0,acquired:0,...budget.totals()};
 const list=scope==='photo'?await photoAssets():routeAssets();
 if(cache.uncached)return {provider,scope,assets:0,acquired:0,...budget.totals()};
 if(scope==='photo')planAsset(list);else planRoute();
 await probePlanned();budget.progress(false);
 let assets=0,acquired=0;
 for(const asset of list){
  assets++;
  try{await acquireAsset(asset);acquired++;budget.progress(false);}
  catch{break;} // offline, evicted mid-run, or out of quota: the real run will say so properly
 }
 return {provider,scope,assets,acquired,...budget.totals()};
}
// The engine reads only through this: the worker's verified bytes (acquired under the bridge's grant), errors as thrown.
const reader={allowRepair:false,compute,read:async asset=>({ok:true,value:await bytes(asset,currentId)})};
// Import exactly the verified runtime bytes, avoiding a second unchecked network request (package loadOrtRuntime).
async function ensureOrt(id){if(ort)return;report(id,'runtime-loading');ort=(await loadOrtRuntime(reader,cpuRuntimeAssets(manifest.runtime),browserModuleHost(),cpuThreads())).ort;}
const cpuOrt=async()=>{await ensureOrt(currentId);return ort;};
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

const sha256Hex=async values=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(values.buffer,values.byteOffset,values.byteLength))),x=>x.toString(16).padStart(2,'0')).join('');
async function encodeStream(tensor,id,qualifiedEncoderSha256,confirmedCropId){
 const started=performance.now();const descriptor=manifest.encoderStream,config=admitDescriptor(JSON.parse(new TextDecoder().decode(await bytes(descriptor,id))));
 planAsset(config);await probePlanned(); // 108 shards, known the moment the descriptor is verified: budget for all of them.
 if(config.sourceEncoderSha256!==descriptor.sourceEncoderSha256||config.sourceEncoderSha256!==manifest.encoder?.sha256||config.preprocessingSha256!==manifest.alignmentSha256||config.preprocessingSha256!==descriptor.preprocessingSha256||config.runtime?.unshared!==true||config.runtime.maxWasmBytes!==268435456)throw Error('Streamed encoder identity mismatch.');
 // fm-dmlz: acquisition and verification of the encoder's shards finish before the encode starts. Each shard is
 // committed to the device's model cache here (acquire alone, nothing materialised), so the package encoder then
 // reads every step from verified local storage and the encode itself issues no request. A device without durable
 // model storage keeps the candidate's bounded behaviour: each shard is read as its step needs it.
 cache ||= await modelSource();
 if(!cache.uncached)for(const step of config.steps){await acquireAsset(step);budget.progress(false);}
 const local=asset=>cache.uncached?bytes(asset,id,true):cache.has(asset).then(held=>{if(!held)throw Object.assign(Error('An encoder shard left the model cache after it was acquired.'),{code:'cache-miss'});return bytes(asset,id,true);});
 const reader={allowRepair:false,compute,read:asset=>local(asset).then(value=>({ok:true,value}),error=>{if(error?.name==='GrantRefused')throw error;return {ok:false,error:{code:error.code||'local-read',message:String(error.message||error),sha256:asset.sha256}};})};
 // The runtime is the small half: three modules and a wasm binary, none of which are weights.
 // Holding them across photos skips a re-import and a wasm recompile per encode; the 108 shards
 // are still read and released one at a time (package loadStreamedEncoder), which keeps the working set bounded.
 if(encoderStream&&encoderStream.sha256!==descriptor.sha256)await releaseEncoder();
 if(!encoderStream){
  const runtime=await loadEncoderRuntime({allowRepair:false,compute,read:asset=>bytes(asset,id).then(value=>({ok:true,value}))},config.runtime,browserModuleHost());
  encoderStream={sha256:descriptor.sha256,runtime,release:runtime.release};
 }
 const {runtime}=encoderStream;
 const execute=async(input,cropId)=>{
  const encoder=loadStreamedEncoder({manifest:config,reader,ort:runtime.ort,snapshotMemory:runtime.snapshotMemory,model:FFHQ_1024_DESCRIPTOR});let runs=0;
  try{
   const tensorDigest=await sha256Hex(input);
   // The encoder's input contract is crop-preprocessing-v1's tensor (NCHW, 256 x 256, float32 (x/255-0.5)/0.5),
   // which a detector-aligned photo shares; its record id is the confirmed crop's, or the aligned tensor's digest.
   const out=await encoder.encode({ids:{requestId:String(id),inputRevision:0,attemptId:0},input:{tensor:input,tensorDigest,policyVersion:'crop-preprocessing-v1'},confirmedCropId:cropId||tensorDigest},undefined,
    event=>{if(event.stage==='encoder-run')report(id,'encoder-shard-complete',{loaded:++runs,total:config.steps.length});});
   const t=out.timings;
   return {values:out.wPlus.values,shape:[1,...out.wPlus.shape],space:'w-plus',encoderProvider:'wasm-unshared-streamed',encoderStats:{provider:'wasm-unshared-streamed',sourceEncoderSha256:config.sourceEncoderSha256,maxLiveSessions:t.maxLiveSessions,wasmPeakBytes:t.wasmHeapBytes,verifiedReadMs:t.verifiedReadMs,sessionCreateMs:t.sessionCreateMs,runMs:t.runMs,totalMs:t.totalMs,steps:config.steps.length,completed:true}};
  }finally{await encoder.dispose();}
 };
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
  report(id,'encoding');
  const result=await execute(tensor,confirmedCropId);result.encoderQualification=encoderQualification;
  requireLatent(result.values);const stats=result.encoderStats;report(id,'encoder-loaded',{elapsedMs:stats.sessionCreateMs,scope:'Sum of108 sequential ORT session creations',acquisitionMs:stats.verifiedReadMs});report(id,'encoding-complete',{elapsedMs:stats.runMs,scope:'Sum of108 session inference calls',totalWallMs:performance.now()-started});return result;
}

async function load(id){if(generator)return;
 // Release before acquire, at the acquire rather than at the end of the job that used it: until
 // something else needs the memory, a second photo gets to use what the first one brought in.
 //
 // Unless the host said to hold it. The flow is encode, face, encode, face, so shedding here
 // would hand the gigabyte back between every photo and the next one would read it all again —
 // which is the cost the holding exists to avoid. A device is only told to hold when it has the
 // room for both.
 if(residency.mode!=='on')await releaseEncoder();
 cache ||= await modelSource();planRoute();await probePlanned();
 report(id,'model-loading');const started=performance.now(),progress=stage=>report(currentId,stage);
 // The engine warms mapping beside the GPU load and keeps the CPU load sequential.
 if(provider==='webgpu'&&gpuEngine==='direct'){if(!manifest.webgl)throw Error('WebGPU direct bundle unavailable');generator=await (await webgpuLoaders()).loadDirectWebGpuGenerator({reader,manifest,manifestSha256,gpu:navigator.gpu,cpuOrt,progress});}
 else if(provider==='webgpu'){if(!manifest.webgpu)throw Error('WebGPU bundle unavailable');generator=await (await webgpuLoaders()).loadOrtWebGpuGenerator({reader,manifest,manifestSha256,gpu:navigator.gpu,host:browserModuleHost(),cpuOrt,progress});}
 else generator=await loadCpuGenerator({reader,manifest,manifestSha256,ort:cpuOrt});
 report(id,'model-loaded',{elapsedMs:performance.now()-started});
}
async function run(values,id,noiseMode='original'){await load(id);requireLatent(values);report(id,'synthesis');const start=performance.now();const raw=await generator.synthesizeRaw(values,noiseMode);report(id,'synthesis-complete',{elapsedMs:performance.now()-start});return raw;}
// A standalone RGBA buffer the caller may transfer.
const own=rgba=>rgba.byteOffset===0&&rgba.byteLength===rgba.buffer.byteLength?rgba:rgba.slice();
async function faceRgba(values,id){
 await load(id);requireLatent(values);report(id,'synthesis');const start=performance.now();let out;
 await generator.synthesizeSequence([values],(index,rgba)=>{out=own(rgba);});
 report(id,'synthesis-complete',{elapsedMs:performance.now()-start});return out;
}
async function faceBlob(values,id){return encodeRgbaPng(await faceRgba(values,id));}
// Morph frames, one request for a window of them, each posted back as it is ready. On WebGPU the engine queues
// the next frame on the GPU before this one is converted and PNG-encoded, so the GPU never waits on that tail; the
// CPU route runs the same schedule one frame at a time. Every frame's cost is reported as the interval since the
// previous one, which is what a morph is paced by.
const MAX_FRAMES=64;
const rawAcks=new Map();
function rawAck(id,index){return new Promise(resolve=>rawAcks.set(id+':'+index,()=>{rawAcks.delete(id+':'+index);resolve();}));}
async function synthesizeFrames(list,id,rawOutput=false){
 if(!Array.isArray(list)||!list.length||list.length>MAX_FRAMES)throw Error('Invalid frame batch');
 for(const values of list)requireLatent(values);
 await load(id);
 report(id,'synthesis');let last=performance.now();
 await generator.synthesizeSequence(list,async(index,rgba)=>{
  const now=performance.now();report(id,'synthesis-complete',{elapsedMs:now-last});last=now;
  if(rawOutput){const frame=own(rgba),ack=rawAck(id,index);postMessage({id,type:'frame',index,rgba:frame.buffer,width:SIDE,height:SIDE},[frame.buffer]);await ack;}
  else postMessage({id,type:'frame',index,blob:await encodeRgbaPng(rgba)});
 });
 return {frames:list.length};
}
async function mappingFor(z,id){
 await load(id);report(id,'mapping');
 const {psi,cutoff}=FFHQ_1024_DESCRIPTOR.truncation;
 return (await generator.map({ids:{requestId:String(id),inputRevision:0,attemptId:0},z,truncation:{psi,cutoff}})).wPlus.values;
}

// CI and release qualification must always see every canary. The flags arrive on 'initialize'
// from the main thread: a dedicated worker's globalThis is its own scope, so neither the page's
// __FACEMORPH_FULL_QUALIFY__ nor navigator.webdriver is visible here. The host that owns the
// page decides; the worker only honours what it was told. Every other device pays for canaries
// once per bundle (C-03).
let fullQualify=false,forceCanaryFail=false;
async function ensureQualification(id){
 if(qualification)return qualification;
 cache ||= await modelSource();
 qualification=createCanaryQualification({manifest,manifestSha256,route:provider==='webgpu'?'webgpu':'cpu',bundle:provider==='webgpu'?gpuBundle():manifest.synthesis,records:cache.records,reader,synthesizeRaw:(values,noiseMode)=>run(values,id,noiseMode),full:fullQualify,forceFail:forceCanaryFail});
 await qualification.adopt();
 return qualification;
}
// The bridge's canary progress shape: the engine's index is its `loaded`.
const canaryEvent=id=>ev=>report(id,'canary',{name:ev.name,loaded:ev.index,total:ev.total});
const qualifyResult=(q,extra={})=>({checks:q.checks(),provider,deviceValidated:true,releaseQualified:manifest.releaseQualified===true,...extra});
async function qualify(id){
 const q=await ensureQualification(id);
 if(fullQualify){while(!q.complete())await q.runNext('admission',canaryEvent(id));return qualifyResult(q);}
 if(q.complete())return qualifyResult(q,{cached:q.checks().length>0});
 await q.runNext('admission',canaryEvent(id)); // one canary gates admission; the first face comes before the rest
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
function startResumeDrain(id,admitted){
 if(resumeDrain!=null){postMessage({id,type:'complete',result:{checks:[],provider,deviceValidated:false,resumed:true}});return;}
 resumeDrain=id;
 const step=()=>{backgroundTask=()=>gatedTask(id,admitted,async()=>{
  try{
   const q=await ensureQualification(id);
   if(!q.complete())await q.runNext('background',canaryEvent(id));
   if(!q.complete()){step();return;}
   resumeDrain=null;
   await executionGate.drain();
   postMessage({id,type:'complete',result:{checks:q.checks(),provider,deviceValidated:true,resumed:true}});
  }catch(error){resumeDrain=null;postMessage({id,type:'error',error:{name:error.name,message:error.message,correctnessFailure:/Device correctness check failed|integrity/i.test(error.message||'')}});}
 });pump();};
 step();
}
self.onmessage=({data})=>{
 if(data.type==='compute-response'){
  const reply=computeReplies.get(data.token);if(!reply)return;computeReplies.delete(data.token);
  if(data.error)reply.reject(Object.assign(Error(data.error.message),{name:data.error.name}));else reply.resolve();return;
 }
 const {id,type,...request}=data;if(type==='raw-frame-ack'){rawAcks.get(id+':'+request.index)?.();return;}
 if(type==='grants'){grants=mergeGrants(grants,request.grants);return;}
 if(type==='qualify'&&request.resume){startResumeDrain(id,request.computeAdmission);return;}
 foreground.push(()=>gatedTask(id,request.computeAdmission,async()=>{
  try{
   let result;
   if(type==='initialize'){if(!['wasm','webgpu'].includes(request.provider))throw Error('Unsupported provider: WebGL execution was removed');if(request.grants)grants=mergeGrants(grants,request.grants);manifest=request.manifest;provider=request.provider;gpuEngine=request.gpuEngine==='direct'&&request.provider==='webgpu'?'direct':'ort';manifestSha256=request.manifestSha256;fullQualify=request.fullQualify===true||(!request.hostForcedQualify&&request.webdriver===true);forceCanaryFail=request.forceCanaryFail===true;result={provider};}
   else if(type==='qualify')result=await qualify(id);else if(type==='prefetch')result=await prefetchRoute(id,request.scope);else if(type==='generate'){const input=await inputLatent(request.mode,request.value),values=await mappingFor(input.values,id);result={...(request.raw===true?{rgba:(await faceRgba(values,id)).buffer,width:SIDE,height:SIDE}:{blob:await faceBlob(values,id)}),values,shape:[...BATCH_W_SHAPE],space:'w-plus',identity:input.identity};}else if(type==='synthesize-frames')result=await synthesizeFrames(request.frames,id,request.raw===true);else if(type==='synthesize'){const values=requireLatent(request.values);result={...(request.raw===true?{rgba:(await faceRgba(values,id)).buffer,width:SIDE,height:SIDE}:{blob:await faceBlob(values,id)}),values,shape:[...BATCH_W_SHAPE],space:'w-plus'};}else if(type==='encode-aligned'){
 // Sequential residency: e4e is released before loading synthesis.
 if(!manifest.encoder&&!manifest.encoderStream)throw Error('The browser encoder bundle is not available.');
 residency.mode=request.retain===true?'on':'off';
 if(residency.mode==='off')shedShards();
 // Sequential residency, unchanged in its peak: synthesis goes before the encoder is acquired.
 const held=generator;generator=null;await held?.dispose();
 cache ||= await modelSource();
 // The encoder is the largest thing this device will fetch. Budget for it before the first
 // byte arrives, so the bar measures the wait the user is actually in for.
 planAsset(manifest.encoderStream||manifest.encoder);await probePlanned();
 if(!(request.tensor instanceof Float32Array)||request.tensor.length!==196608||!request.tensor.every(Number.isFinite))throw Error('Invalid aligned photo tensor');
 // The streamed encoder is the only photo encoder (fm-fy2.6): the package runs it; the app holds no second e4e path.
 if(!manifest.encoderStream)throw Error('This model bundle has no streamed photo encoder.');result=await encodeStream(request.tensor,id,request.qualifiedEncoderSha256,request.confirmedCropId);
 }else throw Error('Unknown runtime operation');await executionGate.drain();postMessage({id,type:'complete',result},result?.rgba?[result.rgba]:[]);}catch(error){postMessage({id,type:'error',error:{name:error.name,message:error.message}});}}));
 pump();
};
