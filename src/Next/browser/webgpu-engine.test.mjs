import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebGpuSession} from './webgpu-engine.mjs';

const MiB=1024*1024;
function fixture(t,{adapterLimit=128*MiB,deviceLimit=128*MiB,bufferLimit=256*MiB,failAt}={}){
 const globals={navigator:undefined,GPUBufferUsage:{STORAGE:1,COPY_DST:2,COPY_SRC:4,MAP_READ:8},GPUMapMode:{READ:1}};
 const urls=new Map(),revoked=[],allocations=[],releases=[],imports=[];
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{const url=`blob:fixture-${urls.size}`;urls.set(url,blob);return url;};
 URL.revokeObjectURL=url=>revoked.push(url);
 t.after(()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;});
 let lose,validation,destroyed=0;
 const device={limits:{maxStorageBufferBindingSize:deviceLimit,maxBufferSize:bufferLimit},lost:new Promise(resolve=>{lose=resolve;}),addEventListener(name,fn){if(name==='uncapturederror')validation=fn;},destroy(){destroyed++;},
  queue:{writeBuffer(){},submit(){},async onSubmittedWorkDone(){}},
  createCommandEncoder(){return {copyBufferToBuffer(){},finish(){return {};}};},
  createBuffer({size,usage}){const buffer={size,usage,destroyed:0,destroy(){this.destroyed++;},async mapAsync(){},getMappedRange(){return new ArrayBuffer(size);},unmap(){}};allocations.push(buffer);return buffer;}};
 const adapter={limits:{maxStorageBufferBindingSize:adapterLimit,maxBufferSize:bufferLimit}};
 globals.navigator={gpu:{async requestAdapter(){return adapter;}}};
 for(const [key,value] of Object.entries(globals)){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
 }
 const encode=value=>new TextEncoder().encode(JSON.stringify(value));
 const assets={module:new TextEncoder().encode('// pinned runtime, not string-rewritten'),factory:new TextEncoder().encode('// pinned JSEP factory'),wasm:new Uint8Array([0,97,115,109]),
  metadata:encode({phase:'phase',demod:'demod'}),split:encode({prefixOutputs:{phase__tile0:[1,64,512,512],phase__tile1:[1,64,512,512]},suffixInputs:['external'],external:'external'}),
  filter:new Uint8Array(new Float32Array(16).buffer),bias:new Uint8Array(new Float32Array(32).buffer),prefix:new Uint8Array([1]),suffix:new Uint8Array([2]),kernel:new TextEncoder().encode('// pinned bounded kernel')};
 const descriptor=name=>({name,sha256:name});
 const config={runtime:{module:descriptor('module'),factory:descriptor('factory'),wasm:descriptor('wasm')},...Object.fromEntries(['metadata','split','filter','bias','prefix','suffix','kernel'].map(name=>[name,descriptor(name)]))};
 const ort={env:{wasm:{},webgpu:{}},Tensor:{fromGpuBuffer:()=>({})},InferenceSession:{async create(bytes,options){
  const name=bytes[0]===1?'prefix':'suffix';
  assert.equal(ort.env.wasm.numThreads,1);
  assert.deepEqual(new Uint8Array(await urls.get(ort.env.wasm.wasmPaths?.mjs)?.arrayBuffer()),assets.factory,'verified factory must be configured before session creation');
  assert.deepEqual(new Uint8Array(await urls.get(ort.env.wasm.wasmPaths?.wasm)?.arrayBuffer()),assets.wasm,'verified WASM must be configured before session creation');
  assert.equal(ort.env.webgpu.adapter,adapter,'ORT uses the adapter that passed preflight');
  ort.env.webgpu.device=device;
  if(name==='suffix')assert.equal(options.executionProviders[0].device,device);
  if(failAt===name)throw Error(`fixture ${name} failure`);
  return {inputNames:['w','noise_15'],async run(){},async release(){releases.push(name);}};
 }}};
 const args={config,noiseManifest:[{name:'noise_15',shape:[1,1,1024,1024]}],bytes:async asset=>assets[asset.name],importModule:async url=>{
  const contents=await urls.get(url).text();imports.push(contents);
  if(contents.includes('pinned runtime')){if(failAt==='import')throw Error('fixture import failure');return ort;}
  return {async createBoundaryPipeline(d,meta,tiled,workgroup,variant){assert.equal(d,device);assert.equal(variant,'bounded');return {bind(){return {encode(){}};}};}};
 }};
 return {args,urls,revoked,allocations,releases,imports,assets,lose:()=>lose({reason:'unknown'}),validation:()=>validation({error:{message:'fixture validation'}}),destroyed:()=>destroyed};
}

