import {paintRgba} from './image-encoder.mjs';
import {generationIdentity} from './browser/identity.mjs';
import {digest} from './browser/originals.mjs';
import {decorateImage,downloadImage,recoverImage,decorateVideo,recoverVideoProject} from './recovery-metadata.mjs';
import {createPhotoAligner} from './photo/align-photo.mjs';
import {createBrowserRuntime} from './browser/runtime.mjs';
import {admitRuntimeManifest} from './browser/runtime-manifest.mjs';
import {AdmissionRefused} from './browser/admission.mjs';
import {createLatentPath,GEOMETRY_VERSION} from './geometry/latent-path.mjs';
import {blend,FFHQ_1024_DESCRIPTOR} from 'stylegan-js';
import {engineGeometry} from 'stylegan-js/engine';
// The model's dimensions (fm-dmlz): the side, the W+ shape and the pixel bytes come from the descriptor of the
// model this app ships (FFHQ), never from literal 1024 / 18 x 512.
const GEOMETRY=engineGeometry(FFHQ_1024_DESCRIPTOR),SIDE=GEOMETRY.width,W_SHAPE=[GEOMETRY.latent.layers,GEOMETRY.latent.width];
import {checkFaceModel} from '../media/recovery-files.ts';
import {decode,encode} from '../project/bridge-result.ts';
import {saveFile,shareFile,videoWriter} from './media.mjs';
import {createExportFiles} from './export-files.mjs';
import {diagnostics,onJobEnd} from './reporting.mjs';
import * as analytics from './analytics.mjs';
import {record as recordUsage} from './usage-stats.mjs';
import {rememberLast,readLast,rememberSession,readSession} from './last-result.mjs';
onJobEnd(analytics.jobFinished);
if(typeof recordUsage==='function')analytics.setStatsSink?.(recordUsage);
// Start at load, not at the first event: a visit that does nothing is still a visit.
analytics.start();analytics.observeVitals?.();
import {labelFor,loadedBytes,createFrameCounter} from './stage-labels.mjs';
import {infillFrames} from './infill.mjs';
import {renderMorph} from 'stylegan-js';
import {frameStoreKey,frameStoreGet,frameStoreGetDisplay,frameStoreGetOne} from './morph-frames.mjs';
import {selectPhoto} from './photo-selection.mjs';
import {refusal} from './photo/refusal.mjs';
import {persistenceAction} from './storage-request.mjs';
import {routeAssets,photoAssets,measure} from './model-inventory.mjs';
import {createApprovalGenerations,resolveDiscoveredGrants} from './browser/bridge-grant.mjs';
import {previewPhoto,cropPhoto} from './photo/crop.mjs';
import {confirmCrop} from './photo/confirmed-crop.mjs';
import {getPublicCatalogue,galleryTextUrl} from './public-previews.mjs';
export {galleryTextUrl,gallerySeedUrl,publicPreview} from './public-previews.mjs';
// The U-14 slider consumes frames through window.__nextFrames.get(key); wire the real store
// here so the UI has exactly one integration point. Guarded so stripped-import test harnesses
// (which leave the identifier undefined) skip the install instead of crashing module load.
if(typeof frameStoreGet!=='undefined'&&typeof window!=='undefined'&&!window.__nextFrames)window.__nextFrames={get:typeof frameStoreGetDisplay==='function'?frameStoreGetDisplay:frameStoreGet};
const listeners=new Set();
const listener=event=>{for(const callback of listeners)callback(event);};
let runtime,manifest,runtimeIdentity,active,writer,currentJob=0,project=null,video=null;
const faces=new Map(),urls=new Map(),faceRevisions=new Map();
// The encoder choice per produced video: its saved project records the actual size, route and reason (fm-fy2.7).
const videoRoutes=new WeakMap();
const videoExportDigests=new WeakMap();
// Prepared Save/Share files, their names and the export policy (fm-eeki): one prepared file per result and format.
let exportFiles=null;const exportFilesOf=()=>exportFiles??=createExportFiles();
let morphRevision=0;
let retryMorphExport=null;
export function invalidateMorph(){morphRevision++;retryMorphExport=null;video=null;project=null;exportFiles?.drop('video');const url=urls.get('video');if(url)URL.revokeObjectURL(url);urls.delete('video');clearLiveFrames();retainSession();}
// A codec retry owns this exact completed morph. An edit or a new route/setting is a new
// generation request; an unchanged retry must never silently generate missing frames.
function sameMorphExport(request,saved){
 return saved&&saved.project===project&&saved.revision===morphRevision&&
  ['provider','kind','width','pinch','frames','fps','quality'].every(key=>request[key]===saved.request[key])&&
  JSON.stringify(request.routeSnapshot||null)===JSON.stringify(saved.request.routeSnapshot||null)&&
  request.inputs.length===saved.request.inputs.length&&request.inputs.every((item,index)=>{
   const old=saved.request.inputs[index];return item.id===old.id&&item.mode===old.mode&&item.value===old.value&&item.file===old.file&&revisionOf(item.id)===saved.revisions.get(item.id);
  });
}
// Blend view slots and its result (fm-2kse) live beside the morph faces: their changes never touch the morph or the session.
const blendOwned=id=>String(id).startsWith('blend-');
export function invalidateFace(id){
 if(!blendOwned(id))arrivalRevision++;faceRevisions.set(id,(faceRevisions.get(id)||0)+1);
 faces.delete(id);exportFiles?.drop(id);const url=urls.get(id);if(url)URL.revokeObjectURL(url);urls.delete(id);
 if(!blendOwned(id))invalidateMorph();
}
/** A blend slot seeded from a finished morph face starts as its copy: same latent, pixels and source, its own id. */
export function copyFace(from,to){
 const face=faces.get(from);if(!face||!blendOwned(to))return;
 faces.set(to,{...face,pixels:face.pixels?{...face.pixels}:face.pixels});
 if(face.blob)replaceUrl(to,face.blob);else{const old=urls.get(to);if(old)URL.revokeObjectURL(old);urls.delete(to);}
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
 // A model file the browser refused to save (fm-9kr8): the result still works, and the page says it was not kept.
 if((stage==='cache-trouble'&&['quota-exceeded','save-failed'].includes(event.cacheStatus))||stage==='cache-unavailable-detail'){if(!downloads.modelNotKept){downloads.modelNotKept=true;announceDownloads();}}
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
// The consented codec fallback's bytes are spoken too, before the first frame (fm-9kr8; operations/bridge-service.ts).
const MORPH_SPOKEN_STAGES=new Set(['morph','export','codec-loading']);
const UNIT_TERMINAL_STAGES=new Set(['synthesis-complete','model-loaded','mapping-complete',
 'encoding-complete','alignment-complete','encoder-loaded','original-cached','original-cache-hit']);
function canonicalProject(value){const decoded=decode(typeof value==='string'?value:JSON.stringify(value));if(decoded.tag!==0)throw Error('This project is invalid or uses an unsupported format.');const encoded=encode(decoded.fields[0]);if(encoded.tag!==0)throw Error('This project cannot be opened.');return JSON.parse(encoded.fields[0]);}
async function engine(){
 if(runtime)return runtime;
 const response=await fetch('/runtime/manifest.json',{cache:'no-cache',signal:active?.signal});if(!response.ok)throw Error('Model setup is unavailable. Please try again shortly.');const raw=await response.arrayBuffer();if(raw.byteLength>4*1024*1024)throw Error('Model manifest is too large.');// A refused pointer (fm-fy2.14) throws before a runtime exists, so the next attempt fetches the pointer again;
 // only an admitted manifest is ever cached with its runtime.
 manifest=admitRuntimeManifest(JSON.parse(new TextDecoder().decode(raw)));const manifestSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 runtimeIdentity=manifestSha256;diagnostics.bundle(manifestSha256);
 // The browser adapter rejects missing photo support rather than silently using a server.
 const photoAligner=manifest.photo?createPhotoAligner({manifestUrl:manifest.photo.manifestUrl,workerFactory:()=>new Worker(new URL('./photo/selection-worker.mjs',import.meta.url),{type:'module'})}):null;
 batchAligner=photoAligner;
 const alignPhoto=photoAligner?async(blob,options)=>{const prepared=await photoAligner(blob,options);if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256)throw Error('Photo processing files changed. Reload before trying again.');return prepared;}:undefined;
 runtime=createBrowserRuntime({manifest,manifestSha256,onProgress:progress,alignPhoto});return runtime;
}
function replaceUrl(key,blob){const old=urls.get(key);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(blob);urls.set(key,url);return url;}
function snapshot(message='Done — ready to save or share.',restore=false){
 return {errorMessage:'',faces:[...faces].map(([id,f])=>({id,url:urls.get(id)||'',raw:!!f.pixels,label:f.label||'Face',sourceMode:f.source?.mode||'',sourceFile:f.source?.file||null})),videoUrl:video?urls.get('video'):'',projectJson:project?JSON.stringify(project):'',message,restored:restore,inputs:restore?[...faces].map(([id])=>({id,mode:'project',value:'Project face',file:null})):[],kind:project?.morph.kind||'',width:project?.morph.width||0,pinch:!!project?.morph.pinchCenter,frames:project?.morph.framesPerSegment||16,fps:project?.morph.framesPerSecond||16};
}
let sessionView=null,sessionEpoch=0,sessionTail=Promise.resolve();
export function rememberView(options){sessionView={...options,inputs:options.inputs.map(({id})=>({id}))};retainSession();}
function retainSession(){
 if(!sessionView||typeof rememberSession!=='function')return;
 const epoch=++sessionEpoch,view=sessionView,entries=view.inputs.filter(item=>faces.has(item.id)).map(item=>({id:item.id,face:faces.get(item.id)})),savedProject=project,savedVideo=video,frameUrls=[...liveFrames];
 sessionTail=sessionTail.catch(()=>{}).then(async()=>{
  if(epoch!==sessionEpoch)return;
  const completed=await Promise.all(entries.map(async item=>{
   item.face.sessionReady??=(async()=>{const r=await readyFace(item.face);if(r.blob.type!=='image/png'||typeof downloadImage!=='function')return r;
    const encoded=await downloadImage(r);item.face.downloadReady??=Promise.resolve(encoded);
    if(encoded.type!=='image/webp')return r;const recovered=await recoverImage(encoded);return recovered?{...r,...recovered}:r;
   })();const result=await item.face.sessionReady;return {id:item.id,result:{...result,exportDigests:{...item.face.exportDigests}}};
  }));
  if(epoch!==sessionEpoch)return;
  const frames=[];let bytes=completed.reduce((n,f)=>n+f.result.blob.size,0);
  if(savedVideo&&frameUrls.length&&frameUrls.every(Boolean))for(const url of frameUrls){if(epoch!==sessionEpoch)return;const frame=await (await fetch(url)).blob();bytes+=frame.size;if(bytes>32*1024*1024){frames.length=0;break;}frames.push(frame);}
  await rememberSession({ids:view.inputs.map(item=>item.id),faces:completed,settings:view,project:savedProject,video:savedVideo,videoExportDigest:savedVideo?videoExportDigests.get(savedVideo):undefined,frames},()=>epoch===sessionEpoch);
 }).catch(error=>console.warn('Last session retention failed:',error?.name||'Error'));
 return sessionTail;
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
 // Reusing a verified endpoint must preserve the identity held by its file encoder
 // and canvas. Only an actual replacement invalidates those in-flight consumers.
 if(faces.get(id)===result)return;
 const face={...result,label};faces.set(id,face);
 if(face.blob)replaceUrl(id,face.blob);
 else {const old=urls.get(id);if(old)URL.revokeObjectURL(old);urls.delete(id);}
}
/** Await the real encoder; never publish a prepared file into a replacement face. */
export async function prepareFaceFile(id){const face=faces.get(id);if(!face)throw Error('Generate a result first.');const complete=await readyFace(face);if(faces.get(id)!==face)throw superseded();if(!urls.has(id))replaceUrl(id,complete.blob);return snapshot('Face ready to save.');}
export function drawFace(canvas,id){
 if(!canvas)return;const face=faces.get(id);if(!face)return;
 if(canvas.__faceResult===face&&canvas.dataset?.faceDrawn==='true')return;canvas.__faceResult=face;
 if(face.pixels?.rgba){paintRgba(canvas,{rgba:face.pixels.rgba});face.pixels.rgba=null;canvas.dataset.faceDrawn='true';displayMilestone('generated-visible');return;}
 void readyFace(face).then(async complete=>{
  if(faces.get(id)!==face||canvas.__faceResult!==face||!canvas.isConnected)return;
  const bitmap=await createImageBitmap(complete.blob);try{canvas.width=SIDE;canvas.height=SIDE;canvas.getContext('2d').drawImage(bitmap,0,0);canvas.dataset.faceDrawn='true';displayMilestone('generated-visible');}finally{bitmap.close();}
 }).catch(()=>{});
}

