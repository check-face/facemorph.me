import {Sha256}from'./sha256.mjs';
import {inspectImage}from'./image-header.mjs';
let running=false;
const LANDMARK_HASH='fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f';
const hex=bytes=>{const hash=new Sha256();hash.update(bytes);return hash.hex();};
function descriptor(value,base,max){if(!value||!Number.isSafeInteger(value.size)||value.size<1||value.size>max||!/^[0-9a-f]{64}$/.test(value.sha256))throw Error('Invalid photo asset descriptor.');const url=new URL(value.url,base);if(url.origin!==self.location.origin)throw Error('Photo model/runtime assets must use this site origin.');return{...value,url:url.href};}
async function checkedSmall(a){const r=await fetch(a.url,{credentials:'omit'});if(!r.ok)throw Error(`Photo runtime download failed (${r.status}).`);const length=Number(r.headers.get('content-length'));if(length&&length>a.size)throw Error('Photo runtime exceeds pinned size.');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==a.size||hex(bytes)!==a.sha256)throw Error('Photo runtime integrity check failed.');return bytes;}
function readError(m,result){if(result<0)throw Error(m.UTF8ToString(m._cf_error())||'Native alignment failed.');return result;}
async function modelToHeap(m,a,progress,stats){
 let root,handle,writer,reader,downloaded=false,pointer=0,success=false;
 const filename=`landmarks-${a.sha256}.dat`;
 const chunks=a.chunks;
 if(chunks!==undefined&&(!Array.isArray(chunks)||!chunks.length||chunks.length>16||chunks.reduce((n,p)=>n+p.size,0)!==a.size))throw Error('Invalid landmark chunk schedule.');
 const parts=chunks?.map(p=>descriptor(p,a.url,16*1024*1024));
 try{
  let cachedResponse;
  try{root=await navigator.storage.getDirectory();handle=await root.getFileHandle(filename);const file=await handle.getFile();if(file.size===a.size){cachedResponse=new Response(file.stream());stats.modelCache='opfs-hit';}}
  catch{}
  if(!cachedResponse){downloaded=true;stats.modelCache='http-or-network';
   try{root||=await navigator.storage.getDirectory();handle=await root.getFileHandle(filename,{create:true});writer=await handle.createSyncAccessHandle();writer.truncate(0);stats.modelCache='opfs-write';}catch{writer?.close();writer=null;}
  }
  pointer=m._malloc(a.size);if(!pointer)throw Error('Not enough bounded WASM memory for landmarks.');
  const hash=new Sha256();let offset=0,last=0;
  const schedule=cachedResponse?[a]:(parts||[a]);stats.chunkedModelTransport=!cachedResponse&&Boolean(parts);stats.modelChunkCount=schedule.length;
  for(const part of schedule){
   const response=cachedResponse||await fetch(part.url,{credentials:'omit'});if(!response.ok)throw Error(`Landmark download failed (${response.status}).`);
   const length=Number(response.headers.get('content-length'));if(length&&length>part.size)throw Error('Landmark response exceeds pinned size.');
   let byob=false;try{reader=response.body?.getReader({mode:'byob'});byob=Boolean(reader);}catch{reader=response.body?.getReader();}if(!reader)throw Error('A streaming landmark response is required.');stats.modelReader=byob?'byob-1MiB':'default-stream';
   let partOffset=0;const partHash=parts&&!cachedResponse?new Sha256():null;
   while(true){const item=await (byob?reader.read(new Uint8Array(1024*1024)):reader.read());if(item.done)break;const chunk=item.value;if(partOffset+chunk.length>part.size||offset+chunk.length>a.size)throw Error('Landmark stream exceeds pinned size.');
    m.HEAPU8.set(chunk,pointer+offset);hash.update(chunk);partHash?.update(chunk);if(writer)writer.write(chunk,{at:offset});offset+=chunk.length;partOffset+=chunk.length;stats.maxModelChunkBytes=Math.max(stats.maxModelChunkBytes||0,chunk.length);
    if(offset-last>=4*1024*1024||offset===a.size){progress('alignment-model-download',{completed:offset,total:a.size});last=offset;}
   }
   if(partOffset!==part.size||(partHash&&partHash.hex()!==part.sha256))throw Error('Landmark chunk integrity check failed.');
   // This private reader is deliberately not releaseLock'ed (WebKit GC deadlock).
   reader=null;
  }
  if(offset!==a.size||hash.hex()!==a.sha256)throw Error('Landmark integrity check failed.');writer?.flush();writer?.close();writer=null;success=true;return pointer;
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
  stats.preprocessingSha256=manifest.preprocessingSha256;stats.landmarksSha256=landmarks.sha256;stats.wasmSha256=wasm.sha256;
  const imageBytes=new Uint8Array(await data.blob.arrayBuffer()),header=inspectImage(imageBytes);stats.input=header;
  await stage('alignment-runtime',async()=>{const js=await checkedSmall(glue),binary=await checkedSmall(wasm);moduleObjectUrl=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));const factory=(await import(moduleObjectUrl)).default;m=await factory({wasmBinary:binary,locateFile:path=>new URL(path,wasm.url).href,print:()=>{},printErr:()=>{}});URL.revokeObjectURL(moduleObjectUrl);moduleObjectUrl=null;});
  if(data.tryAlign||data.requireSingleFace){
   pointer=await stage('alignment-model',()=>modelToHeap(m,landmarks,progress,stats));
   await stage('alignment-model-deserialize',()=>readError(m,m._cf_init_predictor(pointer,landmarks.size)));m._free(pointer);pointer=0;
  }
  await stage('photo-decode',()=>{pointer=m._malloc(imageBytes.length);if(!pointer)throw Error('Image exceeds bounded alignment memory.');m.HEAPU8.set(imageBytes,pointer);readError(m,m._cf_decode(pointer,imageBytes.length));m._free(pointer);pointer=0;if(m._cf_width()!==header.width||m._cf_height()!==header.height)throw Error('Decoded dimensions differ from admitted header.');});
  const count=(data.tryAlign||data.requireSingleFace)?await stage('face-landmarks',()=>readError(m,m._cf_detect())):0;stats.faceCount=count;
  if(data.requireSingleFace&&count!==1)throw Error(count===0?'No face was found. Choose a clear photo containing one face.':'More than one face was found. Choose a photo containing only one face.');
  const didAlign=Boolean(await stage('photo-warp-resize',()=>readError(m,m._cf_prepare(data.tryAlign?1:0))));
  const rgb=m.HEAPU8.slice(m._cf_prepared(),m._cf_prepared()+256*256*3),tensor=new Float32Array(3*256*256);
  for(let p=0;p<256*256;p++)for(let c=0;c<3;c++){let value=Math.fround(rgb[p*3+c]/255);value=Math.fround(value-.5);tensor[c*256*256+p]=Math.fround(value/.5);}
  stats.preparedSha256=hex(rgb);stats.tensorSha256=hex(new Uint8Array(tensor.buffer));stats.faceCount=count;stats.didAlign=didAlign;stats.wasmCapacityBytes=m.HEAPU8.buffer.byteLength;m._cf_reset();
  postMessage({type:'complete',result:{tensor,shape:[1,3,256,256],rgb,width:256,height:256,didAlign,faceCount:count,stats,provenance:{preprocessingSha256:manifest.preprocessingSha256,landmarksSha256:landmarks.sha256,runtimeSha256:wasm.sha256,facePolicy:data.requireSingleFace?'exactly-one-face-v1':'legacy-largest-face-or-unaligned-v1',orientationPolicy:manifest.orientationPolicy,exifOrientation:header.exifOrientation,privateDataStayedLocal:true}}},[tensor.buffer,rgb.buffer]);
 }catch(error){postMessage({type:'error',name:error.name,message:String(error.message||error),stats});}
 finally{if(pointer)m?._free(pointer);try{m?._cf_reset();}catch{}if(moduleObjectUrl)URL.revokeObjectURL(moduleObjectUrl);}
};
