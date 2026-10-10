// Product analytics for next.facemorph.me (Google Analytics 4). Operator-approved exception to the
// no-third-party rule, 30 September 2026; scripts/check-no-third-party.mjs names the same origins.
//
// What this is for, and therefore all it records:
//   reach        who arrives, from where (banner on classic -> here), on what kind of device
//   activation   how many get to a first result, and how long that takes on their device
//   features     which inputs, morph kinds, exports and routes are actually used
//   reliability  how jobs end, and for failures: what kind and at which stage
//   cost         what the first visit costs (models moved) apart from what a job costs
// It never records anything a visitor typed, chose or uploaded: no names, seeds, photos, file
// names, project contents or error text. Every parameter below is a closed vocabulary or a
// bounded number; anything else is dropped rather than forwarded. Reliability detail beyond a
// kind and a stage belongs to the consented diagnostics collector, not here.
//
// Behaviour rules:
//   - Loads on the production host only. Not on the desktop app, labs, localhost or under
//     automation, so builds, tests and qualification runs never count as visitors.
//   - Waits for the page to be idle before fetching gtag.js, so it never competes with the model
//     download. Events raised before then are queued and sent when it loads.
//   - Off for Save-Data, Global Privacy Control and Do Not Track. No Google signals, no ad
//     personalisation, no ad storage.
//   - Fails open. A blocked script, a missing storage or a bad event never affects the product.
export const MEASUREMENT_ID = 'G-F5F6JBLJ54';
export const HOST = 'next.facemorph.me';
export const LINKED_DOMAINS = ['facemorph.me', 'next.facemorph.me'];

// GA4 keeps 50 event-scoped custom dimensions and 50 metrics. These are the ones we register;
// docs/analytics.md lists them with what each answers. Adding a name here means registering it.
const ENUMS = {
  milestone: ['usable-ui','preview','generated-ready','restored-ready','video-ready','generated-visible','restored-visible','scrubbable','playable-visible'],
  visit_kind: ['first','returning','unknown'],
  operation: ['model-cache','original-cache','frame-cache','restore','crop','selection','alignment','encoding','synthesis','qualification','queue','retry','fallback','desktop-browser','desktop-binary'],
  reason: ['missing','incompatible','quota','unavailable','rejected','unsupported','unknown'],
  metric: ['lcp','interaction-delay','cls','long-task'],
  face_count: ['zero','one','multiple'],
  size_band: ['small','medium','large','unknown'],
  requested_route: ['auto','cpu','webgl','webgpu'],
  action: ['faces', 'face', 'morph', 'photo', 'import', 'names'],
  outcome: ['completed', 'cancelled', 'failed', 'interrupted', 'invalid', 'declined', 'ready','hit','miss','superseded','shown','clicked','rejected'],
  route: ['auto', 'cpu', 'webgl', 'webgpu', 'native-cpu', 'native-gpu'],
  error_kind: ['aborted', 'memory', 'integrity', 'network', 'unsupported', 'timeout', 'storage', 'decode', 'unknown'],
  input_kind: ['name', 'seed', 'photo', 'project', 'mixed'],
  export_kind: ['image', 'video', 'project'],
  method: ['save', 'share', 'open'],
  scope: ['route', 'photo'],
  cache_state: ['warm', 'cold'],
  morph_kind: ['linear', 'pairwise-ellipse', 'pairwise-figure8', 'full-smooth-ellipse', 'full-smooth-figure8']
};
const STAGE = /^[a-z][a-z-]{0,39}$/;
const NUMBERS = { schema_version:[2,2], duration_ms: [0, 3.6e6], size_mb: [0, 4096], faces: [0, 64], frames: [0, 4096], ttfr_ms: [0, 3.6e6], wait_ms:[0,3.6e6], queue_depth:[0,64], metric_value:[0,3.6e6] };

/** Keeps only known parameters holding known values. Exposed for the tests. */
export function clean(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (ENUMS[key]) { if (ENUMS[key].includes(value)) out[key] = value; }
    else if(key==='attempt_id'){if(typeof value==='string'&&/^[a-f0-9]{16}$/.test(value))out[key]=value;}
    else if (key === 'release') { if(typeof value==='string'&&/^(?:[a-f0-9]{7,40}(?:-dirty)?|next-[a-f0-9]{16}|local|unknown)$/.test(value))out[key]=value; }
    else if (key === 'error_stage') { if (typeof value === 'string' && STAGE.test(value)) out[key] = value; }
    else if (NUMBERS[key]) {
      const [low, high] = NUMBERS[key];
      if (Number.isFinite(value) && value >= low && value <= high) out[key] = key==='metric_value'?Math.round(value*1000)/1000:Math.round(value * 10) / 10;
    }
  }
  return out;
}

