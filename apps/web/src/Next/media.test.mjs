// Tests for the C-06/C-11 media changes: encoder selection from a measured device budget
// (probe once per bundle, one correctness check per session, ffmpeg assets never fetched on
// the WebCodecs path), morph frames persisted byte-identical with zero PNG re-encoding,
// pipelined encoding (add() does not await the encode), and the worker's WebCodecs-to-MP4
// muxer producing a structurally valid faststart stream.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const RGBA=(n,fill=0)=>new Uint8Array(n*4).fill(fill);

// --- shared fakes -----------------------------------------------------------
let encoderSupportCount=0,correctnessEncodes=0;
class FakeVideoEncoder{
 static instances=[];
 constructor({output,error}){this.config=null;this.queue=0;this.outputs=[];this.output=output;this.fail=error;FakeVideoEncoder.instances.push(this);}
 configure(config){this.config=config;}
 encode(frame,{keyFrame=false}={}){this.outputs.push({type:keyFrame?'key':'delta',timestamp:frame.timestamp,duration:frame.duration,size:frame.bytes.length,data:new Uint8Array(frame.bytes)});correctnessEncodes++;}
 async flush(){let first=true;for(const chunk of this.outputs)this.output({...chunk,copyTo:t=>t.set(chunk.data),byteLength:chunk.size},{decoderConfig:first?{description:new Uint8Array([1,2,3,4,5,6,7,8])}:undefined});}
 close(){}
}
class FakeVideoFrame{constructor(source,init){this.timestamp=init?.timestamp??0;this.duration=init?.duration??0;this.bytes=new Uint8Array(64*64*4);}close(){}}
class FakeSurface{constructor(w,h){this.width=w;this.height=h;}
 getContext(){return {fillRect(){}};}
 convertToBlob(){return new Blob([new Uint8Array(this.width*this.height)],{type:'image/png'});}}
function installWebCodecs(){
 encoderSupportCount=0;correctnessEncodes=0;FakeVideoEncoder.instances=[];
 const saved={VideoEncoder:globalThis.VideoEncoder,VideoFrame:globalThis.VideoFrame,OffscreenCanvas:globalThis.OffscreenCanvas};
 globalThis.VideoEncoder=class extends FakeVideoEncoder{static isConfigSupported=async()=>{encoderSupportCount++;return {supported:true};};};
 globalThis.VideoFrame=FakeVideoFrame;globalThis.OffscreenCanvas=FakeSurface;
 return ()=>{globalThis.VideoEncoder=saved.VideoEncoder;globalThis.VideoFrame=saved.VideoFrame;globalThis.OffscreenCanvas=saved.OffscreenCanvas;};
}
class FakeWorker{
 constructor(){this.sent=[];this.terminated=false;this.onmessage=null;this.onmessageerror=null;this.onerror=null;this.handlers={};workers.push(this);}
 postMessage(msg){this.sent.push(msg);const handler=this.handlers[msg.type];
  if(handler)queueMicrotask(()=>handler(msg,this));else queueMicrotask(()=>this.onmessage?.({data:{id:msg.id,result:null}}));}
 respond(data){this.onmessage?.({data});}
 terminate(){this.terminated=true;}
}
let workers=[];
function installWorker(){workers=[];const saved=globalThis.Worker;globalThis.Worker=FakeWorker;return ()=>{globalThis.Worker=saved;};}

