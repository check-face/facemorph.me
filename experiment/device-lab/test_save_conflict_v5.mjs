import assert from 'node:assert/strict';
import {ResultStore} from './save-client-v5.js';
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
let resolveConflict,resolveReserve;const sent=[];let recovered;
const store=new ResultStore({storage:null,onRecovered:(old,r)=>recovered={old,r},fetcher:async(path,opts)=>{
 if(opts.method==='POST')return new Promise(resolve=>resolveReserve=()=>resolve(response(201,{runId:'new-run',writeToken:'new-token'})));
 sent.push(JSON.parse(opts.body));
 if(path.endsWith('/old-run'))return new Promise(resolve=>resolveConflict=()=>resolve(response(409,{revision:10,error:'Newer server copy'})));
 return response(200,{saved:true,runId:'new-run',revision:JSON.parse(opts.body).revision,serverSavedAt:new Date().toISOString()});
}});
const r={schemaVersion:1,runId:'old-run',revision:4,results:[]};store.remember(r.runId,'old-token');store.put({token:'old-token',report:structuredClone(r)});
const flushing=store.flush();await new Promise(r=>setTimeout(r,0));r.results.push({id:'latest',completed:true});store.enqueue(r);resolveConflict();
await new Promise(r=>setTimeout(r,0));assert.equal(store.entries.size,1,'No checkpoint lost during conflict handling');r.results.push({id:'during-reserve',completed:true});store.enqueue(r);resolveReserve();
assert(await flushing);assert.equal(sent.length,2);assert.deepEqual(sent[1].results,r.results);assert.equal(sent[1].conflictFromRunId,'old-run');assert(!sent[1].recoveredFromRunId);assert.equal(recovered.r.runId,'new-run');assert.equal(store.entries.size,0);
// No false successful save when even the fresh reservation rejects writes.
let next=0;const rejected=new ResultStore({storage:null,fetcher:async(p,o)=>o.method==='POST'?response(201,{runId:'fork-'+(++next),writeToken:'token'}):response(409,{revision:99,error:'Conflict'})});
rejected.put({token:'t',report:{schemaVersion:1,runId:'original',revision:1,results:[]}});assert.equal(await rejected.flush(),false);assert.equal(rejected.entries.size,1);assert.equal(next,1);
const pending=rejected.entries.values().next().value;rejected.enqueue(pending.report);assert.equal(await rejected.flush(),false);assert.equal(next,1,'New checkpoint must not reset recovery guard');
console.log('Concurrent 409 preserves latest checkpoints including edits during reservation; bounded retry remains queued on failure');
