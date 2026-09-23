import {createPhotoAligner} from './photo/align-photo.mjs';
import {createDesktopRuntime} from '../../desktop/runtime.mjs';
import {createBrowserRuntime} from './browser/runtime.mjs';
import {createLatentPath,GEOMETRY_VERSION} from './geometry/latent-path.mjs';
import {decode,encode} from './ProjectJson.fs.js';
import {saveFile,shareFile,videoWriter} from './media.mjs';
import {diagnostics} from './reporting.mjs';
import {labelFor,loadedBytes,createFrameCounter} from './stage-labels.mjs';
import {frameStoreKey,frameStoreGet} from './morph-frames.mjs';
import {selectPhoto} from './photo-selection.mjs';
import {persistenceAction} from './storage-request.mjs';
import {previewPhoto,cropPhoto} from './photo/crop.mjs';
// The U-14 slider consumes frames through window.__nextFrames.get(key); wire the real store
// here so the UI has exactly one integration point. Guarded so stripped-import test harnesses
// (which leave the identifier undefined) skip the install instead of crashing module load.
if(typeof frameStoreGet!=='undefined'&&typeof window!=='undefined'&&!window.__nextFrames)window.__nextFrames={get:frameStoreGet};
let listener=()=>{},runtime,manifest,active,writer,currentJob=0,project=null,video=null;
const faces=new Map(),urls=new Map();
function progress(event){
 const stage=event.stage||'working';
 if(stage==='models-download'){Object.assign(downloads,{phase:'downloading',scope:event.scope,loaded:Number(event.loaded)||0,total:Number(event.total)||downloads.total});announceDownloads();return;}
 lastStage=stage;
 reportStorage();
 const loaded=loadedBytes(event),fraction=event.total>0&&Number.isFinite(loaded)?loaded/event.total:0;
 // Byte ticks inside one asset are for the bar, not for the collector: at a megabyte apiece
 // they would turn a cold load into hundreds of POSTs and tell the ledger nothing new.
 if(!event.progressOnly)diagnostics.stage(stage,event);
 // The admitted route is carried as the text so the interface can say when this device is on the
 // slow path; it is a route name, not a status line. A refused route (canary-failed and the other
 // non-admitted outcomes, plus a background canary failure) is carried as route-rejected so the
 // interface can name which route failed and which is in use instead of silently swallowing it.
 if(stage==='route-admitted'){
  if(event.routeOutcome&&event.routeOutcome!=='admitted'){listener({jobId:currentJob,stage:'route-rejected',text:String(event.provider||''),fraction:0});return;}
  listener({jobId:currentJob,stage,text:String(event.provider||''),fraction:0});return;}
 if(stage==='canary-invalidated'){listener({jobId:currentJob,stage:'route-rejected',text:String(event.provider||''),fraction:0});return;}
 const text=labelFor(stage,event);
 // Silent by design, or a stage nobody has written a line for: either way the message already
 // on screen stands. Nothing is overwritten with a word that means nothing, and
 // stage-labels.test.mjs is what stops the second case ever shipping.
 if(text===null||text===undefined)return;
 // A job the visitor asked for has one honest measure of progress: how many of the things they
 // asked for are finished. Reporting each stage's own fraction made the bar jump backwards at
 // every face — a download is 0..1, then synthesis is 0..1, then the next face starts at 0
 // again — and let "Face generated." land in the middle of a thirty-face run as though the job
 // were done. While a multi-unit job is running the bar tracks completed units and the terminal
 // per-unit stages stay silent; the sub-stage still speaks through its own line.
 // What a face costs on this device is the synthesis, not the job wrapped around it. Timing the
 // whole call made "On this device a face took 38 seconds" out of a run whose synthesis was
 // 1,597 ms: the other 36 seconds were a gigabyte of encoder acquisition, alignment and a
 // correctness pass, none of which repeat per face. The runtime already reports the real figure.
 if(stage==='synthesis-complete'&&Number.isFinite(event.elapsedMs)&&event.elapsedMs>0)
  (jobCounts.framesTotal>1?recordFrame:recordFace)(event.elapsedMs);
 const units=jobCounts.framesTotal>1?{done:jobCounts.framesDone,total:jobCounts.framesTotal}
            :jobCounts.facesTotal>1?{done:jobCounts.facesDone,total:jobCounts.facesTotal}:null;
 // Operator direction, 21 September, and this is a release gate: while a morph is rendering the
 // line is an incrementing integer and nothing else. It used to flicker between "Generating…",
 // "Encoding your photo…" (during a morph, where no photo exists) and "Face generated." — three
 // values per frame where there should be one. Every stage but the frame counter and the export
 // is silent for the duration; the phases still reach the diagnostics record above.
 if(jobCounts.framesTotal>1&&!MORPH_SPOKEN_STAGES.has(stage))return;
 if(units&&UNIT_TERMINAL_STAGES.has(stage))return;
 const bar=units?units.done/units.total:(Number.isFinite(fraction)?fraction:0);
 listener({jobId:currentJob,stage,text,fraction:bar});}
