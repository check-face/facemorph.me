// An allowlist, not arbitrary error/string serialization. No pre-consent backlog.
const allowedStages=new Set(['asset-acquisition','runtime-loading','model-loading','model-loaded','mapping-loading','mapping','canary','synthesis','synthesis-complete','alignment','alignment-complete','encoder-loading','encoder-loaded','encoder-correctness-check','encoder-correctness-complete','encoding','encoding-complete','mapping-complete','original-cache-hit','original-cached','cache-unavailable','codec-loading','face','morph','export']);
let bundle,provider,device=null,until=0,session=null,run=null,started=0,last=0,expiry,aborters=new Set();
function notice(status,reference=run){window.dispatchEvent(new CustomEvent('facemorph-report-status',{detail:{status,reference:reference||''}}));}
function environment(){
 const ua=navigator.userAgent,version=Number((ua.match(/(?:Firefox|FxiOS|Chrome|Chromium|CriOS|Edg|Version)\/(\d+)/)||[])[1])||undefined,ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 return {browserMajor:version,platform:ios?'ios':/Android/.test(ua)?'android':/Mac/.test(ua)?'macos':/Windows/.test(ua)?'windows':/Linux/.test(ua)?'linux':'other',browser:/Firefox|FxiOS/.test(ua)?'firefox':/Chrome|Chromium|CriOS|Edg/.test(ua)?'chromium':/Safari/.test(ua)?'safari':'other'};
}
function buildId(){try{return process.env.FACEMORPH_BUILD_ID||'development';}catch{return 'development';}}
const enabled=()=>until>Date.now();
function off(){clearTimeout(expiry);until=0;session=null;run=null;for(const controller of aborters)controller.abort();aborters.clear();}
async function send(event){if(!enabled()){off();return;}const sendingSession=session,sendingRun=run,controller=new AbortController();aborters.add(controller);const timer=setTimeout(()=>controller.abort(),10000);try{
 const response=await fetch('https://next.facemorph.me/diagnostics/events',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Facemorph-Diagnostics-Consent':'session-v1'},signal:controller.signal,body:JSON.stringify({schemaVersion:1,session,run,device,provider,bundle,...event})});
 if(enabled()&&session===sendingSession)notice(response.ok?'sent':'failed',sendingRun);
 }catch{if(enabled()&&session===sendingSession)notice('failed',sendingRun);}finally{clearTimeout(timer);aborters.delete(controller);}}
export const diagnostics={
 enable(value){off();if(value){until=Date.now()+60*60*1000;session=crypto.randomUUID();try{device=localStorage.getItem('facemorph-debug-device-v1');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(device||'')){device=crypto.randomUUID();localStorage.setItem('facemorph-debug-device-v1',device);}}catch{device=crypto.randomUUID();}expiry=setTimeout(()=>{off();notice('expired');},60*60*1000);notice('enabled');}else notice('disabled');},
 bundle(value){bundle=/^[a-f0-9]{64}$/.test(value||'')?value:undefined;},
 start(action,requestedProvider='auto'){if(!enabled())return;provider=['auto','cpu','webgl','webgpu'].includes(requestedProvider)?requestedProvider:'auto';run=crypto.randomUUID();started=performance.now();last=0;void send({event:'start',action:action==='morph'?'morph':'faces',...environment(),language:navigator.language.replace(/[^A-Za-z-]/g,'').slice(0,20),build:buildId()});},
 stage(stage,event={}){if(['cpu','webgl','webgpu','native-cpu','native-gpu'].includes(event.provider))provider=event.provider;if(!enabled()||!run||!allowedStages.has(stage))return;const timing=Number.isFinite(event.elapsedMs)?Math.round(event.elapsedMs):undefined;if(timing===undefined&&performance.now()-last<1000)return;last=performance.now();void send({event:'stage',stage,elapsedMs:Math.round(performance.now()-started),stageMs:timing});},
 finish(status,error){if(!enabled()||!run)return;void send({event:status,elapsedMs:Math.round(performance.now()-started),errorCode:error?(error.name==='AbortError'?'cancelled':'operation_failed'):undefined});},
 status(){return {enabled:enabled(),expiresAt:until,reference:run};}
};
