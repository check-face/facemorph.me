import {paintRgba} from './image-encoder.mjs';
import {generationIdentity} from './browser/identity.mjs';
import {digest} from './browser/originals.mjs';
import {decorateImage,downloadImage,recoverImage,decorateVideo,recoverVideoProject} from './recovery-metadata.mjs';
import {createPhotoAligner} from './photo/align-photo.mjs';
import {createDesktopRuntime} from '../../desktop/runtime.mjs';
import {createBrowserRuntime} from './browser/runtime.mjs';
import {createLatentPath,GEOMETRY_VERSION} from './geometry/latent-path.mjs';
import {decode,encode} from './ProjectJson.fs.js';
import {saveFile,shareFile,videoWriter} from './media.mjs';
import {diagnostics,onJobEnd} from './reporting.mjs';
import * as analytics from './analytics.mjs';
import {rememberLast,readLast} from './last-result.mjs';
onJobEnd(analytics.jobFinished);
// Start at load, not at the first event: a visit that does nothing is still a visit.
analytics.start();analytics.observeVitals?.();
import {labelFor,loadedBytes,createFrameCounter} from './stage-labels.mjs';
import {infillFrames} from './infill.mjs';
import {frameStoreKey,frameStoreGet,frameStoreGetOne} from './morph-frames.mjs';
import {selectPhoto} from './photo-selection.mjs';
import {persistenceAction} from './storage-request.mjs';
import {routeAssets,photoAssets,measure} from './model-inventory.mjs';
import {previewPhoto,cropPhoto} from './photo/crop.mjs';
import {getPublicCatalogue,galleryTextUrl,publicNameLatent} from './public-previews.mjs';
export {galleryTextUrl,gallerySeedUrl,publicPreview} from './public-previews.mjs';
// The U-14 slider consumes frames through window.__nextFrames.get(key); wire the real store
// here so the UI has exactly one integration point. Guarded so stripped-import test harnesses
// (which leave the identifier undefined) skip the install instead of crashing module load.
if(typeof frameStoreGet!=='undefined'&&typeof window!=='undefined'&&!window.__nextFrames)window.__nextFrames={get:frameStoreGet};
let listener=()=>{},runtime,manifest,active,writer,currentJob=0,project=null,video=null;
const faces=new Map(),urls=new Map(),faceRevisions=new Map();
let morphRevision=0;
export function invalidateMorph(){morphRevision++;video=null;const url=urls.get('video');if(url)URL.revokeObjectURL(url);urls.delete('video');clearLiveFrames();}
export function invalidateFace(id){
 arrivalRevision++;faceRevisions.set(id,(faceRevisions.get(id)||0)+1);
 faces.delete(id);const url=urls.get(id);if(url)URL.revokeObjectURL(url);urls.delete(id);
 invalidateMorph();
}
export const photoRevision=id=>faceRevisions.get(id)||0;
const revisionOf=photoRevision;
function sameSource(face,item){return face&&(item.mode==='project'||(face.source?.mode===item.mode&&face.source?.value===item.value&&face.source?.file===item.file));}
function superseded(){const error=new DOMException('Input changed. The old result was discarded.','AbortError');return error;}
let liveFrames=[],liveFrameKey=null;
function clearLiveFrames(){for(const url of liveFrames)if(url)URL.revokeObjectURL(url);liveFrames=[];liveFrameKey=null;}
function progress(event){
 let stage=event.stage||'working';
 if(stage==='route-attempt')analytics.operationStarted?.('qualification',{route:event.provider});
 if(stage==='encoding'&&jobCounts.framesDone===jobCounts.framesTotal&&jobCounts.framesTotal>1){jobCounts.videoFramesDone=Number(event.loaded)||0;stage='export';event={...event,stage,text:`Encoding ${jobCounts.videoFramesDone} / ${jobCounts.framesTotal} images`,total:jobCounts.framesTotal};}
 if(Number.isFinite(event.elapsedMs)&&/-complete$/.test(stage))analytics.stageDuration?.(stage,event.elapsedMs);
 if(stage==='fallback-cpu')analytics.operationResult?.('fallback','ready',undefined,{reason:'rejected'});
 if(stage==='original-cache-hit')analytics.operationResult?.('original-cache','hit');
 if(stage==='cache-unavailable')analytics.operationResult?.('original-cache','failed',undefined,{reason:'unavailable'});
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
 analytics.routeAttempt?.(event.provider,event.routeOutcome==='admitted'?'completed':'rejected');
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
 const bar=stage==='export'?fraction:units?units.done/units.total:(Number.isFinite(fraction)?fraction:0);
 listener({jobId:currentJob,stage,text,fraction:bar});}
