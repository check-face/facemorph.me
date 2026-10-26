import {createImageEncoder} from './image-encoder.mjs';
import {embedRecovery} from './image-envelope.mjs';
import {WEBP_QUALITY} from '../media/export-policy.ts';
import {videoFileResult} from '@facemorph/stylegan-js';
import {readProjectMp4,readStill,writeProjectMp4} from '../media/recovery-files.ts';
// Recovery in saved files under the bridge's export names (fm-fy2.7). The envelopes and the MP4 project are the
// package's schema core (fm-fzzd) through src/media/recovery-files.ts: stills are written as schema 3 and read as
// schema 3, 2 or the candidate's schema 1; a saved MP4 carries a schema-2 project and the candidate's schema-1
// project MP4 still reads. Damaged or unknown-schema files are typed RecoveryFileError (the bridge shows one plain
// message with the reader's reason as its cause).
const MAX_STILL=64*1024*1024,MAX_VIDEO=512*1024*1024;
const bytesOf=async blob=>new Uint8Array(await blob.arrayBuffer());
const seedOf=seed=>seed===undefined||seed===null||seed===''?undefined:Number(seed);
/** The still as given (PNG or WebP) with its envelope: the fallback when the WebP worker is unavailable. */
export async function decorateImage(result,seed){return (await embedRecovery(result.blob,result,{seed:seedOf(seed)})).blob;}
export async function recoverImage(file){
 if(!(file instanceof Blob)||file.size>MAX_STILL)return null;
 const r=readStill(await bytesOf(file));if(!r)return null;
 return {blob:new Blob([r.image],{type:r.mime}),latent:r.latent,provenance:r.provenance,imageSha256:r.imageSha256,latentSha256:r.latentSha256,
  seed:r.seed,generationKind:r.generationKind,generationSha256:r.generationSha256,schemaVersion:r.schemaVersion,model:r.model,...(r.blend?{blend:r.blend}:{})};
}

/** The MP4 with a schema-2 project; `choice` is the video writer's encoder choice (export-policy) when known. */
export async function decorateVideo(blob,project,choice){
 if(!(blob instanceof Blob))throw Error('Create a morph first.');if(!project)return blob;
 if(blob.size>MAX_VIDEO)throw Error('Project recovery metadata exceeds its limit.');
 return new Blob([writeProjectMp4(await bytesOf(blob),project,choice?videoFileResult(choice,choice.targetSize??1024):undefined)],{type:'video/mp4'});
}
/** A saved MP4's project as the app's project JSON text, or null for a file that is not a project MP4. */
export async function recoverVideoProject(file){
 if(!(file instanceof Blob)||file.size>MAX_VIDEO)return null;
 const head=new Uint8Array(await file.slice(0,12).arrayBuffer());if(String.fromCharCode(...head.subarray(4,8))!=='ftyp')return null;
 return readProjectMp4(await bytesOf(file))?.text??null;
}

// New WebP originals are reused directly; legacy PNG originals remain readable.
// Encoding and compact metadata stay in a bounded worker; WebP absence keeps PNG recovery.
// `format` 'png' is the lossless still: from `rgba` (the face's synthesized pixels, while the tab still holds
// them) or else from the decoded original, so the PNG is exactly the pixels it was prepared from.
export async function downloadImage(result,seed,{format='webp',rgba}={}){
 if(format==='webp'&&result.blob.type==='image/webp')return (await embedRecovery(result.blob,result,{seed:seedOf(seed)})).blob;
 const encoder=createImageEncoder();
 try{
  const slot=await encoder.acquire(1024*1024*4);
  // A displayed face also carries UI state and deferred file/download promises.
  // Only the recovery identity belongs across the worker boundary.
  const identity={latent:result.latent,provenance:result.provenance,generationKind:result.generationKind,generationSha256:result.generationSha256};
  const recovery={result:identity,seed:seedOf(seed)};
  const output=await encoder.encode(slot,format==='png'?(rgba?{rgba,format:'png',recovery}:{blob:result.blob,format:'png',recovery}):{blob:result.blob,format:'webp',quality:WEBP_QUALITY,recovery});
  return output.blob;
 }catch(error){
  if(result.blob.type==='image/png')return decorateImage(result,seed);
  return (await embedRecovery(result.blob,result,{seed:seedOf(seed)})).blob;
 }finally{encoder.dispose();}
}
