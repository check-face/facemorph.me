import {openOriginals,digest} from './browser/originals.mjs';
const KEY='last-generated-result-v1';
export async function validateLast(record){
 if(record?.kind!==KEY||!(record.result?.blob instanceof Blob)||!['image/png','image/webp'].includes(record.result.blob.type))return null;
 if(record.settings){const settings=record.settings;
  if(!['full-smooth-figure8','full-smooth-ellipse','pairwise-figure8','pairwise-ellipse','linear'].includes(settings.kind)||!Number.isFinite(settings.width)||settings.width<0||settings.width>1.2||typeof settings.pinch!=='boolean'||![8,16,32].includes(settings.frames)||!Number.isInteger(settings.fps)||settings.fps<1||settings.fps>120)return null;
 }
 const r=record.result,v=r.latent?.values;
 if(r.latent?.space!=='w-plus'||v?.length!==18*512||!Array.from(v).every(Number.isFinite)||!r.provenance?.modelSha256||!r.provenance?.noiseSha256)return null;
 const bytes=v instanceof Float32Array?v:new Float32Array(v);
 if(await digest(await r.blob.arrayBuffer())!==r.imageSha256||await digest(bytes)!==r.latentSha256)return null;
 return {...record,result:{...r,latent:{space:'w-plus',shape:[18,512],values:bytes}}};
}
export async function rememberLast(result,settings){
 let store;try{
  if(!result?.imageSha256||!result?.latentSha256)return false;
  store=await openOriginals();
  // Deliberately omit source files, input strings and transient progress.
  if(!/^[a-f0-9]{64}$/.test(result.cacheKey||''))return false;
  await store.put(KEY,{kind:KEY,key:result.cacheKey,generationKind:result.generationKind||'seed',generationSha256:result.generationSha256,settings:{kind:settings.kind,width:settings.width,pinch:settings.pinch,frames:settings.frames,fps:settings.fps}});
  return true;
 }catch{return false;}finally{store?.close();}
}
export async function readLast(onOutcome=()=>{}){let store;try{
 store=await openOriginals();const ref=await store.get(KEY);
 if(!ref){onOutcome('missing');return null;}
 if(!/^[a-f0-9]{64}$/.test(ref.key||'')||!['seed','photo','latent'].includes(ref.generationKind)||!/^[a-f0-9]{64}$/.test(ref.generationSha256||'')){onOutcome('incompatible');return null;}
 const result=await store.get(ref.key);if(!result){onOutcome('missing');return null;}
 if(result.generationSha256!==ref.generationSha256){onOutcome('incompatible');return null;}
 const saved=await validateLast({...ref,result});if(!saved)onOutcome('incompatible');return saved;
 }catch{onOutcome('unavailable');return null;}finally{store?.close();}}

