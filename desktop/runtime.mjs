/** Shared product adapter for the installed, host-supervised native worker. */
export function createDesktopRuntime({onProgress=()=>{},tauri=globalThis.__TAURI__}={}) {
  if(!tauri?.core?.invoke||!tauri?.event?.listen) throw Error('Desktop bridge unavailable');
  let active,validated=false,disposed=false;
  const abortError=()=>new DOMException('Generation cancelled','AbortError');
  async function operation(type,payload={},options={}) {
    if(disposed)throw Error('Runtime disposed');
    if(active)throw Error('Another generation is still running.');
    if(options.signal?.aborted)throw options.signal.reason||abortError();
    const jobId=crypto.randomUUID(),attemptId=crypto.randomUUID();
    const state={jobId};active=state;
    let unlisten,abort;
    try {
      const result=await new Promise(async(resolve,reject)=>{
        // Every registration/invoke rejection reaches the returned promise.
        try {
          state.reject=reject;
          unlisten=await tauri.event.listen('native-event',({payload:event})=>{
            if(event.jobId!==jobId)return;
            if(event.type==='progress'){try{onProgress(event);options.onProgress?.(event);}catch{}return;}
            if(event.type==='qualified'||event.type==='completed')resolve(event);
            else {validated=false;reject(event.type==='cancelled'?abortError():Error(event.reason||'Native generation failed'));}
          });
          if(disposed||state.cancelled||active!==state){unlisten();reject(abortError());return;}
          abort=()=>{state.cancelled=true;validated=false;tauri.core.invoke('native_cancel',{jobId}).catch(()=>{});reject(options.signal?.reason||abortError());};
          options.signal?.addEventListener('abort',abort,{once:true});
          if(options.signal?.aborted){abort();return;}
          await tauri.core.invoke('native_start',{request:{schemaVersion:1,jobId,type,attemptId,provider:'cpu',...payload}});
        } catch(error){reject(error);}
      });
      if(type==='qualify'){validated=result.deviceValidated===true;if(!validated)throw Error('Native device checks did not pass.');return result;}
      if(result.cacheMiss===true)return {cacheMiss:true};
      const read=file=>tauri.core.invoke('native_read_artifact',{artifactId:result.localArtifactId,file});
      const [json,image]=await Promise.all([read('result.json'),read('image.png')]);
      const bytes=value=>value instanceof ArrayBuffer?new Uint8Array(value):Uint8Array.from(value);
      const data=JSON.parse(new TextDecoder().decode(bytes(json)));
      const values=Float32Array.from(data.values);
      await tauri.core.invoke('native_release_artifact',{artifactId:result.localArtifactId}).catch(()=>onProgress({stage:'transfer-cleanup-pending'}));
      return {...data,values,latent:{space:'w-plus',shape:[18,512],values},blob:new Blob([bytes(image)],{type:'image/png'}),cached:result.cached};
    }finally{unlisten?.();options.signal?.removeEventListener('abort',abort);if(active===state)active=null;}
  }
  async function generateWithAdmission(payload,options={}) {
    if(!validated){const cached=await operation('generate',{...payload,cacheOnly:true},options);if(!cached.cacheMiss)return cached;await operation('qualify',{},options);}
    return operation('generate',payload,options);
  }
  return {
    qualify:(route='cpu',options={})=>{if(route!=='cpu')return Promise.reject(Error('Native GPU qualification is not in this artifact.'));return operation('qualify',{},options);},
    generate:(request,options={})=>generateWithAdmission({operation:'generate',mode:request.mode,value:request.value},{...request,...options}),
    synthesize:(latent,options={})=>{if(latent.space!=='w-plus'||JSON.stringify(latent.shape)!=='[1,18,512]'||latent.values.length!==9216||!Array.from(latent.values).every(Number.isFinite))throw Error('Invalid W+ latent');return generateWithAdmission({operation:'synthesize',values:Array.from(latent.values),persist:options.persist!==false},options);},
    encodePhoto:async(blob,options={})=>{if(!(blob instanceof Blob)||!blob.size||blob.size>25*1024*1024)throw Error('Choose an image smaller than 25 MB.');const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return generateWithAdmission({operation:'encodePhoto',photoBase64:btoa(binary)},options);},
    cancel:()=>{if(active){active.cancelled=true;validated=false;tauri.core.invoke('native_cancel',{jobId:active.jobId}).catch(()=>{});active.reject?.(abortError());}},
    dispose:()=>{disposed=true;validated=false;tauri.core.invoke('native_release').catch(()=>{});active?.reject?.(abortError());},
    status:()=>({route:'cpu',provider:'native-cpu',deviceValidated:validated,busy:!!active,disposed})
  };
}
