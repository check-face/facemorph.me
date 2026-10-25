/** Pick the first eligible request without dropping skipped or later requests.
 * A morph or blend waits for photo decisions/preparation; unrelated faces can pass those blockers.
 * Request order is preserved across face and morph actions, preventing a stream of newly
 * queued faces from overtaking an already eligible morph. Heavy execution remains serial.
 */
export function nextScheduled(jobs,{busy=false,blockedFaces=[],blockMorph=false}={}){
 if(busy||jobs.some(job=>job.phase==='compute'))return -1;
 const blocked=new Set(blockedFaces);
 return jobs.findIndex(job=>(!job.phase||job.phase==='queued')&&(job.kind==='face'?!blocked.has(job.id):job.kind==='morph'||job.kind==='blend'?!blockMorph:job.kind==='faces'||job.kind==='import'));
}
