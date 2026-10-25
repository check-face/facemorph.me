import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createModelSource} from './model-source.mjs';
import {grantRemaining,GrantRefused} from '../../../../../packages/browser-model-manager/src/acquisition/grants.ts';

const payload=Uint8Array.from({length:1234},(_,i)=>i%251);
const asset={sha256:createHash('sha256').update(payload).digest('hex'),size:payload.length,url:'https://models.example/pinned'};
const owner='face:model-source-test';
const approve=(bytes=asset.size)=>({
 manifestSha256:'model-source-test',route:'cpu',purpose:'generate',owners:[owner],remainingBytes:bytes,
 assets:[{sha256:asset.sha256,bytes:asset.size,priority:'foreground-required'}]
});
const request=(grant=approve(),signal)=>({grant,owner,...(signal?{signal}:{})});

// This is a unit boundary: the real manager consumes and verifies Response streams, while
// this controllable BlobStore commits only after the stream completes. Native browser
// storage denial/quota are qualified separately; these cases isolate fallback policy.
function environment(t,{openError,writeError,fetcher=async()=>new Response(payload)}={}){
 const descriptors=new Map(['caches','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const[key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
 const entries=new Map(),requests=[],degraded=[],storage={opens:0,reads:0,writes:0,deletes:0};
 const backend={
  async match(key){storage.reads++;return entries.get(key)?.clone();},
  async put(key,response){
   storage.writes++;
   const body=await response.arrayBuffer();
   if(writeError)throw writeError;
   entries.set(key,new Response(body,{headers:response.headers}));
  },
  async delete(key){storage.deletes++;return entries.delete(key);}
 };
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://app.example'}});
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{open:async()=>{storage.opens++;if(openError)throw openError;return backend;}}});
 const options={shards:null,slots:null,retryDelaysMs:[],fetcher:async(url,init)=>{requests.push(url);return fetcher(url,init);}};
 return{entries,requests,degraded,storage,options,source:()=>createModelSource(options,error=>degraded.push(error))};
}

async function assertTransientOnly(source,env){
 assert.equal(source.uncached,true);
 const before={...env.storage};
 assert.equal(await source.has(asset),false,'transient bytes never advertise a cache hit');
 assert.equal('local'in source,false,'no synthetic local reader is exposed');
 assert.equal(await source.records.get('canary'),undefined);
 await source.records.put('canary',{passed:true});
 await source.records.remove('canary');
 assert.deepEqual(env.storage,before,'uncached presence and records never consult durable storage');
 assert.equal(env.entries.size,0,'neither model bytes nor synthetic qualification records are retained');
 const count=env.requests.length;
 await assert.rejects(source.acquire(asset,request()),/background preparation stopped/);
 assert.equal(env.requests.length,count,'background preparation cannot download unused transient bytes');
}

test('initial native storage refusal permits verified uncached bytes without a synthetic cache',async t=>{
 const denied=new DOMException('storage denied','SecurityError');
 const env=environment(t,{openError:denied});
 const source=await env.source();
 assert.deepEqual(env.degraded,[denied]);
 assert.equal(env.requests.length,0,'constructing an uncached source does not download');
 const grant=approve();
 assert.deepEqual(await source.bytes(asset,request(grant)),payload);
 assert.equal(grantRemaining(grant),0);
 assert.deepEqual(env.requests,[asset.url]);
 await assertTransientOnly(source,env);
 // The next caller must pay for fresh verified bytes; the previous result was not cached.
 assert.deepEqual(await source.bytes(asset,request()),payload);
 assert.deepEqual(env.requests,[asset.url,asset.url]);
 assert.deepEqual(env.degraded,[denied],'uncached notification is sent once');
 assert.equal(env.storage.opens,1);
});