// Stages that mean "this one unit finished". True, and useless mid-job: the visitor asked for
// thirty faces, so one of them completing is not a status worth replacing the count with.
// The only stages allowed to speak while a morph renders: the frame counter, and the export that
// follows it. `scripts/check-progress-copy.mjs` fails the build if anything else can reach the
// line, and `stage-labels.test.mjs` fails if these lose their text.
const MORPH_SPOKEN_STAGES=new Set(['morph','export']);
const UNIT_TERMINAL_STAGES=new Set(['synthesis-complete','model-loaded','mapping-complete',
 'encoding-complete','alignment-complete','encoder-loaded','original-cached','original-cache-hit']);
function canonicalProject(value){const decoded=decode(typeof value==='string'?value:JSON.stringify(value));if(decoded.tag!==0)throw Error('This project is invalid or uses an unsupported format.');const encoded=encode(decoded.fields[0]);if(encoded.tag!==0)throw Error('This project cannot be opened.');return JSON.parse(encoded.fields[0]);}
async function engine(){
 if(runtime)return runtime;
 const response=await fetch('/runtime/manifest.json',{cache:'no-cache',signal:active?.signal});if(!response.ok)throw Error('Model setup is unavailable. Please try again shortly.');const raw=await response.arrayBuffer();if(raw.byteLength>4*1024*1024)throw Error('Model manifest is too large.');manifest=JSON.parse(new TextDecoder().decode(raw));const manifestSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 diagnostics.bundle(manifestSha256);
 // The browser adapter rejects missing photo support rather than silently using a server.
 const photoAligner=manifest.photo?createPhotoAligner({manifestUrl:manifest.photo.manifestUrl,workerUrl:manifest.photo.workerUrl}):null;
 const alignPhoto=photoAligner?async(blob,options)=>{const prepared=await photoAligner(blob,options);if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256)throw Error('Photo processing files changed. Reload before trying again.');return prepared;}:undefined;
 runtime=globalThis.__TAURI__?createDesktopRuntime({onProgress:progress}):createBrowserRuntime({manifest,manifestSha256,onProgress:progress,alignPhoto});return runtime;
}
function replaceUrl(key,blob){const old=urls.get(key);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(blob);urls.set(key,url);return url;}
function snapshot(message='Done — ready to save or share.',restore=false){
 return {errorMessage:'',faces:[...faces].map(([id,f])=>({id,url:urls.get(id),label:f.label||'Face'})),videoUrl:video?urls.get('video'):'',projectJson:project?JSON.stringify(project):'',message,restored:restore,inputs:restore?[...faces].map(([id])=>({id,mode:'project',value:'Project face',file:null})):[],kind:project?.morph.kind||'',width:project?.morph.width||0,pinch:!!project?.morph.pinchCenter,frames:project?.morph.framesPerSegment||16,fps:project?.morph.framesPerSecond||16};
}
function checked(){if(active?.signal.aborted)throw new DOMException('Cancelled','AbortError');}
// What a face actually costs on this device, so the interface can estimate from measurement
// rather than from a guess. A cached face is not a measurement of work.
let lastStage;
const faceTimings=[];
const frameTimings=[];
const now=()=>globalThis.performance?.now?.()??Date.now();
function recordUnit(timings,ms){if(Number.isFinite(ms)&&ms>0){timings.push(ms);if(timings.length>8)timings.shift();}}
function recordFace(ms){recordUnit(faceTimings,ms);}
function recordFrame(ms){recordUnit(frameTimings,ms);}
function median(timings){if(!timings.length)return null;const sorted=[...timings].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
/** Median measured face time in milliseconds, or null until this device has produced one. */
export function measuredFaceMs(){return median(faceTimings);}
/** Median measured synthesis time per morph frame in milliseconds, or null until this device
 * has synthesised a frame. Cached endpoints are not measurements of work. */
export function measuredFrameMs(){return median(frameTimings);}
/** Progress counters for the job in flight, so the interface can say what is left. */
const jobCounts={facesDone:0,facesTotal:0,framesDone:0,framesTotal:0};
export function jobProgress(){return {...jobCounts};}
/** Frames the current settings would render, from the same geometry the morph uses. */
export function plannedFrames(options){
 try{
  const controls=options.inputs.map(input=>{const face=faces.get(input.id);return face&&{visitId:input.id,latent:{...face.latent,values:face.latent.values}};});
  if(controls.some(control=>!control)||controls.length<2)return null;
  return createLatentPath({kind:options.kind,width:options.width,pinchCenter:options.pinch,framesPerSegment:options.frames,framesPerSecond:options.fps,controls}).totalFrames;
 }catch{return null;}
}
/** Canonical identity of the current morph: delegated to the morph-frame store's frameStoreKey
 * so the slider and any other frame consumer agree on which retained frames belong to which
 * morph — one derivation, not two. Null until a project exists or the latents cannot be hashed. */
export async function morphFramesKey(){
 if(!project?.morph?.controls?.length)return null;
 try{return await frameStoreKey(project.morph);}catch{return null;}
}
/** Display-size frames of the current morph for the U-14 slider. Single integration point:
 * the real morph-frame store arrives behind window.__nextFrames.get(key), so swapping to a
 * direct store import touches only this function. Null when the frames are not on this
 * device; the interface then says so rather than promising a scrub it cannot do. */
export async function sliderFrames(){
 try{
  const store=globalThis.__nextFrames,key=await morphFramesKey();
  if(!store||typeof store.get!=='function'||!key)return null;
  const frames=await store.get(key);
  if(!Array.isArray(frames)||frames.length===0)return null;
  return frames.map(frame=>URL.createObjectURL(frame instanceof Blob?frame:new Blob([frame],{type:'image/png'})));
 }catch{return null;}
}
async function register(id,result,label){if(!(result.blob instanceof Blob)||result.blob.type!=='image/png'||!result.latent)throw Error('The generation engine returned an incomplete face.');faces.set(id,{...result,label});replaceUrl(id,result.blob);}
async function inputs(request){
 const service=await engine(),next=new Map();
 for(let i=0;i<request.inputs.length;i++){
  checked();const item=request.inputs[i];progress({stage:'face',face:item.id,text:`Face ${i+1} of ${request.inputs.length}`,loaded:i,total:request.inputs.length});
  let result;
  if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
  else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for each photo input.');result=await service.encodePhoto(item.file,{signal:active.signal});}
  else {result=await service.generate({mode:item.mode,value:item.value,signal:active.signal});}
  jobCounts.facesDone=i+1;
  next.set(item.id,{...result,label:item.mode==='photo'?'Photo':item.value,source:{mode:item.mode,value:item.value,file:item.file}});
 }
 const provenance=next.get(request.inputs[0].id).provenance;
 const nextProject=canonicalProject({schemaVersion:1,bundle:{version:provenance.bundleVersion,manifestSha256:provenance.manifestSha256},modelSha256:provenance.modelSha256,noiseSha256:provenance.noiseSha256,truncationPsi:1,truncationCutoff:0,morph:{algorithmVersion:GEOMETRY_VERSION,kind:request.kind,closed:true,width:request.width,pinchCenter:request.pinch,framesPerSegment:request.frames,framesPerSecond:request.fps,controls:request.inputs.map(item=>({visitId:item.id,latent:{...next.get(item.id).latent,values:Array.from(next.get(item.id).latent.values)}}))}});
 checked();await commit(next,nextProject);
}
async function commit(next,nextProject){
 for(const result of next.values())if(!(result.blob instanceof Blob)||result.blob.type!=='image/png'||!result.latent)throw Error('The generation engine returned an incomplete face.');
 for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();faces.clear();video=null;
 for(const [id,result] of next)await register(id,result,result.label);
 project=nextProject;
}
async function admission(provider){
 const service=await engine(),route=provider==='auto'?'cpu':provider;
 if(!['auto','cpu','webgl','webgpu'].includes(provider))throw Error('Choose a supported processing mode.');
 if(!globalThis.__TAURI__){service.setPreferredRoute(provider);return;}
 if(provider!=='auto'&&provider!=='cpu')throw Error('This desktop preview currently supports native CPU processing.');
 // Native adapter checks its persistent original cache before qualification.

}
// Issue #28 and operator, 23 September: nothing downloads until the visitor asks, through the
// model toast or the download dialog in front of Generate. Load only observes: the manifest (a few
// KB), what is already cached, and storage state.
function warmUp(){
 askForPersistentStorage();
 void refreshInventory();
}
const downloads={known:false,phase:'idle',scope:'',loaded:0,total:0,routeReady:false,photoReady:false,photoAvailable:false,routeBytes:0,photoBytes:0};
const wanted=new Set(),downloadListeners=new Set();
let downloading=null;
function announceDownloads(){const snapshot={...downloads};for(const callback of downloadListeners){try{callback(snapshot);}catch{}}}
export function subscribeDownloads(callback){downloadListeners.add(callback);callback({...downloads});}
async function refreshInventory(){
 try{
  const service=await engine();if(!service.inventory)return;
  const found=await service.inventory();if(!found)return;
  Object.assign(downloads,{known:true,routeReady:found.route.ready,photoReady:found.photo.ready,photoAvailable:found.photo.available===true,
   routeBytes:Math.max(0,found.route.total-found.route.present),photoBytes:Math.max(0,found.photo.total-found.photo.present)});
  announceDownloads();
 }catch(error){console.warn('Model inventory unavailable:',error?.message||error);}
}
export function downloadModels(includePhoto){
 keepModelsOnDevice();
 wanted.add('route');if(includePhoto)wanted.add('photo');
 downloads.phase='downloading';announceDownloads();
 void pumpDownloads();
}
export function consentToDownload(scope){keepModelsOnDevice();return scope;}
async function pumpDownloads(){
 if(downloading||active)return;
 for(const scope of ['route','photo']){
  if(!wanted.has(scope))continue;
  downloading=scope;Object.assign(downloads,{phase:'downloading',scope,loaded:0,total:scope==='route'?downloads.routeBytes:downloads.photoBytes});announceDownloads();
  let result={started:false};
  try{result=await (await engine()).prefetch(scope,{explicit:true});}catch{}
  downloading=null;
  if(active){downloads.phase='waiting';announceDownloads();return;}
  if(!result.started||result.acquired!==result.assets){downloads.phase='failed';wanted.clear();announceDownloads();await refreshInventory();return;}
  wanted.delete(scope);
 }
 await refreshInventory();
 downloads.phase=downloads.routeReady?'done':'idle';announceDownloads();
}
export function subscribe(callback){listener=callback;window.addEventListener('facemorph-report-status',({detail})=>callback({jobId:currentJob,stage:'diagnostics-'+detail.status,text:detail.reference||'',fraction:0}));diagnostics.restore();warmUp();}
export async function execute(request){
 if(active)throw Error('Another job is still stopping.');active=new AbortController();currentJob=request.jobId;closePhotoRun('completed');diagnostics.start(request.action,request.provider);reportStorage();
 try{
  await admission(request.provider);
  // Per-face generate (U-03): work only the one face asked for, so no other face emits a
  // synthesis. Cached hits stay cheap and are not treated as measurements.
  if(request.action==='face'){
   const item=(request.inputs||[]).find(candidate=>candidate.id===request.target);
   if(!item)throw Error('Choose a face to generate.');
   jobCounts.facesDone=0;jobCounts.facesTotal=1;jobCounts.framesDone=0;jobCounts.framesTotal=0;
   progress({stage:'face',face:item.id,text:'Generating this face…',loaded:0,total:1});
   const service=await engine();
   let result;
   if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
   else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for this face.');result=await service.encodePhoto(item.file,{signal:active.signal});}
   else {if(!String(item.value??'').length)throw Error('Type a name or seed first.');result=await service.generate({mode:item.mode,value:item.value,signal:active.signal});}
   checked();await register(item.id,result,item.mode==='photo'?'Photo':item.value);
   const current=faces.get(item.id);current.source={mode:item.mode,value:item.value,file:item.file};
   // A changed face invalidates the saved morph and its video, never the other faces.
   project=null;video=null;
   jobCounts.facesDone=1;diagnostics.finish('completed');return snapshot('Face updated.');
  }
  jobCounts.facesDone=0;jobCounts.facesTotal=request.inputs.length;jobCounts.framesDone=0;jobCounts.framesTotal=0;
  await inputs(request);checked();
  if(request.action==='morph'){
   const path=createLatentPath(project.morph);if(path.totalFrames>4096)throw Error('Choose fewer faces or frames for this export.');
   jobCounts.framesTotal=path.totalFrames;
   const framesKey=await morphFramesKey();
   const stored=framesKey?await frameStoreGet(framesKey).catch(()=>null):null;
   writer=videoWriter({codec:manifest.codec,fps:project.morph.framesPerSecond,signal:active.signal,onProgress:progress,framesKey,totalFrames:path.totalFrames});await writer.initialize();
   const counter=createFrameCounter(path.totalFrames);
   if(stored&&stored.length===path.totalFrames){
    for(const frame of path.frames()){checked();await writer.add(stored[frame.index],frame.index);jobCounts.framesDone=frame.index+1;}
   }else{
    const first=counter.start();progress({stage:'morph',text:first.text,loaded:first.done,total:path.totalFrames});
    for(const frame of path.frames()){
    checked();
    const saved=frame.visitId?faces.get(frame.visitId):null;
    // The frame's own cost is reported by the runtime as synthesis-complete and recorded in
    // progress(); timing the call here would fold acquisition and storage into a per-frame figure.
    const output=saved||await runtime.synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)},{signal:active.signal,persist:false});
    await writer.add(output.blob,frame.index);
    const finished=counter.complete(frame.index);jobCounts.framesDone=finished.done;
    progress({stage:'morph',text:finished.text,loaded:finished.done,total:path.totalFrames});
   }}
   progress({stage:'export',text:'Finishing your video…'});video=await writer.finish();writer=null;replaceUrl('video',video);
  }
  diagnostics.finish('completed');return snapshot();
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});if(error?.name==='AbortError')return snapshot('Cancelled. Your completed faces are still available.');return {...snapshot(''),errorMessage:String(error?.message||'Generation failed. Your completed results are still available.')};}
 finally{writer?.dispose();writer=null;active=null;if(wanted.size)void pumpDownloads();else void refreshInventory();}
}
export function cancel(){active?.abort();writer?.dispose();runtime?.cancel();}
export async function saveMedia(id){const blob=id==='video'?video:faces.get(id)?.blob;return saveFile(blob,id==='video'?'facemorph.mp4':'facemorph.png');}
export async function shareMedia(id){const blob=id==='video'?video:faces.get(id)?.blob;if(!blob)throw Error('Generate a result first.');return shareFile(blob,id==='video'?'facemorph.mp4':'facemorph.png');}
export async function exportProject(options){
 if(!project)throw Error('Generate or open a project first.');
 let selected=project;
 if(options){
  if(!Array.isArray(options.inputs)||options.inputs.some(input=>{const face=faces.get(input.id);return !face||(input.mode!=='project'&&(!face.source||face.source.mode!==input.mode||face.source.value!==input.value||face.source.file!==input.file));}))throw Error('Generate the changed faces before saving this project.');
  selected={...project,morph:{...project.morph,kind:options.kind,width:options.width,pinchCenter:options.pinch,framesPerSegment:options.frames,framesPerSecond:options.fps,controls:options.inputs.map(input=>({visitId:input.id,latent:{...faces.get(input.id).latent,values:Array.from(faces.get(input.id).latent.values)}}))}};
 }
 const checked=canonicalProject(selected);createLatentPath(checked.morph);
 return saveFile(new Blob([JSON.stringify(checked)],{type:'application/json'}),'facemorph-project.json');
}
export async function importProject(request){
 const {file,jobId}=request;
 if(active)throw Error('Wait for the current job to finish.');if(!(file instanceof Blob)||file.size>16*1024*1024)throw Error('Choose a FaceMorph project smaller than 16 MB.');
 active=new AbortController();currentJob=jobId;
 try{
  const imported=canonicalProject(await file.text());createLatentPath(imported.morph);const service=await engine();
  if(imported.modelSha256!==manifest.modelSourceSha256||imported.noiseSha256!==manifest.noiseSha256)throw Error('This project needs a different model bundle. Its saved file has not been changed.');
  if(imported.morph.controls.some(x=>x.latent.space!=='w-plus'))throw Error('This generation bundle requires a W+ project.');
  await admission(request.provider||'auto');const next=new Map();
  for(const control of imported.morph.controls){checked();const result=await service.synthesize({...control.latent,shape:[1,18,512],values:Float32Array.from(control.latent.values)},{signal:active.signal});next.set(control.visitId,{...result,label:'Project face'});}
  checked();await commit(next,imported);return snapshot('Project opened.',true);
 }finally{active=null;}
}
/** `basis` records how the visitor agreed: checkbox, invite or toast (reporting.mjs CONSENT_BASES). */
export function setDebug(enabled,basis){diagnostics.enable(enabled,basis||'checkbox');}
/** "Send this report": the staged records of the failure go out once; reporting stays off. */
export function sendReportOnce(){return diagnostics.sendOnce();}
/** Whether this visitor has already answered the reporting question, yes or no. */
export function consentAnswered(){return diagnostics.answered();}
/** How much of this session is staged on the device, ready to send if the tester agrees. */
export function stagedReportCount(){return diagnostics.status().staged||0;}
/** The reference of the run a failure was filed under, for the error box (R2-15): a tester
 * who can read the reference next to the failure can tie it to the staged report. Empty
 * without consent. */
