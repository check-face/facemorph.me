import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{executeEncoderStream}from'./execute.mjs';
const original=JSON.parse(await readFile(new URL('assets/manifest.json',import.meta.url),'utf8'));
const tensor=new Float32Array(196608),available=()=>({available:true,shared:false,currentBytes:32*1024*1024});
let created=0,released=0,disposed=0;
const ort={Tensor:class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){disposed++;}},InferenceSession:{create:async()=>{created++;return{run:async()=>{throw Error('primary run failure');},release:async()=>{released++;throw Error('release also failed');}};}}};
const args={ort,manifest:original,tensor,acquireBytes:async step=>new Uint8Array(step.size),snapshotMemory:available};
await assert.rejects(executeEncoderStream(args),error=>error.message==='primary run failure'&&error.encoderStats.liveSessions===0&&error.encoderStats.cleanupErrors.length===1);
assert.equal(created,1);assert.equal(released,1);assert.equal(disposed,original.steps[0].inputs.length);
created=released=disposed=0;
await assert.rejects(executeEncoderStream({...args,snapshotMemory:()=>({available:false})}),error=>error.message.includes('memory could not be verified')&&error.encoderStats.liveSessions===0);
assert.equal(created,1);assert.equal(released,1);assert.equal(disposed,0);
await assert.rejects(executeEncoderStream({...args,snapshotMemory:()=>({available:true,shared:false,currentBytes:0})}),/memory could not be verified/);
const rawFailureOrt={...ort,InferenceSession:{create:async()=>({run:async()=>{throw null;},release:async()=>{}})}};
await assert.rejects(executeEncoderStream({...args,ort:rawFailureOrt}),error=>error.message==='null'&&error.encoderStats.liveSessions===0);
created=0;await assert.rejects(executeEncoderStream({...args,acquireBytes:async()=>new Uint8Array(1)}),/shard size mismatch/);assert.equal(created,0);
let acquired=0;await assert.rejects(executeEncoderStream({...args,manifest:{...original,maxShardBytes:128*1024*1024},acquireBytes:async()=>{acquired++;}}),/Unsupported streamed/);assert.equal(acquired,0);
const controller=new AbortController();controller.abort(Error('explicit cancellation'));await assert.rejects(executeEncoderStream({...args,signal:controller.signal,acquireBytes:async()=>{acquired++;}}),/explicit cancellation/);assert.equal(acquired,0);
// Cancellation can arrive while the final release is awaited. A tiny artificial
// schedule isolates that lifetime edge; this does not test model mathematics.
const finalAbort=new AbortController();let part=0;
const image={name:'image',dtype:'FLOAT',shape:[1,3,256,256]},w={name:'w',dtype:'FLOAT',shape:[1,18,512]};
const schedule={...original,maxShardBytes:1,maxLiveBoundaryBytes:823296,steps:Array.from({length:108},(_,id)=>({id,size:1,inputs:[image],outputs:id===107?[w]:[],releaseAfter:id===107?['image']:[],liveBoundaryBytesBeforeRelease:id===107?823296:786432}))};
const finalOrt={...ort,InferenceSession:{create:async()=>{const index=part++;return{run:async()=>index===107?{w:{type:'float32',dims:w.shape,getData:async()=>new Float32Array(9216),dispose(){}}}:{},release:async()=>{if(index===107)finalAbort.abort(Error('cancel during final release'));}};}}};
await assert.rejects(executeEncoderStream({...args,ort:finalOrt,manifest:schedule,signal:finalAbort.signal,acquireBytes:async()=>new Uint8Array(1)}),/cancel during final release/);
console.log('Stream admission, actual heap requirement, primary-error preservation, per-resource release and prefetch cancellation passed.');
