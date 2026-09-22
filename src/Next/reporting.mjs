// An allowlist, not arbitrary error/string serialization. No pre-consent backlog.
const allowedStages=new Set(['asset-acquisition','runtime-loading','model-loading','model-loaded','mapping-loading','mapping','canary','synthesis','synthesis-complete','alignment','alignment-complete','encoder-loading','encoder-loaded','encoder-correctness-check','encoder-correctness-complete','encoding','encoding-complete','mapping-complete','original-cache-hit','original-cached','original-cache-invalid','cache-unavailable','fallback-cpu','codec-loading','face','morph','export','route-admitted','photo-select','photo-preview','photo-crop','photo-align','photo-encode','storage','cache-trouble']);
const TERMINAL=new Set(['completed','cancelled','failed','interrupted']);
let bundle,provider,device=null,consented=false,session=null,run=null,started=0;
let aborters=new Set(),pendingStart=null,finished=false,interrupted=false,tally=null,persisted=true;
// One clock per stage name. A single shared clock dropped exactly the bursty boundaries the
// parity ledger is made of: two different stages a few milliseconds apart are two facts.
const lastStageAt=new Map();
const CONSENT='facemorph-debug-consent-v1';
/** Returns whether the choice actually persisted: a silent failure here is how "stays on until
 * you turn it off" quietly becomes "until you reload". */
function remember(value){try{if(value)localStorage.setItem(CONSENT,'on');else localStorage.removeItem(CONSENT);return true;}catch{return false;}}
function notice(status){window.dispatchEvent(new CustomEvent('facemorph-report-status',{detail:{status,...summary()}}));}
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
 if(name==='QuotaExceededError'||/quota|storage|disappeared|acquire again/i.test(text))return 'storage';
 if(name==='NotSupportedError'||/not supported|unsupported/i.test(text))return 'unsupported';
 if(name==='RangeError'||/out of memory|allocation|Array buffer allocation/i.test(text))return 'memory';
 if(/checksum|sha|integrity|verified|tamper/i.test(text))return 'integrity';
 if(name==='TimeoutError'||/timed out|timeout|deadline/i.test(text))return 'timeout';
 if(name==='TypeError'&&/fetch|network|load failed/i.test(text))return 'network';
 if(/decode|codec|image could not|could not be read|could not prepare|cropp/i.test(text))return 'decode';
 return 'unknown';
}
const enabled=()=>consented;
/**
 * Consent and the job lifecycle are separate things, and conflating them is what made the
 * instrument useless. `withdraw` ends consent: in-flight sends are aborted, the staged buffer is
 * dropped and the session is forgotten. It deliberately does not touch `run` — a job that is
 * still going is still going, and if consent comes back it reports the rest of that same run.
 */
function withdraw(){consented=false;session=null;staged=[];tally=null;for(const controller of aborters)controller.abort();aborters.clear();}
/** Idempotent. Saying yes twice must not restart the session or split a run across two of them. */
function begin(){
 if(consented)return;
 consented=true;session=crypto.randomUUID();
 try{device=localStorage.getItem('facemorph-debug-device-v1');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(device||'')){device=crypto.randomUUID();localStorage.setItem('facemorph-debug-device-v1',device);}}catch{device=crypto.randomUUID();}
}
// Operator decision, 17 September: log generously and stage locally, so a tester who only
// decides to help *after* something breaks can still send what led up to it. Staging is memory
// only and never leaves the device: an upload still requires an explicit yes, and declining or
// turning reporting off discards the buffer. This replaces the earlier rule that prior records
// are never uploaded; it does not weaken "nothing is sent before consent".
const STAGE_LIMIT=500;
let staged=[];
// A staged record keeps the run and bundle it belongs to. Filling those in at flush time is how
// a mid-run yes used to file a finished run's events under whatever was current by then.
function stash(item){staged.push(item);if(staged.length>STAGE_LIMIT)staged.shift();}
/** Sends what was staged before consent, oldest first, once the tester agrees. */
function sendStaged(){const pending=staged;staged=[];if(pending.length)void deliver(pending);}
function record(payload,{terminal=false}={}){return {payload,run,bundle,provider,terminal};}
/**
 * Events leave in batches, not one POST each.
 *
 * The collector writes one KV key per request, and the Free plan allows 1,000 writes a day per
 * namespace. A single morph is about a hundred events, so 21 September spent 1,430 writes and the
 * collector began refusing — losing exactly the reports that were meant to explain a gigabyte
 * re-downloading. Grouping a run's events into one request costs one write instead of a hundred.
 *
 * A terminal event flushes immediately and keeps `keepalive`, so a closing page still reports.
 * Everything else waits for a short window, a full buffer, or that flush.
 */
