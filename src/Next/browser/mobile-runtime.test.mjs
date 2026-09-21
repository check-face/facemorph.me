import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRuntime} from './runtime.mjs';

const hash='0'.repeat(64);
const manifest=()=>({schemaVersion:1,bundleVersion:'controller-test',modelSourceSha256:'model',noiseSha256:'noise',canaries:[{},{}],synthesis:{sha256:'s'},mapping:{sha256:'m'},average:{sha256:'a'},noise:[],webgpu:{},webgl:{}});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
function environment(t,agent='Android',gpu=true){
 for(const [key,value] of Object.entries({navigator:{userAgent:agent,...(gpu?{gpu:{requestAdapter:async()=>({limits:{}})}}:{}),hardwareConcurrency:8},OffscreenCanvas:class {},localStorage:storage(),sessionStorage:storage()})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
 }
}
function workerFactory({qualifyMs=15000,faceMs=618,cached=false,failGenerate=false,admitted=true,onMessage=()=>{}}={}){
 return ()=>({postMessage(message){onMessage(message);queueMicrotask(()=>{
  const send=data=>this.onmessage?.({data:{id:message.id,...data}});
  const progress=elapsedMs=>send({type:'progress',stage:'synthesis-complete',elapsedMs});
  if(message.type==='qualify'){
   if(!cached)progress(qualifyMs);
   return send({type:'complete',result:{deviceValidated:admitted,cached}});
  }
  if(['generate','synthesize'].includes(message.type)){
   progress(faceMs);
   if(failGenerate)return send({type:'error',error:{name:'Error',message:'inference failed'}});
   return send({type:'complete',result:{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}});
  }
  send({type:'complete',result:{}});
 });},terminate(){}});
}
function runtime(t,options={}){const r=createBrowserRuntime({manifest:manifest(),manifestSha256:hash,workerFactory:workerFactory(),...options});t.after(()=>r.dispose());return r;}
const generate=r=>r.generate({mode:'seed',value:'7'});
const costs=routes=>localStorage.setItem('facemorph-route-speed-v2',JSON.stringify({bundle:hash,scope:'warm-synthesis-v1',routes}));