export function reportReference(){const status=diagnostics.status();return status.enabled||status.once?status.reference||'':'';}

// R2-15: photo preparation (select, preview, crop) used to run entirely outside the job
// lifecycle — no run opened, so a consented session recorded NOTHING about the exact step
// that failed on the operator's iPhone ("failed to crop"). Photo preparation is now its own
// reported run with named stages; a real job closes it on start.
let photoRun=false;
function closePhotoRun(status){if(photoRun){diagnostics.finish(status);photoRun=false;}}
export function photoStage(name,run){
 if(!diagnostics.status().enabled)return run();
 try{
  if(!photoRun){diagnostics.start('photo');photoRun=true;}
  diagnostics.stage(name,{});
  const result=run();
  return Promise.resolve(result).catch(error=>{
   if(photoRun){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:name});photoRun=false;}
   throw error;
  });
 }catch(error){
  if(photoRun){diagnostics.finish('failed',error,{stage:name});photoRun=false;}
  throw error;
 }
}
// R2-15, the eviction half: ask for persistent storage once per session at the first real
// job — granted, and the browser stops treating ~1 GB of models as disposable. Whatever the
// answer, the run records the truth (persisted flag, rounded megabytes) so a later
// "Stored asset disappeared" report reads with its cause attached.
let storageAsked=false,storageFacts=null;
/**
 * Issue #28: Firefox shows a permission prompt for persist(), and asking on page load gave no
 * reason. Engines that decide silently are still asked at once. Gecko is only asked through
 * `keepModelsOnDevice`, from a control that has explained why; until then its storage facts are
 * observed without asking.
 */
