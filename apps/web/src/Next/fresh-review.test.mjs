import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^(?:import .*|export \{.*\} from .*);\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
test('Explicit route selection preserves cache-first lookup without allocating a worker',async()=>{
 const source=plain(await read('browser/runtime.mjs'));let allocated=0;
 const saved={blob:new Blob(['original'],{type:'image/png'}),space:'w-plus',generationSha256:'hash',imageSha256:'hash',latentSha256:'hash',values:new Float32Array(9216)};
 const ctx=vm.createContext({analytics:new Proxy({},{get:()=>()=>{}}),onJobEnd(){},OffscreenCanvas:class{},ArrayBuffer,Blob,Float32Array,paintRgba:(canvas,frame)=>{canvas.paints=(canvas.paints||0)+1;},AbortController,DOMException,crypto:webcrypto,console,setTimeout,clearTimeout,JSON,openOriginals:async()=>({get:async()=>saved,close(){}}),digest:async()=> 'hash',generationIdentity:()=>({}),inputLatent:async()=>({identity:'seed'}),requireLatent:v=>v});vm.runInContext(source+'\nglobalThis.create=createBrowserRuntime;',ctx);
 const r=ctx.create({manifest:{schemaVersion:1,bundleVersion:'test',canaries:[{},{}]},manifestSha256:'0'.repeat(64),workerFactory:()=>{allocated++;throw Error('Must not allocate');}});r.setPreferredRoute('webgpu');assert.equal((await r.generate({mode:'seed',value:'3'})).cached,true);assert.equal(allocated,0);r.dispose();
});
test('Committed faces survive video failure and export the current morph settings',async()=>{
 const source=plain(await read('morph-frames.mjs'))+'\n'+plain(await read('product-bridge.mjs'));let counter=0,savedProject;const revoked=[];
 const service={setPreferredRoute(){},generate:async()=>({blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'test',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}})};
 const ctx=vm.createContext({analytics:new Proxy({},{get:()=>()=>{}}),onJobEnd(){},OffscreenCanvas:class{},ArrayBuffer,Blob,Float32Array,paintRgba:(canvas,frame)=>{canvas.paints=(canvas.paints||0)+1;},AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,URL:{createObjectURL:()=> 'blob:'+ ++counter,revokeObjectURL:u=>revoked.push(u)},fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),saveFile:async blob=>{savedProject=JSON.parse(await blob.text());return 'Saved';},GEOMETRY_VERSION:'test',createLatentPath:()=>({totalFrames:2,frames:()=>[]}),videoWriter:()=>({initialize:async()=>{throw Error('codec sentinel');},dispose(){}}),diagnostics:{start(){},stage(){},finish(){},bundle(){}},labelFor:s=>s,loadedBytes:e=>Number.isFinite(e&&e.loaded)?e.loaded:0,window:{addEventListener(){}}});vm.runInContext(source+'\nglobalThis.run=execute;globalThis.saveProject=exportProject;',ctx);
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};const first=await ctx.run(request);const failed=await ctx.run({...request,jobId:2,action:'morph'});
 assert.equal(failed.errorMessage,'codec sentinel');assert.equal(failed.faces.length,2);assert(first.faces.every(f=>revoked.includes(f.url)));assert(failed.faces.every(f=>!revoked.includes(f.url)));assert(failed.projectJson);
 await ctx.saveProject({...request,kind:'full-smooth-ellipse',width:.7});assert.equal(savedProject.morph.kind,'full-smooth-ellipse');assert.equal(savedProject.morph.width,.7);
 await assert.rejects(ctx.saveProject({...request,inputs:[{...request.inputs[0],value:'new face'},request.inputs[1]]}),/Generate the changed faces/);
});
test('Morph frames go to the runtime in bounded windows and reach the writer in order',async()=>{
 const source=plain(await read('stage-labels.mjs'))+'\n'+plain(await read('morph-frames.mjs'))+'\n'+plain(await read('product-bridge.mjs'));let counter=0;
 const face=label=>({blob:new Blob([label],{type:'image/png'}),latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'test',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}});
 const batches=[],added=[];let single=0;
 const service={setPreferredRoute(){},generate:async request=>face('saved-'+request.value),synthesize:async()=>{single++;return face('single');},
  synthesizeFrames:async(latents,{onFrame})=>{batches.push(latents.length);for(let i=0;i<latents.length;i++){await Promise.resolve();onFrame(i,{blob:new Blob(['frame-'+latents[i].values[0]],{type:'image/png'})});}return {frames:latents.length};}};
 const total=40,path={totalFrames:total,*frames(){for(let index=0;index<total;index++)yield {index,visitId:index===0?'a':index===total-1?'b':null,values:new Float32Array(9216).fill(index)};}};
 const writer={initialize:async()=>({kind:'webcodecs'}),add:async(blob,index)=>{added.push([index,await blob.text()]);},finish:async()=>new Blob(['mp4'],{type:'video/mp4'}),dispose(){}};
 const ctx=vm.createContext({analytics:new Proxy({},{get:()=>()=>{}}),onJobEnd(){},OffscreenCanvas:class{},ArrayBuffer,Blob,Float32Array,paintRgba:(canvas,frame)=>{canvas.paints=(canvas.paints||0)+1;},AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,URL:{createObjectURL:()=> 'blob:'+ ++counter,revokeObjectURL(){}},fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),saveFile:async()=>'Saved',GEOMETRY_VERSION:'test',createLatentPath:()=>path,videoWriter:()=>writer,diagnostics:{start(){},stage(){},finish(){},bundle(){}},window:{addEventListener(){}}});vm.runInContext(source+'\nglobalThis.run=execute;',ctx);
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};
 await ctx.run(request);const result=await ctx.run({...request,jobId:2,action:'morph'});
 assert.ok(!result.errorMessage,result.errorMessage);assert.equal(single,0,'no frame takes the one-at-a-time path');
 assert.deepEqual(added.map(([index])=>index),Array.from({length:total},(_,i)=>i),'every frame, in order');
 assert.equal(added[0][1],'saved-1');assert.equal(added[total-1][1],'saved-2');assert.equal(added[7][1],'frame-7');
 assert.ok(batches.every(n=>n<=16),'windows are bounded');assert.equal(batches.reduce((a,b)=>a+b,0),total-2,'saved faces are not synthesized again');
});
import {videoWriter} from './media.mjs';
test('Video worker startup/message failures and preabort terminate promptly',async()=>{
 const original=globalThis.Worker;let worker;globalThis.Worker=class{constructor(){worker=this;}postMessage(){throw Error('post sentinel');}terminate(){this.terminated=true;}};
 try{let w=videoWriter({codec:{}});await assert.rejects(w.initialize(),/post sentinel/);assert(worker.terminated);w.dispose();
 const c=new AbortController();c.abort();w=videoWriter({codec:{},signal:c.signal});assert(worker.terminated);await assert.rejects(w.initialize(),{name:'AbortError'});
 globalThis.Worker=class{constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}};w=videoWriter({codec:{}});const pending=w.initialize();worker.onmessageerror();await assert.rejects(pending,/unreadable/);assert(worker.terminated);
 }finally{globalThis.Worker=original;}
});
test('Diagnostics require fresh opt-in, strip private fields, and ignore old-consent responses',async()=>{
 const source=plain(await read('reporting.mjs')),posts=[],notices=[],responses=[];let now=2000;
 const ctx=vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>now},setTimeout:()=>1,clearTimeout(){},navigator:{userAgent:'Safari iPhone',platform:'iPhone',language:'en-AU'},window:{dispatchEvent:e=>notices.push(e.detail)},CustomEvent:class{constructor(type,{detail}){this.detail=detail;}},fetch:(url,request)=>{const parsed=JSON.parse(request.body);const {events,...common}=parsed;if(Array.isArray(events))for(const e of events)posts.push({...common,...e});else posts.push(parsed);return new Promise(resolve=>responses.push(resolve));}});
 vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);const d=ctx.d;
 d.start('private words');d.stage('synthesis',{photo:'private bytes'});assert.equal(posts.length,0,'nothing is uploaded before consent');
 // Operator decision, 17 September: what happened before consent is staged on the device and sent
 // only if the tester later agrees, so a failure can still be explained after the fact. The
 // property that matters is unchanged: no upload without a yes.
 d.enable(true);const backlog=posts.length;assert(backlog>0,'saying yes sends what was staged');
 assert(!JSON.stringify(posts).includes('private'),'the staged records carry no private fields');
 d.start('morph');d.stage('synthesis',{elapsedMs:123,photo:'PRIVATE_PHOTO',value:'PRIVATE_WORDS',latent:[42]});d.flush();assert.equal(posts.length,backlog+2);assert(!JSON.stringify(posts).includes('PRIVATE'));assert(!JSON.stringify(posts).includes('latent'));const prior=posts[0].session;
 d.enable(false);d.enable(true);const before=notices.length;responses[0]({ok:true});responses[1]({ok:false});await Promise.resolve();await Promise.resolve();assert.equal(notices.length,before,'Old consent cannot report status under new session');
 d.start('faces');d.bundle('a'.repeat(64));/* start is deferred until the bundle digest is known */d.flush();assert.notEqual(posts.at(-1).session,prior);d.enable(false);
});
test('Opt-in reporting survives reload and only a deliberate turn-off stops it',async()=>{
 const source=plain(await read('reporting.mjs')),stored=new Map();
 const context=notices=>vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},navigator:{userAgent:'Safari iPhone',platform:'iPhone',language:'en-AU'},window:{dispatchEvent:e=>notices.push(e.detail.status)},CustomEvent:class{constructor(type,{detail}){this.detail=detail;}},fetch:async()=>({ok:true})});
 // A page that never opted in must not restore reporting.
 let notices=[];let ctx=context(notices);vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);
 assert.equal(ctx.d.restore(),false);assert.equal(ctx.d.status().enabled,false);assert.deepEqual(notices,[]);
 ctx.d.enable(true);assert.equal(ctx.d.status().enabled,true);
 // A later page load restores the stored opt-in without asking again.
 notices=[];ctx=context(notices);vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);
 assert.equal(ctx.d.status().enabled,false,'Consent is inert until it is restored');
 assert.equal(ctx.d.restore(),true);assert.equal(ctx.d.status().enabled,true);assert.deepEqual(notices,['enabled']);
 assert.equal(ctx.d.restore(),false,'Restoring twice does not reset the session');
 // Turning it off is the only thing that stops it, and it does not come back.
 ctx.d.enable(false);assert.equal(ctx.d.status().enabled,false);
 notices=[];ctx=context(notices);vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);
 assert.equal(ctx.d.restore(),false);assert.equal(ctx.d.status().enabled,false);assert.deepEqual(notices,[]);
});
test('Measured stages bypass progress throttling; build and device identity remain bounded and opt-in',async()=>{
 // Match DefinePlugin substitution while omitting Node's process from the browser context.
 const source=plain(await read('reporting.mjs')).replaceAll('process.env.FACEMORPH_BUILD_ID',JSON.stringify('next-reviewed-build'));
 const posts=[],stored=new Map([['facemorph-debug-device-v1','-'.repeat(36)]]);let reads=0,writes=0,consentWrites=0,now=2000;
 const ctx=vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>now},setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>{if(k!=='facemorph-debug-consent-v1')reads++;return stored.get(k);},setItem:(k,v)=>{if(k==='facemorph-debug-consent-v1')consentWrites++;else writes++;stored.set(k,v);},removeItem:k=>{stored.delete(k);}},navigator:{userAgent:'Version/26.1 Safari iPhone',platform:'iPhone',language:'en-AU'},window:{dispatchEvent(){}},CustomEvent:class{},fetch:async(url,request)=>{assert.equal(url,'https://next.facemorph.me/diagnostics/events');assert.equal(request.headers['X-Facemorph-Diagnostics-Consent'],'session-v1');const parsed=JSON.parse(request.body);const {events,...common}=parsed;if(Array.isArray(events))for(const e of events)posts.push({...common,...e});else posts.push(parsed);return {ok:true};}});
 vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);const d=ctx.d;d.start('faces');d.stage('model-loaded',{elapsedMs:5});assert.equal(reads,0);assert.equal(writes,0);assert.equal(posts.length,0);
 d.enable(true);const flushed=posts.length;d.bundle('a'.repeat(64));d.start('faces','webgpu');d.stage('asset-acquisition',{loaded:1});d.stage('asset-acquisition',{loaded:2});d.stage('model-loaded',{elapsedMs:12.4,photo:'private'});d.stage('synthesis-complete',{elapsedMs:5.6});d.flush();
 assert.deepEqual(posts.slice(flushed).map(p=>p.stage||p.event),['start','asset-acquisition','model-loaded','synthesis-complete']);assert.equal(posts[flushed+2].stageMs,12);assert.equal(posts[flushed+3].stageMs,6);assert.equal(posts[flushed].build,'next-reviewed-build');assert.equal(posts[flushed].browserMajor,26);assert.equal(posts[flushed].bundle,'a'.repeat(64));assert.equal(posts[flushed].provider,'webgpu');
 assert.match(posts[flushed].device,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(writes,1);assert.equal(consentWrites,1);assert.equal(JSON.parse(stored.get('facemorph-debug-consent-v1')).choice,'on');assert(!JSON.stringify(posts).includes('private'));d.enable(false);assert.equal(JSON.parse(stored.get('facemorph-debug-consent-v1')).choice,'off','Turning reporting off replaces the stored opt-in with a recorded no');assert.equal(stored.has('facemorph-debug-device-v1'),false,'and forgets the device id');const count=posts.length;d.stage('encoding-complete',{elapsedMs:10});d.flush();assert.equal(posts.length,count);
});

