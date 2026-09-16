import {createPhotoAligner} from './photo/align-photo.mjs';
import {createDesktopRuntime} from '../../desktop/runtime.mjs';
import {createBrowserRuntime} from './browser/runtime.mjs';
import {createLatentPath,GEOMETRY_VERSION} from './geometry/latent-path.mjs';
import {decode,encode} from './ProjectJson.fs.js';
import {saveFile,shareFile,videoWriter} from './media.mjs';
import {diagnostics} from './reporting.mjs';
let listener=()=>{},runtime,manifest,active,writer,currentJob=0,project=null,video=null;
const faces=new Map(),urls=new Map();
const labels={'asset-acquisition':'Downloading model files…','runtime-loading':'Starting the local engine…','model-loading':'Loading the model…','mapping-loading':'Loading face mapping…','canary':'Checking this device…','mapping':'Preparing your face…','synthesis':'Generating…','alignment':'Finding and aligning the face…','encoder-correctness-check':'Checking photo processing on this device…','encoder-correctness-complete':'Photo processing checked.','encoder-loading':'Loading the photo encoder…','encoding':'Encoding your photo…','original-cache-hit':'Loaded saved original','original-cached':'Original saved on this device','codec-loading':'Preparing video export…','cache-unavailable':'Generated successfully; device storage is unavailable.'};
function progress(event){const stage=event.stage||'working',fraction=event.total?event.loaded/event.total:0;
 // The admitted route is carried as the text so the interface can say when this device is on the
 // slow path; it is a route name, not a status line.
 const text=stage==='route-admitted'?String(event.provider||''):(event.text||labels[stage]||'Working…');
 listener({jobId:currentJob,stage,text,fraction:Number.isFinite(fraction)?fraction:0});diagnostics.stage(stage,event);}
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
const faceTimings=[];
const now=()=>globalThis.performance?.now?.()??Date.now();
function recordFace(ms){if(Number.isFinite(ms)&&ms>0){faceTimings.push(ms);if(faceTimings.length>8)faceTimings.shift();}}
/** Median measured face time in milliseconds, or null until this device has produced one. */
export function measuredFaceMs(){
 if(!faceTimings.length)return null;
 const sorted=[...faceTimings].sort((a,b)=>a-b);
 return sorted[Math.floor(sorted.length/2)];
}
/** Frames the current settings would render, from the same geometry the morph uses. */
export function plannedFrames(options){
 try{
  const controls=options.inputs.map(input=>{const face=faces.get(input.id);return face&&{visitId:input.id,latent:{...face.latent,values:face.latent.values}};});
  if(controls.some(control=>!control)||controls.length<2)return null;
  return createLatentPath({kind:options.kind,width:options.width,pinchCenter:options.pinch,framesPerSegment:options.frames,framesPerSecond:options.fps,controls}).totalFrames;
 }catch{return null;}
}
async function register(id,result,label){if(!(result.blob instanceof Blob)||result.blob.type!=='image/png'||!result.latent)throw Error('The generation engine returned an incomplete face.');faces.set(id,{...result,label});replaceUrl(id,result.blob);}
async function inputs(request){
 const service=await engine(),next=new Map();
 for(let i=0;i<request.inputs.length;i++){
  checked();const item=request.inputs[i];progress({stage:'face',text:`Face ${i+1} of ${request.inputs.length}`,loaded:i,total:request.inputs.length});
  let result;
  if(item.mode==='project'){result=faces.get(item.id);if(!result)throw Error('Open the saved project again to restore this face.');}
  else if(item.mode==='photo'){if(!(item.file instanceof Blob))throw Error('Choose a photo for each photo input.');result=await service.encodePhoto(item.file,{signal:active.signal});}
  else {const began=now();result=await service.generate({mode:item.mode,value:item.value,signal:active.signal});if(!result.cached)recordFace(now()-began);}
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
  await inputs(request);checked();
  if(request.action==='morph'){
   const path=createLatentPath(project.morph);if(path.totalFrames>4096)throw Error('Choose fewer faces or frames for this export.');
   writer=videoWriter({codec:manifest.codec,fps:project.morph.framesPerSecond,signal:active.signal,onProgress:progress});await writer.initialize();
   for(const frame of path.frames()){
    checked();progress({stage:'morph',text:`Generating frame ${frame.index+1} of ${path.totalFrames}`,loaded:frame.index,total:path.totalFrames});
    const saved=frame.visitId?faces.get(frame.visitId):null;
    const output=saved||await runtime.synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array.from(frame.values)},{signal:active.signal,persist:false});
    await writer.add(output.blob);
   }
   progress({stage:'export',text:'Finishing your video…'});video=await writer.finish();writer=null;replaceUrl('video',video);
  }
  diagnostics.finish('completed');return snapshot();
 }catch(error){diagnostics.finish(error?.name==='AbortError'?'cancelled':'failed',error);if(error?.name==='AbortError')return snapshot('Cancelled. Your completed faces are still available.');return {...snapshot(''),errorMessage:String(error?.message||'Generation failed. Your completed results are still available.')};}
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
export async function loadNames(){
 const response=await fetch('/catalogue.json');if(!response.ok)throw Error('The name gallery is unavailable. You can still enter any name.');
 const data=await response.json();if(!Array.isArray(data.names)||data.names.length>10000)throw Error('Invalid name gallery.');
 return data.names.map(x=>({name:String(x.name),value:String(x.value),image:String(x.image)}));
}
