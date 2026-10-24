import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {validateLast,rememberLast,readLast} from './last-result.mjs';import {digest} from './browser/originals.mjs';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
test('restore validates image and latent hashes and rejects corrupt or incompatible results',async()=>{
 const blob=new Blob(['image'],{type:'image/png'}),values=new Float32Array(18*512);
 const result={blob,latent:{space:'w-plus',values},imageSha256:await digest(await blob.arrayBuffer()),latentSha256:await digest(values),provenance:{modelSha256:'model',noiseSha256:'noise'}};
 const record={kind:'last-generated-result-v1',result,settings:{kind:'full-smooth-figure8',width:.2,pinch:true,frames:16,fps:16}};
 assert.equal((await validateLast(record)).result.latent.values.length,9216);
 assert.equal(await validateLast({...record,result:{...result,imageSha256:'bad'}}),null);
 assert.equal(await validateLast({...record,result:{...result,latent:{space:'w',values}}}),null);
 assert.equal(await validateLast(null),null);
});
test('unavailable device storage gracefully skips save and restore',async()=>{
 assert.equal(await readLast(),null);assert.equal(await rememberLast({imageSha256:'x',latentSha256:'y'},{}),false);
});

test('session validates compressed faces, order and video integrity independently of latent pixels',async()=>{
 const {validateSession}=await import('./last-result.mjs');
 const values=new Float32Array(9216),blob=new Blob(['compressed'],{type:'image/webp'});
 const result={blob,latent:{space:'w-plus',values},imageSha256:await digest(await blob.arrayBuffer()),latentSha256:await digest(values),generationSha256:'a'.repeat(64),provenance:{modelSha256:'model',noiseSha256:'noise'}};
 const video=new Blob(['video'],{type:'video/mp4'}),frame=new Blob(['frame'],{type:'image/jpeg'});
 const record={kind:'last-generated-session-v2',ids:['second','first'],faces:[{id:'first',generationKind:'seed',result},{id:'second',generationKind:'seed',result}],settings:{kind:'full-smooth-figure8',width:.2,pinch:true,frames:16,fps:16},project:{},frames:[frame],frameHashes:[await digest(await frame.arrayBuffer())],video,videoSha256:await digest(await video.arrayBuffer())};
 const valid=await validateSession(record);assert.deepEqual(valid.faces.map(f=>f.id),['second','first']);assert.equal(valid.video,video);assert.equal(valid.frames[0],frame);assert.equal((await validateSession({...record,frameHashes:['bad']})).frames.length,0);
 assert.equal((await validateSession({...record,videoSha256:'bad'})).video,null,'Corrupt video does not lose valid faces');
 assert.equal(await validateSession({...record,ids:['first','first']}),null);
 assert.equal(await validateSession({...record,faces:[{...record.faces[0],result:{...result,imageSha256:'bad'}}]}),null);
});
test('slider preference and position survive reload and unavailable local storage',async()=>{
 const {sliderPreference,sliderPosition,rememberSlider}=await import('./last-result.mjs');const old=globalThis.localStorage,stored=new Map();
 globalThis.localStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 try{rememberSlider(true,7);assert.equal(sliderPreference(),true);assert.equal(sliderPosition(),7);rememberSlider(false,3);assert.equal(sliderPreference(),false);assert.equal(sliderPosition(),3);globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};rememberSlider(true,5);assert.equal(sliderPreference(),false);assert.equal(sliderPosition(),1);}finally{globalThis.localStorage=old;}
});

test('session persistence skips a video without headroom, retries quota failure, and ignores superseded writes',async()=>{
 const vm=await import('node:vm'),{readFile}=await import('node:fs/promises');
 const source=(await readFile(new URL('./last-result.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/m,'').replaceAll('export ','');
 const records=new Map();let quota=100*1024*1024,refuseVideo=false;
 const ctx=vm.createContext({Blob,Float32Array,ArrayBuffer,digest,navigator:{storage:{estimate:async()=>({quota,usage:0})}},openOriginals:async()=>({get:async k=>records.get(k),put:async(k,v)=>{if(refuseVideo&&v.video)throw Error('quota');records.set(k,v);},close(){}})});
 vm.runInContext(source+'\nglobalThis.api={rememberSession,readSession};',ctx);
 const values=new Float32Array(9216),blob=new Blob(['face'],{type:'image/webp'}),result={blob,latent:{space:'w-plus',values},imageSha256:await digest(await blob.arrayBuffer()),latentSha256:await digest(values),generationSha256:'a'.repeat(64),generationKind:'seed',provenance:{modelSha256:'model',noiseSha256:'noise'},source:{file:new Blob(['private']),value:'private input'}};
 const request={ids:['one','two'],faces:[{id:'one',result},{id:'two',result}],settings:{kind:'full-smooth-figure8',width:.2,pinch:true,frames:16,fps:16},project:{},video:new Blob(['video'],{type:'video/mp4'})};
 assert.equal(await ctx.api.rememberSession(request,()=>false),false);assert.equal(records.size,0);
 assert.equal(await ctx.api.rememberSession(request),true);const saved=await ctx.api.readSession();assert.equal(saved.faces.length,2);assert.equal(saved.video.size,5);assert.equal(saved.faces[0].result.source,undefined,'Source words/photos are not retained');
 quota=0;await ctx.api.rememberSession(request);assert.equal((await ctx.api.readSession()).video,null);
 quota=100*1024*1024;refuseVideo=true;assert.equal(await ctx.api.rememberSession(request),true);assert.equal((await ctx.api.readSession()).faces.length,2);assert.equal((await ctx.api.readSession()).video,null);
});
