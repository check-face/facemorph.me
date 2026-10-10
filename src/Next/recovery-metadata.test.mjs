import test from 'node:test';import assert from 'node:assert/strict';import {decorateImage,recoverImage} from './recovery-metadata.mjs';import {digest} from './browser/originals.mjs';
test('PNG recovery preserves canonical bytes and W+ without treating the generated face as a new photo',async()=>{
 const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=','base64'));
 const blob=new Blob([bytes],{type:'image/png'}),values=new Float32Array(9216);values[3]=.25;
 const result={blob,latent:{space:'w-plus',values},provenance:{modelSha256:'m',noiseSha256:'n'},imageSha256:await digest(bytes),latentSha256:await digest(values)};
 const decorated=await decorateImage(result,'123');assert(decorated.size>blob.size);
 const recovered=await recoverImage(decorated);assert.equal(recovered.seed,'123');assert.equal(recovered.latent.values[3],.25);assert.deepEqual(new Uint8Array(await recovered.blob.arrayBuffer()),bytes);
 const corrupt=new Uint8Array(await decorated.arrayBuffer());corrupt[corrupt.length-30]^=1;await assert.rejects(recoverImage(new Blob([corrupt])),/Damaged|Invalid|integrity/);
 assert.equal(await recoverImage(blob),null);
});
import {decorateVideo,recoverVideoProject} from './recovery-metadata.mjs';
test('MP4 embeds a bounded project without changing media boxes',async()=>{
 const media=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0,0,0,0,12,109,100,97,116,1,2,3,4]);
 const blob=new Blob([media],{type:'video/mp4'}),project={schemaVersion:1,morph:{controls:[]}};
 const decorated=await decorateVideo(blob,project);
 assert.deepEqual(new Uint8Array(await decorated.slice(0,blob.size).arrayBuffer()),media);
 assert.deepEqual(JSON.parse(await recoverVideoProject(decorated)),project);
 assert.equal(await recoverVideoProject(blob),null);
 assert.equal(await recoverVideoProject(new Blob(['not an mp4'])),null);
 await assert.rejects(decorateVideo(null,project),/Create a morph/);
});

import {embedRecovery} from './image-envelope.mjs';import {readFile} from 'node:fs/promises';
test('product recovery dispatches compact WebP to exact W+ and retains legacy PNG reader',async()=>{
 const blob=new Blob([await readFile(new URL('../public/preview/hello-1024.webp',import.meta.url))],{type:'image/webp'}),values=new Float32Array(9216).fill(.25);
 const record={latent:{values},generationKind:'latent',generationSha256:'a'.repeat(64),provenance:{modelSha256:'b'.repeat(64),noiseSha256:'c'.repeat(64)}};
 const saved=await embedRecovery(blob,record),recovered=await recoverImage(saved.blob);assert.deepEqual(recovered.latent.values,values);assert.equal(recovered.blob.type,'image/webp');assert.equal(recovered.generationSha256,record.generationSha256);
});