test('legacy admission timings cannot pin a repaired GPU browser to CPU',async t=>{
 environment(t);
 localStorage.setItem('facemorph-route-speed-v1',JSON.stringify({bundle:hash,routes:{webgpu:120000,cpu:3000}}));
 assert.equal((await generate(runtime(t))).provenance.route,'webgpu');
});
test('a newly exposed WebGPU route is tried despite two measured alternatives',async t=>{
 environment(t);costs({cpu:2582,webgl:13000});
 assert.equal((await generate(runtime(t))).provenance.route,'webgpu');
});
test('supported warm measurements override priors, including fallback order',async t=>{
 environment(t);costs({cpu:2000,webgl:1000,webgpu:600});
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{const w=factory();const post=w.postMessage;let provider;w.postMessage=function(message){if(message.type==='initialize')provider=message.provider;if(message.type==='qualify'&&provider==='webgpu'){queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'error',error:{name:'NotSupportedError',message:'adapter refused'}}}));}else post.call(this,message);};return w;}});
 assert.equal((await generate(r)).provenance.route,'webgl');
});
test('unsupported and invalid stored routes cannot win selection',async t=>{
 environment(t,'Android',false);costs({webgpu:1,cpu:2500,webgl:13000,unknown:0.1});
 assert.equal((await generate(runtime(t))).provenance.route,'cpu');
});
test('explicit WebGPU selection retries an interrupted GPU instead of silently using CPU',async t=>{
 environment(t);
 sessionStorage.setItem('checkface-runtime-active-v1',JSON.stringify({route:'webgpu'}));
 const r=runtime(t,{preferredRoute:'webgpu'});
 assert.equal((await generate(r)).provenance.route,'webgpu');
 assert.equal(r.status().interruptedRoute,undefined);
});
// Superseded 21 September. This asserted that one interruption sent automatic selection to CPU.
// It is the behaviour the operator hit: a phone that had been reclaimed once kept choosing CPU
// while an explicitly forced WebGPU run was fast. An interruption is not a correctness verdict —
// a reload, a backgrounded tab and a real crash are indistinguishable here, and the fast route
// invites reclamation precisely because its working set is the largest. One interruption now
// earns a retry; `two interruptions in a row drop the route` below pins the limit.
test('automatic selection retries a route interrupted once, then drops it on a repeat',async t=>{
 environment(t);
 sessionStorage.setItem('checkface-runtime-active-v1',JSON.stringify({route:'webgpu'}));
 assert.equal((await generate(runtime(t))).provenance.route,'webgpu');
});
test('speed records measure successful warmed synthesis, never admission wall time',async t=>{
 environment(t);
 await generate(runtime(t,{workerFactory:workerFactory({qualifyMs:120000,faceMs:618})}));
 const record=JSON.parse(localStorage.getItem('facemorph-route-speed-v2'));
 assert.equal(record?.scope,'warm-synthesis-v1');
 assert.equal(record?.routes.webgpu,618);
});
test('a cached qualification does not make the first cold inference a warm sample',async t=>{
 environment(t);
 const r=runtime(t,{workerFactory:workerFactory({cached:true,faceMs:686})});
 await generate(r);
 assert.equal(localStorage.getItem('facemorph-route-speed-v2'),null);
 await generate(r);
 assert.equal(JSON.parse(localStorage.getItem('facemorph-route-speed-v2')).routes.webgpu,686);
});
test('an error after synthesis progress must not leave a successful speed measurement',async t=>{
 environment(t);
 const r=runtime(t,{preferredRoute:'webgpu',workerFactory:workerFactory({failGenerate:true})});
 await assert.rejects(generate(r),/inference failed/);
 assert.equal(localStorage.getItem('facemorph-route-speed-v2'),null);
});
test('a non-admitted explicit route cannot produce a face',async t=>{
 environment(t);
 const r=runtime(t,{preferredRoute:'webgpu',workerFactory:workerFactory({admitted:false})});
 await assert.rejects(generate(r),/correctness check/);
});
test('failed explicit WebGPU retries never masquerade as successful CPU results',async t=>{
 environment(t);
 const r=runtime(t,{preferredRoute:'webgpu',workerFactory:workerFactory({failGenerate:true})});
 await assert.rejects(generate(r),/inference failed/);
 await assert.rejects(generate(r),/inference failed/);
 assert.equal(r.status().route,'webgpu');
});

// Acquisition warm-up. The first face on a cold device waits on roughly 200 MB that is the same
// whichever face is asked for, so it is fetched while the visitor is still reading the page.
const link=(t,value)=>{const nav=globalThis.navigator;Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:{...nav,connection:value}});t.after(()=>{Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:nav});});};

test('warm-up acquires the route this device would choose, before anything is asked of it',async t=>{
 environment(t);
 const seen=[];
 const r=runtime(t,{workerFactory:workerFactory({onMessage:m=>seen.push(m)})});
 const result=await r.prefetch();
 assert.equal(result.started,true);
 assert.deepEqual(seen.map(m=>m.type),['initialize','prefetch']);
 assert.equal(seen[0].provider,'webgpu','the warm-up follows route selection, not a fixed guess');
 // Warming is not qualification: nothing has proved this device can run the route yet.
 assert.equal(r.status().deviceValidated,false);
});

test('warm-up runs in its own worker so a Generate never queues behind the download',async t=>{
 environment(t);
 let created=0;
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{created++;return factory();}});
 await r.prefetch();
 assert.equal(created,1);
 assert.equal((await generate(r)).provenance.route,'webgpu');
 assert.equal(created,2,'the inference worker is a second, separate worker');
});

test('a warm-up already downloading is terminated, not waited for',async t=>{
 environment(t);
 let terminated=0,started;
 const reached=new Promise(resolve=>{started=resolve;});
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{
  const worker=factory(),post=worker.postMessage;
  worker.terminate=()=>{terminated++;};
  worker.postMessage=function(message){
   // A warm-up that never answers, standing in for a download still in flight.
   if(message.type==='prefetch'){started();return;}
   post.call(this,message);
  };
  return worker;}});
 const warming=r.prefetch();
 await reached; // the warm-up owns a worker before the real operation begins
 const face=await generate(r);
 assert.equal(face.provenance.route,'webgpu');
 assert.equal(terminated>0,true,'the stalled warm-up worker is terminated');
 // The waiting promise settles rather than hanging for the lifetime of the page.
 assert.equal((await warming).started,false);
});

