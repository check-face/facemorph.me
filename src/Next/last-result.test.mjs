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
