import {openOriginals,digest} from './originals.mjs';
import {capabilities} from './route-priors.mjs';
import {rankedRoutes} from './route-selection.mjs';
import {inputLatent,requireLatent,generationIdentity} from './identity.mjs';
const abortError=()=>new DOMException('Generation cancelled','AbortError');
/** One foreground operation, one worker, explicit route qualification. */
export function createBrowserRuntime({manifest: suppliedManifest, manifestSha256:suppliedManifestSha256, manifestUrl='/runtime/manifest.json',onProgress=()=>{},alignPhoto,preferredRoute='auto',workerFactory=()=>new Worker(new URL('./ort-worker.mjs',import.meta.url),{type:'module'}),stallMs=300000}={}){
 const failedRoutes=new Set();let interruptedRoute;
 // An interruption is not a device-check failure. A reclaimed tab, a reload, a phone backgrounding
 // the page and a real crash all leave the same marker, and the WebGPU route is the most likely to
 // collect one: biggest working set, longest session creation. Treating a single interruption as a
 // permanent refusal for the page load silently removed exactly the route worth having — the
 // operator's phone kept landing on CPU while an explicitly forced WebGPU run was fast. So one
 // interruption earns a retry; two in a row within the session drop the route, and the drop is
 // announced rather than swallowed. A route that qualifies clears its own count.
 const INTERRUPT_KEY='checkface-runtime-interrupted-v1',INTERRUPT_LIMIT=2;
 let interruptions={};try{interruptions=JSON.parse(sessionStorage.getItem(INTERRUPT_KEY)||'{}')||{};}catch{}
 const saveInterruptions=()=>{try{sessionStorage.setItem(INTERRUPT_KEY,JSON.stringify(interruptions));}catch{}};
 try{const previous=JSON.parse(sessionStorage.getItem('checkface-runtime-active-v1')||'null');
  if(previous?.route){
   interruptedRoute=previous.route;
   interruptions[previous.route]=(interruptions[previous.route]||0)+1;saveInterruptions();
   if(interruptions[previous.route]>=INTERRUPT_LIMIT)failedRoutes.add(previous.route);
  }
  sessionStorage.removeItem('checkface-runtime-active-v1');}catch{}
 const markerOwner=crypto.randomUUID();const mark=(stage,id)=>{try{sessionStorage.setItem('checkface-runtime-active-v1',JSON.stringify({owner:markerOwner,route,stage,id,at:Date.now()}));}catch{}};const unmark=()=>{try{const item=JSON.parse(sessionStorage.getItem('checkface-runtime-active-v1')||'null');if(item?.owner===markerOwner)sessionStorage.removeItem('checkface-runtime-active-v1');}catch{}};
 if(!['auto','cpu','webgl','webgpu'].includes(preferredRoute))throw Error('Invalid preferred inference route');
 let manifest=suppliedManifest,manifestHash=suppliedManifestSha256,worker,active,disposed=false,validated=false,encoderValidatedSha256,originals,route='cpu',qualificationPending=false;const pending=new Map();let sequence=0,synthesisRuns=0;
 const emit=(event,extra)=>{try{const detail={provider:route,...event};onProgress(detail);extra?.(detail);}catch{}};
 async function config(){
  if(manifestHash&&!/^[a-f0-9]{64}$/.test(manifestHash))throw Error('Invalid runtime manifest checksum');
  if(!manifest||!manifestHash){const response=await fetch(manifestUrl,{credentials:'omit'});if(!response.ok)throw Error('Could not load the generation bundle.');const raw=await response.arrayBuffer(),parsed=JSON.parse(new TextDecoder().decode(raw));if(manifest&&JSON.stringify(manifest)!==JSON.stringify(parsed))throw Error('The runtime manifest changed; reload before continuing.');manifest=parsed;manifestHash=await digest(raw);}
  if(!manifest||manifest.schemaVersion!==1||!manifest.bundleVersion||!Array.isArray(manifest.canaries)||manifest.canaries.length<2)throw Error('Invalid runtime bundle');return manifest;
 }

 function stop(reason=abortError()){unmark();worker?.terminate();worker=null;synthesisRuns=0;validated=false;for(const task of pending.values()){clearTimeout(task.timer);task.reject(reason);}pending.clear();}
 // An operation that may acquire model bytes gets a wider stall window: on phone-class
 // storage the silent tail of a cold acquire (Cache.put commit, sha verify) legitimately
 // runs minutes without emitting a single event, and the inference watchdog must not kill
 // a healthy cold start mid-write. Once models are local the default window applies.
 const ACQUIRE_STALL=stallMs*4;
 // The stall watchdog must not fire at a backgrounded tab. A hidden document has its workers and
 // timers throttled, so progress events stop arriving through no fault of the route — and the
 // watchdog then killed the worker, `admit` marked that route failed and moved to the next, which
 // was throttled too. Every route burned in turn, and returning to the tab found "No local
 // processing route remains available". The operator reproduced exactly that by switching away
 // and coming back.
 //
 // So the deadline only counts time the visitor could actually see. While hidden the watchdog
 // reschedules instead of firing, and becoming visible restarts the window so a genuinely wedged
 // worker is still caught — just never blamed on being in the background.
 const hidden=()=>globalThis.document?.hidden===true;
 function send(type,payload={},progress,stall=stallMs){return new Promise((resolve,reject)=>{const id=++sequence;if(type!=='initialize'&&!payload.resume)mark(type,id);const task={resolve,reject,progress,operation:type};const timeout=()=>{if(hidden()){task.timer=setTimeout(timeout,stall);return;}stop(Error('Generation stopped responding. Your saved work is safe.'));};task.timer=setTimeout(timeout,stall);task.reset=()=>{clearTimeout(task.timer);task.timer=setTimeout(timeout,stall);};pending.set(id,task);try{worker.postMessage({id,type,...payload});}catch(error){clearTimeout(task.timer);pending.delete(id);reject(error);}});}
 async function start(progress){if(worker)return;await config();worker=workerFactory();worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;if(data.type==='progress'){task.reset();if(data.stage==='synthesis-complete'){synthesisRuns++;if(synthesisRuns>1&&['generate','synthesize'].includes(task.operation)&&Number.isFinite(data.elapsedMs)&&data.elapsedMs>0)task.synthesisMs=data.elapsedMs;}emit(data,task.progress);return;}clearTimeout(task.timer);pending.delete(data.id);unmark();if(data.type==='error'){if(task.operation==='encode-aligned'){encoderValidatedSha256=undefined;forgetEncoder();}validated=false;failedRoutes.add(route);const error=Object.assign(Error(data.error.message),{name:data.error.name,failedOperation:task.operation,correctnessFailure:data.error.correctnessFailure===true});stop(error);task.reject(error);}else{if(task.synthesisMs!==undefined)remember(route,task.synthesisMs);task.resolve(data.result);}};worker.onerror=event=>{
  // A worker that dies at startup is not a verdict on a route: the operator's phone burned
  // webgpu, cpu and webgl in 257 ms — 154, 203 and 251 ms apart — which is far too fast for a
  // canary, because a canary requires a synthesis. Every route was blamed for one engine that
  // never started, and the run ended on "No local processing route remains available".
  //
  // The event's own detail is kept too. Reports said only "The local generation engine stopped",
  // which names the symptom and nothing else; the message, file and line say what actually went
  // wrong the next time this happens.
  const detail=[event?.message,event?.filename&&event.filename.split('/').pop(),
   Number.isFinite(event?.lineno)?'line '+event.lineno:null].filter(Boolean).join(' ');
  const error=Object.assign(Error('The local generation engine stopped.'+(detail?' ('+detail+')':'')),
   {engineStopped:true,workerDetail:detail||undefined});
  stop(error);
 };await send('initialize',{manifest,provider:route==='webgl'?'webgl2':route==='webgpu'?'webgpu':'wasm',manifestSha256:manifestHash,fullQualify:globalThis.__FACEMORPH_FULL_QUALIFY__===true,hostForcedQualify:globalThis.__FACEMORPH_FULL_QUALIFY__!==undefined,webdriver:globalThis.navigator?.webdriver===true,forceCanaryFail:globalThis.__FACEMORPH_FORCE_CANARY_FAIL__===true},progress);}
 // Acquisition warm-up. The first face on a cold device waits on roughly 200 MB, and none of
 // those bytes depend on which face is asked for, so they are fetched while the visitor is still
 // reading the page. It runs in a worker of its own: the inference worker's queue is strictly
 // ordered, so warming through it would put a real Generate behind the whole download. Any real
 // operation terminates this worker, and every asset it had already committed stays cached.
 let prefetchWorker=null,prefetchCancel=null;
 /**
  * Whether this device can keep the photo encoder resident instead of throwing the whole worker
  * away around every photo.
  *
  * Terminating the worker is how a phone gets its gigabyte back: a wasm heap never shrinks, so
  * releasing a session returns nothing to the operating system and only ending the thread does.
  * That is why it happens before the encode and again before synthesis, and on a constrained
  * device it stays exactly as it is.
  *
  * The cost lands on anyone encoding several photos, which is the ordinary case. Measured across
  * five photos in a row (photo-runtime/evidence/desktop-browser-five-photos.json) acquisition was
  * 19.1 s and then 15.7, 15.7, 16.7 and 15.5 s against 4.3 s of inference: every photo re-read the
  * same gigabyte out of Cache Storage and re-hashed it, because the set of already-verified assets
  * dies with the worker as well. Nothing was reused between photos at all.
  *
  * A machine with memory to spare should simply keep it. `deviceMemory` is the platform's own
  * statement about the budget and is undefined on iOS — the tier this teardown exists for — so
  * undefined means keep tearing down. Phones are excluded even when they claim 8 GB until one has
  * been measured holding it, and `__FACEMORPH_HOLD_ENCODER__` is how that measurement gets taken.
  */
 function holdEncoder(){
  const forced=globalThis.__FACEMORPH_HOLD_ENCODER__;
  if(typeof forced==='boolean')return forced;
  const nav=globalThis.navigator,memory=Number(nav?.deviceMemory);
  const mobile=nav?.userAgentData?.mobile||/Android|iPhone|iPad|iPod/.test(nav?.userAgent||'')||(nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);
  return Number.isFinite(memory)&&memory>=8&&!mobile;
 }
 function stopPrefetch(){const own=prefetchWorker,cancel=prefetchCancel;prefetchWorker=null;prefetchCancel=null;own?.terminate();
  // A terminated worker never answers, so the waiting promise is settled here rather than left
  // pending for the lifetime of the page.
  cancel?.();}
 // A background download this size needs the visitor's data preference respected, so an explicit
 // Save-Data opts out and the first Generate then downloads exactly as it does today.
 //
 // `effectiveType` is deliberately not consulted. It is a rolling throughput estimate, not a
 // statement about the connection: Chrome on the operator's Mac reports '3g' on a fast wired
 // link, so treating it as a signal disabled the warm-up for a large share of healthy devices.
 // A genuinely slow link is also the case where starting early helps most, so it would be the
 // wrong way round even if the reading were trustworthy.
 function prefetchWelcome(){return globalThis.navigator?.connection?.saveData!==true;}
 globalThis.document?.addEventListener?.('visibilitychange',()=>{
  if(!hidden())for(const task of pending.values())task.reset?.();
 });
 async function operation(fn,{signal,onProgress:progress}={}){if(disposed)throw Error('Runtime disposed');if(active)throw Error('Another generation is still running.');stopPrefetch();if(signal?.aborted)throw signal.reason||abortError();const controller=new AbortController();active=controller;const abort=()=>{controller.abort(signal?.reason||abortError());stop(controller.signal.reason);};signal?.addEventListener('abort',abort,{once:true});try{return await fn(progress,controller.signal);}finally{signal?.removeEventListener('abort',abort);active=null;}}
 async function cache(){try{originals ||= await openOriginals();return originals;}catch{return null;}}
 // Tells the product which route was actually admitted, so the interface can say when this
 // device is on the slow path instead of leaving a visitor watching an unexplained wait.
 /** What this browser offers, so a report says whether WebGPU was even on the table. */
 function gpuOffer(){
  if(globalThis.navigator?.gpu&&manifest.webgpu)return 'webgpu';
  if(manifest.webgl&&typeof OffscreenCanvas!=='undefined')return 'webgl-only';
  return 'none';
 }
 function announce(progress,outcome='admitted'){emit({stage:'route-admitted',provider:route,gpu:gpuOffer(),routeOutcome:outcome},progress);}
 /** A route that was tried and refused is reported, so a silent fallback stops being silent. */
 function refused(progress,attempted,outcome){emit({stage:'route-admitted',provider:attempted,gpu:gpuOffer(),routeOutcome:outcome},progress);}
 // v1 recorded download/cache-write/session-creation/canary wall time, not per-face speed.
 // Do not migrate those incomparable measurements or delete the user's cached models/originals.
 // The photo encoder's correctness pass runs the whole 108-shard schedule against a pinned
 // reference before touching a photo. On the operator's Samsung that cost 20,920 ms against
 // 7,395 ms for the real encode — the guard is 2.8x the work it guards — and it ran on every
 // page load because the result lived only in this runtime instance.
 //
 // Operator direction, 21 September: try, record what this device supports, and do not pay an
 // expensive pass repeatedly. So the pass now runs at most once per device per encoder build and
 // the verdict persists. This is a narrower claim than the durable marker removed on 19
 // September: that one vouched for BYTES it could not see change, while this vouches for this
 // device's arithmetic on a pinned manifest sha, and every byte is still verified on open. A
 // different encoder build has a different sha and qualifies again.
 const ENCODER_KEY='facemorph-encoder-qualified-v1';
 function qualifiedEncoder(){
  try{const raw=JSON.parse(localStorage.getItem(ENCODER_KEY)||'null');
   return raw&&raw.sha256===manifest?.encoderStream?.sha256?raw.sha256:undefined;}catch{return undefined;}
 }
 function rememberEncoder(sha256){
  try{localStorage.setItem(ENCODER_KEY,JSON.stringify({sha256,at:Date.now()}));}catch{}
 }
 function forgetEncoder(){try{localStorage.removeItem(ENCODER_KEY);}catch{}}
 const SPEED_KEY='facemorph-route-speed-v2';
 function speeds(){try{const raw=JSON.parse(localStorage.getItem(SPEED_KEY)||'{}');return raw?.bundle===manifestHash&&raw.scope==='warm-synthesis-v1'&&raw.routes&&typeof raw.routes==='object'?raw.routes:{};}catch{return {};}}
 function remember(name,ms){try{const routes={...speeds(),[name]:ms};localStorage.setItem(SPEED_KEY,JSON.stringify({bundle:manifestHash,scope:'warm-synthesis-v1',routes}));}catch{}}
 // Only successful foreground synthesis after a prior run on this worker is measured.
 // Cold shader compilation, qualification, storage and downloads cannot become a speed verdict.
 // `navigator.gpu` existing is not the same as a GPU being available. iOS Safari 26.5 in the
 // Simulator exposes the object and returns null from requestAdapter(), and the first run of the
 // iOS lane caught what that costs: the warm-up chose webgpu, pulled the whole 212 MB GPU bundle,
 // admission then failed for want of an adapter, and the 158 MB CPU bundle followed — 330 MiB
 // cached on a device that could only ever use 158. Any device whose GPU object is a shell pays
 // this, and eager loading makes it worse rather than better.
 //
 // So the adapter is probed once, for real, and the answer is remembered. Until it resolves the
 // route is treated as offered, because the probe is fast and the priors are still the best guess
 // available; once it answers, a shell GPU stops being a candidate at all.
 let gpuAdapter;
 async function probeGpu(){
  if(gpuAdapter!==undefined)return gpuAdapter;
  try{gpuAdapter=Boolean(await globalThis.navigator?.gpu?.requestAdapter());}catch{gpuAdapter=false;}
  return gpuAdapter;
 }
 function capability(){const base=capabilities();return {...base,webgpu:base.webgpu&&gpuAdapter!==false&&Boolean(manifest.webgpu),webgl:base.webgl&&Boolean(manifest.webgl)};}
 function supportedRoutes(){const caps=capability();return ['cpu',...(caps.webgl?['webgl']:[]),...(caps.webgpu?['webgpu']:[])];}
 function orderedRoutes(){return rankedRoutes(capability(),supportedRoutes(),speeds(),failedRoutes);}
 function chooseRoute(){return orderedRoutes()[0];}
 function acceptQualification(result){
  if(result.deviceValidated!==true)throw Error('The selected route did not pass its device correctness check.');
  validated=true;qualificationPending=result.partial===true;
  failedRoutes.delete(route);if(interruptedRoute===route)interruptedRoute=undefined;
  if(interruptions[route]){delete interruptions[route];saveInterruptions();}
 }
 async function admit(progress,signal){
  if(capabilities().webgpu)await probeGpu();
  // `failedRoutes` only ever grew within a page load, so a device could reach a state where every
  // route had failed once — for a device loss during a photo encode, a stopped worker, an
  // interruption — and the product dead-ended on "No local processing route remains available",
  // recoverable only by reloading. The operator hit exactly that after a successful morph: the
  // next face failed in 26 ms, before any worker was even started.
  //
  // A failure is evidence about an attempt, not a permanent verdict on a route. When nothing is
  // left, the slate is cleared once and the priors decide again. A route that is genuinely broken
  // will fail its canary again immediately and be named again; a transient one gets to work.
  if(preferredRoute==='auto'&&!orderedRoutes().length&&supportedRoutes().length){
   failedRoutes.clear();interruptedRoute=undefined;
   emit({stage:'routes-retried'},progress);
  }
  const candidates=preferredRoute==='auto'?orderedRoutes():[preferredRoute];
  // A route dropped before it is tried never reached `refused`, so the fallback was invisible:
  // the caption named the admitted route and nothing said the faster one had been set aside.
  for(const name of supportedRoutes())
   if(!candidates.includes(name)&&interruptions[name]>=INTERRUPT_LIMIT)refused(progress,name,'interrupted');
  let lastError;
  for(const next of candidates){
   if(route!==next)stop();
   route=next;
   try{
    await start(progress);acceptQualification(await send('qualify',{},progress,ACQUIRE_STALL));
    announce(progress);return;
   }catch(error){
    if(signal.aborted)throw signal.reason;
    lastError=error;
    // An engine that never started tells us nothing about this route, and trying the next one
    // will meet the same wall. Report it once, honestly, instead of marking every route dead.
    if(error.engineStopped){refused(progress,route,'engine-stopped');stop();throw error;}
    refused(progress,route,error.name==='NotSupportedError'?'unsupported':'canary-failed');
    failedRoutes.add(route);stop();
    // Explicit selection is a deliberate retry, never permission to silently substitute CPU.
    if(preferredRoute!=='auto')throw error;
   }
  }
  throw lastError||Error('No local processing route remains available. Try an explicitly selected route before continuing.');
 }
 async function cachedGenerate(keyData,produce,progress,signal,persist=true,beforeAdmission=()=>{}){await config();const generationSha256=await digest(JSON.stringify(generationIdentity(manifest,keyData.kind))),key=await digest(JSON.stringify({generationSha256,...keyData})),store=await cache();let saved;try{saved=await store?.get(key);}catch{emit({stage:'cache-unavailable'},progress);}if(signal.aborted)throw signal.reason;if(saved?.blob instanceof Blob&&saved.blob.type==='image/png'&&saved.space==='w-plus'&&saved.generationSha256===generationSha256&&(keyData.kind!=='latent'||saved.latentSha256===keyData.sha256)){try{requireLatent(saved.values);if(saved.imageSha256===await digest(await saved.blob.arrayBuffer())&&saved.latentSha256===await digest(saved.values)){if(signal.aborted)throw signal.reason;emit({stage:'original-cache-hit'},progress);return {...saved,cached:true};}}catch(error){if(signal.aborted)throw error;emit({stage:'original-cache-invalid'},progress);}}beforeAdmission();if(!validated)await admit(progress,signal);if(signal.aborted)throw signal.reason;let result;try{result=await produce();}catch(error){if(signal.aborted)throw signal.reason;if(route==='cpu'||preferredRoute!=='auto'||!['generate','synthesize'].includes(error.failedOperation))throw error;failedRoutes.add(route);stop();if(chooseRoute()==='cpu')emit({stage:'fallback-cpu'},progress);await admit(progress,signal);result=await produce();}if(signal.aborted)throw signal.reason;const value={...result,generationSha256,imageSha256:await digest(await result.blob.arrayBuffer()),latentSha256:await digest(result.values),latent:{space:result.space,shape:[18,512],values:result.values},width:1024,height:1024,cached:false,provenance:{bundleVersion:manifest.bundleVersion,manifestSha256:manifestHash,modelSha256:manifest.modelSourceSha256,noiseSha256:manifest.noiseSha256,provider:route==='webgl'?'webgl2':route==='webgpu'?'webgpu':'wasm',mappingProvider:keyData.kind==='seed'?'wasm':null,route,truncationPsi:keyData.kind==='seed'?.7:null,truncationCutoff:keyData.kind==='seed'?8:null,createdAt:new Date().toISOString()}};try{if(persist){const aliases=[];if(keyData.kind==='seed'||keyData.kind==='photo'){const latentGenerationSha256=await digest(JSON.stringify(generationIdentity(manifest,'latent')));aliases.push({generationSha256:latentGenerationSha256,key:await digest(JSON.stringify({generationSha256:latentGenerationSha256,kind:'latent',sha256:value.latentSha256}))});}await store?.put(key,value,aliases);}emit({stage:!persist?'transient-frame':store?'original-cached':'cache-unavailable'},progress);}catch{emit({stage:'cache-unavailable'},progress);}return value;}
 // C-03: the cold path pays for exactly one canary before the first face. Once that face is
 // delivered, the remaining canaries finish on the worker's background lane, preempted by any
 // user operation. A canary that fails there invalidates the route loudly instead of silently
 // keeping output the canaries were supposed to prove.
 function startQualificationResume(){
  if(!qualificationPending||disposed||!worker)return;
  qualificationPending=false;
  send('qualify',{resume:true}).then(result=>{validated=result.deviceValidated===true;}).catch(error=>{
   if(error?.failedOperation==='qualify'&&error.correctnessFailure===true){
    validated=false;failedRoutes.add(route);
    // C-02: the rejection names the route that failed, not just that one failed.
    emit({stage:'canary-invalidated',provider:route});
   }else qualificationPending=true; // stopped worker or transient failure; retry on a later face
  });
 }
 const afterDelivery=promise=>promise.then(value=>{startQualificationResume();return value;});
 /**
  * Start acquiring what this device will need. `route` is the silent warm-up that runs as the
  * interface settles; `photo` is the ~1.1 GiB face detector and encoder, started the moment
  * someone reaches for a photo rather than when they commit to one.
  *
  * The photo scope speaks, and the route scope does not, because the visitor has expressed
  * intent: they are about to wait on the largest thing the product ever asks for, and a silent
  * gigabyte is the one case where saying nothing is worse than saying something.
  */
 async function prefetch(scope='route',{explicit=false}={}){
  const warmingPhoto=scope==='photo';
  if(disposed||active||worker||prefetchWorker||(!explicit&&!prefetchWelcome()))return {started:false};
  if(!warmingPhoto&&validated&&!explicit)return {started:false};
  let own;
  try{
   await config();
   // Probe before choosing what to download: this is exactly where guessing wrong costs 212 MB.
   if(capabilities().webgpu)await probeGpu();
   const target=preferredRoute==='auto'?chooseRoute():preferredRoute;
   if(failedRoutes.has(target))return {started:false};
   if(warmingPhoto&&!manifest.encoderStream&&!manifest.landmarks)return {started:false};
   // The preamble above awaits a manifest and an adapter probe, and a real operation can start
   // during either. `stopPrefetch` only terminates a worker that already exists, so without this
   // re-check the warm-up would create its worker *after* being cancelled and run unsupervised.
   if(disposed||active||worker)return {started:false};
   own=workerFactory();prefetchWorker=own;
   const result=await new Promise((resolve,reject)=>{
    prefetchCancel=()=>reject(Error('Warm-up superseded.'));
    own.onerror=()=>reject(Error('The warm-up engine stopped.'));
    own.onmessage=({data})=>{
     // The route warm-up stays off the bar: nothing was asked for. The photo warm-up reports,
     // because it was, and it is a gigabyte.
     if(data.type==='progress'){
      if(explicit){if(data.stage==='asset-acquisition')emit({stage:'models-download',scope,loaded:data.loaded,total:data.total,fetched:data.fetched,fetchedTotal:data.fetchedTotal});return;}
      if(warmingPhoto)emit({...data,stage:data.stage==='asset-acquisition'?'photo-acquisition':data.stage});
      return;}
     if(data.type==='error')reject(Error(data.error.message));
     else if(data.id===2)resolve(data.result);
    };
    own.postMessage({id:1,type:'initialize',manifest,provider:target==='webgl'?'webgl2':target==='webgpu'?'webgpu':'wasm',manifestSha256:manifestHash});
    own.postMessage({id:2,type:'prefetch',scope});
   });
   // Recorded, never spoken: a warm cache changes nothing the visitor can act on, and the
   // status line belongs to the operation they started. Reports still show what was warmed.
   const done=warmingPhoto?'photo-tools-ready':'models-prefetched';
   emit({stage:done,provider:target,...result});
   return {started:true,...result};
  }catch{return {started:false};}
  finally{if(prefetchWorker===own)stopPrefetch();}
 }
 function photoAvailable(){
  if(!alignPhoto||(!manifest?.encoder&&!manifest?.encoderStream))return false;
  const nav=globalThis.navigator,mobile=nav?.userAgentData?.mobile||/Android|iPhone|iPad|iPod/.test(nav?.userAgent||'')||(nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);
  return !(mobile&&manifest.encoderStream&&manifest.encoderStream.phoneAdmitted!==true);
 }
 async function inventory(){
  if(disposed)return null;
  await config();
  if(capabilities().webgpu)await probeGpu();
  const target=preferredRoute==='auto'?chooseRoute():preferredRoute;
  const own=workerFactory();
  try{
   const answers=await new Promise((resolve,reject)=>{
    const results={};
    own.onerror=()=>reject(Error('The model check stopped.'));
    own.onmessage=({data})=>{
     if(data.type==='error')reject(Error(data.error.message));
     else if(data.id===2)results.route=data.result;
     else if(data.id===3){results.photo=data.result;resolve(results);}
    };
    own.postMessage({id:1,type:'initialize',manifest,provider:target==='webgl'?'webgl2':target==='webgpu'?'webgpu':'wasm',manifestSha256:manifestHash});
    own.postMessage({id:2,type:'inventory',scope:'route'});
    own.postMessage({id:3,type:'inventory',scope:'photo'});
   });
   return {route:answers.route,photo:{...answers.photo,available:photoAvailable()}};
  }finally{own.terminate();}
 }
 const api={
 prefetch,
 inventory,
 setPreferredRoute:(requested)=>{if(active)throw Error('Cannot change processing mode during generation.');if(!['auto','cpu','webgl','webgpu'].includes(requested))throw Error('Invalid preferred inference route');if(preferredRoute!==requested){stop();preferredRoute=requested;}},
 qualify:(requestedRoute='cpu',options={})=>afterDelivery(operation(async progress=>{if(!['cpu','webgl','webgpu'].includes(requestedRoute))throw Error('Choose CPU, WebGL or WebGPU.');if(route!==requestedRoute)stop();route=requestedRoute;await start(progress);const result=await send('qualify',{},progress);acceptQualification(result);return result;},options)),
 generate:(request,options={})=>afterDelivery(operation(async(progress,signal)=>{const {identity}=await inputLatent(request.mode,request.value);return cachedGenerate({kind:'seed',identity},async()=>{await start(progress);return send('generate',{mode:request.mode,value:request.value},progress,ACQUIRE_STALL);},progress,signal);},{...request,...options})),
 synthesize:(latent,options={})=>afterDelivery(operation(async(progress,signal)=>{if(latent.space!=='w-plus'||JSON.stringify(latent.shape)!=='[1,18,512]')throw Error('Only explicit W+ [1,18,512] is accepted.');const values=requireLatent(latent.values);return cachedGenerate({kind:'latent',sha256:await digest(values)},async()=>{await start(progress);return send('synthesize',{values},progress);},progress,signal,options.persist!==false);},options)),
 encodePhoto:(blob,options={})=>afterDelivery(operation(async(progress,signal)=>{if(!(blob instanceof Blob)||blob.size>25*1024*1024)throw Error('Choose an image smaller than 25 MB.');const tryAlign=options.tryAlign??true;if(typeof tryAlign!=='boolean')throw Error('Alignment selection must be a boolean.');return cachedGenerate({kind:'photo',sha256:await digest(await blob.arrayBuffer()),tryAlign,facePolicy:'exactly-one-face-v1'},async()=>{if(!alignPhoto)throw Error('Browser face alignment is not installed in this bundle.');const acquireStall=ACQUIRE_STALL;const hold=holdEncoder();if(!hold){const admitted=validated;stop();validated=admitted;}emit({stage:'alignment'},progress);const alignmentStarted=performance.now();const prepared=await alignPhoto(blob,{signal,onProgress:event=>emit(event,progress),tryAlign,requireSingleFace:true});emit({stage:'alignment-complete',elapsedMs:performance.now()-alignmentStarted,scope:'Photo preprocessing wall time including verified alignment assets'},progress);if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256||prepared.alignmentWorkerTerminated!==true||prepared.faceCount!==1||prepared.provenance?.facePolicy!=='exactly-one-face-v1'||(tryAlign&&prepared.didAlign!==true))throw Error('Photo preprocessing identity or worker lifetime mismatch.');if(signal.aborted)throw signal.reason;await start(progress);const encoded=await send('encode-aligned',{tensor:prepared.tensor,qualifiedEncoderSha256:encoderValidatedSha256??qualifiedEncoder(),retain:hold},progress);if(manifest.encoderStream){if(encoded.encoderQualification?.passed!==true||encoded.encoderQualification.manifestSha256!==manifest.encoderStream.sha256){stop();throw Error('The photo encoder did not pass its pinned device correctness check.');}encoderValidatedSha256=manifest.encoderStream.sha256;rememberEncoder(encoderValidatedSha256);}if(!hold){const stillAdmitted=validated;stop();validated=stillAdmitted;}if(signal.aborted)throw signal.reason;await start(progress);const face=await send('synthesize',{values:encoded.values},progress);return {...face,encoderProvider:encoded.encoderProvider,encoderStats:encoded.encoderStats,encoderQualification:encoded.encoderQualification,preprocessing:prepared.provenance,faceCount:prepared.faceCount,didAlign:prepared.didAlign};},progress,signal,true,()=>{if(!alignPhoto)throw Error('Browser face alignment is not installed in this bundle.');const acquireStall=ACQUIRE_STALL;if(!manifest.encoder&&!manifest.encoderStream)throw Error('The photo encoder bundle is unavailable.');const nav=globalThis.navigator,mobile=nav?.userAgentData?.mobile||/Android|iPhone|iPad|iPod/.test(nav?.userAgent||'')||(nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);if(mobile&&manifest.encoderStream&&manifest.encoderStream.phoneAdmitted!==true)throw Error('The bounded photo encoder is still being qualified for phones. Your photo stays on this device.');if(mobile&&!manifest.encoderStream&&manifest.encoder?.size>512*1024*1024)throw Error('This photo encoder is too large for the verified phone path. Your photo stays on this device; try a desktop or laptop while the bounded encoder is being qualified.');});},options)),
 cancel:()=>{active?.abort(abortError());stop();},
 dispose:()=>{disposed=true;encoderValidatedSha256=undefined;active?.abort(abortError());stopPrefetch();stop();originals?.close();},
 status:()=>({route,deviceValidated:validated,encoderDeviceValidated:Boolean(manifest?.encoderStream&&(encoderValidatedSha256??qualifiedEncoder())===manifest.encoderStream.sha256),busy:!!active,disposed,interruptedRoute})
 };return api;
}
