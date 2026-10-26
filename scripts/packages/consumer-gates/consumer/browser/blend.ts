// stylegan-js's blend from the packed declarations (fm-mtax acceptance in fm-7ge): blend, clampWeight and
// latentDigest, and the result types, as an outside consumer uses them.
import {
  AFHQ_CAT_512_DESCRIPTOR,
  blend,
  clampWeight,
  latentDigest,
  parseModelDescriptor,
  type BlendError,
  type BlendResult,
  type LatentTensor,
} from 'stylegan-js';

export function mix(a: LatentTensor, b: LatentTensor, w: number): BlendResult | BlendError {
  const d = parseModelDescriptor(AFHQ_CAT_512_DESCRIPTOR);
  if (!d.ok) throw new Error('descriptor');
  const r = blend(d.value, [a, b], [clampWeight(w), clampWeight(1 - w)]);
  return r.ok ? r.value : r.error;
}

export const digest = (l: LatentTensor): string => latentDigest(l);
