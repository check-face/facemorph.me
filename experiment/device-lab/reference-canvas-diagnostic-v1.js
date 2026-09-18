// Optional comparison-path diagnostic only. Never used for inference admission.
export async function compareCanvasReference(png,rawRgba,width=1024,height=1024){
 let bitmap;
 try{bitmap=await createImageBitmap(new Blob([png],{type:'image/png'}));const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const native=ctx.getImageData(0,0,width,height).data;let maxRgb=0,unequalRgbChannels=0,maxAlpha=0;
 for(let i=0;i<native.length;i++){const diff=Math.abs(native[i]-rawRgba[i]);if(i%4===3)maxAlpha=Math.max(maxAlpha,diff);else{maxRgb=Math.max(maxRgb,diff);if(diff)unequalRgbChannels++;}}
 return {available:true,maxRgb,unequalRgbChannels,maxAlpha,scope:'Browser-decoded canvas reference versus encoded PNG samples; not inference correctness; difference cause unknown'};
 }catch(error){return {available:false,error:String(error),scope:'Canvas reference diagnostic only'};}finally{bitmap?.close();}
}
