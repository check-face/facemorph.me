// Tests for the morph-frame store (C-06/C-06p): persistence keyed by morph identity, reload
// survival, quota-exceeded degradation to memory-only, LRU eviction of whole morphs, and the
// canonical key derivation shared with product-bridge's morphFramesKey().
import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {openFrameStore,frameStorePut,frameStoreGet,frameStoreGetDisplay,frameStoreKey,frameKey,frameStoreEstimateQuota,frameStoreStatus} from './morph-frames.mjs';
import {GEOMETRY_VERSION} from './geometry/latent-path.mjs';
globalThis.crypto??=webcrypto;

// Minimal IndexedDB: two object stores, async requests, injected write failures.
function fakeIndexedDB({failOpen=false,failPutFrom=null,putErrorName='QuotaExceededError'}={}){
 const data={frames:new Map(),morphs:new Map()};let writes=0;
 const Request=class{constructor(run){this.pending=true;queueMicrotask(()=>{try{this.result=run();this.onsuccess?.();}catch(error){this.error=error;this.onerror?.();}});}};
 const db={objectStoreNames:{contains:name=>name==='frames'||name==='morphs'},close(){},
  transaction(names,mode){const tx={oncomplete:null,onerror:null,onabort:null,pending:0,failed:null};
   const settle=()=>{if(tx.pending===0)queueMicrotask(()=>{if(tx.failed){tx.error=tx.failed;tx.onabort?.();}else tx.oncomplete?.();});};
   tx.objectStore=name=>{
    const run=fn=>{tx.pending++;return new Request(()=>{try{return fn();}catch(error){tx.failed=error;throw error;}finally{tx.pending--;queueMicrotask(settle);}});};
    return {
     get:key=>run(()=>{if(data[name].has(key))return structuredClone(data[name].get(key));return undefined;}),
     getAll:()=>run(()=>[...data[name].values()].map(value=>structuredClone(value))),
     put:(value,key)=>run(()=>{
      if(failPutFrom!==null&&name==='frames'&&++writes>failPutFrom){const error=new Error('storage full');error.name=putErrorName;tx.failed=error;throw error;}
      data[name].set(key,structuredClone(value));return key;}),
     delete:key=>run(()=>data[name].delete(key))
    };};
   return tx;}};
 return {open:(name,version)=>new Request(()=>{if(failOpen)throw new Error('IndexedDB open failed');return db;}),_data:data};
}
const morphOf=(...sizes)=>({algorithmVersion:GEOMETRY_VERSION,kind:'linear',closed:true,width:.7,pinchCenter:false,framesPerSegment:16,framesPerSecond:16,
 controls:sizes.map(size=>({latent:{space:'w-plus',shape:[18,512],values:new Float32Array(size)}}))});
const blob=bytes=>new Blob([bytes],{type:'image/png'});
const bytesOf=async b=>new Uint8Array(await b.arrayBuffer());

test('frameStoreKey matches the canonical next-frames-v1 derivation',async()=>{
 const morph=morphOf(18,512,18,512);
 const flat=new Float32Array(morph.controls.reduce((n,c)=>n+c.latent.values.length,0));
 let at=0;for(const control of morph.controls){flat.set(control.latent.values,at);at+=control.latent.values.length;}
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',flat.buffer));
 const expected=`next-frames-v1:${GEOMETRY_VERSION}:${morph.kind}:${morph.width}:${morph.pinchCenter?1:0}:${morph.framesPerSegment}:${morph.framesPerSecond}:${[...digest].map(x=>x.toString(16).padStart(2,'0')).join('')}`;
 assert.equal(await frameStoreKey(morph),expected);
 assert.equal(typeof (await frameStoreKey(morph)),'string');
 await assert.rejects(frameStoreKey({controls:[]}));
 await assert.rejects(frameStoreKey(null));
});

test('Frames persist keyed by morph identity, survive a reopen, and read back in order',async()=>{
 const fake=fakeIndexedDB();
 const store=await openFrameStore({indexedDB:fake,maxBytes:1024*1024});
 assert.equal(store.mode,'persistent');
 const key=await frameStoreKey(morphOf(4));
 const canonicals=[blob(new Uint8Array([1,2,3,4])),blob(new Uint8Array([5,6,7,8]))],derivatives=[blob(new Uint8Array([9])),blob(new Uint8Array([10]))];
 assert.deepEqual(await store.put(frameKey(key,0),canonicals[0],derivatives[0],2),{stored:'idb',bytes:5});
 // A morph written only in part reads as null: a cancelled job must not serve a truncated morph.
 assert.equal(await store.getMorph(key),null);
 assert.deepEqual(await store.put(frameKey(key,1),canonicals[1],derivatives[1],2),{stored:'idb',bytes:5});
 await store.put(frameKey(key,1),canonicals[1],derivatives[1],2); // re-put does not double-count
 assert.equal(store.estimateBytes().persistent,10);
 const frames=await store.getMorph(key);
 assert.equal(frames.length,2);assert.deepEqual(await bytesOf(frames[0]),await bytesOf(canonicals[0]));assert.deepEqual(await bytesOf(frames[1]),await bytesOf(canonicals[1]));
 const display=await store.getMorph(key,'derivative');
 assert.deepEqual(await bytesOf(display[1]),await bytesOf(derivatives[1]));
 // Reload survival: a fresh store over the same database returns the same frames (C-06p).
 store.close();
 const reopened=await openFrameStore({indexedDB:fake});
 assert.deepEqual(await bytesOf((await reopened.getMorph(key))[0]),await bytesOf(canonicals[0]));
 assert.equal(await reopened.getMorph('next-frames-v1:missing'),null);
});

