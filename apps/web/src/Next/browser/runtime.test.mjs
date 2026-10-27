import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inputLatent,truncate,rgba1024} from './identity.mjs';
import {digest} from './originals.mjs';
import {confirmCropped} from '../photo/confirmed-crop.mjs';
import {createExecutionGate} from './execution-gate.mjs';
const fixture=JSON.parse(await readFile(new URL('./identity-fixtures.json',import.meta.url)));
for(const c of fixture.cases)test(`Exact NumPy identity: ${c.mode} ${c.value}`,async()=>assert.equal(await digest((await inputLatent(c.mode,c.value)).values),c.sha256));
test('Reject unsafe seeds and oversized text',async()=>{for(const value of ['-1','1.5','4294967296','1e3',''])await assert.rejects(inputLatent('seed',value));await assert.rejects(inputLatent('text','😀'.repeat(129)));});
test('Truncation applies exactly first eight layers, no alias',()=>{const w=new Float32Array(9216).fill(1),a=new Float32Array(512).fill(.25),t=truncate(w,a);assert.equal(t[0],Math.fround(.25+Math.fround(Math.fround(1-.25)*Math.fround(.7))));assert.equal(t[4096],1);assert.equal(w[0],1);});
test('Pixel conversion refuses NaN instead of black successful image',()=>{const raw=new Float32Array(3*1024*1024);raw[0]=NaN;assert.throws(()=>rgba1024(raw),/Nonfinite/);});
import {generationIdentity} from './identity.mjs';
import {decodeReferencePng,encodeRgbaPng} from './png.mjs';
test('Moving hosts or changing canaries preserves original identity, weights invalidate',()=>{const m={synthesis:{sha256:'a',url:'https://one'},mapping:{sha256:'b'},average:{sha256:'c'},noise:[{name:'noise_0',shape:[4,4],sha256:'d'}]},moved={...m,synthesis:{...m.synthesis,url:'https://two'},canaries:['more'],releaseQualified:true};assert.deepEqual(generationIdentity(m,'seed'),generationIdentity(moved,'seed'));assert.notDeepEqual(generationIdentity(m,'seed'),generationIdentity({...m,synthesis:{sha256:'changed'}},'seed'));});
test('Canonical PNG exact raw byte roundtrip without canvas',async()=>{const raw=Uint8Array.from({length:16*16*4},(_,i)=>i%256);const png=await encodeRgbaPng(raw,16,16);const decoded=await decodeReferencePng(await png.arrayBuffer(),{expectedWidth:16,expectedHeight:16});assert.deepEqual(new Uint8Array(decoded.rgba),raw);});
import zlib from 'node:zlib';
// The encoder is stored-by-default and its checksums are hand-rolled, so they are checked against Node's own
// zlib (an independent implementation), not against the decoder that shares the same crc().
function pngChunks(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let pos=8;pos<bytes.length;){const length=view.getUint32(pos),type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));out.push({type,data:bytes.subarray(pos+8,pos+8+length),crc:view.getUint32(pos+8+length),span:bytes.subarray(pos+4,pos+8+length)});pos+=length+12;}return out;}
test('Stored-by-default PNG: every chunk CRC and the zlib stream verify against Node zlib',{skip:typeof zlib.crc32!=='function'},async()=>{
  for(const [width,height] of [[1,1],[3,5],[64,64],[1024,1024]]){
    const rgba=new Uint8Array(width*height*4);let s=12345;for(let i=0;i<rgba.length;i++){s=(s*1664525+1013904223)>>>0;rgba[i]=i%4===3?255:(s>>>24)&0xe0|(i>>4)&0x1f;}
    const bytes=new Uint8Array(await (await encodeRgbaPng(rgba,width,height)).arrayBuffer()),chunks=pngChunks(bytes);
    assert.deepEqual(chunks.map(c=>c.type),['IHDR','IDAT','IEND']);
    for(const chunk of chunks)assert.equal(chunk.crc,zlib.crc32(chunk.span),`${width}x${height} ${chunk.type} CRC`);
    const scan=zlib.inflateSync(chunks[1].data);assert.equal(scan.length,(width*4+1)*height);
    for(let y=0;y<height;y++){assert.equal(scan[y*(width*4+1)],0);assert.deepEqual(new Uint8Array(scan.subarray(y*(width*4+1)+1,(y+1)*(width*4+1))),rgba.subarray(y*width*4,(y+1)*width*4));}
    const decoded=await decodeReferencePng(bytes.buffer,{expectedWidth:width,expectedHeight:height});assert.deepEqual(new Uint8Array(decoded.rgba),rgba);
  }
});
test('Compressed PNG remains available and decodes to the same pixels',async()=>{const raw=Uint8Array.from({length:32*32*4},(_,i)=>i%7*30);const stored=await encodeRgbaPng(raw,32,32),packed=await encodeRgbaPng(raw,32,32,{compress:true});
  const a=await decodeReferencePng(await stored.arrayBuffer(),{expectedWidth:32,expectedHeight:32}),b=await decodeReferencePng(await packed.arrayBuffer(),{expectedWidth:32,expectedHeight:32});assert.deepEqual(new Uint8Array(a.rgba),new Uint8Array(b.rgba));assert.ok(packed.size<stored.size);});
