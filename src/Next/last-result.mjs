import {openOriginals,digest} from './browser/originals.mjs';
const KEY='last-generated-result-v1';
export async function validateLast(record){
 if(record?.kind!==KEY||!(record.result?.blob instanceof Blob)||record.result.blob.type!=='image/png')return null;
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
