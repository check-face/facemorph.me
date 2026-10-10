import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {galleryTextUrl,gallerySeedUrl,previewUrl,publicPreview} from './public-previews.mjs';

const origin='https://gallery.example';
const hash='a'.repeat(64);
const catalogue={origin,names:[{value:'alice',id:hash,full:'webp'}],seeds:{from:0,to:999,dimension:1024,format:'webp'}};

test('only published public identities get a hosted preview',()=>{
 assert.equal(previewUrl(catalogue,'text','alice'),galleryTextUrl(origin,hash,1024,'webp'));
 assert.equal(previewUrl(catalogue,'seed','389'),gallerySeedUrl(origin,389,1024,'webp'));
 for(const [mode,value] of [['text','private words'],['text','Alice'],['seed','1000'],['seed','-1'],['photo','alice']])
  assert.equal(previewUrl(catalogue,mode,value),'');
});

test('the historic hello face is a pinned site asset, even though it was omitted from the names selection',async t=>{
 const bytes=await readFile(new URL('../public/preview/hello-1024.webp',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615');
 assert.equal(previewUrl(null,'text','hello'),'/preview/hello-1024.webp');
 const oldImage=globalThis.Image,oldFetch=globalThis.fetch;
 t.after(()=>{if(oldImage===undefined)delete globalThis.Image;else globalThis.Image=oldImage;if(oldFetch===undefined)delete globalThis.fetch;else globalThis.fetch=oldFetch;});
 globalThis.fetch=()=>{throw Error('hello preview must not fetch the catalogue or models');};
 globalThis.Image=class {set src(value){this.onload?.();}};
 assert.equal(await publicPreview('text','hello'),'/preview/hello-1024.webp');
});