import {createBrowserRuntime} from './runtime.mjs';
// An adapter reports at least the WebGPU defaults (256 MiB buffers, 128 MiB storage bindings); route admission
// (fm-lt2p) reads them, so a stand-in adapter states them instead of reporting none.
const SPEC_DEFAULT_LIMITS={maxBufferSize:268435456,maxStorageBufferBindingSize:134217728};
const pin=n=>String(n).repeat(64),asset=(n,size=4)=>({url:`https://model.example/asset-${n}`,sha256:pin(n),size});
const testManifest=()=>({schemaVersion:1,bundleVersion:'test-controller-only',modelSourceSha256:pin(1),noiseSha256:pin(2),canaries:[{},{}],synthesis:asset(3),mapping:asset(4),average:asset(5),noise:[{...asset(6),name:'noise_0',shape:[1]}],webgpu:{}});
function fakeStorage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('GPU failure terminates before an independently checked CPU retry',async()=>{const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter:async()=>({limits:SPEC_DEFAULT_LIMITS})}}});globalThis.sessionStorage=fakeStorage();const calls=[];const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),manifest:testManifest(),workerFactory:()=>{let provider;return {postMessage(message){if(message.type==='initialize')provider=message.provider;calls.push(message.type+':'+provider);queueMicrotask(()=>this.onmessage({data:message.type==='qualify'&&provider==='webgpu'?{id:message.id,type:'error',error:{name:'Error',message:'Driver failed'}}:{id:message.id,type:'complete',result:message.type==='generate'?{blob:new Blob(['controller-test-only'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true}}}));},terminate(){calls.push('terminate:'+provider);}};}});try{const result=await runtime.generate({mode:'seed',value:'3'});assert.equal(result.provenance.provider,'wasm');assert.deepEqual(calls.slice(0,7),['initialize:webgpu','qualify:webgpu','terminate:webgpu','initialize:wasm','qualify:wasm','generate:wasm']);}finally{runtime.dispose();if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;delete globalThis.sessionStorage;}});
// fm-lt2p: the candidate guarded the monolithic encoder by an iPhone label; admission is by capability now, and a bundle
// without the bounded encoder stream does not admit photo encoding on any device, still before any allocation.
test('A bundle without the bounded encoder stream refuses photo encoding before worker or alignment allocation',async()=>{const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',maxTouchPoints:5}});let allocations=0;const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),manifest:{...testManifest(),encoder:asset(7,1068862265)},alignPhoto:async()=>{allocations++;throw Error('Must not align');},workerFactory:()=>{allocations++;throw Error('Must not allocate');}});try{await assert.rejects(runtime.encodePhoto(new Blob(['synthetic-input'])),{name:'AdmissionRefused',reasonKey:'encoder-not-delivered'});assert.equal(allocations,0);}finally{runtime.dispose();if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;}});

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
  if(message.type==='grants')return; // fm-qrfz: a grant update has no reply
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
  const result=message.type==='encode-aligned'?{values:new Float32Array(9216).fill(.1),shape:[1,18,512],space:'w-plus',encoderProvider:'wasm',encoderQualification:{passed:true,manifestSha256:pin(8)}}
   :['generate','synthesize'].includes(message.type)?{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216).fill(.1),space:'w-plus',shape:[1,18,512]}
   :{deviceValidated:true};
  queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result}}));},
  terminate(){live--;lifecycle.push('terminate');}};};
 return createBrowserRuntime({manifestSha256:'0'.repeat(64),preferredRoute:'cpu',
  manifest:{...testManifest(),alignmentSha256:pin(9),encoderStream:{...asset(8,1024),sourceEncoderSha256:pin(7),preprocessingSha256:pin(9),phoneAdmitted:true,maxWasmBytes:268435456},...manifestExtra},
  alignPhoto:async()=>({tensor:new Float32Array(196608),faceCount:1,didAlign:true,alignmentWorkerTerminated:true,
   provenance:{preprocessingSha256:pin(9),facePolicy:'exactly-one-face-v1'}}),
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

test('raw face display completes before encoding; the file and exact cache become ready together',async()=>{
 const old=globalThis.indexedDB,fixture=indexedDbFixture();globalThis.indexedDB=fixture.api;
 let finishEncode,rawRequested=false;
 const encoder={acquire:async bytes=>({bytes}),encode:(slot,request)=>{assert.equal(slot.bytes,4*1024*1024);assert.equal(request.format,'webp');return new Promise(resolve=>finishEncode=()=>resolve({blob:new Blob(['compressed-original'],{type:'image/webp'})}));},dispose(){}};
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',imageEncoderFactory:()=>encoder,workerFactory:()=>({postMessage(message){let result={deviceValidated:true};if(message.type==='generate'){rawRequested=message.raw;result={rgba:new ArrayBuffer(4*1024*1024),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]};}queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result}}));},terminate(){}})});
 try{const face=await runtime.generate({mode:'seed',value:'123'},{raw:true});assert.equal(rawRequested,true);assert.equal(face.pixels.rgba.byteLength,4*1024*1024);assert.equal(face.blob,undefined);assert.equal(fixture.records.size,0);
 finishEncode();const completed=await face.fileReady;assert.equal(completed.blob.type,'image/webp');assert.equal(completed.pixels,undefined);assert.equal(completed.fileReady,undefined);assert.equal(fixture.records.size,2);
 const hit=await runtime.generate({mode:'seed',value:'123'},{raw:true});assert.equal(hit.cached,true);assert.equal(hit.imageSha256,completed.imageSha256);
 }finally{runtime.dispose();globalThis.indexedDB=old;}
});
test('raw frame credit waits for async consumers and rejects their failure without blaming inference',async()=>{
 let resolve,entered;const began=new Promise(r=>entered=r),acks=[];
 const worker={postMessage(message){if(message.type==='synthesize-frames')queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'frame',index:0,rgba:new ArrayBuffer(4*1024*1024)}}));else if(message.type==='raw-frame-ack'){acks.push(message.index);queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result:{frames:1}}}));}else queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result:{deviceValidated:true}}}));},terminate(){}};
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>worker});
 try{const frames=runtime.synthesizeFrames([{space:'w-plus',shape:[1,18,512],values:new Float32Array(9216)}],{raw:true,onFrame:()=>{entered();return new Promise(r=>resolve=r);}});await began;assert.equal(acks.length,0);resolve();assert.equal((await frames).frames,1);assert.deepEqual(acks,[0]);
 await assert.rejects(runtime.synthesizeFrames([{space:'w-plus',shape:[1,18,512],values:new Float32Array(9216)}],{raw:true,onFrame:async()=>{throw Error('consumer sentinel');}}),/consumer sentinel/);
 }finally{runtime.dispose();}
});
// fm-5klw (hosted android-emulator-chrome, runs 40274445309/40259019211/40187435942): the remaining canaries wait on
// the worker's background lane while a morph runs. The watchdog asks whether the worker has gone quiet, not whether
// that preempted canary has: frames arriving inside the stall window keep every pending operation alive.
function preemptingWorker({frames,gapMs,silent=false}){
 const w={postMessage(message){const send=data=>w.onmessage?.({data:{id:message.id,...data}}),done=result=>queueMicrotask(()=>send({type:'complete',result}));
  if(message.type==='initialize')return done({provider:message.provider});
  if(message.type==='qualify'&&message.resume)return; // preempted by the morph: it never reaches the front of the lane
  if(message.type==='qualify')return done({checks:[{name:'c0',passed:true}],provider:'wasm',deviceValidated:true,partial:true});
  if(message.type==='generate')return done({blob:new Blob(['mock-canonical-png'],{type:'image/png'}),values:new Float32Array(9216).fill(.25),space:'w-plus',shape:[1,18,512]});
  if(message.type==='synthesize-frames'){if(silent)return;let i=0;const next=()=>{if(i<frames){send({type:'frame',index:i++,blob:new Blob(['f'],{type:'image/png'})});setTimeout(next,gapMs);}else send({type:'complete',result:{frames}});};setTimeout(next,gapMs);return;}
  throw Error('unexpected operation '+message.type);},terminate(){}};
 return w;}
