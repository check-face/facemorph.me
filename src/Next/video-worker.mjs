// Incremental eight-frame segments keep raw-frame storage bounded independently of duration.
// Two encoder paths, chosen by the caller from a measured device budget (media.mjs
// `probeVideoEncoder`, C-11):
//  - 'webcodecs': the platform's hardware H.264 encoder via VideoEncoder, muxed into a
//    faststart MP4 by the single-track muxer below. No model-cache acquire happens on this
//    path, so ffmpeg-core.wasm is never downloaded on these browsers. Encoding overlaps
//    synthesis: 'frame' messages are acked as soon as the encoder has accepted them and the
//    finished bytes are only requested at 'finish'; the worker throttles on encodeQueueSize
//    and the caller on its own in-flight count. Each accepted frame reports an 'encoding'
//    progress tick so diagnostics can price the encode as its own stage.
//  - 'ffmpeg': the original libx264 baseline path, unchanged except that the resolution now
//    arrives in the initialize message instead of being hardcoded here.
// Frames arrive as raw RGBA at the resolution the probe chose; nothing re-encodes a PNG here.
import {createBrowserModelCache} from './Assets/model-cache.mjs';
let core,stream,count=0,segmentFrames=0,segments=[],fps=16,width=512,height=512,compressedBytes=0,MAX_COMPRESSED=48*1024*1024;
let enc=null,encError=null,description=null,chunks=[],chunkBytes=0,currentId=0,encodedCount=0;
const u16=n=>{const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,n);return a;};
const u32=n=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n>>>0);return a;};
const type=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const box=(name,...payloads)=>concat(u32(8+payloads.reduce((n,p)=>n+p.length,0)),type(name),...payloads);
const fullBox=(name,version,flags,...payloads)=>box(name,new Uint8Array([version,flags>>>16&255,flags>>>8&255,flags&255]),...payloads);
const MATRIX=()=>concat(u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000));
/**
 * Single H.264 avc1 track from the encoder's output chunks. A baseline stream has no B-frames,
 * so decode order equals presentation order; out-of-order timestamps are rejected rather than
 * mis-timed. `avcC` is the decoderConfig.description the first output carries. moov precedes
 * mdat, so the result is faststart exactly like the ffmpeg path's +movflags.
 */