test('mid-write quota refusal falls back under the same already-spent grant',async t=>{
 const quota=new DOMException('write failed after consuming the body','QuotaExceededError');
 const env=environment(t,{writeError:quota});
 const source=await env.source();
 assert.equal(source.uncached,false);
 const grant=approve(asset.size*2);
 assert.deepEqual(await source.bytes(asset,request(grant)),payload);
 assert.deepEqual(env.requests,[asset.url,asset.url],'failed durable transfer and transient continuation each download once');
 assert.equal(grantRemaining(grant),0,'the failed write does not refund transferred bytes');
 assert.equal(env.degraded.length,1);
 assert.equal(env.degraded[0].name,'QuotaExceededError');
 assert.equal(env.degraded[0].cause,quota);
 await assertTransientOnly(source,env);
 await assert.rejects(source.bytes(asset,request(grant)),error=>error instanceof GrantRefused&&error.refusal==='revision-required');
 assert.equal(env.requests.length,2,'spent grant is refused before another request');
 assert.deepEqual(await source.bytes(asset,request()),payload,'a newly approved grant can fund a new operation');
 assert.equal(env.requests.length,3,'transient bytes from the earlier caller are not retained');
 assert.equal(env.degraded.length,1);
});

test('a storage write failure cannot replenish a grant too small for the uncached continuation',async t=>{
 const env=environment(t,{writeError:new DOMException('quota full','QuotaExceededError')});
 const source=await env.source();
 const grant=approve();
 await assert.rejects(source.bytes(asset,request(grant)),error=>error instanceof GrantRefused&&error.refusal==='revision-required');
 assert.equal(grantRemaining(grant),0);
 assert.deepEqual(env.requests,[asset.url],'no fallback request after the durable attempt exhausted approval');
 assert.equal(env.degraded.length,1);
 await assertTransientOnly(source,env);
});

test('uncached continuation still verifies the digest and spends corrupt received bytes',async t=>{
 const denied=new DOMException('storage denied','SecurityError');
 const env=environment(t,{openError:denied,fetcher:async()=>new Response(new Uint8Array(payload.length))});
 const source=await env.source();
 const grant=approve();
 await assert.rejects(source.bytes(asset,request(grant)),/integrity mismatch/i);
 assert.equal(grantRemaining(grant),0);
 assert.deepEqual(env.requests,[asset.url],'corruption does not start another uncached attempt');
 assert.deepEqual(env.degraded,[denied],'only the original storage refusal enables uncached execution');
 await assertTransientOnly(source,env);
});

test('background acquire reports a native write refusal, then refuses further background downloads',async t=>{
 const quota=new DOMException('quota full','QuotaExceededError');
 const env=environment(t,{writeError:quota});
 const source=await env.source();
 const grant=approve(asset.size*2);
 await assert.rejects(source.acquire(asset,request(grant)),{name:'QuotaExceededError'});
 assert.equal(grantRemaining(grant),asset.size);
 assert.deepEqual(env.requests,[asset.url],'background failure never launches an uncached continuation');
 await assertTransientOnly(source,env);
 assert.equal(env.degraded.length,1);
});

test('network errors retain their meaning and do not enable storage fallback',async t=>{
 const network=new TypeError('Failed to fetch');
 const env=environment(t,{fetcher:async()=>{throw network;}});
 const source=await env.source();
 for(const operation of ['bytes','acquire'])await assert.rejects(source[operation](asset,request()),error=>error===network);
 assert.equal(source.uncached,false);
 assert.equal(env.degraded.length,0);
 assert.deepEqual(env.requests,[asset.url,asset.url],'each explicit operation makes one attempt without a fallback request');
 assert.equal(env.entries.size,0);
});

test('integrity errors reject without fallback or retained bytes',async t=>{
 const env=environment(t,{fetcher:async()=>new Response(new Uint8Array(payload.length))});
 const source=await env.source();
 for(const operation of ['bytes','acquire']){
  const grant=approve(asset.size*2);
  await assert.rejects(source[operation](asset,request(grant)),/integrity mismatch/i);
  assert.equal(grantRemaining(grant),asset.size,'corrupt received bytes remain spent');
 }
 assert.equal(source.uncached,false);
 assert.equal(env.degraded.length,0);
 assert.deepEqual(env.requests,[asset.url,asset.url]);
 assert.equal(env.entries.size,0);
});

test('grant refusal never enables fallback or makes an unauthorized request',async t=>{
 const env=environment(t);
 const source=await env.source();
 for(const operation of ['bytes','acquire'])
  for(const grant of [undefined,approve(0),{...approve(),owners:[]}])
   await assert.rejects(source[operation](asset,{grant,owner}),GrantRefused);
 assert.equal(source.uncached,false);
 assert.equal(env.degraded.length,0);
 assert.equal(env.requests.length,0);
 assert.equal(env.entries.size,0);
});

