/** A failed pinned reference must stop the caller before it encodes user input. */
export async function qualifyEncoderReference({config,manifestSha256,execute,acquireBytes,onProgress=()=>{}}){
 const canary=config.canaries?.find(c=>c.id==='seed-0-aligned');
 if(!canary||canary.input?.size!==196608*4||canary.reference?.size!==9216*4)throw Error('The pinned photo encoder reference is missing.');
 const started=performance.now();onProgress({stage:'encoder-correctness-check',name:canary.id});
 const inputBytes=await acquireBytes(canary.input),referenceBytes=await acquireBytes(canary.reference);
 if(inputBytes.byteLength!==196608*4||referenceBytes.byteLength!==9216*4)throw Error('Invalid photo encoder reference dimensions.');
 const tensor=new Float32Array(inputBytes.buffer,inputBytes.byteOffset,196608),reference=new Float32Array(referenceBytes.buffer,referenceBytes.byteOffset,9216);
 if(!tensor.every(Number.isFinite)||!reference.every(Number.isFinite))throw Error('Invalid photo encoder reference values.');
 const result=await execute(tensor);let maxAbs=0;
 if(!(result.values instanceof Float32Array)||result.values.length!==9216)throw Error('Photo encoder correctness check returned invalid W+.');
 for(let i=0;i<9216;i++)maxAbs=Math.max(maxAbs,Math.abs(result.values[i]-reference[i]));
 if(!Number.isFinite(maxAbs)||maxAbs>.0001)throw Error(`Photo encoder correctness check failed (${canary.id}). Your photo was not encoded.`);
 const qualification={passed:true,manifestSha256,sourceEncoderSha256:config.sourceEncoderSha256,canaryId:canary.id,maxAbs,tolerance:.0001,elapsedMs:performance.now()-started,wasmPeakBytes:result.encoderStats?.wasmPeakBytes,referenceBufferBytes:inputBytes.byteLength+referenceBytes.byteLength+result.values.byteLength};
 onProgress({stage:'encoder-correctness-complete',...qualification});return qualification;
}
