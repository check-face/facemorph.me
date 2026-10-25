import test from 'node:test';import assert from 'node:assert/strict';
import {validateLast,rememberLast,readLast} from './last-result.mjs';import {digest} from './browser/originals.mjs';
test('restore validates image and latent hashes and rejects corrupt or incompatible results',async()=>{
 const blob=new Blob(['image'],{type:'image/png'}),values=new Float32Array(18*512);
 const result={blob,latent:{space:'w-plus',values},imageSha256:await digest(await blob.arrayBuffer()),latentSha256:await digest(values),provenance:{modelSha256:'model',noiseSha256:'noise'}};
 const record={kind:'last-generated-result-v1',result,settings:{kind:'full-smooth-figure8',width:.2,pinch:true,frames:16,fps:16}};
 assert.equal((await validateLast(record)).result.latent.values.length,9216);
 assert.equal(await validateLast({...record,result:{...result,imageSha256:'bad'}}),null);
 assert.equal(await validateLast({...record,result:{...result,latent:{space:'w',values}}}),null);
 assert.equal(await validateLast(null),null);
 for(const compatible of [Array.from(values),new Float64Array(values)])assert.equal((await validateLast({...record,result:{...result,latent:{space:'w-plus',values:compatible}}})).result.latent.values.length,9216);
 for(const invalid of [Array(9216).fill('0'),new Float32Array(9216).fill(NaN)])assert.equal(await validateLast({...record,result:{...result,latent:{space:'w-plus',values:invalid}}}),null);
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
test('slider preferences tolerate unavailable local storage',async()=>{
 const {sliderPreference,sliderPosition,rememberSlider}=await import('../controller/preferences.ts');
 rememberSlider(true,7);assert.equal(sliderPreference(),false);assert.equal(sliderPosition(),1);
});
test('a superseded session write never touches unavailable storage',async()=>{
 const {rememberSession}=await import('./last-result.mjs');
 assert.equal(await rememberSession({ids:[],faces:[],settings:{kind:'linear',width:.2,pinch:true,frames:16,fps:16}},()=>false),false);
});
// Real IndexedDB, localStorage, quota and reload coverage lives in test/media/session-storage.test.ts.

test('video headroom decision rejects missing estimates and insufficient real storage budgets',async()=>{
 const {videoHasHeadroom}=await import('../../shell/session/retention.ts');
 assert.equal(videoHasHeadroom({quota:64*1024*1024,usage:0},4*1024*1024,1024),true);
 for(const estimate of [{},{quota:NaN},{quota:0},{quota:1024*1024},{quota:64*1024*1024,usage:63*1024*1024}])assert.equal(videoHasHeadroom(estimate,4*1024*1024,1024),false);
});
