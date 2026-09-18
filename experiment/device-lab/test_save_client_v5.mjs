import assert from 'node:assert/strict';
import {ResultStore} from './save-client-v5.js';
const base=process.argv[2],fetcher=(p,o)=>fetch(base+p,o);
class Storage{map=new Map();get length(){return this.map.size}key(i){return [...this.map.keys()][i]}getItem(k){return this.map.get(k)||null}setItem(k,v){this.map.set(k,v)}removeItem(k){this.map.delete(k)}}
const storage=new Storage();let online=true,recovered;
const store=new ResultStore({storage,fetcher:(p,o)=>{if(!online)throw Error('Offline');return fetcher(p,o)},onRecovered:(old,r)=>recovered={old,r}});
const r={schemaVersion:1,results:[],test:true};await store.start(r);assert(r.runId);assert.equal(store.entries.size,0);
online=false;r.results.push({id:'unavailable-gpu',completed:false,error:'WebGPU unavailable'});store.enqueue(r);assert.equal(await store.flush(),false);assert.equal(store.entries.size,1);
online=true;await store.flush();assert.equal(store.entries.size,0);
// A fully flushed run must keep its scoped credential through reload.
const reloaded=new ResultStore({storage,fetcher,onRecovered:()=>assert.fail('Reload must not create another run')});
const sameId=r.runId;const resumed={...r,revision:r.revision+1,interrupted:true};reloaded.put({token:null,report:resumed});assert(await reloaded.flush());assert.equal(resumed.runId,sameId);assert.equal(reloaded.entries.size,0);
assert(!JSON.stringify(resumed).includes('run-v1.'));
// Reload recovery from persistent outbox, with no global/session key.
const oldId=crypto.randomUUID();storage.setItem('facemorph-pending-'+oldId,JSON.stringify({schemaVersion:1,runId:oldId,results:[{id:'old-failure',completed:false}],test:true}));
await store.importLegacy();await store.flush();assert.equal(recovered.old,oldId);assert.equal(recovered.r.recoveredFromRunId,oldId);assert.equal(store.entries.size,0);
// A bad per-run credential is recovered once into a newly scoped record.
store.put({token:'stale',report:{schemaVersion:1,runId:r.runId,results:[],revision:99,test:true}});await store.flush();assert.equal(store.entries.size,0);assert.notEqual(recovered.r.runId,r.runId);
// Never serialize a credential into the diagnostic report itself.
assert(!JSON.stringify(recovered.r).includes('writeToken'));
const blocked=new ResultStore({storage:null,fetcher:async()=>({ok:false,status:401,json:async()=>({error:'denied'})})});await assert.rejects(blocked.start({schemaVersion:1,results:[]}),/denied/);
console.log('Browser save client regressions passed: no-key startup, offline retry, legacy recovery, stale-token recovery, credential separation.');
