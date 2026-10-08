// Product-level bench: the real runtime.mjs + ort-worker.mjs of whichever tree serves `/src`, WebGPU
// route, live pinned assets. `seq` is the shipped morph loop shape (one synthesize per frame, then
// the bridge/media main-thread work); `batch` is the new synthesizeFrames windows of 16.
import {createBrowserRuntime} from '/src/Next/browser/runtime.mjs';
import {latent} from './bench-main-latent.mjs';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const sha=async b=>hex(await crypto.subtle.digest('SHA-256',b));
async function derivatives(blob,size=512){const bitmap=await createImageBitmap(blob);try{const c=new OffscreenCanvas(size,size),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bitmap,0,0,size,size);x.getImageData(0,0,size,size);await c.convertToBlob({type:'image/jpeg',quality:.85});}finally{bitmap.close();}}
const events=[];let rt;
window.bench={
 events,
 async qualify(){rt=createBrowserRuntime({manifestUrl:'https://next.facemorph.me/runtime/manifest.json',preferredRoute:'webgpu',onProgress:e=>{if(events.length<4000)events.push([performance.now(),e.stage,e.elapsedMs]);}});
  const t=performance.now();const r=await rt.qualify('webgpu');return {ms:performance.now()-t,checks:(r.checks||[]).length,passed:(r.checks||[]).filter(c=>c.passed!==false).length,deviceValidated:r.deviceValidated,provider:r.provider,raw:JSON.stringify(r).slice(0,600)};},
 async faces(n){const out=[];const base=Date.now()%1000000*10;for(let i=0;i<n;i++){const t=performance.now();const f=await rt.generate({mode:'seed',value:String(base+i)});out.push({ms:performance.now()-t,cached:f.cached});}return out;},
 async morph(mode,n,warm=3){
  const timing=[];const L=Array.from({length:n+warm},(_,i)=>latent(i,n));const hashes=new Array(L.length);let tw=0;const t0=performance.now();
  if(mode==='seq'){for(let i=0;i<L.length;i++){const a=performance.now();const f=await rt.synthesize({space:'w-plus',shape:[1,18,512],values:L[i]},{persist:false});const b=performance.now();hashes[i]=await sha(await f.blob.arrayBuffer());const c=performance.now();await derivatives(f.blob);timing.push([Math.round(b-a),Math.round(c-b),Math.round(performance.now()-c)]);if(i===warm-1)tw=performance.now();}}
  else{let chain=Promise.resolve();for(let s=0;s<L.length;s+=16){const win=L.slice(s,s+16);
    await rt.synthesizeFrames(win.map(values=>({space:'w-plus',shape:[1,18,512],values})),{onFrame:(at,f)=>{const i=s+at;chain=chain.then(async()=>{hashes[i]=await sha(await f.blob.arrayBuffer());await derivatives(f.blob);if(i===warm-1)tw=performance.now();});}});
    await chain;}}
  // per frame: from the moment the last warm-up frame is fully handled to the moment the last frame is, identical for both modes
  return {perFrame:(performance.now()-tw)/n,total:performance.now()-t0,hashes,timing};}
};
document.getElementById('out').textContent='loaded';
