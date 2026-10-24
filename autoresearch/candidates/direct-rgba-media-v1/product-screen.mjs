import {createBrowserRuntime} from '/src/Next/browser/runtime.mjs';
import {paintRgba,imageBufferStatus} from '/src/Next/image-encoder.mjs';
import {decodeReferencePng} from '/src/Next/browser/png.mjs';
import {downloadImage,recoverImage,decorateVideo,recoverVideoProject} from '/src/Next/recovery-metadata.mjs';
import {videoWriter} from '/src/Next/media.mjs';
const manifestBytes=await (await fetch('/runtime/manifest.json')).arrayBuffer(),manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const manifestSha256=await hash(manifestBytes),events=[];
const runtime=createBrowserRuntime({manifest,manifestSha256,preferredRoute:'webgpu',onProgress:e=>events.push({stage:e.stage,elapsedMs:e.elapsedMs,provider:e.provider})});
async function run(){
 const result={scope:'Current source runtime/media/worker integration correctness only; not compiled UI or timing-qualified',manifestSha256};
 const q=await runtime.qualify('webgpu');result.canaries=q.checks;
 const face=await runtime.generate({mode:'seed',value:'31719'},{raw:true});if(!face.pixels?.rgba)throw Error('Expected deferred raw face');
 const rgbaHash=await hash(face.pixels.rgba);paintRgba(document.querySelector('#display'),{rgba:face.pixels.rgba});face.pixels.rgba=null;
 const completed=await face.fileReady,decoded=await decodeReferencePng(await completed.blob.arrayBuffer());
 if(await hash(decoded.rgba)!==rgbaHash)throw Error('Canonical PNG differs from display');
 const hit=await runtime.generate({mode:'seed',value:'31719'},{raw:true});if(!hit.cached)throw Error('Canonical cache did not reuse deferred face');
 const file=await downloadImage(completed,31719);if(file.type!=='image/webp')throw Error('WebP download silently fell back');
 const recovered=await recoverImage(file);if(!recovered||await hash(recovered.latent.values)!==completed.latentSha256)throw Error('Download latent recovery failed');
 const image=document.querySelector('#download');image.src=URL.createObjectURL(file);await image.decode();if(image.naturalWidth!==1024)throw Error('Download decode failed');
 result.face={rawHash:rgbaHash,canonicalBytes:completed.blob.size,downloadBytes:file.size,downloadMime:file.type,latentRecovered:true,cached:true,dimensions:[image.naturalWidth,image.naturalHeight]};
 const writer=videoWriter({fps:16,framesKey:'screen-'+Date.now(),totalFrames:32});result.encoder=await writer.initialize();let peak=0;
 try{await runtime.synthesizeFrames(Array.from({length:32},(_,i)=>({space:'w-plus',shape:[1,18,512],values:Float32Array.from(completed.values,(v,k)=>v+.03*Math.sin(i*.3+k*.01))})),{raw:true,onFrame:async(index,frame)=>{await writer.addRaw(frame,index);peak=Math.max(peak,imageBufferStatus().rawBytes);}});
 const video=await writer.finish(),project={schemaVersion:1,morph:{controls:[{latent:{values:Array.from(completed.values)}}]}},saved=await decorateVideo(video,project);
 if(JSON.stringify(project)!==await recoverVideoProject(saved))throw Error('Video metadata recovery failed');
 const player=document.querySelector('#video');player.src=URL.createObjectURL(saved);player.load();await new Promise((resolve,reject)=>{player.onloadeddata=resolve;player.onerror=()=>reject(Error('Raw video not playable'));setTimeout(()=>reject(Error('Video playback timeout')),10000);});
 if(player.videoWidth!==1024||Math.abs(player.duration-2)>.01)throw Error('Raw video dimensions or duration differ');
 result.video={bytes:saved.size,dimensions:[player.videoWidth,player.videoHeight],duration:player.duration,projectRecovered:true,frames:32,queueCapBytes:imageBufferStatus().maxBytes,peakMeasuredReservedAfterAdd:peak,externalSurfaces:'not_measured'};
 }finally{writer.dispose();runtime.dispose();}
 result.events=events;result.passed=true;return result;
}
window.productScreen={run,info:async()=>{const adapter=await navigator.gpu?.requestAdapter();return {userAgent:navigator.userAgent,isolation:crossOriginIsolated,visibility:document.visibilityState,adapter:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture}:null};}};
