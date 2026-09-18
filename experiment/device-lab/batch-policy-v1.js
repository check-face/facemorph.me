export const screeningCases=Object.freeze([0,26,28]);
export function screenPassed(row){return row?.completed===true&&!row.error&&row.checks?.length===3&&row.checks.every((x,i)=>x.caseIndex===screeningCases[i]&&x.passed===true&&Number.isFinite(x.inferenceMs)&&x.inferenceMs>0)&&row.hybridStats?.drawCalls>0;}
export function decideNext({candidates,results}){
 if(!Array.isArray(candidates)||!candidates.length||candidates.length>4||new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('Expected one to four distinct research candidates');
 if(new Set(results.map(r=>r.id)).size!==results.length)throw Error('Duplicate candidate results');
 for(const r of results){if(!candidates.some(c=>c.id===r.id))throw Error('Unknown candidate result');if(!screenPassed(r))return {action:'stop',reason:'A candidate failed or was interrupted. Saved partials remain; explicit retry required.'};}
 const next=candidates.find(c=>!results.some(r=>r.id===c.id));if(next)return {action:'screen',candidate:next};
 const ranked=results.map(r=>{const ms=r.checks.slice(1).map(x=>x.inferenceMs).sort((a,b)=>a-b);return {id:r.id,screeningMs:(ms[0]+ms[1])/2};}).sort((a,b)=>a.screeningMs-b.screeningMs);
 return {action:'qualify-all31',candidate:candidates.find(c=>c.id===ranked[0].id),ranked,scope:'Short-screen candidate selection only; no paired speedup or photo-workflow qualification'};
}
