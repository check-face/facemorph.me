// e4e photo-pipeline coverage for the device lab (e4e-coverage-v1.json stages):
// decode_alignment -> e4e -> reconstruction1024 -> original_cache -> repeat -> failure_recovery.
//
// Latent-first survival: the photo->latent (encoder/e4e W+) result is checkpointed to the
// result collector, and acknowledged saved, BEFORE the long synthesis stage starts, so a
// tab kill loses at most the synthesis, never the expensive latent work. On resume the
// worker receives the checkpointed stages and repeats neither the download nor the encode;
// recovered stage timings are flagged and never enter fresh timing medians.
//
// Policy (e4e-coverage-v1.json): synthesis or MP4 passes never establish e4e support.
// Providers are recorded independently (encoder vs synthesis); pending/failed are not passes.
const base='/review-artifacts/browser-onnx-e4e/';
const synthesisModel='/review-artifacts/browser-onnx-energy/synthesis-spatial.onnx';
const FIXES={encoderSha256:'d525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1',inputTensorSha256:'c0d64d85992110c59dbbc6b4c0a086852dcc8c1b554a0fd3aaedcbede0f29ea0',torchWSha256:'9d7fa5865a77fb52d406996d8627afbcb344921a75032353c687dccd1947ec3d',torchImageSha256:'48801a11371948f6b16549617cd116623bad1effb9f56a3cac147318d8498254'};
const GATES={sampledFloatMax:.002,rgbMax:1};
let stopped=false;
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const b64=buffer=>{const u=new Uint8Array(buffer);let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(s);};
const unb64=s=>{const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;};
const f32=async url=>new Float32Array(await(await fetch(url)).arrayBuffer());
const med=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];