// The warm-up awaits a manifest and a GPU adapter probe before it creates anything. A real
// operation starting during that preamble cannot be cancelled by terminating a worker that does
// not exist yet, so the warm-up re-checks and declines instead of running unsupervised.
test('a warm-up still in its preamble never starts a worker at all',async t=>{
 environment(t);
 let created=0;
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{created++;return factory();}});
 const warming=r.prefetch(); // deliberately not awaited past its first tick
 const face=await generate(r);
 assert.equal(face.provenance.route,'webgpu');
 assert.equal((await warming).started,false,'the warm-up stood down');
 assert.equal(created,1,'only the inference worker was ever created');
});

test('warm-up declines only on an explicit data saver, never on an effectiveType reading',async t=>{
 environment(t);
 link(t,{saveData:true,effectiveType:'4g'});
 const seen=[];
 const saver=createBrowserRuntime({manifest:manifest(),manifestSha256:hash,workerFactory:workerFactory({onMessage:m=>seen.push(m)})});
 assert.deepEqual(await saver.prefetch(),{started:false});
 assert.deepEqual(seen,[],'no worker is started and no bytes are requested');
 saver.dispose();
 // effectiveType is a rolling throughput estimate, not a statement about the connection: Chrome
 // reports '3g' on a fast wired Mac. A slow link is also where warming early helps most.
 for(const effectiveType of ['slow-2g','2g','3g','4g',undefined]){
  link(t,{saveData:false,effectiveType});
  const r=createBrowserRuntime({manifest:manifest(),manifestSha256:hash,workerFactory:workerFactory()});
  assert.equal((await r.prefetch()).started,true,`effectiveType ${effectiveType} must not disable warm-up`);
  r.dispose();
 }
 link(t,undefined);
 const bare=runtime(t);
 assert.equal((await bare.prefetch()).started,true,'a browser without connection hints still warms');
});

test('warm-up never runs twice, nor after the route is already admitted',async t=>{
 environment(t);
 let created=0;
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{created++;return factory();}});
 await generate(r);
 const after=created;
 assert.deepEqual(await r.prefetch(),{started:false},'an admitted route needs no warm-up');
 assert.equal(created,after);
});

// An interruption is not a device-check failure. The operator's phone kept landing on CPU while
// an explicitly forced WebGPU run was fast: one reclaimed tab — the fate the largest working set
// invites — removed the fast route for the whole page load, silently.
const interrupted=route=>sessionStorage.setItem('checkface-runtime-active-v1',JSON.stringify({owner:'other',route,stage:'generate',id:1,at:Date.now()}));

test('one interruption costs the fast route a retry, not the whole session',async t=>{
 environment(t);
 interrupted('webgpu');
 assert.equal((await generate(runtime(t))).provenance.route,'webgpu','WebGPU is tried again after a single interruption');
});

test('two interruptions in a row drop the route, and the drop is announced',async t=>{
 environment(t);
 interrupted('webgpu');
 const first=runtime(t);await generate(first);first.dispose();
 // The qualifying run clears the count, so a fresh pair of interruptions is needed to drop it.
 interrupted('webgpu');
 const seen=[];
 const second=createBrowserRuntime({manifest:manifest(),manifestSha256:hash,workerFactory:workerFactory(),onProgress:e=>seen.push(e)});
 t.after(()=>second.dispose());
 interrupted('webgpu');
 const third=createBrowserRuntime({manifest:manifest(),manifestSha256:hash,workerFactory:workerFactory(),onProgress:e=>seen.push(e)});
 t.after(()=>third.dispose());
 assert.equal((await third.generate({mode:'seed',value:'7'})).provenance.route,'cpu');
 const dropped=seen.find(e=>e.stage==='route-admitted'&&e.routeOutcome==='interrupted');
 assert.ok(dropped,'the set-aside route is announced, never silently skipped');
 assert.equal(dropped.provider,'webgpu');
});

