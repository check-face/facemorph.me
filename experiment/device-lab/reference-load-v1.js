import {decodeReferencePng} from './png-reference-v1.js';
// Phase deadlines report a failed experiment, never retry inference.
export async function loadReferencePng(url,{onStage=()=>{},fetchTimeoutMs=30000,decodeTimeoutMs=15000}={}) {
 const report=(stage,state,details={})=>{try{onStage({stage,state,url,at:new Date().toISOString(),...details});}catch{}};
 async function bounded(stage,timeoutMs,work){
  const start=performance.now(),controller=new AbortController();let timer;
  report(stage,'started',{timeoutMs});
  try{const result=await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(stage+' deadline exceeded after '+timeoutMs+'ms: '+url));},timeoutMs);})]);report(stage,'completed',{elapsedMs:performance.now()-start});return result;}
  catch(error){report(stage,'failed',{elapsedMs:performance.now()-start,error:String(error)});throw error;}finally{clearTimeout(timer);}
 }
 const png=await bounded('reference fetch',fetchTimeoutMs,async signal=>{
  const response=await fetch(url,{signal});if(signal.aborted)throw new DOMException('Reference fetch cancelled','AbortError');report('reference headers','completed',{status:response.status});if(!response.ok)throw Error('Reference '+url+' HTTP '+response.status);
  report('reference body','started');const data=await response.arrayBuffer();if(signal.aborted)throw new DOMException('Reference body cancelled','AbortError');report('reference body','completed',{bytes:data.byteLength});return data;
 });
 const decoded=await bounded('reference decode',decodeTimeoutMs,signal=>decodeReferencePng(png,{signal}));
 return {...decoded,png};
}
