// Observe actual presented frames during a short sequential playback; no seeked/canvas race.
export async function checkMP4(bytes,{width,height,frames,fps}){
 const url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
 const result={visibilityAtStart:document.visibilityState,method:'presented-frames-v1',passed:false,attempts:[]};
 try{
  for(let attempt=0;attempt<2;attempt++){
   const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.style.width='256px';video.setAttribute('aria-label','FFmpeg compatibility playback');document.querySelector('#status').after(video);
   const row={visibilityAtStart:document.visibilityState,presented:[]};result.attempts.push(row);let callback,timer;
   try{
    result.canPlayType=video.canPlayType('video/mp4; codecs="avc1.42E01E"');
    if(!video.requestVideoFrameCallback)throw Error('Presented-frame verification unavailable in this browser');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    await new Promise((resolve,reject)=>{
     let ended=false;const finish=error=>{if(ended)return;ended=true;clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback(callback);video.pause();error?reject(error):resolve();};
     timer=setTimeout(()=>finish(Error('Presented-frame playback timed out')),15000);
     video.onerror=()=>finish(Error('Browser video error '+video.error?.code));video.onended=()=>finish(Error('Playback ended before both reference frames were observed'));
     const next=(now,m)=>{
      if(ended)return;row.presented.push({mediaTime:m.mediaTime,currentTime:video.currentTime,presentedFrames:m.presentedFrames,visibility:document.visibilityState});if(row.presented.length>32)row.presented.shift();
      const first=Math.abs(m.mediaTime)<.5/fps,last=Math.abs(m.mediaTime-(frames-1)/fps)<.5/fps;
      if(first||last){ctx.drawImage(video,0,0);const pixel=[...ctx.getImageData(480,32,1,1).data];if(first)row.firstPixel=pixel;if(last)row.lastPixel=pixel;}
      if(row.firstPixel&&row.lastPixel){Object.assign(row,{width:video.videoWidth,height:video.videoHeight,duration:video.duration});finish();return;}
      callback=video.requestVideoFrameCallback(next);
     };
     callback=video.requestVideoFrameCallback(next);video.src=url;video.load();video.play().catch(e=>finish(Error('Playback could not start: '+e.message)));
    });
    Object.assign(result,{width:row.width,height:row.height,duration:row.duration,firstPixel:row.firstPixel,lastPixel:row.lastPixel});
    if(row.width!==width||row.height!==height||Math.abs(row.duration-frames/fps)>.1)throw Error('Browser MP4 dimensions/duration mismatch');
    if(row.firstPixel[3]!==255||row.lastPixel[3]!==255||Math.abs(row.firstPixel[2]-64)>15||Math.abs(row.lastPixel[2]-152)>15)throw Error('Browser presented frame content mismatch');
    row.passed=true;result.passed=true;break;
   }catch(e){row.error=String(e);row.passed=false;}
   finally{clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);video.onended=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();video.remove();}
  }
  if(!result.passed)result.error=result.attempts.at(-1)?.error||'Playback verification failed';
 }finally{URL.revokeObjectURL(url);}
 return result;
}
