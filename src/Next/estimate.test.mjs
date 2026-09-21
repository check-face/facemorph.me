// The estimate must come from measurement and must not appear before there is one.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {createEstimator, describeMs, isSlowJob, COLD_FACE_MS} from './estimate.mjs';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
test('Face time is measured from real work only, and frames come from the shared geometry',async()=>{
 // product-bridge reads its stage labels from stage-labels.mjs and its morph key from
 // morph-frames.mjs; inline both so the stripped harness defines the real implementations.
 const source=plain(await read('stage-labels.mjs'))+'\n'+plain(await read('morph-frames.mjs'))+'\n'+plain(await read('product-bridge.mjs'));
 let counter=0,synthesisMs=0;
 // The runtime reports what a face actually cost as `synthesis-complete`; the bridge records that
 // rather than timing its own call, because the call also contains acquisition and storage. On the
 // operator's phone those extras turned a 1,597 ms synthesis into "a face took 38 seconds".
 const service={setPreferredRoute(){},onProgress:()=>{},generate:async()=>{
  service.onProgress({stage:'synthesis-complete',elapsedMs:synthesisMs});
  return {blob:new Blob(['i'],{type:'image/png'}),cached:false,latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'t',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}};}};
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,Date,performance:{now:()=>Date.now()},
  URL:{createObjectURL:()=>'blob:'+ ++counter,revokeObjectURL(){}},
  fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),
  createBrowserRuntime:options=>{service.onProgress=options.onProgress;return service;},createDesktopRuntime:options=>{service.onProgress=options.onProgress;return service;},decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),
  saveFile:async()=>'Saved',GEOMETRY_VERSION:'t',createLatentPath:o=>({totalFrames:o.framesPerSegment*o.controls.length,frames:()=>[]}),
  videoWriter:()=>({initialize:async()=>{},dispose(){}}),diagnostics:{start(){},stage(){},finish(){},bundle(){}},window:{addEventListener(){}}});
 vm.runInContext(source+'\nglobalThis.run=execute;globalThis.faceMs=measuredFaceMs;globalThis.frames=plannedFrames;',ctx);
 assert.equal(ctx.faceMs(),null,'no estimate before this device has produced a face');
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};
 synthesisMs=638;await ctx.run(request);
 const measured=ctx.faceMs();
 assert.equal(measured,638,'the measurement is the synthesis the runtime reported, not the job around it');
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

// Estimate early, then correct with this device's own numbers (AGENTS.md, Performance Philosophy).
// Refusing to estimate until the device has proven itself leaves a visitor staring at an unbounded
// wait before a thirty-face job; never correcting leaves them with another machine's numbers.
test('a cold device gets its route prior, labelled as not measured here', () => {
  const estimator = createEstimator({route: () => 'webgpu'});
  assert.equal(estimator.measured(), false);
  assert.equal(estimator.faceMs(), COLD_FACE_MS.webgpu);
  assert.equal(estimator.predict({faces: 30}), COLD_FACE_MS.webgpu * 30);
});

test('the prior follows the admitted route, not an average across routes', () => {
  assert.equal(createEstimator({route: () => 'cpu'}).faceMs(), COLD_FACE_MS.cpu);
  assert.equal(createEstimator({route: () => 'webgl'}).faceMs(), COLD_FACE_MS.webgl);
  assert.notEqual(COLD_FACE_MS.cpu, COLD_FACE_MS.webgpu);
});

test('one real measurement on this device replaces the prior entirely', () => {
  const estimator = createEstimator({faceMs: () => 315, route: () => 'webgpu'});
  assert.equal(estimator.measured(), true);
  assert.equal(estimator.faceMs(), 315, 'the device outranks anything recorded elsewhere');
});

test('an unknown or unranked route yields no estimate rather than a made-up one', () => {
  assert.equal(createEstimator({route: () => 'quantum'}).faceMs(), null);
  assert.equal(createEstimator({}).faceMs(), null);
  assert.equal(createEstimator({}).predict({faces: 30}), null);
});
