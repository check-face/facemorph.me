import {openOriginals,digest} from './originals.mjs';
import {capabilities} from './route-priors.mjs';
import {rankedRoutes} from './route-selection.mjs';
import {inputLatent,requireLatent,generationIdentity} from './identity.mjs';
const abortError=()=>new DOMException('Generation cancelled','AbortError');
/** One foreground operation, one worker, explicit route qualification. */
export function createBrowserRuntime({manifest: suppliedManifest, manifestSha256:suppliedManifestSha256, manifestUrl='/runtime/manifest.json',onProgress=()=>{},alignPhoto,preferredRoute='auto',workerFactory=()=>new Worker(new URL('./ort-worker.mjs',import.meta.url),{type:'module'}),stallMs=300000}={}){
 const failedRoutes=new Set();let interruptedRoute;try{const previous=JSON.parse(sessionStorage.getItem('checkface-runtime-active-v1')||'null');if(previous?.route){interruptedRoute=previous.route;failedRoutes.add(previous.route);}sessionStorage.removeItem('checkface-runtime-active-v1');}catch{}
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
 function send(type,payload={},progress,stall=stallMs){return new Promise((resolve,reject)=>{const id=++sequence;if(type!=='initialize'&&!payload.resume)mark(type,id);const task={resolve,reject,progress,operation:type};const timeout=()=>{stop(Error('Generation stopped responding. Your saved work is safe.'));};task.timer=setTimeout(timeout,stall);task.reset=()=>{clearTimeout(task.timer);task.timer=setTimeout(timeout,stall);};pending.set(id,task);try{worker.postMessage({id,type,...payload});}catch(error){clearTimeout(task.timer);pending.delete(id);reject(error);}});}
 async function start(progress){if(worker)return;await config();worker=workerFactory();worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;if(data.type==='progress'){task.reset();if(data.stage==='synthesis-complete'){synthesisRuns++;if(synthesisRuns>1&&['generate','synthesize'].includes(task.operation)&&Number.isFinite(data.elapsedMs)&&data.elapsedMs>0)task.synthesisMs=data.elapsedMs;}emit(data,task.progress);return;}clearTimeout(task.timer);pending.delete(data.id);unmark();if(data.type==='error'){if(task.operation==='encode-aligned')encoderValidatedSha256=undefined;validated=false;failedRoutes.add(route);const error=Object.assign(Error(data.error.message),{name:data.error.name,failedOperation:task.operation,correctnessFailure:data.error.correctnessFailure===true});stop(error);task.reject(error);}else{if(task.synthesisMs!==undefined)remember(route,task.synthesisMs);task.resolve(data.result);}};worker.onerror=()=>stop(Error('The local generation engine stopped.'));await send('initialize',{manifest,provider:route==='webgl'?'webgl2':route==='webgpu'?'webgpu':'wasm',manifestSha256:manifestHash,fullQualify:globalThis.__FACEMORPH_FULL_QUALIFY__===true,hostForcedQualify:globalThis.__FACEMORPH_FULL_QUALIFY__!==undefined,webdriver:globalThis.navigator?.webdriver===true,forceCanaryFail:globalThis.__FACEMORPH_FORCE_CANARY_FAIL__===true},progress);}
 async function operation(fn,{signal,onProgress:progress}={}){if(disposed)throw Error('Runtime disposed');if(active)throw Error('Another generation is still running.');if(signal?.aborted)throw signal.reason||abortError();const controller=new AbortController();active=controller;const abort=()=>{controller.abort(signal?.reason||abortError());stop(controller.signal.reason);};signal?.addEventListener('abort',abort,{once:true});try{return await fn(progress,controller.signal);}finally{signal?.removeEventListener('abort',abort);active=null;}}
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
 const SPEED_KEY='facemorph-route-speed-v2';
 function speeds(){try{const raw=JSON.parse(localStorage.getItem(SPEED_KEY)||'{}');return raw?.bundle===manifestHash&&raw.scope==='warm-synthesis-v1'&&raw.routes&&typeof raw.routes==='object'?raw.routes:{};}catch{return {};}}
 function remember(name,ms){try{const routes={...speeds(),[name]:ms};localStorage.setItem(SPEED_KEY,JSON.stringify({bundle:manifestHash,scope:'warm-synthesis-v1',routes}));}catch{}}
 // Only successful foreground synthesis after a prior run on this worker is measured.
 // Cold shader compilation, qualification, storage and downloads cannot become a speed verdict.
 function capability(){const base=capabilities();return {...base,webgpu:base.webgpu&&Boolean(manifest.webgpu),webgl:base.webgl&&Boolean(manifest.webgl)};}
 function supportedRoutes(){const caps=capability();return ['cpu',...(caps.webgl?['webgl']:[]),...(caps.webgpu?['webgpu']:[])];}
 function orderedRoutes(){return rankedRoutes(capability(),supportedRoutes(),speeds(),failedRoutes);}
 function chooseRoute(){return orderedRoutes()[0];}
 function acceptQualification(result){
  if(result.deviceValidated!==true)throw Error('The selected route did not pass its device correctness check.');
  validated=true;qualificationPending=result.partial===true;
  failedRoutes.delete(route);if(interruptedRoute===route)interruptedRoute=undefined;
 }
 async function admit(progress,signal){
  const candidates=preferredRoute==='auto'?orderedRoutes():[preferredRoute];
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
 const api={
 setPreferredRoute:(requested)=>{if(active)throw Error('Cannot change processing mode during generation.');if(!['auto','cpu','webgl','webgpu'].includes(requested))throw Error('Invalid preferred inference route');if(preferredRoute!==requested){stop();preferredRoute=requested;}},
 qualify:(requestedRoute='cpu',options={})=>afterDelivery(operation(async progress=>{if(!['cpu','webgl','webgpu'].includes(requestedRoute))throw Error('Choose CPU, WebGL or WebGPU.');if(route!==requestedRoute)stop();route=requestedRoute;await start(progress);const result=await send('qualify',{},progress);acceptQualification(result);return result;},options)),
 generate:(request,options={})=>afterDelivery(operation(async(progress,signal)=>{const {identity}=await inputLatent(request.mode,request.value);return cachedGenerate({kind:'seed',identity},async()=>{await start(progress);return send('generate',{mode:request.mode,value:request.value},progress,ACQUIRE_STALL);},progress,signal);},{...request,...options})),
 synthesize:(latent,options={})=>afterDelivery(operation(async(progress,signal)=>{if(latent.space!=='w-plus'||JSON.stringify(latent.shape)!=='[1,18,512]')throw Error('Only explicit W+ [1,18,512] is accepted.');const values=requireLatent(latent.values);return cachedGenerate({kind:'latent',sha256:await digest(values)},async()=>{await start(progress);return send('synthesize',{values},progress);},progress,signal,options.persist!==false);},options)),
 encodePhoto:(blob,options={})=>afterDelivery(operation(async(progress,signal)=>{if(!(blob instanceof Blob)||blob.size>25*1024*1024)throw Error('Choose an image smaller than 25 MB.');const tryAlign=options.tryAlign??true;if(typeof tryAlign!=='boolean')throw Error('Alignment selection must be a boolean.');return cachedGenerate({kind:'photo',sha256:await digest(await blob.arrayBuffer()),tryAlign,facePolicy:'exactly-one-face-v1'},async()=>{if(!alignPhoto)throw Error('Browser face alignment is not installed in this bundle.');const acquireStall=ACQUIRE_STALL;const admitted=validated;stop();validated=admitted;emit({stage:'alignment'},progress);const alignmentStarted=performance.now();const prepared=await alignPhoto(blob,{signal,onProgress:event=>emit(event,progress),tryAlign,requireSingleFace:true});emit({stage:'alignment-complete',elapsedMs:performance.now()-alignmentStarted,scope:'Photo preprocessing wall time including verified alignment assets'},progress);if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256||prepared.alignmentWorkerTerminated!==true||prepared.faceCount!==1||prepared.provenance?.facePolicy!=='exactly-one-face-v1'||(tryAlign&&prepared.didAlign!==true))throw Error('Photo preprocessing identity or worker lifetime mismatch.');if(signal.aborted)throw signal.reason;await start(progress);const encoded=await send('encode-aligned',{tensor:prepared.tensor,qualifiedEncoderSha256:encoderValidatedSha256},progress);if(manifest.encoderStream){if(encoded.encoderQualification?.passed!==true||encoded.encoderQualification.manifestSha256!==manifest.encoderStream.sha256){stop();throw Error('The photo encoder did not pass its pinned device correctness check.');}encoderValidatedSha256=manifest.encoderStream.sha256;}const stillAdmitted=validated;stop();validated=stillAdmitted;if(signal.aborted)throw signal.reason;await start(progress);const face=await send('synthesize',{values:encoded.values},progress);return {...face,encoderProvider:encoded.encoderProvider,encoderStats:encoded.encoderStats,encoderQualification:encoded.encoderQualification,preprocessing:prepared.provenance,faceCount:prepared.faceCount,didAlign:prepared.didAlign};},progress,signal,true,()=>{if(!alignPhoto)throw Error('Browser face alignment is not installed in this bundle.');const acquireStall=ACQUIRE_STALL;if(!manifest.encoder&&!manifest.encoderStream)throw Error('The photo encoder bundle is unavailable.');const nav=globalThis.navigator,mobile=nav?.userAgentData?.mobile||/Android|iPhone|iPad|iPod/.test(nav?.userAgent||'')||(nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);if(mobile&&manifest.encoderStream&&manifest.encoderStream.phoneAdmitted!==true)throw Error('The bounded photo encoder is still being qualified for phones. Your photo stays on this device.');if(mobile&&!manifest.encoderStream&&manifest.encoder?.size>512*1024*1024)throw Error('This photo encoder is too large for the verified phone path. Your photo stays on this device; try a desktop or laptop while the bounded encoder is being qualified.');});},options)),
 cancel:()=>{active?.abort(abortError());stop();},
 dispose:()=>{disposed=true;encoderValidatedSha256=undefined;active?.abort(abortError());stop();originals?.close();},
 status:()=>({route,deviceValidated:validated,encoderDeviceValidated:Boolean(manifest?.encoderStream&&encoderValidatedSha256===manifest.encoderStream.sha256),busy:!!active,disposed,interruptedRoute})
 };return api;
}
