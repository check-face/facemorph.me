// Metadata plus first/last-frame browser decode; no autoplay permission required.
export async function checkMP4(bytes,{width,height,frames,fps}){
 const video=document.createElement('video'),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
 video.muted=true;video.playsInline=true;video.preload='auto';video.controls=true;video.style.width='256px';video.setAttribute('aria-label','FFmpeg compatibility playback');document.querySelector('#status').after(video);
 const result={canPlayType:video.canPlayType('video/mp4; codecs="avc1.42E01E"'),passed:false};
 const event=name=>new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,ok);video.removeEventListener('error',fail);};
  const ok=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('Browser video error '+video.error?.code));};
  const timer=setTimeout(()=>{cleanup();reject(Error('Browser '+name+' timed out'));},15000);
  video.addEventListener(name,ok,{once:true});video.addEventListener('error',fail,{once:true});
 });
 try{
  const loaded=event('loadeddata');video.src=url;video.load();await loaded;
  Object.assign(result,{width:video.videoWidth,height:video.videoHeight,duration:video.duration});
  if(video.videoWidth!==width||video.videoHeight!==height||Math.abs(video.duration-frames/fps)>0.1)throw Error('Browser MP4 dimensions/duration mismatch');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
  const sample=()=>{ctx.drawImage(video,0,0);return [...ctx.getImageData(480,32,1,1).data];};
  result.firstPixel=sample();const sought=event('seeked');video.currentTime=(frames-1)/fps;await sought;result.lastPixel=sample();
  // At this fixed point the fixture's blue channel rises from 64 to 152.
  if(Math.abs(result.firstPixel[2]-64)>15||Math.abs(result.lastPixel[2]-152)>15)throw Error('Browser decoded frame content mismatch');
  result.passed=true;
 }catch(e){result.error=String(e);}
 finally{video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);}
 return result;
}