test('a morph longer than the stall window survives a preempted background canary; a silent worker still stops',async()=>{
 globalThis.sessionStorage=fakeStorage();
 const oldIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDbFixture().api;
 const latents=Array.from({length:8},()=>({space:'w-plus',shape:[1,18,512],values:new Float32Array(9216)}));
 const morph=async options=>{const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',stallMs:150,workerFactory:()=>preemptingWorker(options)});
  try{await runtime.generate({mode:'seed',value:'42'});const delivered=[];const result=await runtime.synthesizeFrames(latents,{onFrame:index=>delivered.push(index)});return {result,delivered};}finally{runtime.dispose();}};
 try{
  // 8 frames 60 ms apart: 480 ms in all, three stall windows, never 150 ms without a message.
  const {result,delivered}=await morph({frames:8,gapMs:60});
  assert.deepEqual(delivered,[0,1,2,3,4,5,6,7]);assert.equal(result.frames,8);
  await assert.rejects(morph({frames:8,gapMs:60,silent:true}),/stopped responding/,'a worker that says nothing for the stall window is still stopped');
 }finally{globalThis.indexedDB=oldIDB;}
});
// fm-qrfz: workers acquire under the app's grants. They travel with initialize and reach a live worker when an
// approval changes them; a runtime given none sends none, and the worker's manager then refuses what it lacks.
test('grants travel with initialize and reach a live worker when an approval changes them',async()=>{
 globalThis.sessionStorage=fakeStorage();
 const oldIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDbFixture().api;
 const seen=[];
 const worker=qualificationWorker(message=>seen.push({type:message.type,grants:message.grants}));
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>worker});
 try{
  const first={approved:null,local:{assets:[{sha256:'a'.repeat(64),bytes:1,priority:'foreground-required'}],remainingBytes:0,owners:['face:candidate-bridge']}};
  runtime.setGrants(first);
  await runtime.generate({mode:'seed',value:'42'});
  assert.deepEqual(seen.find(m=>m.type==='initialize').grants,first,'the worker starts with the current grants');
  const approved={...first,approved:{assets:[],remainingBytes:10,owners:['face:candidate-bridge']}};
  const before=seen.length;runtime.setGrants(approved);
  assert.deepEqual(seen.slice(before),[{type:'grants',grants:approved}],'an approval reaches the live worker at once');
  const settled=seen.length;runtime.setGrants(structuredClone(approved));
  assert.equal(seen.length,settled,'the same grants posted again reach no worker');
 }finally{runtime.dispose();globalThis.indexedDB=oldIDB;}
});

