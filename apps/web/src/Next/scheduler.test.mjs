import test from 'node:test';import assert from 'node:assert/strict';import {nextScheduled} from './scheduler.mjs';
test('serial scheduling skips photo decisions, preserves tails, and resumes them when ready',()=>{
 const jobs=[{kind:'face',id:'crop'},{kind:'face',id:'b'},{kind:'face',id:'c'}];
 assert.equal(nextScheduled(jobs,{busy:true}),-1);
 assert.equal(nextScheduled(jobs,{blockedFaces:['crop']}),1);
 jobs.splice(1,1);assert.deepEqual(jobs.map(j=>j.id),['crop','c']);
 assert.equal(nextScheduled(jobs,{blockedFaces:['crop']}),1);
 assert.equal(nextScheduled(jobs),0);
});
test('an eligible morph keeps its position ahead of newly queued faces',()=>{
 const jobs=[{kind:'face',id:'a'},{kind:'morph'},{kind:'face',id:'b'}];
 jobs.shift();assert.equal(nextScheduled(jobs),0);
 assert.equal(nextScheduled(jobs,{blockMorph:true}),1);
 assert.equal(nextScheduled([{kind:'morph'}],{blockMorph:true}),-1);
});