// Stages that mean "this one unit finished". True, and useless mid-job: the visitor asked for
// thirty faces, so one of them completing is not a status worth replacing the count with.
// The only stages allowed to speak while a morph renders: the frame counter, and the export that
// follows it. `scripts/check-progress-copy.mjs` fails the build if anything else can reach the
// line, and `stage-labels.test.mjs` fails if these lose their text.
// Morph frames per runtime request: enough that the pause between requests is a few percent of
// the run, few enough that the PNGs a stalled writer could accumulate stay bounded.
const FRAME_WINDOW=16;
const MORPH_SPOKEN_STAGES=new Set(['morph','export']);
const UNIT_TERMINAL_STAGES=new Set(['synthesis-complete','model-loaded','mapping-complete',
 'encoding-complete','alignment-complete','encoder-loaded','original-cached','original-cache-hit']);
function canonicalProject(value){const decoded=decode(typeof value==='string'?value:JSON.stringify(value));if(decoded.tag!==0)throw Error('This project is invalid or uses an unsupported format.');const encoded=encode(decoded.fields[0]);if(encoded.tag!==0)throw Error('This project cannot be opened.');return JSON.parse(encoded.fields[0]);}
async function engine(){
 if(runtime)return runtime;
 const response=await fetch('/runtime/manifest.json',{cache:'no-cache',signal:active?.signal});if(!response.ok)throw Error('Model setup is unavailable. Please try again shortly.');const raw=await response.arrayBuffer();if(raw.byteLength>4*1024*1024)throw Error('Model manifest is too large.');manifest=JSON.parse(new TextDecoder().decode(raw));const manifestSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 diagnostics.bundle(manifestSha256);
 // The browser adapter rejects missing photo support rather than silently using a server.
 const photoAligner=manifest.photo?createPhotoAligner({manifestUrl:manifest.photo.manifestUrl,workerFactory:()=>new Worker(new URL('./photo/selection-worker.mjs',import.meta.url),{type:'module'})}):null;
 const alignPhoto=photoAligner?async(blob,options)=>{const prepared=await photoAligner(blob,options);if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256)throw Error('Photo processing files changed. Reload before trying again.');return prepared;}:undefined;
 runtime=globalThis.__TAURI__?createDesktopRuntime({onProgress:progress}):createBrowserRuntime({manifest,manifestSha256,onProgress:progress,alignPhoto});return runtime;
}
function replaceUrl(key,blob){const old=urls.get(key);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(blob);urls.set(key,url);return url;}
function snapshot(message='Done — ready to save or share.',restore=false){
 return {errorMessage:'',faces:[...faces].map(([id,f])=>({id,url:urls.get(id)||'',raw:!!f.pixels,label:f.label||'Face',sourceMode:f.source?.mode||'',sourceFile:f.source?.file||null})),videoUrl:video?urls.get('video'):'',projectJson:project?JSON.stringify(project):'',message,restored:restore,inputs:restore?[...faces].map(([id])=>({id,mode:'project',value:'Project face',file:null})):[],kind:project?.morph.kind||'',width:project?.morph.width||0,pinch:!!project?.morph.pinchCenter,frames:project?.morph.framesPerSegment||16,fps:project?.morph.framesPerSecond||16};
}
function checked(){if(active?.signal.aborted)throw new DOMException('Cancelled','AbortError');}
// What a face actually costs on this device, so the interface can estimate from measurement
// rather than from a guess. A cached face is not a measurement of work.
let lastStage;
const faceTimings=[];
const frameTimings=[];
const videoTimings=[];
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
export function measuredVideoMs(){return median(videoTimings);}
/** Progress counters for the job in flight, so the interface can say what is left. */
const jobCounts={facesDone:0,facesTotal:0,framesDone:0,framesTotal:0,videoFramesDone:0,videoFramesTotal:0};
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
 if(liveFrames.length)return [...liveFrames];
 try{
  const store=globalThis.__nextFrames,key=await morphFramesKey();
  if(!store||typeof store.get!=='function'||!key)return null;
  const frames=await store.get(key);
  if(!Array.isArray(frames)||frames.length===0)return null;
  return frames.map(frame=>URL.createObjectURL(frame instanceof Blob?frame:new Blob([frame],{type:'image/png'})));
 }catch{return null;}
}
function completeFace(result){return !!result?.latent&&((result.blob instanceof Blob&&['image/png','image/webp'].includes(result.blob.type))||(result.pixels&&(result.pixels.rgba===null||result.pixels.rgba instanceof ArrayBuffer)&&typeof result.fileReady?.then==='function'));}
async function readyFace(face){return face.fileReady?{...face,...await face.fileReady}:face;}
async function register(id,result,label){
 if(!completeFace(result))throw Error('The generation engine returned an incomplete face.');
 const face={...result,label};faces.set(id,face);
 if(face.blob)replaceUrl(id,face.blob);
 else {const old=urls.get(id);if(old)URL.revokeObjectURL(old);urls.delete(id);}
}
export function drawFace(canvas,id){
 if(!canvas)return;const face=faces.get(id);if(!face)return;
 if(canvas.__faceResult===face&&canvas.dataset?.faceDrawn==='true')return;canvas.__faceResult=face;
 if(face.pixels?.rgba){paintRgba(canvas,{rgba:face.pixels.rgba});face.pixels.rgba=null;canvas.dataset.faceDrawn='true';displayMilestone('generated-visible');return;}
 void readyFace(face).then(async complete=>{
  if(faces.get(id)!==face||canvas.__faceResult!==face||!canvas.isConnected)return;
  const bitmap=await createImageBitmap(complete.blob);try{canvas.width=1024;canvas.height=1024;canvas.getContext('2d').drawImage(bitmap,0,0);canvas.dataset.faceDrawn='true';displayMilestone('generated-visible');}finally{bitmap.close();}
 }).catch(()=>{});
}