async function inputs(request,revisions){
 const service=await engine(),next=new Map();
 for(let i=0;i<request.inputs.length;i++){
  checked();const item=request.inputs[i];progress({stage:'face',face:item.id,text:`Face ${i+1} of ${request.inputs.length}`,loaded:i,total:request.inputs.length});
  let result;
  if(sameSource(faces.get(item.id),item)){result=faces.get(item.id);}
  else if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
  else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for each photo input.');await pushGrants({strict:true});result=await service.encodePhoto(item.file,{signal:active.signal,raw:true});}
  else {result=await generateNameOrSeed(service,item);}
  if(revisionOf(item.id)!==revisions.get(item.id))throw superseded();
  jobCounts.facesDone=i+1;
  next.set(item.id,faces.get(item.id)===result?result:{...result,label:item.mode==='photo'?'Photo':item.value,source:{mode:item.mode,value:item.value,file:item.file}});
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
/** Saved settings with a removed WebGL preference read as Automatic; every other value is kept as saved. */
export function migrateRoutePreference(settings){return settings&&settings.provider==='webgl'?{...settings,provider:'auto'}:settings;}
async function admission(provider,snapshot){
 const service=await engine();
 if(!['auto','cpu','webgpu'].includes(provider))throw Error('Choose a supported processing mode.');
 if(snapshot&&(snapshot.runtimeSha256!==runtimeIdentity||snapshot.modelSha256!==manifest.modelSourceSha256))throw Error('Model setup changed after this request. Reload before trying again.');
 // Legacy bridge callers have no route snapshot. An explicit snapshot, however, must never
 // silently lose its fallback policy when supplied to a runtime without that capability.
 if(snapshot&&typeof service.setFallbackScope!=='function')throw Error('This runtime cannot enforce the requested fallback policy.');
 service.setFallbackScope?.(snapshot?.fallbackScope??'cpu-once');
 service.setPreferredRoute(provider);
}
// Issue #28 and operator, 23 September: nothing downloads until the visitor asks, through the
// model toast or the download dialog in front of Generate. Load only observes: the manifest (a few
// KB), what is already cached, and storage state.
function warmUp(){
 askForPersistentStorage();
 void refreshInventory();
}
const downloads={known:false,phase:'idle',scope:'',loaded:0,total:0,routeReady:false,photoReady:false,photoAvailable:false,routeBytes:0,photoBytes:0,photoApprovalRequired:false};
const wanted=new Set(),downloadListeners=new Set();
let downloading=null,setupGeneration=0;
function announceDownloads(){const snapshot={...downloads};for(const callback of downloadListeners){try{callback(snapshot);}catch{}}}
export function subscribeDownloads(callback){downloadListeners.add(callback);callback({...downloads});return ()=>downloadListeners.delete(callback);}
// The pinned encoder descriptor names every shard with its size. It is fetched only after photo approval:
// choosing an unreadable file, cancelling its crop and recovering a saved face acquire no model bytes.
// Before discovery the decision uses its advertised allowance; a larger exact scope needs another decision.
let descriptorText=null,descriptorFor=null,descriptorReading=null;
function inspectDescriptor(manifest){
 const stream=manifest?.encoderStream;
 if(!stream?.url||!stream.sha256||descriptorFor===stream.sha256)return descriptorReading??Promise.resolve();
 descriptorFor=stream.sha256;descriptorText=null;
 descriptorReading=(async()=>{
  try{
   const response=await fetch(stream.url,{cache:'no-cache'});if(!response.ok)throw Error('The encoder description is unavailable.');
   const bytes=new Uint8Array(await response.arrayBuffer());
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
   if(bytes.byteLength!==stream.size||hash!==stream.sha256)throw Error('The encoder description does not match its pin.');
   descriptorText=new TextDecoder().decode(bytes);
  }catch(error){descriptorFor=null;console.warn('Encoder description unavailable:',error?.message||error);}
 })();
 return descriptorReading;
}
function inspectionCache(planned,cache){
 const stream=planned.manifest.encoderStream;
 if(!stream?.sha256)return cache;
 const peek=async asset=>{
  const held=await cache.peek(asset);
  return held||asset.sha256!==stream.sha256||descriptorFor!==stream.sha256||descriptorText===null?held:{text:async()=>descriptorText};
 };
 return {has:asset=>cache.has(asset),heldBytes:asset=>cache.heldBytes?cache.heldBytes(asset):cache.has(asset).then(held=>held?asset.size:0),peek};
}
async function refreshInventory(){
 try{
  const service=await engine();if(!service.plan)return;
  const planned=await service.plan();if(!planned)return;
  const {createBrowserModelCache}=await import('./Assets/model-cache.mjs');
  const cache=inspectionCache(planned,await createBrowserModelCache({readOnly:true}));
  const route=await measure(routeAssets(planned.manifest,planned.route,planned.engine),cache);
  const photoList=await photoAssets(planned.manifest,cache);
  const photo=await measure(photoList.assets,cache,photoList.extraBytes||0);
  // The video codec fallback, when this bundle carries one (fm-9kr8): asked for in a morph's Generate row only when
  // its MP4 probe needs it and these bytes are not already on the device.
  const codecParts=[planned.manifest.codec?.wasm,planned.manifest.codec?.module].filter(a=>a&&Number.isSafeInteger(a.size));
  const codec=codecParts.length===2?await measure(codecParts,cache):null;
  if(route.ready)downloads.modelNotKept=false;
  Object.assign(downloads,{known:true,routeReady:route.ready,photoReady:photo.ready,photoAvailable:planned.photoAvailable===true,
   routeBytes:Math.max(0,route.total-route.present),photoBytes:Math.max(0,photo.total-photo.present),
   ...(codec?{codecReady:codec.ready,codecBytes:Math.max(0,codec.total-codec.present)}:{})});
  announceDownloads();
 }catch(error){console.warn('Model inventory unavailable:',error?.message||error);}
}
// The current explicit decision (fm-qrfz), plus what this device already holds verified. A route-only decision
// does not renew old photo consent; another photo download needs its own decision.
let approvalGenerations;
const grantApprovals=()=>approvalGenerations??=createApprovalGenerations();
function approve(scope){grantApprovals().approve(scope);}
async function pushGrants({strict=false}={}){
 try{
  const service=await engine();if(!service.plan||!service.setGrants)return;
  for(;;){
   const planned=await service.plan();if(!planned)return;
   const {createBrowserModelCache}=await import('./Assets/model-cache.mjs');
   const cache=inspectionCache(planned,await createBrowserModelCache({readOnly:true}));
   // Freeze what was approved before learning any new shard digests or sizes. Concurrent calls share it.
   const approvals=grantApprovals();
   const snapshot=await approvals.snapshot({manifest:planned.manifest,manifestSha256:runtimeIdentity||'',route:planned.route,engine:planned.engine,cache});
   if(!approvals.current(snapshot.id))continue;
   let grants=snapshot.grants;
   if(strict&&grants.approved?.purpose==='generate-and-encode'){
    await inspectDescriptor(planned.manifest);
    // Discovery can revise the decision, but must not consume a photo's first encode attempt.
    await refreshInventory();
    if(strict&&descriptorText!==null&&descriptorFor===planned.manifest.encoderStream?.sha256)
     grants=await resolveDiscoveredGrants(grants,descriptorFor,JSON.parse(descriptorText),cache);
   }
   if(!approvals.current(snapshot.id))continue;
   service.setGrants(grants);return;
  }
 }catch(error){if(strict)throw error;console.warn('Model grants unavailable:',error?.message||error);}
}
export function downloadModels(includePhoto){
 keepModelsOnDevice();approve(includePhoto?'photo':'route');
 wanted.add('route');if(includePhoto)wanted.add('photo');
 downloads.photoApprovalRequired=false;downloads.phase='downloading';announceDownloads();
 void pumpDownloads();
}
export function cancelDownloadSetup(){
 setupGeneration++;wanted.clear();runtime?.cancelPrefetch?.();
 Object.assign(downloads,{photoApprovalRequired:false,phase:'idle'});announceDownloads();
}
// The video codec fallback is approved as part of a morph's Generate purpose (fm-9kr8), apart from the model grants:
// only the video worker spends it, and only once the person has approved its bytes in the consent.
let codecApproved=false;
export function consentToDownload(scope){keepModelsOnDevice();if(scope==='codec'){codecApproved=true;return scope;}approve(scope);void pushGrants();return scope;}
async function pumpDownloads(){
 if(downloading||active)return;
 // Keep the lock through settlement: Cancel may be followed by a new approval while an old await is pending.
 const owner={generation:setupGeneration};downloading=owner;
 const current=()=>owner.generation===setupGeneration;
 try{
 // A face made while the download was paused fetches what it needs itself, so re-measure first
 // and skip whatever is already on the device instead of announcing a 1 MB of 1 MB download.
 if(downloads.phase==='waiting')await refreshInventory();
 if(!current()||active)return;
 for(const scope of ['route','photo']){
  if(!wanted.has(scope))continue;
  if(scope==='route'?downloads.routeReady:downloads.photoReady){wanted.delete(scope);continue;}
  Object.assign(downloads,{phase:'downloading',scope,loaded:0,total:scope==='route'?downloads.routeBytes:downloads.photoBytes});announceDownloads();
  let result={started:false};const began=performance.now(),planned=downloads.total;
  let failure;
  try{
   await pushGrants({strict:scope==='photo'});
   if(current()&&wanted.has(scope)){
    const service=await engine();
    if(current()&&wanted.has(scope))result=await service.prefetch(scope,{explicit:true});
   }
  }catch(error){failure=error;}
  if(!current()||!wanted.has(scope))return;
  if(failure?.name==='GrantRefused'){
   await refreshInventory();if(!current())return;
   Object.assign(downloads,{phase:'waiting',scope:'photo',photoApprovalRequired:true});announceDownloads();return;
  }
  analytics.modelsDownloaded({scope,outcome:result.started&&result.acquired===result.assets?'completed':active?'interrupted':'failed',sizeMb:planned/1048576,durationMs:performance.now()-began});
  if(active){downloads.phase='waiting';announceDownloads();return;}
  if(!result.started||result.acquired!==result.assets){downloads.phase='failed';wanted.clear();announceDownloads();await refreshInventory();return;}
  await refreshInventory();
  if(!current())return;
  if(!(scope==='route'?downloads.routeReady:downloads.photoReady)){downloads.phase='failed';wanted.clear();announceDownloads();return;}
  wanted.delete(scope);
 }
 await refreshInventory();
 if(!current())return;
 downloads.phase=downloads.routeReady?'done':'idle';announceDownloads();
 }finally{
  if(downloading===owner){downloading=null;if(!current()&&wanted.size)void pumpDownloads();}
 }
}
export function subscribe(callback){listeners.add(callback);const report=({detail})=>callback({jobId:currentJob,stage:'diagnostics-'+detail.status,text:detail.reference||'',fraction:0});window.addEventListener('facemorph-report-status',report);diagnostics.restore();warmUp();requestAnimationFrame(()=>analytics.milestone?.('usable-ui'));return()=>{listeners.delete(callback);window.removeEventListener('facemorph-report-status',report);};}
export async function execute(request,compute){
 if(active)throw Error('Another job is still stopping.');active=new AbortController();currentJob=request.jobId;closePhotoRun('completed');diagnostics.start(request.action,request.provider);reportStorage();
 const revisions=new Map(request.inputs.map(item=>[item.id,revisionOf(item.id)]));
 const exportOnly=request.action==='morph'&&sameMorphExport(request,retryMorphExport)?retryMorphExport:null;
 analytics.setJobContext(()=>({requested_route:request.provider||'auto',faces:jobCounts.facesTotal,frames:jobCounts.framesTotal,input_kind:analytics.inputKind(request.inputs),morph_kind:request.action==='morph'?project?.morph?.kind:undefined}));
 jobCounts.facesDone=0;jobCounts.facesTotal=request.action==='face'?1:request.inputs.length;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
 analytics.jobStarted({action:request.action,provider:request.provider||'auto',warm:downloads.routeReady,target:request.target||'morph'});
 let computeService;
 try{
  computeService=await engine();computeService.setComputeAdmission?.(compute);
  // Grants follow the route admission just chose, so a job acquires only for the route it runs (fm-qrfz).
  if(!exportOnly){await admission(request.provider,request.routeSnapshot);await pushGrants();}
  // Morph is admitted on its own (fm-lt2p): faces being admitted says nothing about the video codec.
  if(request.action==='morph'&&!exportOnly){const decision=await (await engine()).admission?.('morph',request.provider);if(decision?.status==='refused')throw new AdmissionRefused(decision);}
  // Per-face generate (U-03): work only the one face asked for, so no other face emits a
  // synthesis. Cached hits stay cheap and are not treated as measurements.
  if(request.action==='face'){
   const item=(request.inputs||[]).find(candidate=>candidate.id===request.target);
   if(!item)throw Error('Choose a face to generate.');
   jobCounts.facesDone=0;jobCounts.facesTotal=1;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
   progress({stage:'face',face:item.id,text:'Generating this face…',loaded:0,total:1});
   const service=await engine();
   let result;
   if(sameSource(faces.get(item.id),item)){result=faces.get(item.id);}
   else if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
   else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for this face.');await pushGrants({strict:true});result=await service.encodePhoto(item.file,{signal:active.signal,raw:true});}
   else {if(!String(item.value??'').length)throw Error('Type a name or seed first.');result=await generateNameOrSeed(service,item);}
   checked();if(revisionOf(item.id)!==revisions.get(item.id))throw superseded();await register(item.id,result,item.mode==='photo'?'Photo':item.value);
   const current=faces.get(item.id);current.source={mode:item.mode,value:item.value,file:item.file};
   jobCounts.facesDone=1;
   if(blendOwned(item.id)){diagnostics.finish('completed');return snapshot('Face updated.');}
   // A changed face invalidates the saved morph and its video, never the other faces.
   project=null;video=null;
   if(typeof rememberLast==='function')void readyFace(current).then(complete=>{if(revisionOf(item.id)===revisions.get(item.id))return rememberLast(complete,request);}).catch(()=>{});
   if(!sessionView)rememberView(request);retainSession();diagnostics.finish('completed');return snapshot('Face updated.');
  }
  // Weighted blend (fm-in6a, compute.blend): one weighted W+ sum over each slot's verified current latent, one synthesis.
  if(request.action==='blend'){
   const latents=(request.inputs||[]).map(item=>{const face=faces.get(item.id);if(!face?.latent||!sameSource(face,item))throw Error('Generate every blended face first.');if(face.latent.space!=='w-plus')throw Error('Only W+ faces can be blended.');return {space:'w-plus',shape:[...W_SHAPE],values:face.latent.values};});
   const mixed=blend(FFHQ_1024_DESCRIPTOR,latents,request.weights||[]);if(!mixed.ok)throw Error(mixed.error.message);
   jobCounts.facesDone=0;jobCounts.facesTotal=1;
   progress({stage:'face',face:request.target,text:'Blending faces…',loaded:0,total:1});
   // The descriptor's latent is [18,512]; the runtime takes the batched W+ [1,18,512].
   const result=await (await engine()).synthesize({...mixed.value.latent,shape:[1,...W_SHAPE]},{signal:active.signal,raw:true});
   checked();if(request.inputs.some(item=>revisionOf(item.id)!==revisions.get(item.id)))throw superseded();
   await register(request.target,result,`Blend of ${latents.length} faces`);faces.get(request.target).source={mode:'project',value:'',file:null};
   jobCounts.facesDone=1;diagnostics.finish('completed');return snapshot('Blend updated.');
  }
  jobCounts.facesDone=0;jobCounts.facesTotal=request.inputs.length;jobCounts.framesDone=0;jobCounts.framesTotal=0;jobCounts.videoFramesDone=0;jobCounts.videoFramesTotal=0;
  if(!exportOnly)await inputs(request,revisions);checked();
  const renderToken=morphRevision;
  if(request.action==='morph'){
   const path=createLatentPath(project.morph);if(path.totalFrames>4096)throw Error('Choose fewer faces or frames for this export.');
   jobCounts.framesTotal=path.totalFrames;jobCounts.videoFramesTotal=path.totalFrames;
   const framesKey=exportOnly?exportOnly.framesKey:await morphFramesKey();clearLiveFrames();liveFrameKey=framesKey;liveFrames=Array(path.totalFrames).fill('');
   const stored=framesKey?await frameStoreGet(framesKey).catch(()=>null):null;analytics.operationResult?.('frame-cache',stored?'hit':'miss');
   if(exportOnly&&stored?.length!==path.totalFrames)throw Error('The saved images for this video are no longer available. Change a morph setting to generate a new morph.');
   writer=videoWriter({codec:manifest.codec,codecApproved,fps:project.morph.framesPerSecond,quality:request.quality==='full'?'full':'standard',signal:active.signal,onProgress:progress,framesKey,totalFrames:path.totalFrames});const videoChoice=await writer.initialize();
   // morph.render (fm-ioap): stylegan-js renderMorph owns the frame production, the branch choice, ordered delivery
   // and the settle status; the bridge keeps display URLs, the frame counter, progress copy and supersession.
   const counter=createFrameCounter(path.totalFrames),first=counter.start();
   if(stored&&stored.length===path.totalFrames)liveFrames=stored.map(blob=>URL.createObjectURL(blob));
   else progress({stage:'morph',text:first.text,loaded:first.done,total:path.totalFrames});
   const current=()=>renderToken===morphRevision;
   const signal={get aborted(){return active.signal.aborted||!current();},addEventListener:(...a)=>active.signal.addEventListener(...a),removeEventListener:(...a)=>active.signal.removeEventListener(...a)};
   const counted=index=>{const finished=counter.complete(index);jobCounts.framesDone=finished.done;progress({stage:'morph',text:finished.text,loaded:finished.done,total:path.totalFrames});};
   // Raw frames need OffscreenCanvas to become display images; without it the writer is offered as a blob writer.
   const morphWriter=typeof OffscreenCanvas==='function'?writer:{add:(blob,index)=>writer.add(blob,index),retain:writer.retain&&((blob,index)=>writer.retain(blob,index)),finish:()=>writer.finish(),dispose:()=>writer.dispose()};
   const blobFrame=async output=>output.rgba?output:readyFace(output);
   let exporting=false,videoBegan=now();
   const settled=await renderMorph({path,canonical:()=>infillFrames(path,project.morph),writer:morphWriter,store:framesKey?{get:frameStoreGet,getOne:frameStoreGetOne}:undefined,framesKey,signal,window:FRAME_WINDOW,branch:exportOnly?'cached-result':undefined,
    source:exportOnly?{synthesize:async()=>{throw Error('Saved images are unavailable. Export retry cannot generate images.');}}:{
     synthesize:async(latent,{raw})=>blobFrame(await runtime.synthesize(latent,{signal:active.signal,persist:false,raw})),
     synthesizeFrames:typeof runtime.synthesizeFrames==='function'?(latents,{raw,onFrame})=>runtime.synthesizeFrames(latents,{signal:active.signal,raw,onFrame:(at,output)=>blobFrame(output).then(frame=>onFrame(at,frame))}):undefined},
    endpoint:async visitId=>{const saved=faces.get(visitId);return saved?readyFace(saved):null;},
    onDisplay:(index,display)=>{if(!current())return;liveFrames[index]=URL.createObjectURL(display);listener({jobId:currentJob,stage:'frames-available',text:'',fraction:0});counted(index);},
    onProgress:({stage,done,total})=>{
     if(stage==='export'){videoBegan=now();progress({stage:'export',text:done<total?'Encoding your video…':'Finishing your video…'});exporting=done<total;return;}
     if(!exporting&&done>0)counted(done-1);}});
   writer=null;
   if(!current()||request.inputs.some(item=>revisionOf(item.id)!==revisions.get(item.id)))throw superseded();
   if(settled.status==='cancelled')throw new DOMException('Morph cancelled','AbortError');
   if(settled.status==='export-failed'&&framesKey){
    const retained=await frameStoreGet(framesKey).catch(()=>null);
    if(!current()||request.inputs.some(item=>revisionOf(item.id)!==revisions.get(item.id)))throw superseded();
    if(retained?.length===path.totalFrames){
     retryMorphExport={project,revision:morphRevision,framesKey,revisions,request:{...request,inputs:request.inputs.map(item=>({...item})),routeSnapshot:request.routeSnapshot&&{...request.routeSnapshot}}};
     throw Error(`Video export failed. Your ${path.totalFrames} images are saved. Try again to export them without generating again.`);
    }
   }
   if(settled.status!=='complete'){const message=settled.error.message;throw Error(/Your faces are saved/.test(message)?message:`${message} Your faces are saved.`);}
   const finished=settled.video;recordUnit(videoTimings,(now()-videoBegan)/path.totalFrames);analytics.stageDuration?.('export',now()-videoBegan);
   retryMorphExport=null;video=finished;if(videoChoice)videoRoutes.set(finished,videoChoice);replaceUrl('video',video);
  }
  rememberView(request);retainSession();
  diagnostics.finish('completed');return snapshot();
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});if(error?.name==='AbortError')return snapshot('Cancelled. Your completed faces are still available.');if(error.alignmentStats)analytics.operationResult?.('selection',error.alignmentStats.faceCount>1?'shown':'failed',undefined,{face_count:error.alignmentStats.faceCount===0?'zero':error.alignmentStats.faceCount===1?'one':error.alignmentStats.faceCount>1?'multiple':undefined});const choice=error.alignmentStats?.faceBoxes?.length>1&&revisionOf(request.target)===revisions.get(request.target)?await prepareFaceChoices(request.target,error.alignmentStats.faceBoxes,request.inputs.find(item=>item.id===request.target)?.file):null;return {...snapshot(''),errorMessage:choice?'':String(error?.message||'Generation failed. Your completed results are still available.'),refusal:error?.name==='AdmissionRefused'?{reasonKey:error.reasonKey,text:error.message,helpAnchor:error.helpAnchor}:undefined,photoChoices:choice,cropFace:!choice&&request.target&&request.inputs?.find(item=>item.id===request.target)?.file instanceof Blob&&error?.faceDetection===true?request.target:null};}
 finally{computeService?.setComputeAdmission?.(undefined);writer?.dispose();writer=null;active=null;if(wanted.size)void pumpDownloads();else if(!downloads.routeReady||!downloads.photoReady)void refreshInventory();}
}
export function cancel(){active?.abort();writer?.dispose();runtime?.cancel();}
const kindOf=id=>id==='video'?'video':'image';
function reported(kind,method,work){analytics.exported({kind,method,outcome:'ready'});const began=now();return Promise.resolve().then(()=>typeof work==='function'?work():work).then(result=>{const text=String(result||'');const cancelled=/cancelled/i.test(text),fallback=method==='share'&&/download|save/i.test(text);analytics.exported({kind,method,outcome:cancelled?'cancelled':'completed',durationMs:now()-began,fallback});return result;},error=>{analytics.exported({kind,method,outcome:error?.name==='AbortError'?'cancelled':'failed',durationMs:now()-began});throw error;});}
/** The file Save and Share hand over: prepared once per result and format, named from its export identity. */
/** `format` 'png' is the explicit lossless still (fm-ykfa); otherwise the policy's WebP (PNG where WebP is unavailable). */
async function exportFile(id,format){
 if(id==='video'){
  const saved=video,savedProject=project;if(!saved)throw Error('Create a morph first.');
  const morph=savedProject?.morph,endpoints=(morph?.controls||[]).map(control=>({...faces.get(control.visitId),latent:control.latent}));
  const file=await exportFilesOf().video(saved,{encode:()=>decorateVideo(saved,savedProject,videoRoutes.get(saved)),faces:endpoints,modelIdentity:runtimeIdentity,retainedDigest:videoExportDigests.get(saved),current:()=>video===saved&&project===savedProject,
   morph:morph&&{mode:morph.kind,settings:{width:morph.width,pinchCenter:morph.pinchCenter??null,framesPerSegment:morph.framesPerSegment,framesPerSecond:morph.framesPerSecond}}});
  if(video!==saved||project!==savedProject)throw superseded();if(videoExportDigests.get(saved)!==file.digest){videoExportDigests.set(saved,file.digest);await retainSession();}if(video!==saved||project!==savedProject)throw superseded();return file;
 }
 const face=faces.get(id);if(!face)throw Error('Generate a result first.');
 const seed=face.source?.mode==='seed'?face.source.value:undefined;
 // The PNG holds the face's own pixels: the synthesized RGBA while this tab still has it, else its canonical PNG
 // as made, else the lossless encode of its decoded original.
 const png=async()=>{const result=await readyFace(face),rgba=face.pixels?.rgba;
  if(rgba instanceof ArrayBuffer&&rgba.byteLength===SIDE*SIDE*4)return downloadImage(result,seed,{format:'png',rgba:rgba.slice(0)});
  return result.blob.type==='image/png'?decorateImage(result,seed):downloadImage(result,seed,{format:'png'});};
 const encode=async chosen=>{if(chosen==='png')return png();face.downloadReady??=(async()=>{const result=await readyFace(face);return (typeof downloadImage==='function'?downloadImage:decorateImage)(result,seed);})();try{return await face.downloadReady;}catch(error){face.downloadReady=null;throw error;}};
 const file=await exportFilesOf().face(id,face,{encode,format,modelIdentity:runtimeIdentity,current:()=>faces.get(id)===face});
 if(faces.get(id)!==face)throw superseded();const exportFormat=file.mime==='image/png'?'png':'webp';if(face.exportDigests?.[exportFormat]!==file.digest){face.exportDigests={...face.exportDigests,[exportFormat]:file.digest};await retainSession();}if(faces.get(id)!==face)throw superseded();return file;
}
export async function saveMedia(id,options){return reported(kindOf(id),'save',async()=>{const file=await exportFile(id,options?.format);return saveFile(file.blob,file.filename);});}
export async function shareMedia(id,options){return reported(kindOf(id),'share',async()=>{const file=await exportFile(id,options?.format);return shareFile(file.blob,file.filename);});}
// A stable result identity for UI preparation, including same-labelled photo replacements.
const exportRevisions=new WeakMap(),preparedOwners=new WeakMap();let exportSerial=0;
const exportResult=id=>id==='video'?video:faces.get(id);
export function exportResultRevision(id){const result=exportResult(id);if(!result)return 0;let revision=exportRevisions.get(result);if(revision===undefined){revision=++exportSerial;exportRevisions.set(result,revision);}return revision;}
/** Prepare before a gesture. This does not share, save, infer or authorize model acquisition. */
export async function prepareMedia(id,options){
 const result=exportResult(id);if(!result)throw Error('Make a result first.');
 const file=await exportFile(id,options?.format);if(exportResult(id)!==result)throw superseded();
 preparedOwners.set(file.blob,{id,result,digest:file.digest});return file;
}
export function renamePreparedMedia(file,name){return exportFilesOf().rename(file,name);}
/** Invoke the gesture now, with prepared bytes only. An old result cannot be handed over. */
export function handPreparedMedia(id,file,method){
 const owner=preparedOwners.get(file?.blob);if(!owner||owner.id!==id||owner.result!==exportResult(id)||owner.digest!==file.digest)throw superseded();
 if(method!=='share'&&method!=='save')throw Error('Choose Save or Share.');
 const named=renamePreparedMedia(file,file.filename);
 const work=method==='share'?shareFile(named.blob,named.filename):saveFile(named.blob,named.filename);
 return reported(kindOf(id),method,work);
}
/** Prepared-file counters (fm-ykfa): encodes into the store this session; a repeat Save adds none. */
export function exportStats(){return exportFiles?exportFiles.stats():{encodes:0,known:0,webpEncodes:true};}
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
export async function importProject(request,compute){
 const {file,jobId}=request;
 if(active)throw Error('Wait for the current job to finish.');if(!(file instanceof Blob)||file.size>16*1024*1024)throw Error('Choose a FaceMorph project smaller than 16 MB.');
 active=new AbortController();currentJob=jobId;
 closePhotoRun('completed');diagnostics.start('faces',request.provider||'auto');
 jobCounts.facesDone=0;jobCounts.facesTotal=0;jobCounts.framesDone=0;jobCounts.framesTotal=0;
 analytics.setJobContext(()=>({action:'import',requested_route:request.provider||'auto',input_kind:'project',faces:jobCounts.facesTotal,frames:0}));
 analytics.jobStarted({action:'import',provider:request.provider||'auto',warm:downloads.routeReady,target:'import'});
 analytics.exported({kind:'project',method:'open',outcome:'ready'});
 let computeService;
 try{
  const imported=canonicalProject(await file.text());createLatentPath(imported.morph);const service=await engine();computeService=service;service.setComputeAdmission?.(compute);
  jobCounts.facesTotal=imported.morph.controls.length;
  if(imported.modelSha256!==manifest.modelSourceSha256||imported.noiseSha256!==manifest.noiseSha256)throw Error('This project needs a different model bundle. Its saved file has not been changed.');
  if(imported.morph.controls.some(x=>x.latent.space!=='w-plus'))throw Error('This generation bundle requires a W+ project.');
  await admission(request.provider||'auto',request.routeSnapshot);await pushGrants();const next=new Map();
  for(const control of imported.morph.controls){checked();const result=await service.synthesize({...control.latent,shape:[1,...W_SHAPE],values:Float32Array.from(control.latent.values)},{signal:active.signal});next.set(control.visitId,{...result,label:'Project face'});}
  checked();await commit(next,imported,true);diagnostics.finish('completed');analytics.exported({kind:'project',method:'open',outcome:'completed'});return snapshot('Project opened.',true);
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});analytics.exported({kind:'project',method:'open',outcome:error?.name==='AbortError'?'cancelled':'failed'});throw error;}
 finally{computeService?.setComputeAdmission?.(undefined);active=null;if(wanted.size)void pumpDownloads();}
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
 // A saved image whose recovery data fails to parse or verify is one plain message; the parser's reason stays as the cause.
 const recovered=file?await recoverImage(file).catch(error=>{throw Error('This saved image is damaged.',{cause:error});}):null;
 if(recovered){
  const response=await fetch('/runtime/manifest.json');if(!response.ok)throw Error('Unable to verify this saved face.');const m=await response.json();
  // The generator record (schema 3) or the shipped descriptor its digests name must be this runtime's model and
  // W+ shape; a blend's identity is its recipe digest, which the reader has already checked (fm-fy2.7).
  checkFaceModel(recovered,{modelSha256:m.modelSourceSha256,noiseSha256:m.noiseSha256});
  if(recovered.generationKind!=='blend'&&recovered.generationSha256&&await digest(JSON.stringify(generationIdentity(m,recovered.generationKind)))!==recovered.generationSha256)throw Error('This saved face uses a different model.');
  if(selectionRevision!==revisionOf(request.id))return null;await register(request.id,recovered,request.name||'Saved face');
  // A picked name's published result (fm-ejwq) is that text's face: it serves Generate, Save and Morph for the
  // unchanged text, and an edit invalidates it like any other face.
  if(request.name)faces.get(request.id).source={mode:'text',value:request.name,file:null};
  analytics.operationResult?.('restore','completed');return {recovered:true,...snapshot(request.name?'Name shown from its published result.':'Saved face recovered without photo encoding.')};
 }
 warmPhotoTools();return Promise.resolve(photoStage('photo-select',()=>selectPhoto(request))).then(result=>{if(selectionRevision!==revisionOf(request.id)){if(result?.url)URL.revokeObjectURL(result.url);return null;}if(result)analytics.photoSelected({outcome:'ready'});return result;},error=>{analytics.photoSelected({outcome:'invalid'});throw error;});}
