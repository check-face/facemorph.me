import {ResultStore} from './save-client-v3.js';
import {diagnostics} from './diagnostics-v11.js';
import {checkMP4} from './video-compat-v2.js';
const $=s=>document.querySelector(s);
let config,report,worker,halt=false,active,cancelCurrent;
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
const persistLast=()=>report&&storage.set('facemorph-lab-last',JSON.stringify(report));
const store=new ResultStore({onStatus:(message,ok)=>{$('#saved').textContent=message;$('#retry').disabled=ok;},onRecovered:(old,r)=>{if(report?.runId===old){Object.assign(report,{runId:r.runId,revision:r.revision,recoveredFromRunId:r.recoveredFromRunId,recoveryReason:r.recoveryReason});persistLast();render();}}});
function outcome(r){
 if(r.error||r.completed===false)return r.unsupported||/unavailable|unsupported|binding|device limit|exceeds/.test(r.error||'')?'Unsupported / failed':'Failed / stopped';
 if(r.completed)return 'Checks passed';return r.progress||r.status||'Running';
}
function render(){if(!report)return;const results=report.results||[],synthesis=results.filter(r=>!['ffmpeg','colour'].includes(r.id));const passed=synthesis.filter(r=>r.completed===true&&!r.error);
 $('#admission').textContent=passed.length?'Reference checks passed for '+passed.length+' synthesis path(s). Full qualification, recovery and memory checks still gate product generation.':'No passing synthesis route yet. Failed paths are unusable; try a validated CPU route or a supported desktop.';
 const finished=results.filter(r=>r.completed!==undefined).length,failed=results.filter(r=>r.completed===false||r.error).length;
 $('#summary').textContent=`Run ${report.runId?.slice(0,8)||'not started'} · ${finished}/${report.selected?.length||0} experiments finished · ${results.filter(r=>r.completed===true&&!r.error).length} passed · ${failed} failed/unsupported. Device: ${report.label||report.platform||'unlabelled'} (${report.deviceId?.slice(0,8)||'ID unavailable'}).`;
 $('pre').textContent=JSON.stringify(report,null,2);const body=$('tbody');body.replaceChildren();
 for(const row of results){const tr=document.createElement('tr');const valid=row.completed===true&&!row.error;const checks=row.checks||row.rows||[];const count=checks.filter(x=>x.passed===true).length;
  for(const value of [report.experimentConfig?.find(e=>e.id===row.id)?.name||row.id,valid?(row.encodeMs?row.encodeMs.toFixed(1)+' ms encode':row.singleMedianMs?row.singleMedianMs.toFixed(1)+' ms':row.medianInferenceMs?row.medianInferenceMs.toFixed(1)+' ms':'—'):'—',Number.isFinite(row.loadMs)?(row.loadMs/1000).toFixed(2)+' s':'—',valid&&row.msPerFace?row.msPerFace.toFixed(1)+' ms/face':'—',outcome(row)+(checks.length?` · ${count}/${checks.length} reference checks`:''),row.error||row.progress||'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
 }$('#download').disabled=false;
}
function save(){if(!report)return;store.enqueue(report);persistLast();render();return store.flush();}
function preview(cfg,m){if(m.rgba)$('#actual').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.rgba),1024,1024),0,0);
 if(m.preview){const p=m.preview;$('#preview-label').textContent=cfg.name+' · '+p.name+' · '+(p.passed?'Reference check passed':'INVALID OUTPUT — do not use')+(p.noise&&p.noise!=='original'?' · altered-noise stress fixture':'');$('#preview-label').style.color=p.passed?'#b5ed80':'#ff9999';if(p.reference){$('#reference').hidden=false;$('#reference').src=p.reference;$('#reference-canvas').hidden=true;}}
 if(m.referenceRgba){$('#reference').hidden=true;$('#reference-canvas').hidden=false;$('#reference-canvas').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.referenceRgba),1024,1024),0,0);}
}
function execute(cfg){return new Promise(resolve=>{
 const row={id:cfg.id,status:'Running',rows:[],started:new Date().toISOString()};active=row;report.results.push(row);let last=Date.now(),ended=false,timer,start=last,instance;
 const finish=patch=>{if(ended)return;ended=true;clearInterval(timer);Object.assign(row,patch,{finished:new Date().toISOString(),elapsedMs:Date.now()-start});instance?.terminate();if(worker===instance)worker=null;cancelCurrent=null;save();resolve();};
 cancelCurrent=reason=>finish({completed:false,error:reason||'Stopped by tester'});
 try{instance=new Worker(cfg.worker,{type:'module'});worker=instance;
  timer=setInterval(()=>{const elapsed=Date.now()-start;$('#status').textContent=cfg.name+'\n'+(row.progress||'Starting worker…')+'\nElapsed '+Math.floor(elapsed/1000)+'s · '+(navigator.onLine?'online':'offline; results queued');if(Date.now()-last>180000)finish({completed:false,error:'No worker progress for 180 seconds; terminated. Try another route.'});else if(elapsed>480000)finish({completed:false,error:'Eight-minute experiment limit reached; partial results retained.'});},1000);
  instance.onmessage=async({data:m})=>{if(ended)return;last=Date.now();try{
   if(m.progress){row.progress=m.progress;row.lastProgressAt=new Date().toISOString();}if(m.deviceLost)row.deviceLost=m.deviceLost;if(m.meta)Object.assign(row,m.meta);if(m.checkpoint)Object.assign(row,m.checkpoint);if(m.row&&!m.done)row.rows.push(m.row);preview(cfg,m);
   if(m.done){const result=m.row||{completed:m.completed,error:m.error};if(m.video){result.browserPlayback=await checkMP4(m.video,result);if(ended)return;if(!result.browserPlayback.passed){result.completed=false;result.error=result.browserPlayback.error;}}if(row.deviceLost||row.gpuValidationError){result.completed=false;result.error='GPU failure invalidated this result';}finish(result);}else if(m.checkpoint||m.row||m.meta||m.progress)save();
  }catch(e){finish({completed:false,error:'Result processing failed: '+String(e)});}};
  instance.onerror=e=>finish({completed:false,error:'Worker failed: '+e.message});instance.onmessageerror=()=>finish({completed:false,error:'Worker message could not be decoded'});
  instance.postMessage({...cfg,fullQualification:report.fullQualification});save();
 }catch(e){finish({completed:false,error:'Could not start experiment: '+String(e)});}
 });}
