import {Sha256}from'../Assets/sha256.mjs';
import {inspectImage}from'./image-header.mjs';
import {FAST_NATIVE}from'./native/identity.mjs';
import {createBrowserModelCache}from'../Assets/model-cache.mjs';
import {bridgeGrant,BRIDGE_OWNER}from'../browser/bridge-grant.mjs';
// The app's fast build of the same detector/predictor/warp (photo-native/build.py, fm-3xjm): identical landmarks and
// prepared bytes (native/native.test.mjs), used when this browser validates it (SIMD and wasm exceptions); otherwise
// the pinned manifest build runs as before.
const FAST_GLUE_URL=new URL('./native/photo-native.mjs',import.meta.url).href,FAST_WASM_URL=new URL('./native/photo-native.wasm',import.meta.url).href;
let running=false;
const LANDMARK_HASH='fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f';
const hex=bytes=>{const hash=new Sha256();hash.update(bytes);return hash.hex();};
// SHA-256 by the browser's native digest where available (the 100 MB landmark model took ~1 s in JS on a desktop and
// several on a phone, on every alignment); the JS hash remains the fallback.
async function digestHex(bytes){if(globalThis.crypto?.subtle)try{const d=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));let out='';for(const b of d)out+=b.toString(16).padStart(2,'0');return out;}catch{}return hex(bytes);}
function descriptor(value,base,max){if(!value||!Number.isSafeInteger(value.size)||value.size<1||value.size>max||!/^[0-9a-f]{64}$/.test(value.sha256))throw Error('Invalid photo asset descriptor.');const url=new URL(value.url,base);if(url.origin!==self.location.origin)throw Error('Photo model/runtime assets must use this site origin.');return{...value,url:url.href};}
async function checkedSmall(a){const r=await fetch(a.url,{credentials:'omit'});if(!r.ok)throw Error(`Photo runtime download failed (${r.status}).`);const length=Number(r.headers.get('content-length'));if(length&&length>a.size)throw Error('Photo runtime exceeds pinned size.');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==a.size||await digestHex(bytes)!==a.sha256)throw Error('Photo runtime integrity check failed.');return bytes;}
function readError(m,result){if(result<0)throw Error(m.UTF8ToString(m._cf_error())||'Native alignment failed.');return result;}
// One copy of the landmark model (fm-3xjm): photo setup saves it in the app's model cache under the person's approval,
// so the detector reads that copy. The grant transfers nothing: a model still downloading for photo setup is waited for
// (the manager holds a per-asset lock), and only a model the cache does not hold falls back to the detector's own file.
async function managedModel(a,stats){
 try{const cache=await createBrowserModelCache({timeoutMs:180000,maxConcurrent:1});
  const handle=await cache.acquire(a,{grant:{...bridgeGrant(a,{purpose:'generate-and-encode'}),remainingBytes:0},owner:BRIDGE_OWNER});
  const response=await handle.open();stats.modelCache='model-cache';return response;
 }catch(error){stats.modelCacheMiss=String(error?.name||error?.message||error);return null;}
}
async function modelToHeap(m,a,progress,stats){
 let root,handle,writer,reader,downloaded=false,pointer=0,success=false;
 const filename=`landmarks-${a.sha256}.dat`;
 const chunks=a.chunks;
 if(chunks!==undefined&&(!Array.isArray(chunks)||!chunks.length||chunks.length>16||chunks.reduce((n,p)=>n+p.size,0)!==a.size))throw Error('Invalid landmark chunk schedule.');
 const parts=chunks?.map(p=>descriptor(p,a.url,16*1024*1024));
 try{
  let cachedResponse=await managedModel(a,stats);
  // The detector's own copy from before is a second 100 MB of storage once the shared copy exists.
  if(cachedResponse)try{await (await navigator.storage.getDirectory()).removeEntry(filename);}catch{}
  else try{root=await navigator.storage.getDirectory();handle=await root.getFileHandle(filename);const file=await handle.getFile();if(file.size===a.size){cachedResponse=new Response(file.stream());stats.modelCache='opfs-hit';}}
  catch{}
  if(!cachedResponse){downloaded=true;stats.modelCache='http-or-network';
   try{root||=await navigator.storage.getDirectory();handle=await root.getFileHandle(filename,{create:true});writer=await handle.createSyncAccessHandle();writer.truncate(0);stats.modelCache='opfs-write';}catch{writer?.close();writer=null;}
  }
  pointer=m._malloc(a.size);if(!pointer)throw Error('Not enough bounded WASM memory for landmarks.');
  let offset=0,last=0;const partChecks=[];
  const schedule=cachedResponse?[a]:(parts||[a]);stats.chunkedModelTransport=!cachedResponse&&Boolean(parts);stats.modelChunkCount=schedule.length;
  for(const part of schedule){
   const response=cachedResponse||await fetch(part.url,{credentials:'omit'});if(!response.ok)throw Error(`Landmark download failed (${response.status}).`);
   const length=Number(response.headers.get('content-length'));if(length&&length>part.size)throw Error('Landmark response exceeds pinned size.');
   let byob=false;try{reader=response.body?.getReader({mode:'byob'});byob=Boolean(reader);}catch{reader=response.body?.getReader();}if(!reader)throw Error('A streaming landmark response is required.');stats.modelReader=byob?'byob-1MiB':'default-stream';
   let partOffset=0;const partStart=offset,partHashed=Boolean(parts&&!cachedResponse);
   while(true){const item=await (byob?reader.read(new Uint8Array(1024*1024)):reader.read());if(item.done)break;const chunk=item.value;if(partOffset+chunk.length>part.size||offset+chunk.length>a.size)throw Error('Landmark stream exceeds pinned size.');
    m.HEAPU8.set(chunk,pointer+offset);if(writer)writer.write(chunk,{at:offset});offset+=chunk.length;partOffset+=chunk.length;stats.maxModelChunkBytes=Math.max(stats.maxModelChunkBytes||0,chunk.length);
    if(offset-last>=4*1024*1024||offset===a.size){progress('alignment-model-download',{completed:offset,total:a.size});last=offset;}
   }
   if(partOffset!==part.size)throw Error('Landmark chunk integrity check failed.');
   // The digest copies the chunk now and runs while the next chunk downloads.
   if(partHashed){const check=digestHex(m.HEAPU8.subarray(pointer+partStart,pointer+offset)).then(digest=>{if(digest!==part.sha256)throw Error('Landmark chunk integrity check failed.');});check.catch(()=>{});partChecks.push(check);}
   // This private reader is deliberately not releaseLock'ed (WebKit GC deadlock).
   reader=null;
  }
  await Promise.all(partChecks);
  if(offset!==a.size||await digestHex(m.HEAPU8.subarray(pointer,pointer+a.size))!==a.sha256)throw Error('Landmark integrity check failed.');writer?.flush();writer?.close();writer=null;success=true;return pointer;
 }catch(error){try{Promise.resolve(reader?.cancel(error)).catch(()=>{});}catch{}throw error;}
 finally{
  try{writer?.close();}catch{}
  if(!success){if(pointer)m._free(pointer);if(root&&handle)try{await root.removeEntry(filename);}catch{}}
  stats.modelBytesRead=a.size;stats.downloadAttempted=downloaded;
 }
}
self.onmessage=async({data})=>{
 if(running||data?.type!=='align'){postMessage({type:'error',message:'Invalid or concurrent alignment request.'});return;}running=true;
 const stats={provider:'dlib20.0.1-pillow12.3.0-wasm-unshared',stages:[],maxWasmBytes:268435456,wasmCapacityBytes:0,ortImported:false,privateDataUploaded:false,orientationPolicy:'legacy-ignore-exif'};
 let m,pointer=0,moduleObjectUrl;
 const progress=(stage,extra={})=>{if(m){stats.wasmCapacityBytes=m.HEAPU8.buffer.byteLength;stats.sharedMemory=typeof SharedArrayBuffer!=='undefined'&&m.HEAPU8.buffer instanceof SharedArrayBuffer;}postMessage({type:'progress',stage,...extra,stats});};
 const stage=async(name,fn)=>{progress(name);const t=performance.now();try{return await fn();}finally{stats.stages.push({name,ms:performance.now()-t});progress(name+'-complete');}};
 try{
  const manifest=await stage('alignment-manifest',async()=>{const r=await fetch(data.manifestUrl,{credentials:'omit'});if(!r.ok)throw Error('Photo preprocessing bundle is unavailable.');return r.json();});
  if(manifest.schemaVersion!==1||!/^[0-9a-f]{64}$/.test(manifest.preprocessingSha256)||manifest.orientationPolicy!=='legacy-ignore-exif')throw Error('Invalid preprocessing identity.');
  const landmarks=descriptor(manifest.landmarks,data.manifestUrl,100*1024*1024),glue=descriptor(manifest.module,data.manifestUrl,8*1024*1024),wasm=descriptor(manifest.wasm,data.manifestUrl,8*1024*1024);
  if(landmarks.sha256!==LANDMARK_HASH||landmarks.size!==99693937)throw Error('Unexpected landmark model.');
  stats.preprocessingSha256=manifest.preprocessingSha256;stats.landmarksSha256=landmarks.sha256;stats.wasmSha256=wasm.sha256;let runtimeWasmSha=wasm.sha256;
  const imageBytes=new Uint8Array(await data.blob.arrayBuffer()),header=inspectImage(imageBytes);stats.input=header;
  const instantiate=async(js,binary,base)=>{moduleObjectUrl=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));try{const factory=(await import(/* @vite-ignore */ moduleObjectUrl)).default;return await factory({wasmBinary:binary,locateFile:path=>new URL(path,base).href,print:()=>{},printErr:()=>{}});}finally{URL.revokeObjectURL(moduleObjectUrl);moduleObjectUrl=null;}};
  await stage('alignment-runtime',async()=>{
   try{const fastWasm={url:FAST_WASM_URL,...FAST_NATIVE.wasm},binary=await checkedSmall(fastWasm);
    if(!WebAssembly.validate(binary))throw Error('unsupported');
    m=await instantiate(await checkedSmall({url:FAST_GLUE_URL,...FAST_NATIVE.glue}),binary,FAST_WASM_URL);runtimeWasmSha=FAST_NATIVE.wasm.sha256;stats.nativeBuild='fast-v1';
   }catch(error){stats.nativeBuild='pinned';stats.fastNativeRefused=String(error?.message||error);m=await instantiate(await checkedSmall(glue),await checkedSmall(wasm),wasm.url);}
   stats.wasmSha256=runtimeWasmSha;
  });
  if(data.tryAlign||data.requireSingleFace){
   pointer=await stage('alignment-model',()=>modelToHeap(m,landmarks,progress,stats));
   await stage('alignment-model-deserialize',()=>readError(m,m._cf_init_predictor(pointer,landmarks.size)));m._free(pointer);pointer=0;stats.fastLandmarkLoader=Boolean(m._cf_fast_loader_used?.());
  }
  await stage('photo-decode',()=>{pointer=m._malloc(imageBytes.length);if(!pointer)throw Error('Image exceeds bounded alignment memory.');m.HEAPU8.set(imageBytes,pointer);readError(m,m._cf_decode(pointer,imageBytes.length));m._free(pointer);pointer=0;if(m._cf_width()!==header.width||m._cf_height()!==header.height)throw Error('Decoded dimensions differ from admitted header.');});
  const count=(data.tryAlign||data.requireSingleFace)?await stage('face-landmarks',()=>readError(m,m._cf_detect())):0;stats.faceCount=count;
  // Every face's box (for the chooser) and its aligned square (fm-k09b): the proposal uses the encoder alignment's
  // own geometry (FFHQ: eyes 36-41/42-47, mouth corners 48/54), so an accepted proposal is what alignment would have
  // fed e4e. Pixels of the photo; the bridge turns them into fractions.
  if(count>=1){
   const ptr=m._malloc(136*4);if(!ptr)throw Error('Face selection exceeds local memory.');
   try{stats.faceBoxes=[];stats.faces=[];for(let face=0;face<count;face++){
    readError(m,m._cf_landmarks(face,ptr));const points=new Int32Array(m.HEAPU8.buffer,ptr,136);
    let x0=header.width,y0=header.height,x1=0,y1=0;for(let j=0;j<136;j+=2){x0=Math.min(x0,points[j]);x1=Math.max(x1,points[j]);y0=Math.min(y0,points[j+1]);y1=Math.max(y1,points[j+1]);}
    const size=Math.min(Math.max(x1-x0,y1-y0)*1.8,header.width,header.height),cx=(x0+x1)/2,cy=(y0+y1)/2;
    const box={x:Math.max(0,Math.min(header.width-size,cx-size/2))/header.width,y:Math.max(0,Math.min(header.height-size,cy-size/2))/header.height,width:size/header.width,height:size/header.height};
    const mean=(from,to)=>{let x=0,y=0;for(let i=from;i<to;i++){x+=points[2*i];y+=points[2*i+1];}return [x/(to-from),y/(to-from)];};
    const eyeL=mean(36,42),eyeR=mean(42,48),eye=[(eyeL[0]+eyeR[0])/2,(eyeL[1]+eyeR[1])/2],mouth=[(points[96]+points[108])/2,(points[97]+points[109])/2];
    const e2e=[eyeR[0]-eyeL[0],eyeR[1]-eyeL[1]],e2m=[mouth[0]-eye[0],mouth[1]-eye[1]];
    let qx=[e2e[0]+e2m[1],e2e[1]-e2m[0]];const len=Math.hypot(qx[0],qx[1])||1;
    const half=Math.max(Math.hypot(e2e[0],e2e[1])*2,Math.hypot(e2m[0],e2m[1])*1.8);qx=[qx[0]/len*half,qx[1]/len*half];
    const centre=[eye[0]+e2m[0]*0.1,eye[1]+e2m[1]*0.1];
    stats.faceBoxes.push(box);
    stats.faces.push({...box,align:{cx:centre[0],cy:centre[1],side:2*half,rotation:-Math.atan2(qx[1],qx[0])*180/Math.PI,width:header.width,height:header.height}});
   }}finally{m._free(ptr);}
  }
  if(data.requireSingleFace&&count!==1)throw Object.assign(Error(count===0?'No face was found. Choose a clear photo containing one face.':'More than one face was found. Choose a photo containing only one face.'),{code:count===0?'no-face':'multiple-faces'});
  const didAlign=Boolean(await stage('photo-warp-resize',()=>readError(m,m._cf_prepare(data.tryAlign?1:0))));
  const rgb=m.HEAPU8.slice(m._cf_prepared(),m._cf_prepared()+256*256*3),tensor=new Float32Array(3*256*256);
  for(let p=0;p<256*256;p++)for(let c=0;c<3;c++){let value=Math.fround(rgb[p*3+c]/255);value=Math.fround(value-.5);tensor[c*256*256+p]=Math.fround(value/.5);}
  stats.preparedSha256=hex(rgb);stats.tensorSha256=hex(new Uint8Array(tensor.buffer));stats.faceCount=count;stats.didAlign=didAlign;stats.wasmCapacityBytes=m.HEAPU8.buffer.byteLength;m._cf_reset();
  postMessage({type:'complete',result:{tensor,shape:[1,3,256,256],rgb,width:256,height:256,didAlign,faceCount:count,stats,provenance:{preprocessingSha256:manifest.preprocessingSha256,landmarksSha256:landmarks.sha256,runtimeSha256:runtimeWasmSha,facePolicy:data.requireSingleFace?'exactly-one-face-v1':'legacy-largest-face-or-unaligned-v1',orientationPolicy:manifest.orientationPolicy,exifOrientation:header.exifOrientation,privateDataStayedLocal:true}}},[tensor.buffer,rgb.buffer]);
 }catch(error){postMessage({type:'error',name:error.name,message:String(error.message||error),code:typeof error.code==='string'?error.code:undefined,stats});}
 finally{if(pointer)m?._free(pointer);try{m?._cf_reset();}catch{}if(moduleObjectUrl)URL.revokeObjectURL(moduleObjectUrl);}
};