/** Coarse device facts as user properties: enough to slice reliability by capability. */
export function deviceProperties(nav = globalThis.navigator, isolated = globalThis.crossOriginIsolated) {
  const ua = nav?.userAgent || '';
  const cores = Number(nav?.hardwareConcurrency), memory = Number(nav?.deviceMemory);
  return {
    platform: /iPhone|iPad|iPod/.test(ua) || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1) ? 'ios'
      : /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'macos' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other',
    webgpu: nav && 'gpu' in nav ? 'yes' : 'no',
    cores_band: !(cores > 0) ? 'unknown' : cores <= 2 ? '1-2' : cores <= 4 ? '3-4' : cores <= 8 ? '5-8' : '9+',
    memory_band: !(memory > 0) ? 'unknown' : memory <= 2 ? '<=2gb' : memory <= 4 ? '4gb' : '8gb+',
    isolated: isolated === true ? 'yes' : isolated === false ? 'no' : 'unknown'
  };
}

/** Whether analytics may run here at all. Pure so the rules can be tested. */
export function allowed(env = globalThis) {
  try {
    const { location, navigator: nav } = env;
    if (!location || location.hostname !== HOST || location.protocol !== 'https:') return false;
    if (nav?.webdriver) return false;
    if (nav?.globalPrivacyControl === true || nav?.doNotTrack === '1' || env.doNotTrack === '1') return false;
    if (nav?.connection?.saveData === true) return false;
    return true;
  } catch { return false; }
}

let visitKind='unknown';
const arrival=0;
const queued=new Map(),milestones=new Set();
let terminalSent=true,attemptId;
let started = false, context = () => ({}), firstResultSent = false;
const FIRST = 'facemorph-first-result-v1';

function gtag() { (globalThis.dataLayer = globalThis.dataLayer || []).push(arguments); }

function load() {
  const script = document.createElement('script');
  script.async = true;
  // The gate reads markup and package-CDN literals; this origin is its documented exception.
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(script);
}

/** Starts analytics once, after the page is idle. Safe to call repeatedly and from anywhere. */
export function start(env = globalThis) {
  if (started || !allowed(env)) return false;
  started = true;
  try {
    try{visitKind=localStorage.getItem('facemorph-visit-v1')?'returning':'first';localStorage.setItem('facemorph-visit-v1','1');}catch{}
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('set', 'user_properties', deviceProperties());
    gtag('set',{page_location:env.location.origin+env.location.pathname,page_title:'FaceMorph',page_referrer:safeReferrer(globalThis.document?.referrer)});
    gtag('config', MEASUREMENT_ID, {
      // Same property as classic: one journey banner -> next, told apart by hostname.
      linker: { domains: LINKED_DOMAINS },
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: 'SameSite=Lax;Secure',
      // /names is a route inside the same page; its use is reported by names_use, not history sniffing.
      page_location: env.location.origin + env.location.pathname,
      page_title: 'FaceMorph',
      page_referrer: safeReferrer(globalThis.document?.referrer),
      send_page_view: true
    });
    const go = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(load, { timeout: 5000 }) : setTimeout(load, 2000));
    if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
    return true;
  } catch { return false; }
}

/** Registers what the running job knows that analytics does not (face and frame counts, inputs). */
export function setJobContext(fn) { if (typeof fn === 'function') context = fn; }

export function track(name, params) {
  try {
    if (!started && !start()) return;
    if(!allowed())return;
    const release=typeof __FACEMORPH_SOURCE_SHA__!=='undefined'?__FACEMORPH_SOURCE_SHA__:'unknown';
    gtag('event', name, clean({schema_version:2,release,visit_kind:visitKind,...params}));
  } catch { /* analytics never affects the product */ }
}

// ---- events the product raises --------------------------------------------------------------

export function jobStarted({ action, provider, warm, target }) {
  terminalSent=false;try{attemptId=Array.from(crypto.getRandomValues(new Uint8Array(8)),x=>x.toString(16).padStart(2,'0')).join('');}catch{attemptId=undefined;}const enqueued=queued.get(target);queued.delete(target);
  if(enqueued!==undefined)track('queue_finish',{operation:'queue',outcome:'ready',wait_ms:(performance.now()-enqueued),queue_depth:queued.size});
  track('job_start', { attempt_id:attemptId, action, route: provider, cache_state: warm ? 'warm' : 'cold', ...context() });
}