export function previewPhotoReported(file,options){return photoStage('photo-preview',()=>previewPhoto(file,options));}
// Use this crop: the result carries its frozen ConfirmedCrop, so it is encoded directly, never detected again (fm-6ib8).
export function cropPhotoReported(file,area,options){return photoStage('photo-crop',()=>confirmCrop(file,area,options));}
export function cancelPhotoRun(){closePhotoRun('cancelled');}
// The confirmed-crop encode queue (fm-fy2.8): several confirmed crops encode in click order, one e4e at a time, each
// slot with its own Cancel, Retry and Remove and tab-only pixels. face.batch renders tiles over these and never keeps
// its own slots, attempt IDs or pixel references. Results are W+ latents; slot events carry slot, attempt and batch
// revision.
export async function encodeCropBatch(files,options={}){await pushGrants({strict:true});return (await engine()).encodeConfirmedCrops(files,options);}
export async function retryCropSlots(slotIds,options={}){await pushGrants({strict:true});return (await engine()).retryCropSlots(slotIds,options);}
export async function cancelCropSlot(slotId){return (await engine()).cancelCropSlot(slotId);}
export async function removeCropSlot(slotId){return (await engine()).removeCropSlot(slotId);}
export async function disposeCropBatch(batchRevision){return (await engine()).disposeCropBatch(batchRevision);}
export async function cropSlots(){return (await engine()).cropSlots();}
export async function subscribeCropSlots(listener){return (await engine()).subscribeCropSlots(listener);}
/** Test-build hooks: a slot's pixel references, and the queue's live-encoder and derivation counts. */
export async function cropQueueProbe(slotId){const service=await engine();return {pixelRefs:slotId?service.cropPixelRefs(slotId):undefined,...service.inspectCropQueue()};}
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
const ISSUE_REPO='https://github.com/facemorph-me/facemorph.me/issues/new';
export function issueUrl(route){
 const status=diagnostics.status(),reference=status.enabled||status.once?status.reference||'':'';
 const version=sourceVersion(),device=String(globalThis.navigator?.userAgent||'').slice(0,300),path=String(globalThis.location?.pathname||'/');
 const summary=['Site: next.facemorph.me'+path,'Version: '+version,'Device: '+device,'Processing: '+(route||'not started yet'),'Report reference: '+(reference||'none')].join('\n');
 const params=new URLSearchParams({template:'bug-report.yml',labels:'next.facemorph.me',title:'[next] ',version,device,route:route||'not started yet',reference:reference||'none',
  body:'**What happened?**\n\n\n**What did you expect?**\n\n\n---\n'+summary});
 return ISSUE_REPO+'?'+params.toString();
}

