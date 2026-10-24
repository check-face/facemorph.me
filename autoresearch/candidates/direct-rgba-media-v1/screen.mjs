import {createImageEncoder,paintRgba} from './encode-client.mjs';
import {recoverEnvelope} from './recovery.mjs';
const display=document.querySelector('#display'),download=document.querySelector('#download'),video=document.querySelector('#video');
const manifest=await (await fetch('/runtime/manifest.json')).json().catch(()=>null);
const now=()=>performance.now(),pause=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
let fixture,encodedUrl,videoUrl;
const values=Float32Array.from({length:18*512},(_,i)=>Math.sin(i*.013));
const record={latent:{space:'w-plus',shape:[18,512],values},generationKind:'latent',generationSha256:'a'.repeat(64),provenance:{modelSha256:'b'.repeat(64),noiseSha256:'c'.repeat(64),route:'webgpu'}};
async function load(path){
 const blob=await (await fetch(path)).blob(),bitmap=await createImageBitmap(blob);
 if(bitmap.width!==1024||bitmap.height!==1024){bitmap.close();throw Error('Screen fixture must be full1024.');}
 const surface=new OffscreenCanvas(1024,1024),ctx=surface.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
 fixture=ctx.getImageData(0,0,1024,1024).data;
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
 return {path,sha256:sha,bytes:blob.size,mime:blob.type,scope:'decoded fixed synthetic/public image for codec screening; no model execution'};
}
async function imageCase(mode,format){
 const encoder=createImageEncoder(),slot=await encoder.acquire(fixture.byteLength),start=now();let displayMs;
 try{
  // Foreground display owns the input while the worker owns one reserved copy.
  const file=encoder.encode(slot,{rgba:fixture.slice().buffer,format,quality:.8,recovery:{result:record}});
  if(mode==='direct'){paintRgba(display,{rgba:fixture});await pause();displayMs=now()-start;}
  const output=await file,fileReadyMs=now()-start;
  if(mode==='blob'){const bitmap=await createImageBitmap(output.blob);display.width=bitmap.width;display.height=bitmap.height;display.getContext('2d').drawImage(bitmap,0,0);bitmap.close();await pause();displayMs=now()-start;}
  const recovered=await recoverEnvelope(output.blob);if(!recovered||recovered.latent.values[211]!==values[211])throw Error('Recovery failed.');
  if(encodedUrl)URL.revokeObjectURL(encodedUrl);encodedUrl=URL.createObjectURL(output.blob);download.src=encodedUrl;await download.decode();
  if(download.naturalWidth!==1024||download.naturalHeight!==1024)throw Error('Decorated image did not decode full1024.');
  return {mode,format,workerLifecycle:'new image worker per sample; startup included; persistent-worker throughput not measured',displayDrawAndRafMs:displayMs,fileReadyMs,...Object.fromEntries(['imageBytes','metadataBytes','encodeMs','totalMs'].map(k=>[k,output[k]])),totalBytes:output.blob.size,returnedMime:output.format,decoded:true,recovered:true,encoderStatus:encoder.status()};
 }finally{encoder.dispose();}
}
function writer(mode){
 const worker=new Worker(new URL(mode==='quality'?'./control-video-worker.mjs':'./realtime-video-worker.mjs',import.meta.url),{type:'module'});
 const jobs=new Map();let seq=0;worker.onmessage=({data})=>{if(data.progress)return;const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error)):job.resolve(data.result);};
 worker.onerror=e=>{for(const job of jobs.values())job.reject(Error(e.message));};
 return {call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('Writer timed out')),30000);jobs.set(id,{resolve,reject,timer});worker.postMessage({id,type,...payload},transfer);});},close(){worker.terminate();for(const job of jobs.values())clearTimeout(job.timer);}};
}
async function videoCase(mode,input,frames=32){
 const pipe=writer(mode),width=1024,fps=16;const config={codec:'avc1.42002A',width,height:width,bitrate:4194000,framerate:fps,avc:{format:'avc'}};
 if(!globalThis.VideoEncoder||!(await VideoEncoder.isConfigSupported(config)).supported){pipe.close();return {mode,input,skipped:'WebCodecs H264 full1024 unsupported'};}
 const start=now();try{
  await pipe.call('initialize',{mode:'webcodecs',...config,fps});const initializedMs=now()-start;
  const encoder=createImageEncoder();let processingMs=0;
  try{
   for(let i=0;i<frames;i++){
    const began=now();let pixels;
    if(input==='png'){
     const slot=await encoder.acquire(fixture.byteLength);const output=await encoder.encode(slot,{rgba:fixture.slice().buffer,format:'png'});
     const bitmap=await createImageBitmap(output.blob),surface=new OffscreenCanvas(width,width),ctx=surface.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();pixels=ctx.getImageData(0,0,width,width).data.buffer;
    }else pixels=fixture.slice().buffer;
    processingMs+=now()-began;
    await pipe.call('frame',{rgba:pixels,width,height:width},[pixels]);
   }
  }finally{encoder.dispose();}
  const flushAt=now(),bytes=await pipe.call('finish'),finishMs=now()-start,flushMuxMs=now()-flushAt;
  if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));video.src=videoUrl;video.load();
  await new Promise((resolve,reject)=>{if(video.readyState>=2)return resolve();video.onloadeddata=resolve;video.onerror=()=>reject(Error('Video decode failed'));setTimeout(()=>reject(Error('Playback readiness timed out')),10000);});
  if(video.videoWidth!==width||Math.abs(video.duration-frames/fps)>.01)throw Error('Video dimensions/duration mismatch.');
  return {mode,input,frames,config,initializedMs,processingMs,flushMuxMs,finishMs,decodedPlayableMs:now()-start,bytes:bytes.byteLength,decodedWidth:video.videoWidth,decodedHeight:video.videoHeight,duration:video.duration};
 }finally{pipe.close();}
}
window.screenBench={load,imageCase,videoCase,manifest,info:()=>({userAgent:navigator.userAgent,isolation:crossOriginIsolated,visibility:document.visibilityState,webdriver:navigator.webdriver})};
document.querySelector('#status').textContent='ready';
