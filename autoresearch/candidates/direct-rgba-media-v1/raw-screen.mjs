import {createImageEncoder,paintRgba} from './encode-client.mjs';
import {decodeReferencePng} from './control-png.mjs';
const display=document.querySelector('#display');let runtime,variant,encoder,measurement=false;
const rawManifest=await (await fetch('https://next.facemorph.me/runtime/manifest.json')).arrayBuffer();
const manifest=JSON.parse(new TextDecoder().decode(rawManifest));
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const manifestSha256=await hash(rawManifest);
function latent(i){return Float32Array.from({length:18*512},(_,k)=>Math.sin(k*.37+i*.103)*.8);}
async function start(name){
 runtime?.dispose();encoder?.dispose();variant=name;
 const {createBrowserRuntime}=await import(`/source-${name==='blob'?'control':'candidate'}/src/Next/browser/runtime.mjs`);
 encoder=createImageEncoder();runtime=createBrowserRuntime({manifest,manifestSha256,preferredRoute:'webgpu',onProgress:e=>events.push({at:performance.now(),stage:e.stage,elapsedMs:e.elapsedMs})});
 events=[];const t=performance.now();const q=await runtime.qualify('webgpu');return {qualificationMs:performance.now()-t,deviceValidated:q.deviceValidated,checks:q.checks,events};
}
let events=[];
async function single(i){
 const values=latent(i),start=performance.now(),output=await runtime.synthesize({space:'w-plus',shape:[1,18,512],values},{persist:false,raw:variant!=='blob'}),deliveryMs=performance.now()-start;
 let rgba,blob,file;
 if(output.rgba){rgba=new Uint8ClampedArray(output.rgba);paintRgba(display,{rgba});const firstDrawMs=performance.now()-start,slot=await encoder.acquire(rgba.byteLength);file=encoder.encode(slot,{rgba:rgba.slice().buffer,format:variant==='webp'?'webp':'png'});blob=(await file).blob;const fileReadyMs=performance.now()-start;return {firstDrawMs,fileReadyMs,rawSha256:measurement?undefined:await hash(rgba),imageBytes:blob.size};}
 blob=output.blob;const bitmap=await createImageBitmap(blob);display.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
 const firstDrawMs=performance.now()-start;
 if(!measurement)rgba=(await decodeReferencePng(await blob.arrayBuffer())).rgba;
 return {firstDrawMs,fileReadyMs:deliveryMs,rawSha256:measurement?undefined:await hash(rgba),imageBytes:blob.size};
}
async function frames(n=32,offset=0){
 const output=[],pending=[],start=performance.now();let firstDrawMs=null,peakReservedRawBytes=0;
 await runtime.synthesizeFrames(Array.from({length:n},(_,i)=>({space:'w-plus',shape:[1,18,512],values:latent(i+offset)})),{raw:variant!=='blob',onFrame:async(index,frame)=>{
  if(frame.rgba){
   const rgba=new Uint8ClampedArray(frame.rgba);paintRgba(display,{rgba});if(firstDrawMs===null)firstDrawMs=performance.now()-start;
   const slot=await encoder.acquire(rgba.byteLength),hashing=measurement?Promise.resolve():hash(rgba);const promise=encoder.encode(slot,{rgba:frame.rgba,format:variant==='webp'?'webp':'png'});
   peakReservedRawBytes=Math.max(peakReservedRawBytes,encoder.status().rawBytes);
   pending.push(promise.then(async image=>{output[index]={rawSha256:await hashing,imageBytes:image.blob.size};}));
  }else{
   // Existing callback is synchronous; retain its async tail as the control does.
   pending.push((async()=>{const bitmap=await createImageBitmap(frame.blob);display.getContext('2d').drawImage(bitmap,0,0);bitmap.close();if(firstDrawMs===null)firstDrawMs=performance.now()-start;const rgba=measurement?null:(await decodeReferencePng(await frame.blob.arrayBuffer())).rgba;output[index]={rawSha256:measurement?undefined:await hash(rgba),imageBytes:frame.blob.size};})());
  }
 }});
 const deliveredMs=performance.now()-start;await Promise.all(pending);
 return {n,firstDrawMs,deliveredMs,fileReadyMs:performance.now()-start,peakReservedRawBytes,outputs:output,events:events.splice(0)};
}
window.rawBench={start,single,frames,manifestSha256,setMeasurement:value=>{measurement=value===true;},info:async()=>{const a=await navigator.gpu?.requestAdapter();return {userAgent:navigator.userAgent,webdriver:navigator.webdriver,isolation:crossOriginIsolated,visibility:document.visibilityState,adapter:a?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,limits:{binding:a.limits.maxStorageBufferBindingSize}}:null};},dispose:()=>{runtime?.dispose();encoder?.dispose();}};
document.querySelector('#status').textContent='ready';
