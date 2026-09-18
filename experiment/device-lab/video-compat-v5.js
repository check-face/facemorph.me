// A codec pass requires actual presented frames; autoplay policy is recorded separately.
// v5: playback policy is a distinct outcome. NotAllowedError (even after a user gesture)
// and a missed gesture window are recorded as playback-policy-denied / gesture-playback-
// incomplete instead of failing the whole candidate: the H.264 encode itself was already
// verified by the ffmpeg worker, and iOS Low Power Mode denies even muted+playsinline
// autoplay, which is a platform policy, not a codec failure.
export const PLAYBACK_POLICY_DENIED='playback-policy-denied';
export const PLAYBACK_GESTURE_INCOMPLETE='gesture-playback-incomplete';
export const PLAYBACK_UNVERIFIED=new Set([PLAYBACK_POLICY_DENIED,PLAYBACK_GESTURE_INCOMPLETE]);

export async function checkMP4(bytes,{width,height,frames,fps,signal,onProgress=()=>{}}){
 const url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
 const result={visibilityAtStart:document.visibilityState,method:'presented-frames-gesture-v3',passed:false,autoplayBlocked:false,userGestureUsed:false,playbackStatus:signal?.aborted?'cancelled':'checking',attempts:[]};
 const progress=message=>{try{onProgress(message);}catch(error){result.progressError=String(error);}};
 try{
  for(let attempt=0;attempt<2&&!signal?.aborted;attempt++){
   const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.style.width='256px';video.setAttribute('aria-label','FFmpeg compatibility playback');
   // Attributes must precede insertion: some WebKit versions ignore the IDL properties
   // when deciding autoplay eligibility.
   video.setAttribute('muted','');video.setAttribute('playsinline','');
   document.querySelector('#status').after(video);
   const row={visibilityAtStart:document.visibilityState,presented:[]};result.attempts.push(row);let callback,timer,button,abort;
   try{
    result.canPlayType=video.canPlayType('video/mp4; codecs="avc1.42E01E"');
    if(!video.requestVideoFrameCallback)throw Error('Presented-frame verification unavailable in this browser');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    await new Promise((resolve,reject)=>{
     let ended=false;
     const finish=error=>{if(ended)return;ended=true;clearTimeout(timer);button?.remove();if(callback!==undefined)video.cancelVideoFrameCallback(callback);video.pause();error?reject(error):resolve();};
     abort=()=>finish(new DOMException('Playback test cancelled','AbortError'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
     const deadline=(ms,message)=>{clearTimeout(timer);timer=setTimeout(()=>finish(Error(message)),ms);};
     deadline(15000,'Presented-frame playback timed out');
     video.onerror=()=>finish(Error('Browser video error '+video.error?.code));video.onended=()=>finish(Error('Playback ended before both reference frames were observed'));
     const next=(now,m)=>{
      if(ended)return;
      try{
       row.presented.push({mediaTime:m.mediaTime,currentTime:video.currentTime,presentedFrames:m.presentedFrames,visibility:document.visibilityState});if(row.presented.length>32)row.presented.shift();
       const first=Math.abs(m.mediaTime)<.5/fps,last=Math.abs(m.mediaTime-(frames-1)/fps)<.5/fps;
       if(first||last){ctx.drawImage(video,0,0);const pixel=[...ctx.getImageData(480,32,1,1).data];if(first)row.firstPixel=pixel;if(last)row.lastPixel=pixel;}
       if(row.firstPixel&&row.lastPixel){Object.assign(row,{width:video.videoWidth,height:video.videoHeight,duration:video.duration});finish();return;}
       callback=video.requestVideoFrameCallback(next);
      }catch(e){finish(e);}
     };
     const play=gesture=>{
      // Keep this call synchronous in the click handler to retain transient activation.
      let promise;try{promise=video.play();}catch(e){failed(e,gesture);return;}
      Promise.resolve(promise).then(()=>{if(ended){video.pause();return;}deadline(15000,'Presented-frame playback timed out');progress('Checking MP4 presented frames');},e=>failed(e,gesture));
     };
     const failed=(e,gesture)=>{
      if(ended)return;
      if(e?.name==='NotAllowedError'&&!gesture){
       result.autoplayBlocked=true;row.autoplayError={name:e.name,message:e.message};result.playbackStatus='awaiting-user-gesture';
       button=document.createElement('button');button.type='button';button.textContent='Tap to test MP4 playback';video.after(button);
       button.onclick=()=>{if(ended)return;button.disabled=true;result.userGestureUsed=true;row.userGestureUsed=true;result.playbackStatus='checking';deadline(15000,'Presented-frame playback timed out');play(true);button.remove();};
       deadline(60000,'MP4 playback was denied: no user gesture was given within 60 seconds; encode results are still valid');progress('Tap to test MP4 playback');
      }else if(e?.name==='NotAllowedError'){
       // Denied even inside a real user gesture: platform playback policy, not a codec fault.
       row.playbackPolicyDenied={name:e.name,message:e.message,afterGesture:true};result.playbackStatus=PLAYBACK_POLICY_DENIED;finish(Error('MP4 playback policy denied by the platform after a user gesture; encode results are still valid'));
      }else finish(Error('Playback could not start: '+(e?.name||'Error')+': '+String(e?.message??e)));
     };
     callback=video.requestVideoFrameCallback(next);video.src=url;video.load();play(false);
    });
    Object.assign(result,{width:row.width,height:row.height,duration:row.duration,firstPixel:row.firstPixel,lastPixel:row.lastPixel});
    if(row.width!==width||row.height!==height||Math.abs(row.duration-frames/fps)>.1)throw Error('Browser MP4 dimensions/duration mismatch');
    if(row.firstPixel[3]!==255||row.lastPixel[3]!==255||Math.abs(row.firstPixel[2]-64)>15||Math.abs(row.lastPixel[2]-152)>15)throw Error('Browser presented frame content mismatch');
    row.passed=true;result.passed=true;result.playbackStatus='passed';break;
   }catch(e){
    row.error=String(e);row.passed=false;
    if(signal?.aborted)result.playbackStatus='cancelled';
    else if(result.playbackStatus===PLAYBACK_POLICY_DENIED){/* already classified: platform denial */}
    else if(/no user gesture was given/.test(String(e)))result.playbackStatus=PLAYBACK_GESTURE_INCOMPLETE;
    else if(result.autoplayBlocked)result.playbackStatus='gesture-playback-incomplete';
    else result.playbackStatus='failed';
   }
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);button?.remove();if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);video.onended=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();video.remove();}
   if(result.autoplayBlocked)break;
  }
  if(!result.passed&&!PLAYBACK_UNVERIFIED.has(result.playbackStatus))result.error=result.attempts.at(-1)?.error||(signal?.aborted?'Playback test cancelled':'Playback verification failed');
  if(PLAYBACK_UNVERIFIED.has(result.playbackStatus)){result.playbackVerified=false;result.playbackDenied=result.playbackStatus===PLAYBACK_POLICY_DENIED?'Platform denied playback (NotAllowedError'+(result.userGestureUsed?', even after a user gesture':', autoplay and no user gesture')+')':'No user gesture accepted playback; encode results remain valid';}
 }finally{URL.revokeObjectURL(url);}
 return result;
}