const photoSources=new Map(),sourceFiles=new Map();
export function rememberSourcePhoto(id,file){const previous=photoSources.get(id);if(previous)URL.revokeObjectURL(previous);photoSources.delete(id);sourceFiles.delete(id);if(file instanceof Blob){photoSources.set(id,URL.createObjectURL(file));sourceFiles.set(id,file);}}
export function sourcePhotoUrl(id){return photoSources.get(id)||'';}
let arrivalRevision=0;
export function invalidateArrivalRestore(){arrivalRevision++;}
// One canonical resolver (fm-ejwq, folded fm-fy2.18): typed text always maps through the engine, never through the
// catalogue's separately derived latent, so a typed name is the same face as the published result the picker shows
// (that publication ran this same typed path) whatever the catalogue's availability.
async function generateNameOrSeed(service,item){return service.generate({mode:item.mode,value:item.value,signal:active.signal},{raw:true});}
export async function checkCachedFace(item){try{const service=await engine();return !!await service.peekOriginal?.(item);}catch{return false;}}
export async function restoreLastResult(){
 const revision=arrivalRevision;analytics.operationResult?.('restore','ready');let reason='missing';
 const session=typeof readSession==='function'?await readSession():null;
 const legacy=session?null:await readLast(value=>reason=value);
 const saved=session||(legacy&&{faces:[{id:'face-1',generationKind:legacy.generationKind,result:legacy.result}],ids:['face-1'],settings:legacy.settings});
 if(!saved?.faces?.length){analytics.operationResult?.('restore','miss');return null;}
 try{
  const response=await fetch('/runtime/manifest.json');if(!response.ok)return null;const current=await response.json();
  for(const face of saved.faces){const r=face.result;if(current.modelSourceSha256!==r.provenance.modelSha256||current.noiseSha256!==r.provenance.noiseSha256||await digest(JSON.stringify(generationIdentity(current,face.generationKind)))!==r.generationSha256)return null;}
 }catch{return null;}
 if(active||faces.size||revision!==arrivalRevision){analytics.operationResult?.('restore','superseded');return null;}
 let restoredProject=null;
 if(saved.project){try{const candidate=canonicalProject(saved.project);if(candidate.morph.controls.length===saved.faces.length&&candidate.morph.controls.every(control=>{const face=saved.faces.find(f=>f.id===control.visitId);return face&&control.latent.values.length===face.result.latent.values.length&&control.latent.values.every((v,i)=>Math.fround(v)===face.result.latent.values[i]);}))restoredProject=candidate;}catch{}}
 for(const face of saved.faces)await register(face.id,face.result,'Restored face');
 project=restoredProject;video=restoredProject?saved.video:null;if(video)replaceUrl('video',video);
 if(video&&saved.videoExportDigest)videoExportDigests.set(video,saved.videoExportDigest);
 if(restoredProject&&saved.frames?.length){try{if(createLatentPath(restoredProject.morph).totalFrames===saved.frames.length)liveFrames=saved.frames.map(blob=>URL.createObjectURL(blob));}catch{}}
 const ids=[...saved.ids];for(let n=1;ids.length<2;n++){const id='face-'+n;if(!ids.includes(id))ids.push(id);}
 // A saved WebGL preference (removed 17 October, fm-x6h5) becomes Automatic once, and is written back here.
 const settings=migrateRoutePreference(saved.settings);
 sessionView={...settings,inputs:ids.map(id=>({id}))};
 if(settings!==saved.settings)retainSession();
 analytics.milestone?.('restored-ready');analytics.operationResult?.('restore','completed');
 return {...snapshot('Welcome back — your faces'+(video?' and last video are':' are')+' restored on this device.'),restored:true,inputs:ids.map(id=>({id,mode:faces.has(id)?'project':'text',value:faces.has(id)?'Restored face':'',file:null})),...settings};
}

