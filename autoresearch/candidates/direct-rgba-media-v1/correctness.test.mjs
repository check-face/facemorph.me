import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {embedRecovery,recoverEnvelope} from './recovery.mjs';
import {encodeRgbaPng} from './control-png.mjs';
import {createImageEncoder} from './encode-client.mjs';
const values=Float32Array.from({length:18*512},(_,i)=>Math.sin(i*.013));
const record={latent:{space:'w-plus',shape:[18,512],values},generationKind:'seed',generationSha256:'a'.repeat(64),provenance:{modelSha256:'b'.repeat(64),noiseSha256:'c'.repeat(64),route:'webgpu',inputValue:'must not export',sourcePhoto:'must not export'}};
const webp=new Blob([await readFile(new URL('../../../src/public/preview/hello-1024.webp',import.meta.url))],{type:'image/webp'});
test('real API WebP envelope preserves bytes, exact latent and privacy while remaining compact',async()=>{
 const saved=await embedRecovery(webp,record,{seed:123});const recovered=await recoverEnvelope(saved.blob);
 assert.deepEqual(new Uint8Array(await recovered.blob.arrayBuffer()),new Uint8Array(await webp.arrayBuffer()));
 assert.deepEqual(recovered.latent.values,values);assert.equal(recovered.seed,123);
 assert.equal(recovered.provenance.inputValue,undefined);assert.equal(recovered.provenance.sourcePhoto,undefined);
 assert.ok(saved.metadataBytes<52*1024);assert.equal(saved.blob.type,'image/webp');
});
test('encoded image tampering and duplicate envelopes are rejected',async()=>{
 const {blob}=await embedRecovery(webp,record);const bytes=new Uint8Array(await blob.arrayBuffer());bytes[40]^=1;
 await assert.rejects(recoverEnvelope(new Blob([bytes],{type:'image/webp'})),/integrity/);
 await assert.rejects(embedRecovery(blob,record),/already/);
});
test('latent corruption is rejected even when container remains valid',async()=>{
 const {blob}=await embedRecovery(webp,record);const bytes=new Uint8Array(await blob.arrayBuffer());
 const start=Buffer.from(bytes).lastIndexOf('"data":"')+8;assert.ok(start>8);
 bytes[start]=bytes[start]===65?66:65;
 await assert.rejects(recoverEnvelope(new Blob([bytes],{type:'image/webp'})),/integrity/);
});
test('full1024 PNG v2 round trip and malformed/oversized identity refusal',async()=>{
 const rgba=new Uint8ClampedArray(1024*1024*4);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
 const png=await encodeRgbaPng(rgba);const saved=await embedRecovery(png,record);const recovered=await recoverEnvelope(saved.blob);
 assert.deepEqual(new Uint8Array(await recovered.blob.arrayBuffer()),new Uint8Array(await png.arrayBuffer()));assert.deepEqual(recovered.latent.values,values);
 await assert.rejects(embedRecovery(webp,{...record,generationSha256:'bad'}),/identity/);
 const invalid=values.slice();invalid[2]=NaN;await assert.rejects(embedRecovery(webp,{...record,latent:{values:invalid}}),/latent/);
 const short=await encodeRgbaPng(new Uint8ClampedArray(4*4*4),4,4);await assert.rejects(embedRecovery(short,record),/full1024/);
});
test('ordinary image without metadata returns null and truncated RIFF refuses',async()=>{
 assert.equal(await recoverEnvelope(webp),null);
 const truncated=await webp.slice(0,webp.size-1).arrayBuffer();await assert.rejects(recoverEnvelope(new Blob([truncated])),/length/);
});
function mockWorker(){return {sent:[],terminated:false,postMessage(data,transfer){this.sent.push(structuredClone(data,{transfer}));},terminate(){this.terminated=true;},reply(id,result={blob:new Blob(['ok'])}){this.onmessage({data:{id,result}});}};}
test('budget blocks before allocation, detached transfer and completion release capacity',async()=>{
 const worker=mockWorker(),encoder=createImageEncoder({worker,maxBytes:16,timeoutMs:1000});
 const first=await encoder.acquire(16);let landed=false;const waiting=encoder.acquire(16).then(r=>{landed=true;return r;});
 await Promise.resolve();assert.equal(landed,false);
 const raw=new ArrayBuffer(16),result=encoder.encode(first,{rgba:raw});assert.equal(raw.byteLength,0);
 assert.equal(encoder.status().rawBytes,16);worker.reply(worker.sent[0].id);await result;
 const second=await waiting;assert.equal(landed,true);second.release();assert.equal(encoder.status().rawBytes,0);encoder.dispose();
});
test('cancelled in-flight request rejects promptly but holds budget until worker acknowledgment',async()=>{
 const worker=mockWorker(),encoder=createImageEncoder({worker,maxBytes:16}),controller=new AbortController();
 const token=await encoder.acquire(16),p=encoder.encode(token,{rgba:new ArrayBuffer(16)},{signal:controller.signal});
 controller.abort();await assert.rejects(p,/abort/i);assert.equal(encoder.status().rawBytes,16);
 worker.reply(worker.sent[0].id);assert.equal(encoder.status().rawBytes,0);encoder.dispose();
});
test('dispose rejects waiters without accidentally granting new reservations',async()=>{
 const worker=mockWorker(),encoder=createImageEncoder({worker,maxBytes:16});
 const token=await encoder.acquire(16),job=encoder.encode(token,{rgba:new ArrayBuffer(16)}),waiting=encoder.acquire(16);
 const rejected=Promise.all([assert.rejects(job,/cancel/i),assert.rejects(waiting,/cancel/i)]);
 encoder.dispose();await rejected;assert.equal(encoder.status().rawBytes,0);assert.equal(worker.terminated,true);
});
test('reservations cannot be reused and worker timeout releases resources',async()=>{
 const worker=mockWorker(),encoder=createImageEncoder({worker,maxBytes:16,timeoutMs:20});
 const token=await encoder.acquire(16),job=encoder.encode(token,{rgba:new ArrayBuffer(16)});
 await assert.rejects(encoder.encode(token,{rgba:new ArrayBuffer(16)}),/reused/);await assert.rejects(job,/timed out/);
 assert.equal(encoder.status().rawBytes,0);assert.equal(worker.terminated,true);
});
