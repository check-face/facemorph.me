import {rgba1024} from '../../../src/Next/browser/identity.mjs';
import {encodeRgbaPng} from '../../../src/Next/browser/png.mjs';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
let cache;
async function bytes(asset){
 cache ||= await caches.open('bench-assets-v1');
 const key='https://bench.invalid/'+asset.sha256;const hit=await cache.match(key);if(hit)return new Uint8Array(await hit.arrayBuffer());
 let buf;if(asset.chunks){const out=new Uint8Array(asset.size);let o=0;for(const c of asset.chunks){const p=new Uint8Array(await (await fetch(c.url)).arrayBuffer());out.set(p,o);o+=p.length;}buf=out.buffer;}
 else buf=await (await fetch(asset.url)).arrayBuffer();
 if(hex(await crypto.subtle.digest('SHA-256',buf))!==asset.sha256)throw Error('sha mismatch '+asset.url);
 await cache.put(key,new Response(buf));return new Uint8Array(buf);
}
const floats=async a=>{const b=await bytes(a);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
let direct,ref,noise,manifest;
function latent(i,n){const v=new Float32Array(9216);for(let k=0;k<9216;k++)v[k]=Math.sin(k*0.37+i/n*3)*0.8;return v;}
self.onmessage=async({data})=>{try{
 if(data.type==='init'){
  manifest=data.manifest;noise={};for(const n of manifest.noise)noise[n.name]=await floats(n);
  const wm=JSON.parse(new TextDecoder().decode(await bytes({url:manifest.webgl.assetBase+'manifest.json',sha256:manifest.webgl.manifestSha256||null,size:0}).catch(async()=>new Uint8Array(await (await fetch(manifest.webgl.assetBase+'manifest.json')).arrayBuffer()))));
  const t=performance.now();const mod=await import(data.engine);
  direct=await mod.createDirectSession({manifest:wm,assetBase:manifest.webgl.assetBase,bytes,profile:data.profile});const directMs=performance.now()-t;
  if(data.compare){const m=await import('../../../src/Next/browser/webgpu-engine.mjs');ref=await m.createWebGpuSession({config:manifest.webgpu,noiseManifest:manifest.noise,bytes});}
  postMessage({type:'done',result:{directMs,steps:direct.steps,coefficientBytes:direct.coefficientBytes}});return;}
 if(data.type==='compare'){
  const rows=[];const cases=[...Array.from({length:data.n},(_,i)=>({name:'morph-'+i,values:latent(i,data.n),noise})),
   ...manifest.canaries.slice(0,data.canaries||0).map(c=>({name:c.name,canary:c}))];
  for(const c of cases){
   let values=c.values,nz=c.noise;
   if(c.canary){values=await floats(c.canary.w);nz=noise;if(c.canary.noise&&c.canary.noise!=='original'){nz={};for(const [k,v] of Object.entries(noise))nz[k]=c.canary.noise==='zero'?new Float32Array(v.length):Float32Array.from(v,x=>-x);}}
   const a=await direct.infer(values,nz),b=await ref.infer(values,nz);
   let maxF=0,maxRgb=0,fin=true;for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]))fin=false;maxF=Math.max(maxF,Math.abs(a[i]-b[i]));}
   const ra=rgba1024(a),rb=rgba1024(b);let diffPix=0;for(let i=0;i<ra.length;i++){const d=Math.abs(ra[i]-rb[i]);if(d>maxRgb)maxRgb=d;if(d)diffPix++;}
   rows.push({name:c.name,maxFloat:maxF,maxRgb,diffFrac:diffPix/ra.length,finite:fin});
  }
  postMessage({type:'done',result:rows});return;}
 if(data.type==='time'){
  const n=data.n,warm=3,L=Array.from({length:n+warm},(_,i)=>latent(i,n));const res={};
  // GPU-only sequential (infer), then product-shaped pipelined batch with rgba+png tail
  for(let i=0;i<warm;i++)await direct.infer(L[i],noise);
  let t=performance.now();for(let i=warm;i<L.length;i++)await direct.infer(L[i],noise);res.seqInferMs=(performance.now()-t)/n;
  t=performance.now();let pending=await direct.submit(L[0],noise);
  for(let i=0;i<L.length;i++){const next=i+1<L.length?await direct.submit(L[i+1],noise):null;const raw=await pending.raw;await encodeRgbaPng(rgba1024(raw));if(i===warm-1)t=performance.now();pending=next;}
  res.pipelinedWithTailMs=(performance.now()-t)/n;
  await direct.gpuOnly(L[0],noise,3);t=performance.now();await direct.gpuOnly(L[0],noise,n);res.gpuOnlyMs=(performance.now()-t)/n;
  t=performance.now();for(let i=0;i<n;i++){const nz={...noise};await direct.gpuOnly(L[0],nz,1);}res.gpuOnlyWithNoiseUploadMs=(performance.now()-t)/n;
  if(data.profile){await direct.infer(L[0],noise);res.marks=direct.marks.slice();}
  postMessage({type:'done',result:res});return;}
}catch(e){postMessage({type:'error',message:String(e&&e.stack||e)});}};
