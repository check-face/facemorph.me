// A silent fallback is what hid a phone running on the slower of two available paths. A report
// must say what the browser offered and what happened to the route that was tried.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {checkedEvent} from '../../hosting/next-cloudflare/validation.mjs';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));

test('Route facts reach the collector and survive its allowlist',async()=>{
 const source=plain(await read('reporting.mjs')),posts=[];
 const ctx=vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>5},setTimeout:()=>1,clearTimeout(){},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  navigator:{userAgent:'Chrome/153 Android',platform:'Linux armv8l',language:'en-AU'},
  window:{dispatchEvent(){}},CustomEvent:class{constructor(t,{detail}){this.detail=detail;}},
  fetch:async(url,request)=>{// Events leave in batches; unwrap so each assertion still reads one event at a time.
   const parsed=JSON.parse(request.body);const {events,...common}=parsed;
   if(Array.isArray(events))for(const event of events)posts.push({...common,...event});
   else posts.push(parsed);
   return {ok:true};}});
 vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);
 const d=ctx.d;d.enable(true);d.start('faces','auto');
 // The phone's shape: WebGPU offered, the route refused, the run continues elsewhere.
 d.stage('route-admitted',{provider:'webgpu',gpu:'webgpu',routeOutcome:'canary-failed'});
 d.stage('route-admitted',{provider:'webgl',gpu:'webgpu',routeOutcome:'admitted'});
 ctx.d.flush?.();  // batched events leave on a timer this context stubs out
 const routeReports=posts.filter(p=>p.stage==='route-admitted');
 assert.equal(routeReports.length,2,'both the refusal and the admission are reported');
 assert.deepEqual(routeReports.map(r=>[r.provider,r.routeOutcome]),[['webgpu','canary-failed'],['webgl','admitted']]);
 assert.equal(routeReports[0].gpu,'webgpu','the report says WebGPU was offered even though it was not used');
 // The collector must accept exactly these payloads.
 for(const report of routeReports) checkedEvent({schemaVersion:1,session:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',run:'76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',...report});
 // Nothing private rides along.
 assert(!JSON.stringify(routeReports).includes('Android'));
});
