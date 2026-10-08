// Component bench worker: the product WebGPU engine (or a candidate) on pinned live assets, then the
// product's own per-frame CPU tail (rgba1024 + encodeRgbaPng), timed per frame.
import {rgba1024} from '../../../src/Next/browser/identity.mjs';
import {encodeRgbaPng} from '../../../src/Next/browser/png.mjs';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
let cache;
async function bytes(asset){
 cache ||= await caches.open('bench-assets-v1');
 const key='https://bench.invalid/'+asset.sha256;let hit=await cache.match(key);
 if(!hit){let buf;
  if(asset.chunks){const parts=[];for(const c of asset.chunks)parts.push(new Uint8Array(await (await fetch(c.url)).arrayBuffer()));const out=new Uint8Array(asset.size);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}buf=out.buffer;}
  else buf=await (await fetch(asset.url)).arrayBuffer();
  if(hex(await crypto.subtle.digest('SHA-256',buf))!==asset.sha256)throw Error('sha mismatch '+asset.url);
  await cache.put(key,new Response(buf));return new Uint8Array(buf);}
 return new Uint8Array(await hit.arrayBuffer());
}
const floats=async a=>{const b=await bytes(a);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
let session,noise,manifest;
self.onmessage=async({data})=>{try{
 if(data.type==='init'){
  manifest=data.manifest;const t=performance.now();
  const mod=await import(data.engine);
  noise={};for(const n of manifest.noise)noise[n.name]=await floats(n);
  session=await mod.createWebGpuSession({config:manifest.webgpu,noiseManifest:manifest.noise,bytes});
  postMessage({type:'ready',ms:performance.now()-t});return;}
 if(data.type==='batch'){
  // Pipelined: frame i+1 is queued on the GPU before frame i's CPU tail runs.
  const L=data.latents,t0=performance.now();let pending=await session.submit(L[0],noise);
  for(let i=0;i<L.length;i++){const next=i+1<L.length?await session.submit(L[i+1],noise):null;const raw=await pending.raw;const blob=await encodeRgbaPng(rgba1024(raw));postMessage({type:'frame',index:i,blob,hash:data.hash?hex(await crypto.subtle.digest('SHA-256',raw)):undefined,at:performance.now()-t0,sample:raw[12345]});pending=next;}
  return;}
 if(data.type==='frame'){
  const t0=performance.now();const raw=await session.infer(data.values,noise,data.sync);const t1=performance.now();
  const marks=session.marks?session.marks.map(([n,t])=>[n,t-t0]):[];
  let blob=null,rgbaMs=0,pngMs=0;
  if(data.tail!=='none'){const r=rgba1024(raw);const t2=performance.now();rgbaMs=t2-t1;blob=await encodeRgbaPng(r);pngMs=performance.now()-t2;}
  postMessage({type:'frame',hash:data.hash?hex(await crypto.subtle.digest('SHA-256',raw)):undefined,inferMs:t1-t0,rgbaMs,pngMs,marks,blob,workerMs:performance.now()-t0,sample:raw[12345]});return;}
}catch(e){postMessage({type:'error',message:String(e&&e.stack||e)});}};
