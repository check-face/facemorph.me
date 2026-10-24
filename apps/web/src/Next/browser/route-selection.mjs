import {priorOrder} from './route-priors.mjs';

/** Operator, 10 October: WebGPU -> CPU -> WebGL. Timings are observations, never a
 * reason to demote a working route. Only availability/admission/inference failure filters it.
 */
export function rankedRoutes(capability,supported,measured={},failed=new Set()){
 return priorOrder(capability,supported).filter(name=>!failed.has(name));
}
