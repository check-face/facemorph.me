import test from 'node:test';import assert from 'node:assert/strict';
import {selectPhoto,photoFiles,invalidatePhotoSelections,dragPhoto,namesKey} from './photo-selection.mjs';
const png=(width=10,height=10)=>{const b=new Uint8Array(33),v=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,width);v.setUint32(20,height);b[24]=8;return new Blob([b]);};
test('picker and drop share files; cancel preserves input; rejects multiple and unsupported',async()=>{
 const f=png(),target={files:[f],value:'same-file'};assert.deepEqual(photoFiles({target}),[f]);assert.equal(target.value,'');assert.deepEqual(photoFiles({dataTransfer:{files:[f]}}),[f]);assert.equal(await selectPhoto({id:'x',files:[]}),null);await assert.rejects(selectPhoto({id:'x',files:[f,f]}),/one photo/);await assert.rejects(selectPhoto({id:'x',files:[new Blob(['not an image'])]}),/PNG or JPEG/);
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

test('oversized header is rejected before any decoder allocation',async()=>{const old=globalThis.Image;globalThis.Image=class{constructor(){throw Error('must not decode');}};try{await assert.rejects(selectPhoto({id:'large',files:[png(4000,3000)]}),/4 megapixels/);}finally{globalThis.Image=old;}});
test('names dialog Tab wraps in both directions',()=>{const old=globalThis.document;let focus='';const first={focus(){focus='first'}},last={focus(){focus='last'}};globalThis.document={activeElement:last};let prevented=0;const e={key:'Tab',shiftKey:false,preventDefault(){prevented++},currentTarget:{querySelectorAll(){return[first,last]}}};try{namesKey(e,()=>{});assert.equal(focus,'first');document.activeElement=first;e.shiftKey=true;namesKey(e,()=>{});assert.equal(focus,'last');assert.equal(prevented,2);}finally{globalThis.document=old;}});
