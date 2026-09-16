import {inspectImage} from './photo/image-header.mjs';
const pending=new Map();
export function invalidatePhotoSelections(){pending.clear();}
export function photoFiles(event){const files=Array.from(event.dataTransfer?.files||event.target?.files||[]);if(!event.dataTransfer&&event.target)event.target.value='';return files;}
export function openPhotoPicker(id){document.getElementById(`photo-${id}`)?.click();}
export function dragPhoto(event,busy,leaving=false){event.preventDefault();event.stopPropagation();if(leaving||busy)event.currentTarget.classList.remove('next-photo-over');else event.currentTarget.classList.add('next-photo-over');if(event.dataTransfer)event.dataTransfer.dropEffect=busy?'none':'copy';}
export async function selectPhoto({id,files}){
 const token={};pending.set(id,token);if(!files?.length){pending.delete(id);return null;}
 try{
  if(files.length!==1)throw Error('Choose one photo for this face.');
  const file=files[0];if(!(file instanceof Blob)||file.size<8||file.size>25*1024*1024)throw Error('Choose a PNG or JPEG smaller than 25 MB.');
  inspectImage(new Uint8Array(await file.arrayBuffer()));
  if(pending.get(id)!==token)return null;
  const url=URL.createObjectURL(file);try{
   await new Promise((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>finish(Error('This photo could not be read.')),15000);function finish(error){clearTimeout(timer);image.onload=image.onerror=null;image.src='';error?reject(error):resolve();}image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth*image.naturalHeight<=4*1024*1024?null:Error('Choose a photo with at most 4 megapixels.'));image.onerror=()=>finish(Error('This photo could not be read.'));image.src=url;});
  }finally{URL.revokeObjectURL(url);}
  return pending.get(id)===token?file:null;
 }catch(error){if(pending.get(id)!==token)return null;throw error;}finally{if(pending.get(id)===token)pending.delete(id);}
}
let previousFocus;
export function openNamesFocus(){previousFocus=document.activeElement;requestAnimationFrame(()=>document.querySelector('.next-name-dialog input')?.focus());}
export function closeNamesFocus(){const target=previousFocus;previousFocus=null;requestAnimationFrame(()=>{if(target?.isConnected)target.focus();});}
export function namesKey(event,close){if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const items=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
