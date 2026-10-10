// A single image worker; backpressure is acquired BEFORE callers allocate/transfer a raw copy.
export function createImageEncoder({worker=new Worker(new URL('./encode-worker.mjs',import.meta.url),{type:'module'}),maxBytes=8*1024*1024,timeoutMs=30000}={}){
 let next=0,used=0,closed=false;const jobs=new Map(),waiters=[],tokens=new Set();
 const wake=()=>{while(!closed&&waiters.length&&used+waiters[0].bytes<=maxBytes){const w=waiters.shift();w.signal?.removeEventListener('abort',w.abort);if(w.signal?.aborted){w.reject(w.signal.reason);continue;}used+=w.bytes;w.resolve(reservation(w.bytes));}};
 const reservation=bytes=>{let released=false;const token={bytes,consumed:false,release(){if(!released){released=true;tokens.delete(token);used-=bytes;wake();}}};tokens.add(token);return token;};
 const clean=job=>{clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);job.reservation.release();};
 const dispose=(reason=new DOMException('Image encoding cancelled','AbortError'))=>{if(closed)return;closed=true;worker.terminate();for(const job of jobs.values()){clean(job);job.reject(reason);}jobs.clear();for(const w of waiters.splice(0)){w.signal?.removeEventListener('abort',w.abort);w.reject(reason);}for(const token of tokens)token.release();};
 worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);clean(job);if(job.signal?.aborted)job.reject(job.signal.reason);else if(data.error)job.reject(Error(data.error));else job.resolve(data.result);};
 worker.onerror=()=>dispose(Error('The image encoder stopped.'));
 worker.onmessageerror=()=>dispose(Error('The image encoder returned unreadable data.'));
 async function acquire(bytes,{signal}={}){
  if(closed||signal?.aborted)throw signal?.reason||new DOMException('Image encoding cancelled','AbortError');
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>maxBytes)throw Error('Image exceeds the raw buffer budget.');
  if(!waiters.length&&used+bytes<=maxBytes){used+=bytes;return reservation(bytes);}
  return new Promise((resolve,reject)=>{const w={bytes,signal,resolve,reject};w.abort=()=>{const at=waiters.indexOf(w);if(at>=0){waiters.splice(at,1);reject(signal.reason);wake();}};waiters.push(w);signal?.addEventListener('abort',w.abort,{once:true});});
 }
 function encode(reserved,request,{signal}={}){
  if(!tokens.has(reserved)||reserved.consumed)return Promise.reject(Error('Invalid or reused image reservation.'));
  if(closed||signal?.aborted){reserved.release();return Promise.reject(signal?.reason||new DOMException('Image encoding cancelled','AbortError'));}
  if(!(request.rgba instanceof ArrayBuffer)||request.rgba.byteLength!==reserved.bytes){reserved.release();return Promise.reject(Error('Raw image reservation mismatch.'));}
  reserved.consumed=true;
  const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>dispose(Error('Image encoding timed out.')),timeoutMs);const job={resolve,reject,timer,reservation:reserved,signal,abort:()=>reject(signal.reason)};jobs.set(id,job);signal?.addEventListener('abort',job.abort,{once:true});try{worker.postMessage({id,...request},[request.rgba]);}catch(error){jobs.delete(id);clean(job);reject(error);}});
 }
 return {acquire,encode,dispose,status:()=>({rawBytes:used,pending:jobs.size,waiting:waiters.length,closed})};
}
export function paintRgba(canvas,{rgba,width=1024,height=1024}){
 const pixels=rgba instanceof ArrayBuffer?new Uint8ClampedArray(rgba):rgba;
 if(!(pixels instanceof Uint8ClampedArray)||pixels.byteLength!==width*height*4)throw Error('Invalid display frame.');
 canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Display canvas unavailable.');ctx.putImageData(new ImageData(pixels,width,height),0,0);
}
