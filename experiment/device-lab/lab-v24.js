import {runStatus,paintRunStatus} from './run-status-v2.js';
import {planSuite,resolveDecision,applyInterruptedRoutes} from './suite-policy-v3.js';
import {ResultStore} from './save-client-v5.js';
import {diagnostics} from './diagnostics-v12.js';
import {checkMP4} from './video-compat-v3.js';
const $=s=>document.querySelector(s);
let phase='idle',saveConfirmed=false;
function updateRunStatus(){paintRunStatus(runStatus({report,phase,saved:saveConfirmed?true:store.entries.has(report?.runId)?false:null}));}
let config,report,worker,halt=false,active,cancelCurrent;
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
const persistLast=()=>report&&storage.set('facemorph-lab-last',JSON.stringify(report));
const store=new ResultStore({onStatus:(message,ok)=>{$('#saved').textContent=message;$('#retry').disabled=ok;saveConfirmed=ok&&!!report?.runId&&!store.entries.has(report.runId);if(saveConfirmed)storage.set('facemorph-lab-last-saved',JSON.stringify({runId:report.runId,revision:report.revision}));updateRunStatus();},onRecovered:(old,r)=>{if(report?.runId===old){Object.assign(report,{runId:r.runId,revision:r.revision,recoveredFromRunId:r.recoveredFromRunId,recoveryReason:r.recoveryReason,conflictFromRunId:r.conflictFromRunId});persistLast();render();}}});
function outcome(r){
 if(r.error||r.completed===false)return r.unsupported||/unavailable|unsupported|binding|device limit|exceeds/.test(r.error||'')?'Unsupported / failed':'Failed / stopped';
 if(r.completed)return r.diagnosticOnly?'Diagnostic completed (one face)':'Checks passed';return r.progress||r.status||'Running';
}
function render(){updateRunStatus();if(!report)return;const results=report.results||[];$('.table').hidden=results.length===0;const synthesis=results.filter(r=>!['ffmpeg','colour'].includes(r.id)&&!r.diagnosticOnly);const passed=synthesis.filter(r=>r.completed===true&&!r.error);
 $('#admission').textContent=passed.length?'Reference checks passed for '+passed.length+' synthesis path(s). Full qualification, recovery and memory checks still gate product generation.':'No passing synthesis route yet. Failed paths are unusable; try a validated CPU route or a supported desktop.';
 const finished=results.filter(r=>r.completed!==undefined).length,failed=results.filter(r=>r.completed===false||r.error).length;
 $('#summary').textContent=`Run ${report.runId?.slice(0,8)||'not started'} · ${finished}/${report.selected?.length||0} experiments finished · ${results.filter(r=>r.completed===true&&!r.error).length} passed · ${failed} failed/unsupported. Device: ${report.label||report.platform||'unlabelled'} (${report.deviceId?.slice(0,8)||'ID unavailable'}).`;
 $('pre').textContent=JSON.stringify(report,null,2);const body=$('tbody');body.replaceChildren();
 for(const row of results){const tr=document.createElement('tr');const valid=row.completed===true&&!row.error;const checks=row.checks||row.rows||[];const count=checks.filter(x=>x.passed===true).length;
  for(const value of [report.experimentConfig?.find(e=>e.id===row.id)?.name||row.id,valid?(row.encodeMs?row.encodeMs.toFixed(1)+' ms encode':row.singleMedianMs?row.singleMedianMs.toFixed(1)+' ms':row.medianInferenceMs?row.medianInferenceMs.toFixed(1)+' ms':'—'):'—',Number.isFinite(row.loadMs)?(row.loadMs/1000).toFixed(2)+' s':'—',valid&&row.msPerFace?row.msPerFace.toFixed(1)+' ms/face':'—',outcome(row)+(checks.length?` · ${count}/${checks.length} reference checks`:''),row.error||row.progress||'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
 }$('#download').disabled=false;
}
function save(){if(!report)return;saveConfirmed=false;store.enqueue(report);persistLast();render();return store.flush();}
function preview(cfg,m){if(m.rgba||m.referenceRgba||m.preview)$('.previews').hidden=false;if(m.rgba)$('#actual').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.rgba),1024,1024),0,0);
 if(m.preview){const p=m.preview;$('#preview-label').textContent=cfg.name+' · '+p.name+' · '+(p.passed?'Reference check passed':'INVALID OUTPUT — do not use')+(p.noise&&p.noise!=='original'?' · altered-noise stress fixture':'');$('#preview-label').style.color=p.passed?'#b5ed80':'#ff9999';if(p.reference){$('#reference').hidden=false;$('#reference').src=p.reference;$('#reference-canvas').hidden=true;}}
 if(m.referenceRgba){$('#reference').hidden=true;$('#reference-canvas').hidden=false;$('#reference-canvas').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.referenceRgba),1024,1024),0,0);}
}
function execute(cfg){return new Promise(resolve=>{
 const row={id:cfg.id,status:'Running',rows:[],started:new Date().toISOString()};active=row;report.results.push(row);let last=Date.now(),ended=false,timer,start=last,instance;
 const finish=patch=>{if(ended)return;ended=true;clearInterval(timer);Object.assign(row,patch,{status:patch.completed?'Completed':'Failed',finished:new Date().toISOString(),elapsedMs:Date.now()-start});instance?.terminate();if(worker===instance)worker=null;cancelCurrent=null;save();resolve();};
 cancelCurrent=reason=>finish({completed:false,error:reason||'Stopped by tester'});
 try{instance=new Worker(cfg.worker,{type:'module'});worker=instance;
  timer=setInterval(()=>{const elapsed=Date.now()-start;if(!row.lastBrowserHeartbeatAt||Date.now()-Date.parse(row.lastBrowserHeartbeatAt)>=10000){row.lastBrowserHeartbeatAt=new Date().toISOString();row.lastWorkerMessageAgeMs=Date.now()-last;save();}updateRunStatus();$('#status').textContent=cfg.name+'\n'+(row.progress||'Starting worker…')+'\nElapsed '+Math.floor(elapsed/1000)+'s · '+(navigator.onLine?'online':'offline; results queued');if(Date.now()-last>180000)finish({completed:false,error:'No worker progress for 180 seconds; terminated. Try another route.'});else if(elapsed>(cfg.timeoutMs||480000))finish({completed:false,error:'Experiment time budget reached; partial results retained.'});},1000);
  instance.onmessage=async({data:m})=>{if(ended)return;last=Date.now();row.lastWorkerMessageAt=new Date().toISOString();try{
   if(m.progress){row.progress=m.progress;row.lastProgressAt=new Date().toISOString();}if(m.deviceLost)row.deviceLost=m.deviceLost;if(m.meta)Object.assign(row,m.meta);if(m.checkpoint)Object.assign(row,m.checkpoint);if(m.row&&!m.done)row.rows.push(m.row);preview(cfg,m);
   if(m.done){const result=m.row||{completed:m.completed,error:m.error};if(m.video){result.browserPlayback=await checkMP4(m.video,result);if(ended)return;if(!result.browserPlayback.passed){result.completed=false;result.error=result.browserPlayback.error;}}if(row.deviceLost||row.gpuValidationError){result.completed=false;result.error='GPU failure invalidated this result';}finish(result);}else if(m.checkpoint||m.row||m.meta||m.progress){const saved=await save();if(m.checkpointId)instance.postMessage({type:'checkpoint-ack',id:m.checkpointId,saved:!!saved});}
  }catch(e){finish({completed:false,error:'Result processing failed: '+String(e)});}};
  instance.onerror=e=>finish({completed:false,error:'Worker failed: '+(e.message||'Module worker stopped before reporting details'),workerError:{type:e.type||'error',message:e.message||null,workerURL:new URL(cfg.worker,location.href).href,lastProgress:row.progress||null,lastStage:row.workerStartup||row.lastDiagnosticStage||null,filename:e.filename||null,line:e.lineno||null,column:e.colno||null}});instance.onmessageerror=()=>finish({completed:false,error:'Worker message could not be decoded'});
  instance.postMessage({...cfg,fullQualification:cfg.fullQualification??report.fullQualification});save();
 }catch(e){finish({completed:false,error:'Could not start experiment: '+String(e)});}
 });}
