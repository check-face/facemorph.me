import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRuntime} from './runtime.mjs';

const hash='0'.repeat(64);
const manifest=()=>({schemaVersion:1,bundleVersion:'controller-test',modelSourceSha256:'model',noiseSha256:'noise',canaries:[{},{}],synthesis:{sha256:'s'},mapping:{sha256:'m'},average:{sha256:'a'},noise:[],webgpu:{},webgl:{}});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
function environment(t,agent='Android',gpu=true){
 for(const [key,value] of Object.entries({navigator:{userAgent:agent,...(gpu?{gpu:{}}:{}),hardwareConcurrency:8},OffscreenCanvas:class {},localStorage:storage(),sessionStorage:storage()})){
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
test('automatic selection still avoids a route interrupted on reload',async t=>{
 environment(t);
 sessionStorage.setItem('checkface-runtime-active-v1',JSON.stringify({route:'webgpu'}));
 assert.equal((await generate(runtime(t))).provenance.route,'cpu');
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

test('a real operation terminates the warm-up instead of waiting for it',async t=>{
 environment(t);
 let terminated=0,release;
 const factory=workerFactory();
 const r=runtime(t,{workerFactory:()=>{
  const worker=factory(),post=worker.postMessage;
  worker.terminate=()=>{terminated++;};
  worker.postMessage=function(message){
   // A warm-up that never answers, standing in for a download still in flight.
   if(message.type==='prefetch'){release=()=>{};return;}
   post.call(this,message);
  };
  return worker;}});
 const warming=r.prefetch();
 await Promise.resolve();
 const face=await generate(r);
 assert.equal(face.provenance.route,'webgpu');
 assert.equal(terminated>0,true,'the stalled warm-up worker is terminated');
 // The waiting promise settles rather than hanging for the lifetime of the page.
 assert.equal((await warming).started,false);
 assert.equal(typeof release,'function');
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