function automaticExperiments(){
 const suite=config.automaticSuite,ids=suite?.experimentIds;
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Invalid automatic experiment suite');
 return ids.map(id=>{const matches=config.experiments.filter(e=>e.id===id);if(matches.length!==1)throw Error('Unknown or duplicate experiment '+id);return matches[0];});
}
function controls(running){$('#run').disabled=running;$('#stop').disabled=!running;$('#skip').disabled=!running;for(const el of document.querySelectorAll('#label'))el.disabled=running;}
async function run(){const selected=automaticExperiments();controls(true);halt=false;let vis,wake;
 try{
  $('#status').textContent='Checking device and confirming automatic saving before downloading models…';
  const device=await diagnostics(config);report={schemaVersion:1,...device,preflightPolicy:config.policyVersion,fullQualification:config.automaticSuite.fullQualification===true,reverseOrder:false,automaticSuite:structuredClone(config.automaticSuite),suiteVersion:config.version,started:new Date().toISOString(),label:$('#label').value,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,secureContext:isSecureContext,crossOriginIsolated,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio},selected:selected.map(e=>e.id),experimentConfig:selected,visibility:[],results:[]};
  await store.start(report);persistLast();render();if(halt)return;
  vis=()=>{report.visibility.push({at:new Date().toISOString(),state:document.visibilityState});save();};document.addEventListener('visibilitychange',vis);vis();try{wake=await navigator.wakeLock?.request('screen');}catch{}
  for(const cfg of selected){if(halt)break;await execute(cfg);}
  report.finished=new Date().toISOString();report.stopped=halt;document.removeEventListener('visibilitychange',vis);vis=null;const saved=await save();$('#status').textContent=(halt?'Stopped. Partial results retained.':'Suite finished. Review the pass/fail table and reference images below.')+(saved?' Results saved automatically.':' Results are queued for automatic retry. Keep this tab or reopen this site when online.');
 }catch(e){$('#status').textContent=String(e.message||e);if(report?.runId){report.error=String(e);report.finished=new Date().toISOString();save();}}
 finally{if(vis)document.removeEventListener('visibilitychange',vis);try{await wake?.release();}catch{}controls(false);}
}
async function init(){try{
 const response=await fetch('./experiments-v13.json',{cache:'no-store'});if(!response.ok)throw Error('Experiment configuration HTTP '+response.status);config=await response.json();
 const selected=automaticExperiments();
 $('#suite-info').textContent=`${selected.length} experiments run automatically, in the same order on every device. No experiment choices are needed.`;
 for(const e of selected){const li=document.createElement('li');li.textContent=e.name;$('#research-cases').append(li);}

 try{const prior=JSON.parse(storage.get('facemorph-lab-last'));if(prior?.runId&&Array.isArray(prior.results)){report=prior;if(!report.finished){report.finished=new Date().toISOString();report.interrupted=true;for(const row of report.results)if(row.completed===undefined){row.completed=false;row.error='Previous tab closed or reloaded before completion';}if(!store.entries.has(report.runId))store.put({token:null,report:structuredClone(report)});}render();}}catch{}
 await store.importLegacy();await store.flush();
 $('#run').onclick=run;$('#stop').onclick=()=>{halt=true;cancelCurrent?.('Stopped by tester');};$('#skip').onclick=()=>cancelCurrent?.('Skipped by tester');$('#retry').onclick=()=>store.flush();
 $('#share').onclick=async()=>{const link=location.origin+location.pathname;try{await navigator.clipboard.writeText(link);$('#share').textContent='Link copied';}catch{$('#saved').textContent='Share this page address: '+link;}};
 $('#download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='facemorph-'+report.runId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

 addEventListener('online',()=>store.flush());setInterval(()=>store.flush(),30000);controls(false);
 $('#status').textContent='Ready. Press Run experiments and leave this tab visible. All research candidates run automatically; saving is checked before starting.';
 fetch('./research-status-v9.json').then(r=>r.json()).then(s=>{$('#native-status').textContent=s.native.map(r=>r.path+': '+(r.full31Passed?'31/31 passed. ':'')+r.conclusion).join('\n')+'\nPending: '+s.pendingTargets.join('; ');}).catch(()=>{});
 }catch(e){$('#status').textContent='The lab could not initialize: '+String(e)+'. Reload this page when connected.';$('#run').disabled=true;}}
init();