function showPlan(plan){
 $('#research-cases').replaceChildren();
 for(const d of plan.decisions){const li=document.createElement('li');li.textContent=d.name+' — '+d.status+': '+d.reason;$('#research-cases').append(li);}
 const count=plan.decisions.filter(d=>d.status!=='skipped').length;
 $('#suite-info').textContent=`${count} selected or conditional experiments for ${plan.facts.classification}. Selection and skip reasons are saved automatically.`;
}
function controls(running){$('#run').disabled=running;$('#stop').disabled=!running;$('#skip').disabled=!running;for(const el of document.querySelectorAll('#label'))el.disabled=running;}
async function run(){report=null;active=null;phase='starting';saveConfirmed=false;updateRunStatus();controls(true);halt=false;let vis,wake;
 try{
  $('#status').textContent='Checking device and confirming automatic saving before downloading models…';
  const device=await diagnostics(config);const selection=applyInterruptedRoutes(planSuite(config,device,{crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency}),JSON.parse(storage.get('facemorph-interrupted-routes')||'[]'),config.version);const selected=selection.decisions.filter(d=>d.status!=='skipped').map(d=>config.experiments.find(e=>e.id===d.id));showPlan(selection);report={schemaVersion:1,...device,...(globalThis.__facemorphSimulatorContext||{}),selection,preflightPolicy:config.policyVersion,fullQualification:config.automaticSuite.fullQualification===true,reverseOrder:false,automaticSuite:structuredClone(config.automaticSuite),suiteVersion:config.version,started:new Date().toISOString(),label:$('#label').value,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,secureContext:isSecureContext,crossOriginIsolated,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio},selected:selected.map(e=>e.id),experimentConfig:selected,visibility:[],results:[]};
  await store.start(report);persistLast();phase='running';render();if(halt){report.finished=new Date().toISOString();report.stopped=true;await save();return;}
  vis=()=>{report.visibility.push({at:new Date().toISOString(),state:document.visibilityState});save();};document.addEventListener('visibilitychange',vis);vis();try{wake=await navigator.wakeLock?.request('screen');}catch{}
  for(const cfg of selected){if(halt)break;const decision=selection.decisions.find(d=>d.id===cfg.id);if(!resolveDecision(decision,report.results)){report.selected=report.selected.filter(id=>id!==cfg.id);showPlan(selection);save();continue;}await execute(cfg);decision.status='executed';showPlan(selection);save();}
  report.finished=new Date().toISOString();report.stopped=halt;document.removeEventListener('visibilitychange',vis);vis=null;const saved=await save();$('#status').textContent=(halt?'Stopped. Partial results retained.':'Suite finished. Review the pass/fail table and reference images below.')+(saved?' Results saved automatically.':' Results are queued for automatic retry. Keep this tab or reopen this site when online.');
 }catch(e){if(!report?.runId)phase='failed';$('#status').textContent=String(e.message||e);if(report?.runId){report.error=String(e);report.finished=new Date().toISOString();save();}}
 finally{if(vis)document.removeEventListener('visibilitychange',vis);try{await wake?.release();}catch{}if(phase!=='failed')phase='idle';controls(false);updateRunStatus();}
}