const BATCH_WINDOW_MS=15000,BATCH_MAX=150,BATCH_ATTEMPTS=3;
let batch=[],batchTimer=null;
function flushBatch(){
 if(batchTimer){clearTimeout(batchTimer);batchTimer=null;}
 if(!batch.length)return;
 const items=batch;batch=[];
 persistBatch();
 void deliver(items);
}
// A wider window is only safe if the buffer cannot evaporate. A page that is closing or going
// into the background flushes what it holds — that is the moment a long-running job's record is
// most likely to be lost — and a delivery that fails puts its events back at the front for the
// next attempt rather than dropping them. Three attempts, then they are let go: a report is worth
// retrying, never worth growing without bound.
if(typeof globalThis.addEventListener==='function'){
 globalThis.addEventListener('pagehide',flushBatch);
 globalThis.addEventListener('visibilitychange',()=>{if(globalThis.document?.hidden)flushBatch();});
}
/**
 * The buffer survives a refresh.
 *
 * A wider batching window means more unsent events in memory at any moment, and a reload — which
 * is exactly what a visitor does when something looks stuck — would have taken them with it. The
 * pending events are mirrored into sessionStorage on every change and picked up on the next load,
 * so the reports that explain a bad run outlive the run.
 */
const BATCH_KEY='checkface-diagnostics-pending-v1';
function persistBatch(){
 try{
  if(batch.length)sessionStorage.setItem(BATCH_KEY,JSON.stringify(batch.slice(-BATCH_MAX)));
  else sessionStorage.removeItem(BATCH_KEY);
 }catch{}
}
function recoverBatch(){
 let saved=null;
 try{saved=JSON.parse(sessionStorage.getItem(BATCH_KEY)||'null');}catch{}
 try{sessionStorage.removeItem(BATCH_KEY);}catch{}
 if(!Array.isArray(saved)||!saved.length)return;
 // Anything recovered has already survived one page, so it goes out at once rather than waiting
 // another window for a page that may not last either.
 void deliver(saved.filter(item=>item&&item.payload&&item.run).slice(0,BATCH_MAX));
}
function requeue(items){
 const keep=items.filter(item=>(item.attempts=(item.attempts||0)+1)<BATCH_ATTEMPTS);
 if(!keep.length)return;
 batch=keep.concat(batch).slice(0,BATCH_MAX);persistBatch();
 if(!batchTimer)batchTimer=setTimeout(flushBatch,BATCH_WINDOW_MS);
}
function send(payload,options){
 const item=record(payload,options);
 if(!enabled()){stash(item);return;}
 batch.push(item);persistBatch();
 if(item.terminal||batch.length>=BATCH_MAX){flushBatch();return;}
 if(!batchTimer)batchTimer=setTimeout(flushBatch,BATCH_WINDOW_MS);
}
/** One outcome per run, not one per POST: nineteen failures behind one late success is a lie. */
function account(item,ok){
 if(!item.run)return;
 if(!tally||tally.run!==item.run)tally={run:item.run,sent:0,failed:0};
 ok?tally.sent++:tally.failed++;
 notice(tally.failed?'failed':'sent');
}
async function deliver(items){
 if(!enabled())return;
 const sendingSession=session,controller=new AbortController();aborters.add(controller);
 const timer=setTimeout(()=>controller.abort(),10000);
 const terminal=items.some(item=>item.terminal),lead=items[items.length-1];
 try{
  // keepalive, not sendBeacon: the collector requires the consent header, and that header is
  // exactly what keeps an unauthenticated POST at 403. sendBeacon cannot set one.
  // The batch carries its identity once; per-event fields stay exactly as they were.
  const body={schemaVersion:1,session:sendingSession,run:lead.run,device,provider:lead.provider,bundle:lead.bundle,
   events:items.map(item=>({...item.payload,...(item.run!==lead.run?{run:item.run}:{}),...(item.provider!==lead.provider?{provider:item.provider}:{})}))};
  const response=await fetch('https://next.facemorph.me/diagnostics/events',{method:'POST',credentials:'omit',keepalive:terminal,headers:{'Content-Type':'application/json','X-Facemorph-Diagnostics-Consent':'session-v1'},signal:controller.signal,body:JSON.stringify(body)});
  if(enabled()&&session===sendingSession)for(const item of items)account(item,response.ok);
  if(!response.ok&&enabled()&&session===sendingSession)requeue(items);
 }catch{if(enabled()&&session===sendingSession){for(const item of items)account(item,false);requeue(items);}}
 finally{clearTimeout(timer);aborters.delete(controller);}
}
/**
 * The first event of a run used to go out before the bundle hash was known, so nothing said
 * which bundle produced the run it opened. The start event is held until the bundle arrives, or
 * until the first thing that must follow it, whichever comes first.
 */
function openRun(){if(!pendingStart)return;const payload=pendingStart;pendingStart=null;send(payload);}
/**
 * The one fact a tester has to be able to hold: the reference of the run the record names. Emitted
 * when a run opens under consent — including a job already in progress when the tester says yes
 * mid-run — and again when it closes. It stands until the next open, so the DOM can keep it
 * selectable and copyable through the status churn in between instead of losing it to the next
 * POST. Never emitted without consent or without a run: the interface must not hand out an id
 * nothing was filed under.
 */