const SESSION='last-generated-session-v2',SLIDER='facemorph-slider-v1';
const MAX_SESSION_BYTES=32*1024*1024;
export function sliderPreference(){try{return JSON.parse(localStorage.getItem(SLIDER)||'{}').enabled===true;}catch{return false;}}
export function sliderPosition(){try{const n=JSON.parse(localStorage.getItem(SLIDER)||'{}').frame;return Number.isInteger(n)&&n>0&&n<=4096?n:1;}catch{return 1;}}
export function rememberSlider(enabled,frame){try{localStorage.setItem(SLIDER,JSON.stringify({enabled:enabled===true,frame:Number.isInteger(frame)&&frame>0?Math.min(frame,4096):1}));}catch{}}
export async function validateSession(record){
 if(record?.kind!==SESSION||!Array.isArray(record.faces)||record.faces.length>64||!Array.isArray(record.ids)||record.ids.length>64||new Set(record.ids).size!==record.ids.length||record.ids.some(id=>typeof id!=='string'||id.length>128))return null;
 const checked=[];
 for(const face of record.faces){
  if(!record.ids.includes(face.id)||checked.some(f=>f.id===face.id)||!['seed','photo','latent'].includes(face.generationKind)||!/^[a-f0-9]{64}$/.test(face.result?.generationSha256||''))return null;
  const valid=await validateLast({kind:KEY,result:face.result,settings:record.settings});if(!valid)return null;
  checked.push({...face,result:valid.result});
 }
 const bytes=checked.reduce((n,f)=>n+f.result.blob.size,0);
 if(bytes>MAX_SESSION_BYTES)return null;
 let frames=[];
 if(Array.isArray(record.frames)&&record.frames.length<=4096&&Array.isArray(record.frameHashes)&&record.frameHashes.length===record.frames.length&&record.frames.every(f=>f instanceof Blob&&['image/jpeg','image/png','image/webp'].includes(f.type))&&record.frames.reduce((n,f)=>n+f.size,bytes)<=MAX_SESSION_BYTES){
  let valid=true;for(let i=0;i<record.frames.length;i++)if(await digest(await record.frames[i].arrayBuffer())!==record.frameHashes[i]){valid=false;break;}if(valid)frames=record.frames;
 }
 let video=null;
 if(record.video instanceof Blob&&record.video.type==='video/mp4'&&record.video.size+bytes+frames.reduce((n,f)=>n+f.size,0)<=MAX_SESSION_BYTES&&record.project&&record.videoSha256===await digest(await record.video.arrayBuffer()))video=record.video;
 return {...record,faces:checked.sort((a,b)=>record.ids.indexOf(a.id)-record.ids.indexOf(b.id)),video,frames};
}
export async function rememberSession({ids,faces,settings,project,video,frames=[]},isCurrent=()=>true){
 let store;try{
  const selected=[];let bytes=0;
  for(const face of faces){
   const r=face.result;bytes+=r.blob.size;if(bytes>MAX_SESSION_BYTES){if(!isCurrent())return false;store=await openOriginals();if(isCurrent())await store.put(SESSION,{kind:SESSION,faces:[],ids:[]});return false;}
   selected.push({id:face.id,generationKind:r.generationKind||'latent',result:{blob:r.blob,latent:r.latent,values:r.latent.values,space:'w-plus',imageSha256:r.imageSha256,latentSha256:r.latentSha256,generationSha256:r.generationSha256,generationKind:r.generationKind||'latent',cacheKey:r.cacheKey,provenance:r.provenance,width:1024,height:1024}});
  }
  if(frames.reduce((n,f)=>n+f.size,bytes)>MAX_SESSION_BYTES)frames=[];
  bytes+=frames.reduce((n,f)=>n+f.size,0);
  const frameHashes=[];for(const frame of frames)frameHashes.push(await digest(await frame.arrayBuffer()));
  let savedVideo=null;
  if(video instanceof Blob&&video.type==='video/mp4'&&video.size+bytes<=MAX_SESSION_BYTES){
   let headroom=true;try{const estimate=await navigator.storage.estimate();headroom=Number.isFinite(estimate.quota)&&estimate.quota-(estimate.usage||0)>video.size+bytes+8*1024*1024;}catch{headroom=false;}
   if(headroom)savedVideo=video;
  }
  const record={kind:SESSION,ids:[...ids],faces:selected,settings:{kind:settings.kind,width:settings.width,pinch:settings.pinch,frames:settings.frames,fps:settings.fps},project:project||null,frames,frameHashes,video:savedVideo,videoSha256:savedVideo?await digest(await savedVideo.arrayBuffer()):null};
  if(!isCurrent())return false;store=await openOriginals();if(!isCurrent())return false;
  try{await store.put(SESSION,record);}catch{
   if(!isCurrent())return false;
   await store.put(SESSION,{...record,video:null,videoSha256:null});
  }return true;
 }catch{try{if(isCurrent())await store?.put(SESSION,{kind:SESSION,faces:[],ids:[]});}catch{}return false;}finally{store?.close();}
}
export async function readSession(){let store;try{store=await openOriginals();const record=await store.get(SESSION);if(record)return await validateSession(record)||{kind:SESSION,faces:[],ids:[]};}catch{}finally{store?.close();}return null;}