// --- probe (C-11) -----------------------------------------------------------
test('The encoder probe selects WebCodecs at full resolution once per bundle',async()=>{
 const {probeVideoEncoder,resetEncoderProbe}=await import('./media.mjs');
 resetEncoderProbe();const restore=installWebCodecs();
 try{
  const first=await probeVideoEncoder({bundle:'bundle-1'});
  assert.equal(first.kind,'webcodecs');assert.equal(first.width,1024);assert.equal(first.height,1024);
  assert.equal(encoderSupportCount,1,'one isConfigSupported probe');
  assert.equal(first.correctnessChecks,1,'one encoder-correctness-check');
  const second=await probeVideoEncoder({bundle:'bundle-1'});
  assert.equal(encoderSupportCount,1,'the decision is cached per bundle');
  assert.equal(second.kind,'webcodecs');
  const other=await probeVideoEncoder({bundle:'bundle-2'});
  assert.equal(encoderSupportCount,2,'a new bundle is measured again');
  assert.equal(other.correctnessChecks,2);
 }finally{restore();resetEncoderProbe();}
});
test('Browsers without WebCodecs fall back to ffmpeg at the classic resolution',async()=>{
 const {probeVideoEncoder,resetEncoderProbe}=await import('./media.mjs');
 resetEncoderProbe();
 const saved=globalThis.VideoEncoder;delete globalThis.VideoEncoder;
 try{
  const probe=await probeVideoEncoder({});
  assert.equal(probe.kind,'ffmpeg');assert.equal(probe.width,512);assert.equal(probe.reason,'webcodecs-unavailable');
 }finally{globalThis.VideoEncoder=saved;resetEncoderProbe();}
});
test('A WebCodecs decision never fetches the ffmpeg codec assets',async()=>{
 const {videoWriter,resetEncoderProbe}=await import('./media.mjs');
 resetEncoderProbe();const restore=installWebCodecs(),restoreWorker=installWorker();
 let fetched=0;const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{fetched++;throw Error('must not fetch');};
 try{
  const writer=videoWriter({codec:{wasm:{url:'x'},module:{url:'y'}},fps:16});
  const choice=await writer.initialize();
  assert.equal(choice.kind,'webcodecs');
  const init=workers.at(-1).sent[0];
  assert.equal(init.mode,'webcodecs');assert.equal(init.codec,'avc1.42002A');assert.equal(init.width,1024);
  assert.equal('wasm' in init,false,'no ffmpeg asset in the init message');
  assert.equal(fetched,0,'ffmpeg-core.wasm is not downloaded');
  writer.dispose();
 }finally{globalThis.fetch=savedFetch;restore();restoreWorker();resetEncoderProbe();}
});
test('The fallback path still initializes the ffmpeg worker at 512',async()=>{
 const {videoWriter,resetEncoderProbe}=await import('./media.mjs');
 resetEncoderProbe();const restoreWorker=installWorker();
 const saved=globalThis.VideoEncoder;delete globalThis.VideoEncoder;
 try{
  const writer=videoWriter({codec:{wasm:'w',module:'m'},fps:16});
  const choice=await writer.initialize();
  assert.equal(choice.kind,'ffmpeg');
  const init=workers.at(-1).sent[0];
  assert.equal(init.mode,'ffmpeg');assert.equal(init.width,512);assert.equal(init.height,512);assert.deepEqual(init.codec,{wasm:'w',module:'m'});
  writer.dispose();
 }finally{globalThis.VideoEncoder=saved;restoreWorker();resetEncoderProbe();}
});

