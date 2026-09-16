// Local cropping ahead of alignment, so an arbitrary camera original never has to be
// aligned whole. The preview is decoded once at a bounded size and the crop is rendered
// straight to the square the encoder wants, so no full-resolution bitmap is ever held.
export const PREVIEW_MAX_EDGE=4096;
export const CROP_OUTPUT=1024;
export const CROP_MAX_BYTES=64*1024*1024;
// Beyond this a decode is refused before it is attempted, whatever the container claims.
export const CROP_MAX_PIXELS=120*1024*1024;
export const CROP_MAX_EDGE=20000;

function scaleTo(width,height,edge){
 const longest=Math.max(width,height);
 if(!(longest>edge))return null;
 const factor=edge/longest;
 return {width:Math.max(1,Math.round(width*factor)),height:Math.max(1,Math.round(height*factor))};
}

/** Decodes at most `edge` pixels on the long side. Returns the bitmap and the source size. */
export async function decodeBounded(file,options){
 const {edge=PREVIEW_MAX_EDGE,signal}=options||{};
 if(!(file instanceof Blob))throw Error('Choose a photo.');
 if(file.size<8||file.size>CROP_MAX_BYTES)throw Error('Choose a photo smaller than 64 MB.');
 if(typeof createImageBitmap!=='function')throw Error('This browser cannot prepare photos for cropping.');
 signal?.throwIfAborted?.();
 let probe;
 try{probe=await createImageBitmap(file);}
 catch{throw Error('This photo could not be read. Try a JPEG or PNG copy.');}
 const width=probe.width,height=probe.height;
 try{
  if(!(width>0&&height>0))throw Error('This photo could not be read.');
  if(width*height>CROP_MAX_PIXELS)throw Error('This photo is too large to open. Resize a copy and try again.');
  const target=scaleTo(width,height,edge);
  if(!target)return {bitmap:probe,width,height,scale:1,detached:false};
  const bounded=await createImageBitmap(probe,{resizeWidth:target.width,resizeHeight:target.height,resizeQuality:'high'});
  probe.close?.();
  return {bitmap:bounded,width,height,scale:bounded.width/width,detached:true};
 }catch(error){probe.close?.();throw error;}
}

function paint(bitmap,width,height){
 const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
 const context=canvas.getContext('2d');
 if(!context)throw Error('This browser could not prepare the photo.');
 context.drawImage(bitmap,0,0,width,height);
 return canvas;
}

async function encode(canvas,type='image/png'){
 if(canvas.convertToBlob)return canvas.convertToBlob({type});
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('This browser could not prepare the photo.')),type));
}

/** A bounded preview of the chosen file, for display and for picking the crop. */
export async function previewPhoto(file,options){
 const {bitmap,width,height,scale,detached}=await decodeBounded(file,options);
 try{
  const canvas=paint(bitmap,bitmap.width,bitmap.height);
  const blob=await encode(canvas,'image/png');
  return {blob,url:URL.createObjectURL(blob),sourceWidth:width,sourceHeight:height,previewWidth:bitmap.width,previewHeight:bitmap.height,scale,resized:detached};
 }finally{bitmap.close?.();}
}

/**
 * Renders `rect` — in the coordinates of the preview that `previewPhoto` returned — from the
 * original file as a square PNG. Cropping from the original rather than from the preview keeps
 * the detail the encoder needs; the decode stays bounded and only the crop reaches output size.
 * `rotation` is a multiple of 90 degrees, applied about the centre of the square.
 */
export async function cropPhoto(file,rect,options){
 const {output=CROP_OUTPUT,previewScale=1,rotation=0,signal}=options||{};
 const {bitmap,scale}=await decodeBounded(file,{edge:Math.max(PREVIEW_MAX_EDGE,output),signal});
 try{
  // Preview coordinates -> this bitmap's coordinates.
  const factor=scale/(previewScale||1);
  const size=Math.max(1,Math.round(Math.min(rect.width,rect.height)*factor));
  const left=Math.min(Math.max(0,Math.round(rect.left*factor)),Math.max(0,bitmap.width-size));
  const top=Math.min(Math.max(0,Math.round(rect.top*factor)),Math.max(0,bitmap.height-size));
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(output,output):Object.assign(document.createElement('canvas'),{width:output,height:output});
  const context=canvas.getContext('2d');
  if(!context)throw Error('This browser could not prepare the photo.');
  context.save();
  if(rotation%360){context.translate(output/2,output/2);context.rotate((rotation%360)*Math.PI/180);context.translate(-output/2,-output/2);}
  context.drawImage(bitmap,left,top,Math.min(size,bitmap.width-left),Math.min(size,bitmap.height-top),0,0,output,output);
  context.restore();
  const blob=await encode(canvas,'image/png');
  if(blob.size<8)throw Error('This browser could not prepare the photo.');
  return new File([blob],'cropped.png',{type:'image/png'});
 }finally{bitmap.close?.();}
}