/**
 * The single place a job's ending is reported. `outcome` is the diagnostics vocabulary
 * (completed | cancelled | failed | interrupted). The first completed job on a device also raises
 * `first_result`, the activation event, with the time since the page opened.
 */
export function jobFinished({ action, outcome, provider, elapsedMs, errorKind, errorStage }) {
  if(terminalSent)return;terminalSent=true;
  const extra = context();
  track('job_finish', { attempt_id:attemptId, action, outcome, route: provider, duration_ms: elapsedMs, error_kind: errorKind, error_stage: errorStage, ...extra });
  if(outcome==='completed')milestone(action==='morph'?'video-ready':'generated-ready');

}

export function modelsDownloaded({ scope, outcome, sizeMb, durationMs }) {
  track('models_download', { scope, outcome, size_mb: sizeMb, duration_ms: durationMs });
}
export function exported({ kind, method, outcome, durationMs, fallback }) { track('export', { export_kind: kind, method, outcome, duration_ms:durationMs });if(fallback)operationResult('fallback','completed',durationMs,{reason:'unsupported'}); }
export function photoSelected({ outcome }) { track('photo_select', { action: 'photo', outcome }); }
export function namesUsed({ outcome }) { track('names_use', { action: 'names', outcome }); }

/** Classifies what a job was given without keeping any of it: the kind of input, never the input. */
export function inputKind(inputs = []) {
  const kinds = new Set(inputs.map(item => item?.mode === 'photo' ? 'photo' : item?.mode === 'project' ? 'project'
    : item?.mode === 'seed' || (item?.mode === 'text' && /^\d+$/.test(String(item?.value ?? '').trim())) ? 'seed' : 'name'));
  return kinds.size === 1 ? [...kinds][0] : kinds.size > 1 ? 'mixed' : undefined;
}

export function safeReferrer(value){try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.origin:'';}catch{return '';}}
export function milestone(value){if(milestones.has(value))return;milestones.add(value);track('visit_milestone',{milestone:value,duration_ms:(globalThis.performance?.now?.()||0)-arrival});}
export function queuedRequest(id,depth){if(queued.has(id))return;queued.set(id,performance.now());track('queue_enter',{operation:'queue',queue_depth:depth});}
export function cancelQueued(id){if(!queued.has(id))return;const began=queued.get(id);queued.delete(id);track('queue_finish',{operation:'queue',outcome:'cancelled',wait_ms:performance.now()-began,queue_depth:queued.size});}
export function operationStarted(operation,extra={}){track('operation_start',{operation,...extra});}
export function operationResult(operation,outcome,durationMs,extra={}){track('operation_result',{operation,outcome,duration_ms:durationMs,...extra});}
export function routeAttempt(route,outcome){track('route_admission',{route,outcome});}
export function stageDuration(stage,durationMs){track('stage_duration',{error_stage:stage,duration_ms:durationMs});}
export function observeVitals(){
 if(!allowed()||typeof PerformanceObserver!=='function')return;
 for(const [type,metric] of [['largest-contentful-paint','lcp'],['layout-shift','cls'],['event','interaction-delay'],['longtask','long-task']]){
  if(!PerformanceObserver.supportedEntryTypes?.includes(type))continue;
  let value=0,windowValue=0,windowStart=0,lastShift=0;const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
   if(type==='layout-shift'){if(!entry.hadRecentInput){if(entry.startTime-lastShift>1000||entry.startTime-windowStart>5000){windowValue=0;windowStart=entry.startTime;}windowValue+=entry.value;lastShift=entry.startTime;value=Math.max(value,windowValue);}}else value=Math.max(value,type==='largest-contentful-paint'?entry.startTime:entry.duration);
  }});
  try{observer.observe({type,buffered:true,...(type==='event'?{durationThreshold:40}:{})});
   addEventListener('pagehide',()=>{track('responsiveness',{metric,metric_value:value});observer.disconnect();},{once:true});
  }catch{observer.disconnect();}
 }
}

export function visibleResult(kind){
 milestone(kind);
 if(firstResultSent||!started||!allowed())return;
 firstResultSent=true;let seen=false;
 try{seen=localStorage.getItem(FIRST)==='1';localStorage.setItem(FIRST,'1');}catch{}
 if(!seen)track('first_result',{ttfr_ms:globalThis.performance?.now?.(),...context()});
}
