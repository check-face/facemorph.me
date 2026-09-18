// An application allocation allowance, never a browser free-memory/cap measurement.
export class MemoryBudgetError extends Error{constructor(message,details){super(message);this.name='MemoryBudgetError';this.details=details;}}
const valid=n=>Number.isSafeInteger(n)&&n>=0;
export function createMemoryLedger({budgetBytes,reserveBytes}){
 if(!valid(budgetBytes)||!valid(reserveBytes)||budgetBytes<=reserveBytes)throw Error('Invalid memory allowance');
 const allocations=new Map();let peak=0;
 function snapshot(){const byKind={};let trackedBytes=0;for(const x of allocations.values()){trackedBytes+=x.bytes;byKind[x.kind]=(byKind[x.kind]||0)+x.bytes;}return {budgetBytes,reserveBytes,trackedBytes,peakTrackedBytes:peak,remainingAllowanceBytes:budgetBytes-reserveBytes-trackedBytes,byKind,scope:'Accounted allocations plus policy reserve; not RSS, free memory, or a proven iOS kill threshold'};}
 function reserve(id,bytes,kind){if(typeof id!=='string'||!id||allocations.has(id)||!valid(bytes)||!['js','gpu','wasm-capacity','pending-gpu'].includes(kind))throw Error('Invalid or duplicate allocation');const state=snapshot();if(bytes>state.remainingAllowanceBytes)throw new MemoryBudgetError('Next allocation exceeds application memory allowance',{...state,id,requestedBytes:bytes,kind});allocations.set(id,{bytes,kind});peak=Math.max(peak,state.trackedBytes+bytes);return snapshot();}
 function release(id,{gpuWorkCompleted=false,workerDestroyed=false}={}){const x=allocations.get(id);if(!x)throw Error('Unknown allocation');if(x.kind==='wasm-capacity'&&!workerDestroyed)throw Error('WASM capacity remains reserved until worker destruction');if((x.kind==='gpu'||x.kind==='pending-gpu')&&!gpuWorkCompleted){x.kind='pending-gpu';return snapshot();}allocations.delete(id);return snapshot();}
 return {reserve,release,snapshot};
}
export function chooseTile(plans,{budgetBytes,reserveBytes,persistentBytes}){if(![budgetBytes,reserveBytes,persistentBytes].every(valid))throw Error('Invalid tile allowance');for(const p of [...plans].sort((a,b)=>b.rows-a.rows)){if(!Number.isSafeInteger(p.rows)||p.rows<1||!valid(p.scratchBytes))throw Error('Invalid tile plan');if(persistentBytes+p.scratchBytes+reserveBytes<=budgetBytes)return p;}return null;}
