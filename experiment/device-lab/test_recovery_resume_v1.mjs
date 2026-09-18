import assert from 'node:assert/strict';
import {caseCheckpoint,collectCheckpoints,separateRecovered,heartbeatFresh,resumeDecision,applyResume,checkpointHeartbeat,RESUME_STALE_MS} from './recovery-resume-v1.js';

const now=Date.parse('2026-09-18T12:00:00Z');

// caseCheckpoint normalizes a saved row and ignores plain result rows without checkpoints.
assert.deepEqual(caseCheckpoint(null),null);
assert.deepEqual(caseCheckpoint({}),null);
assert.deepEqual(caseCheckpoint({id:'ffmpeg',completed:true}),null,'Rows without stage evidence are not checkpoints');
const row={id:'e4e-coverage',stages:{e4e:{latentSha256:'abc'}},lastBrowserHeartbeatAt:'2026-09-18T11:00:00Z',completed:undefined};
const cp=caseCheckpoint(row);
assert.equal(cp.candidateId,'e4e-coverage');
assert.deepEqual(cp.stages,{e4e:{latentSha256:'abc'}});
assert.equal(cp.completed,false);
// Checkpoints are cloned: mutating the source row must not leak into the decision data.
row.stages.e4e.latentSha256='tampered';
assert.equal(cp.stages.e4e.latentSha256,'abc');

const report={runId:'run-1',results:[
 {id:'ffmpeg',completed:true},
 {id:'e4e-coverage',stages:{decode_alignment:{passed:true},e4e:{latentSha256:'abc'}},lastBrowserHeartbeatAt:'2026-09-18T11:00:00Z'},
 {id:'mobile-boundary-bounded',checkpointAt:'2026-09-18T11:30:00Z'},
]};
const checkpoints=collectCheckpoints(report);
assert.deepEqual(Object.keys(checkpoints).sort(),['e4e-coverage','mobile-boundary-bounded']);
assert.equal(checkpoints['ffmpeg'],undefined);
// An interruption error with completed undefined is not a worker failure: the case stays resumable.
const interrupted=caseCheckpoint({id:'cpu-4',stages:{},error:'Previous tab closed or reloaded before completion'});
assert.equal(interrupted.failed,false);
const workerFailed=caseCheckpoint({id:'cpu-4',stages:{},completed:false,error:'Correctness failed'});
assert.equal(workerFailed.failed,true);

// Recovered partials stay separate: fresh medians and pass counts must exclude them.
const rows=[
 {id:'cpu-1',completed:true,singleMedianMs:5900},
 {id:'cpu-1',recovered:true,singleMedianMs:9}, // bogus value must not leak into fresh stats
 {id:'e4e-coverage',recovered:true,stages:{e4e:{}}},
];
const {fresh,recovered}=separateRecovered(rows);
assert.equal(fresh.length,1);
assert.equal(recovered.length,2);
const freshMedian=fresh.map(r=>r.singleMedianMs).reduce((a,b)=>a+b,0)/fresh.length;
assert.equal(freshMedian,5900,'Recovered rows never mix into fresh timing medians');
assert.equal(separateRecovered(null).recovered.length,0);

// Heartbeats: fresh inside the window, stale outside, absent never fresh.
assert.equal(heartbeatFresh({heartbeatAt:'2026-09-18T11:30:00Z'},now),true);
assert.equal(heartbeatFresh({heartbeatAt:'2026-09-18T05:00:00Z'},now),false,'Older than the stale window');
assert.equal(heartbeatFresh({heartbeatAt:'2026-09-18T12:00:01Z'},now),false,'Future timestamps are not trusted');
assert.equal(heartbeatFresh({},now),false);
assert.equal(heartbeatFresh({checkpointAt:'2026-09-18T10:00:00Z'},now),true,'checkpointAt backs the heartbeat');
assert.equal(RESUME_STALE_MS>0,true);

// Resume decision: local unfinished run wins and keeps its run ID.
const local={runId:'run-1',suiteVersion:'2026-09-17.32',finished:undefined,results:report.results};
let d=resumeDecision({local,suiteVersion:'2026-09-17.32',now});
assert.equal(d.action,'resume');assert.equal(d.runId,'run-1');assert.equal(d.source,'local');
assert.equal(d.checkpoints['e4e-coverage'].stages.e4e.latentSha256,'abc');
assert.equal(d.checkpoints['ffmpeg'],undefined,'Completed plain results are not checkpoints');

// A stopped-by-tester run is not resumed.
d=resumeDecision({local:{...local,stopped:true},suiteVersion:'2026-09-17.32',now});
assert.equal(d.action,'fresh');

