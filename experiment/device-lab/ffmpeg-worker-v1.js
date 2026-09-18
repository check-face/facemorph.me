// Standalone, single-threaded FFmpeg compatibility probe. No model downloads.
const width=512,height=512,frames=12,fps=16;
self.onmessage=async()=>{
 const row={kind:'ffmpeg-compatibility',coreVersion:'0.12.10',threads:1,width,height,frames,fps,completed:false,logs:[]};
 let core;
 const progress=message=>postMessage({progress:message,checkpoint:row});
 try{
  progress('Loading single-threaded FFmpeg WASM (~32 MB)…');
  let start=performance.now();
  const coreURL=new URL('./node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',import.meta.url).href;
  const {default:create}=await import(coreURL);
  core=await create({mainScriptUrlOrBlob:coreURL+'#'+btoa(JSON.stringify({wasmURL:new URL('ffmpeg-core.wasm',coreURL).href}))});
  row.loadMs=performance.now()-start;
  core.setLogger(({message})=>{row.logs.push(message);if(row.logs.length>40)row.logs.shift();});
  const input=new Uint8Array(width*height*4*frames);
  for(let f=0;f<frames;f++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const p=((f*height+y)*width+x)*4,square=x>=f*32&&x<f*32+96&&y>=208&&y<304;
   input[p]=square?240:32+Math.floor(x/128)*48;input[p+1]=square?240:48+Math.floor(y/128)*40;input[p+2]=square?240:64+f*8;input[p+3]=255;
  }
  core.FS.writeFile('input.rgba',input);
  row.encodeArgs=['-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','input.rgba','-frames:v',String(frames),'-c:v','libx264','-preset','ultrafast','-crf','23','-profile:v','baseline','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart','output.mp4'];
  progress('Encoding 12 synthetic 512px frames to H.264 / MP4…');
  core.setTimeout(60000);start=performance.now();row.encodeExitCode=core.exec(...row.encodeArgs);row.encodeMs=performance.now()-start;core.reset();
  if(row.encodeExitCode!==0)throw Error('FFmpeg encode exit '+row.encodeExitCode);
  const mp4=core.FS.readFile('output.mp4');row.encodedBytes=mp4.byteLength;
  row.mp4Sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',mp4))].map(x=>x.toString(16).padStart(2,'0')).join('');
  progress('Decoding MP4 and checking every frame…');
  row.decodeArgs=['-i','output.mp4','-threads','1','-f','rawvideo','-pix_fmt','rgba','decoded.rgba'];
  core.setTimeout(60000);start=performance.now();row.decodeExitCode=core.exec(...row.decodeArgs);row.decodeMs=performance.now()-start;core.reset();
  if(row.decodeExitCode!==0)throw Error('FFmpeg decode exit '+row.decodeExitCode);
  const decoded=core.FS.readFile('decoded.rgba');row.decodedBytes=decoded.byteLength;
  if(decoded.length!==input.length)throw Error('Decoded frame count/size mismatch');
  row.frameMeanAbsoluteError=[];
  for(let f=0;f<frames;f++){let error=0;for(let p=f*width*height*4;p<(f+1)*width*height*4;p+=4)for(let c=0;c<3;c++)error+=Math.abs(input[p+c]-decoded[p+c]);row.frameMeanAbsoluteError.push(error/(width*height*3));}
  row.lossyMeanErrorLimit=8;row.roundTripPassed=row.frameMeanAbsoluteError.every(x=>x<=row.lossyMeanErrorLimit);
  if(!row.roundTripPassed)throw Error('Decoded pixels exceed lossy correctness tolerance');
  progress('Checking native browser MP4 playback…');row.completed=true;
  postMessage({done:true,row,video:mp4.buffer},[mp4.buffer]);
 }catch(e){row.error=String(e);postMessage({done:true,row});}
 finally{if(core)for(const name of ['input.rgba','output.mp4','decoded.rgba'])try{core.FS.unlink(name);}catch{}}
};
