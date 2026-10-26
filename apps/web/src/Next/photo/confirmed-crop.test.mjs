// crop.fix (fm-6ib8): a confirmed crop goes to e4e directly. The real runtime composition (createBrowserRuntime with
// a counting detector and a recording worker) takes confirmed files through the confirmed-crop policy's single
// derivation with zero detector calls, exactly one e4e attempt, and one closed-set terminal error when it cannot
// finish; detector outcomes after OK cannot reopen the crop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveEncoderInput} from '@facemorph/stylegan-js';
import {createBrowserRuntime} from '../browser/runtime.mjs';
import {confirmCropped,confirmedCropOf,encoderInputFor,ConfirmedCropError} from './confirmed-crop.mjs';

const SIZE=32;
const pin=n=>String(n).repeat(64),asset=(n,size=4)=>({url:`https://model.example/asset-${n}`,sha256:pin(n),size});
const manifest=()=>({schemaVersion:1,bundleVersion:'test-controller-only',modelSourceSha256:pin(1),noiseSha256:pin(2),canaries:[{},{}],
 synthesis:asset(3),mapping:asset(4),average:asset(5),noise:[{...asset(6),name:'noise_0',shape:[1]}],webgpu:{},alignmentSha256:pin(9),
 encoderStream:{...asset(8,1024),sourceEncoderSha256:pin(7),preprocessingSha256:pin(9),phoneAdmitted:true,maxWasmBytes:268435456}});

// Decoded pixels of a confirmed file: Node has no image decoder, so the test supplies the browser's two calls.
const pixels=new Uint8ClampedArray(SIZE*SIZE*4).map((_,i)=>i%4===3?255:(i*37)%251);
let decodes=0,decodeFails=false;
globalThis.createImageBitmap=async()=>{decodes++;if(decodeFails)throw new DOMException('bad image','InvalidStateError');return {width:SIZE,height:SIZE,close(){}};};
globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage(){},getImageData:(x,y,w,h)=>({width:w,height:h,data:pixels})};}};

function detector(kind){
 const calls={n:0};
 const failures={thrown:()=>{throw Error('detector crashed');},timeout:()=>{throw Error('Local photo preparation stopped responding.');},
  'zero-faces':()=>{throw Object.assign(Error('No face was found. Choose a clear photo containing one face.'),{code:'no-face',faceDetection:true});},
  'several-faces':()=>{throw Object.assign(Error('More than one face was found. Choose a photo containing only one face.'),{code:'multiple-faces',faceDetection:true});}};
 return {calls,alignPhoto:kind==='not-run'?undefined:async()=>{calls.n++;(failures[kind]||(()=>{}))();
  return {tensor:new Float32Array(196608),faceCount:1,didAlign:true,alignmentWorkerTerminated:true,provenance:{preprocessingSha256:pin(9),facePolicy:'exactly-one-face-v1'}};}};
}
function runtime({kind='ok',encodeFails=null}={}){
 const posted=[],tensors=[];const {calls,alignPhoto}=detector(kind);
 const workerFactory=()=>({postMessage(message){posted.push(message.type);if(message.type==='encode-aligned')tensors.push(message.tensor);
  const fail=message.type==='encode-aligned'&&encodeFails;
  const result=message.type==='encode-aligned'?{values:new Float32Array(9216).fill(.1),shape:[1,18,512],space:'w-plus',encoderProvider:'wasm',encoderQualification:{passed:true,manifestSha256:pin(8)}}
   :['generate','synthesize'].includes(message.type)?{blob:new Blob(['mock-png'],{type:'image/png'}),values:new Float32Array(9216).fill(.1),space:'w-plus',shape:[1,18,512]}:{deviceValidated:true};
  queueMicrotask(()=>this.onmessage({data:fail?{id:message.id,type:'error',error:{name:encodeFails,message:'encoder failed'}}:{id:message.id,type:'complete',result}}));},terminate(){}});
 const rt=createBrowserRuntime({manifestSha256:'0'.repeat(64),preferredRoute:'cpu',manifest:manifest(),alignPhoto,workerFactory});
 return {rt,posted,tensors,calls,encodes:()=>posted.filter(t=>t==='encode-aligned').length};
}
const withNavigator=async fn=>{const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0'}});
 try{return await fn();}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}};
const confirmed=async(label='approved')=>confirmCropped(new File([label],'cropped.png',{type:'image/png'}),SIZE);

test('crop-fix.no-redetect-after-ok: zero detector calls, one e4e attempt on the policy tensor',()=>withNavigator(async()=>{
 const file=await confirmed(),{rt,calls,encodes,tensors}=runtime();
 try{
  const face=await rt.encodePhoto(file,{raw:true});
  assert.equal(calls.n,0);assert.equal(encodes(),1);assert.equal(face.didAlign,false);
  const want=deriveEncoderInput({width:SIZE,height:SIZE,data:pixels},confirmedCropOf(file));
  assert.equal(face.preprocessing.tensorDigest,want.tensorDigest);assert.equal(face.preprocessing.confirmedCropId,confirmedCropOf(file).confirmedCropId);
  assert.deepEqual(Array.from(tensors[0].subarray(0,64)),Array.from(want.tensor.subarray(0,64)));
 }finally{rt.dispose();}
}));

