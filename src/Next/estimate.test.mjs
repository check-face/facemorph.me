// The estimate must come from measurement and must not appear before there is one.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {createEstimator,describeMs,isSlowJob} from './estimate.mjs';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
test('Face time is measured from real work only, and frames come from the shared geometry',async()=>{
 // product-bridge reads its stage labels from stage-labels.mjs and its morph key from
 // morph-frames.mjs; inline both so the stripped harness defines the real implementations.
 const source=plain(await read('stage-labels.mjs'))+'\n'+plain(await read('morph-frames.mjs'))+'\n'+plain(await read('product-bridge.mjs'));
 let counter=0,slow=false;
 const service={setPreferredRoute(){},generate:async()=>{const at=Date.now();while(slow&&Date.now()-at<25);return {blob:new Blob(['i'],{type:'image/png'}),cached:false,latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'t',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}};}};
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,Date,performance:{now:()=>Date.now()},
  URL:{createObjectURL:()=>'blob:'+ ++counter,revokeObjectURL(){}},
  fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),
  createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),
  saveFile:async()=>'Saved',GEOMETRY_VERSION:'t',createLatentPath:o=>({totalFrames:o.framesPerSegment*o.controls.length,frames:()=>[]}),
  videoWriter:()=>({initialize:async()=>{},dispose(){}}),diagnostics:{start(){},stage(){},finish(){},bundle(){}},window:{addEventListener(){}}});
 vm.runInContext(source+'\nglobalThis.run=execute;globalThis.faceMs=measuredFaceMs;globalThis.frames=plannedFrames;',ctx);
 assert.equal(ctx.faceMs(),null,'no estimate before this device has produced a face');
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};
 slow=true;await ctx.run(request);
 const measured=ctx.faceMs();
 assert(measured>0,'a real face produces a measurement');
 assert.equal(ctx.frames({...request}),32,'frames come from the same geometry the morph renders');
});
test('The estimator predicts only from measurement and speaks the slow-run warning, never a block',()=>{
 const unmeasured=createEstimator({faceMs:()=>null,frameMs:()=>null});
 assert.equal(unmeasured.faceMs(),null);
 assert.equal(unmeasured.frameMs(),null,'no frame figure before this device has produced work');
 assert.equal(unmeasured.predict({faces:2,frames:26}),null,'no prediction without a measurement');
 assert.equal(unmeasured.remaining({facesLeft:1,framesLeft:10}),null);
 const measured=createEstimator({faceMs:()=>1000,frameMs:()=>500});
 assert.equal(measured.predict({faces:2,frames:26}),15000,'faces and frames are priced separately');
 assert.equal(measured.remaining({facesLeft:1,framesLeft:10}),6000,'remaining work is priced from the same medians');
 const faceOnly=createEstimator({faceMs:()=>1000,frameMs:()=>null});
 assert.equal(faceOnly.frameMs(),1000,'a frame is one synthesis too: fall back to the face figure');
 assert.equal(describeMs(75*1000),'about 75 seconds');
 assert.equal(describeMs(90*1000),'about 2 minutes');
 assert.equal(isSlowJob(30000),false,'exactly at the threshold is not slow');
 assert.equal(isSlowJob(30001),true,'just over it warns');
});
