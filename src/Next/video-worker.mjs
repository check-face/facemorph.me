// Incremental eight-frame segments keep raw-frame storage bounded independently of duration.
import {createBrowserModelCache} from './Assets/model-cache.mjs';
let core,stream,count=0,segmentFrames=0,segments=[],fps=16,compressedBytes=0;const width=512,height=512,MAX_COMPRESSED=48*1024*1024;
async function bytes(asset,cache){const h=await cache.acquire(asset);return new Uint8Array(await (await h.open()).arrayBuffer());}
function begin(){stream=core.FS.open('frames.rgba','w+');segmentFrames=0;}
function flush(){
 if(!segmentFrames)return;core.FS.close(stream);stream=null;
 const name=`part-${String(segments.length).padStart(6,'0')}.mp4`;
 core.setTimeout(120000);const code=core.exec('-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','frames.rgba','-frames:v',String(segmentFrames),'-c:v','libx264','-preset','ultrafast','-crf','20','-profile:v','baseline','-pix_fmt','yuv420p','-threads','1','-an',name);core.reset();core.FS.unlink('frames.rgba');
 if(code!==0)throw Error('Video encoding failed. Your generated faces remain saved.');
 compressedBytes+=core.FS.stat(name).size;if(compressedBytes>MAX_COMPRESSED)throw Error('This video is too large for the current export budget. Choose a shorter morph.');segments.push(name);segmentFrames=0;
}
self.onmessage=async({data})=>{try{
 let result=null;
 if(data.type==='initialize'){
  if(core)throw Error('Encoder already initialized.');fps=data.fps;
  if(!Number.isInteger(fps)||fps<1||fps>60||!data.codec)throw Error('Invalid video configuration.');
  const cache=await createBrowserModelCache({timeoutMs:180000,maxConcurrent:1,report:e=>postMessage({progress:{stage:'codec-loading',loaded:e.bytes}})});
  const wasm=await bytes(data.codec.wasm,cache),moduleBytes=await bytes(data.codec.module,cache);
  const moduleUrl=URL.createObjectURL(new Blob([moduleBytes],{type:'text/javascript'}));
  try{const {default:create}=await import(/* webpackIgnore: true */ moduleUrl);core=await create({wasmBinary:wasm,locateFile:()=>data.codec.wasm.url});}
  finally{URL.revokeObjectURL(moduleUrl);}
  core.setLogger(()=>{});begin();
 }else if(data.type==='frame'){
  if(!core||!(data.rgba instanceof ArrayBuffer)||data.rgba.byteLength!==width*height*4||count>=4096)throw Error('Invalid or excessive video frames.');
  const pixels=new Uint8Array(data.rgba);core.FS.write(stream,pixels,0,pixels.length,segmentFrames*pixels.length);segmentFrames++;count++;
  if(segmentFrames===8){flush();begin();}
 }else if(data.type==='finish'){
  if(!count)throw Error('No frames to export.');if(segmentFrames)flush();else if(stream){core.FS.close(stream);stream=null;core.FS.unlink('frames.rgba');}
  core.FS.writeFile('parts.txt',segments.map(x=>`file '${x}'`).join('\n'));
  core.setTimeout(120000);const code=core.exec('-f','concat','-safe','0','-i','parts.txt','-c','copy','-movflags','+faststart','morph.mp4');core.reset();
  if(code!==0)throw Error('Could not finish the video.');result=core.FS.readFile('morph.mp4');
  postMessage({id:data.id,result:result.buffer},[result.buffer]);return;
 }else throw Error('Unknown video operation.');
 postMessage({id:data.id,result});
 }catch(error){postMessage({id:data.id,error:error.message});}};
