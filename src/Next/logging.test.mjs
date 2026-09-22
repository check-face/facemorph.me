// Post-hoc debugging needs the machine's shape and where a failure happened, without ever
// forwarding an error's own text, which can carry a path, a URL or something the user typed.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {checkedEvent} from '../../hosting/next-cloudflare/validation.mjs';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));

function context(posts){
 return vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>7},setTimeout:()=>1,clearTimeout(){},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  crossOriginIsolated:true,
  navigator:{userAgent:'Chrome/153 Android',platform:'Linux armv8l',language:'en-AU',hardwareConcurrency:8,deviceMemory:12},
  window:{dispatchEvent(){}},CustomEvent:class{constructor(t,{detail}){this.detail=detail;}},
  fetch:async(url,request)=>{// Events leave in batches; unwrap so each assertion still reads one event at a time.
   const parsed=JSON.parse(request.body);const {events,...common}=parsed;
   if(Array.isArray(events))for(const event of events)posts.push({...common,...event});
   else posts.push(parsed);
   return {ok:true};}});
}

test('A run records the machine it ran on',async()=>{
 const posts=[],ctx=context(posts);
 vm.runInContext(plain(await read('reporting.mjs'))+'\nglobalThis.d=diagnostics;',ctx);
 ctx.d.enable(true);ctx.d.start('faces','auto');ctx.d.bundle('a'.repeat(64));/* start is deferred until the bundle digest is known */
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 const start=posts.find(p=>p.event==='start');
 assert.equal(start.cores,8);assert.equal(start.memoryGb,12);assert.equal(start.isolated,true);
 checkedEvent({session:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',run:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',...start});
});

test('A failure says where and what kind, never the error text',async()=>{
 const cases=[
  [Object.assign(new Error('Array buffer allocation failed'),{name:'RangeError'}),'memory'],
  [Object.assign(new Error('nope'),{name:'QuotaExceededError'}),'storage'],
  [Object.assign(new Error('nope'),{name:'NotSupportedError'}),'unsupported'],
  [Object.assign(new Error('cancelled'),{name:'AbortError'}),'aborted'],
  [new Error('checksum did not match for /Users/secret/photo.png'),'integrity'],
 ];
 for(const [error,kind] of cases){
  const posts=[],ctx=context(posts);
  vm.runInContext(plain(await read('reporting.mjs'))+'\nglobalThis.d=diagnostics;',ctx);
  ctx.d.enable(true);ctx.d.start('faces','auto');
  ctx.d.finish('failed',error,{stage:'synthesis'});
  ctx.d.flush?.();  // batched events leave on a timer this context stubs out
  const failure=posts.at(-1);
  assert.equal(failure.errorKind,kind,`${error.name} classifies as ${kind}`);
  assert.equal(failure.errorStage,'synthesis');
  assert(!JSON.stringify(failure).includes('secret'),'the error text never travels');
  assert(!JSON.stringify(failure).includes('photo.png'));
  checkedEvent({session:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',run:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',...failure});
 }
});

test('Logs stage locally before consent, send only on a yes, and are discarded on a no',async()=>{
 const posts=[],ctx=context(posts);
 vm.runInContext(plain(await read('reporting.mjs'))+'\nglobalThis.d=diagnostics;',ctx);
 const d=ctx.d;
 // A tester who has not opted in: everything is captured, nothing is sent.
 d.start('faces','auto');
 d.stage('model-loaded',{elapsedMs:5});
 d.finish('failed',new Error('checksum mismatch'),{stage:'synthesis'});
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert.equal(posts.length,0,'nothing leaves the device before consent');
 assert(d.status().staged>=3,'but it is all kept, ready to send');
 // Saying yes after the failure sends what led up to it.
 d.enable(true);
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert(posts.length>=3,'the staged run is delivered on consent');
 assert.equal(d.status().staged,0,'and the buffer is emptied');
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert(posts.some(p=>p.event==='failed'&&p.errorKind==='integrity'),'including the failure itself');
 // Turning it off discards anything staged since.
 d.enable(false);
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 const settled=posts.length;
 d.start('faces','auto');d.stage('model-loaded',{elapsedMs:5});
 assert(d.status().staged>0);
 d.enable(false);
 assert.equal(d.status().staged,0,'declining discards the buffer');
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert.equal(posts.length,settled,'and sends nothing');
});

test('Once consent is given, events stream immediately so an interruption still leaves evidence',async()=>{
 const posts=[],ctx=context(posts);
 vm.runInContext(plain(await read('reporting.mjs'))+'\nglobalThis.d=diagnostics;',ctx);
 const d=ctx.d;
 d.enable(true);
 d.start('faces','auto');d.bundle('a'.repeat(64));/* start is deferred until the bundle digest is known */
 assert.equal(d.status().staged,0,'nothing is held back once the answer is yes');
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert(posts.some(p=>p.event==='start'),'the start is already sent');
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 const afterStart=posts.length;
 d.stage('model-loaded',{elapsedMs:5});
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 assert(posts.length>afterStart,'each stage goes out as it happens');
 assert.equal(d.status().staged,0);
 // A tab that dies here has already delivered everything up to this point.
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 const delivered=posts.length;
 assert(delivered>=2,'partial evidence survives an interruption');
});
