import assert from 'node:assert/strict';
import {runStatus} from './run-status-v1.js';
const report={started:new Date(0).toISOString(),selected:['a','b'],results:[{id:'a',completed:true},{id:'b',progress:'Checking first face'}]};
assert.equal(runStatus({}).kind,'idle');assert.equal(runStatus({phase:'starting'}).kind,'running');
let s=runStatus({report,phase:'running',now:65000});assert.equal(s.kind,'running');assert.equal(s.done,1);assert(s.detail.includes('1m 5s'));
const finished={...report,finished:new Date(70000).toISOString(),results:[{completed:true},{completed:false,error:'Unsupported'}]};
assert.equal(runStatus({report:finished,saved:false}).kind,'saving');s=runStatus({report:finished,saved:true});assert.equal(s.kind,'done');assert(s.detail.includes('1 failed'));
assert.equal(runStatus({report:{...finished,interrupted:true},saved:true}).kind,'warning');assert(runStatus({report:{...finished,stopped:true},saved:true}).title.includes('STOPPED'));
assert(runStatus({report:{...finished,error:'Network'},saved:false}).title.includes('ENDED EARLY'));console.log('Running, saved completion, save pending, stopped, interrupted and failed states pass');