test('a confirmed-crop grant refusal reaches its caller and retries the same derived pixels after approval',async()=>{
 const oldBitmap=globalThis.createImageBitmap,oldCanvas=globalThis.OffscreenCanvas,oldIDB=globalThis.indexedDB;
 const size=32,pixels=new Uint8ClampedArray(size*size*4).fill(128);let decodes=0,encodes=0,approved=false;
 globalThis.indexedDB=indexedDbFixture().api;
 globalThis.createImageBitmap=async()=>{decodes++;return {width:size,height:size,close(){}};};
 globalThis.OffscreenCanvas=class{getContext(){return {drawImage(){},getImageData:()=>({width:size,height:size,data:pixels})};}};
 const workerFactory=()=>({postMessage(message){
  if(message.type==='grants')return;
  const respond=data=>queueMicrotask(()=>this.onmessage({data:{id:message.id,...data}}));
  if(message.type==='encode-aligned'){
   encodes++;
   if(!approved)return respond({type:'error',error:{name:'GrantRefused',message:'This download needs more data than was approved. Approve the download again to continue.'}});
   return respond({type:'complete',result:{values:new Float32Array(9216).fill(.1),shape:[1,18,512],space:'w-plus',encoderProvider:'wasm',encoderQualification:{passed:true,manifestSha256:pin(8)}}});
  }
  respond({type:'complete',result:message.type==='synthesize'?{blob:new Blob(['mock-png'],{type:'image/png'}),values:message.values,space:'w-plus',shape:[1,18,512]}:{deviceValidated:true}});
 },terminate(){}});
 const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory,
  manifest:{...testManifest(),alignmentSha256:pin(9),encoderStream:{...asset(8,1024),sourceEncoderSha256:pin(7),preprocessingSha256:pin(9),phoneAdmitted:true,maxWasmBytes:268435456}}});
 try{
  const file=await confirmCropped(new File(['confirmed-refusal'],'crop.png',{type:'image/png'}),size);
  await assert.rejects(runtime.encodePhoto(file,{raw:true}),{name:'GrantRefused',message:/Approve the download again/});
  const [slot]=runtime.cropSlots();assert.equal(slot.state,'failed');assert.ok(runtime.cropPixelRefs(slot.slotId)>0);
  assert.equal(runtime.status().deviceValidated,true,'a consent refusal does not invalidate the admitted route');
  const derivations=runtime.inspectCropQueue().derivations;
  approved=true;
  runtime.setGrants({approved:{approvalId:2,assets:[],remainingBytes:0,owners:['face:candidate-bridge']},local:null});
  const face=await runtime.encodePhoto(file,{raw:true});
  assert.equal(face.preprocessing.slotId,slot.slotId);assert.equal(face.preprocessing.attemptId,`${slot.slotId}.a2`);
  assert.equal(decodes,1);assert.equal(runtime.inspectCropQueue().derivations,derivations);assert.equal(encodes,2);
  assert.deepEqual(runtime.cropSlots(),[]);
 }finally{runtime.dispose();globalThis.createImageBitmap=oldBitmap;globalThis.OffscreenCanvas=oldCanvas;globalThis.indexedDB=oldIDB;}
});

