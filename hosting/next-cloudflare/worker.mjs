import {checkedEvent} from './validation.mjs';
import {collectorEnvironment} from './environment.mjs';
// One KV write per event exhausted the Free plan's 1,000 writes/day per namespace: a single
// morph is about a hundred events, and 21 September took 1,430 writes before the collector
// started refusing. A batch is one write, so the same day's testing costs about fifteen. The
// body grows to hold a batch; each event inside is still checked individually and the per-event
// contract is unchanged.
export const MAX_BODY_BYTES=64*1024;
export const MAX_BATCH_EVENTS=200;
// No arbitrary localhost ports, null origins, wildcard origins or user credentials.
// facemorph.me and labs are listed ahead of the trial moving to the real site: the product's
// reports go to this one collector wherever it is served from.
export const ORIGINS=new Set(collectorEnvironment().origins);
function reply(status,origin,origins){const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};if(origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Facemorph-Diagnostics-Consent','Access-Control-Max-Age':'600'});return new Response(null,{status,headers});}
function cancel(reader){try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
async function readEvent(request){
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw Error('size');
 if(!request.body)throw Error('body');const reader=request.body.getReader();const chunks=[];let size=0,timer;
 try{
  const bytes=await Promise.race([(async()=>{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES)throw Error('size');chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),5000);})]);
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  // A batch carries its common identity once and its events in a list; a lone event is still
  // accepted so a client mid-rollout is never dropped.
  if(body&&typeof body==='object'&&Array.isArray(body.events)){
   const {events,...common}=body;
   if(!events.length||events.length>MAX_BATCH_EVENTS)throw Error('batch');
   return events.map(event=>checkedEvent({...common,...event}));
  }
  return [checkedEvent(body)];
 }catch(error){cancel(reader);throw error;}finally{clearTimeout(timer);}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('origin');
  let config;try{config=collectorEnvironment(env.DIAGNOSTICS_ENVIRONMENT);}catch{return new Response(null,{status:503});}
  const origins=new Set(config.origins),endpoint=new URL(config.collector);
  const respond=(status,allowedOrigin=origin)=>reply(status,allowedOrigin,origins);
  if(url.pathname!==endpoint.pathname||url.search||url.hostname!==endpoint.hostname)return respond(404);
  if(!origins.has(origin))return respond(403,null);
  if(request.method==='OPTIONS'){
   const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   return respond(request.headers.get('access-control-request-method')==='POST'&&requested.every(x=>['content-type','x-facemorph-diagnostics-consent'].includes(x))?204:403);
  }
  if(request.method!=='POST')return respond(405);
  if(request.headers.get('x-facemorph-diagnostics-consent')!=='session-v1'||request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return respond(403);
  // No provisioning/cost assumptions: remain disabled until Free-plan review is explicit.
  if(env.FREE_PLAN_CONFIRMED!=='true'||!(env.DIAGNOSTICS_R2?.put||env.DIAGNOSTICS?.put))return respond(503);
  let events;try{events=await readEvent(request);}catch{return respond(400);}
  const receivedAt=new Date().toISOString();
  const stored=JSON.stringify(events.map(event=>({...event,receivedAt})));
  // R2 first: its free tier is a million writes a month against KV's thousand a day, and a day of
  // real testing is well past a thousand events. KV remains a fallback so one sink refusing does
  // not lose a run. Keys keep the runs/<run>/<uuid> shape either way, so readers are unchanged.
  const key='runs/'+events[0].run+'/'+crypto.randomUUID();
  let saved=false;
  if(env.DIAGNOSTICS_R2?.put){
   try{
    await env.DIAGNOSTICS_R2.put(key,stored,{httpMetadata:{contentType:'application/json',
     cacheControl:'no-store'}});
    saved=true;
   }catch{}
  }
  if(!saved&&env.DIAGNOSTICS?.put){
   try{await env.DIAGNOSTICS.put(key,stored);saved=true;}catch{}
  }
  if(!saved)return respond(503); // Both sinks unavailable: no retry queue, and no false confirmation.
  return respond(204);
 }
};
