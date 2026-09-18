// Research selection only: capability checks are not product qualification.
// v6: one-click full bench. A capable iPhone gets the whole useful bench list in ONE run
// (synthesis GPU candidates, CPU controls, ffmpeg, e4e photo-pipeline coverage) instead of
// one inference route per run. Tab-kill safety comes from per-case checkpoints and resume
// (recovery-resume-v1.js), not from shrinking the suite. Bounded budget and per-candidate
// reasons are preserved (autoresearch/program.md research-value policy).
export function planSuite(config, device, environment){
 const rules=config.automaticSuite.rules;
 const ids=config.experiments.map(e=>e.id);
 if(new Set(ids).size!==ids.length||ids.some(id=>!rules[id]))throw Error('Incomplete or duplicate suite policy');
 const binding=device.gpu?.limits?.maxStorageBufferBindingSize;
 const gpu=!!device.gpu;
 const threads=environment.crossOriginIsolated?Math.min(4,environment.hardwareConcurrency||1):1;
 const ios=/iPhone|iPad|iPod/.test(device.platform||'')||(/Mac/.test(device.platform||'')&&device.maxTouchPoints>1);
 const affectedModel=device.userAgentData?.model==='SM-S906E';
 const facts={reportedModel:device.userAgentData?.model||null,affectedModel,ios,gpu,bindingBytes:binding??null,effectiveCpuThreads:threads,classification:ios?'ios-conservative':!gpu?'cpu-only':binding>=134742528?'large-binding-gpu':binding>=134217728?'bounded-binding-gpu':'limited-or-unknown-gpu'};
 const match={affectedGpu:affectedModel&&gpu&&binding>=134217728,unsharedResearch:(!gpu||affectedModel)&&!ios,always:true,iosGpu:ios&&gpu&&binding>=134217728,gpu,large:!ios&&gpu&&binding>=134742528,bounded:gpu&&binding>=134217728&&binding<134742528,threads2:threads>=2&&threads<4,threads4:threads>=4,weight1:threads<4};
 const decisions=config.experiments.map(e=>{const rule=rules[e.id];if(!(rule.when in match)&&rule.when!=='off')throw Error('Unknown selection rule '+rule.when);const selected=rule.when!=='off'&&match[rule.when];return {id:e.id,name:e.name,status:selected?(rule.after?'pending':'selected'):'skipped',reason:selected?rule.reason:rule.when==='off'?rule.reason:`Capability rule ${rule.when} not met`,...(selected&&rule.after?{after:rule.after}:{}),rule:structuredClone(rule)};});
 enforceBudget(config,decisions,facts);
 if(ios||affectedModel||!gpu){const order=['reference-diagnostic','colour','ffmpeg','e4e-coverage','cpu-1','cpu-4','cpu-unshared-1','cpu-unshared-reload','mobile-no-prepack','mobile-boundary-bounded','iphone-memory','mobile-memory'];decisions.sort((a,b)=>(order.indexOf(a.id)<0?99:order.indexOf(a.id))-(order.indexOf(b.id)<0?99:order.indexOf(b.id)));}
 if(affectedModel)for(const d of decisions)if(['best','cached','video','compat','cpu-1','cpu-2','cpu-4','cpu-weight-1','cpu-weight-4','mobile-boundary-bounded','mobile-memory'].includes(d.id)){d.status='skipped';delete d.after;d.reason='Known failing SM-S906E report: establish actual unshared CPU first, then the new explicit GPU memory candidate. Historical routes remain available for targeted research.';}
 return {policyId:config.automaticSuite.id,facts,decisions};
}

