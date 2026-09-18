import test from 'node:test';import assert from 'node:assert/strict';import worker,{RETENTION_SECONDS,ORIGINS} from './worker.mjs';import {deleteRun} from './delete-run.mjs';
const id='76d02e92-9e4f-4dd1-8a0d-8254a1568fbc';
const event=()=>({schemaVersion:1,session:id,run:id,device:id,event:'stage',stage:'model-loaded',stageMs:123,elapsedMs:456,browser:'safari',browserMajor:26,platform:'ios',build:'next-test'});
function request(value=event(),extra={}){return new Request('https://next.facemorph.me/diagnostics/events',{method:'POST',headers:{Origin:'https://next.facemorph.me','Content-Type':'application/json','X-Facemorph-Diagnostics-Consent':'session-v1',...extra},body:JSON.stringify(value)});}
function store(){const puts=[];return {puts,env:{FREE_PLAN_CONFIRMED:'true',DIAGNOSTICS:{put:async(...args)=>puts.push(args)}}};}
test('Private bounded fields, confirmed save and exact30day KV expiry',async()=>{const {puts,env}=store(),before=Math.floor(Date.now()/1000);const response=await worker.fetch(request(event(),{'CF-Connecting-IP':'private-ip','User-Agent':'private-ua',Cookie:'private-cookie'}),env);assert.equal(response.status,204);assert.equal(puts.length,1);const [key,value,options]=puts[0],saved=JSON.parse(value);assert(key.startsWith('runs/'+id+'/'));assert(options.expiration>=before+RETENTION_SECONDS&&options.expiration<=Math.floor(Date.now()/1000)+RETENTION_SECONDS);assert.equal(Date.parse(saved.expiresAt)/1000,options.expiration);assert.equal(saved.stageMs,123);assert(!value.includes('private-'));assert.equal(response.headers.get('Cache-Control'),'no-store');});
test('Reject private/unknown fields, malformed types and bounds without any KV write',async()=>{const {puts,env}=store();for(const value of [{...event(),photo:'secret'},{...event(),words:'secret'},{...event(),latent:[1]},{...event(),errorCode:'private filename'},{...event(),device:'-' .repeat(36)},{...event(),stageMs:-1},{...event(),elapsedMs:Infinity},{...event(),browserMajor:true},{...event(),build:'private/path'},[],null])assert.equal((await worker.fetch(request(value),env)).status,400);assert.equal(puts.length,0);});
test('Origins and consent fail closed; native preflights have no credentials/wildcards',async()=>{const {puts,env}=store();for(const origin of ORIGINS){const r=await worker.fetch(new Request('https://next.facemorph.me/diagnostics/events',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-facemorph-diagnostics-consent'}}),env);assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null);assert.equal((await worker.fetch(request(event(),{Origin:origin}),env)).status,204);}
 for(const origin of ['null','https://evil.example','http://localhost:5173','https://next.facemorph.me.evil.example'])assert.equal((await worker.fetch(request(event(),{Origin:origin}),env)).status,403);
 assert.equal((await worker.fetch(request(event(),{'X-Facemorph-Diagnostics-Consent':''}),env)).status,403);assert.equal(puts.length,ORIGINS.size);
 for(const method of ['GET','DELETE'])assert.equal((await worker.fetch(new Request('https://next.facemorph.me/diagnostics/events',{method,headers:{Origin:'https://next.facemorph.me'}}),env)).status,405);
});
test('Oversized/chunked and invalid UTF8 input cannot reach storage',async()=>{const {puts,env}=store();assert.equal((await worker.fetch(request({...event(),padding:'x'.repeat(3000)}),env)).status,400);const r=request();const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}});assert.equal((await worker.fetch(new Request(r.url,{method:'POST',headers:r.headers,body,duplex:'half'}),env)).status,400);assert.equal(puts.length,0);});
test('Missing free-plan confirmation/binding and quota failure do not claim a save',async()=>{assert.equal((await worker.fetch(request(),{})).status,503);assert.equal((await worker.fetch(request(),{FREE_PLAN_CONFIRMED:'true'})).status,503);assert.equal((await worker.fetch(request(),{FREE_PLAN_CONFIRMED:'true',DIAGNOSTICS:{put:async()=>{throw Error('quota');}}})).status,503);});
test('Private deletion cannot cross run boundary and never fetches raw report values',async()=>{const calls=[],prefix='runs/'+id+'/',opts={run:id,account:'a'.repeat(32),namespace:'b'.repeat(32),token:'private-token'};const result=await deleteRun({...opts,fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return Response.json(options.method==='DELETE'?{success:true}:{success:true,result:[{name:prefix+'event-1'}],result_info:{}});}});assert.equal(result.deleted,1);assert.equal(calls.length,2);assert.equal(new URL(calls[0].url).searchParams.get('prefix'),prefix);assert.deepEqual(JSON.parse(calls[1].options.body),[prefix+'event-1']);await assert.rejects(deleteRun({...opts,fetchImpl:async()=>Response.json({success:true,result:[{name:'runs/OTHER/private'}]})}),/outside/);});
test('A run whose page went away mid-job is storable, and is not dressed up as a verdict',async()=>{
 const {puts,env}=store();
 // C-09: the terminal event a backgrounded phone sends. It has to be accepted, stored under the
 // same run prefix, and remain distinguishable from a completion or a failure.
 assert.equal((await worker.fetch(request({...event(),event:'interrupted',stage:undefined,stageMs:undefined,elapsedMs:4200}),env)).status,204);
 assert.equal(puts.length,1);assert.equal(puts[0][0].startsWith('runs/'+id+'/'),true);
 assert.equal(JSON.parse(puts[0][1]).event,'interrupted');
 for(const bad of ['done','abandoned','hidden',''])assert.equal((await worker.fetch(request({...event(),event:bad}),env)).status,400);
 assert.equal(puts.length,1);
});
test('The two stages a tester most needs to see are collectable',async()=>{
 const {puts,env}=store();
 for(const stage of ['fallback-cpu','original-cache-invalid'])assert.equal((await worker.fetch(request({...event(),stage}),env)).status,204);
 assert.deepEqual(puts.map(p=>JSON.parse(p[1]).stage),['fallback-cpu','original-cache-invalid']);
 assert.equal((await worker.fetch(request({...event(),stage:'gpu-stage'}),env)).status,400);
});