export function muxMp4(samples,avcC,trackWidth,trackHeight,trackFps){
 if(!samples.length)throw Error('No frames to export.');
 if(!avcC||!avcC.byteLength)throw Error('The video encoder did not provide a decodable stream.');
 const timescale=90000,nominal=Math.round(timescale/Math.max(1,trackFps)),times=samples.map(s=>Math.round(s.timestamp*timescale/1e6));
 for(let i=1;i<times.length;i++)if(times[i]<=times[i-1])throw Error('The video encoder produced frames out of order.');
 const stts=[];for(let i=0;i<samples.length;i++){const delta=(i+1<samples.length?times[i+1]:times[samples.length-1]+nominal)-times[i];const last=stts.at(-1);if(last&&last.delta===delta)last.count++;else stts.push({count:1,delta});}
 const durationMs=Math.round((times.at(-1)+nominal)/timescale*1000),keyframes=samples.map((s,i)=>s.type==='key'?i+1:0).filter(Boolean);
 const avc1=box('avc1',new Uint8Array(6),u16(1),u16(0),u16(0),new Uint8Array(12),u16(trackWidth),u16(trackHeight),u32(0x480000),u32(0x480000),u32(0),u16(1),new Uint8Array(32),u16(0x18),u16(0xffff),box('avcC',new Uint8Array(avcC)));
 const stbl=box('stbl',fullBox('stsd',0,0,u32(1),avc1),
  fullBox('stts',0,0,u32(stts.length),...stts.map(e=>concat(u32(e.count),u32(e.delta)))),
  fullBox('stss',0,0,u32(keyframes.length),...keyframes.map(u32)),
  fullBox('stsc',0,0,u32(1),u32(1),u32(samples.length),u32(1)),
  fullBox('stsz',0,0,u32(0),u32(samples.length),...samples.map(s=>u32(s.size))),
  fullBox('stco',0,0,u32(1),u32(0)));
 const moov=box('moov',
  fullBox('mvhd',0,0,u32(0),u32(0),u32(1000),u32(durationMs),u32(0x10000),u16(0x100),u16(0),u32(0),u32(0),MATRIX(),u32(0),u32(0),u32(0),u32(0),u32(0),u32(0),u32(2)),
  box('trak',
   fullBox('tkhd',0,3,u32(0),u32(0),u32(1),u32(0),u32(durationMs),u32(0),u32(0),u16(0),u16(0),u16(0),u32(0),MATRIX(),u32(trackWidth*65536),u32(trackHeight*65536)),
   box('mdia',
    fullBox('mdhd',0,0,u32(0),u32(0),u32(timescale),u32(times.at(-1)+nominal),u16(0x55c4),u16(0)),
    fullBox('hdlr',0,0,u32(0),type('vide'),u32(0),u32(0),u32(0),concat(type('VideoHandler'),new Uint8Array(1))),
    box('minf',fullBox('vmhd',0,1,u16(0),u16(0),u16(0),u16(0)),fullBox('dref',0,0,u32(1),fullBox('url ',0,1)),stbl))));
 // stco is the last box written, so the chunk offset is its final word: ftyp + moov + mdat header.
 new DataView(moov.buffer).setUint32(moov.length-4,ftyp.length+moov.length+8);
 const mdat=concat(u32(8+samples.reduce((n,s)=>n+s.size,0)),type('mdat'),...samples.map(s=>s.data));
 return concat(ftyp,moov,mdat);
}
const ftyp=box('ftyp',type('isom'),u32(512),type('isom'),type('iso2'),type('avc1'),type('mp41'));
async function bytes(asset,cache){const h=await cache.acquire(asset);return new Uint8Array(await (await h.open()).arrayBuffer());}
function begin(){stream=core.FS.open('frames.rgba','w+');segmentFrames=0;}
function flush(){
 if(!segmentFrames)return;core.FS.close(stream);stream=null;
 const name=`part-${String(segments.length).padStart(6,'0')}.mp4`;
 core.setTimeout(120000);const code=core.exec('-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','frames.rgba','-frames:v',String(segmentFrames),'-c:v','libx264','-preset','ultrafast','-crf','20','-profile:v','baseline','-pix_fmt','yuv420p','-threads','1','-an',name);core.reset();core.FS.unlink('frames.rgba');
 if(code!==0)throw Error('Video encoding failed. Your generated faces remain saved.');
 compressedBytes+=core.FS.stat(name).size;if(compressedBytes>MAX_COMPRESSED)throw Error('This video is too large for the current export budget. Choose a shorter morph.');segments.push(name);segmentFrames=0;
}
function dims(data){width=data.width;height=data.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||width>2048||height<16||height>2048)throw Error('Invalid video resolution.');}
self.onmessage=async({data})=>{currentId=data.id;try{
 let result=null;
 if(data.type==='initialize'){
  // Workers are single-use in practice, but a fresh initialize must never inherit state.
  count=0;segmentFrames=0;segments=[];compressedBytes=0;chunks=[];chunkBytes=0;encodedCount=0;description=null;encError=null;
  if(data.mode==='webcodecs'){
   if(enc)throw Error('Encoder already initialized.');
   dims(data);fps=data.fps;if(!Number.isInteger(fps)||fps<1||fps>60||typeof data.codec!=='string')throw Error('Invalid video configuration.');
   enc=new VideoEncoder({output:(chunk,metadata)=>{
    if(!description)description=metadata?.decoderConfig?.description||null;
    const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunkBytes+=bytes.length;
    if(chunkBytes>MAX_COMPRESSED){encError=encError||'This video is too large for the current export budget. Choose a shorter morph.';postMessage({id:currentId,error:encError});return;}
    chunks.push({type:chunk.type,timestamp:chunk.timestamp,duration:chunk.duration,size:bytes.length,data:bytes});
    encodedCount++;postMessage({progress:{stage:'encoding',loaded:encodedCount}});
   },error:error=>{encError=encError||error?.message||'The video encoder failed.';postMessage({id:currentId,error:encError});}});
   enc.configure({codec:data.codec,width,height,bitrate:data.bitrate,framerate:fps,avc:{format:'avc'},latencyMode:'quality'});
  }else{
   if(core)throw Error('Encoder already initialized.');fps=data.fps;
   if(!Number.isInteger(fps)||fps<1||fps>60||!data.codec)throw Error('Invalid video configuration.');
   dims(data);
   const cache=await createBrowserModelCache({timeoutMs:180000,maxConcurrent:1,report:e=>postMessage({progress:{stage:'codec-loading',loaded:e.bytes}})});
   const wasm=await bytes(data.codec.wasm,cache),moduleBytes=await bytes(data.codec.module,cache);
   const moduleUrl=URL.createObjectURL(new Blob([moduleBytes],{type:'text/javascript'}));
   try{const {default:create}=await import(/* webpackIgnore: true */ moduleUrl);core=await create({wasmBinary:wasm,locateFile:()=>data.codec.wasm.url});}
   finally{URL.revokeObjectURL(moduleUrl);}
   core.setLogger(()=>{});begin();
  }
 }else if(data.type==='frame'){
  const pixels=data.rgba instanceof ArrayBuffer?new Uint8Array(data.rgba):null;
  if(!pixels||pixels.byteLength!==width*height*4||count>=4096)throw Error('Invalid or excessive video frames.');
  if(enc){
   if(encError)throw Error(encError);
   while(enc.encodeQueueSize>8)await new Promise(resolve=>setTimeout(resolve,2));
   const frame=new VideoFrame(data.rgba,{format:'RGBA',codedWidth:width,codedHeight:height,timestamp:Math.round(count*1e6/fps),duration:Math.round(1e6/fps)});
   enc.encode(frame,{keyFrame:count%Math.max(1,Math.round(fps*2))===0});frame.close();count++;
  }else{
   if(!core)throw Error('Encoder not initialized.');
   core.FS.write(stream,pixels,0,pixels.length,segmentFrames*pixels.length);segmentFrames++;count++;
   postMessage({progress:{stage:'encoding',loaded:count}});
   if(segmentFrames===8){flush();begin();}
  }
 }else if(data.type==='finish'){
  if(enc){
   try{
    if(!count)throw Error('No frames to export.');
    if(encError)throw Error(encError);
    await enc.flush();
    if(!description)throw Error('The video encoder did not provide a decodable stream.');
    result=muxMp4(chunks,description,width,height,fps);
   }finally{try{enc.close();}catch{} enc=null;}
  }else{
   if(!count)throw Error('No frames to export.');
   if(segmentFrames)flush();else if(stream){core.FS.close(stream);stream=null;core.FS.unlink('frames.rgba');}
   core.FS.writeFile('parts.txt',segments.map(x=>`file '${x}'`).join('\n'));
   core.setTimeout(120000);const code=core.exec('-f','concat','-safe','0','-i','parts.txt','-c','copy','-movflags','+faststart','morph.mp4');core.reset();
   if(code!==0)throw Error('Could not finish the video.');result=core.FS.readFile('morph.mp4');
  }
  const buffer=result.buffer;postMessage({id:data.id,result:buffer},[buffer]);return;
 }else throw Error('Unknown video operation.');
 postMessage({id:data.id,result});
 }catch(error){postMessage({id:data.id,error:error.message});}};