const untilRuntime=async accept=>{const end=performance.now()+2000;while(!accept()){if(performance.now()>end)throw Error('Runtime protocol boundary not reached');await new Promise(resolve=>setTimeout(resolve,1));}};
test('independent explicit photo transfer survives synthesis and its cancellation; speculative preparation still stops',async()=>{
 for(const explicit of [true,false]){
  const owners=[];let finishPhoto;
  const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),preferredRoute:'cpu',
   manifest:{...testManifest(),encoderStream:{...asset(8,1024),sourceEncoderSha256:pin(7),preprocessingSha256:pin(9),phoneAdmitted:true,maxWasmBytes:268435456},alignmentSha256:pin(9)},
   workerFactory:()=>{
    const owner={terminated:false,postMessage(message){
     if(message.type==='prefetch'){finishPhoto=()=>this.onmessage({data:{id:message.id,type:'complete',result:{assets:1,acquired:1}}});return;}
     const result=message.type==='generate'?{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true};
     queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result}}));
    },terminate(){this.terminated=true;}};owners.push(owner);return owner;
   }});
  try{
   const photo=runtime.prefetch('photo',{explicit});await untilRuntime(()=>finishPhoto);
   await runtime.generate({mode:'seed',value:'121'});runtime.cancel();
   assert.equal(owners[0].terminated,!explicit,'only independently approved transfer keeps its worker');
   if(explicit)finishPhoto();
   assert.equal((await photo).started,explicit);assert.equal(owners[0].terminated,true,'finished preparation releases its worker');
  }finally{runtime.dispose();}
 }
});
test('private compute admission waits for all reads and tolerates a queued permit beyond the worker stall window',async()=>{
 let finishA,finishB,admit;const a=new Promise(resolve=>finishA=resolve),b=new Promise(resolve=>finishB=resolve),admission=new Promise(resolve=>admit=resolve);
 const events=[],replies=new Map();let token=0;
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',stallMs:50,workerFactory:()=>({
  postMessage(message){
   if(message.type==='compute-response'){const reply=replies.get(message.token);replies.delete(message.token);message.error?reply.reject(Object.assign(Error(message.error.message),{name:message.error.name})):reply.resolve();return;}
   const owner=this,ask=phase=>new Promise((resolve,reject)=>{const key=String(++token);replies.set(key,{resolve,reject});queueMicrotask(()=>owner.onmessage({data:{id:message.id,type:'compute-request',token:key,phase}}));});
   (async()=>{
    if(message.type==='initialize')return {deviceValidated:true};
    assert.equal(message.computeAdmission,true);
    const gate=createExecutionGate({acquire:()=>ask('acquire'),release:()=>ask('release')});
    try{
     if(message.type==='qualify')await Promise.all([gate.read(()=>a),gate.read(()=>b)]);
     return await gate.compute(async()=>{events.push(message.type);return message.type==='generate'?{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true};});
    }finally{gate.close();}
   })().then(result=>this.onmessage({data:{id:message.id,type:'complete',result}}));
  },terminate(){}})});
 let acquisitions=0,releases=0;
 runtime.setComputeAdmission({acquire:async()=>{acquisitions++;await admission;},release:async()=>{releases++;}});
 try{
  const result=runtime.generate({mode:'seed',value:'122'});
  finishA();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(acquisitions,0);
  finishB();await untilRuntime(()=>acquisitions===1);
  await new Promise(resolve=>setTimeout(resolve,230));assert.deepEqual(events,[],'worker cannot start before host permit even beyond the 200ms acquisition stall window');
  admit();await result;assert.deepEqual(events,['qualify','generate']);assert.equal(acquisitions,2);assert.equal(releases,2);
 }finally{admit();runtime.dispose();}
});
test('cancelling while a private admission is queued releases a late permit without restarting the worker',async()=>{
 let admit,asked=false,released=0,ran=false;
 const admission=new Promise(resolve=>admit=resolve);
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>({
  postMessage(message){
   if(message.type==='compute-response'){ran=true;return;}
   queueMicrotask(()=>this.onmessage({data:message.type==='qualify'?{id:message.id,type:'compute-request',token:'late',phase:'acquire'}:{id:message.id,type:'complete',result:{deviceValidated:true}}}));
  },terminate(){}})});
 runtime.setComputeAdmission({acquire:async()=>{asked=true;await admission;},release:async()=>{released++;}});
 try{
  const generation=runtime.generate({mode:'seed',value:'123'});const outcome=generation.catch(e=>e);
  await untilRuntime(()=>asked);runtime.cancel();assert.equal((await outcome).name,'AbortError');
  admit();await untilRuntime(()=>released===1);assert.equal(ran,false);
 }finally{admit();runtime.dispose();}
});

