// Still recovery envelopes for the app's Blob callers (the image encoder worker, the names tools), kept under the
// export names the candidate's image-envelope.mjs had. The envelope itself is the package's (fm-fzzd,
// stylegan-js media/envelope.ts) through apps/web/src/media/recovery-stills.ts (fm-fy2.7, fm-s0vi): a face of a
// model this app ships is written as schema 3 (generator record and W+ shape from its descriptor); any other
// identity keeps the schema-2 record, which needs no descriptor. Reading accepts schema 3 and 2; schema 1 is
// reported as legacy for recovery-metadata.mjs. The rules the candidate enforced here stay: a full 1024 x 1024
// face, no second envelope, finite latent, valid identity, only the allowed provenance keys.
import {embedRecovery as embedV2,parseRecoveryMetadata,stillContainer} from 'stylegan-js';
import {descriptorFor,readStill,writeStill} from '../media/recovery-stills.ts';
const MAX_FILE=64*1024*1024;
const bytesOf=async blob=>new Uint8Array(await blob.arrayBuffer());
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
function container(bytes){
 try{return stillContainer(bytes);}catch(error){throw Error(`Invalid recovery image (${error?.message||'container'}; length or chunk).`);}
}
export async function embedRecovery(blob,result,{seed}={}){
 if(!(blob instanceof Blob)||blob.size>MAX_FILE)throw Error('Recovery image exceeds its size limit.');
 const bytes=await bytesOf(blob),parsed=container(bytes);
 if(!parsed||blob.type!==parsed.mime)throw Error('Unsupported recovery image.');
 if(parsed.width!==1024||parsed.height!==1024)throw Error('Recovery requires a full1024 face.');
 if(parsed.hasEnvelope)throw Error('Image already has recovery metadata.');
 const values=result.latent?.values||result.values;
 if(values?.length!==18*512||!Array.prototype.every.call(values,Number.isFinite))throw Error('Invalid recovery latent.');
 const face={latent:{space:'w-plus',shape:[18,512],values:Float32Array.from(values)},provenance:{...result.provenance},generationKind:result.generationKind,generationSha256:result.generationSha256};
 if(!['seed','photo','latent'].includes(face.generationKind)||!/^[a-f0-9]{64}$/.test(face.generationSha256||''))throw Error('Invalid recovery generation identity.');
 const out=descriptorFor(face.provenance.modelSha256,face.provenance.noiseSha256)
  ?writeStill(bytes,face,{seed})
  :embedV2(bytes,{...face,...(seed===undefined?{}:{seed})});
 // The hashes the envelope records: the image as given (it had no envelope) and the float32 little-endian latent.
 const [baseImageSha256,latentSha256]=await Promise.all([digest(bytes),digest(new Uint8Array(face.latent.values.buffer))]);
 return {blob:new Blob([out],{type:parsed.mime}),baseImageSha256,latentSha256,metadataBytes:out.length-bytes.length};
}
export async function recoverEnvelope(blob){
 if(!(blob instanceof Blob)||blob.size>MAX_FILE)return null;
 const bytes=await bytesOf(blob),parsed=container(bytes);if(!parsed||!parsed.hasEnvelope)return null;
 // Schema 1 is recovery-metadata.mjs's to read (and to judge): report it before validating anything here.
 const claimed=parseRecoveryMetadata(bytes);if(claimed.kind==='incompatible-schema'&&claimed.schemaVersion===1)return {legacy:true};
 let r;try{r=readStill(bytes);}catch(error){throw Error(`${error.message} (${error.detail||'unreadable'})`,{cause:error});}
 if(!r)return null;
 return {blob:new Blob([r.image],{type:r.mime}),latent:r.latent,provenance:r.provenance,generationKind:r.generationKind,generationSha256:r.generationSha256,imageSha256:r.imageSha256,latentSha256:r.latentSha256,seed:r.seed,schemaVersion:r.schemaVersion,model:r.model,...(r.blend?{blend:r.blend}:{})};
}
