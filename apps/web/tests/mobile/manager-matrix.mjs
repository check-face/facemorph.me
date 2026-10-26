// Native storage components only: no ORT session, output inference, physical-device or release claim.
import * as manager from '/packages/browser-model-manager/index.js';

const hash='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const bytes=new TextEncoder().encode('abc'),bad=new TextEncoder().encode('bad');
const owner='face:mobile-matrix',asset={sha256:hash,size:3,url:new URL('/fixture/good',location.origin).href};
const cells=['no-grant','cold','model-cached','output-cached','missing-local','corrupt-local','cancel','leased-eviction','quota','loaded-handle-disposal','cross-tab'];
const lane=()=>navigator.userAgent;
const check=(value,message)=>{if(!value)throw Error(message);};
const network=transfers=>({requests:transfers.length,bytes:transfers.reduce((n,t)=>n+t.bytes,0),paths:transfers.map(t=>t.path),measurement:'native-server-ledger',hostSeparation:false});
const empty=()=>network([]);
const ledger=async()=>{
 const response=await fetch('/fixture/ledger');check(response.ok,'Native fixture ledger unavailable');
 const value=await response.json();check(value.version===1&&Array.isArray(value.transfers),'Invalid fixture ledger');
 return value.transfers.filter(t=>t.resourceClass==='model-fixture');
};
const reject=async operation=>{try{await operation;}catch(error){return error;}throw Error('Expected operation to reject');};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const grant=(remainingBytes=3)=>({manifestSha256:hash,route:'cpu',purpose:'generate',assets:[{sha256:hash,bytes:3,priority:'foreground-required'}],remainingBytes,owners:[owner]});
const request=(approval=grant())=>({grant:approval,owner});
const untested=(id,backend,reasonCode,reason)=>({id,backend,lane:lane(),status:'untested',reasonCode,reason,network:empty()});

async function row(rows,backend,name,operation,expected=[]){
 const id=backend+'.'+name;let before=[],after=[];
 try{
  before=await ledger();const details=await operation(before);after=await ledger();
  const old=new Set(before.map(t=>t.id)),transfers=after.filter(t=>!old.has(t.id));
  check(JSON.stringify(transfers.map(t=>t.path).sort())===JSON.stringify([...expected].sort()),id+': unexpected fixture requests');
  if(name==='cold')check(transfers.every(t=>t.status===200&&t.bytes===3&&t.finished&&!t.aborted),id+': incomplete native transfer');
  rows.push({id,backend,lane:lane(),status:'pass',network:network(transfers),...(details?{details}:{})});
 }catch(error){
  try{after=await ledger();}catch{/* preserve the original failure */}
  const old=new Set(before.map(t=>t.id));
  rows.push({id,backend,lane:lane(),status:'fail',reason:String(error.stack||error),network:network(after.filter(t=>!old.has(t.id)))});
 }
}