test('initial qualification grant refusal preserves Auto WebGPU and retries it only after a new decision',async()=>{
 const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldStorage=globalThis.sessionStorage;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter:async()=>({limits:SPEC_DEFAULT_LIMITS})}}});
 globalThis.sessionStorage=fakeStorage();const calls=[],events=[];let approved=false;
 const runtime=createBrowserRuntime({manifestSha256:'0'.repeat(64),manifest:testManifest(),onProgress:event=>events.push(event),workerFactory:()=>{let provider;return {
  postMessage(message){
   if(message.type==='initialize')provider=message.provider;calls.push(message.type+':'+provider);
   const error=message.type==='qualify'&&!approved?{name:'GrantRefused',message:'Approve the missing model bytes.'}:null;
   queueMicrotask(()=>this.onmessage({data:error?{id:message.id,type:'error',error}:{id:message.id,type:'complete',result:message.type==='generate'?{blob:new Blob(['controller-test-only'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true}}}));
  },terminate(){calls.push('terminate:'+provider);}
 };}});
 try{
  await assert.rejects(runtime.generate({mode:'seed',value:'3'}),{name:'GrantRefused'});
  assert.deepEqual(calls,['initialize:webgpu','qualify:webgpu','terminate:webgpu']);
  assert.ok(!events.some(event=>['route-refused','gpu-engine-fallback'].includes(event.stage)));
  approved=true;const result=await runtime.generate({mode:'seed',value:'3'});
  assert.equal(result.provenance.provider,'webgpu');
  assert.deepEqual(calls.slice(3),['initialize:webgpu','qualify:webgpu','generate:webgpu']);
 }finally{runtime.dispose();if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;if(oldStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldStorage;}
});

test('watchdog pauses a silent worker while hidden and gives a full stall window on becoming visible',async t=>{
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');let onVisibility,generating=false,settled=false;
 const document={hidden:true,addEventListener(type,listener){if(type==='visibilitychange')onVisibility=listener;}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 t.mock.timers.enable({apis:['setTimeout']});
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',stallMs:50,workerFactory:()=>({
  postMessage(message){if(message.type==='generate'){generating=true;return;}queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result:{deviceValidated:true}}}));},terminate(){}
 })});
 try{
  const outcome=runtime.generate({mode:'seed',value:'324'}).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  const end=performance.now()+5000;while(!generating){if(performance.now()>end)throw Error('worker never reached generation');await new Promise(setImmediate);}
  // Generate uses ACQUIRE_STALL = 4 * 50ms; neither hidden interval counts as visible silence.
  t.mock.timers.tick(200);t.mock.timers.tick(150);await Promise.resolve();assert.equal(settled,false);
  document.hidden=false;onVisibility();
  t.mock.timers.tick(199);await Promise.resolve();assert.equal(settled,false,'visibility return restarts the complete 200ms window');
  t.mock.timers.tick(1);assert.match((await outcome).message,/stopped responding/);
 }finally{runtime.dispose();t.mock.timers.reset();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;}
});

