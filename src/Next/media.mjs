// Media sharing never uploads private inputs or embeds project latents.
//
// C-06: morph frames are no longer thrown away. `videoWriter` persists every frame it is
// given into the morph-frame store (`./morph-frames.mjs`) — the synthesis blob itself is the
// canonical 1024 PNG and is stored byte-identical, plus a display-size derivative for the
// slider — and the video encoder consumes raw RGBA decoded once from that same blob. No PNG
// is ever re-encoded here and no originals-store lookup happens on the morph path.
//
// C-11: the encoder is chosen from a measured device budget. `probeVideoEncoder` checks
// WebCodecs once per bundle (including one small correctness encode — the check runs once per
// session, not per photo) and returns the chosen path and resolution; `VideoEncoder` is used
// wherever `isConfigSupported()` passes and ffmpeg-core.wasm is never downloaded on those
// browsers. ffmpeg with the libx264 baseline args remains the fallback. Encoding is
// pipelined: `add()` hands the frame to the worker and returns, so frame N encodes while
// frame N+1 synthesizes; the encode surfaces as its own 'encoding' stage in diagnostics.
import { frameStorePut, frameKey } from './morph-frames.mjs';

export async function saveFile(blob,name){
 if(!(blob instanceof Blob))throw Error('No completed file is available.');
 if(globalThis.__TAURI__){const kind=blob.type==='video/mp4'?'video':blob.type==='application/json'?'project':'image';const result=await globalThis.__TAURI__.core.invoke('native_save_media',await blob.arrayBuffer(),{headers:{'x-facemorph-kind':kind}});return result.saved?'File saved.':'Save cancelled. Your file is still ready.';}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return 'Your file is ready to save.';
}
export async function shareFile(blob,name){
 const file=new File([blob],name,{type:blob.type});
 if(!navigator.share||!navigator.canShare?.({files:[file]}))return saveFile(blob,name);
 try{await navigator.share({files:[file]});return 'File handed to your sharing app.';}
 catch(error){if(error.name==='AbortError')return 'Sharing cancelled. Your file is still ready.';return saveFile(blob,name);}
}
export async function framePixels(blob,size=512){
 let bitmap,objectUrl;
 if(typeof createImageBitmap==='function')bitmap=await createImageBitmap(blob);
 else {objectUrl=URL.createObjectURL(blob);try{bitmap=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Image decoding is unavailable.'));img.src=objectUrl;});}catch(error){URL.revokeObjectURL(objectUrl);throw error;}}
 try{
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(size,size):Object.assign(document.createElement('canvas'),{width:size,height:size});
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Image resizing is unavailable.');
  context.drawImage(bitmap,0,0,size,size);return context.getImageData(0,0,size,size).data;
 }finally{bitmap.close?.();if(objectUrl)URL.revokeObjectURL(objectUrl);}
}
// One decode, two outputs: the raw RGBA the encoder consumes at the measured resolution and
// the display-size derivative the slider scrubs. Called with the same blob synthesis produced,
// so the canonical PNG persisted by `videoWriter` is the original bytes, not a re-encode.
async function frameDerivatives(blob,{encodeSize=512,derivativeSize=0}={}){
 let bitmap,objectUrl;
 if(typeof createImageBitmap==='function')bitmap=await createImageBitmap(blob);
 else {objectUrl=URL.createObjectURL(blob);try{bitmap=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Image decoding is unavailable.'));img.src=objectUrl;});}catch(error){URL.revokeObjectURL(objectUrl);throw error;}}
 const make=size=>{const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(size,size):Object.assign(document.createElement('canvas'),{width:size,height:size});
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Image resizing is unavailable.');
  context.drawImage(bitmap,0,0,size,size);return {canvas,context};};
 try{
  const encode=make(encodeSize),rgba=encode.context.getImageData(0,0,encodeSize,encodeSize).data;
  let derivative=null;
  if(derivativeSize>0){
   const target=derivativeSize===encodeSize?encode:make(derivativeSize);
   derivative=await (target.canvas.convertToBlob?target.canvas.convertToBlob({type:'image/jpeg',quality:.85}):new Promise(resolve=>target.canvas.toBlob(resolve,'image/jpeg',.85)));
  }
  return {rgba,width:encodeSize,height:encodeSize,derivative};
 }finally{bitmap.close?.();if(objectUrl)URL.revokeObjectURL(objectUrl);}
}

let encoderProbe=null,correctnessChecks=0;
async function encoderCorrectnessCheck(codec,fps){
 correctnessChecks++;
 const Canvas=typeof OffscreenCanvas==='function'?OffscreenCanvas:null;
 const surface=Canvas?new Canvas(64,64):null;
 const context=surface?.getContext?.('2d');
 if(!surface||!context||typeof globalThis.VideoFrame!=='function')return false;
 context.fillRect?.(0,0,64,64);
 let chunks=0,failure=null;
 const encoder=new globalThis.VideoEncoder({output:()=>{chunks++;},error:error=>{failure=error;}});
 try{
  encoder.configure({codec,width:64,height:64,bitrate:200000,framerate:fps,avc:{format:'avc'}});
  const frame=new globalThis.VideoFrame(surface,{timestamp:0,duration:1e6/Math.max(1,fps)});
  encoder.encode(frame,{keyFrame:true});frame.close();
  await Promise.race([encoder.flush(),new Promise((_,reject)=>setTimeout(()=>reject(Error('The video encoder check timed out.')),5000))]);
 }catch{chunks=0;}finally{try{encoder.close();}catch{}}
 if(failure)throw failure;
 return chunks>0;
}
/**
 * One measured encoder decision per bundle: WebCodecs `VideoEncoder` wherever
 * `isConfigSupported()` passes (verified by one small correctness encode), at the preferred
 * resolution — 512 only when the device says no — and the ffmpeg fallback otherwise. The
 * result is cached for the session keyed by bundle, so a second photo or morph performs no
 * further encoder-correctness-check. The chosen resolution is recorded in the result; callers
 * must pass it on to diagnostics rather than lowering it themselves.
 */
export async function probeVideoEncoder({width=1024,fallbackWidth=512,fps=16,bundle=''}={}){
 if(encoderProbe&&encoderProbe.bundle===bundle)return encoderProbe.result;
 const VideoEncoder=globalThis.VideoEncoder;
 let result;
 if(!VideoEncoder?.isConfigSupported)result={kind:'ffmpeg',width:fallbackWidth,height:fallbackWidth,reason:'webcodecs-unavailable'};
 else{
  result={kind:'ffmpeg',width:fallbackWidth,height:fallbackWidth,reason:'webcodecs-unsupported'};
  for(const size of [width,fallbackWidth]){
   const config={codec:'avc1.42002A',width:size,height:size,bitrate:Math.round(size*size*fps*.25/1000)*1000,framerate:fps};
   try{
    if(!(await VideoEncoder.isConfigSupported(config)).supported)continue;
    if(await encoderCorrectnessCheck(config.codec,fps)){result={kind:'webcodecs',...config,correctnessChecks};break;}
   }catch{}
  }
 }
 encoderProbe={bundle,result};
 return result;
}
/** Test seam: forget the per-session encoder decision. */
export function resetEncoderProbe(){encoderProbe=null;correctnessChecks=0;}

export function videoWriter({codec,encoder,fps=16,framesKey,totalFrames,derivativeSize=512,signal,onProgress=()=>{}}){
 const worker=new Worker(new URL('./video-worker.mjs',import.meta.url),{type:'module'});let id=0,closed=false,mode='',encodeSize=0,nextIndex=0,submitted=0,encoded=0;const pending=new Map(),persisting=[],drainWaiters=[];
 const stop=(reason=new DOMException('Video cancelled','AbortError'))=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);try{worker.terminate();}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(reason);}pending.clear();for(const w of drainWaiters.splice(0))w();}};
 const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
 worker.onmessage=({data})=>{if(closed)return;if(data.progress){if(data.progress.stage==='encoding')encoded=data.progress.loaded;if(submitted-encoded<=4)for(const w of drainWaiters.splice(0))w();try{onProgress({...data.progress,total:submitted||undefined});}catch{}return;}const p=pending.get(data.id);if(!p){if(data.error)stop(Error(data.error));return;}clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
 worker.onerror=()=>stop(Error('The video encoder stopped. Your faces are saved.'));
 worker.onmessageerror=()=>stop(Error('The video encoder returned an unreadable result. Your faces are saved.'));
 const call=(type,payload={},transfer=[])=>new Promise((resolve,reject)=>{if(closed||signal?.aborted){reject(new DOMException('Video cancelled','AbortError'));return;}const key=++id;const timer=setTimeout(()=>stop(Error('Video encoding timed out. Try a shorter morph.')),180000);pending.set(key,{resolve,reject,timer});try{worker.postMessage({id:key,type,...payload},transfer);}catch(error){stop(error);}});
 // Pipelining backpressure: frames are handed to the worker without awaiting their encode;
 // only when the worker falls too far behind does the frame loop yield until it drains.
 const drained=()=>new Promise(resolve=>{if(closed||submitted-encoded<=4)resolve();else drainWaiters.push(resolve);});
 return {
  initialize:async()=>{
   // Without WebCodecs the probe answer needs no await, so the initialize call is registered
   // synchronously and a worker failure still rejects the very call the caller awaits.
   let choice=encoder;
   if(!choice){const probe=globalThis.VideoEncoder?.isConfigSupported?probeVideoEncoder({fps}):null;
    choice=probe?await probe:{kind:'ffmpeg',width:512,height:512,reason:'webcodecs-unavailable'};}
   mode=choice.kind;encodeSize=choice.width;
   if(mode==='webcodecs')await call('initialize',{mode,codec:choice.codec,width:choice.width,height:choice.height,fps,bitrate:choice.bitrate});
   else await call('initialize',{mode:'ffmpeg',codec,fps,width:choice.width,height:choice.height});
   return choice;
  },
  add:async(blob,index)=>{
   if(closed||signal?.aborted)throw new DOMException('Video cancelled','AbortError');
   const frameIndex=Number.isInteger(index)?index:nextIndex++;
   if(Number.isInteger(index))nextIndex=Math.max(nextIndex,index+1);
   const prepared=await frameDerivatives(blob,{encodeSize,derivativeSize:framesKey?derivativeSize:0});
   if(framesKey&&prepared.derivative){
    // The canonical frame is `blob` itself, stored byte-identical; never re-encoded.
    persisting.push(frameStorePut(frameKey(framesKey,frameIndex),blob,prepared.derivative,totalFrames));
   }
   submitted++;
   await call('frame',{rgba:prepared.rgba.buffer,width:prepared.width,height:prepared.height},[prepared.rgba.buffer]);
   if(mode==='webcodecs'&&submitted-encoded>8)await drained();
  },
  finish:async()=>{
   try{
    await Promise.allSettled(persisting.splice(0)); // persistence lands before the result does
    return new Blob([await call('finish')],{type:'video/mp4'});
   }finally{stop();}
  },
  dispose:()=>stop()
 };
}