async function inputs(request,revisions){
 const service=await engine(),next=new Map();
 for(let i=0;i<request.inputs.length;i++){
  checked();const item=request.inputs[i];progress({stage:'face',face:item.id,text:`Face ${i+1} of ${request.inputs.length}`,loaded:i,total:request.inputs.length});
  let result;
  if(sameSource(faces.get(item.id),item)){result=faces.get(item.id);}
  else if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
  else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for each photo input.');result=await service.encodePhoto(item.file,{signal:active.signal,raw:!globalThis.__TAURI__});}
  else {result=await generateNameOrSeed(service,item);}
  if(revisionOf(item.id)!==revisions.get(item.id))throw superseded();
  jobCounts.facesDone=i+1;
  next.set(item.id,{...result,label:item.mode==='photo'?'Photo':item.value,source:{mode:item.mode,value:item.value,file:item.file}});
 }
 const provenance=next.get(request.inputs[0].id).provenance;
 if(typeof rememberLast==='function'&&next.size){const lastId=[...next.keys()].at(-1),last=next.get(lastId),revision=revisions.get(lastId);void readyFace(last).then(complete=>{if(revisionOf(lastId)===revision)return rememberLast(complete,request);}).catch(()=>{});}
 const nextProject=canonicalProject({schemaVersion:1,bundle:{version:provenance.bundleVersion,manifestSha256:provenance.manifestSha256},modelSha256:provenance.modelSha256,noiseSha256:provenance.noiseSha256,truncationPsi:1,truncationCutoff:0,morph:{algorithmVersion:GEOMETRY_VERSION,kind:request.kind,closed:true,width:request.width,pinchCenter:request.pinch,framesPerSegment:request.frames,framesPerSecond:request.fps,controls:request.inputs.map(item=>({visitId:item.id,latent:{...next.get(item.id).latent,values:Array.from(next.get(item.id).latent.values)}}))}});
 checked();await commit(next,nextProject);
}
async function commit(next,nextProject,replace=false){
 for(const result of next.values())if(!completeFace(result))throw Error('The generation engine returned an incomplete face.');
 invalidateMorph();
 if(replace)for(const id of [...faces.keys()])if(!next.has(id)){invalidateFace(id);rememberSourcePhoto(id,null);}
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
  const service=await engine();if(!service.plan)return;
  const planned=await service.plan();if(!planned)return;
  const {createBrowserModelCache}=await import('./Assets/model-cache.mjs');
  const cache=await createBrowserModelCache({readOnly:true});
  const route=await measure(routeAssets(planned.manifest,planned.route,planned.engine),cache);
  const photoList=await photoAssets(planned.manifest,cache);
  const photo=await measure(photoList.assets,cache,photoList.extraBytes||0);
  Object.assign(downloads,{known:true,routeReady:route.ready,photoReady:photo.ready,photoAvailable:planned.photoAvailable===true,
   routeBytes:Math.max(0,route.total-route.present),photoBytes:Math.max(0,photo.total-photo.present)});
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
 // A face made while the download was paused fetches what it needs itself, so re-measure first
 // and skip whatever is already on the device instead of announcing a 1 MB of 1 MB download.
 if(downloads.phase==='waiting')await refreshInventory();
 if(downloading||active)return;
 for(const scope of ['route','photo']){
  if(!wanted.has(scope))continue;
  if(scope==='route'?downloads.routeReady:downloads.photoReady){wanted.delete(scope);continue;}
  downloading=scope;Object.assign(downloads,{phase:'downloading',scope,loaded:0,total:scope==='route'?downloads.routeBytes:downloads.photoBytes});announceDownloads();
  let result={started:false};const began=performance.now(),planned=downloads.total;
  try{result=await (await engine()).prefetch(scope,{explicit:true});}catch{}
  downloading=null;
  analytics.modelsDownloaded({scope,outcome:result.started&&result.acquired===result.assets?'completed':active?'interrupted':'failed',sizeMb:planned/1048576,durationMs:performance.now()-began});
  if(active){downloads.phase='waiting';announceDownloads();return;}
  if(!result.started||result.acquired!==result.assets){downloads.phase='failed';wanted.clear();announceDownloads();await refreshInventory();return;}
  wanted.delete(scope);
 }
 await refreshInventory();
 downloads.phase=downloads.routeReady?'done':'idle';announceDownloads();
}
export function subscribe(callback){listener=callback;window.addEventListener('facemorph-report-status',({detail})=>callback({jobId:currentJob,stage:'diagnostics-'+detail.status,text:detail.reference||'',fraction:0}));diagnostics.restore();warmUp();requestAnimationFrame(()=>analytics.milestone?.('usable-ui'));}
export async function execute(request){
 if(active)throw Error('Another job is still stopping.');active=new AbortController();currentJob=request.jobId;closePhotoRun('completed');diagnostics.start(request.action,request.provider);reportStorage();
 const revisions=new Map(request.inputs.map(item=>[item.id,revisionOf(item.id)]));
 analytics.setJobContext(()=>({requested_route:request.provider||'auto',faces:jobCounts.facesTotal,frames:jobCounts.framesTotal,input_kind:analytics.inputKind(request.inputs),morph_kind:request.action==='morph'?project?.morph?.kind:undefined}));
 jobCounts.facesDone=0;jobCounts.facesTotal=request.action==='face'?1:request.inputs.length;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
 analytics.jobStarted({action:request.action,provider:request.provider||'auto',warm:downloads.routeReady,target:request.target||'morph'});
 try{
  await admission(request.provider);
  // Per-face generate (U-03): work only the one face asked for, so no other face emits a
  // synthesis. Cached hits stay cheap and are not treated as measurements.
  if(request.action==='face'){
   const item=(request.inputs||[]).find(candidate=>candidate.id===request.target);
   if(!item)throw Error('Choose a face to generate.');
   jobCounts.facesDone=0;jobCounts.facesTotal=1;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
   progress({stage:'face',face:item.id,text:'Generating this face…',loaded:0,total:1});
   const service=await engine();
   let result;
   if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
   else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for this face.');result=await service.encodePhoto(item.file,{signal:active.signal,raw:!globalThis.__TAURI__});}
   else {if(!String(item.value??'').length)throw Error('Type a name or seed first.');result=await generateNameOrSeed(service,item);}
   checked();if(revisionOf(item.id)!==revisions.get(item.id))throw superseded();await register(item.id,result,item.mode==='photo'?'Photo':item.value);
   const current=faces.get(item.id);current.source={mode:item.mode,value:item.value,file:item.file};
   // A changed face invalidates the saved morph and its video, never the other faces.
   project=null;video=null;
   jobCounts.facesDone=1;if(typeof rememberLast==='function')void rememberLast(result,request);
   diagnostics.finish('completed');return snapshot('Face updated.');
  }
  jobCounts.facesDone=0;jobCounts.facesTotal=request.inputs.length;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
  await inputs(request,revisions);checked();
  const renderToken=morphRevision;
  if(request.action==='morph'){
   const path=createLatentPath(project.morph);if(path.totalFrames>4096)throw Error('Choose fewer faces or frames for this export.');
   jobCounts.framesTotal=path.totalFrames;jobCounts.videoFramesTotal=path.totalFrames;
   const framesKey=await morphFramesKey();clearLiveFrames();liveFrameKey=framesKey;liveFrames=Array(path.totalFrames).fill('');
   const stored=framesKey?await frameStoreGet(framesKey).catch(()=>null):null;analytics.operationResult?.('frame-cache',stored?'hit':'miss');
   writer=videoWriter({codec:manifest.codec,fps:project.morph.framesPerSecond,signal:active.signal,onProgress:progress,framesKey,totalFrames:path.totalFrames});await writer.initialize();
   const counter=createFrameCounter(path.totalFrames);let directEncoded=false;
   if(stored&&stored.length===path.totalFrames){
    liveFrames=stored.map(blob=>URL.createObjectURL(blob));
    for(const frame of path.frames()){checked();await writer.add(stored[frame.index],frame.index);jobCounts.framesDone=frame.index+1;}
   }else if(writer.addRaw&&runtime.synthesizeFrames&&typeof OffscreenCanvas==='function'&&!globalThis.__TAURI__){
    // Sparse anchors land first; all remaining frames stream in presentation order.
    // Waiting for an ordered frame while producing a full sparse window would deadlock.
    directEncoded=true;
    const first=counter.start();progress({stage:'morph',text:first.text,loaded:first.done,total:path.totalFrames});
    const anchors=new Set();
    const publish=async(index,display)=>{checked();if(renderToken!==morphRevision)throw superseded();liveFrames[index]=URL.createObjectURL(display);listener({jobId:currentJob,stage:'frames-available',text:'',fraction:0});const finished=counter.complete(index);jobCounts.framesDone=finished.done;progress({stage:'morph',text:finished.text,loaded:finished.done,total:path.totalFrames});};
    // Two endpoints plus two midpoints for a usual two-face morph; bounded independently of duration.
    for(const frame of infillFrames(path,project.morph)){
     if(anchors.size>=4)break;checked();
     const saved=frame.visitId?faces.get(frame.visitId):null;
     const output=saved?await readyFace(saved):await runtime.synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)},{signal:active.signal,persist:false,raw:true});
     const display=output.rgba?await writer.retainRaw(output,frame.index):await writer.retain(output.blob,frame.index);
     anchors.add(frame.index);await publish(frame.index,display);
    }
    const iterator=path.frames()[Symbol.iterator]();
    for(let window=[];;window=[]){
     for(let item;window.length<FRAME_WINDOW&&!(item=iterator.next()).done;)window.push(item.value);
     if(!window.length)break;checked();const ready=new Map();
     for(const frame of window)if(anchors.has(frame.index)){const blob=await frameStoreGetOne(framesKey,frame.index);if(!blob)throw Error('A preview frame is unavailable.');ready.set(frame.index,{blob});}
     const todo=window.filter(frame=>!anchors.has(frame.index));let cursor=0,chain=Promise.resolve();
     const drain=async()=>{for(;cursor<window.length;cursor++){checked();if(renderToken!==morphRevision)throw superseded();const frame=window[cursor],output=ready.get(frame.index);if(!output)return;ready.delete(frame.index);if(output.rgba){const display=await writer.addRaw(output,frame.index);await publish(frame.index,display);}else await writer.add(output.blob,frame.index);}};
     if(todo.length)await runtime.synthesizeFrames(todo.map(frame=>({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)})),{signal:active.signal,raw:true,onFrame:(at,output)=>{ready.set(todo[at].index,output);chain=chain.then(drain);return chain;}});
     await (chain=chain.then(drain));if(cursor<window.length)throw Error('Some morph frames were not produced. Your faces are saved.');
    }
   }else{
    const first=counter.start();progress({stage:'morph',text:first.text,loaded:first.done,total:path.totalFrames});
    const add=async(blob,index)=>{
     checked();if(renderToken!==morphRevision)throw superseded();
     if(writer.retain){const display=await writer.retain(blob,index);liveFrames[index]=URL.createObjectURL(display);listener({jobId:currentJob,stage:'frames-available',text:'',fraction:0});}
     else await writer.add(blob,index);
     const finished=counter.complete(index);jobCounts.framesDone=finished.done;
     progress({stage:'morph',text:finished.text,loaded:finished.done,total:path.totalFrames});
    };
    // The frame's own cost is reported by the runtime as synthesis-complete and recorded in
    // progress(); timing the call here would fold acquisition and storage into a per-frame figure.
    if(typeof runtime.synthesizeFrames==='function'){
     // Windows of frames go to the runtime as one request, so the worker can keep the GPU busy
     // while it encodes the previous frame; each frame still reaches the writer in order, the
     // saved endpoint faces in their places. A window bounds the latents in flight and the PNGs
     // that could queue here if the writer fell behind.
     const iterator=(writer.retain?infillFrames(path,project.morph):path.frames())[Symbol.iterator]();
     for(let window=[];;window=[]){
      for(let item;window.length<FRAME_WINDOW&&!(item=iterator.next()).done;)window.push(item.value);
      if(!window.length)break;
      checked();
      const todo=window.filter(frame=>!(frame.visitId&&faces.get(frame.visitId))),ready=new Map();let cursor=0,chain=Promise.resolve();
      const drain=async()=>{for(;cursor<window.length;cursor++){checked();const frame=window[cursor],output=(frame.visitId&&faces.get(frame.visitId))||ready.get(frame.index);if(!output)return;ready.delete(frame.index);await add((await readyFace(output)).blob,frame.index);}};
      if(todo.length)await runtime.synthesizeFrames(todo.map(frame=>({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)})),{signal:active.signal,onFrame:(at,output)=>{ready.set(todo[at].index,output);chain=chain.then(drain);chain.catch(()=>{});}});
      await (chain=chain.then(drain));
      if(cursor<window.length)throw Error('Some morph frames were not produced. Your faces are saved.');
     }
    }else for(const frame of (writer.retain?infillFrames(path,project.morph):path.frames())){
     checked();
     const saved=frame.visitId?faces.get(frame.visitId):null;
     const output=saved||await runtime.synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)},{signal:active.signal,persist:false});
     await add((await readyFace(output)).blob,frame.index);
    }}
   const videoBegan=now();
   if(writer.retain&&!stored&&!directEncoded){
    progress({stage:'export',text:'Encoding your video…'});
    for(let index=0;index<path.totalFrames;index++){checked();const blob=await frameStoreGetOne(framesKey,index);if(!blob)throw Error('A morph frame is unavailable. Your faces are saved.');await writer.add(blob,index);}
   }
   progress({stage:'export',text:'Finishing your video…'});const finished=await writer.finish();recordUnit(videoTimings,(now()-videoBegan)/path.totalFrames);analytics.stageDuration?.('export',now()-videoBegan);writer=null;if(renderToken!==morphRevision||request.inputs.some(item=>revisionOf(item.id)!==revisions.get(item.id)))throw superseded();video=finished;replaceUrl('video',video);
  }
  diagnostics.finish('completed');return snapshot();
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});if(error?.name==='AbortError')return snapshot('Cancelled. Your completed faces are still available.');if(error.alignmentStats)analytics.operationResult?.('selection',error.alignmentStats.faceCount>1?'shown':'failed',undefined,{face_count:error.alignmentStats.faceCount===0?'zero':error.alignmentStats.faceCount===1?'one':error.alignmentStats.faceCount>1?'multiple':undefined});const choice=error.alignmentStats?.faceBoxes?.length>1&&revisionOf(request.target)===revisions.get(request.target)?await prepareFaceChoices(request.target,error.alignmentStats.faceBoxes,request.inputs.find(item=>item.id===request.target)?.file):null;return {...snapshot(''),errorMessage:choice?'':String(error?.message||'Generation failed. Your completed results are still available.'),photoChoices:choice,cropFace:!choice&&request.target&&sourceFiles.has(request.target)&&/No face was found|More than one face was found/.test(error.message)?request.target:null};}
 finally{writer?.dispose();writer=null;active=null;if(wanted.size)void pumpDownloads();else if(!downloads.routeReady||!downloads.photoReady)void refreshInventory();}
}
export function cancel(){active?.abort();writer?.dispose();runtime?.cancel();}
const kindOf=id=>id==='video'?'video':'image';
function reported(kind,method,work){analytics.exported({kind,method,outcome:'ready'});const began=now();return Promise.resolve().then(()=>typeof work==='function'?work():work).then(result=>{const text=String(result||'');const cancelled=/cancelled/i.test(text),fallback=method==='share'&&/download|save/i.test(text);analytics.exported({kind,method,outcome:cancelled?'cancelled':'completed',durationMs:now()-began,fallback});return result;},error=>{analytics.exported({kind,method,outcome:error?.name==='AbortError'?'cancelled':'failed',durationMs:now()-began});throw error;});}
async function exportBlob(id){if(id==='video')return decorateVideo(video,project);const face=faces.get(id);if(!face)throw Error('Generate a result first.');face.downloadReady??=(async()=>{const result=await readyFace(face);return (typeof downloadImage==='function'?downloadImage:decorateImage)(result,face.source?.mode==='seed'?face.source.value:undefined);})();try{return await face.downloadReady;}catch(error){face.downloadReady=null;throw error;}}
export async function saveMedia(id){return reported(kindOf(id),'save',async()=>{const blob=await exportBlob(id);return saveFile(blob,id==='video'?'facemorph.mp4':blob.type==='image/webp'?'facemorph.webp':'facemorph.png');});}
export async function shareMedia(id){return reported(kindOf(id),'share',async()=>{const blob=await exportBlob(id);if(!blob)throw Error('Generate a result first.');return shareFile(blob,id==='video'?'facemorph.mp4':blob.type==='image/webp'?'facemorph.webp':'facemorph.png');});}
export async function exportProject(options){
 if(!project)throw Error('Generate or open a project first.');
 let selected=project;
 if(options){
  if(!Array.isArray(options.inputs)||options.inputs.some(input=>{const face=faces.get(input.id);return !face||(input.mode!=='project'&&(!face.source||face.source.mode!==input.mode||face.source.value!==input.value||face.source.file!==input.file));}))throw Error('Generate the changed faces before saving this project.');
  selected={...project,morph:{...project.morph,kind:options.kind,width:options.width,pinchCenter:options.pinch,framesPerSegment:options.frames,framesPerSecond:options.fps,controls:options.inputs.map(input=>({visitId:input.id,latent:{...faces.get(input.id).latent,values:Array.from(faces.get(input.id).latent.values)}}))}};
 }
 const checked=canonicalProject(selected);createLatentPath(checked.morph);
 return reported('project','save',saveFile(new Blob([JSON.stringify(checked)],{type:'application/json'}),'facemorph-project.json'));
}
export async function importProject(request){
 const {file,jobId}=request;
 if(active)throw Error('Wait for the current job to finish.');if(!(file instanceof Blob)||file.size>16*1024*1024)throw Error('Choose a FaceMorph project smaller than 16 MB.');
 active=new AbortController();currentJob=jobId;
 closePhotoRun('completed');diagnostics.start('faces',request.provider||'auto');
 jobCounts.facesDone=0;jobCounts.facesTotal=0;jobCounts.framesDone=0;jobCounts.framesTotal=0;
 analytics.setJobContext(()=>({action:'import',requested_route:request.provider||'auto',input_kind:'project',faces:jobCounts.facesTotal,frames:0}));
 analytics.jobStarted({action:'import',provider:request.provider||'auto',warm:downloads.routeReady,target:'import'});
 analytics.exported({kind:'project',method:'open',outcome:'ready'});
 try{
  const imported=canonicalProject(await file.text());createLatentPath(imported.morph);const service=await engine();
  jobCounts.facesTotal=imported.morph.controls.length;
  if(imported.modelSha256!==manifest.modelSourceSha256||imported.noiseSha256!==manifest.noiseSha256)throw Error('This project needs a different model bundle. Its saved file has not been changed.');
  if(imported.morph.controls.some(x=>x.latent.space!=='w-plus'))throw Error('This generation bundle requires a W+ project.');
  await admission(request.provider||'auto');const next=new Map();
  for(const control of imported.morph.controls){checked();const result=await service.synthesize({...control.latent,shape:[1,18,512],values:Float32Array.from(control.latent.values)},{signal:active.signal});next.set(control.visitId,{...result,label:'Project face'});}
  checked();await commit(next,imported,true);diagnostics.finish('completed');analytics.exported({kind:'project',method:'open',outcome:'completed'});return snapshot('Project opened.',true);
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});analytics.exported({kind:'project',method:'open',outcome:error?.name==='AbortError'?'cancelled':'failed'});throw error;}
 finally{active=null;if(wanted.size)void pumpDownloads();}
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
 if(active){diagnostics.stage(name,{});return run();}
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
   usageMb:Number.isFinite(status.usage)?Math.round(status.usage/1048576):undefined,
   quotaMb:Number.isFinite(status.quota)?Math.round(status.quota/1048576):undefined};
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
export async function selectPhotoReported(request){
 const selectionRevision=revisionOf(request.id);
 const file=request.files?.[0];if(file)analytics.operationResult?.('selection','ready',undefined,{size_band:file.size<1024*1024?'small':file.size<8*1024*1024?'medium':'large'});
 const projectText=file?await recoverVideoProject(file):null;if(selectionRevision!==revisionOf(request.id))return null;if(projectText)return {projectFile:new Blob([projectText],{type:'application/json'})};
 const recovered=file?await recoverImage(file):null;
 if(recovered){
  const response=await fetch('/runtime/manifest.json');if(!response.ok)throw Error('Unable to verify this saved face.');const m=await response.json();
  if(m.modelSourceSha256!==recovered.provenance.modelSha256||m.noiseSha256!==recovered.provenance.noiseSha256||(recovered.generationSha256&&await digest(JSON.stringify(generationIdentity(m,recovered.generationKind)))!==recovered.generationSha256))throw Error('This saved face uses a different model.');
  if(selectionRevision!==revisionOf(request.id))return null;await register(request.id,recovered,'Saved face');analytics.operationResult?.('restore','completed');return {recovered:true,...snapshot('Saved face recovered without photo encoding.')};
 }
 warmPhotoTools();return Promise.resolve(photoStage('photo-select',()=>selectPhoto(request))).then(result=>{if(selectionRevision!==revisionOf(request.id)){if(result?.url)URL.revokeObjectURL(result.url);return null;}if(result)analytics.photoSelected({outcome:'ready'});return result;},error=>{analytics.photoSelected({outcome:'invalid'});throw error;});}