// --- morph frame path (C-06) ------------------------------------------------
function installBitmapDecoder(){
 const saved={createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
 class Canvas{constructor(w,h){this.width=w;this.height=h;this.pixels=new Uint8ClampedArray(w*h*4);}
  getContext(){const canvas=this;return {
   drawImage(bitmap){canvas.pixels.set(new Uint8ClampedArray(bitmap.bytes.subarray(0,canvas.pixels.length)));},
   getImageData(x,y,w,h){return {data:new Uint8ClampedArray(canvas.pixels),width:w,height:h};},fillRect(){} };}
  async convertToBlob({type='image/png'}={}){return new Blob([this.pixels],{type});}}
 globalThis.OffscreenCanvas=Canvas;
 globalThis.createImageBitmap=async b=>{const bytes=new Uint8Array(await b.arrayBuffer());return {width:bytes.length/4,height:1,bytes,close(){}};};
 return ()=>{globalThis.createImageBitmap=saved.createImageBitmap;globalThis.OffscreenCanvas=saved.OffscreenCanvas;};
}
test('Morph frames persist the canonical PNG byte-identical and feed raw RGBA to the encoder',async()=>{
 const {videoWriter}=await import('./media.mjs');
 const {frameStoreGet}=await import('./morph-frames.mjs');
 const restore=installWorker(),restoreBitmap=installBitmapDecoder();
 try{
  const canonicals=[new Blob([RGBA(256,1)],{type:'image/png'}),new Blob([RGBA(256,2)],{type:'image/png'})];
  const writer=videoWriter({codec:{},encoder:{kind:'webcodecs',codec:'avc1.42002A',width:16,height:16,bitrate:1000},fps:16,framesKey:'morph-key',totalFrames:2,derivativeSize:8});
  await writer.initialize();
  await writer.add(canonicals[0],0);await writer.add(canonicals[1],1);
  const frameMessages=workers.at(-1).sent.filter(m=>m.type==='frame');
  assert.equal(frameMessages.length,2);
  assert.deepEqual(new Uint8Array(frameMessages[0].rgba).subarray(0,256*4),RGBA(256,1),'the encoder receives raw RGBA, decoded once');
  assert.deepEqual(new Uint8Array(frameMessages[1].rgba).subarray(0,256*4),RGBA(256,2));
  const stored=await frameStoreGet('morph-key');
  assert.equal(stored.length,2);
  assert.deepEqual(new Uint8Array(await stored[0].arrayBuffer()),RGBA(256,1),'the canonical frame is the synthesis PNG byte-identical — no re-encode');
  assert.deepEqual(new Uint8Array(await stored[1].arrayBuffer()),RGBA(256,2));
  workers.at(-1).handlers.finish=(msg,w)=>w.respond({id:msg.id,result:new ArrayBuffer(8)});
  const result=await writer.finish();
  assert.equal(result.type,'video/mp4');
 }finally{restore();restoreBitmap();}
});
test('The morph path re-encodes no PNG anywhere',async()=>{
 for(const file of ['src/Next/media.mjs','src/Next/video-worker.mjs','src/Next/morph-frames.mjs']){
  const source=(await readFile(new URL(`../../${file}`,import.meta.url).pathname,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  assert.equal(source.includes('encodeRgbaPng'),false,`${file} must not encode PNGs on the morph path`);
  assert.equal(source.includes("from './png.mjs'"),false,`${file} must not import the PNG encoder`);
  assert.equal(source.includes('originals.mjs'),false,`${file} must never touch the originals store`);
 }
});
test('Encoding is pipelined: add() returns before the encode lands, finish() waits for it',async()=>{
 const {videoWriter}=await import('./media.mjs');
 const restore=installWorker(),restoreBitmap=installBitmapDecoder();
 try{
  const writer=videoWriter({codec:{},encoder:{kind:'webcodecs',codec:'avc1.42002A',width:16,height:16,bitrate:1000},fps:16});
  await writer.initialize();
  let encoded=0;const progressEvents=[];
  const worker=workers.at(-1);
  worker.handlers.frame=(msg,w)=>{w.respond({id:msg.id,result:null});setTimeout(()=>{encoded++;w.respond({progress:{stage:'encoding',loaded:encoded}});},15);};
  worker.handlers.finish=(msg,w)=>{const wait=setInterval(()=>{if(encoded===3){clearInterval(wait);w.respond({id:msg.id,result:new ArrayBuffer(4)});}},5);};
  const began=Date.now();
  for(let i=0;i<3;i++)await writer.add(new Blob([RGBA(16)],{type:'image/png'}));
  assert.equal(encoded,0,'three frames submitted while none has finished encoding');
  assert.ok(Date.now()-began<200,'the frame loop did not wait for the encoder');
  const progressDone=new Promise(resolve=>{const poll=setInterval(()=>{if(encoded===3){clearInterval(poll);resolve();}},5);});
  const result=await writer.finish();
  await progressDone;
  assert.equal(encoded,3,'finish waits until every frame is encoded');
  assert.equal(result.type,'video/mp4');
 }finally{restore();restoreBitmap();}
});
test('A frame-store put failure never fails the morph',async()=>{
 const {videoWriter}=await import('./media.mjs');
 const restore=installWorker(),restoreBitmap=installBitmapDecoder();
 try{
  const writer=videoWriter({codec:{},encoder:{kind:'webcodecs',codec:'avc1.42002A',width:16,height:16,bitrate:1000},fps:16,framesKey:'doomed'});
  await writer.initialize();
  await assert.doesNotReject(()=>writer.add(new Blob([RGBA(16)],{type:'image/png'})));
  workers.at(-1).handlers.finish=(msg,w)=>w.respond({id:msg.id,result:new ArrayBuffer(4)});
  await assert.doesNotReject(()=>writer.finish());
 }finally{restore();restoreBitmap();}
});

// --- worker WebCodecs → MP4 muxer (C-11) ------------------------------------
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
function walkBoxes(buffer,at=0,end=buffer.byteLength){
 const view=new DataView(buffer),out=[];
 while(at<end){const size=view.getUint32(at);const type=String.fromCharCode(...new Uint8Array(buffer,at+4,4));
  out.push({type,start:at,size,payloadStart:at+8,payloadEnd:at+size,children:type==='moov'||type==='trak'||type==='mdia'||type==='minf'||type==='stbl'?walkBoxes(buffer,at+8,at+size):null});
  at+=size;}
 return out;
}
const findBox=(boxes,path)=>{let list=boxes,box=null;for(const type of path){box=list?.find(b=>b.type===type);list=box?.children;}return box;};
test('video-worker muxes WebCodecs output into a faststart MP4 with the expected frames',async()=>{
 const sent=[],responses=[];globalThis.self=globalThis;
 const savedPost=globalThis.postMessage;globalThis.postMessage=msg=>sent.push(msg);
 const saved={VideoEncoder:globalThis.VideoEncoder,VideoFrame:globalThis.VideoFrame};
 globalThis.VideoEncoder=class{constructor({output,error}){this.chunks=[];this.output=output;this.error=error;this.encodeQueueSize=0;}
  configure(){}
  encode(frame,{keyFrame=false}={}){const data=new Uint8Array(keyFrame?10:4).fill(keyFrame?7:3);this.chunks.push({keyFrame,timestamp:frame.timestamp,data});}
  async flush(){this.chunks.forEach((chunk,i)=>this.output({type:chunk.keyFrame?'key':'delta',timestamp:chunk.timestamp,byteLength:chunk.data.length,copyTo:t=>t.set(chunk.data)},{decoderConfig:i===0?{description:new Uint8Array([9,8,7,6,5,4,3,2,1,0,9,8,7,6])}:undefined}));}
  close(){}};
 globalThis.VideoFrame=class{constructor(source,init){this.timestamp=init.timestamp;}close(){}};
 try{
  const worker=await import('./video-worker.mjs');void worker;
  const wait=() => new Promise(resolve=>setTimeout(resolve,10));
  await globalThis.onmessage({data:{id:1,type:'initialize',mode:'webcodecs',codec:'avc1.42002A',width:16,height:16,fps:2,bitrate:1000}});
  await wait();
  await globalThis.onmessage({data:{id:2,type:'frame',rgba:RGBA(256,1).buffer}});
  await globalThis.onmessage({data:{id:3,type:'frame',rgba:RGBA(256,2).buffer}});
  await globalThis.onmessage({data:{id:4,type:'finish',mode:'webcodecs'}});
  await wait();
  const finish=sent.find(m=>m.id===4);
  assert.ok(finish?.result,'the worker returns muxed bytes');
  const buffer=finish.result;
  const top=walkBoxes(buffer);
  assert.deepEqual(top.map(b=>b.type),['ftyp','moov','mdat'],'moov precedes mdat: faststart');
  const stsz=findBox(top,['moov','trak','mdia','minf','stbl','stsz']);
  const stszView=new DataView(buffer.slice(stsz.payloadStart,stsz.payloadEnd));
  assert.equal(stszView.getUint32(8),2,'two samples');
  assert.equal(stszView.getUint32(12),10,'first sample is the keyframe chunk');
  assert.equal(stszView.getUint32(16),4);
  const stco=findBox(top,['moov','trak','mdia','minf','stbl','stco']);
  const offset=new DataView(buffer).getUint32(stco.payloadStart+8);
  const mdat=top[2];
  assert.equal(offset,mdat.start+8,'the chunk offset points at the mdat payload');
  const stts=findBox(top,['moov','trak','mdia','minf','stbl','stts']);
  const sttsView=new DataView(buffer.slice(stts.payloadStart,stts.payloadEnd));
  assert.equal(sttsView.getUint32(4),1,'one constant delta');
  assert.equal(sttsView.getUint32(8),2,'covering both frames');
  assert.equal(sttsView.getUint32(12),45000,'90000/2fps');
  const stss=findBox(top,['moov','trak','mdia','minf','stbl','stss']);
  assert.equal(new DataView(buffer).getUint32(stss.payloadStart+8),1,'frame 1 is a sync sample');
  const stsd=findBox(top,['moov','trak','mdia','minf','stbl','stsd']);
  const stsdPayload=new Uint8Array(buffer,stsd.payloadStart,stsd.size-8);
  const avc1At=stsdPayload.findIndex((b,i)=>b===0x61&&stsdPayload[i+1]===0x76&&stsdPayload[i+2]===0x63&&stsdPayload[i+3]===0x31);
  assert.ok(avc1At>=0,'an avc1 sample entry is present');
  const avcCIndex=stsdPayload.findIndex((b,i)=>b===9&&stsdPayload[i+1]===8&&stsdPayload[i+2]===7);
  assert.ok(avcCIndex>=0&&avcCIndex>avc1At,'the avcC decoder description from the encoder is embedded inside avc1');
  assert.equal(new DataView(buffer).getUint32(findBox(top,['moov','trak','mdia','mdhd']).payloadStart+12),90000,'mdhd timescale');
  assert.equal(new DataView(buffer).getUint32(findBox(top,['moov','mvhd']).payloadStart+12),1000,'mvhd timescale is milliseconds');
  assert.equal(new DataView(buffer).getUint32(findBox(top,['moov','mvhd']).payloadStart+16),1000,'1000 ms: two frames at 2 fps incl. the last frame\'s display time');
  // Error paths.
  await globalThis.onmessage({data:{id:5,type:'frame',rgba:new ArrayBuffer(3)}});
  await wait();
  assert.equal(sent.find(m=>m.id===5)?.error,'Invalid or excessive video frames.');
  const fresh=sent.length;void fresh;
  // Same module state: the encoder was closed after finish, so frames must be rejected.
  await globalThis.onmessage({data:{id:6,type:'initialize',mode:'webcodecs',codec:'avc1.42002A',width:16,height:16,fps:2,bitrate:1000}});
  await globalThis.onmessage({data:{id:7,type:'finish',mode:'webcodecs'}});
  await wait();
  assert.equal(sent.find(m=>m.id===7)?.error,'No frames to export.');
 }finally{globalThis.postMessage=savedPost;globalThis.VideoEncoder=saved.VideoEncoder;globalThis.VideoFrame=saved.VideoFrame;}
});
test('video-worker rejects an uninitialized frame and an out-of-order encoder',async()=>{
 const sent=[];globalThis.self=globalThis;
 const savedPost=globalThis.postMessage;globalThis.postMessage=msg=>sent.push(msg);
 const saved={VideoEncoder:globalThis.VideoEncoder,VideoFrame:globalThis.VideoFrame};
 globalThis.VideoEncoder=class{constructor({output}){this.output=output;this.encodeQueueSize=0;}
  configure(){}encode(){}
  async flush(){this.output({type:'key',timestamp:2000,byteLength:4,copyTo:t=>t.set(new Uint8Array(4))},{decoderConfig:{description:new Uint8Array([1])}});
   this.output({type:'delta',timestamp:1000,byteLength:4,copyTo:t=>t.set(new Uint8Array(4))});}
  close(){}};
 globalThis.VideoFrame=class{constructor(){}close(){}};
 try{
  const worker=await import('./video-worker.mjs');void worker;
  const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
  await globalThis.onmessage({data:{id:1,type:'frame',rgba:RGBA(256).buffer}});
  await wait();
  assert.equal(sent.find(m=>m.id===1)?.error,'Encoder not initialized.');
  await globalThis.onmessage({data:{id:2,type:'initialize',mode:'webcodecs',codec:'avc1.42002A',width:16,height:16,fps:2,bitrate:1000}});
  await globalThis.onmessage({data:{id:3,type:'frame',rgba:RGBA(256,1).buffer}});
  await globalThis.onmessage({data:{id:4,type:'frame',rgba:RGBA(256,2).buffer}});
  await globalThis.onmessage({data:{id:5,type:'finish',mode:'webcodecs'}});
  await wait();
  assert.match(sent.find(m=>m.id===5)?.error||'',/out of order/,'out-of-order encoder output is rejected, not mis-timed');
 }finally{globalThis.postMessage=savedPost;globalThis.VideoEncoder=saved.VideoEncoder;globalThis.VideoFrame=saved.VideoFrame;}
});
