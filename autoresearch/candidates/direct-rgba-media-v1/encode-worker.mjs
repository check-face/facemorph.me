import {encodeRgbaPng} from './control-png.mjs';
import {embedRecovery} from './recovery.mjs';
let tail=Promise.resolve(),surface=null;
self.onmessage=({data})=>{
 tail=tail.then(async()=>{
  const {id,rgba,width=1024,height=1024,format='png',quality=.8,recovery}=data;
  try{
   if(!(rgba instanceof ArrayBuffer)||width!==1024||height!==1024||rgba.byteLength!==width*height*4||!['png','webp'].includes(format)||!Number.isFinite(quality)||quality<0||quality>1)throw Error('Invalid image encoding request.');
   const started=performance.now();let blob;
   if(format==='png')blob=await encodeRgbaPng(new Uint8ClampedArray(rgba),width,height);
   else{
    surface??=new OffscreenCanvas(width,height);const ctx=surface.getContext('2d');if(!ctx)throw Error('Worker canvas unavailable.');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);blob=await surface.convertToBlob({type:'image/webp',quality});
    if(blob.type!=='image/webp')throw Error('This browser does not encode WebP.');
   }
   const encodeMs=performance.now()-started,imageBytes=blob.size;
   const decorated=recovery?await embedRecovery(blob,recovery.result,{seed:recovery.seed}):{blob,metadataBytes:0};
   postMessage({id,result:{...decorated,imageBytes,encodeMs,totalMs:performance.now()-started,format:blob.type}});
  }catch(error){postMessage({id,error:error.message});}
 }).catch(()=>{});
};
