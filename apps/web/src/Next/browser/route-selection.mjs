import {rankedRoutes as ranked} from '@facemorph/stylegan-js/engine';

/** Operator, 10 October: WebGPU -> CPU (WebGL execution removed 17 October, fm-x6h5). Timings are observations, never a
 * reason to demote a working route. Only availability/admission/inference failure filters it. The ranking is
 * stylegan-js engine/routes.ts (fm-7f2o); `measured` stays in this signature for its callers and changes nothing.
 */
export function rankedRoutes(capability,supported,measured={},failed=new Set()){
 return ranked(capability,supported,failed);
}
