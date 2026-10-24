import {checkedEvent} from './validation.mjs';
export const RETENTION_SECONDS=30*24*60*60;
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
export const ORIGINS=new Set(['https://next.facemorph.me','https://facemorph.me','https://labs.facemorph.me','tauri://localhost','http://tauri.localhost','https://tauri.localhost']);
function reply(status,origin){const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};if(ORIGINS.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Facemorph-Diagnostics-Consent','Access-Control-Max-Age':'600'});return new Response(null,{status,headers});}
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
  if(url.pathname!=='/diagnostics/events'||url.search)return reply(404,origin);
  if(!ORIGINS.has(origin))return reply(403,null);
  if(request.method==='OPTIONS'){
   const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   return reply(request.headers.get('access-control-request-method')==='POST'&&requested.every(x=>['content-type','x-facemorph-diagnostics-consent'].includes(x))?204:403,origin);
  }
  if(request.method!=='POST')return reply(405,origin);
  if(request.headers.get('x-facemorph-diagnostics-consent')!=='session-v1'||request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(403,origin);
  // No provisioning/cost assumptions: remain disabled until Free-plan review is explicit.
  if(env.FREE_PLAN_CONFIRMED!=='true'||!(env.DIAGNOSTICS_R2?.put||env.DIAGNOSTICS?.put))return reply(503,origin);
  let events;try{events=await readEvent(request);}catch{return reply(400,origin);}
  const now=Math.floor(Date.now()/1000),expiresAt=now+RETENTION_SECONDS;
  const receivedAt=new Date(now*1000).toISOString(),expires=new Date(expiresAt*1000).toISOString();
  const stored=JSON.stringify(events.map(event=>({...event,receivedAt,expiresAt:expires})));
  // R2 first: its free tier is a million writes a month against KV's thousand a day, and a day of
  // real testing is well past a thousand events. KV remains a fallback so one sink refusing does
  // not lose a run. Keys keep the runs/<run>/<uuid> shape either way, so readers are unchanged.
  const key='runs/'+events[0].run+'/'+crypto.randomUUID();
  let saved=false;
  if(env.DIAGNOSTICS_R2?.put){
   try{
    await env.DIAGNOSTICS_R2.put(key,stored,{httpMetadata:{contentType:'application/json',
     // Retention is carried as metadata: R2 lifecycle rules delete on it, and a reader can see
     // the same expiry the KV records carried.
     cacheControl:'no-store'},customMetadata:{expiresAt:expires}});
    saved=true;
   }catch{}
  }
  if(!saved&&env.DIAGNOSTICS?.put){
   try{await env.DIAGNOSTICS.put(key,stored,{expiration:expiresAt});saved=true;}catch{}
  }
  if(!saved)return reply(503,origin); // Both sinks unavailable: no retry queue, and no false confirmation.
  return reply(204,origin);
 }
};
