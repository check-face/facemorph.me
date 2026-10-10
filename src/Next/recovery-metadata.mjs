import {createImageEncoder} from './image-encoder.mjs';
import {recoverEnvelope,embedRecovery} from './image-envelope.mjs';
import {digest} from './browser/originals.mjs';
import {validateLast} from './last-result.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder(),KEY='FaceMorph';
const signature=[137,80,78,71,13,10,26,10],MAX=512*1024;
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunks(bytes){if(bytes.length<20||!signature.every((v,i)=>bytes[i]===v))return null;const result=[];const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let at=8;at+12<=bytes.length;){const size=view.getUint32(at);if(size>bytes.length-at-12)return null;const type=decoder.decode(bytes.subarray(at+4,at+8));result.push({at,size,type,data:bytes.subarray(at+8,at+8+size),end:at+12+size});at+=12+size;if(type==='IEND')return at===bytes.length?result:null;}return null;}
function own(chunk){return chunk.type==='tEXt'&&decoder.decode(chunk.data.subarray(0,KEY.length+1))===KEY+'\0';}
export async function decorateImage(result,seed){
 const bytes=new Uint8Array(await result.blob.arrayBuffer()),parts=chunks(bytes);if(!parts)return result.blob;
 const payload=encoder.encode(KEY+'\0'+JSON.stringify({schema:1,kind:'facemorph-image-v1',...(seed!==undefined?{seed}:{}),latent:{space:result.latent.space,shape:[18,512],values:Array.from(result.latent.values)},provenance:result.provenance,generationKind:result.generationKind,generationSha256:result.generationSha256,imageSha256:result.imageSha256||await digest(bytes),latentSha256:result.latentSha256||await digest(new Float32Array(result.latent.values))}));
 if(payload.length>MAX)throw Error('Image recovery metadata exceeds its limit.');
 const chunk=new Uint8Array(payload.length+12),view=new DataView(chunk.buffer);view.setUint32(0,payload.length);chunk.set(encoder.encode('tEXt'),4);chunk.set(payload,8);view.setUint32(payload.length+8,crc(chunk.subarray(4,payload.length+8)));
 const iend=parts.at(-1).at;return new Blob([bytes.subarray(0,iend),chunk,bytes.subarray(iend)],{type:'image/png'});
}
export async function recoverImage(file){
 if(!(file instanceof Blob)||file.size>64*1024*1024)return null;
 const v2=await recoverEnvelope(file);if(v2&&!v2.legacy)return v2;
 const bytes=new Uint8Array(await file.arrayBuffer()),parts=chunks(bytes);if(!parts)return null;
 const metadata=parts.filter(own);if(!metadata.length)return null;
 if(metadata.length!==1||metadata[0].size>MAX)throw Error('Invalid FaceMorph recovery metadata.');
 const chunk=metadata[0],view=new DataView(bytes.buffer);if(crc(bytes.subarray(chunk.at+4,chunk.end-4))!==view.getUint32(chunk.end-4))throw Error('Damaged FaceMorph recovery metadata.');
 let record;try{record=JSON.parse(decoder.decode(chunk.data.subarray(KEY.length+1)));}catch{throw Error('Unreadable FaceMorph recovery metadata.');}
 if(record.schema!==1||record.kind!=='facemorph-image-v1')throw Error('Unsupported FaceMorph recovery metadata.');
 const blob=new Blob([bytes.subarray(0,chunk.at),bytes.subarray(chunk.end)],{type:'image/png'});
 const validated=await validateLast({kind:'last-generated-result-v1',result:{blob,latent:record.latent,provenance:record.provenance,imageSha256:record.imageSha256,latentSha256:record.latentSha256}});
 if(!validated)throw Error('FaceMorph image or latent failed its integrity check.');
 return {...validated.result,seed:record.seed,generationKind:record.generationKind,generationSha256:record.generationSha256};
}

const PROJECT_KEY=encoder.encode('FaceMorphProject');
export async function decorateVideo(blob,project){
 if(!(blob instanceof Blob))throw Error('Create a morph first.');if(!project)return blob;const payload=encoder.encode(JSON.stringify(project));if(payload.length>16*1024*1024)throw Error('Project recovery metadata exceeds its limit.');
 const box=new Uint8Array(24+payload.length),view=new DataView(box.buffer);view.setUint32(0,box.length);box.set(encoder.encode('uuid'),4);box.set(PROJECT_KEY,8);box.set(payload,24);
 return new Blob([blob,box],{type:'video/mp4'});
}
export async function recoverVideoProject(file){
 if(!(file instanceof Blob)||file.size>512*1024*1024)return null;
 const first=new Uint8Array(await file.slice(0,12).arrayBuffer());if(decoder.decode(first.subarray(4,8))!=='ftyp')return null;
 let boxes=0;for(let at=0;at+8<=file.size;){
  if(++boxes>10000)throw Error('Video container has too many boxes.');
  const header=new Uint8Array(await file.slice(at,at+24).arrayBuffer()),view=new DataView(header.buffer);
  let size=view.getUint32(0);const type=decoder.decode(header.subarray(4,8));
  if(size===1){if(header.length<16)return null;size=Number(view.getBigUint64(8));}
  if(size===0)size=file.size-at;
  if(!Number.isSafeInteger(size)||size<8||at+size>file.size)return null;
  if(type==='uuid'&&size>=24&&PROJECT_KEY.every((v,i)=>header[i+8]===v)){
   if(size-24>16*1024*1024)throw Error('Project recovery metadata exceeds its limit.');
   return await file.slice(at+24,at+size).text();
  }
  at+=size;
 }
 return null;
}

// Download quality is deliberately independent of the exact canonical PNG cache.
// Encoding and compact metadata stay in a bounded worker; WebP absence keeps PNG recovery.
export async function downloadImage(result,seed){
 const encoder=createImageEncoder();
 try{
  const slot=await encoder.acquire(1024*1024*4);
  // A displayed face also carries UI state and deferred file/download promises.
  // Only the recovery identity belongs across the worker boundary.
  const identity={latent:result.latent,provenance:result.provenance,generationKind:result.generationKind,generationSha256:result.generationSha256};
  const output=await encoder.encode(slot,{blob:result.blob,format:'webp',quality:.8,recovery:{result:identity,seed:seed===undefined?undefined:Number(seed)}});
  return output.blob;
 }catch(error){
  if(result.blob.type==='image/png')return decorateImage(result,seed);
  return (await embedRecovery(result.blob,result,{seed:seed===undefined?undefined:Number(seed)})).blob;
 }finally{encoder.dispose();}
}
