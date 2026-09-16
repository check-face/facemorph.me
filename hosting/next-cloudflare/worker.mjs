import {checkedEvent} from './validation.mjs';
export const RETENTION_SECONDS=30*24*60*60;
export const MAX_BODY_BYTES=2048;
// No arbitrary localhost ports, null origins, wildcard origins or user credentials.
export const ORIGINS=new Set(['https://next.facemorph.me','tauri://localhost','http://tauri.localhost','https://tauri.localhost']);
function reply(status,origin){const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};if(ORIGINS.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Facemorph-Diagnostics-Consent','Access-Control-Max-Age':'600'});return new Response(null,{status,headers});}
function cancel(reader){try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
async function readEvent(request){
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw Error('size');
 if(!request.body)throw Error('body');const reader=request.body.getReader();const chunks=[];let size=0,timer;
 try{
  const bytes=await Promise.race([(async()=>{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES)throw Error('size');chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),5000);})]);
  return checkedEvent(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
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
  if(env.FREE_PLAN_CONFIRMED!=='true'||!env.DIAGNOSTICS?.put)return reply(503,origin);
  let event;try{event=await readEvent(request);}catch{return reply(400,origin);}
  const now=Math.floor(Date.now()/1000),expiresAt=now+RETENTION_SECONDS;
  const stored=JSON.stringify({...event,receivedAt:new Date(now*1000).toISOString(),expiresAt:new Date(expiresAt*1000).toISOString()});
  try{await env.DIAGNOSTICS.put('runs/'+event.run+'/'+crypto.randomUUID(),stored,{expiration:expiresAt});}
  catch{return reply(503,origin);} // Free quota exhausted/storage unavailable: no retry queue or fallback origin.
  return reply(204,origin);
 }
};
