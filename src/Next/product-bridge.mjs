import {createPhotoAligner} from './photo/align-photo.mjs';
import {createDesktopRuntime} from '../../desktop/runtime.mjs';
import {createBrowserRuntime} from './browser/runtime.mjs';
import {createLatentPath,GEOMETRY_VERSION} from './geometry/latent-path.mjs';
import {decode,encode} from './ProjectJson.fs.js';
import {saveFile,shareFile,videoWriter} from './media.mjs';
import {diagnostics} from './reporting.mjs';
import {labelFor,loadedBytes} from './stage-labels.mjs';
import {frameStoreKey,frameStoreGet} from './morph-frames.mjs';
// The U-14 slider consumes frames through window.__nextFrames.get(key); wire the real store
// here so the UI has exactly one integration point. Guarded so stripped-import test harnesses
// (which leave the identifier undefined) skip the install instead of crashing module load.
if(typeof frameStoreGet!=='undefined'&&typeof window!=='undefined'&&!window.__nextFrames)window.__nextFrames={get:frameStoreGet};
let listener=()=>{},runtime,manifest,active,writer,currentJob=0,project=null,video=null;
const faces=new Map(),urls=new Map();
function progress(event){
 const stage=event.stage||'working';lastStage=stage;
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
 listener({jobId:currentJob,stage,text,fraction:Number.isFinite(fraction)?fraction:0});}
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
  else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for each photo input.');const began=now();result=await service.encodePhoto(item.file,{signal:active.signal});recordFace(now()-began);}
  else {const began=now();result=await service.generate({mode:item.mode,value:item.value,signal:active.signal});if(!result.cached)recordFace(now()-began);}
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
export function subscribe(callback){listener=callback;window.addEventListener('facemorph-report-status',({detail})=>callback({jobId:currentJob,stage:'diagnostics-'+detail.status,text:detail.reference||'',fraction:0}));diagnostics.restore();}
export async function execute(request){
 if(active)throw Error('Another job is still stopping.');active=new AbortController();currentJob=request.jobId;diagnostics.start(request.action,request.provider);
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
   else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for this face.');const began=now();result=await service.encodePhoto(item.file,{signal:active.signal});recordFace(now()-began);}
   else {if(!String(item.value??'').length)throw Error('Type a name or seed first.');const began=now();result=await service.generate({mode:item.mode,value:item.value,signal:active.signal});if(!result.cached)recordFace(now()-began);}
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
   writer=videoWriter({codec:manifest.codec,fps:project.morph.framesPerSecond,signal:active.signal,onProgress:progress});await writer.initialize();
   for(const frame of path.frames()){
    checked();progress({stage:'morph',text:`Generating frame ${frame.index+1} of ${path.totalFrames}`,loaded:frame.index,total:path.totalFrames});
    const saved=frame.visitId?faces.get(frame.visitId):null;
    const began=now();
    const output=saved||await runtime.synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)},{signal:active.signal,persist:false});
    if(!saved)recordFrame(now()-began);
    await writer.add(output.blob);jobCounts.framesDone=frame.index+1;
   }
   progress({stage:'export',text:'Finishing your video…'});video=await writer.finish();writer=null;replaceUrl('video',video);
  }
  diagnostics.finish('completed');return snapshot();
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error,{stage:lastStage});if(error?.name==='AbortError')return snapshot('Cancelled. Your completed faces are still available.');return {...snapshot(''),errorMessage:String(error?.message||'Generation failed. Your completed results are still available.')};}
 finally{writer?.dispose();writer=null;active=null;}
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
export function setDebug(enabled){diagnostics.enable(enabled);}
/** How much of this session is staged on the device, ready to send if the tester agrees. */
export function stagedReportCount(){return diagnostics.status().staged||0;}
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
