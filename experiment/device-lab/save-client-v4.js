// Credentials stay outside reports. Keep only the newest pending snapshot per run.
export const uuid=()=>crypto.randomUUID?.()||'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
const prefix='facemorph-outbox-v2-';
export class ResultStore{
 constructor({onStatus=()=>{},onRecovered=()=>{},fetcher=(path,options)=>globalThis.fetch(path,options),storage,timeoutMs=15000}={}){
  this.onStatus=onStatus;this.onRecovered=onRecovered;this.fetcher=fetcher;this.timeoutMs=timeoutMs;this.entries=new Map();this.flushing=null;
  try{this.storage=storage===undefined?localStorage:storage;for(let i=0;i<this.storage?.length;i++){const k=this.storage.key(i);if(k?.startsWith(prefix)){try{const e=JSON.parse(this.storage.getItem(k));if(e.report?.runId)this.entries.set(e.report.runId,e);}catch{}}}}catch{this.storage=null;}
 }
 credential(id){try{return this.tokens?.get(id)||this.storage?.getItem('facemorph-write-v1-'+id)||null;}catch{return this.tokens?.get(id)||null;}}
 put(e){e.token??=this.credential(e.report.runId);this.entries.set(e.report.runId,e);try{this.storage?.setItem(prefix+e.report.runId,JSON.stringify(e));}catch{this.onStatus('Local storage is unavailable; keep this tab open until the server confirms saving.',false);}}
 remove(id){this.entries.delete(id);try{this.storage?.removeItem(prefix+id);}catch{}}
 async request(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{const response=await this.fetcher(path,{...options,signal:controller.signal,cache:'no-store'});let data;try{data=await response.json();}catch{throw Error('Results server returned an unexpected response. Reload the current lab URL.');}
   if(!response.ok){const error=Error(data.error||'Results server HTTP '+response.status);error.status=response.status;error.data=data;throw error;}return data;
  }finally{clearTimeout(timer);}
 }
 async reserve(test=false){const r=await this.request('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test})});if(!r.runId||!r.writeToken)throw Error('Results server did not issue a run credential');return r;}
 async start(report){const r=await this.reserve(report.test);report.runId=r.runId;report.revision=0;this.put({token:r.writeToken,report:structuredClone(report)});this.enqueue(report);await this.flush();if(this.entries.has(report.runId))throw Error('Could not confirm the initial save. No experiment has started; reconnect and retry.');return report;}
 enqueue(report){const old=this.entries.get(report.runId);const token=old?.token||this.credential(report.runId);if(!token)throw Error('No credential for this run');report.revision=Math.max(report.revision||0,old?.report.revision||0)+1;this.put({token,report:structuredClone(report)});this.remember(report.runId,token);}
 remember(id,token){this.tokens??=new Map();this.tokens.set(id,token);try{this.storage?.setItem('facemorph-write-v1-'+id,token);}catch{}}
 async recover(e){const old=e.report.runId,r=await this.reserve(e.report.test);const recovered={authRecoveryAttempted:true,token:r.writeToken,report:{...e.report,runId:r.runId,recoveredFromRunId:e.report.recoveredFromRunId||old,recoveryReason:'Missing or expired previous write credential',revision:1}};this.put(recovered);this.remember(r.runId,r.writeToken);this.remove(old);this.onRecovered(old,recovered.report);return recovered;}
 async importLegacy(){
  const pending=[];try{for(let i=0;i<this.storage?.length;i++){const k=this.storage.key(i);if(k?.startsWith('facemorph-pending-'))pending.push(k);}}catch{}
  for(const key of pending){try{const report=JSON.parse(this.storage.getItem(key));if(!report?.runId||!Array.isArray(report.results))continue;
    const e={report,token:null};this.put(e);this.storage.removeItem(key);
   }catch{}}
 }
 flush(){if(this.flushing)return this.flushing;this.flushing=this.flushAll().finally(()=>{this.flushing=null;});return this.flushing;}
 async flushAll(){
  try{
   while(this.entries.size){let e=this.entries.values().next().value;if(!e.token)e=await this.recover(e);const snapshot=e;
    let ack;try{ack=await this.request('/api/runs/'+e.report.runId,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+e.token},body:JSON.stringify(e.report)});}
    catch(error){if(error.status===401&&!e.authRecoveryAttempted){await this.recover(this.entries.get(e.report.runId)||e);continue;}if(error.status===409){this.remove(e.report.runId);this.onStatus('A newer copy is already saved on the server; stale local update ignored.',true);continue;}throw error;}
    if(!ack.saved||ack.runId!==e.report.runId||ack.revision!==e.report.revision)throw Error('Results server did not confirm this snapshot');
    this.remember(e.report.runId,e.token);if(this.entries.get(e.report.runId)===snapshot)this.remove(e.report.runId);
    this.onStatus('Saved on server · '+new Date(ack.serverSavedAt).toLocaleTimeString()+' · run '+e.report.runId.slice(0,8),true);
   }return true;
  }catch(e){this.onStatus((e.name==='AbortError'?'Save connection timed out':e.message)+'. Results remain queued; reconnect or retry saving.',false);return false;}
 }
}