export function previewPhotoReported(file,options){return photoStage('photo-preview',()=>previewPhoto(file,options));}
export function cropPhotoReported(file,area,options){return photoStage('photo-crop',()=>cropPhoto(file,area,options));}
export function cancelPhotoRun(){closePhotoRun('cancelled');}
// Published gallery assets are addressed by the same identity the product already computes:
// a text face by the SHA-256 of its exact lowercase request, a numeric seed by the seed. The
// catalogue carries identities rather than 8,966 URLs, so these rules derive the rest.
// These are historic lossy previews. They are never canonical originals and must never be
// written into the device originals cache.
let gallery=null;
export async function loadNames(){
 const data=await getPublicCatalogue();
 const origin=String(data.origin||'');
 if(origin&&new URL(origin).protocol!=='https:')throw Error('Invalid name gallery origin.');
 gallery={origin,seeds:data.seeds||null};
 analytics.namesUsed({outcome:'ready'});
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

const photoSources=new Map(),sourceFiles=new Map();
export function rememberSourcePhoto(id,file){const previous=photoSources.get(id);if(previous)URL.revokeObjectURL(previous);photoSources.delete(id);sourceFiles.delete(id);if(file instanceof Blob){photoSources.set(id,URL.createObjectURL(file));sourceFiles.set(id,file);}}
export function sourcePhotoUrl(id){return photoSources.get(id)||'';}
let arrivalRevision=0;
export function invalidateArrivalRestore(){arrivalRevision++;}
async function namedLatent(item){
 if(item.mode!=='text'||globalThis.__TAURI__||typeof publicNameLatent!=='function')return null;
 try{return await publicNameLatent(item.value,manifest,{signal:active?.signal});}catch(error){checked();return null;}
}
async function generateNameOrSeed(service,item){const latent=await namedLatent(item);return latent?service.synthesize(latent,{signal:active.signal,raw:!globalThis.__TAURI__}):service.generate({mode:item.mode,value:item.value,signal:active.signal},{raw:!globalThis.__TAURI__});}
export async function checkCachedFace(item){try{const service=await engine();if(await service.peekOriginal?.(item))return true;const latent=await namedLatent(item);return !!(latent&&await service.peekOriginal?.({mode:'latent',latent}));}catch{return false;}}
export async function restoreLastResult(){
 const revision=arrivalRevision;analytics.operationResult?.('restore','ready');let reason='missing';
 const saved=await readLast(value=>reason=value);if(!saved){analytics.operationResult?.('restore',reason==='missing'?'miss':'failed',undefined,{reason});return null;}
 // Check the currently pinned model identity without initializing inference.
 try{const response=await fetch('/runtime/manifest.json');if(!response.ok)return null;const current=await response.json();if(current.modelSourceSha256!==saved.result.provenance.modelSha256||current.noiseSha256!==saved.result.provenance.noiseSha256||await digest(JSON.stringify(generationIdentity(current,saved.generationKind)))!==saved.generationSha256){analytics.operationResult?.('restore','failed',undefined,{reason:'incompatible'});return null;}}catch{analytics.operationResult?.('restore','failed',undefined,{reason:'unavailable'});return null;}
 if(active||faces.size||revision!==arrivalRevision){analytics.operationResult?.('restore','superseded');return null;}
 await register('face-1',saved.result,'Saved face');analytics.milestone?.('restored-ready');analytics.operationResult?.('restore','completed');
 return {...snapshot('Welcome back — your last generated face is saved on this device.'),restored:true,inputs:[{id:'face-1',mode:'project',value:'Saved face',file:null}],...saved.settings};
}

export function queueFace(id,depth){analytics.queuedRequest?.(id,depth);}
export function cancelQueuedFace(id){analytics.cancelQueued?.(id);}

async function prepareFaceChoices(id,boxes,processed){const file=processed?.facemorphOriginal||processed||sourceFiles.get(id);if(!file)return null;try{const preview=await previewPhoto(file,{edge:2048});return {id,file,boxes,...preview};}catch{return null;}}
export async function chooseDetectedFace(choice,index){
 analytics.operationResult?.('selection','completed');const box=choice.boxes[index];if(!box)throw Error('Choose a detected face.');
 const size=Math.min(box.width*choice.previewWidth,box.height*choice.previewHeight);
 return cropPhoto(choice.file,{left:box.x*choice.previewWidth,top:box.y*choice.previewHeight,width:size,height:size},{previewScale:choice.scale,rotation:0});
}

export function displayMilestone(kind){if(kind==='preview')analytics.milestone?.(kind);else analytics.visibleResult?.(kind);}
