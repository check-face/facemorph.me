import {priorOrder} from './route-priors.mjs';

/** Rank only available, non-failed routes using comparable warmed synthesis timings.
 * An unmeasured route ahead of the current winner in the device priors still gets a try:
 * learning CPU and WebGL costs must not permanently hide newly available WebGPU.
 */
export function rankedRoutes(capability,supported,measured={},failed=new Set()){
 const candidates=priorOrder(capability,supported).filter(name=>!failed.has(name));
 const hasTiming=name=>Number.isFinite(measured[name])&&measured[name]>0;
 const known=candidates.filter(hasTiming).sort((a,b)=>measured[a]-measured[b]);
 const unknown=candidates.filter(name=>!hasTiming(name));
 if(!known.length)return candidates;
 const best=known[0];
 const explore=unknown.find(name=>candidates.indexOf(name)<candidates.indexOf(best))
  ??(measured[best]>3000?unknown[0]:undefined);
 return [...new Set([explore,...known,...unknown].filter(Boolean))];
}
