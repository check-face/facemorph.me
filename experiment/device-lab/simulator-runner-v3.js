// Operator-driven Safari simulator harness. Only versioned, allowlisted cases run.
import {ResultStore} from './save-client-v5.js';
import {diagnostics} from './diagnostics-v12.js';
const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);
const campaignId=query.get('campaign'), recoveryOnly=query.get('mode')==='recover';
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);return true;}catch{return false;}}};
const store=new ResultStore({onStatus:(s,ok)=>{$('saved').textContent=s;$('retry').disabled=ok;},onRecovered:(old,r)=>{if(report?.runId===old){Object.assign(report,{runId:r.runId,revision:r.revision,recoveredFromRunId:r.recoveredFromRunId,conflictFromRunId:r.conflictFromRunId,recoveryReason:r.recoveryReason});storage.set('facemorph-simulator-last',JSON.stringify(report));}}});
let report,worker,ended=false,timer;
async function persist(){store.enqueue(report);storage.set('facemorph-simulator-last',JSON.stringify(report));return store.flush();}
async function finish(patch){if(ended)return;ended=true;clearTimeout(timer);worker?.terminate();Object.assign(report.results[0],patch,{status:patch.completed?'Completed':'Failed'});report.finished=new Date().toISOString();let saved=false;try{saved=await persist();}catch(e){$('saved').textContent='Save failed: '+String(e);storage.set('facemorph-simulator-last',JSON.stringify(report));}$('state').textContent=(patch.completed?'DONE':'FAILED')+(saved?' · saved':' · save pending');$('stop').disabled=true;$('detail').textContent=JSON.stringify(report.results[0],null,2);}
async function start(){
 if(!(/iPhone|iPad|iPod/.test(navigator.platform)||(/Mac/.test(navigator.platform)&&navigator.maxTouchPoints>1)))throw Error('Open this harness inside iOS Simulator Safari. Desktop browsers are not valid simulator evidence.');
 if(!campaignId||!/^[-a-zA-Z0-9]{8,80}$/.test(campaignId))throw Error('An explicit unique campaign ID is required');
 // Recover an interrupted simulator run before making another; no auto retry on reload.
 const prior=JSON.parse(storage.get('facemorph-simulator-last')||'null');let recoveredPriorRunId=null;
 if(prior?.runId&&!prior.finished){report=prior;report.results[0].error='Simulator page reopened before completion';report.results[0].completed=false;report.results[0].status='Interrupted';report.interrupted=true;report.finished=new Date().toISOString();const saved=await persist();recoveredPriorRunId=report.runId;$('state').textContent='INTERRUPTED · '+(saved?'saved':'save pending')+'; open a new campaign URL to continue';$('stop').disabled=true;if(!recoveryOnly)return;if(!saved)throw Error('Prior interruption is not saved; recovery handshake cannot proceed');}
 if(prior?.campaignId===campaignId){report=prior;await store.flush();$('state').textContent='CAMPAIGN FINISHED · no automatic rerun';$('detail').textContent=JSON.stringify(report.results[0],null,2);$('stop').disabled=true;return;}
 const campaignKey='facemorph-simulator-campaign-'+campaignId;if(storage.get(campaignKey)){$('state').textContent='CAMPAIGN ALREADY STARTED · use a new campaign ID';$('stop').disabled=true;return;}
 if(!storage.set(campaignKey,new Date().toISOString()))throw Error('Local campaign storage unavailable; refusing automatic execution');
 if(recoveryOnly){
  report={schemaVersion:1,campaignId,test:true,started:new Date().toISOString(),platform:navigator.platform,userAgent:navigator.userAgent,executionEnvironment:{kind:'ios-simulator',declaredBy:'operator-harness',mode:'recovery-only',deviceProfile:query.get('device'),runtime:query.get('runtime'),simulatorDeviceId:query.get('udid')},selected:['simulator-recovery'],results:[{id:'simulator-recovery',completed:true,recoveredPriorRunId,inferenceAttempted:false}]};
  await store.start(report);report.finished=new Date().toISOString();const saved=await persist();$('state').textContent='RECOVERY READY · '+(saved?'saved':'save pending');$('stop').disabled=true;return;
 }
 const config=await(await fetch('./experiments-v24.json',{cache:'no-store'})).json();
 const cases={baseline:'best',candidate:'iphone-memory',cpu:'cpu-1',unshared:'cpu-unshared-1'};const id=cases[query.get('case')];if(!id)throw Error('Specify case=baseline, candidate or cpu');
 const cfg=structuredClone(config.experiments.find(e=>e.id===id));if(id==='best')cfg.fullQualification=false;if(id==='cpu-1')cfg.fullQualification=true;
 report={schemaVersion:1,campaignId,test:query.get('controlTest')==='1',...await diagnostics(config),userAgent:navigator.userAgent,secureContext:isSecureContext,crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,suiteVersion:config.version,executionEnvironment:{kind:'ios-simulator',declaredBy:'operator-harness',simulatorDeviceId:query.get('udid'),deviceProfile:(query.get('device')||'unspecified').slice(0,80),runtime:(query.get('runtime')||'unspecified').slice(0,80)},label:'SIMULATOR '+(query.get('device')||'unknown')+' / '+id,started:new Date().toISOString(),selected:[id],experimentConfig:[cfg],results:[{id,status:'Running'}]};
 await store.start(report);storage.set('facemorph-simulator-last',JSON.stringify(report));$('state').textContent='RUNNING · '+report.label;
 worker=new Worker(cfg.worker,{type:'module'});timer=setTimeout(()=>finish({completed:false,error:'Simulator experiment deadline reached'}),cfg.timeoutMs||360000);
 worker.onmessage=async({data:m})=>{if(ended)return;try{const row=report.results[0];if(m.meta)Object.assign(row,m.meta);if(m.progress)row.progress=m.progress;if(m.checkpoint)Object.assign(row,m.checkpoint);if(m.deviceLost)row.deviceLost=m.deviceLost;if(m.row&&!m.done)(row.rows??=[]).push(m.row);$('detail').textContent=JSON.stringify({progress:row.progress,stage:row.lastDiagnosticStage,checks:row.checks?.length??row.rows?.length,memory:row.gpuBufferMemory},null,2);
 if(m.done){const result=m.row||{completed:m.completed,error:m.error};if(row.deviceLost||row.gpuValidationError){result.completed=false;result.error='GPU failure invalidated simulator result';}await finish(result);}else{const saved=await persist();if(m.checkpointId&&!ended)worker.postMessage({type:'checkpoint-ack',id:m.checkpointId,saved:!!saved});}
 }catch(e){await finish({completed:false,error:'Simulator result processing: '+String(e)});}};
 worker.onerror=e=>finish({completed:false,error:'Worker error: '+e.message});worker.onmessageerror=()=>finish({completed:false,error:'Worker message decode failed'});$('stop').onclick=()=>finish({completed:false,error:'Stopped by operator'});worker.postMessage(cfg);
}
$('retry').onclick=()=>store.flush();addEventListener('online',()=>store.flush());setInterval(()=>store.flush(),30000);
start().catch(e=>{$('state').textContent='COULD NOT START';$('detail').textContent=String(e);});
