import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{Sha256}from'./sha256.mjs';
const source=await readFile(new URL('photo-worker.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function modelToHeap'),source.indexOf('self.onmessage'));
const digest=data=>{const hash=new Sha256();hash.update(data);return hash.hex();};
const data=Uint8Array.of(1,2,3,4,5,6),parts=[data.slice(0,3),data.slice(3)],base={url:'https://example.test/full',size:6,sha256:digest(data),chunks:parts.map((p,i)=>({url:'https://example.test/'+i,size:p.length,sha256:digest(p)}))};
async function run(asset=base,changed){let fetched=0,freed=0,malloced=0,cancelled=0;const m={HEAPU8:new Uint8Array(128),_malloc(){malloced++;return 8;},_free(){freed++;}};
 const fetch=async url=>{const index=Number(url.split('/').pop()),value=changed?changed(parts[index],index):parts[index];fetched++;let read=false;return{ok:true,headers:new Headers(),body:{getReader(options){if(options?.mode==='byob')throw Error('default reader test');return{async read(){if(read)return{done:true};read=true;return{done:false,value};},cancel(){cancelled++;return new Promise(()=>{});},releaseLock(){throw Error('Forbidden WebKit deadlock regression');}};}}};};
 const descriptor=p=>p,navigator={storage:{async getDirectory(){throw Error('OPFS unavailable for this test');}}};
 const fn=new Function('Sha256','descriptor','navigator','fetch','Response',body+';return modelToHeap;')(Sha256,descriptor,navigator,fetch,Response);const stats={};let error,pointer;
 try{pointer=await Promise.race([fn(m,asset,()=>{},stats),new Promise((_,reject)=>setTimeout(()=>reject(Error('Hung cleanup')),100))]);}catch(e){error=e;}
 return{pointer,error,fetched,freed,malloced,cancelled,heap:m.HEAPU8,stats};
}
let result=await run();assert.equal(result.pointer,8);assert.deepEqual(result.heap.slice(8,14),data);assert.equal(result.fetched,2);assert.equal(result.stats.chunkedModelTransport,true);
result=await run(base,(p,i)=>i===0?Uint8Array.of(1,2,9):p);assert.match(result.error.message,/chunk integrity/);assert.equal(result.fetched,1);assert.equal(result.freed,1);assert.equal(result.cancelled,1);
result=await run({...base,sha256:'0'.repeat(64)});assert.match(result.error.message,/Landmark integrity/);assert.equal(result.freed,1);
result=await run(base,(p,i)=>i===0?Uint8Array.of(1,2,3,4):p);assert.match(result.error.message,/exceeds pinned size/);assert.equal(result.freed,1);
result=await run({...base,size:7});assert.match(result.error.message,/chunk schedule/);assert.equal(result.malloced,0);assert.equal(result.fetched,0);
console.log('Sequential landmark chunks, each digest, full digest, byte limits and nonblocking error cleanup passed.');
