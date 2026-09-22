import test from 'node:test';import assert from 'node:assert/strict';import worker,{RETENTION_SECONDS,ORIGINS} from './worker.mjs';import {deleteRun} from './delete-run.mjs';
const id='76d02e92-9e4f-4dd1-8a0d-8254a1568fbc';
const event=()=>({schemaVersion:1,session:id,run:id,device:id,event:'stage',stage:'model-loaded',stageMs:123,elapsedMs:456,browser:'safari',browserMajor:26,platform:'ios',build:'next-test'});
function request(value=event(),extra={}){return new Request('https://next.facemorph.me/diagnostics/events',{method:'POST',headers:{Origin:'https://next.facemorph.me','Content-Type':'application/json','X-Facemorph-Diagnostics-Consent':'session-v1',...extra},body:JSON.stringify(value)});}
function store(){const puts=[];return {puts,env:{FREE_PLAN_CONFIRMED:'true',DIAGNOSTICS:{put:async(...args)=>puts.push(args)}}};}
test('Private bounded fields, confirmed save and exact30day KV expiry',async()=>{const {puts,env}=store(),before=Math.floor(Date.now()/1000);const response=await worker.fetch(request(event(),{'CF-Connecting-IP':'private-ip','User-Agent':'private-ua',Cookie:'private-cookie'}),env);assert.equal(response.status,204);assert.equal(puts.length,1);const [key,value,options]=puts[0],batch=JSON.parse(value),saved=batch[0];assert.equal(batch.length,1);assert(key.startsWith('runs/'+id+'/'));assert(options.expiration>=before+RETENTION_SECONDS&&options.expiration<=Math.floor(Date.now()/1000)+RETENTION_SECONDS);assert.equal(Date.parse(saved.expiresAt)/1000,options.expiration);assert.equal(saved.stageMs,123);assert(!value.includes('private-'));assert.equal(response.headers.get('Cache-Control'),'no-store');});
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
 assert.equal(JSON.parse(puts[0][1])[0].event,'interrupted');
 for(const bad of ['done','abandoned','hidden',''])assert.equal((await worker.fetch(request({...event(),event:bad}),env)).status,400);
 assert.equal(puts.length,1);
});
test('The two stages a tester most needs to see are collectable',async()=>{
 const {puts,env}=store();
 for(const stage of ['fallback-cpu','original-cache-invalid'])assert.equal((await worker.fetch(request({...event(),stage}),env)).status,204);
 assert.deepEqual(puts.map(p=>JSON.parse(p[1])[0].stage),['fallback-cpu','original-cache-invalid']);
 assert.equal((await worker.fetch(request({...event(),stage:'gpu-stage'}),env)).status,400);
});

// One KV write per event exhausted the Free plan's 1,000 writes/day: 21 September took 1,430
// before the collector began refusing, and a single morph is about a hundred events.
test('A batch is one KV write and every event in it is checked',async()=>{
 const {puts,env}=store();
 const events=[{event:'stage',stage:'morph',elapsedMs:1},{event:'stage',stage:'morph',elapsedMs:2},{event:'completed'}];
 const common={schemaVersion:1,session:id,run:id,device:id,platform:'ios',browser:'safari'};
 assert.equal((await worker.fetch(request({...common,events}),env)).status,204);
 assert.equal(puts.length,1,'a batch costs one write, not one per event');
 const saved=JSON.parse(puts[0][1]);
 assert.equal(saved.length,3);
 assert.deepEqual(saved.map(e=>e.event),['stage','stage','completed']);
 assert.ok(saved.every(e=>e.receivedAt&&e.expiresAt),"every event carries the batch stamps");
 // A poisoned member rejects the whole batch rather than being silently dropped.
 assert.equal((await worker.fetch(request({...common,events:[{event:'stage',stage:'morph'},{event:'stage',stage:'secret'}]}),env)).status,400);
 assert.equal((await worker.fetch(request({...common,events:[]}),env)).status,400);
 assert.equal(puts.length,1);
});

// reporting.mjs sent storage, photo-* and cache-trouble for weeks and the collector rejected
// every one with a 400, which is why four rounds of reports carried no storage record at all.
test('the collector accepts every stage the product actually sends',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../src/Next/reporting.mjs',import.meta.url),'utf8');
 const sent=[...source.match(/const allowedStages=new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 const {puts,env}=store();
 for(const stage of sent){
  const status=(await worker.fetch(request({...event(),stage}),env)).status;
  assert.equal(status,204,`the collector rejects a stage the product sends: ${stage}`);
 }
 assert.equal(puts.length,sent.length);
});

// KV's Free plan allows 1,000 writes a day per namespace; 21 September spent 1,430 and the
// collector started refusing exactly when the reports were most needed. R2 takes the writes now,
// with KV kept as a fallback so one sink refusing never loses a run.
test('R2 takes the write, and KV catches it when R2 cannot', async () => {
  const r2 = [], kv = [];
  const env = {FREE_PLAN_CONFIRMED: 'true',
    DIAGNOSTICS_R2: {put: async (...args) => r2.push(args)},
    DIAGNOSTICS: {put: async (...args) => kv.push(args)}};
  assert.equal((await worker.fetch(request(), env)).status, 204);
  assert.equal(r2.length, 1, 'R2 is the primary sink');
  assert.equal(kv.length, 0, 'KV is not written when R2 succeeded');
  assert.ok(r2[0][0].startsWith('runs/' + id + '/'), 'the key shape is unchanged for readers');

  const failing = {...env, DIAGNOSTICS_R2: {put: async () => {throw Error('r2 down');}}};
  assert.equal((await worker.fetch(request(), failing)).status, 204);
  assert.equal(kv.length, 1, 'KV catches the batch when R2 refuses');

  // Both gone is a 503, never a false confirmation that the record was kept.
  const dead = {FREE_PLAN_CONFIRMED: 'true',
    DIAGNOSTICS_R2: {put: async () => {throw Error('r2 down');}},
    DIAGNOSTICS: {put: async () => {throw Error('kv down');}}};
  assert.equal((await worker.fetch(request(), dead)).status, 503);
});