test('explicit photo preparation preserves a typed refusal for the revised decision instead of reporting ordinary offline setup',async()=>{
 const runtime=createBrowserRuntime({manifest:{...testManifest(),landmarks:asset(7)},manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>({
  postMessage(message){queueMicrotask(()=>this.onmessage({data:message.type==='prefetch'?{id:message.id,type:'error',error:{name:'GrantRefused',message:'Approve revised photo bytes.'}}:{id:message.id,type:'complete',result:{}}}));},terminate(){}
 })});
 try{await assert.rejects(runtime.prefetch('photo',{explicit:true}),{name:'GrantRefused',message:'Approve revised photo bytes.'});}finally{runtime.dispose();}
});

test('cancelling page preparation terminates only its worker while a seed operation continues',async()=>{
 let finishGenerate;const requests=[],workers=[];
 const runtime=createBrowserRuntime({manifest:testManifest(),manifestSha256:'0'.repeat(64),preferredRoute:'cpu',workerFactory:()=>{
  const worker={terminated:false,postMessage(message){requests.push(message.type);
   if(message.type==='prefetch')return;
   if(message.type==='generate'){finishGenerate=()=>this.onmessage({data:{id:message.id,type:'complete',result:{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216),space:'w-plus',shape:[1,18,512]}}});return;}
   queueMicrotask(()=>this.onmessage({data:{id:message.id,type:'complete',result:{deviceValidated:true}}}));
  },terminate(){this.terminated=true;}};workers.push(worker);return worker;
 }});
 try{
  const preparation=runtime.prefetch('route',{explicit:true});await untilRuntime(()=>requests.includes('prefetch'));
  const generation=runtime.generate({mode:'seed',value:'567'});await untilRuntime(()=>finishGenerate);
  runtime.cancelPrefetch();assert.equal(workers[0].terminated,true);assert.equal(workers[1].terminated,false);
  assert.equal((await preparation).started,false);finishGenerate();assert.equal((await generation).provenance.provider,'wasm');
 }finally{runtime.dispose();}
});
