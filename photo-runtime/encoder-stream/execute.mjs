/** Sequential unchanged e4e graphs. The caller owns and terminates the Worker. */
const TYPE={FLOAT:['float32',Float32Array],INT64:['int64',BigInt64Array],INT32:['int32',Int32Array],BOOL:['bool',Uint8Array]};
const bytesOf=state=>[...state.values()].reduce((sum,x)=>sum+x.data.byteLength,0);
const sameShape=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export async function executeEncoderStream({ort,manifest,tensor,acquireBytes,snapshotMemory,onProgress=()=>{},signal}){
 if(manifest.kind!=='e4e-onnx-sequential-shards-v1'||manifest.sourceEncoderSha256!=='d525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1'||manifest.maxShardBytes>17*1024*1024||manifest.maxLiveBoundaryBytes>16*1024*1024||!Array.isArray(manifest.steps)||manifest.steps.length!==108)throw Error('Unsupported streamed encoder schedule.');
 if(!(tensor instanceof Float32Array)||tensor.length!==196608||!tensor.every(Number.isFinite))throw Error('Invalid prepared photo tensor.');
 const state=new Map([['image',{data:tensor,shape:[1,3,256,256],dtype:'FLOAT'}]]),stats={provider:'wasm-unshared-streamed',sourceEncoderSha256:manifest.sourceEncoderSha256,steps:[],maxLiveSessions:0,liveSessions:0,wasmPeakBytes:0,jsBoundaryPeakBytes:tensor.byteLength,receivedShardBytes:0,receivedBytesScope:'Bytes materialized from verified persistent cache or HTTP; not network traffic',maxShardBytes:manifest.maxShardBytes,heapScope:'Actual ORT linear-memory capacity; not process RSS',hardWasmMaximumBytes:268435456};
 const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Encoding cancelled','AbortError');};
 const memory=stage=>{const m=snapshotMemory(stage);if(!m?.available||m.shared!==false||!Number.isSafeInteger(m.currentBytes)||m.currentBytes<=0||m.currentBytes>stats.hardWasmMaximumBytes)throw Error('Bounded unshared encoder memory could not be verified.');stats.wasmPeakBytes=Math.max(stats.wasmPeakBytes,m.currentBytes);return m;};
 try{for(const step of manifest.steps){check();let session,outputs,primary,modelBytes;const feeds={},row={id:step.id};const begin=performance.now();
  try{
   onProgress({stage:'encoder-shard-acquisition',loaded:step.id,total:manifest.steps.length,stats});
   modelBytes=await acquireBytes(step);check();if(!(modelBytes instanceof Uint8Array)||modelBytes.byteLength!==step.size||step.size>manifest.maxShardBytes)throw Error('Encoder shard size mismatch.');stats.receivedShardBytes+=modelBytes.byteLength;row.acquireMs=performance.now()-begin;
   const createAt=performance.now();session=await ort.InferenceSession.create(modelBytes,{executionProviders:['wasm'],enableCpuMemArena:false,enableMemPattern:false,extra:{session:{disable_prepacking:'1'}}});stats.liveSessions++;stats.maxLiveSessions=Math.max(stats.maxLiveSessions,stats.liveSessions);modelBytes=null;row.createMs=performance.now()-createAt;memory('after-create');check();
   for(const spec of step.inputs){const value=state.get(spec.name),type=TYPE[spec.dtype];if(!type||!value||value.dtype!==spec.dtype||!(value.data instanceof type[1])||!sameShape(value.shape,spec.shape))throw Error('Encoder boundary input mismatch: '+spec.name);feeds[spec.name]=new ort.Tensor(type[0],value.data,spec.shape);}
   const runAt=performance.now();outputs=await session.run(feeds);row.runMs=performance.now()-runAt;memory('after-run');check();
   for(const spec of step.outputs){const value=outputs[spec.name],type=TYPE[spec.dtype];if(!type||!value||value.type!==type[0]||!sameShape(value.dims,spec.shape))throw Error('Encoder boundary output mismatch: '+spec.name);const raw=await value.getData();if(!(raw instanceof type[1]))throw Error('Encoder output storage mismatch.');const copy=new type[1](raw);if(spec.dtype==='FLOAT'&&!copy.every(Number.isFinite))throw Error('Nonfinite encoder output.');state.set(spec.name,{data:copy,shape:spec.shape,dtype:spec.dtype});}
   const live=bytesOf(state);if(live!==step.liveBoundaryBytesBeforeRelease||live>manifest.maxLiveBoundaryBytes)throw Error('Encoder boundary allocation schedule mismatch.');stats.jsBoundaryPeakBytes=Math.max(stats.jsBoundaryPeakBytes,live);
   for(const name of step.releaseAfter)state.delete(name);
  }catch(error){primary=error instanceof Error?error:Error(String(error));}
  finally{
   const errors=[];for(const value of Object.values(outputs||{}))try{value.dispose();}catch(e){errors.push(String(e));}for(const value of Object.values(feeds))try{value.dispose();}catch(e){errors.push(String(e));}
   if(session)try{await session.release();}catch(e){errors.push(String(e));}finally{stats.liveSessions--;}
   modelBytes=null;outputs=null;session=null;if(errors.length){stats.cleanupErrors=[...(stats.cleanupErrors||[]),...errors];primary ||= Error('Encoder resources did not release cleanly.');}
  }
  row.totalMs=performance.now()-begin;stats.steps.push(row);if(primary)throw primary;memory('after-release');onProgress({stage:'encoder-shard-complete',loaded:step.id+1,total:manifest.steps.length,stats});
 }
 check();const output=state.get('w');if(state.size!==1||!output||output.dtype!=='FLOAT'||!sameShape(output.shape,[1,18,512])||output.data.length!==9216)throw Error('Invalid final encoder W+.');stats.completed=true;stats.managedPeakEstimateBytes=stats.wasmPeakBytes+stats.jsBoundaryPeakBytes+stats.maxShardBytes+24*1024*1024+64*1024*1024;stats.estimateScope='WASM capacity plus maximum JS boundaries, one shard,24MiB runtime assets and64MiB overhead reserve; not physical RSS or an OS guarantee';return{values:output.data,shape:[1,18,512],space:'w-plus',encoderProvider:stats.provider,encoderStats:stats};
 }catch(thrown){const error=thrown instanceof Error?thrown:Error(String(thrown));error.encoderStats=stats;throw error;}finally{state.clear();}
}