function askForPersistentStorage({explained=false}={}){
 const action=persistenceAction({userAgent:globalThis.navigator?.userAgent,explained,alreadyAsked:storageAsked});
 if(action==='none')return;
 if(action==='request')storageAsked=true;
 void Promise.resolve().then(async()=>{
  const {storageStatus}=await import('./Assets/model-cache.mjs');
  const status=await storageStatus({requestPersistence:action==='request'});
  storageFacts={persisted:status.persistence==='granted',
   usageMb:Math.round((status.usage||0)/1048576)||undefined,
   quotaMb:Math.round((status.quota||0)/1048576)||undefined};
  storageReported=false;reportStorage();
 }).catch(()=>{});
}
export function keepModelsOnDevice(){askForPersistentStorage({explained:true});}
/**
 * Put the storage facts into the record at the first opportunity a run gives us.
 *
 * `diagnostics.stage('storage')` is dropped unless a run is open, and the facts resolve
 * asynchronously — so reporting only at job start lost them whenever the persist() answer had not
 * landed yet, and nothing retried. Three rounds of the operator's reports contained no storage
 * record at all, which left a denied request and an evicted cache indistinguishable. This retries
 * on every stage until one sticks, which costs one boolean per stage and settles the question.
 */
let storageReported=false;
function reportStorage(){
 if(storageReported||!storageFacts)return;
 diagnostics.stage('storage',storageFacts);
 if(diagnostics.status?.().enabled)storageReported=true;
}
// Reported wrappers: the UI calls these instead of the raw photo modules, so preparation
// failures land in the record with their stage attached.
/** Loads the manifest early on a photo intent. The ~1.1 GB photo model itself downloads only on request (issue #28). */
export function warmPhotoTools(){
 engine().catch(()=>{});
}
export function selectPhotoReported(request){warmPhotoTools();return photoStage('photo-select',()=>selectPhoto(request));}
export function previewPhotoReported(file,options){return photoStage('photo-preview',()=>previewPhoto(file,options));}
export function cropPhotoReported(file,area,options){return photoStage('photo-crop',()=>cropPhoto(file,area,options));}
export function cancelPhotoRun(){closePhotoRun('cancelled');}
// Published gallery assets are addressed by the same identity the product already computes:
// a text face by the SHA-256 of its exact lowercase request, a numeric seed by the seed. The
// catalogue carries identities rather than 8,966 URLs, so these rules derive the rest.
// These are historic lossy previews. They are never canonical originals and must never be
// written into the device originals cache.
let gallery=null;
export function galleryTextUrl(origin,hash,dimension,format){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid gallery identity.');
 return `${origin}/outputImages/hash-${hash.slice(0,2)}/${hash.slice(2,4)}/hash-${hash}_${dimension}.${format}`;
}
export function gallerySeedUrl(origin,seed,dimension,format){
 if(!Number.isInteger(seed)||seed<0)throw Error('Invalid gallery seed.');
 return `${origin}/outputImages/s${seed%100}/${seed}/s${seed}_${dimension}.${format}`;
}
export async function loadNames(){
 const response=await fetch('/catalogue.json');if(!response.ok)throw Error('The name gallery is unavailable. You can still enter any name.');
 const data=await response.json();if(!Array.isArray(data.names)||data.names.length>10000)throw Error('Invalid name gallery.');
 const origin=String(data.origin||'');
 if(origin&&new URL(origin).protocol!=='https:')throw Error('Invalid name gallery origin.');
 gallery={origin,seeds:data.seeds||null};
 return data.names.map(x=>({name:String(x.name),value:String(x.value),
  // A pre-v2 catalogue carried the preview URL directly; a v2 one carries the identity.
  image:x.id&&origin?galleryTextUrl(origin,String(x.id),200,'jpg'):String(x.image||''),
  full:x.full?String(x.full):''}));
}
/** The published seed range, for the numeric seed browser. Null until the catalogue loads. */
export function loadedGallery(){return gallery;}

export function sourceVersion(){
 let sha='unknown';try{sha=String(process.env.FACEMORPH_SOURCE_SHA||'unknown');}catch{}
 const [commit,dirty]=sha.split('-');
 return /^[0-9a-f]{40}$/.test(commit)?commit.slice(0,7)+(dirty?'+':''):'local';
}
const ISSUE_REPO='https://github.com/check-face/facemorph.me/issues/new';
export function issueUrl(route){
 const status=diagnostics.status(),reference=status.enabled||status.once?status.reference||'':'';
 const version=sourceVersion(),device=String(globalThis.navigator?.userAgent||'').slice(0,300),path=String(globalThis.location?.pathname||'/');
 const summary=['Site: next.facemorph.me'+path,'Version: '+version,'Device: '+device,'Processing: '+(route||'not started yet'),'Report reference: '+(reference||'none')].join('\n');
 const params=new URLSearchParams({template:'next-facemorph.yml',labels:'next.facemorph.me',title:'[next] ',version,device,route:route||'not started yet',reference:reference||'none',
  body:'**What happened?**\n\n\n**What did you expect?**\n\n\n---\n'+summary});
 return ISSUE_REPO+'?'+params.toString();
}