test('bounded mobile graph accepts exactly 128 MiB and uses verified JSEP paths',async t=>{
 const f=fixture(t);const session=await createWebGpuSession(f.args);
 assert.equal(session.provider,'webgpu');
 assert.equal(Math.max(...f.allocations.map(b=>b.size)),128*MiB);
 assert.equal(f.imports[0],new TextDecoder().decode(f.assets.module),'runtime bytes are not patched');
 const output=await session.infer(new Float32Array(9216),{noise_15:new Float32Array(1024*1024)});
 assert.equal(output.length,3*1024*1024);
 await session.dispose();await session.dispose();
 assert.equal(f.destroyed(),1);assert.deepEqual(f.releases,['prefix','suffix']);
 assert.deepEqual([...f.revoked].sort(),[...f.urls.keys()].sort());
 assert.ok(f.allocations.every(b=>b.destroyed===1));
});
test('adapter below 128 MiB is refused before runtime assets are loaded',async t=>{
 const f=fixture(t,{adapterLimit:128*MiB-1});
 await assert.rejects(createWebGpuSession(f.args),{name:'NotSupportedError'});
 assert.equal(f.urls.size,0);
});
test('maxBufferSize is checked separately from storage binding size',async t=>{
 const f=fixture(t,{bufferLimit:64*MiB});
 await assert.rejects(createWebGpuSession(f.args),{name:'NotSupportedError'});
 assert.equal(f.urls.size,0);
});
test('a smaller ORT device remains a refusal even when its adapter passed',async t=>{
 const f=fixture(t,{adapterLimit:256*MiB,deviceLimit:64*MiB});
 await assert.rejects(createWebGpuSession(f.args),{name:'NotSupportedError'});
 assert.equal(f.destroyed(),1);assert.deepEqual(f.releases,['prefix']);
 assert.equal(f.revoked.length,f.urls.size);
});
for(const stage of ['import','prefix','suffix'])test(`failed ${stage} setup releases verified URLs and any allocated device`,async t=>{
 const f=fixture(t,{failAt:stage});
 await assert.rejects(createWebGpuSession(f.args),new RegExp(`fixture ${stage} failure`));
 assert.equal(f.revoked.length,f.urls.size);
 assert.equal(f.destroyed(),stage==='import'?0:1);
});
test('device loss invalidates inference rather than yielding a successful face',async t=>{
 const f=fixture(t);const session=await createWebGpuSession(f.args);f.lose();await Promise.resolve();
 await assert.rejects(session.infer(new Float32Array(9216),{}),/GPU device lost/);
 await session.dispose();
});
test('GPU validation errors invalidate inference',async t=>{
 const f=fixture(t);const session=await createWebGpuSession(f.args);f.validation();
 await assert.rejects(session.infer(new Float32Array(9216),{}),/GPU validation/);
 await session.dispose();
});
test('missing WebGPU returns an explicit capability refusal',async t=>{
 const f=fixture(t);globalThis.navigator={};
 await assert.rejects(createWebGpuSession(f.args),{name:'NotSupportedError'});
 assert.equal(f.urls.size,0);
});