test('AbortError cancels in-flight I/O without enabling storage fallback',async t=>{
 let fetched;
 const started=new Promise(resolve=>{fetched=resolve;});
 const env=environment(t,{fetcher:async(_url,{signal})=>{
  fetched();
  return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
 }});
 const source=await env.source();
 const stop=new AbortController(),reason=new DOMException('visitor cancelled','AbortError');
 const operation=source.bytes(asset,request(approve(),stop.signal));
 const rejected=assert.rejects(operation,error=>error===reason);
 await started;
 stop.abort(reason);
 await rejected;
 await assert.rejects(source.acquire(asset,request(approve(),stop.signal)),error=>error===reason);
 assert.equal(source.uncached,false);
 assert.equal(env.degraded.length,0);
 assert.deepEqual(env.requests,[asset.url]);
 assert.equal(env.entries.size,0);
});

test('caller cancellation named SecurityError is never mistaken for storage refusal',async t=>{
 let fetched;
 const env=environment(t,{fetcher:async(_url,{signal})=>{
  fetched();
  return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
 }});
 const source=await env.source();
 for(const operation of ['bytes','acquire']){
  const started=new Promise(resolve=>{fetched=resolve;});
  const stop=new AbortController(),reason=new DOMException('caller chose this cancellation reason','SecurityError');
  const rejected=assert.rejects(source[operation](asset,request(approve(),stop.signal)),error=>error===reason);
  await started;
  stop.abort(reason);
  await rejected;
  assert.equal(source.uncached,false,`${operation}: caller cancellation does not disable storage`);
  assert.equal(env.degraded.length,0,`${operation}: cancellation does not notify storage degradation`);
 }
 assert.deepEqual(env.requests,[asset.url,asset.url],'only the two explicit operations reached the network');
 assert.equal(env.entries.size,0);
});

test('a throwing uncached observer cannot prevent verified continuation after storage refusal',async t=>{
 const quota=new DOMException('quota full','QuotaExceededError');
 const observerFailure=new Error('observer failed');
 const env=environment(t,{writeError:quota});
 const source=await createModelSource(env.options,error=>{env.degraded.push(error);throw observerFailure;});
 const grant=approve(asset.size*2);
 assert.deepEqual(await source.bytes(asset,request(grant)),payload,'verified transient bytes survive an observer exception');
 assert.equal(grantRemaining(grant),0,'both transfers still spend the original grant');
 assert.deepEqual(env.requests,[asset.url,asset.url]);
 assert.equal(env.degraded.length,1);
 assert.equal(env.degraded[0].cause,quota);
 await assertTransientOnly(source,env);
 assert.deepEqual(await source.bytes(asset,request()),payload);
 assert.equal(env.requests.length,3,'later callers still acquire their own verified bytes');
 assert.equal(env.degraded.length,1,'the failed observer is not repeatedly invoked');
});

test('background descriptor reads stop at a failed durable write; foreground may spend the remaining grant',async t=>{
 const quota=new DOMException('descriptor write quota full','QuotaExceededError');
 const env=environment(t,{writeError:quota});
 const source=await env.source();
 const grant=approve(asset.size*2),options=request(grant);
 await assert.rejects(source.bytes(asset,options,{allowUncached:false}),error=>error.name==='QuotaExceededError'&&error.cause===quota);
 assert.equal(source.uncached,true);
 assert.equal(env.degraded.length,1);
 assert.equal(env.degraded[0].cause,quota);
 assert.equal(grantRemaining(grant),asset.size,'the failed durable descriptor transfer remains spent');
 assert.deepEqual(env.requests,[asset.url],'background failure never downloads transient descriptor bytes');
 await assert.rejects(source.bytes(asset,options,{allowUncached:false}),/background preparation stopped/i);
 assert.equal(grantRemaining(grant),asset.size);
 assert.deepEqual(env.requests,[asset.url],'already-uncached background reads do no I/O');
 assert.deepEqual(await source.bytes(asset,options),payload,'foreground execution can consume the remaining original approval');
 assert.equal(grantRemaining(grant),0);
 assert.deepEqual(env.requests,[asset.url,asset.url]);
 assert.equal(env.degraded.length,1);
 await assertTransientOnly(source,env);
});
