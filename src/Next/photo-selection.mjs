import {inspectImage} from './photo/image-header.mjs';
import {CROP_MAX_BYTES,CROP_MAX_EDGE,CROP_MAX_PIXELS,previewPhoto} from './photo/crop.mjs';
/** True when the alignment route can consume these exact bytes without a re-encode. */
function inspectableDirectly(bytes){try{inspectImage(bytes);return true;}catch{return false;}}
const pending=new Map();
export function invalidatePhotoSelections(){pending.clear();}
export function photoFiles(event){const files=Array.from(event.dataTransfer?.files||event.target?.files||[]);if(!event.dataTransfer&&event.target)event.target.value='';return files;}
export function openPhotoPicker(id){document.getElementById(`photo-${id}`)?.click();}
export function dragPhoto(event,busy,leaving=false){event.preventDefault();event.stopPropagation();if(leaving||busy)event.currentTarget.classList.remove('next-photo-over');else event.currentTarget.classList.add('next-photo-over');if(event.dataTransfer)event.dataTransfer.dropEffect=busy?'none':'copy';}
/**
 * Admits a photo for one face. Anything the alignment route can take directly is returned as
 * chosen. Anything larger, or in a container this build cannot inspect up front, is offered to
 * the crop step instead of being refused: the crop is what gets aligned, never the whole
 * original. A cancelled or superseded selection leaves the existing face untouched.
 */
export async function selectPhoto({id,files}){
 const token={};pending.set(id,token);if(!files?.length){pending.delete(id);return null;}
 try{
  if(files.length!==1)throw Error('Choose one photo for this face.');
  const file=files[0];
  if(!(file instanceof Blob)||file.size<8)throw Error('Choose a photo.');
  if(file.size>CROP_MAX_BYTES)throw Error('Choose a photo smaller than 64 MB.');
  // The header still bounds what may be decoded. A photo the alignment route cannot take
  // directly is routed to the crop step; only an unreadable or absurdly large one is refused.
  const bytes=new Uint8Array(await file.arrayBuffer());
  let direct=false;
  try{
   const header=inspectImage(bytes,{maxPixels:CROP_MAX_PIXELS,maxBytes:CROP_MAX_BYTES,maxEdge:CROP_MAX_EDGE,requireEightBit:false});
   direct=header.width*header.height<=4*1024*1024&&inspectableDirectly(bytes);
  }catch(error){
   // An unknown container (HEIC and friends) can still be decoded by the browser for cropping.
   if(error?.code!=='unknown-container')throw error;
   direct=false;
  }
  if(pending.get(id)!==token)return null;
  if(direct){
   const url=URL.createObjectURL(file);try{
    await new Promise((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>finish(Error('This photo could not be read.')),15000);function finish(error){clearTimeout(timer);image.onload=image.onerror=null;image.src='';error?reject(error):resolve();}image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth*image.naturalHeight<=4*1024*1024?null:Error('crop-required'));image.onerror=()=>finish(Error('This photo could not be read.'));image.src=url;});
   }catch(error){if(error?.message!=='crop-required')throw error;direct=false;}
   finally{URL.revokeObjectURL(url);}
  }
  if(pending.get(id)!==token)return null;
  if(direct)return file;
  const preview=await previewPhoto(file);
  return pending.get(id)===token?{crop:true,file,...preview}:(URL.revokeObjectURL(preview.url),null);
 }catch(error){if(pending.get(id)!==token)return null;throw error;}finally{if(pending.get(id)===token)pending.delete(id);}
}
/** Moves focus into the crop square so its keyboard controls are usable on open. */
export function focusCropArea(){requestAnimationFrame(()=>document.querySelector('.next-crop-view')?.focus());}
let previousFocus;
export function openNamesFocus(){previousFocus=document.activeElement;requestAnimationFrame(()=>document.querySelector('.next-name-dialog input')?.focus());}
export function closeNamesFocus(){const target=previousFocus;previousFocus=null;requestAnimationFrame(()=>{if(target?.isConnected)target.focus();});}
export function namesKey(event,close){if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const items=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
