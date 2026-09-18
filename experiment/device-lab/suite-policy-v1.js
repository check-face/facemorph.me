// Research selection only: capability checks are not product qualification.
export function planSuite(config, device, environment){
 const rules=config.automaticSuite.rules;
 const ids=config.experiments.map(e=>e.id);
 if(new Set(ids).size!==ids.length||ids.some(id=>!rules[id]))throw Error('Incomplete or duplicate suite policy');
 const binding=device.gpu?.limits?.maxStorageBufferBindingSize;
 const gpu=!!device.gpu;
 const threads=environment.crossOriginIsolated?Math.min(4,environment.hardwareConcurrency||1):1;
 const facts={gpu,bindingBytes:binding??null,effectiveCpuThreads:threads,classification:!gpu?'cpu-only':binding>=134742528?'large-binding-gpu':binding>=134217728?'bounded-binding-gpu':'limited-or-unknown-gpu'};
 const match={always:true,gpu,large:gpu&&binding>=134742528,bounded:gpu&&binding>=134217728&&binding<134742528,threads2:threads>=2&&threads<4,threads4:threads>=4,weight1:threads<4};
 const decisions=config.experiments.map(e=>{const rule=rules[e.id];if(!(rule.when in match)&&rule.when!=='off')throw Error('Unknown selection rule '+rule.when);const selected=rule.when!=='off'&&match[rule.when];return {id:e.id,name:e.name,status:selected?(rule.after?'pending':'selected'):'skipped',reason:selected?rule.reason:rule.when==='off'?rule.reason:`Capability rule ${rule.when} not met`,...(selected&&rule.after?{after:rule.after}:{}),rule:structuredClone(rule)};});
 return {policyId:config.automaticSuite.id,facts,decisions};
}
export function resolveDecision(decision, results){
 if(decision.status==='skipped')return false;
 if(!decision.after)return true;
 const prior=results.find(r=>r.id===decision.after.id);
 const passed=prior?.completed===true&&!prior.error;
 const run=!!prior&&(decision.after.outcome==='passed'?passed:prior.completed===false||!!prior.error);
 decision.status=run?'selected':'skipped';
 if(!run)decision.reason=`Follow-up requires ${decision.after.id} to ${decision.after.outcome==='passed'?'pass':'fail'}; condition not met. ${decision.rule.reason}`;
 return run;
}