async function main(cfg){
 const stages={},ackWaiters=new Map(),freshTimings={},recoveredTimings={};
 let encoderRuns=0,encoderSessions=0,cacheHits=0,cache=null,ortSession=null,synthesisSession=null,ort=null;
 const progress=message=>{if(!stopped)postMessage({progress});};
 const meta=m=>{if(!stopped)postMessage({meta:m});};
 // Every 15s a heartbeat message resets the browser watchdog and is saved as the
 // per-case heartbeat so the collector can tell a live run from an evicted tab.
 const heartbeat=setInterval(()=>{if(!stopped)postMessage({meta:{heartbeat:true,at:new Date().toISOString()}});},15000);
 const checkpoint=(stage,evidence,{latent=null,awaitAck=false}={})=>{
  stages[stage]={...evidence,checkpointedAt:new Date().toISOString()};
  const id=crypto.randomUUID?.()||String(Math.random());
  const message={checkpoint:{stages:structuredClone(stages)},checkpointId:id,awaitAck,latentStage:latent?stage:null,latent};
  postMessage(message,latent?[latent]:[]);
  return awaitAck?new Promise(resolve=>ackWaiters.set(id,resolve)):Promise.resolve({saved:true});
 };
 addEventListener('message',({data})=>{if(data?.type==='checkpoint-ack'&&ackWaiters.has(data.id)){const resolve=ackWaiters.get(data.id);ackWaiters.delete(data.id);resolve(data);}});
 const timed=async work=>{const t=performance.now();const out=await work();return {out,ms:performance.now()-t};};
 const record=(stage,ms,recovered=false)=>{(recovered?recoveredTimings:freshTimings)[stage]??=[];(recovered?recoveredTimings:freshTimings)[stage].push(ms);};

 try{
  const resumed=cfg.resume?.stages&&typeof cfg.resume.stages==='object'?cfg.resume.stages:{};
  for(const [name,evidence] of Object.entries(resumed))if(evidence&&typeof evidence==='object')stages[name]={...structuredClone(evidence),recovered:true};

  const ortRuntime=async()=>{
   if(ort)return ort;
   const mod=await import('../onnx/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs');
   ort=mod;ort.env.wasm.numThreads=crossOriginIsolated?Math.min(4,navigator.hardwareConcurrency||1):1;ort.env.wasm.wasmPaths='/facemorph.me/experiment/onnx/node_modules/onnxruntime-web/dist/';
   meta({ortRuntime:{threads:ort.env.wasm.numThreads,provider:'wasm',crossOriginIsolated}});
   return ort;
  };

  // ---- Stage 1: decode_alignment -------------------------------------------------------
  // The dlib alignment itself ran offline in Python (recorded, not re-run in browser);
  // this stage proves the browser decodes the aligned 256px crop and reproduces the exact
  // preprocessed tensor the exported encoder expects. Cheap and download-free, so on
  // resume it is re-executed locally and only flagged as recovered evidence.
  const decodeAlignment=async()=>{
   const aligned=await fetch(base+'aligned.png').then(r=>{if(!r.ok)throw Error('aligned.png HTTP '+r.status);return r.arrayBuffer();});
   const {decodeReferencePng}=await import('./png-reference-v1.js');
   const decoded=await decodeReferencePng(aligned,{expectedWidth:256,expectedHeight:256});
   const canvas=new OffscreenCanvas(256,256),ctx=canvas.getContext('2d',{willReadFrequently:true});
   const bitmap=await createImageBitmap(new Blob([aligned],{type:'image/png'}));
   ctx.drawImage(bitmap,0,0);bitmap.close();
   const rgba=ctx.getImageData(0,0,256,256).data;
   let decodeMaxRgb=0;for(let i=0;i<decoded.rgba.length;i++)decodeMaxRgb=Math.max(decodeMaxRgb,Math.abs(rgba[i]-decoded.rgba[i]));
   if(decodeMaxRgb>1)throw Error('Canvas PNG decode differs from byte-exact decoder by RGB '+decodeMaxRgb);
   const tensor=new Float32Array(3*256*256);
   for(let y=0;y<256;y++)for(let x=0;x<256;x++){const p=(y*256+x)*4;for(let c=0;c<3;c++)tensor[c*65536+y*256+x]=((rgba[p+c]/255)-.5)/.5;}
   const expected=await f32(base+'input.f32');
   let maxFloat=0;for(let i=0;i<expected.length;i++)maxFloat=Math.max(maxFloat,Math.abs(tensor[i]-expected[i]));
   if(maxFloat>GATES.sampledFloatMax)throw Error('Preprocessed input tensor differs from recorded reference by '+maxFloat+' (gate '+GATES.sampledFloatMax+')');
   const tensorSha=await sha256(expected.buffer);
   if(tensorSha!==FIXES.inputTensorSha256)throw Error('input.f32 sha256 mismatch: '+tensorSha);
   return {tensor,maxFloat,tensorSha};
  };
  let inputTensor;
  if(stages.decode_alignment?.passed){
   ({tensor:inputTensor}=await timed(decodeAlignment).then(r=>{record('decode_alignment',r.ms,true);return {tensor:r.out.tensor};}));
  }else{
   const {out,ms}=await timed(decodeAlignment);
   inputTensor=out.tensor;
   record('decode_alignment',ms);
   await checkpoint('decode_alignment',{passed:true,maxFloat:out.maxFloat,inputTensorSha256:out.tensorSha,alignmentProvider:'offline Python dlib (recorded; not re-run)',decodeProvider:'browser byte-exact PNG decoder + canvas'});
  }

  // ---- Stage 2: e4e (photo -> W+ latent) ----------------------------------------------
  // 1.07 GB encoder: streamed with progress, hash-verified, CPU WASM session. The latent
  // is checkpointed and acknowledged BEFORE any synthesis work starts (latent-first).
  let w=null;
  const latentFromCheckpoint=async()=>{
   const s=stages.e4e;if(!s?.latentB64)return null;
   const bytes=unb64(s.latentB64);if(await sha256(bytes.buffer)!==s.latentSha256)throw Error('Checkpointed latent failed hash verification; re-encoding');
   return new Float32Array(bytes.buffer);
  };
  if(stages.e4e?.passed&&(w=await latentFromCheckpoint())){
   record('e4e',0,true);
   cache={latent:w.slice(0),latentSha256:stages.e4e.latentSha256};
  }else{
   const manifest=await fetch(base+'manifest.json').then(r=>r.json());
   progress('Streaming encoder ('+Math.round(manifest.encoder_bytes/1048576)+' MiB)');
   const response=await fetch(base+'encoder.onnx');if(!response.ok)throw Error('encoder.onnx HTTP '+response.status);
   const total=Number(response.headers.get('Content-Length'))||manifest.encoder_bytes,parts=[];let received=0,lastReport=0;
   const reader=response.body.getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);received+=value.byteLength;if(received-lastReport>32*1048576){lastReport=received;progress('Encoder download '+Math.round(received/1048576)+'/'+Math.round(total/1048576)+' MiB');}}
   const modelBytes=await new Blob(parts).arrayBuffer();parts.length=0;
   const modelSha=await sha256(modelBytes);
   if(modelSha!==FIXES.encoderSha256)throw Error('encoder.onnx sha256 mismatch: '+modelSha);
   meta({encoder:{bytes:modelBytes.byteLength,sha256:modelSha,expectedSha256:FIXES.encoderSha256}});
   const ortMod=await ortRuntime();
   progress('Creating encoder session (CPU WASM; large model, this can take minutes)');
   encoderSessions++;
   ortSession=await ortMod.InferenceSession.create(modelBytes,{executionProviders:['wasm']});
   progress('Running e4e encoder');
   encoderRuns++;
   const {out:encoded,ms:encodeMs}=await timed(async()=>{
    const results=await ortSession.run({[ortSession.inputNames[0]]:new ortMod.Tensor('float32',inputTensor,[1,3,256,256])});
    return results[ortSession.outputNames[0]].data;
   });
   w=Float32Array.from(encoded);
   const torchW=await f32(base+'torch-w.f32');
   const torchWSha=await sha256(torchW.buffer);
   if(torchWSha!==FIXES.torchWSha256)throw Error('torch-w.f32 sha256 mismatch: '+torchWSha);
   let maxFloat=0;for(let i=0;i<torchW.length;i++)maxFloat=Math.max(maxFloat,Math.abs(w[i]-torchW[i]));
   const latentSha=await sha256(w.buffer);
   const passed=maxFloat<=GATES.sampledFloatMax;
   record('e4e',encodeMs);
   // LATENT-FIRST CHECKPOINT: acknowledged save before any synthesis work.
   const ack=await checkpoint('e4e',{passed,maxFloat,latentSha256:latentSha,encoderProvider:'onnxruntime-web wasm (CPU)',encoderMs:encodeMs,gate:GATES.sampledFloatMax,scope:'browser ORT encoder versus recorded Torch reference; providers recorded independently'},{latent:w.buffer.slice(0),awaitAck:true});
   if(!passed)throw Error('e4e latent differs from recorded Torch reference by '+maxFloat+' (gate '+GATES.sampledFloatMax+')');
   if(!ack?.saved)meta({latentCheckpoint:'not confirmed by server; outbox retry holds it'});
   if(stopped){clearInterval(heartbeat);return;}
   cache={latent:w.slice(0),latentSha256:latentSha};
  }
  const latentOf=()=>cache?.latent||w;

  // ---- Stage 3: reconstruction1024 ----------------------------------------------------
  if(!stages.reconstruction1024?.passed){
   progress('Loading synthesis model (CPU WASM spatial graph)');
   const ortMod=await ortRuntime();
   if(!synthesisSession)synthesisSession=await ortMod.InferenceSession.create(synthesisModel,{executionProviders:['wasm']});
   const {out:raw,ms:reconstructMs}=await timed(async()=>{
    const results=await synthesisSession.run({w:new ortMod.Tensor('float32',latentOf(),[1,18,512])});
    return results.image.data;
   });
   const torchImage=await f32(base+'torch-image.f32');
   let maxFloat=0,finite=true;for(let i=0;i<torchImage.length;i++){if(!Number.isFinite(raw[i]))finite=false;maxFloat=Math.max(maxFloat,Math.abs(raw[i]-torchImage[i]));}
   const rgb=new Uint8ClampedArray(1024*1024*4);
   for(let p=0;p<1024*1024;p++)for(let c=0;c<3;c++)rgb[p*4+c]=Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(raw[c*1048576+p]*127.5)+128))));
   const torchPng=await fetch(base+'torch-reconstructed.png').then(r=>r.arrayBuffer());
   const {decodeReferencePng}=await import('./png-reference-v1.js');
   const reference=await decodeReferencePng(torchPng,{expectedWidth:1024,expectedHeight:1024});
   let maxRgb=0;for(let i=0;i<rgb.length;i++)maxRgb=Math.max(maxRgb,Math.abs(rgb[i]-reference.rgba[i]));
   const passed=finite&&maxFloat<=GATES.sampledFloatMax&&maxRgb<=GATES.rgbMax;
   record('reconstruction1024',reconstructMs);
   await checkpoint('reconstruction1024',{passed,finite,maxFloat,maxRgb,synthesisProvider:'onnxruntime-web wasm (CPU spatial graph)',synthesisMs:reconstructMs,gates:GATES,encoderRuns});
   if(!passed)throw Error('reconstruction1024 failed gates: maxFloat '+maxFloat+' maxRgb '+maxRgb+' finite '+finite);
   cache={...cache,reconstructionRaw:Float32Array.from(raw)};
  }else record('reconstruction1024',0,true);

  // ---- Stage 4: original_cache --------------------------------------------------------
  // The cached latent must reconstruct byte-identically without touching the encoder again.
  if(!stages.original_cache?.passed){
   const ortMod=await ortRuntime();
   if(!synthesisSession)synthesisSession=await ortMod.InferenceSession.create(synthesisModel,{executionProviders:['wasm']});
   const {out:raw2,ms:reuseMs}=await timed(async()=>{
    const results=await synthesisSession.run({w:new ortMod.Tensor('float32',latentOf(),[1,18,512])});
    return results.image.data;
   });
   cacheHits++;
   const identical=cache.reconstructionRaw.length===raw2.length&&cache.reconstructionRaw.every((v,i)=>Object.is(v,raw2[i]));
   await checkpoint('original_cache',{passed:identical,byteIdentical:identical,cacheHits,encoderRuns,reuseReconstructionMs:reuseMs,cacheKey:cache.latentSha256,scope:'latent cache reuse; encoder run count unchanged'});
   if(!identical)throw Error('Cached latent reconstruction was not byte-identical');
  }

  // ---- Stage 5: repeat ----------------------------------------------------------------
  // Repeat the same input through the encoder: the latent must be identical.
  if(!stages.repeat?.passed){
   const ortMod=await ortRuntime();
   if(!ortSession){
    progress('Re-acquiring encoder for the repeat stage');
    encoderSessions++;
    ortSession=await ortMod.InferenceSession.create(await fetch(base+'encoder.onnx').then(r=>r.arrayBuffer()),{executionProviders:['wasm']});
   }
   progress('Repeat e4e encode with the same input');
   encoderRuns++;
   const {out:w2,ms:repeatMs}=await timed(async()=>{
    const results=await ortSession.run({[ortSession.inputNames[0]]:new ortMod.Tensor('float32',inputTensor,[1,3,256,256])});
    return results[ortSession.outputNames[0]].data;
   });
   const repeatSha=await sha256(new Float32Array(w2).buffer);
   const passed=repeatSha===cache.latentSha256;
   record('repeat',repeatMs);
   await checkpoint('repeat',{passed,repeatMs,repeatLatentSha256:repeatSha,originalLatentSha256:cache.latentSha256,encoderRuns,encoderSessions});
   if(!passed)throw Error('Repeated e4e encode produced a different latent: '+repeatSha);
  }

  // ---- Stage 6: failure_recovery ------------------------------------------------------
  // A malformed input must fail cleanly and leave the session usable.
  if(!stages.failure_recovery?.passed){
   const ortMod=await ortRuntime();
   if(!ortSession){
    progress('Re-acquiring encoder for the failure-recovery stage');
    encoderSessions++;
    ortSession=await ortMod.InferenceSession.create(await fetch(base+'encoder.onnx').then(r=>r.arrayBuffer()),{executionProviders:['wasm']});
   }
   let failedAsExpected=false,failure=null;
   try{await ortSession.run({[ortSession.inputNames[0]]:new ortMod.Tensor('float32',new Float32Array(3*128*128),[1,3,128,128])});}
   catch(e){failedAsExpected=true;failure=String(e).slice(0,500);}
   encoderRuns++;
   const {out:w3,ms:recoveryMs}=await timed(async()=>{
    const results=await ortSession.run({[ortSession.inputNames[0]]:new ortMod.Tensor('float32',inputTensor,[1,3,256,256])});
    return results[ortSession.outputNames[0]].data;
   });
   const recovered=await sha256(new Float32Array(w3).buffer)===cache.latentSha256;
   await checkpoint('failure_recovery',{passed:failedAsExpected&&recovered,failedAsExpected,failure,recoveredLatentMatch:recovered,recoveryMs,encoderRuns,encoderSessions});
   if(!failedAsExpected||!recovered)throw Error('failure_recovery did not demonstrate clean failure + recovery');
  }

  const stageMediansMs={};for(const [k,v] of Object.entries(freshTimings))if(v.length)stageMediansMs[k]=med(v);
  clearInterval(heartbeat);
  postMessage({done:true,completed:true,row:{completed:true,e4eExecuted:true,stages,stageMs:freshTimings,recoveredStageMs:recoveredTimings,stageMediansMs,encoderRuns,encoderSessions,cacheHits,photoWorkflowQualified:false,scope:'Lab coverage only; per-run evidence determines qualification (e4e-coverage-v1.json)'}});
 }catch(e){
  clearInterval(heartbeat);
  postMessage({done:true,completed:false,error:String(e),row:{completed:false,error:String(e),e4eExecuted:stages.e4e?.passed===true,stages,photoWorkflowQualified:false,scope:'Pending/unsupported/failed are not passes (e4e-coverage-v1.json)'}});
 }
}

onmessage=async({data:cfg})=>{
 if(cfg?.stop){stopped=true;return;}
 try{await main(cfg||{});}catch(e){postMessage({done:true,completed:false,error:'e4e worker crashed: '+String(e)});}
};
