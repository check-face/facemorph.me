// Raised when a photo does not hold exactly one alignable face. The product treats this as an
// invitation to crop rather than an error, so the sentence is a shared constant: Product.fs
// imports it and photo-selection.test.mjs pins them together.
export const MULTIPLE_FACES_MESSAGE='Choose a clear photo containing exactly one face.';
/** Each call owns a disposable worker. Resolution happens only after termination. */
export function createPhotoAligner({manifestUrl='/runtime/photo/manifest.json',workerUrl='/runtime/photo/photo-worker.mjs',workerFactory=url=>new Worker(url,{type:'module'}),stallMs=180000}={}){
 let active=false;
 const alignPhoto=async(blob,{signal,onProgress=()=>{},tryAlign=true,requireSingleFace=true}={})=>{
  if(!(blob instanceof Blob)||blob.size<8||blob.size>25*1024*1024)throw Error('Choose a PNG or JPEG smaller than25 MB.');
  if(typeof requireSingleFace!=='boolean')throw Error('Single-face selection must be a boolean.');
  if(typeof tryAlign!=='boolean')throw Error('Alignment selection must be a boolean.');
  if(signal?.aborted)throw signal.reason||new DOMException('Photo preparation cancelled','AbortError');
  if(active)throw Error('Another photo is still being prepared.');active=true;
  let worker,timer,abort;
  try{return await new Promise((resolve,reject)=>{
   const fail=error=>reject(error),reset=()=>{clearTimeout(timer);timer=setTimeout(()=>fail(Error('Local photo preparation stopped responding.')),stallMs);};
   abort=()=>fail(signal?.reason||new DOMException('Photo preparation cancelled','AbortError'));signal?.addEventListener('abort',abort,{once:true});
   worker=workerFactory(workerUrl);worker.onerror=event=>fail(Error(event.message||'The local alignment worker stopped.'));
   worker.onmessage=({data})=>{reset();if(data.type==='progress'){try{onProgress(data);}catch{}return;}if(data.type==='error'){fail(Object.assign(Error(data.message),{name:data.name||'Error',alignmentStats:data.stats}));return;}if(data.type==='complete'){
    if(!(data.result?.tensor instanceof Float32Array)||data.result.tensor.length!==3*256*256){fail(Error('Invalid prepared tensor.'));return;}
    if(requireSingleFace&&(data.result.faceCount!==1||data.result.provenance?.facePolicy!=='exactly-one-face-v1'||(tryAlign&&data.result.didAlign!==true))){fail(Error(MULTIPLE_FACES_MESSAGE));return;}
    data.result.alignmentWorkerTerminated=true;resolve(data.result);
   }};
   reset();worker.postMessage({type:'align',blob,tryAlign,requireSingleFace,manifestUrl:new URL(manifestUrl,globalThis.location?.href||import.meta.url).href});
  });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();active=false;}
 };
 return alignPhoto;
}
export const alignPhoto=createPhotoAligner();
