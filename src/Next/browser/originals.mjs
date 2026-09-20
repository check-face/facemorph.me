// One atomic record: canonical lossless image, editable latent and exact provenance.
// An IndexedDB open can neither succeed nor fail: `blocked` fires when another connection holds
// an older version, and a pending deleteDatabase behind an open connection fires nothing at all.
// The caller treats an unavailable store as "generate without persistence", but it had no way to
// reach that decision from a request that simply never settles — the generation hung with no
// message and no stage, which is worse than losing the cache. A blocked open now becomes a
// refusal after a bounded wait, and the run continues without device storage.
const OPEN_TIMEOUT_MS=5000;
export async function openOriginals(){const request=indexedDB.open('checkface-originals-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('originals');const db=await new Promise((resolve,reject)=>{
  let done=false;const finish=fn=>value=>{if(done)return;done=true;clearTimeout(timer);fn(value);};
  const timer=setTimeout(finish(()=>reject(Error('Device storage did not open; another tab may be holding it.'))),OPEN_TIMEOUT_MS);
  // A connection that arrives after the wait has no owner, so it is closed rather than leaked.
  request.onsuccess=()=>{if(done){try{request.result.close();}catch{}return;}finish(resolve)(request.result);};
  request.onerror=()=>finish(reject)(request.error);
  request.onblocked=()=>finish(reject)(Error('Device storage is held open by another tab.'));
 });return {
 get:key=>new Promise((resolve,reject)=>{const store=db.transaction('originals').objectStore('originals'),r=store.get(key);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const value=r.result;if(value?.kind!=='canonical-original-alias-v1'){resolve(value);return;}if(value.target===key||!/^[a-f0-9]{64}$/.test(value.target||'')){resolve();return;}const target=store.get(value.target);target.onerror=()=>reject(target.error);target.onsuccess=()=>{const original=target.result;if(!original||original.kind==='canonical-original-alias-v1'||original.generationSha256!==value.targetGenerationSha256||original.imageSha256!==value.imageSha256||original.latentSha256!==value.latentSha256){resolve();return;}resolve({...original,canonicalGenerationSha256:original.generationSha256,generationSha256:value.generationSha256});};};}),
 // The alias stores only checksums and a key; the full PNG/latent is stored once.
 put:(key,value,aliases=[])=>new Promise((resolve,reject)=>{const tx=db.transaction('originals','readwrite'),store=tx.objectStore('originals');store.put(value,key);for(const alias of aliases)store.put({kind:'canonical-original-alias-v1',target:key,targetGenerationSha256:value.generationSha256,generationSha256:alias.generationSha256,imageSha256:value.imageSha256,latentSha256:value.latentSha256},alias.key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Original cache transaction cancelled'));}),close:()=>db.close()};}
export async function digest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
