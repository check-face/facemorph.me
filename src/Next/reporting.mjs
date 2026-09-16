// An allowlist, not arbitrary error/string serialization. No pre-consent backlog.
const allowedStages=new Set(['asset-acquisition','runtime-loading','model-loading','model-loaded','mapping-loading','mapping','canary','synthesis','synthesis-complete','alignment','alignment-complete','encoder-loading','encoder-loaded','encoder-correctness-check','encoder-correctness-complete','encoding','encoding-complete','mapping-complete','original-cache-hit','original-cached','cache-unavailable','codec-loading','face','morph','export','route-admitted']);
let bundle,provider,device=null,consented=false,session=null,run=null,started=0,last=0,aborters=new Set();
const CONSENT='facemorph-debug-consent-v1';
function remember(value){try{if(value)localStorage.setItem(CONSENT,'on');else localStorage.removeItem(CONSENT);}catch{}}
function notice(status,reference=run){window.dispatchEvent(new CustomEvent('facemorph-report-status',{detail:{status,reference:reference||''}}));}
function environment(){
 const ua=navigator.userAgent,version=Number((ua.match(/(?:Firefox|FxiOS|Chrome|Chromium|CriOS|Edg|Version)\/(\d+)/)||[])[1])||undefined,ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 return {browserMajor:version,platform:ios?'ios':/Android/.test(ua)?'android':/Mac/.test(ua)?'macos':/Windows/.test(ua)?'windows':/Linux/.test(ua)?'linux':'other',browser:/Firefox|FxiOS/.test(ua)?'firefox':/Chrome|Chromium|CriOS|Edg/.test(ua)?'chromium':/Safari/.test(ua)?'safari':'other',...machine()};
}
/**
 * The machine facts that explain a timing after the fact: how many cores were available, how much
 * memory the browser admits to, whether cross-origin isolation (and therefore threads) was in
 * force. Coarse, bounded numbers already exposed to any page; nothing identifying.
 */
function machine(){
 const cores=Number(navigator.hardwareConcurrency);
 const memory=Number(navigator.deviceMemory);
 return {
  cores:Number.isInteger(cores)&&cores>0&&cores<=256?cores:undefined,
  memoryGb:Number.isFinite(memory)&&memory>0&&memory<=1024?Math.round(memory):undefined,
  isolated:typeof globalThis.crossOriginIsolated==='boolean'?globalThis.crossOriginIsolated:undefined
 };
}
function buildId(){try{return process.env.FACEMORPH_BUILD_ID||'development';}catch{return 'development';}}
const ERROR_KINDS=['aborted','memory','integrity','network','unsupported','timeout','storage','decode','unknown'];
/** Buckets an error by class without ever forwarding its message. */
function classify(error){
 const name=String(error?.name||''),text=String(error?.message||'');
 if(name==='AbortError')return 'aborted';
 if(name==='QuotaExceededError'||/quota|storage/i.test(text))return 'storage';
 if(name==='NotSupportedError'||/not supported|unsupported/i.test(text))return 'unsupported';
 if(name==='RangeError'||/out of memory|allocation|Array buffer allocation/i.test(text))return 'memory';
 if(/checksum|sha|integrity|verified|tamper/i.test(text))return 'integrity';
 if(name==='TimeoutError'||/timed out|timeout|deadline/i.test(text))return 'timeout';
 if(name==='TypeError'&&/fetch|network|load failed/i.test(text))return 'network';
 if(/decode|codec|image could not|could not be read/i.test(text))return 'decode';
 return 'unknown';
}
const enabled=()=>consented;
function off(){consented=false;session=null;run=null;for(const controller of aborters)controller.abort();aborters.clear();}
function on(){off();consented=true;session=crypto.randomUUID();try{device=localStorage.getItem('facemorph-debug-device-v1');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(device||'')){device=crypto.randomUUID();localStorage.setItem('facemorph-debug-device-v1',device);}}catch{device=crypto.randomUUID();}}
// Operator decision, 17 September: log generously and stage locally, so a tester who only
// decides to help *after* something breaks can still send what led up to it. Staging is memory
// only and never leaves the device: an upload still requires an explicit yes, and declining or
// turning reporting off discards the buffer. This replaces the earlier rule that prior records
// are never uploaded; it does not weaken "nothing is sent before consent".
const STAGE_LIMIT=500;
let staged=[];
function stash(event){staged.push(event);if(staged.length>STAGE_LIMIT)staged.shift();}
/** Sends what was staged before consent, oldest first, once the tester agrees. */
function flush(){const pending=staged;staged=[];for(const event of pending)void deliver(event);}
async function send(event){if(!enabled()){stash(event);return;}return deliver(event);}
async function deliver(event){if(!enabled()){off();return;}const sendingSession=session,sendingRun=run,controller=new AbortController();aborters.add(controller);const timer=setTimeout(()=>controller.abort(),10000);try{
 const response=await fetch('https://next.facemorph.me/diagnostics/events',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Facemorph-Diagnostics-Consent':'session-v1'},signal:controller.signal,body:JSON.stringify({schemaVersion:1,session,run,device,provider,bundle,...event})});
 if(enabled()&&session===sendingSession)notice(response.ok?'sent':'failed',sendingRun);
 }catch{if(enabled()&&session===sendingSession)notice('failed',sendingRun);}finally{clearTimeout(timer);aborters.delete(controller);}}
export const diagnostics={
 enable(value){if(value){on();remember(true);notice('enabled');flush();}else{off();remember(false);staged=[];notice('disabled');}},
 // Restores a previous explicit opt-in: reporting stays on across reloads until it is turned off.
 restore(){let saved=null;try{saved=localStorage.getItem(CONSENT);}catch{}if(saved!=='on'||consented)return false;on();notice('enabled');return true;},
 bundle(value){bundle=/^[a-f0-9]{64}$/.test(value||'')?value:undefined;},
 start(action,requestedProvider='auto'){provider=['auto','cpu','webgl','webgpu'].includes(requestedProvider)?requestedProvider:'auto';run=crypto.randomUUID();started=performance.now();last=0;void send({event:'start',action:action==='morph'?'morph':'faces',...environment(),language:navigator.language.replace(/[^A-Za-z-]/g,'').slice(0,20),build:buildId()});},
 stage(stage,event={}){
  // Route facts travel with the route-admitted stage; they are closed vocabularies, not free text.
  if(stage==='route-admitted'&&run){void send({event:'stage',stage,gpu:event.gpu,routeOutcome:event.routeOutcome,provider:['cpu','webgl','webgpu'].includes(event.provider)?event.provider:undefined,elapsedMs:Math.round(performance.now()-started)});return;}if(['cpu','webgl','webgpu','native-cpu','native-gpu'].includes(event.provider))provider=event.provider;if(!run||!allowedStages.has(stage))return;const timing=Number.isFinite(event.elapsedMs)?Math.round(event.elapsedMs):undefined;if(timing===undefined&&performance.now()-last<1000)return;last=performance.now();void send({event:'stage',stage,elapsedMs:Math.round(performance.now()-started),stageMs:timing});},
 /**
  * A failure records where it happened and what kind it was, from closed vocabularies. The error's
  * own text is never sent: it can carry a filename, a URL or a user's input.
  */
 finish(status,error,context={}){if(!run)return;void send({event:status,elapsedMs:Math.round(performance.now()-started),errorCode:error?(error.name==='AbortError'?'cancelled':'operation_failed'):undefined,errorStage:allowedStages.has(context.stage)?context.stage:undefined,errorKind:error?classify(error):undefined});},
 status(){return {enabled:enabled(),reference:run,staged:staged.length};}
};