// These tests hold actual bridge operations open across edits, rather than checking source text.
async function bridgeContext({generate,writer,readLast,fetchManifest,identity}={}){
 const service={setPreferredRoute(){},generate:generate|| (async request=>({blob:new Blob([request.value],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)},provenance:{bundleVersion:'test',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}}))};
 let count=0;
 const ctx=vm.createContext({analytics:new Proxy({},{get:()=>()=>{}}),onJobEnd(){},OffscreenCanvas:class{},ArrayBuffer,Blob,Float32Array,paintRgba:(canvas,frame)=>{canvas.paints=(canvas.paints||0)+1;},AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,
 URL:{createObjectURL:()=>`blob:${++count}`,revokeObjectURL(){}},
 fetch:async()=>({ok:true,json:async()=>fetchManifest||{},arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),
 createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),GEOMETRY_VERSION:'test',
 diagnostics:{start(){},stage(){},finish(){},bundle(){}},labelFor:s=>s,loadedBytes:e=>e.loaded||0,window:{addEventListener(){}},readLast:readLast||(async()=>null),generationIdentity:()=>identity||{},digest:async()=> 'hash',
 videoWriter:()=>writer,createLatentPath:m=>({totalFrames:32,*frames(){for(let index=0;index<32;index++)yield {index,segment:Math.floor(index/16),u:(index%16)/16,values:new Float32Array(9216).fill(index)};},sample:(segment,u)=>new Float32Array(9216).fill(segment*16+u*16)}),infillFrames:(await import('./infill.mjs')).infillFrames,
 frameStoreGet:async()=>null,frameStoreGetOne:async(key,index)=>ctx.retained.get(index),frameStoreKey:async()=> 'frames',retained:new Map()});
 vm.runInContext(plain(await read('stage-labels.mjs'))+'\n'+plain(await read('product-bridge.mjs'))+'\nglobalThis.run=execute;globalThis.invalidate=invalidateFace;globalThis.restore=restoreLastResult;globalThis.arrivalChange=invalidateArrivalRestore;',ctx);
 return ctx;
}
const singleRequest=(id,value)=>({jobId:1,action:'face',target:id,provider:'cpu',inputs:[{id,mode:'seed',value}],kind:'linear',width:0,pinch:false,frames:16,fps:16});
test('editing/removing an in-flight face discards its result and retains an unrelated completed face',async()=>{
 let resolve,started;const began=new Promise(r=>started=r);
 const face={blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)}};
 const ctx=await bridgeContext({generate:async request=>{if(request.value==='2'){started();return new Promise(r=>resolve=r);}return face;}});
 assert.equal((await ctx.run(singleRequest('a','1'))).faces.length,1);
 const pending=ctx.run({...singleRequest('b','2'),jobId:2});await began;ctx.invalidate('b');resolve(face);
 const result=await pending;assert.deepEqual(Array.from(result.faces,f=>f.id),['a']);assert.match(result.message,/Cancelled/);
});
test('a repeated single face preserves its download and skips all generation work',async()=>{
 let generated=0,encoded=0;const downloads=[];
 const ctx=await bridgeContext({generate:async()=>{generated++;return {blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)}};}});
 ctx.downloadImage=async()=>{encoded++;return new Blob(['download'],{type:'image/webp'});};ctx.saveFile=async blob=>{downloads.push(blob);return 'Saved';};
 vm.runInContext('globalThis.save=saveMedia;',ctx);
 const request=singleRequest('a','1');await ctx.run(request);await ctx.save('a');
 await ctx.run(request);await ctx.save('a');
 assert.equal(generated,1);assert.equal(encoded,1);assert.equal(downloads[0],downloads[1]);
 ctx.invalidate('a');await ctx.run(singleRequest('a','2'));await ctx.save('a');
 assert.equal(generated,2);assert.equal(encoded,2);assert.notEqual(downloads[1],downloads[2]);
});
test('single raw face remembrance waits for encoding and refuses a superseded result',async()=>{
 let complete;const remembered=[];
 const result={blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)}};
 const ctx=await bridgeContext({generate:async()=>({...result,blob:undefined,pixels:{rgba:new ArrayBuffer(4*1024*1024)},fileReady:new Promise(resolve=>{complete=resolve;})})});
 ctx.rememberLast=async face=>remembered.push(face);
 await ctx.run(singleRequest('a','1'));assert.equal(remembered.length,0);complete(result);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(remembered.length,1);assert.equal(remembered[0].blob,result.blob);
 await ctx.run(singleRequest('b','2'));ctx.invalidate('b');complete(result);await new Promise(resolve=>setImmediate(resolve));assert.equal(remembered.length,1);
});
test('arrival restoration cannot publish after an input interaction during slow storage',async()=>{
 let resolve;const ctx=await bridgeContext({readLast:()=>new Promise(r=>resolve=r),fetchManifest:{modelSourceSha256:'m',noiseSha256:'n'}});
 const restoring=ctx.restore();ctx.arrivalChange();resolve({result:{blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)},provenance:{modelSha256:'m',noiseSha256:'n'}},generationKind:'seed',generationSha256:'hash',settings:{}});
 assert.equal(await restoring,null);
});
test('infill availability remains sparse and video encoding drains in canonical order',async()=>{
 const available=[],encoded=[];let ctx;
 const writer={initialize:async()=>{},retain:async(blob,index)=>{available.push(index);ctx.retained.set(index,blob);return blob;},add:async(blob,index)=>{encoded.push(index);},finish:async()=>new Blob(['video'],{type:'video/mp4'}),dispose(){}};
 ctx=await bridgeContext({writer});
 // Exercise the one-at-a-time runtime fallback with real endpoint/midpoint/quarter indices.
 vm.runInContext('globalThis.__service=engine;',ctx);const runtime=await ctx.__service();runtime.synthesize=async()=>({blob:new Blob(['frame'],{type:'image/png'})});
 const request={...singleRequest('a','1'),action:'morph',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}]};
 const result=await ctx.run(request);assert.equal(result.errorMessage,'');assert.deepEqual(available.slice(0,4),[0,16,8,24]);assert.deepEqual(encoded,Array.from({length:32},(_,i)=>i));assert.equal(new Set(available).size,32);
});

