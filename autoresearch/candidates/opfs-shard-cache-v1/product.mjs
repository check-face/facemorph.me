// Warm-load bench for opfs-shard-cache-v1: the real runtime.mjs + ort-worker.mjs of whichever tree serves `/src`,
// WebGPU route, live pinned assets, in a fresh browser session over a warm storage profile. Inputs are fixed so the
// control and candidate trees can be compared byte for byte; nothing is persisted (originals are cleared first),
// so every face and photo is computed, never a cache hit.
import {createBrowserRuntime} from '/src/Next/browser/runtime.mjs';
import {latent} from './bench-main-latent.mjs';
const MANIFEST='https://next.facemorph.me/runtime/manifest.json';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const sha=async b=>hex(await crypto.subtle.digest('SHA-256',b));
const events=[];let rt,manifest;
const t0=performance.now();
// Bench stand-in for the photo aligner (its worker is cross-origin here): a plain 256px resize to [-1,1] CHW, what
// tryAlign:false does. Fixed input, so the encoded latent is comparable across trees.
async function benchAlign(blob){const b=await createImageBitmap(blob),c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.drawImage(b,0,0,256,256);b.close();const d=x.getImageData(0,0,256,256).data,t=new Float32Array(3*65536);for(let i=0;i<65536;i++)for(let k=0;k<3;k++)t[k*65536+i]=d[i*4+k]/127.5-1;return {tensor:t,provenance:{preprocessingSha256:manifest.alignmentSha256,facePolicy:'exactly-one-face-v1'},alignmentWorkerTerminated:true,faceCount:1,didAlign:false};}
const clearOriginals=()=>new Promise(r=>{const q=indexedDB.deleteDatabase('checkface-originals-v1');q.onsuccess=q.onerror=q.onblocked=()=>r();});
const stageAt=(name,from=0)=>{const e=events.find(e=>e[1]===name&&e[0]>=from);return e?e[0]:null;};
window.bench={
 events,
 async qualify(){
  await clearOriginals();manifest=await (await fetch(MANIFEST)).json();
  rt=createBrowserRuntime({manifestUrl:MANIFEST,preferredRoute:'webgpu',alignPhoto:benchAlign,onProgress:e=>{if(events.length<20000)events.push([performance.now(),e.stage,e.elapsedMs,e.cacheStatus,e.fetchedTotal]);}});
  const t=performance.now();const r=await rt.qualify('webgpu');const end=performance.now();
  const loading=stageAt('model-loading',t),loaded=events.find(e=>e[1]==='model-loaded'&&e[0]>=t);
  return {ms:end-t,pageToQualified:end-t0,modelLoadedMs:loaded?.[2]??null,toModelLoaded:loaded?loaded[0]-t:null,toFirstSynthesis:(stageAt('synthesis-complete',t)??NaN)-t,
   checks:(r.checks||[]).length,passed:(r.checks||[]).filter(c=>c.passed!==false).length,provider:r.provider};},
 // Fixed latents through synthesize (persist:false): every face computed, PNG digest comparable across trees.
 async faces(n){const out=[];for(let i=0;i<n;i++){const t=performance.now();const f=await rt.synthesize({space:'w-plus',shape:[1,18,512],values:latent(i,7)},{persist:false});out.push({ms:performance.now()-t,sha:await sha(await f.blob.arrayBuffer())});}return out;},
 // Photo path: encode fixed generated faces. The first encode of a session pays the encoder's acquisition and checks.
 async photo(n){const out=[];for(let i=0;i<n;i++){const f=await rt.synthesize({space:'w-plus',shape:[1,18,512],values:latent(i+3,9)},{persist:false});const t=performance.now();const r=await rt.encodePhoto(f.blob,{tryAlign:false});out.push({ms:performance.now()-t,latentSha:await sha(Float32Array.from(r.values).buffer),imageSha:await sha(await r.blob.arrayBuffer()),encoderPassed:r.encoderQualification?.passed===true});}return out;},
 // Storage state for the evidence: what each backend holds right now.
 async storage(){const out={opfs:null,cacheEntries:null};
  try{const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('checkface-model-shards-v1');let files=0,bytes=0;for await(const [,h] of dir.entries()){if(h.kind!=='file')continue;files++;bytes+=(await h.getFile()).size;}out.opfs={files,bytes};}catch(e){out.opfs=String(e.name||e);}
  try{const c=await caches.open('checkface-model-blobs-v1');const keys=await c.keys();out.cacheEntries=keys.filter(k=>/sha256\/[0-9a-f]{64}$/.test(k.url)).length;}catch(e){out.cacheEntries=String(e.name||e);}
  out.estimate=await navigator.storage.estimate();return out;},
 // Damage the stored synthesis prefix three ways — a flipped payload byte under an intact trailer, a write cut
 // short before its trailer, and a deleted unit — then let the next qualify prove it repairs exactly those units.
 async corrupt(){const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('checkface-model-shards-v1');
  const units=manifest?.webgpu?.prefix?.chunks||(await (await fetch(MANIFEST)).json()).webgpu.prefix.chunks;const [a,b,c]=units;const done=[];
  {const h=await dir.getFileHandle(a.sha256),f=await h.getFile(),bytes=new Uint8Array(await f.arrayBuffer());bytes[12345]^=0xff;const w=await h.createWritable();await w.write(bytes);await w.close();done.push(['flipped',a.sha256]);}
  {const h=await dir.getFileHandle(b.sha256),f=await h.getFile(),bytes=new Uint8Array(await f.slice(0,b.size).arrayBuffer());const w=await h.createWritable();await w.write(bytes);await w.close();done.push(['no-trailer',b.sha256]);}
  {await dir.removeEntry(c.sha256);done.push(['deleted',c.sha256]);}
  return done;},
 // Cache trouble the worker forwarded (once per status per asset), and the most network bytes any progress event planned.
 statuses(){const counts={};let fetched=0;for(const e of events){if(e[3])counts[e[3]]=(counts[e[3]]||0)+1;if(e[4]>fetched)fetched=e[4];}return {trouble:counts,fetchedTotal:fetched};}
};
document.getElementById('out').textContent='loaded';
