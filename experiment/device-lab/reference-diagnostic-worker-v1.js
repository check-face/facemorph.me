import {decodeReferencePng} from './png-reference-v1.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
function difference(a,b){
 if(a.length!==b.length)throw Error('Reference comparison length mismatch');
 let maxRgb=0,unequalRgbChannels=0,maxAlpha=0;
 for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(i%4===3)maxAlpha=Math.max(maxAlpha,d);else{maxRgb=Math.max(maxRgb,d);if(d)unequalRgbChannels++;}}
 return {maxRgb,unequalRgbChannels,maxAlpha};
}
async function nativeReads(png,raw,width,height){
 let bitmap;
 try{
  bitmap=await createImageBitmap(new Blob([png],{type:'image/png'}));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D canvas unavailable');
  ctx.drawImage(bitmap,0,0);
  const first=ctx.getImageData(0,0,width,height).data,second=ctx.getImageData(0,0,width,height).data;
  return {available:true,firstSha256:await hash(first),secondSha256:await hash(second),versusRaw:difference(first,raw),repeatedRead:difference(second,first)};
 }catch(error){return {available:false,error:String(error)};}finally{bitmap?.close();}
}
onmessage=async({data:cfg})=>{
 const result={id:cfg.id,kind:'reference-diagnostic',diagnosticOnly:true,checks:[],nativeComparisons:[],scope:'Reference decoder and browser canvas comparison only; no inference or device qualification. Differences do not change RGB1/float0.002 admission.'};
 try{
  if(!Array.isArray(cfg.fixtures)||cfg.fixtures.length!==2)throw Error('Expected two pinned diagnostic fixtures');
  for(const fixture of cfg.fixtures){
   postMessage({progress:'Checking reference bytes · '+fixture.name});
   const response=await fetch(fixture.path);if(!response.ok)throw Error(fixture.path+' HTTP '+response.status);
   const png=await response.arrayBuffer();if(await hash(png)!==fixture.pngSha256)throw Error('Diagnostic PNG hash mismatch: '+fixture.name);
   const decoded=await decodeReferencePng(png,{expectedWidth:fixture.width,expectedHeight:fixture.height});
   const rawSha256=await hash(decoded.rgba),passed=rawSha256===fixture.rgbaSha256;
   result.checks.push({name:fixture.name,passed,decoder:decoded.decoder,rawSha256,expectedSha256:fixture.rgbaSha256});
   postMessage({checkpoint:result});if(!passed)throw Error('Canonical decoder mismatch: '+fixture.name);
   const first=await nativeReads(png,decoded.rgba,fixture.width,fixture.height),second=await nativeReads(png,decoded.rgba,fixture.width,fixture.height);
   result.nativeComparisons.push({name:fixture.name,attempts:[first,second],repeatDecodeHashEqual:first.available&&second.available?first.firstSha256===second.firstSha256:null});
   postMessage({checkpoint:result});
  }
  result.nativeComparisonAvailable=result.nativeComparisons.every(x=>x.attempts.every(a=>a.available));
  result.nativeDiffers=result.nativeComparisons.some(x=>x.attempts.some(a=>a.available&&(a.versusRaw.maxRgb>0||a.versusRaw.maxAlpha>0)));
  result.nativeReadbackUnstable=result.nativeComparisons.some(x=>x.repeatDecodeHashEqual===false||x.attempts.some(a=>a.available&&(a.repeatedRead.maxRgb>0||a.repeatedRead.maxAlpha>0)));
  result.progress=!result.nativeComparisonAvailable?'Raw decoder exact; native comparison unavailable':result.nativeDiffers?'Raw decoder exact; native canvas differs':'Raw decoder exact; native canvas matches';
  result.completed=true;
 }catch(error){result.completed=false;result.error=String(error);}
 postMessage({done:true,row:result});
};
