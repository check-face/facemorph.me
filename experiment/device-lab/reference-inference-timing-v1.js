// Diagnostic inference timing only; call work with prepare/run/queue completion.
export async function measureReferenceInference(work,checkpointWaitMs,{now=()=>performance.now()}={}) {
 const waitBefore=checkpointWaitMs(),started=now();
 await work();
 const elapsedMs=now()-started,checkpointMs=checkpointWaitMs()-waitBefore;
 const valid=Number.isFinite(elapsedMs)&&Number.isFinite(checkpointMs)&&elapsedMs>=0&&checkpointMs>=0&&checkpointMs<=elapsedMs;
 return {inferenceMs:valid?elapsedMs-checkpointMs:null,elapsedMs,checkpointMs,valid};
}
export function referenceMedian(times) {
 const remaining=times.slice(1).filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
 return remaining.length===times.length-1&&remaining.length?remaining[Math.floor(remaining.length/2)]:null;
}
