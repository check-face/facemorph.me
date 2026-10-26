// The descriptor types from the packed declarations: a non-face 512 px model, checked and used to bound a
// morph, with no face detector or encoder in sight.
import {
  AFHQ_CAT_512_DESCRIPTOR,
  latentFitsDescriptor,
  parseModelDescriptor,
  type DeveloperJourneyStep,
  type LatentTensor,
  type ModelDescriptor,
} from 'stylegan-js';

export function describe(d: ModelDescriptor): string {
  return `${d.identity.name}: ${d.output.shape[2]} px, ${d.latent.layers} x ${d.latent.width} W+, ${d.subject}`;
}

export function fits(latent: LatentTensor): boolean {
  const parsed = parseModelDescriptor(AFHQ_CAT_512_DESCRIPTOR);
  return parsed.ok && latentFitsDescriptor(latent, parsed.value);
}

export const host: DeveloperJourneyStep = {
  step: 3,
  kind: 'host',
  hosting: 'https-static',
  manifestUrl: 'https://models.example.org/manifest.json',
};