export function queueFace(id,depth){analytics.queuedRequest?.(id,depth);}
export function cancelQueuedFace(id){analytics.cancelQueued?.(id);}

// Faces first (fm-k09b, fm-zigt): the on-device detector over a photo's decoded preview, before any confirmation. The
// controller asks only once photo processing is ready on this device. Each face comes back as fractions of the photo:
// its box (for the chooser) and its aligned square (the proposal: centre, side and the angle that stands it upright).
let batchAligner=null;
export async function detectFaces(blob){
 await engine();if(!batchAligner)throw refusal('Photo processing is not available here.');
 const prepared=await batchAligner(blob,{tryAlign:true,requireSingleFace:false});
 if(prepared.provenance?.preprocessingSha256!==manifest.alignmentSha256)throw Error('Photo processing files changed. Reload before trying again.');
 const faces=Array.isArray(prepared.stats?.faces)?prepared.stats.faces:[];
 return faces.map(({x,y,width,height,align:a})=>({x,y,width,height,align:{cx:a.cx/a.width,cy:a.cy/a.height,side:a.side/a.width,rotation:a.rotation}}));
}
async function prepareFaceChoices(id,boxes,processed){const file=processed?.facemorphOriginal||processed||sourceFiles.get(id);if(!file)return null;try{const preview=await previewPhoto(file,{edge:2048});return {id,file,boxes,...preview};}catch{return null;}}
export async function chooseDetectedFace(choice,index){
 analytics.operationResult?.('selection','completed');const box=choice.boxes[index];if(!box)throw refusal('Choose a detected face.');
 const size=Math.min(box.width*choice.previewWidth,box.height*choice.previewHeight);
 return cropPhoto(choice.file,{left:box.x*choice.previewWidth,top:box.y*choice.previewHeight,width:size,height:size},{previewScale:choice.scale,rotation:0});
}

export function displayMilestone(kind){if(kind==='preview')analytics.milestone?.(kind);else analytics.visibleResult?.(kind);}
