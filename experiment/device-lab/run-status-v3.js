export function runStatus({report,phase='idle',saved=false,now=Date.now()}){
 const rows=report?.results||[],done=rows.filter(r=>r.completed!==undefined).length,total=report?.selected?.length||0,failed=rows.filter(r=>r.completed===false||r.error).length;
 const elapsed=report?.started?Math.max(0,Math.floor(((report.finished?Date.parse(report.finished):now)-Date.parse(report.started))/1000)):0;
 const time=`${Math.floor(elapsed/60)}m ${elapsed%60}s`;
 if(phase==='failed')return {kind:'warning',title:'COULD NOT START — no tests running',detail:'See the error below, then reload to try again.',done:0,total:0};
 if(phase==='starting')return {kind:'running',title:'STARTING — tests are not finished',detail:'Checking device and saving connection.',done:0,total:0};
 if(phase==='running'&&!report?.finished){const active=rows.find(r=>r.completed===undefined),name=report?.experimentConfig?.find(e=>e.id===active?.id)?.name||active?.id;return {kind:'running',title:'RUNNING — please keep this tab open',detail:`${done} of ${total} experiments finished · ${time} elapsed. Keep this tab visible.`,done,total};}
 if(report?.finished){
  if(report.interrupted)return {kind:'warning',title:'INTERRUPTED — tests did not finish',detail:`The previous tab closed or reloaded. ${done} experiment(s) have partial or final results. ${saved?'Interruption and results saved.':'Results retained here; save status shown below.'} See the recovery guidance below. Heavy tests will not resume automatically.`,done,total};
  if(report.stopped||report.error)return {kind:'warning',title:report.stopped?'STOPPED — tests did not finish':'RUN ENDED EARLY — tests did not finish',detail:`${done} of ${total} experiments finished · ${time}. ${saved?'Partial results saved.':'Partial results retained; check saving below.'} You can start a new run.`,done,total};
  return {kind:saved?'done':'saving',title:saved?'DONE — tests finished and results saved':saved===null?'TESTS FINISHED — save status unavailable':'TESTS FINISHED — saving results',detail:`${done} of ${total} experiments finished · ${time} · ${failed} failed or unsupported. ${saved?'You can close this tab. Nothing to send us.':saved===null?'No tests are running. This previous result is retained on this device.':'No experiments are running. Keep this tab open until saving is confirmed below.'}`,done,total};
 }
 return {kind:'idle',title:'READY — tests have not started',detail:'Press Run experiments. Wait for DONE before closing this tab.',done:0,total:0};
}
export function paintRunStatus(state,root=document){
 const box=root.querySelector('#run-state');if(!box)return;
 box.dataset.state=state.kind;root.querySelector('#run-state-title').textContent=state.title;root.querySelector('#run-state-detail').textContent=state.detail;
 const progress=root.querySelector('#run-progress');progress.max=Math.max(1,state.total);progress.value=state.done;progress.hidden=!state.total;progress.setAttribute('aria-label',`${state.done} of ${state.total} experiments finished`);
 box.setAttribute('aria-busy',state.kind==='running'?'true':'false');
 document.title=(state.kind==='running'?'Running · ':state.kind==='done'?'Done · ':state.kind==='warning'?'Incomplete · ':'')+'Facemorph device lab';
}
