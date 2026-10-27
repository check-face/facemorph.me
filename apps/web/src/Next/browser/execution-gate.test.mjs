import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionGate} from './execution-gate.mjs';
const held=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
test('overlapping verified reads exclude init, session creation and inference; later reads wait for compute release',async()=>{
 const a=held(),b=held(),compute=held(),events=[];
 const gate=createExecutionGate({acquire:async()=>events.push('permit'),release:async()=>events.push('released')});
 const first=gate.read(async()=>{events.push('read-a');await a.promise;events.push('done-a');});
 const second=gate.read(async()=>{events.push('read-b');await b.promise;events.push('done-b');});
 const heavy=gate.compute(async()=>{events.push('init/session/run');await compute.promise;events.push('compute-done');});
 const last=gate.read(async()=>events.push('read-c'));
 await turn();assert.deepEqual(events,['read-a','read-b']);
 a.resolve();await turn();assert.deepEqual(events,['read-a','read-b','done-a']);
 b.resolve();await turn();assert.deepEqual(events,['read-a','read-b','done-a','done-b','permit','init/session/run']);
 compute.resolve();await Promise.all([first,second,heavy,last]);
 assert.deepEqual(events.slice(-3),['compute-done','released','read-c']);
});
test('closing rejects queued work and a late admission releases its permit without starting compute',async()=>{
 const admission=held(),events=[];const gate=createExecutionGate({acquire:()=>admission.promise,release:async()=>events.push('released')});
 const compute=gate.compute(async()=>events.push('must not run')).catch(e=>e);
 const read=gate.read(async()=>events.push('must not read')).catch(e=>e);
 const reason=new DOMException('disposed','AbortError');gate.close(reason);
 assert.equal(await compute,reason);assert.equal(await read,reason);assert.equal(gate.signal.reason,reason);
 admission.resolve();await turn();assert.deepEqual(events,['released']);
});
test('overlapping kernels share one permit through the last completion and never pass a queued read',async()=>{
 const a=held(),b=held(),events=[];let permits=0;
 const gate=createExecutionGate({acquire:async()=>{assert.equal(permits++,0);events.push('admit');},release:async()=>{assert.equal(--permits,0);events.push('release');}});
 const first=gate.compute(async()=>{events.push('submit-a');await a.promise;events.push('done-a');});
 const second=gate.compute(async()=>{events.push('submit-b');await b.promise;events.push('done-b');});
 await turn();assert.deepEqual(events,['admit','submit-a','submit-b']);
 const read=gate.read(async()=>{assert.equal(permits,0);events.push('read');});
 const late=gate.compute(async()=>events.push('late'));
 a.resolve();await first;assert.equal(permits,1);assert.ok(!events.includes('read'));
 b.resolve();await Promise.all([second,read,late]);
 assert.deepEqual(events,['admit','submit-a','submit-b','done-a','done-b','release','read','admit','late','release']);
});
test('a typed acquisition refusal propagates unchanged and cannot leak a compute permit',async()=>{
 const refused=Object.assign(Error('Approve again'),{name:'GrantRefused'});let permits=0;
 const gate=createExecutionGate({acquire:async()=>{permits++;},release:async()=>{permits--;}});
 await assert.rejects(gate.read(async()=>{throw refused;}),e=>e===refused);assert.equal(permits,0);
 await assert.rejects(gate.compute(async()=>{throw refused;}),e=>e===refused);assert.equal(permits,0);
});

// Use the actual shared generator: WebGPU loads mapping concurrently with its backend.
import {assembleGenerator} from '../../../../../packages/stylegan-js/src/engine/adapters/generator.ts';
for(const cancel of [false,true])test(`late warm-mapping session remains owned across ${cancel?'cancellation':'successful task drain'}`,async()=>{
 const backendRead=held(),mappingCreate=held();let startedMapping=false,releasedSession=0,permits=0;
 const gate=createExecutionGate({acquire:async()=>{permits++;},release:async()=>{permits--;}});
 const average={sha256:'a',size:4},mapping={sha256:'b',size:4},synthesis={sha256:'c',size:4};
 const reader={allowRepair:false,compute:work=>gate.compute(work),read:asset=>gate.read(async()=>{
  if(asset===synthesis)await backendRead.promise;
  return {ok:true,value:new Uint8Array(4)};
 })};
 const pending=assembleGenerator({reader,manifest:{noise:[],average,mapping,synthesis},manifestSha256:'m',requested:'webgpu',mapping:{ort:async()=>({InferenceSession:{create:async()=>{
  startedMapping=true;await mappingCreate.promise;return {release:async()=>{releasedSession++;}};
 }}})},backend:async(_noise,_trace,reader)=>{
  await reader.read(synthesis);
  return reader.compute(async()=>({route:'webgpu',engine:'direct-webgpu',liveResources:()=>0,dispose:async()=>{}}));
 },extraAssets:[],unsupported:[],descriptor:{},geometry:{latent:{layers:1,width:1,zLength:1},width:1,height:1},warmMapping:true});
 await turn();backendRead.resolve();const generator=await pending;
 assert.equal(startedMapping,true);assert.equal(permits,1);
 let drained=false;const draining=gate.drain().then(()=>{drained=true;});
 await turn();assert.equal(drained,false,'task completion must wait for outstanding session creation');
 let disposing;
 if(cancel){gate.close();disposing=generator.dispose();}
 mappingCreate.resolve();await draining;
 if(!cancel){await generator.mappingReady();gate.close();disposing=generator.dispose();}
 await disposing;
 assert.equal(releasedSession,1,'created session is released exactly once, including when creation finishes after cancellation');
 assert.equal(permits,0);
});

test('drain includes compute queued by a completed read continuation',async()=>{
 const reading=held(),computing=held(),events=[];const gate=createExecutionGate();
 const work=gate.read(()=>reading.promise).then(()=>gate.compute(async()=>{events.push('compute');await computing.promise;}));
 let drained=false;const done=gate.drain().then(()=>{drained=true;});
 reading.resolve();await turn();assert.deepEqual(events,['compute']);assert.equal(drained,false);
 computing.resolve();await Promise.all([work,done]);assert.equal(drained,true);
});