test('a route that qualifies forgets its interruption history',async t=>{
 environment(t);
 interrupted('webgpu');
 const first=runtime(t);await generate(first);first.dispose();
 assert.equal(JSON.parse(sessionStorage.getItem('checkface-runtime-interrupted-v1')||'{}').webgpu,undefined);
 interrupted('webgpu');
 assert.equal((await generate(runtime(t))).provenance.route,'webgpu','the count restarts from one');
});

// The iOS lane's first run caught this: Safari 26.5 in the Simulator exposes navigator.gpu and
// returns null from requestAdapter(). The warm-up chose webgpu on the strength of the object
// alone, pulled the whole 212 MB GPU bundle, failed admission for want of an adapter, and then
// pulled the 158 MB CPU bundle — 330 MiB cached on a device that could only ever use 158.
test('a GPU object that yields no adapter is not a WebGPU device',async t=>{
 environment(t);
 const nav=globalThis.navigator;
 Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,
  value:{...nav,gpu:{requestAdapter:async()=>null}}});
 t.after(()=>{Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:nav});});
 const seen=[];
 const r=runtime(t,{workerFactory:workerFactory({onMessage:m=>seen.push(m)})});
 assert.equal((await r.prefetch()).started,true);
 assert.equal(seen[0].provider,'wasm','the warm-up must not download a GPU bundle it cannot use');
 assert.equal((await generate(r)).provenance.route,'cpu');
});

test('a GPU object that yields an adapter still leads',async t=>{
 environment(t);
 const seen=[];
 const r=runtime(t,{workerFactory:workerFactory({onMessage:m=>seen.push(m)})});
 assert.equal((await r.prefetch()).started,true);
 assert.equal(seen[0].provider,'webgpu');
});

// The operator's phone reached a state where every route had failed once, and the next face died
// in 26 ms with "No local processing route remains available" before any worker started. A
// failure is evidence about an attempt, not a permanent verdict on a route.
test('a session that exhausted every route recovers on the next attempt',async t=>{
 environment(t);
 let failing=true;
 const factory=workerFactory();
 // A transient condition — a lost device, a stopped worker — knocks out every route in turn.
 const r=runtime(t,{workerFactory:()=>{
  const worker=factory(),post=worker.postMessage;let provider;
  worker.postMessage=function(message){
   if(message.type==='initialize')provider=message.provider;
   if(message.type==='qualify'&&failing)
    return queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'error',
     error:{name:'Error',message:'transient '+provider}}}));
   post.call(this,message);
  };
  return worker;}});
 // Exhausting every route inside one attempt is still a failure: something is wrong right now.
 await assert.rejects(generate(r),/transient/);
 // But the history must not poison the next attempt, which is what dead-ended the operator's
 // phone at 26 ms with no worker started.
 failing=false;
 const seen=[];
 const face=await r.generate({mode:'seed',value:'7'},{onProgress:e=>seen.push(e)});
 assert.ok(face.provenance.route,'a face is produced rather than a dead end');
 assert.ok(seen.some(e=>e.stage==='routes-retried'),'the retry is announced, not silent');
});

test('an explicitly selected route still fails rather than silently substituting',async t=>{
 environment(t);
 const r=runtime(t,{preferredRoute:'webgpu',workerFactory:workerFactory({admitted:false})});
 await assert.rejects(generate(r),/correctness check/);
});

// The encoder correctness pass costs 20,920 ms on the operator's phone against 7,395 ms for the
// real encode. It must run once per device per encoder build, not once per page load.
const photoManifest=()=>({...manifest(),encoderStream:{sha256:'enc-1',phoneAdmitted:true},alignmentSha256:'align',landmarks:{sha256:'l'}});
const alignedPhoto=async()=>({tensor:new Float32Array(196608),faceCount:1,didAlign:true,
 alignmentWorkerTerminated:true,provenance:{preprocessingSha256:'align',facePolicy:'exactly-one-face-v1'}});