test('crop-fix.one-attempt-or-error: one e4e attempt, then one closed-set terminal error',()=>withNavigator(async()=>{
 for(const [name,code] of [['Error','encoder-unavailable'],['ShardInvalidated','encoder-invalidated']]){
  const file=await confirmed(name),{rt,encodes,calls}=runtime({encodeFails:name});
  try{await assert.rejects(rt.encodePhoto(file,{raw:true}),e=>e instanceof ConfirmedCropError&&e.code===code&&e.message.length>20);assert.equal(encodes(),1);assert.equal(calls.n,0);}
  finally{rt.dispose();}
 }
 decodeFails=true;
 const file=await confirmed('unreadable'),{rt,encodes}=runtime();
 try{await assert.rejects(rt.encodePhoto(file,{raw:true}),{name:'ConfirmedCropError',code:'unsupported-pixels'});assert.equal(encodes(),0);}
 finally{rt.dispose();decodeFails=false;}
}));

test('crop-fix.detector-failure-no-reopen: no detector outcome reaches a confirmed crop',()=>withNavigator(async()=>{
 for(const kind of ['thrown','timeout','zero-faces','several-faces','not-run']){
  const file=await confirmed(kind),{rt,calls,encodes}=runtime({kind});
  try{const face=await rt.encodePhoto(file,{raw:true});assert.equal(calls.n,0,kind);assert.equal(encodes(),1,kind);assert.equal(face.faceCount,null);}
  finally{rt.dispose();}
 }
 // The bridge reopens the crop only on the typed detection outcome, which only a detector run (before OK) raises.
 const bridge=await readFile(new URL('../product-bridge.mjs',import.meta.url),'utf8');
 assert.match(bridge,/cropFace:[^;]*error\?\.faceDetection===true/);
}));

test('crop-fix.not-run-not-failure: with no detector installed a confirmed crop still encodes',()=>withNavigator(async()=>{
 const file=await confirmed('no-detector'),{rt,encodes}=runtime({kind:'not-run'});
 try{const face=await rt.encodePhoto(file,{raw:true});assert.equal(encodes(),1);assert.ok(face.blob instanceof Blob);}finally{rt.dispose();}
 // An unconfirmed photo without a detector is refused as before: proposal needs the detector.
 const {rt:other,encodes:none}=runtime({kind:'not-run'});
 try{await assert.rejects(other.encodePhoto(new Blob(['raw-photo'],{type:'image/png'})));assert.equal(none(),0);}finally{other.dispose();}
}));

test('crop-fix.explicit-adjust-reopens: Adjust Crop makes a new frozen record; the old one is unchanged',async()=>{
 const first=await confirmed('same'),again=await confirmed('same'),a=confirmedCropOf(first),b=confirmedCropOf(again);
 assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.rect));assert.throws(()=>{'use strict';a.rect.left=1;});
 assert.equal(a.sourceDigest,b.sourceDigest);assert.ok(b.sourceRevision>a.sourceRevision);assert.notEqual(a.confirmedCropId,b.confirmedCropId);
});

test('crop-fix.cancel-before-ok: a photo never confirmed has no record and an aborted run posts no e4e or keypoints',()=>withNavigator(async()=>{
 assert.equal(confirmedCropOf(new File(['preview-only'],'p.png')),undefined);
 const file=await confirmed('cancelled'),{rt,posted,calls}=runtime(),controller=new AbortController();controller.abort();
 try{await assert.rejects(rt.encodePhoto(file,{signal:controller.signal}),{name:'AbortError'});}finally{rt.dispose();}
 assert.equal(posted.filter(t=>t==='encode-aligned').length,0);assert.equal(calls.n,0);
}));

test('crop-fix.stale-revision: each confirmation is its own identity, and a retry reuses the kept derivation',()=>withNavigator(async()=>{
 const older=await confirmed('rev'),newer=await confirmed('rev'),{rt}=runtime();
 try{
  const a=await rt.encodePhoto(older,{raw:true}),b=await rt.encodePhoto(newer,{raw:true});
  assert.notEqual(a.cacheKey,b.cacheKey);assert.notEqual(a.preprocessing.confirmedCropId,b.preprocessing.confirmedCropId);
  const before=decodes;assert.equal(await encoderInputFor(older),await encoderInputFor(older));assert.equal(decodes,before);
 }finally{rt.dispose();}
}));

test('crop-fix source scan: no control flow keyed on detector error text in the bridge or the runtime',async()=>{
 for(const file of ['../product-bridge.mjs','../browser/runtime.mjs']){
  const text=await readFile(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(text,/No face was found|More than one face was found|MULTIPLE_FACES_MESSAGE/,file);
 }
});
