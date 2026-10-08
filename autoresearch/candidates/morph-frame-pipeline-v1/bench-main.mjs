const MANIFEST='https://next.facemorph.me/runtime/manifest.json';
let worker,manifest,waiters=[];
const next=()=>new Promise((res,rej)=>waiters.push({res,rej}));
function boot(){worker=new Worker(new URL('./bench-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{const w=waiters.shift();if(!w)return;data.type==='error'?w.rej(Error(data.message)):w.res(data);};}
const digest=async b=>crypto.subtle.digest('SHA-256',b);
// Product media.mjs frameDerivatives, inlined (not exported): decode once, 512 RGBA for the encoder,
// 512 JPEG derivative for the slider.
async function derivatives(blob,size=512){const bitmap=await createImageBitmap(blob);try{const c=new OffscreenCanvas(size,size),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bitmap,0,0,size,size);const rgba=x.getImageData(0,0,size,size).data;const jpeg=await c.convertToBlob({type:'image/jpeg',quality:.85});return {rgba,jpeg};}finally{bitmap.close();}}
export function latent(i,n){const v=new Float32Array(9216);for(let k=0;k<9216;k++)v[k]=Math.sin(k*0.37+i/n*3)*0.8;return v;}
window.bench={
 async init(engine,profile=false,ortBase=''){manifest=await (await fetch(MANIFEST)).json();boot();const p=next();worker.postMessage({type:'init',manifest,engine,profile,ortBase});return (await p).ms;},
 // Product-shaped sequential loop: worker synth+png, then main-thread digests + derivatives, then next frame.
 // Candidate loop: one batch request, frames stream back; main-thread tail runs as each arrives,
 // never holding the worker.
 async batch(n,{warm=3,hash=false}={}){
  const L=Array.from({length:n+warm},(_,i)=>latent(i,n));const got=[];let done;const all=new Promise(r=>done=r);let chain=Promise.resolve();const t0=performance.now();let tw=0;const saved=worker.onmessage;
  worker.onmessage=({data})=>{if(data.type==='error'){done({error:data.message});return;}chain=chain.then(async()=>{await digest(await data.blob.arrayBuffer());await digest(L[data.index]);await derivatives(data.blob);got.push({index:data.index,arrive:data.at,done:performance.now()-t0,sample:data.sample,hash:data.hash});if(data.index===warm-1)tw=performance.now();if(got.length===L.length)done();});};
  worker.postMessage({type:'batch',latents:L,hash});const r=await all;worker.onmessage=saved;if(r?.error)throw Error(r.error);
  const perFrame=(performance.now()-tw)/n;return [{perFrame,hashes:got.sort((a,b)=>a.index-b.index).map(g=>g.hash)}];},
 async profile(n){await this.frames(n,{tail:'none',warm:0});const p=next();worker.postMessage({type:'profile'});return (await p).rows;},
 async frames(n,{sync=false,tail='product',warm=3,hash=false}={}){
  const rows=[];
  for(let i=0;i<n+warm;i++){
   const values=latent(i,n);const t0=performance.now();const p=next();worker.postMessage({type:'frame',values,sync,tail,hash});const f=await p;const t1=performance.now();
   if(hash&&i<warm)rows.push({hash:f.hash,warmup:true});let mainMs=0;if(tail==='product'&&f.blob){const a=performance.now();await digest(await f.blob.arrayBuffer());await digest(values);await derivatives(f.blob);mainMs=performance.now()-a;}
   const total=performance.now()-t0;
   if(i>=warm)rows.push({hash:f.hash,total,roundTrip:t1-t0,inferMs:f.inferMs,rgbaMs:f.rgbaMs,pngMs:f.pngMs,mainMs,marks:f.marks});
  }
  return rows;}
};
document.getElementById('out').textContent='loaded';
