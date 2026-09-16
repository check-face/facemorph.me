// Media sharing never uploads private inputs or embeds project latents.
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
export function videoWriter({codec,fps=16,signal,onProgress=()=>{}}){
 const worker=new Worker(new URL('./video-worker.mjs',import.meta.url),{type:'module'});let id=0,closed=false;const pending=new Map();
 const stop=(reason=new DOMException('Video cancelled','AbortError'))=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);try{worker.terminate();}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(reason);}pending.clear();}};
 const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
 worker.onmessage=({data})=>{if(closed)return;if(data.progress){try{onProgress(data.progress);}catch{}return;}const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
 worker.onerror=()=>stop(Error('The video encoder stopped. Your faces are saved.'));
 worker.onmessageerror=()=>stop(Error('The video encoder returned an unreadable result. Your faces are saved.'));
 const call=(type,payload={},transfer=[])=>new Promise((resolve,reject)=>{if(closed||signal?.aborted){reject(new DOMException('Video cancelled','AbortError'));return;}const key=++id;const timer=setTimeout(()=>stop(Error('Video encoding timed out. Try a shorter morph.')),180000);pending.set(key,{resolve,reject,timer});try{worker.postMessage({id:key,type,...payload},transfer);}catch(error){stop(error);}});
 return {initialize:()=>call('initialize',{codec,fps}),add:async blob=>{if(closed||signal?.aborted)throw new DOMException('Video cancelled','AbortError');const rgba=await framePixels(blob);await call('frame',{rgba:rgba.buffer},[rgba.buffer]);},finish:async()=>{try{return new Blob([await call('finish')],{type:'video/mp4'});}finally{stop();}},dispose:()=>stop()};
}
