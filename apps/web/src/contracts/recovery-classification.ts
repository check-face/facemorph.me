// Recovery classification: what the app may do with a still once its recovery data has been read. The reader
// is stylegan-js (readRecovery / inspectStill, fm-1muu); this decides the allowed actions from its result and
// the loaded model's identity.

import type { StillRecoveryResult } from '@facemorph/stylegan-js';

export type RecoveryClassification = 'matching' | 'missing' | 'damaged' | 'incompatible-schema' | 'incompatible-model' | 'unknown-model';

export interface ModelIdentityPair {
  readonly modelSha256: string;
  readonly noiseSha256: string;
}

export interface RecoveryActions {
  readonly view: true;
  /** Save/Share hands over the original bytes unchanged (no re-encode, envelope kept). */
  readonly saveOriginalBytes: boolean;
  /** Install image and latent with no acquisition, detector or encoder. */
  readonly installLatent: boolean;
  readonly morph: 'included' | 'excluded';
  /** Photo encoding happens only through an explicit Encode image / Use as photo action. */
  readonly useAsPhoto: 'never' | 'explicit-action' | 'explicit-action-if-pixels-decode';
  readonly reason?: string;
}

export interface ClassifiedRecovery {
  readonly classification: RecoveryClassification;
  readonly actions: RecoveryActions;
}

const same = (a: ModelIdentityPair, b: ModelIdentityPair) => a.modelSha256 === b.modelSha256 && a.noiseSha256 === b.noiseSha256;

const MISMATCH = (reason: string): RecoveryActions => ({ view: true, saveOriginalBytes: true, installLatent: false, morph: 'excluded', useAsPhoto: 'explicit-action', reason });

/**
 * `known` is every identity this build knows (the loaded one included). Equal-shaped latents from another
 * known checkpoint are incompatible-model, never combinable.
 */
export function classifyRecovery(parse: StillRecoveryResult, models: { readonly loaded: ModelIdentityPair; readonly known: readonly ModelIdentityPair[] }): ClassifiedRecovery {
  switch (parse.kind) {
    case 'missing':
      return { classification: 'missing', actions: { view: true, saveOriginalBytes: true, installLatent: false, morph: 'excluded', useAsPhoto: 'explicit-action', reason: 'This image has no FaceMorph recovery data.' } };
    case 'damaged':
      // Never silently re-encoded: its identity must not change.
      return { classification: 'damaged', actions: { view: true, saveOriginalBytes: true, installLatent: false, morph: 'excluded', useAsPhoto: 'explicit-action-if-pixels-decode', reason: 'Its FaceMorph recovery data is damaged.' } };
    case 'incompatible-schema':
      return { classification: 'incompatible-schema', actions: MISMATCH(`Its recovery data is version ${String(parse.schemaVersion)}, which this version cannot read.`) };
    case 'parsed': {
      const identity = { modelSha256: parse.recovered.provenance.modelSha256, noiseSha256: parse.recovered.provenance.noiseSha256 };
      if (same(identity, models.loaded)) return { classification: 'matching', actions: { view: true, saveOriginalBytes: true, installLatent: true, morph: 'included', useAsPhoto: 'never' } };
      if (models.known.some((k) => same(k, identity))) return { classification: 'incompatible-model', actions: MISMATCH('This face was made with a different model, so it cannot be morphed with these faces.') };
      return { classification: 'unknown-model', actions: MISMATCH('This face was made with a model this version does not know.') };
    }
  }
}
