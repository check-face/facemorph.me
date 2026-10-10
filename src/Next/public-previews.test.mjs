import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {galleryTextUrl,gallerySeedUrl,previewUrl,publicPreview,publicNameLatent} from './public-previews.mjs';
import {generationIdentity} from './browser/identity.mjs';

const origin='https://gallery.example';
const hash='a'.repeat(64);
const catalogue={origin,names:[{value:'alice',id:hash,full:'webp'}],seeds:{from:0,to:999,dimension:1024,format:'webp'}};

test('only published public identities get a hosted preview',()=>{
 assert.equal(previewUrl(catalogue,'text','alice'),galleryTextUrl(origin,hash,1024,'webp'));
 assert.equal(previewUrl(catalogue,'seed','389'),gallerySeedUrl(origin,389,1024,'webp'));
 for(const [mode,value] of [['text','private words'],['text','Alice'],['seed','1000'],['seed','-1'],['photo','alice']])
  assert.equal(previewUrl(catalogue,mode,value),'');
});

test('published full assets retain name identity and verified W+ is fetched only on request',async t=>{
 const value='alice',id=createHash('sha256').update(value).digest('hex');
 const bytes=new Uint8Array(36864),manifest={modelSourceSha256:'model',synthesis:{sha256:'s'},mapping:{sha256:'m'},average:{sha256:'a'},noise:[]};
 const row={value,id,fullAsset:{url:`https://facemorph-name-catalogue.cdilga.workers.dev/full/${id}.jpg`,size:100,sha256:'a'.repeat(64)},latent:{url:`https://facemorph-name-catalogue.cdilga.workers.dev/latent/${id}.f32`,size:36864,sha256:createHash('sha256').update(bytes).digest('hex'),space:'w-plus',shape:[18,512],modelSha256:'model',generationSha256:createHash('sha256').update(JSON.stringify(generationIdentity(manifest,'seed'))).digest('hex')}};
 const data={origin,names:[row]};let requests=[],corrupt=false;
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
 globalThis.fetch=async url=>{requests.push(url);return url==='/catalogue.json'?{ok:true,json:async()=>data}:{ok:true,arrayBuffer:async()=>corrupt?new Uint8Array(36864).fill(1).buffer:bytes.buffer};};
 assert.equal(previewUrl(data,'text',value),row.fullAsset.url);assert.deepEqual(requests,[]);
 const latent=await publicNameLatent(value,manifest);assert.equal(latent.values.length,9216);assert.deepEqual(latent.shape,[1,18,512]);
 assert.equal(await publicNameLatent('private words',manifest),null);assert.equal(requests.length,2);
 corrupt=true;await assert.rejects(publicNameLatent(value,manifest),/integrity/);
 await assert.rejects(publicNameLatent(value,{...manifest,modelSourceSha256:'different'}),/identity/);
 row.fullAsset.url='https://unreviewed.example/photo.jpg';assert.throws(()=>previewUrl(data,'text',value),/origin or identity/);
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