function reference(state,terminal){if(!consented||!run)return;window.dispatchEvent(new CustomEvent('facemorph-run-reference',{detail:{run,state,terminal}}));}
function terminate(event,extra={}){
 if(!run)return;
 openRun();send({event,elapsedMs:Math.round(performance.now()-started),...extra},{terminal:true});reference('closed',event);
}
// A phone that backgrounds mid-job is the device we most need the record from. Close the run
// from the last moment the page is certain to get: `hidden`.
function onHidden(){
 if(globalThis.document?.visibilityState!=='hidden'||!run||finished||interrupted)return;
 interrupted=true;terminate('interrupted');
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',onHidden);
/**
 * What the interface shows. The reference names the run something was actually filed under —
 * not the run that merely started — so a tester is never handed an id nothing was saved
 * against, and never the *previous* run's id either. It stands until the next run replaces it.
 */
function summary(){const of=tally?.run||'';return {enabled:consented,reference:of,sent:tally?.sent||0,failed:tally?.failed||0,staged:staged.length,persisted};}
export const diagnostics={
 enable(value){
  if(value){
   // Already consented is a no-op, not a reset: turning it on again must never discard the run.
   const fresh=!consented;begin();persisted=remember(true);
   notice('enabled');if(fresh){sendStaged();if(run)reference('open');}
  }else{withdraw();remember(false);persisted=true;notice('disabled');}
 },
 // Restores a previous explicit opt-in: reporting stays on across reloads until it is turned off.
 restore(){let saved=null;try{saved=localStorage.getItem(CONSENT);}catch{}if(saved!=='on'||consented)return false;begin();notice('enabled');recoverBatch();return true;},
 /** Send anything buffered now rather than at the end of the window. */
 flush(){flushBatch();},
 bundle(value){bundle=/^[a-f0-9]{64}$/.test(value||'')?value:undefined;openRun();},
 start(action,requestedProvider='auto'){
  provider=['auto','cpu','webgl','webgpu'].includes(requestedProvider)?requestedProvider:'auto';
  run=crypto.randomUUID();started=performance.now();lastStageAt.clear();finished=false;interrupted=false;tally=null;
  pendingStart={event:'start',action:action==='morph'?'morph':action==='photo'?'photo':'faces',...environment(),language:navigator.language.replace(/[^A-Za-z-]/g,'').slice(0,20),build:buildId()};
  if(bundle)openRun();
  notice(consented?'enabled':'disabled');if(consented)reference('open');
 },
 stage(stage,event={}){
  // Route facts travel with the route-admitted stage; they are closed vocabularies, not free text.
  if(stage==='route-admitted'&&run){openRun();send({event:'stage',stage,gpu:event.gpu,routeOutcome:event.routeOutcome,provider:['cpu','webgl','webgpu'].includes(event.provider)?event.provider:undefined,elapsedMs:Math.round(performance.now()-started)});return;}
  // C-02: a background canary failure names the route it dropped, so the record says why a
  // device left a route rather than only that it left one.
  if(stage==='canary-invalidated'&&run){openRun();send({event:'stage',stage,provider:['cpu','webgl','webgpu'].includes(event.provider)?event.provider:undefined,elapsedMs:Math.round(performance.now()-started)});return;}
  // R2-15: storage facts ride their own stage so an eviction story is readable from the
  // record alone — persisted flag and rounded megabytes, closed fields, nothing else.
  // Why the cache refused, lost or repaired an asset. A closed vocabulary, so the record can say
  // "quota-exceeded" or "missing-after-acquire" instead of leaving a re-download to inference.
  if(stage==='cache-trouble'&&run){openRun();send({event:'stage',stage,
   cacheStatus:['quota-exceeded','save-failed','storage-unavailable','missing-after-acquire','repairing','corrupt-removed'].includes(event.cacheStatus)?event.cacheStatus:undefined,
   elapsedMs:Math.round(performance.now()-started)});return;}
  if(stage==='storage'&&run){openRun();send({event:'stage',stage,persisted:event.persisted===true,usageMb:Number.isFinite(event.usageMb)?event.usageMb:undefined,quotaMb:Number.isFinite(event.quotaMb)?event.quotaMb:undefined,elapsedMs:Math.round(performance.now()-started)});return;}
  if(['cpu','webgl','webgpu','native-cpu','native-gpu'].includes(event.provider))provider=event.provider;
  if(!run||!allowedStages.has(stage))return;
  const timing=Number.isFinite(event.elapsedMs)?Math.round(event.elapsedMs):undefined,at=performance.now();
  if(timing===undefined&&at-(lastStageAt.get(stage)??-Infinity)<1000)return;
  lastStageAt.set(stage,at);openRun();
  send({event:'stage',stage,elapsedMs:Math.round(at-started),stageMs:timing});
 },
 /**
  * A failure records where it happened and what kind it was, from closed vocabularies. The error's
  * own text is never sent: it can carry a filename, a URL or a user's input.
  */
 finish(status,error,context={}){
  if(!run||finished)return;finished=true;
  terminate(status,{errorCode:error?(error.name==='AbortError'?'cancelled':'operation_failed'):undefined,errorStage:allowedStages.has(context.stage)?context.stage:undefined,errorKind:error?classify(error):undefined});
 },
 status(){return summary();},
 /** The event names that close a run. A run with none of these never finished reporting. */
 terminalEvents(){return new Set(TERMINAL);}
};