// An interrupted run (finished + interrupted marker) is still resumable: its checkpoints were saved.
d=resumeDecision({local:{...local,finished:'2026-09-18T11:05:00Z',interrupted:true},suiteVersion:'2026-09-17.32',now});
assert.equal(d.action,'resume');assert.equal(d.runId,'run-1');assert.equal(d.source,'local');

// Suite version mismatch: never resume across suites.
d=resumeDecision({local,suiteVersion:'2026-09-15.31',now});
assert.equal(d.action,'fresh');

// Server record resumes when no local report exists; stale records do not.
const server={runId:'run-9',suiteVersion:'2026-09-17.32',finished:false,stopped:false,heartbeatAt:'2026-09-18T11:00:00Z',checkpoints:{'cpu-4':{stages:{}}}};
d=resumeDecision({local:null,server,suiteVersion:'2026-09-17.32',now});
assert.equal(d.action,'resume');assert.equal(d.runId,'run-9');assert.equal(d.source,'server');
d=resumeDecision({local:null,server:{...server,heartbeatAt:'2026-09-18T01:00:00Z'},suiteVersion:'2026-09-17.32',now});
assert.equal(d.action,'fresh');assert.equal(d.staleRunId,'run-9');

// applyResume: completed checkpoints become recovered rows, partial ones resume, others stay fresh.
const completedCheckpoints={
 ...checkpoints,
 'e4e-coverage':{candidateId:'e4e-coverage',stages:{decode_alignment:{passed:true},e4e:{latentSha256:'abc'},reconstruction1024:{passed:true},original_cache:{passed:true},repeat:{passed:true},failure_recovery:{passed:true}},completed:true,failed:false},
};
const decisions=[
 {id:'ffmpeg',status:'selected',reason:'ffmpeg reason'},
 {id:'e4e-coverage',status:'selected',reason:'e4e reason'},
 {id:'mobile-boundary-bounded',status:'selected',reason:'gpu reason'},
 {id:'cpu-4',status:'selected',reason:'cpu reason'},
];
const resumed=applyResume(decisions,completedCheckpoints);
assert.deepEqual(resumed[0],{...decisions[0]},'No checkpoint: untouched');
assert.equal(resumed[1].status,'recovered');
assert.match(resumed[1].reason,/Recovered partial results/);
assert.match(resumed[1].reason,/e4e reason/,'Original selection reason is preserved');
assert.equal(resumed[2].status,'selected','Checkpoint without stages and without completion re-runs fresh');
assert.deepEqual(resumed[3],{...decisions[3]});
// Partial checkpoint attaches the resume payload with cloned stages.
const partial=applyResume(decisions,{'e4e-coverage':{candidateId:'e4e-coverage',stages:{decode_alignment:{passed:true},e4e:{latentSha256:'abc'}},completed:false,failed:false}});
assert.equal(partial[1].status,'selected');
assert.deepEqual(partial[1].resume.stages.e4e,{latentSha256:'abc'});
assert.match(partial[1].reason,/2 checkpointed stage\(s\) will not be repeated/);
// A failed candidate re-runs fresh even with checkpoint evidence.
const failedCp=applyResume(decisions,{'e4e-coverage':{candidateId:'e4e-coverage',stages:{decode_alignment:{passed:true}},completed:false,failed:true}});
assert.deepEqual(failedCp[1],{...decisions[1]},'Failed interrupted candidates re-run fresh');
assert.deepEqual(applyResume(null,checkpoints),[]);
// The resume payload is a clone: later mutation cannot corrupt the plan.
partial[1].resume.stages.e4e.latentSha256='x';
assert.equal(caseCheckpoint(report.results[1]).stages.e4e.latentSha256,'abc');

// checkpointHeartbeat keeps runId + candidateId and refreshes the heartbeat.
const hb=checkpointHeartbeat({runId:'run-1',candidateId:'e4e-coverage',stages:{e4e:{}}},{runId:'run-1',candidateId:'e4e-coverage',now:'2026-09-18T12:00:00Z'});
assert.equal(hb.heartbeatAt,'2026-09-18T12:00:00Z');
assert.equal(hb.runId,'run-1');
assert.deepEqual(checkpointHeartbeat(null,{runId:'r',candidateId:'c',now:'2026-09-18T12:00:00Z'}),{runId:'r',candidateId:'c',stages:{},heartbeatAt:'2026-09-18T12:00:00Z'});

console.log('recovery-resume-v1: checkpoint merge, resume decisions, and recovered/fresh separation behave');
