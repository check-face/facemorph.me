// The face identity primitives are stylegan-js engine/identity.ts (fm-7f2o): NumPy RandomState legacy MT19937 with
// the polar Gaussian, seed/text latents, truncation, the W+ check, RGBA8 conversion and the canonical generation
// identity. This module keeps the names and shapes its callers use.
import {randomState,inputLatent as latentFor,truncate,requireLatent,toRgba8,generationIdentity as identityOf} from 'stylegan-js/engine';
export {randomState,truncate,requireLatent};
export function generationIdentity(manifest,kind){return identityOf(manifest,kind);}
export async function inputLatent(mode,value){const {identity,z}=latentFor(mode,value);return {identity,values:z,shape:[1,512],space:'z'};}
export function rgba1024(raw){return toRgba8(raw);}
