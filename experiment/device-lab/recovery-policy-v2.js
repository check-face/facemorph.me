const light=new Set(['colour','ffmpeg','reference-diagnostic']);
export function recoveryState(value){return {incidents:Array.isArray(value?.incidents)?value.incidents.filter(x=>x&&typeof x.runId==='string'&&typeof x.route==='string').slice(-32):[],cpuFailed:value?.cpuFailed===true,cpuPassed:value?.cpuPassed===true};}
export function rememberIncident(state,incident){const next=recoveryState(state);if(!incident?.runId||!incident.route||light.has(incident.route))return next;if(!next.incidents.some(x=>x.runId===incident.runId||(x.attemptId||x.runId)===(incident.attemptId||incident.runId)))next.incidents.push({...incident,cause:'Unexpected interruption; memory exhaustion is not proven'});next.incidents=next.incidents.slice(-32);return next;}
export function recoverPrior(state,prior,blocked=[]){let next=recoveryState(state);for(const b of blocked)if(b.runId&&b.id)next=rememberIncident(next,{runId:b.runId,route:b.id,version:b.version});if(!prior?.runId||prior.stopped)return next;
 const rows=prior.results||[];const active=rows.find(r=>!light.has(r.id)&&((!prior.finished&&!r.finished&&(r.status==='Running'||r.completed===undefined))||(prior.interrupted&&r.error==='Previous tab closed or reloaded before completion')));
 if(active)next=rememberIncident(next,{runId:prior.runId,attemptId:prior.localAttemptId||prior.recoveredFromRunId||prior.runId,route:active.id,version:prior.suiteVersion});return next;
}
export function recoveryMode(state,ios=false){const s=recoveryState(state);if(s.cpuFailed||s.incidents.length>=2||s.incidents.some(x=>x.route==='cpu-recovery'||x.route.startsWith('cpu-unshared')))return 'cpu-check';return s.incidents.length?'cpu-check':'normal';}
export function conservativePlan(plan,state){
 const prior=recoveryMode(state),ios=plan.facts.ios,gpu=plan.facts.gpu&&Number.isFinite(plan.facts.bindingBytes)&&plan.facts.bindingBytes>=134217728;
 const candidate=plan.decisions.find(d=>d.id==='mobile-no-prepack');
 const mode=prior!=='normal'?'cpu-check':ios?(gpu&&candidate?'ios-gpu-check':'cpu-check'):'normal';
 plan.facts.recoveryMode=mode;if(ios)plan.facts.classification=mode==='ios-gpu-check'?'ios-gpu-research':'ios-cpu-recovery';plan.facts.priorUnexpectedInterruptions=state.incidents.length;
 if(mode!=='normal')for(const d of plan.decisions){
  d.status=(mode==='cpu-check'?d.id==='cpu-recovery':d.id==='mobile-no-prepack')?'selected':'skipped';delete d.after;
  d.reason=d.status==='selected'?(mode==='cpu-check'?'Short unshared CPU screen; GPU unavailable or previous failure. Full model memory footprint.':'iPhone GPU research: prepacking-disabled FP32 candidate, all31 face references required. Adapter availability is not qualification.'):'One inference route per iPhone/recovery run; explicit GPU retry remains available.';
 }
 return plan;
}