test('raw video preserves four sparse anchors, streams the rest in canonical order, and never queues a full raw morph',async()=>{
 const available=[],encoded=[],rawBatches=[];let ctx,inFlight=0,peak=0;
 const writer={initialize:async()=>{},retain:async(blob,index)=>{available.push(index);ctx.retained.set(index,blob);return blob;},retainRaw:async(frame,index)=>{const blob=new Blob(['anchor'],{type:'image/png'});available.push(index);ctx.retained.set(index,blob);return blob;},addRaw:async(frame,index)=>{inFlight++;peak=Math.max(peak,inFlight);await Promise.resolve();encoded.push(index);available.push(index);inFlight--;return new Blob(['preview']);},add:async(blob,index)=>encoded.push(index),finish:async()=>new Blob(['video'],{type:'video/mp4'}),dispose(){}};
 ctx=await bridgeContext({writer});vm.runInContext('globalThis.__service=engine;',ctx);const runtime=await ctx.__service();
 runtime.synthesize=async()=>({rgba:new ArrayBuffer(4*1024*1024)});
 runtime.synthesizeFrames=async(latents,options)=>{assert.equal(options.raw,true);rawBatches.push(latents.length);for(let i=0;i<latents.length;i++)await options.onFrame(i,{rgba:new ArrayBuffer(4*1024*1024)});};
 const result=await ctx.run({...singleRequest('a','1'),action:'morph',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}]});assert.equal(result.errorMessage,'');assert.deepEqual(available.slice(0,4),[0,16,8,24]);assert.deepEqual(encoded,Array.from({length:32},(_,i)=>i));assert.equal(new Set(available).size,32);assert.equal(peak,1);assert.equal(rawBatches.reduce((a,b)=>a+b),28);
});

test('consumed raw face remains repeatable and a reused canvas paints the new face revision',async()=>{
 const completed={blob:new Blob(['canonical'],{type:'image/png'}),latent:{space:'w-plus',values:new Float32Array(9216)}};
 const ctx=await bridgeContext({generate:async()=>({...completed,blob:undefined,pixels:{rgba:new ArrayBuffer(4*1024*1024)},fileReady:Promise.resolve(completed)})});
 vm.runInContext('globalThis.draw=drawFace;',ctx);const canvas={dataset:{}};
 const first=await ctx.run(singleRequest('a','1'));assert.equal(first.errorMessage,'');assert.equal(first.faces[0].raw,true);ctx.draw(canvas,'a');assert.equal(canvas.paints,1);
 assert.equal((await ctx.run(singleRequest('a','1'))).errorMessage,'');assert.equal(canvas.paints,1,'a repeated request remains usable after consuming the raw pixels');
 await ctx.run(singleRequest('a','2'));ctx.draw(canvas,'a');assert.equal(canvas.paints,2,'same canvas must not retain old pixels');
});
