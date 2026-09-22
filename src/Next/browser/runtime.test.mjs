import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inputLatent,truncate,rgba1024} from './identity.mjs';
import {digest} from './originals.mjs';
const fixture=JSON.parse(await readFile(new URL('./identity-fixtures.json',import.meta.url)));
for(const c of fixture.cases)test(`Exact NumPy identity: ${c.mode} ${c.value}`,async()=>assert.equal(await digest((await inputLatent(c.mode,c.value)).values),c.sha256));
test('Reject unsafe seeds and oversized text',async()=>{for(const value of ['-1','1.5','4294967296','1e3',''])await assert.rejects(inputLatent('seed',value));await assert.rejects(inputLatent('text','😀'.repeat(129)));});
test('Truncation applies exactly first eight layers, no alias',()=>{const w=new Float32Array(9216).fill(1),a=new Float32Array(512).fill(.25),t=truncate(w,a);assert.equal(t[0],Math.fround(.25+Math.fround(Math.fround(1-.25)*Math.fround(.7))));assert.equal(t[4096],1);assert.equal(w[0],1);});
test('Pixel conversion refuses NaN instead of black successful image',()=>{const raw=new Float32Array(3*1024*1024);raw[0]=NaN;assert.throws(()=>rgba1024(raw),/Nonfinite/);});
import {generationIdentity} from './identity.mjs';
import {decodeReferencePng,encodeRgbaPng} from './png.mjs';
test('Moving hosts or changing canaries preserves original identity, weights invalidate',()=>{const m={synthesis:{sha256:'a',url:'https://one'},mapping:{sha256:'b'},average:{sha256:'c'},noise:[{name:'noise_0',shape:[4,4],sha256:'d'}]},moved={...m,synthesis:{...m.synthesis,url:'https://two'},canaries:['more'],releaseQualified:true};assert.deepEqual(generationIdentity(m,'seed'),generationIdentity(moved,'seed'));assert.notDeepEqual(generationIdentity(m,'seed'),generationIdentity({...m,synthesis:{sha256:'changed'}},'seed'));});
test('Canonical PNG exact raw byte roundtrip without canvas',async()=>{const raw=Uint8Array.from({length:16*16*4},(_,i)=>i%256);const png=await encodeRgbaPng(raw,16,16);const decoded=await decodeReferencePng(await png.arrayBuffer(),{expectedWidth:16,expectedHeight:16});assert.deepEqual(new Uint8Array(decoded.rgba),raw);});
import {createBrowserRuntime} from './runtime.mjs';
const testManifest=()=>({schemaVersion:1,bundleVersion:'test-controller-only',modelSourceSha256:'source',noiseSha256:'noise',canaries:[{},{}],synthesis:{sha256:'s'},mapping:{sha256:'m'},average:{sha256:'a'},noise:[],webgpu:{}});
function fakeStorage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('GPU failure terminates before an independently checked CPU retry',async()=>{const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter:async()=>({limits:{}})}}});globalThis.sessionStorage=fakeStorage();const calls=[];const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),manifest:testManifest(),workerFactory:()=>{let provider;return {postMessage(message){if(message.type==='initialize')provider=message.provider;calls.push(message.type+':'+provider);queueMicrotask(()=>this.onmessage({data:message.type==='qualify'&&provider==='webgpu'?{id:message.id,type:'error',error:{name:'Error',message:'Driver failed'}}:{id:message.id,type:'complete',result:message.type==='generate'?{blob:new Blob(['controller-test-only'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true}}}));},terminate(){calls.push('terminate:'+provider);}};}});try{const result=await runtime.generate({mode:'seed',value:'3'});assert.equal(result.provenance.provider,'wasm');assert.deepEqual(calls.slice(0,7),['initialize:webgpu','qualify:webgpu','terminate:webgpu','initialize:wasm','qualify:wasm','generate:wasm']);}finally{runtime.dispose();if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;delete globalThis.sessionStorage;}});
test('Phone monolithic encoder guard fires before worker or alignment allocation',async()=>{const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',maxTouchPoints:5}});let allocations=0;const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),manifest:{...testManifest(),encoder:{size:1068862265,sha256:'encoder'}},alignPhoto:async()=>{allocations++;throw Error('Must not align');},workerFactory:()=>{allocations++;throw Error('Must not allocate');}});try{await assert.rejects(runtime.encodePhoto(new Blob(['synthetic-input'])),/too large/);assert.equal(allocations,0);}finally{runtime.dispose();if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;}});

// Minimal asynchronous IndexedDB test adapter; model execution remains mocked.
function indexedDbFixture(){const records=new Map();return {records,api:{open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={};tx.objectStore=()=>({get(key){const r={};queueMicrotask(()=>{r.result=structuredClone(records.get(key));r.onsuccess?.();});return r;},put(value,key){records.set(key,structuredClone(value));setTimeout(()=>tx.oncomplete?.(),0);}});return tx;}};request.onsuccess?.();});return request;}}};}
function controllerWorker(onRequest=()=>{}){return {postMessage(message){onRequest(message);let result={deviceValidated:true};if(['generate','synthesize'].includes(message.type))result={blob:new Blob(['mock-canonical-png'],{type:'image/png'}),values:message.values||new Float32Array(9216).fill(.25),space:'w-plus',shape:[1,18,512]};queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result}}));},terminate(){}};}
test('Reopened W+ project reuses the seeded original without workers or duplicate PNG storage',async()=>{const old=globalThis.indexedDB,fixture=indexedDbFixture();globalThis.indexedDB=fixture.api;const config={manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu'};let workers=0;const first=createBrowserRuntime({...config,workerFactory:()=>{workers++;return controllerWorker();}});let generated;try{generated=await first.generate({mode:'seed',value:'42'});}finally{first.dispose();}const second=createBrowserRuntime({...config,workerFactory:()=>{workers++;throw Error('Cached latent must not create a worker');}});try{const saved=await second.synthesize({space:'w-plus',shape:[1,18,512],values:generated.values});assert.equal(saved.cached,true);assert.equal(saved.imageSha256,generated.imageSha256);assert.equal(workers,1);assert.equal(fixture.records.size,2);assert.equal([...fixture.records.values()].filter(x=>x.blob instanceof Blob).length,1);assert.equal([...fixture.records.values()].filter(x=>x.kind==='canonical-original-alias-v1').length,1);}finally{second.dispose();if(old===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=old;}});

// A partial (one-canary) qualification must finish only after the first face is delivered, on
// the worker's background lane; a warm bundle must send no resume at all (C-03).
function qualificationWorker(onMessage){
 let state='cold';
 return {postMessage(message){const respond=result=>queueMicrotask(()=>this.onmessage?.({data:{id:message.id,type:'complete',result}}));
  onMessage(message);
  if(message.type==='initialize')return respond({provider:message.provider});
  if(message.type==='qualify'&&message.resume){state='warm';return respond({checks:[{name:'c0',passed:true}],provider:'wasm',deviceValidated:true,resumed:true});}
  if(message.type==='qualify')return respond(state==='cold'?{checks:[{name:'c0',passed:true}],provider:'wasm',deviceValidated:true,partial:true}:{checks:[{name:'c0',passed:true}],provider:'wasm',deviceValidated:true,cached:true});
  if(message.type==='generate')return respond({blob:new Blob(['mock-canonical-png'],{type:'image/png'}),values:new Float32Array(9216).fill(.25),space:'w-plus',shape:[1,18,512]});
  throw Error('unexpected operation '+message.type);},terminate(){}};}
test('C-03: remaining canaries are requested only after the first face, and a warm bundle sends no resume',async()=>{
 globalThis.sessionStorage=fakeStorage();
 const oldIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDbFixture().api;
 const messages=[];
 const worker=qualificationWorker(message=>messages.push(message.type+(message.resume?':resume':'')));
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>worker});
 try{
  await runtime.generate({mode:'seed',value:'42'});
  assert.deepEqual(messages,['initialize','qualify','generate','qualify:resume'],'the resume rides after the delivered face');
  messages.length=0;
  await runtime.generate({mode:'seed',value:'43'});
  assert.deepEqual(messages,['generate'],'a completed qualification runs no further canary checks and no resume');
 }finally{runtime.dispose();globalThis.indexedDB=oldIDB;}
});
test('C-03: a background canary failure invalidates the route loudly',async()=>{
 globalThis.sessionStorage=fakeStorage();
 const oldIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDbFixture().api;
 // The worker fails the resume like a late canary failure does.
 const failure=(kind,correctness)=>{const w=qualificationWorker(message=>{if(message.type==='qualify'&&message.resume)queueMicrotask(()=>w.onmessage({data:{id:message.id,type:'error',error:{name:'Error',message:kind,correctnessFailure:correctness}}}));});return w;};
const failing=failure('Device correctness check failed: canary-5',true);
 const events=[];
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',onProgress:event=>events.push(event),workerFactory:()=>failing});
 try{
  await runtime.generate({mode:'seed',value:'42'});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(events.some(event=>event.stage==='canary-invalidated'),'the failure is named to the interface');
  assert.equal(runtime.status().deviceValidated,false,'the route is no longer claimed as validated');
 }finally{runtime.dispose();globalThis.indexedDB=oldIDB;}
});
test('C-03: a transient background failure stays quiet and retries on a later face',async()=>{
 globalThis.sessionStorage=fakeStorage();
 const oldIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDbFixture().api;
 const events=[];
 const failure=(kind,correctness)=>{const w=qualificationWorker(message=>{if(message.type==='qualify'&&message.resume)queueMicrotask(()=>w.onmessage({data:{id:message.id,type:'error',error:{name:'TypeError',message:kind,correctnessFailure:correctness}}}));});return w;};
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',onProgress:event=>events.push(event),workerFactory:()=>failure('fetch failed',false)});
 try{
  await runtime.generate({mode:'seed',value:'42'});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(!events.some(event=>event.stage==='canary-invalidated'),'a network hiccup is not a correctness verdict');
 }finally{runtime.dispose();globalThis.indexedDB=oldIDB;}
});

// Encoding several photos in a row is the ordinary case, and the worker was thrown away around
// every one of them: terminate, align, start, encode, terminate, start, synthesize. A wasm heap
// never shrinks, so on a phone that teardown is the only way the gigabyte comes back and it stays.
// A machine with memory to spare pays 15 s of re-reading and re-hashing the same gigabyte per
// photo for nothing (photo-runtime/evidence/desktop-browser-five-photos.json).
function photoRuntime(lifecycle,manifestExtra={}){
 let live=0;
 const worker=()=>{live++;lifecycle.push('start');return {postMessage(message){lifecycle.push(message.type+(message.retain===true?':retain':message.retain===false?':discard':''));
  const result=message.type==='encode-aligned'?{values:new Float32Array(9216).fill(.1),shape:[1,18,512],space:'w-plus',encoderProvider:'wasm',encoderQualification:{passed:true,manifestSha256:'enc'}}
   :['generate','synthesize'].includes(message.type)?{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216).fill(.1),space:'w-plus',shape:[1,18,512]}
   :{deviceValidated:true};
  queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result}}));},
  terminate(){live--;lifecycle.push('terminate');}};};
 return createBrowserRuntime({manifestSha256:'0'.repeat(64),preferredRoute:'cpu',
  manifest:{...testManifest(),alignmentSha256:'align',encoderStream:{sha256:'enc',size:1024,phoneAdmitted:true},...manifestExtra},
  alignPhoto:async()=>({tensor:new Float32Array(196608),faceCount:1,didAlign:true,alignmentWorkerTerminated:true,
   provenance:{preprocessingSha256:'align',facePolicy:'exactly-one-face-v1'}}),
  workerFactory:worker});
}
test('A device with no stated memory budget still throws the encoder away after every photo',async()=>{
 const lifecycle=[];const runtime=photoRuntime(lifecycle);
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0'}});
 try{
  await runtime.encodePhoto(new Blob(['synthetic-input']));
  assert.ok(lifecycle.includes('terminate'),lifecycle.join(' '));
  assert.ok(lifecycle.includes('encode-aligned:discard'),lifecycle.join(' '));
 }finally{runtime.dispose();if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});
test('A machine with memory to spare keeps the encoder between the photo and its face',async()=>{
 const lifecycle=[];const runtime=photoRuntime(lifecycle);
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 (Macintosh)',deviceMemory:16,maxTouchPoints:0}});
 try{
  await runtime.encodePhoto(new Blob(['synthetic-input']));
  assert.equal(lifecycle.filter(x=>x==='terminate').length,0,lifecycle.join(' '));
  assert.equal(lifecycle.filter(x=>x==='start').length,1,lifecycle.join(' '));
  // The worker is told, per request, so it never holds a gigabyte in a thread about to be ended.
  assert.ok(lifecycle.includes('encode-aligned:retain'),lifecycle.join(' '));
 }finally{runtime.dispose();if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});
test('A phone claiming 8 GB is not trusted with it until one has been measured holding it',async()=>{
 const lifecycle=[];const runtime=photoRuntime(lifecycle);
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 (Linux; Android 14)',deviceMemory:8,maxTouchPoints:5}});
 try{
  await runtime.encodePhoto(new Blob(['synthetic-input']));
  assert.ok(lifecycle.includes('encode-aligned:discard'),lifecycle.join(' '));
  // ...and the override is how that measurement gets taken, in either direction.
  globalThis.__FACEMORPH_HOLD_ENCODER__=true;
  const forced=[];const second=photoRuntime(forced);
  try{await second.encodePhoto(new Blob(['synthetic-input-2']));
   assert.ok(forced.includes('encode-aligned:retain'),forced.join(' '));
  }finally{second.dispose();delete globalThis.__FACEMORPH_HOLD_ENCODER__;}
 }finally{runtime.dispose();if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});
