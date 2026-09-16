import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
test('Explicit route selection preserves cache-first lookup without allocating a worker',async()=>{
 const source=plain(await read('browser/runtime.mjs'));let allocated=0;
 const saved={blob:new Blob(['original'],{type:'image/png'}),space:'w-plus',generationSha256:'hash',imageSha256:'hash',latentSha256:'hash',values:new Float32Array(9216)};
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,crypto:webcrypto,console,setTimeout,clearTimeout,JSON,openOriginals:async()=>({get:async()=>saved,close(){}}),digest:async()=> 'hash',generationIdentity:()=>({}),inputLatent:async()=>({identity:'seed'}),requireLatent:v=>v});vm.runInContext(source+'\nglobalThis.create=createBrowserRuntime;',ctx);
 const r=ctx.create({manifest:{schemaVersion:1,bundleVersion:'test',canaries:[{},{}]},manifestSha256:'0'.repeat(64),workerFactory:()=>{allocated++;throw Error('Must not allocate');}});r.setPreferredRoute('webgpu');assert.equal((await r.generate({mode:'seed',value:'3'})).cached,true);assert.equal(allocated,0);r.dispose();
});
test('Failure after committing faces returns their new URLs, not revoked previous UI state',async()=>{
 const source=plain(await read('product-bridge.mjs'));let counter=0;const revoked=[];
 const service={setPreferredRoute(){},generate:async()=>({blob:new Blob(['image'],{type:'image/png'}),latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'test',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}})};
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,URL:{createObjectURL:()=> 'blob:'+ ++counter,revokeObjectURL:u=>revoked.push(u)},fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),GEOMETRY_VERSION:'test',createLatentPath:()=>({totalFrames:2,frames:()=>[]}),videoWriter:()=>({initialize:async()=>{throw Error('codec sentinel');},dispose(){}}),diagnostics:{start(){},stage(){},finish(){}},window:{addEventListener(){}}});vm.runInContext(source+'\nglobalThis.run=execute;',ctx);
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};const first=await ctx.run(request);const failed=await ctx.run({...request,jobId:2,action:'morph'});
 assert.equal(failed.errorMessage,'codec sentinel');assert.equal(failed.faces.length,2);assert(first.faces.every(f=>revoked.includes(f.url)));assert(failed.faces.every(f=>!revoked.includes(f.url)));assert(failed.projectJson);
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
 const ctx=vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>now},setTimeout:()=>1,clearTimeout(){},navigator:{userAgent:'Safari iPhone',platform:'iPhone',language:'en-AU'},window:{dispatchEvent:e=>notices.push(e.detail)},CustomEvent:class{constructor(type,{detail}){this.detail=detail;}},fetch:(url,request)=>{posts.push(JSON.parse(request.body));return new Promise(resolve=>responses.push(resolve));}});
 vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);const d=ctx.d;
 d.start('private words');d.stage('synthesis',{photo:'private bytes'});assert.equal(posts.length,0);
 d.enable(true);d.stage('synthesis',{});assert.equal(posts.length,0,'No pre-consent run backlog');
 d.start('morph');d.stage('synthesis',{elapsedMs:123,photo:'PRIVATE_PHOTO',value:'PRIVATE_WORDS',latent:[42]});assert.equal(posts.length,2);assert(!JSON.stringify(posts).includes('PRIVATE'));assert(!JSON.stringify(posts).includes('latent'));const prior=posts[0].session;
 d.enable(false);d.enable(true);const before=notices.length;responses[0]({ok:true});responses[1]({ok:false});await Promise.resolve();await Promise.resolve();assert.equal(notices.length,before,'Old consent cannot report status under new session');
 d.start('faces');assert.notEqual(posts.at(-1).session,prior);d.enable(false);
});