test('QuotaExceededError degrades to memory-only for the session and never fails a frame',async()=>{
 const fake=fakeIndexedDB({failPutFrom:2});
 const store=await openFrameStore({indexedDB:fake,maxBytes:1024*1024});
 const key=await frameStoreKey(morphOf(8)),canonical=blob(new Uint8Array(64).fill(7)),derivative=blob(new Uint8Array(4));
 for(let i=0;i<5;i++){const stored=await store.put(frameKey(key,i),canonical,derivative,5);assert.equal(stored.stored,i<2?'idb':'memory');}
 assert.equal(store.mode,'memory');assert.match(store.degraded,/QuotaExceededError/);
 const frames=await store.getMorph(key);
 assert.equal(frames.length,5,'frames persisted before the quota hit plus memory frames all read back');
 for(const frame of frames)assert.deepEqual(await bytesOf(frame),await bytesOf(canonical));
 const status=await frameStoreStatus();
 assert.equal(status.mode,'memory');
});

test('An unopenable database yields a memory-only store that still serves frames',async()=>{
 const store=await openFrameStore({indexedDB:fakeIndexedDB({failOpen:true})});
 assert.equal(store.mode,'memory');
 const key=await frameStoreKey(morphOf(2)),canonical=blob(new Uint8Array([3,3,3]));
 await store.put(frameKey(key,0),canonical,derivativeOf(),1);
 assert.deepEqual(await bytesOf((await store.getMorph(key))[0]),await bytesOf(canonical));
});
const derivativeOf=()=>blob(new Uint8Array([1]));

test('Eviction drops whole least-recently-used morphs, never the one being written',async()=>{
 const fake=fakeIndexedDB();
 const store=await openFrameStore({indexedDB:fake,maxBytes:8}); // 8 bytes: two morphs of two 3-byte frames do not fit
 const old=await frameStoreKey(morphOf(4)),fresh=await frameStoreKey(morphOf(8));
 const canonical=blob(new Uint8Array(3)),derivative=blob(new Uint8Array([1]));
 for(let i=0;i<2;i++)await store.put(frameKey(old,i),canonical,derivative);
 await new Promise(resolve=>setTimeout(resolve,5)); // distinct lastUsed timestamps
 for(let i=0;i<2;i++)await store.put(frameKey(fresh,i),canonical,derivative,2);
 assert.equal(await store.getMorph(old),null,'the older whole morph is evicted');
 const frames=await store.getMorph(fresh);
 assert.equal(frames.length,2,'the morph being written survives its own eviction pressure');
});

test('The free-function contract works against the default store',async()=>{
 const key=`next-frames-v1:${GEOMETRY_VERSION}:free:1:0:16:16:${'a'.repeat(64)}`;
 assert.equal(await frameStoreGet(key),null);
 const canonical=blob(new Uint8Array([1,1])),derivative=blob(new Uint8Array([2]));
 const stored=await frameStorePut(frameKey(key,0),canonical,derivative,1);
 assert.equal(stored.stored,'memory');
 const frames=await frameStoreGet(key);
 assert.equal(frames.length,1);assert.deepEqual(await bytesOf(frames[0]),await bytesOf(canonical));
 const display=await frameStoreGetDisplay(key);
 assert.deepEqual(await bytesOf(display[0]),await bytesOf(derivative));
});

test('frameStoreEstimateQuota reports the device quota or null without the API',async()=>{
 const saved=globalThis.navigator;
 try{
  Object.defineProperty(globalThis,'navigator',{value:{storage:{estimate:async()=>({usage:10,quota:20}),persisted:async()=>true}},configurable:true});
  assert.deepEqual(await frameStoreEstimateQuota(),{usage:10,quota:20,persisted:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
  assert.equal(await frameStoreEstimateQuota(),null);
  Object.defineProperty(globalThis,'navigator',{value:{storage:{estimate:async()=>{throw new Error('no');}}},configurable:true});
  assert.equal(await frameStoreEstimateQuota(),null);
 }finally{Object.defineProperty(globalThis,'navigator',{value:saved,configurable:true});}
});
