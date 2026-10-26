// A crop the person confirmed with "Use this crop" is encoded as it stands (fm-6ib8, crop.fix). Detection only
// proposes a crop before OK; after it, the approved pixels get the confirmed-crop policy's single derivation
// (@facemorph/stylegan-js deriveEncoderInput) and go straight to e4e, with no detector, alignment or warp. The frozen
// ConfirmedCrop record travels with the cropped File, so the runtime finds it wherever the file goes, and the derived
// tensor is kept, so a retry reuses it rather than deriving again.
import {createConfirmedCrop,deriveEncoderInput,CROP_PREPROCESSING_POLICY_V1} from '@facemorph/stylegan-js';
import {cropPhoto} from './crop.mjs';

// The closed set of terminal outcomes for an eligible confirmed crop, each with plain recovery text. A cancelled
// attempt stays an AbortError (the bridge reports it as cancelled), carrying code 'cancelled'.
const RECOVERY={
 'unsupported-pixels':'This crop could not be read. Choose the photo again, or try a JPEG or PNG copy.',
 'over-limit':'This photo is too large to encode. Resize a copy and try again.',
 'encoder-unavailable':'The photo encoder could not be loaded. Check your connection, then try Encode image again.',
 'encoder-invalidated':'The photo encoder files changed or were removed. Try Encode image again.',
};
export class ConfirmedCropError extends Error{
 constructor(code,cause){super(RECOVERY[code],cause?{cause}:undefined);this.name='ConfirmedCropError';this.code=code;}
}

const records=new WeakMap();
let revision=0;

const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');

/** cropPhoto, then the frozen record over the approved pixels: each OK (or Adjust Crop) is a new revision. */
export async function confirmCrop(file,rect,options){return confirmCropped(await cropPhoto(file,rect,options),options?.output??1024);}

/** Records `cropped` (the size x size square the person approved) as a new confirmed crop and returns it. */
export async function confirmCropped(cropped,size=1024){
 const bytes=await cropped.arrayBuffer();
 const crop=createConfirmedCrop({sourceRevision:++revision,sourceDigest:hex(await crypto.subtle.digest('SHA-256',bytes)),
  rect:{left:0,top:0,width:size,height:size},rotationDegrees:0,exifOrientation:1,exifApplied:false,
  policyVersion:CROP_PREPROCESSING_POLICY_V1.version,policyParams:CROP_PREPROCESSING_POLICY_V1});
 records.set(cropped,{crop,input:null});
 return cropped;
}

/** The ConfirmedCrop a file was confirmed with, or undefined for a file that was never through crop OK. */
export function confirmedCropOf(file){return file&&typeof file==='object'?records.get(file)?.crop:undefined;}

async function sourcePixels(file){
 let bitmap;
 try{bitmap=await createImageBitmap(file,{colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});}
 catch(error){throw new ConfirmedCropError('unsupported-pixels',error);}
 try{
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(bitmap.width,bitmap.height):Object.assign(document.createElement('canvas'),{width:bitmap.width,height:bitmap.height});
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new ConfirmedCropError('unsupported-pixels');
  context.drawImage(bitmap,0,0);
  const {width,height,data}=context.getImageData(0,0,bitmap.width,bitmap.height,{colorSpace:'srgb'});
  return {width,height,data};
 }finally{bitmap.close?.();}
}

/** The encoder input of a confirmed file, derived once from its decoded pixels and kept for retries. */
export function encoderInputFor(file){
 const entry=records.get(file);
 if(!entry)throw Error('This photo was not confirmed with a crop.');
 entry.input||=(async()=>{
  const pixels=await sourcePixels(file);
  try{return deriveEncoderInput(pixels,entry.crop);}
  catch(error){throw new ConfirmedCropError(error?.code==='source-too-large'?'over-limit':'unsupported-pixels',error);}
 })();
 // A failed derivation is not kept: the next attempt (an explicit retry) derives again.
 entry.input.catch(()=>{if(records.get(file)===entry)entry.input=null;});
 return entry.input;
}