function browserEvent(type,details={}){if(!report?.runId||report.finished)return;report.browserEvents??=[];report.browserEvents.push({type,at:new Date().toISOString(),visibility:document.visibilityState,...details});if(report.browserEvents.length>50)report.browserEvents.shift();save();}
addEventListener('error',e=>browserEvent('window-error',{message:String(e.message||'Resource error').slice(0,2000),filename:e.filename||null,line:e.lineno||null}));
addEventListener('unhandledrejection',e=>browserEvent('unhandled-rejection',{message:String(e.reason).slice(0,2000)}));
addEventListener('pagehide',e=>browserEvent('pagehide',{persisted:e.persisted}));
addEventListener('pageshow',e=>browserEvent('pageshow',{persisted:e.persisted}));
addEventListener('offline',()=>browserEvent('offline'));addEventListener('online',()=>browserEvent('online'));
document.addEventListener('visibilitychange',()=>browserEvent('visibilitychange'));

async function init(){try{
 const response=await fetch('./experiments-v24.json',{cache:'no-store'});if(!response.ok)throw Error('Experiment configuration HTTP '+response.status);config=await response.json();
 $('#suite-info').textContent='One click selects useful experiments from device capabilities, then uses reference results to decide follow-ups.';

 try{const prior=JSON.parse(storage.get('facemorph-lab-last'));if(prior?.runId&&Array.isArray(prior.results)){report=prior;const ack=JSON.parse(storage.get('facemorph-lab-last-saved')||'null');saveConfirmed=ack?.runId===report.runId&&ack?.revision===report.revision;if(!report.finished){const blocked=JSON.parse(storage.get('facemorph-interrupted-routes')||'[]');for(const r of report.results)if(r.completed===undefined&&!blocked.some(b=>b.id===r.id&&b.version===report.suiteVersion))blocked.push({id:r.id,version:report.suiteVersion,runId:report.runId});storage.set('facemorph-interrupted-routes',JSON.stringify(blocked.slice(-32)));report.finished=new Date().toISOString();report.interrupted=true;report.resumeDiagnostics={navigationType:performance.getEntriesByType('navigation')[0]?.type||'unknown',documentWasDiscarded:document.wasDiscarded??null,resumedAt:new Date().toISOString()};saveConfirmed=false;for(const row of report.results)if(row.completed===undefined){row.completed=false;row.status='Interrupted';row.error='Previous tab closed or reloaded before completion';}report.revision=Math.max(report.revision||0,store.entries.get(report.runId)?.report.revision||0)+1;const pending=store.entries.get(report.runId);store.put({...pending,token:pending?.token??null,report:structuredClone(report)});persistLast();}if(report.interrupted){const blocked=JSON.parse(storage.get('facemorph-interrupted-routes')||'[]');for(const r of report.results)if(r.error==='Previous tab closed or reloaded before completion'&&!blocked.some(b=>b.id===r.id&&b.version===report.suiteVersion))blocked.push({id:r.id,version:report.suiteVersion,runId:report.runId});storage.set('facemorph-interrupted-routes',JSON.stringify(blocked.slice(-32)));}render();}}catch{}
 await store.importLegacy();await store.flush();
 $('#run').onclick=run;$('#stop').onclick=()=>{halt=true;cancelCurrent?.('Stopped by tester');};$('#skip').onclick=()=>cancelCurrent?.('Skipped by tester');$('#retry').onclick=()=>store.flush();
 $('#share').onclick=async()=>{const link=location.origin+location.pathname;try{await navigator.clipboard.writeText(link);$('#share').textContent='Link copied';}catch{$('#saved').textContent='Share this page address: '+link;}};
 $('#download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='facemorph-'+report.runId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

 addEventListener('online',()=>store.flush());setInterval(()=>store.flush(),30000);controls(false);
 updateRunStatus();$('#status').textContent=report?.finished?'Previous run shown below.':'Ready to run.';
 fetch('./research-status-v9.json').then(r=>r.json()).then(s=>{$('#native-status').textContent=s.native.map(r=>r.path+': '+(r.full31Passed?'31/31 passed. ':'')+r.conclusion).join('\n')+'\nPending: '+s.pendingTargets.join('; ');}).catch(()=>{});
 }catch(e){phase='failed';updateRunStatus();$('#status').textContent='The lab could not initialize: '+String(e)+'. Reload this page when connected.';$('#run').disabled=true;}}
init();