// Bounded budget: heavy candidates (model downloads + long inference) are capped per run.
// The cap never removes light diagnostics; overflow skips the lowest-priority heavy
// candidates with an explicit reason instead of silently shrinking the bench. Conditional
// follow-ups ('pending') are not counted: they only run on a failure condition.
function enforceBudget(config,decisions,facts){
 const budget=config.automaticSuite.budget;
 if(!budget||!Array.isArray(budget.heavyExperiments))return;
 if(Array.isArray(budget.appliesToClassifications)&&!budget.appliesToClassifications.includes(facts.classification))return;
 const heavy=decisions.filter(d=>d.status==='selected'&&budget.heavyExperiments.includes(d.id));
 const estimatedMinutes=id=>budget.estimatedMinutes?.[id]||null;
 facts.budget={maxHeavyExperiments:budget.maxHeavyExperiments,heavySelected:heavy.map(d=>({id:d.id,estimatedMinutes:estimatedMinutes(d.id)}))};
 if(heavy.length<=budget.maxHeavyExperiments)return;
 const priority=id=>Array.isArray(budget.priorityOrder)?budget.priorityOrder.indexOf(id):-1;
 const overflow=[...heavy].sort((a,b)=>priority(b.id)-priority(a.id)).slice(0,heavy.length-budget.maxHeavyExperiments);
 for(const d of overflow){d.status='skipped';delete d.after;d.reason=`Automatic suite budget cap (${budget.maxHeavyExperiments} heavy candidates per run) reached; this candidate is recorded as the next run's first selection. Original reason: ${d.reason}`;}
}

export function resolveDecision(decision, results){
 if(decision.status==='skipped'||decision.status==='recovered')return false;
 if(!decision.after)return true;
 const prior=results.find(r=>r.id===decision.after.id&&r.recovered!==true);
 const passed=prior?.completed===true&&!prior.error;
 const run=!!prior&&(decision.after.outcome==='passed'?passed:prior.completed===false||!!prior.error);
 decision.status=run?'selected':'skipped';
 if(!run)decision.reason=`Follow-up requires ${decision.after.id} to ${decision.after.outcome==='passed'?'pass':'fail'}; condition not met. ${decision.rule.reason}`;
 return run;
}

export function applyInterruptedRoutes(plan, blocked, version){
 for(const d of plan.decisions)if(d.status!=='skipped'&&d.status!=='recovered'&&blocked.some(b=>b.version===version&&b.id===d.id&&!b.resumable)){
  d.status='skipped';d.reason='Interrupted in this browser on this suite version without a resumable checkpoint; skip on retry so remaining tests can run.';
 }
 return plan;
}

// Recovery policy v2: a fresh capable device runs the full bench. Degradation to the
// conservative single-route CPU check happens only on evidence of instability (repeated
// unexplained interruptions or CPU failures). An interrupted run that has resumable
// checkpoints takes priority over degradation entirely: the next run resumes it.
export function conservativePlan(plan, state, resumable=null){
 const prior=recoveryMode(state),ios=plan.facts.ios;
 if(resumable?.action==='resume'&&resumable.runId){
  plan.facts.recoveryMode='resume';plan.facts.resumedRunId=resumable.runId;
  if(ios)plan.facts.classification='ios-resume';
  return plan;
 }
 const gpu=plan.facts.gpu&&Number.isFinite(plan.facts.bindingBytes)&&plan.facts.bindingBytes>=134217728;
 const mode=prior==='cpu-check'?'cpu-check':'normal';
 plan.facts.recoveryMode=mode;
 if(ios)plan.facts.classification=mode==='cpu-check'?'ios-cpu-recovery':'ios-full-bench';
 plan.facts.priorUnexpectedInterruptions=state.incidents.length;
 if(mode!=='normal')for(const d of plan.decisions){
  d.status=d.id==='cpu-recovery'?'selected':'skipped';delete d.after;delete d.resume;
  d.reason=d.status==='selected'?'Short unshared CPU screen after repeated interruptions or CPU failures; full model memory footprint.':'Reduced to a single conservative CPU route after repeated interruptions or CPU failures; checkpoints make the next full run resumable.';
 }
 return plan;
}

function recoveryMode(state){
 const s={incidents:Array.isArray(state?.incidents)?state.incidents:[],cpuFailed:state?.cpuFailed===true};
 if(s.cpuFailed||s.incidents.length>=2||s.incidents.some(x=>x.route==='cpu-recovery'||x.route.startsWith('cpu-unshared')))return 'cpu-check';
 return 'normal';
}
