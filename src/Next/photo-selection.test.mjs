import test from 'node:test';import assert from 'node:assert/strict';
import {selectPhoto,photoFiles,invalidatePhotoSelections,dragPhoto,namesKey} from './photo-selection.mjs';
/** Stands in for the browser's bounded decode so the crop route can be exercised here. */
function withDecoder(run,{width=4000,height=3000}={}){
 const saved={bitmap:globalThis.createImageBitmap,canvas:globalThis.OffscreenCanvas,url:globalThis.URL};
 const made=[];
 globalThis.createImageBitmap=async(source,options)=>{const b={width:options?.resizeWidth??source.width??width,height:options?.resizeHeight??source.height??height,close(){b.closed=true;}};made.push(b);return b;};
 globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage(){},save(){},restore(){},translate(){},rotate(){}};}async convertToBlob(){return new Blob([new Uint8Array(64)]);}};
 globalThis.URL={createObjectURL:()=> 'blob:preview',revokeObjectURL(){}};
 return run(made).finally(()=>{globalThis.createImageBitmap=saved.bitmap;globalThis.OffscreenCanvas=saved.canvas;globalThis.URL=saved.url;});
}
const png=(width=10,height=10)=>{const b=new Uint8Array(33),v=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,width);v.setUint32(20,height);b[24]=8;return new Blob([b]);};
test('picker and drop share files; cancel preserves input; rejects multiple and unsupported',async()=>{
 const f=png(),target={files:[f],value:'same-file'};assert.deepEqual(photoFiles({target}),[f]);assert.equal(target.value,'');assert.deepEqual(photoFiles({dataTransfer:{files:[f]}}),[f]);assert.equal(await selectPhoto({id:'x',files:[]}),null);await assert.rejects(selectPhoto({id:'x',files:[f,f]}),/one photo/);await assert.rejects(selectPhoto({id:'x',files:[new Blob(['not an image'])]}),/could not be read|cannot prepare/);
});
test('decoded selection, unreadable file, superseded selection and busy invalidation',async()=>{
 const old=globalThis.Image;const images=[];globalThis.Image=class{naturalWidth=10;naturalHeight=10;constructor(){images.push(this);}set src(v){this.url=v;}};
 try{const f=png();let p=selectPhoto({id:'x',files:[f]});await new Promise(r=>setTimeout(r,0));images.at(-1).onload();assert.equal(await p,f);
 p=selectPhoto({id:'x',files:[f]});await new Promise(r=>setTimeout(r,0));images.at(-1).onerror();await assert.rejects(p,/could not be read/);
 p=selectPhoto({id:'x',files:[f]});await new Promise(r=>setTimeout(r,0));invalidatePhotoSelections();images.at(-1).onload();assert.equal(await p,null);
 p=selectPhoto({id:'x',files:[f]});await new Promise(r=>setTimeout(r,0));await selectPhoto({id:'x',files:[]});images.at(-1).onload();assert.equal(await p,null);
 }finally{globalThis.Image=old;}
});
test('busy drop prevents navigation and highlight, dialog Escape closes',()=>{let prevented=0,closed=0;const classes=new Set();const e={preventDefault(){prevented++},stopPropagation(){},currentTarget:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}},dataTransfer:{}};dragPhoto(e,false);assert(classes.has('next-photo-over'));dragPhoto(e,true);assert.equal(classes.size,0);assert.equal(e.dataTransfer.dropEffect,'none');assert.equal(prevented,2);namesKey({key:'Escape',preventDefault(){}},()=>closed++);assert.equal(closed,1);});

test('an oversized photo goes to the crop step instead of a full-size decode',async()=>{
 const old=globalThis.Image;globalThis.Image=class{constructor(){throw Error('must not decode');}};
 try{
  const offer=await withDecoder(async made=>{
   const result=await selectPhoto({id:'large',files:[png(4000,3000)]});
   assert.equal(made.some(b=>b.width===4000&&b.height===3000&&!b.closed),false,'The full-size probe is released');
   return result;
  });
  assert.equal(offer.crop,true);
  assert.equal(offer.sourceWidth,4000);assert.equal(offer.sourceHeight,3000);
  assert.equal(offer.previewWidth<=4096&&offer.previewHeight<=4096,true,'The preview is bounded');
  assert.equal(offer.url,'blob:preview');
 }finally{globalThis.Image=old;}
});
test('a photo beyond the pre-decode bound is refused without decoding it',async()=>{
 const old=globalThis.Image;globalThis.Image=class{constructor(){throw Error('must not decode');}};
 try{await withDecoder(async made=>{
  await assert.rejects(selectPhoto({id:'huge',files:[png(19000,19000)]}),/too large/);
  assert.equal(made.length,0,'No decode is attempted past the header bound');
 });}finally{globalThis.Image=old;}
});
test('names dialog Tab wraps in both directions',()=>{const old=globalThis.document;let focus='';const first={focus(){focus='first'}},last={focus(){focus='last'}};globalThis.document={activeElement:last};let prevented=0;const e={key:'Tab',shiftKey:false,preventDefault(){prevented++},currentTarget:{querySelectorAll(){return[first,last]}}};try{namesKey(e,()=>{});assert.equal(focus,'first');document.activeElement=first;e.shiftKey=true;namesKey(e,()=>{});assert.equal(focus,'last');assert.equal(prevented,2);}finally{globalThis.document=old;}});
