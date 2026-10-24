import {encodeRgbaPng} from './browser/png.mjs';
import {embedRecovery} from './image-envelope.mjs';
let tail=Promise.resolve(),surface=null;
self.onmessage=({data})=>{
 tail=tail.then(async()=>{
  const {id,blob:inputBlob,width=1024,height=1024,format='png',quality=.8,recovery,derivativeSize=0}=data;let rgba=data.rgba;
  try{
   if(inputBlob){
    if(!(inputBlob instanceof Blob)||inputBlob.size>64*1024*1024)throw Error('Invalid download image.');
    const bitmap=await createImageBitmap(inputBlob);try{if(bitmap.width!==width||bitmap.height!==height)throw Error('Invalid download dimensions.');surface??=new OffscreenCanvas(width,height);const context=surface.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);rgba=context.getImageData(0,0,width,height).data.buffer;}finally{bitmap.close();}
   }
   if(!(rgba instanceof ArrayBuffer)||width!==1024||height!==1024||rgba.byteLength!==width*height*4||!['png','webp'].includes(format)||!Number.isFinite(quality)||quality<0||quality>1)throw Error('Invalid image encoding request.');
   const started=performance.now();let blob;
   if(format==='png')blob=await encodeRgbaPng(new Uint8ClampedArray(rgba),width,height);
   else{
    surface??=new OffscreenCanvas(width,height);const ctx=surface.getContext('2d');if(!ctx)throw Error('Worker canvas unavailable.');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);blob=await surface.convertToBlob({type:'image/webp',quality});
    if(blob.type!=='image/webp')throw Error('This browser does not encode WebP.');
   }
   let derivative=null;
   if(derivativeSize){if(!Number.isInteger(derivativeSize)||derivativeSize<16||derivativeSize>1024)throw Error('Invalid preview size.');
    surface??=new OffscreenCanvas(width,height);surface.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
    const preview=new OffscreenCanvas(derivativeSize,derivativeSize);preview.getContext('2d').drawImage(surface,0,0,derivativeSize,derivativeSize);derivative=await preview.convertToBlob({type:'image/jpeg',quality:.85});}
   const encodeMs=performance.now()-started,imageBytes=blob.size;
   const decorated=recovery?await embedRecovery(blob,recovery.result,{seed:recovery.seed}):{blob,metadataBytes:0};
   postMessage({id,result:{...decorated,derivative,imageBytes,encodeMs,totalMs:performance.now()-started,format:blob.type}});
  }catch(error){postMessage({id,error:error.message});}
 }).catch(()=>{});
};
