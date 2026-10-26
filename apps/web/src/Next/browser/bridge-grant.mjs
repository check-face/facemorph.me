// Acquisition grants the bridge hands its workers (fm-fr9s made the manager refuse any transfer without one).
//
// The model worker acquires only under the app's grants (appGrants below, fm-qrfz): what the person approved and
// what this device already holds. bridgeGrant remains for the video worker's codec descriptor alone: every asset
// that descriptor names, at its declared size, with enough bytes for each to arrive once plus one retry per
// scheduled retry delay (CHUNK_RETRY_DELAYS_MS). The ledger lives in the worker that spends it (grants.ts).
import {CHUNK_RETRY_DELAYS_MS} from '../Assets/model-cache.mjs';
import {grantRemaining} from '../../../../../packages/browser-model-manager/src/acquisition/grants.ts';

// Every asset descriptor anywhere in the manifest (its chunks belong to the asset, so the walk stops there).
function assetsIn(value,found=[]){
 if(!value||typeof value!=='object')return found;
 if(typeof value.sha256==='string'&&Number.isSafeInteger(value.size)&&typeof value.url==='string'){found.push(value);return found;}
 for(const item of Array.isArray(value)?value:Object.values(value))assetsIn(item,found);
 return found;
}

export const BRIDGE_OWNER='face:candidate-bridge';

const allowance=bytes=>bytes*(1+CHUNK_RETRY_DELAYS_MS.length);
function scope(value,known=new Map()){
 const added=[];
 for(const a of assetsIn(value))if(!known.has(a.sha256)){known.set(a.sha256,a.size);added.push({sha256:a.sha256,bytes:a.size,priority:'foreground-required'});}
 return added;
}

export function bridgeGrant(value,{manifestSha256='',route='cpu',purpose='generate-and-encode'}={}){
 const assets=scope(value);
 return {manifestSha256,route,purpose,assets,remainingBytes:allowance(assets.reduce((n,a)=>n+a.bytes,0)),owners:[BRIDGE_OWNER]};
}


// ---- App-supplied grants (fm-qrfz): what the person approved, not the whole manifest ----------------------------
// The app hands every worker two grants, both owned by BRIDGE_OWNER:
// - `approved`: the scopes the person approved ('route': this route's synthesis assets; 'photo': those plus the
//   detector and the encoder), each at its declared size with the retry allowance above. A streamed encoder whose
//   descriptor is not cached yet is approved by its advertised size, kept as an allowance tied to the descriptor:
//   the shards the verified descriptor names are admitted against it, never beyond it (widenWithin).
// - `local`: assets already verified on this device that the approval does not cover, with nothing to transfer.
//   They may be read; any byte they would need to refetch is refused (an evicted file needs a new decision).
// An asset in neither grant is refused before any request. Approving 'route' covers the route the device uses now:
// a fallback to another route that needs more files is a new cost, so it is refused and asked again.
import {routeAssets,photoAssets} from '../model-inventory.mjs';

const priorityOf=(a,manifest)=>a.sha256===manifest.landmarks?.sha256||a.sha256===manifest.photoCanary?.sha256||(Array.isArray(manifest.photoCanaries)&&manifest.photoCanaries.some(c=>c?.sha256===a.sha256))?'detector-prerequisite':'foreground-required';

/** {approved, local} grants for `approved` scopes ('route', 'photo'); `cache` answers has(asset) and peek(asset). */
export async function appGrants({manifest,manifestSha256='',route='cpu',engine='ort',approved=new Set(),cache}){
 const wanted=new Map();let discover=null;
 const add=(a,priority)=>{if(!wanted.has(a.sha256))wanted.set(a.sha256,{sha256:a.sha256,bytes:a.size,priority});};
 const synthesis=routeAssets(manifest,route,engine);
 if(approved.has('route')||approved.has('photo'))for(const a of synthesis)add(a,'synthesis-prerequisite');
 const photo=cache?await photoAssets(manifest,cache):{assets:[]};
 if(approved.has('photo')){
  for(const a of photo.assets)add(a,priorityOf(a,manifest));
  if(photo.estimated&&manifest.encoderStream?.sha256)discover={via:manifest.encoderStream.sha256,bytes:photo.extraBytes||0,priority:'foreground-required'};
 }
 const assets=[...wanted.values()];
 const approvedGrant=assets.length?{manifestSha256,route,purpose:approved.has('photo')?'generate-and-encode':'generate',assets,
  remainingBytes:allowance(assets.reduce((n,a)=>n+a.bytes,0)+(discover?.bytes||0)),owners:[BRIDGE_OWNER],allowances:discover?[discover]:[]}:null;
 const seen=new Set(wanted.keys()),local=[];
 const every=[...routeAssets(manifest,'cpu','ort'),...routeAssets(manifest,'webgpu','ort'),...routeAssets(manifest,'webgpu','direct'),...photo.assets];
 for(const a of every){if(seen.has(a.sha256))continue;seen.add(a.sha256);if(cache&&await cache.has(a))local.push({sha256:a.sha256,bytes:a.size,priority:'foreground-required'});}
 const localGrant=local.length?{manifestSha256,route,purpose:'generate',assets:local,remainingBytes:0,owners:[BRIDGE_OWNER]}:null;
 return {approved:approvedGrant,local:localGrant};
}

/** The grant an acquisition of `asset` runs under: approved, else local, else none (refused before any request). */
export function chooseGrant(grants,asset){
 const has=g=>g?.assets.some(a=>a.sha256===asset.sha256&&a.bytes===asset.size);
 return has(grants?.approved)?grants.approved:has(grants?.local)?grants.local:null;
}

/** `incoming`, keeping each current grant object (and so its ledger) when the same grant is posted again. */
export function mergeGrants(current,incoming){
 const same=(a,b)=>!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);
 return {approved:same(current?.approved,incoming?.approved)?current.approved:incoming?.approved??null,
  local:same(current?.local,incoming?.local)?current.local:incoming?.local??null};
}

/**
 * `grant` with the shards a verified descriptor names, admitted against that descriptor's allowance. Shards already
 * in the grant are kept as they are; the allowance is spent, never renewed, and the grant's total never grows. Shards
 * beyond the allowance are left out, so their acquisition is refused and asked again.
 */
export function widenWithin(grant,via,value){
 const left=grant?.allowances?.find(a=>a.via===via);
 if(!grant||!left)return grant;
 const known=new Set(grant.assets.map(a=>a.sha256)),added=[];let room=left.bytes;
 const shards=[];(function walk(v){if(!v||typeof v!=='object')return;if(typeof v.sha256==='string'&&Number.isSafeInteger(v.size)&&typeof v.url==='string'){shards.push(v);return;}for(const x of Array.isArray(v)?v:Object.values(v))walk(x);})(value);
 for(const s of shards){if(known.has(s.sha256))continue;if(s.size>room)return widened();
  known.add(s.sha256);added.push({sha256:s.sha256,bytes:s.size,priority:left.priority});room-=s.size;}
 return widened();
 // A new object starts a new ledger: carry over what the old one has left (the allowance is already inside it).
 function widened(){return {...grant,assets:[...grant.assets,...added],allowances:grant.allowances.map(a=>a.via===via?{...a,bytes:room}:a),remainingBytes:grantRemaining(grant)};}
}
