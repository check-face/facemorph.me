// Pure checkpoint/resume decision logic for the device lab.
// No DOM, no fetch, no storage: every function takes plain data and returns plain data,
// so the merge/resume decisions are unit-testable with node --test.

// A server record with no heartbeat inside this window is stale and is not auto-resumed.
export const RESUME_STALE_MS = 6 * 60 * 60 * 1000;

// Normalized per-case checkpoint extracted from a saved report row.
// candidateId is the experiment id; stages carry the per-stage evidence the worker posted.
export function caseCheckpoint(row){
  if(!row||typeof row!=='object'||typeof row.id!=='string')return null;
  const stages=row.stages&&typeof row.stages==='object'&&!Array.isArray(row.stages)?row.stages:null;
  if(!stages&&!row.checkpointAt)return null;
  // completed===false is an explicit worker failure; an error with completed undefined is
  // an interruption ('Previous tab closed or reloaded before completion') and stays resumable.
  return {candidateId:row.id,stages:structuredClone(stages||{}),heartbeatAt:row.lastBrowserHeartbeatAt||row.heartbeatAt||null,checkpointAt:row.checkpointAt||null,completed:row.completed===true,failed:row.completed===false};
}

export function collectCheckpoints(report){
  const out={};
  for(const row of Array.isArray(report?.results)?report.results:[]){const c=caseCheckpoint(row);if(c)out[c.candidateId]=c;}
  return out;
}

// Recovered partials are reported separately and must never be mixed into fresh
// timing medians or pass counts. Anything flagged recovered:true lands in `recovered`.
export function separateRecovered(rows){
  const fresh=[],recovered=[];
  for(const row of Array.isArray(rows)?rows:[])(row&&row.recovered===true?recovered:fresh).push(row);
  return {fresh,recovered};
}

export function heartbeatFresh(checkpoint,now=Date.now(),staleMs=RESUME_STALE_MS){
  const at=Date.parse(checkpoint?.heartbeatAt||checkpoint?.checkpointAt||'');
  return Number.isFinite(at)&&now-at>=0&&now-at<staleMs;
}

// Decide whether the next visit resumes an interrupted run or starts fresh.
// local:  the last report from localStorage (may be null). An interrupted run
//         (finished+interrupted) is resumable: its checkpoints were saved.
// server: the collector's record for this device (may be null).
// A resumable run keeps its runId, so already-finished candidates are never re-run and
// their results are never mixed with fresh ones.
export function resumeDecision({local=null,server=null,suiteVersion,staleMs=RESUME_STALE_MS,now=Date.now()}={}){
 const versionMatches=r=>!r?.suiteVersion||r.suiteVersion===suiteVersion;
 const resumableRun=r=>r&&r.runId&&!r.stopped&&(!r.finished||r.interrupted===true);
 if(local&&resumableRun(local)&&versionMatches(local))
  return {action:'resume',runId:local.runId,source:'local',checkpoints:collectCheckpoints(local),reason:'The previous run did not finish; resuming it with the same run ID so completed experiments are kept.'};
 if(server&&resumableRun(server)&&versionMatches(server)){
  if(server.interrupted===true||heartbeatFresh(server,now,staleMs))return {action:'resume',runId:server.runId,source:'server',checkpoints:server.checkpoints||{},reason:'The results collector still has an unfinished run for this device; resuming it.'};
  return {action:'fresh',staleRunId:server.runId,reason:'The interrupted run on the collector has no recent heartbeat and no interruption marker, so it is left as saved partials and a fresh run starts.'};
 }
 return {action:'fresh',reason:'No unfinished run to resume.'};
}

// Apply a resume decision to a planned suite. Returns a new decisions array where:
// - candidates whose checkpoint completed are marked status 'recovered' (their saved row is
//   reported as a recovered partial, never re-run, never merged into fresh results);
// - candidates with partial checkpoints are selected with a `resume` payload so the worker
//   skips checkpointed stages (latent-first: expensive encoder work is not repeated);
// - everything else is selected fresh.
export function applyResume(decisions,checkpoints){
  return (Array.isArray(decisions)?decisions:[]).map(d=>{
   const cp=checkpoints?.[d.id];
   if(!cp||cp.failed)return {...d};
   if(cp.completed)return {...d,status:'recovered',reason:`Recovered partial results from the interrupted run; not re-run. ${d.reason||''}`.trim()};
   const stageNames=Object.keys(cp.stages);
   if(!stageNames.length)return {...d};
   return {...d,status:'selected',resume:{stages:structuredClone(cp.stages)},reason:`Resuming after interruption; ${stageNames.length} checkpointed stage(s) will not be repeated. ${d.reason||''}`.trim()};
  });
}

// Heartbeat patch for a per-case checkpoint record (runId + candidateId + time).
export function checkpointHeartbeat(checkpoint,{runId,candidateId,now=new Date().toISOString()}){
  return {...(checkpoint||{runId,candidateId,stages:{}}),runId,candidateId,heartbeatAt:now};
}