function photoWorker(seen){
 return ()=>({postMessage(message){seen.push(message);queueMicrotask(()=>{
  const send=data=>this.onmessage?.({data:{id:message.id,...data}});
  if(message.type==='qualify')return send({type:'complete',result:{deviceValidated:true}});
  if(message.type==='encode-aligned')return send({type:'complete',result:{values:new Float32Array(9216),
   encoderQualification:{passed:true,manifestSha256:'enc-1'}}});
  if(message.type==='synthesize')return send({type:'complete',result:{blob:new Blob(['p'],{type:'image/png'}),
   values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}});
  send({type:'complete',result:{}});});},terminate(){}});
}

test('the encoder correctness pass is not repeated on a later page load',async t=>{
 environment(t);
 const first=[];
 const a=createBrowserRuntime({manifest:photoManifest(),manifestSha256:hash,alignPhoto:alignedPhoto,workerFactory:photoWorker(first)});
 await a.encodePhoto(new Blob(['x'],{type:'image/png'}));
 assert.equal(first.find(m=>m.type==='encode-aligned').qualifiedEncoderSha256,undefined,
  'the first device ever pays for the pass');
 a.dispose();
 // A fresh runtime is a fresh page load; the verdict must survive it.
 const second=[];
 const b=createBrowserRuntime({manifest:photoManifest(),manifestSha256:hash,alignPhoto:alignedPhoto,workerFactory:photoWorker(second)});
 t.after(()=>b.dispose());
 await b.encodePhoto(new Blob(['y'],{type:'image/png'}));
 assert.equal(second.find(m=>m.type==='encode-aligned').qualifiedEncoderSha256,'enc-1',
  'the second load reuses this device\'s recorded verdict');
});

test('a different encoder build qualifies again rather than trusting the old verdict',async t=>{
 environment(t);
 const first=[];
 const a=createBrowserRuntime({manifest:photoManifest(),manifestSha256:hash,alignPhoto:alignedPhoto,workerFactory:photoWorker(first)});
 await a.encodePhoto(new Blob(['x'],{type:'image/png'}));
 a.dispose();
 const changed={...photoManifest(),encoderStream:{sha256:'enc-2',phoneAdmitted:true}};
 const second=[];
 const b=createBrowserRuntime({manifest:changed,manifestSha256:hash,alignPhoto:alignedPhoto,
  workerFactory:()=>{const w=photoWorker(second)();const post=w.postMessage;
   w.postMessage=function(m){if(m.type==='encode-aligned'){second.push(m);return queueMicrotask(()=>this.onmessage({data:{id:m.id,type:'complete',
    result:{values:new Float32Array(9216),encoderQualification:{passed:true,manifestSha256:'enc-2'}}}}));}post.call(this,m);};
   return w;}});
 t.after(()=>b.dispose());
 await b.encodePhoto(new Blob(['y'],{type:'image/png'}));
 assert.equal(second.find(m=>m.type==='encode-aligned').qualifiedEncoderSha256,undefined,
  'a new encoder build is not covered by the old verdict');
});

// The operator's phone reported webgpu, cpu and webgl all "canary-failed" 154, 203 and 251 ms
// apart — far too fast for a canary, which requires a synthesis. One engine that never started
// was blamed on three routes, and the run ended on "No local processing route remains available".
test('an engine that never starts is reported once, not blamed on every route',async t=>{
 environment(t);
 const refused=[];
 const r=runtime(t,{workerFactory:()=>({postMessage(){queueMicrotask(()=>this.onerror?.({message:'out of memory',filename:'https://x/ort-worker.mjs',lineno:42}));},terminate(){}}),
  onProgress:e=>{if(e.stage==='route-admitted')refused.push(e.routeOutcome);}});
 await assert.rejects(generate(r),/local generation engine stopped/);
 assert.deepEqual(refused,['engine-stopped'],'one honest report, not one per route');
 assert.equal(r.status().route,'webgpu','no route was marked dead for an engine fault');
});

test('the worker error detail travels with the message', async t=>{
 environment(t);
 const r=runtime(t,{workerFactory:()=>({postMessage(){queueMicrotask(()=>this.onerror?.({message:'out of memory',filename:'https://x/ort-worker.mjs',lineno:42}));},terminate(){}})});
 await assert.rejects(generate(r),/out of memory.*ort-worker\.mjs.*line 42/);
});
