// The candidate bridge's acquisition grant (fm-fr9s made the manager refuse any transfer without one).
//
// The candidate asked the person before the bridge sent a worker anything that downloads (the model-download toast)
// and then fetched whatever the pinned manifest named, retrying failed chunks on CHUNK_RETRY_DELAYS_MS. Until the
// consent modal and bounded grant land (fm-qrfz, fm-9kr8), the worker keeps exactly that scope: every asset the
// manifest it was given names, at its declared size, and enough bytes for each to arrive once plus one retry per
// scheduled retry delay. A digest outside the manifest is still refused. The ledger lives in the worker that
// spends it (grants.ts), so each worker builds its own. A file the manifest pins by digest that names more assets
// (the streamed encoder's descriptor) widens the grant by those assets once its verified bytes are read.
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

/** `grant` plus the assets `value` names that it does not yet cover; what the old grant spent stays spent. */
export function widenGrant(grant,value){
 const added=scope(value,new Map(grant.assets.map(a=>[a.sha256,a.bytes])));
 if(!added.length)return grant;
 return {...grant,assets:[...grant.assets,...added],remainingBytes:grantRemaining(grant)+allowance(added.reduce((n,a)=>n+a.bytes,0))};
}