export async function runNativeManagerMatrix(runId){
 const rows=[],capabilities={opfs:typeof navigator.storage?.getDirectory==='function',cacheStorage:typeof globalThis.caches!=='undefined',workerSync:false};
 for(const backend of ['opfs','cache-storage']){
  const directory='mobile-matrix-'+runId+'-'+backend,outputName=directory+'-output';
  let root,shards,raw,cache,setupError,missing;
  try{
   if(backend==='opfs'){
    if(!capabilities.opfs)missing='Native worker navigator.storage.getDirectory is absent';
    else{
     root=await navigator.storage.getDirectory();
     const dir=await root.getDirectoryHandle(directory,{create:true});
     const probe=await dir.getFileHandle('native-method-probe',{create:true});
     if(typeof probe.createWritable!=='function'&&typeof probe.createSyncAccessHandle!=='function'){
      capabilities.opfs=false;missing='Native worker OPFS file has neither createWritable nor createSyncAccessHandle';
     }
     await dir.removeEntry('native-method-probe');
     shards=manager.createShardStore(dir);
    }
   }else if(!capabilities.cacheStorage)missing='Native worker CacheStorage is absent';
   if(!missing){
    raw=await caches.open(manager.MODEL_CACHE_NAME);
    const key=new URL('/__checkface_model_blobs__/sha256/'+hash,location.origin).href;
    await raw.delete(key);await shards?.remove(hash);
    cache=await manager.createBrowserModelCache({shards:shards||null,readAhead:1,retryDelaysMs:[]});
   }
  }catch(error){setupError=error;}
  const key=new URL('/__checkface_model_blobs__/sha256/'+hash,location.origin).href;
  const remove=async()=>{await raw.delete(key);await shards?.remove(hash);};
  const seed=async(value=bytes)=>{await remove();if(shards)await shards.write(hash,value);else await raw.put(key,new Response(value));};
  const read=async()=>{const result=await cache.local.read(asset);check(result.ok,'Verified local read failed: '+JSON.stringify(result.error));check(await digest(result.value)===hash,'Verified local digest changed');};
  try{
   const operations={
    'no-grant':async()=>{const error=await reject(cache.acquire(asset,{owner}));check(error.refusal==='no-grant','Missing approval was not refused');},
    cold:async()=>{const approval=grant(),handle=await cache.acquire(asset,request(approval));check(await digest(await handle.bytes())===hash,'Cold digest mismatch');check(manager.grantRemaining(approval)===0,'Cold transfer did not spend exactly3 approved bytes');return{sha256:hash,size:3};},
    'model-cached':read,
    'output-cached':async()=>{
     const output=await caches.open(outputName),key=new URL('/mobile-output/'+runId,location.origin).href;
     await output.put(key,new Response(bytes));await remove();
     const result=await manager.satisfyAction(()=>output.match(key),()=>cache.acquire({...asset,url:new URL('/fixture/offline',location.origin).href},request(grant(0))));
     check(result.from==='output-cache'&&await result.output.text()==='abc','Native app output cache was not used');
     return{scope:'satisfyAction with native app-owned CacheStorage fixture; no inference output claimed'};
    },
    'missing-local':async()=>{await seed();await read();await remove();const result=await cache.local.read(asset);check(!result.ok&&result.error.code==='evicted','Missing shard did not return typed local refusal');return{code:result.error.code};},
    'corrupt-local':async()=>{await seed();await read();await seed(bad);const result=await cache.local.read(asset);check(!result.ok&&result.error.code==='corrupt','Corrupt bytes did not return typed local refusal');return{code:result.error.code};},
    cancel:async before=>{
     await remove();const controller=new AbortController(),approval=grant();
     const pending=reject(cache.acquire({...asset,url:new URL('/fixture/slow',location.origin).href},{...request(approval),signal:controller.signal}));
     const old=new Set(before.map(t=>t.id));let transfer;
     for(let i=0;i<150;i++){transfer=(await ledger()).find(t=>!old.has(t.id)&&t.path==='/fixture/slow'&&t.bytes>=1&&!t.finished&&!t.aborted);if(transfer)break;await delay(20);}
     check(transfer,'Native server never started partial transfer');controller.abort();
     const error=await pending;check(error.name==='AbortError','Cancellation did not settle AbortError');check(!await cache.has(asset),'Cancelled bytes committed');
     let terminal;for(let i=0;i<100;i++){const current=(await ledger()).find(t=>t.id===transfer.id);if(current.finished||current.aborted){terminal=current;break;}await delay(20);}
     check(terminal,'Cancelled native server transfer never settled');check(!await cache.has(asset),'Cancelled bytes committed after transfer settled');
     return{error:error.name,approvedRemaining:manager.grantRemaining(approval),socketBytesMeaning:'successful native writes, not browser-received bytes'};
    },
    'leased-eviction':async()=>{
     await seed();const registry=manager.createLeaseRegistry({locks:navigator.locks});
     const leases=registry.lease([{sha256:hash,bytes:3}],{invalidated(){throw Error('Manager eviction invalidated an active lease');}});
     try{const held=await manager.evictUnleased([hash],[{remove}],registry,navigator.locks);check(held.kept.includes(hash)&&await cache.has(asset),'Leased native bytes were evicted');}
     finally{for(const lease of leases)lease.release();}
     let result;for(let i=0;i<100;i++){result=await manager.evictUnleased([hash],[{remove}],registry,navigator.locks);if(result.removed.includes(hash))break;await delay(20);}
     check(result.removed.includes(hash)&&!await cache.has(asset)&&registry.refCount(hash)===0,'Released lease did not become evictable');
     return{scope:'real local registry/native storage eviction; no fabricated loaded engine capability'};
    }
   };
   for(const name of cells){
    const id=backend+'.'+name;
    if(name==='quota'){rows.push(untested(id,backend,'native-quota-control-unavailable','Native mobile page has no CDP quota controller; no storage API was replaced'));continue;}
    if(name==='loaded-handle-disposal'){rows.push(untested(id,backend,'loaded-runtime-unavailable','Loaded-handle disposal needs a real admitted runtime/model; this fixture performs no inference'));continue;}
    if(name==='cross-tab'){rows.push(untested(id,backend,'second-tab-unavailable','This component page/worker has no independently controlled second browser tab'));continue;}
    if(missing){rows.push(untested(id,backend,backend==='opfs'?'native-opfs-unavailable':'native-cache-storage-unavailable',missing));continue;}
    await row(rows,backend,name,setupError?async()=>{throw setupError;}:operations[name],name==='cold'?['/fixture/good']:name==='cancel'?['/fixture/slow']:[]);
   }
  }finally{
   try{await raw?.delete(key);await globalThis.caches?.delete(outputName);if(root)await root.removeEntry(directory,{recursive:true});}
   catch(error){const cell=rows.find(row=>row.id===backend+'.cold');Object.assign(cell,{status:'fail',reason:'Native fixture cleanup failed: '+String(error)});}
  }
 }
 await row(rows,'worker','native-sync-handles',async()=>{
  if(!capabilities.opfs)throw Error('worker-sync-native-api-absent');
  const root=await navigator.storage.getDirectory(),name='mobile-matrix-sync-'+runId;
  try{
   const dir=await root.getDirectoryHandle(name,{create:true}),file=await dir.getFileHandle('sync',{create:true});
   if(typeof file.createSyncAccessHandle!=='function')throw Error('worker-sync-native-api-absent');
   capabilities.workerSync=true;let access=await file.createSyncAccessHandle();
   try{access.truncate(0);check(access.write(bytes,{at:0})===3,'Native sync write short');access.flush();}finally{access.close();}
   access=await file.createSyncAccessHandle();
   try{const back=new Uint8Array(3);check(access.getSize()===3&&access.read(back,{at:0})===3&&back.every((v,i)=>v===bytes[i]),'Native sync close/reopen lost bytes');}finally{access.close();}
   return{scope:'real worker sync write/flush/close/exclusive reacquire/read/close'};
  }finally{await root.removeEntry(name,{recursive:true});}
 });
 const sync=rows.find(row=>row.id==='worker.native-sync-handles');
 if(sync.status==='fail'&&sync.reason.includes('worker-sync-native-api-absent'))Object.assign(sync,untested(sync.id,'worker','native-worker-sync-unavailable','Native worker createSyncAccessHandle is absent'));
 return{rows,capabilities};
}
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),v=>v.toString(16).padStart(2,'0')).join('');}

export function runManagerMatrix(runId){
 return new Promise(resolve=>{
  const worker=new Worker(new URL('./storage-worker.mjs',import.meta.url),{type:'module'});
  const finish=result=>{clearTimeout(timer);worker.terminate();resolve(result);};
  const fail=reason=>finish({capabilities:{opfs:false,cacheStorage:false,workerSync:false},rows:[...['opfs','cache-storage'].flatMap(backend=>cells.map(name=>({id:backend+'.'+name,backend,lane:lane(),status:'fail',reason,network:empty()}))),{id:'worker.native-sync-handles',backend:'worker',lane:lane(),status:'fail',reason,network:empty()}]});
  const timer=setTimeout(()=>fail('Native component worker did not settle within120seconds'),120000);
  worker.onerror=event=>fail(event.message||'Native component worker failed to load: '+new URL('./storage-worker.mjs',import.meta.url).href);worker.onmessageerror=()=>fail('Native component worker result could not be decoded');
  worker.onmessage=({data})=>data.error?fail(data.error):finish(data);
  worker.postMessage({runId});
 });
}
