const MANIFEST='https://next.facemorph.me/runtime/manifest.json';
let worker;const call=msg=>new Promise((res,rej)=>{worker.onmessage=({data})=>data.type==='error'?rej(Error(data.message)):res(data.result);worker.postMessage(msg);});
window.benchMain=async({steps,profile=false,compare=true,engine})=>{
 const manifest=await (await fetch(MANIFEST)).json();worker=new Worker(new URL('./direct-worker.mjs',import.meta.url),{type:'module'});
 const out={init:await call({type:'init',manifest,engine:'./'+(engine||'direct-v1.mjs'),profile,compare})};
 for(const s of steps)out[s.type+(s.label||'')]=await call(s);
 return out;};
document.title='ready';
