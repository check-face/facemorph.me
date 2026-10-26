// The app's prepared export files (fm-eeki): what Save and Share hand over, wired onto the computational
// media core. The format and its encoder options come only from the export policy (media/export-policy.ts),
// the bytes are kept by the prepared-file store (media/prepared-files.ts, keyed by result revision, format
// and options, bounded by the contracts' PREPARED_FILE_CACHE_MAX_BYTES ceiling) and the filename by the
// session's export names (media/export-names.ts). Repeating Save or Share of one result hands over the same
// file under the same name without encoding again; a replaced result never receives an older one's file.
// The Save/Share gestures themselves stay in media.mjs.
import {CEILINGS} from '../contracts/ceilings.ts';
import {preparedFileCacheMaxBytes} from '../contracts/prepared-file-cache.ts';
import {stillSettings} from '../media/export-policy.ts';
import {preparedFiles} from '../media/prepared-files.ts';
import {exportNamer,faceLabel,morphExport,morphLabel,stillExport,retainedExportDigests} from '../media/export-names.ts';

const ceiling=CEILINGS.find(c=>c.name==='PREPARED_FILE_CACHE_MAX_BYTES');
if(!ceiling)throw Error('The prepared-file ceiling is missing from the contracts.');
export const PREPARED_FILE_MAX_BYTES=preparedFileCacheMaxBytes(ceiling.value);

const superseded=()=>new DOMException('Input changed. The old result was discarded.','AbortError');
const optionsOf=settings=>settings.quality===undefined?{}:{quality:settings.quality};
const fileName=file=>file&&typeof file.name==='string'?file.name:undefined;
/** Plain facts about one face for its export identity: no Blob, no label copied anywhere else. */
export function faceFacts(face,modelIdentity){
 const values=face?.latent?.values;
 return {source:face?.source?{mode:face.source.mode,value:face.source.value,fileName:fileName(face.source.file)}:undefined,
  latentSha256:face?.latentSha256,latentValues:values instanceof Float32Array?values:values?Float32Array.from(values):undefined,
  modelIdentity:face?.provenance?.modelSha256||modelIdentity||'unknown'};
}

/**
 * One session's export files. `revisionOf` must give a new number whenever a target's result is replaced;
 * the result object itself is used when none is given.
 */
export function createExportFiles({maxBytes=PREPARED_FILE_MAX_BYTES}={}){
 const names=exportNamer(),stores=new Map(),revisions=new WeakMap(),blobs=new WeakMap(),identities=new WeakMap();let serial=0,webpEncodes=true,encodes=0;
 const revisionFor=result=>{let r=revisions.get(result);if(r===undefined){r=++serial;revisions.set(result,r);}return r;};
 const storeFor=(target,result)=>{const revision=revisionFor(result);let store=stores.get(target);if(!store){store=preparedFiles(maxBytes,revision);stores.set(target,store);}else store.setRevision(revision);return store;};
 const bytesOf=async blob=>{encodes++;return new Uint8Array(await blob.arrayBuffer());};
 const blobOf=file=>{let blob=blobs.get(file);if(!blob){blob=new Blob([file.bytes],{type:file.mime});blobs.set(file,blob);}return blob;};
 const expose=(file,named)=>{const blob=blobOf(file);identities.set(blob,named.identity);return {blob,filename:named.filename,mime:file.mime,digest:named.digest};};
 const ready=(outcome,current)=>{
  if(outcome.status==='stale'||!current())throw superseded();
  if(outcome.status!=='ready')throw Error('The file could not be prepared. Your result is still here; try again.');
  return outcome.file;
 };
 return {
  /**
   * The still for a face: WebP at the policy quality, PNG where this browser does not encode WebP, or PNG
   * when `format` is 'png' (the explicit lossless choice). `encode(format)` returns the decorated file's Blob
   * for that format; it runs only when no prepared file exists for it, so a format switch prepares only it.
   */
  async face(target,face,{encode,format,modelIdentity,current=()=>true}){
   if(format!==undefined&&format!=='webp'&&format!=='png')throw Error('Choose WebP or PNG.');
   const store=storeFor(target,face),revision=store.currentRevision();
   let settings=stillSettings({webpEncodes,lossless:format==='png'}),encoded;
   const once=async()=>(encoded??=await encode(settings.format));
   let outcome=await store.prepare(settings.format,optionsOf(settings),async()=>bytesOf(await once()),{pin:true,revision});
   if(outcome.status==='type-mismatch'&&settings.format==='webp'&&(await once()).type==='image/png'){
    // This browser fell back to PNG: that is the file, under PNG's name and type.
    webpEncodes=false;settings=stillSettings({webpEncodes});
    outcome=await store.prepare(settings.format,optionsOf(settings),async()=>bytesOf(await once()),{pin:true,revision});
   }
   const file=ready(outcome,current);
   const facts=faceFacts(face,modelIdentity),named=names.name(stillExport(facts,file.format,optionsOf(settings)),faceLabel(facts.source),retainedExportDigests(face.exportDigests)[file.format]);
   return expose(file,named);
  },
  /** The morph video: the encoded MP4 with its project box; `faces` are the morph's endpoint faces in order. */
  async video(video,{encode,morph,faces,modelIdentity,retainedDigest,current=()=>true}){
   const store=storeFor('video',video),revision=store.currentRevision(),options={fps:morph?.settings?.framesPerSecond??null};
   const file=ready(await store.prepare('mp4',options,async()=>bytesOf(await encode()),{pin:true,revision}),current);
   const facts=faces.map(face=>faceFacts(face,modelIdentity)),mode=String(morph?.mode||'morph');
   const named=names.name(morphExport(facts,{mode,settings:morph?.settings??null},modelIdentity||'unknown',options),morphLabel(facts,mode),retainedDigest);
   return expose(file,named);
  },
  /** Rename only the label; keep the real format, exact bytes and identity suffix. */
  rename(file,editedName){
   const identity=identities.get(file?.blob);if(!identity||identity.digest!==file.digest)throw Error('Prepare this file before renaming it.');
   const named=names.rename(identity,String(editedName));identities.set(file.blob,named.identity);
   return {...file,filename:named.filename,mime:named.mime,digest:named.digest};
  },
  /** Forget a replaced or removed target's files at once. */
  drop(target){stores.delete(target);},
  /** How many files were encoded into the store this session: a repeat Save or Share adds none. */
  stats:()=>({encodes,known:names.known().length,webpEncodes}),
 };
}
