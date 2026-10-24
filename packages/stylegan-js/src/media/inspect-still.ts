// The still-image recovery reader: classifies every dropped, chosen or pasted file before any target is
// touched. It takes bytes and model identities as plain values and returns a verdict; it holds no engine,
// encoder or detector and fetches nothing, so classification cannot start compute or a download. A latent is
// returned only for `matching`; every other kind carries the original bytes for Save/Share unchanged.

import { stillContainer } from '../contracts/recovery-metadata.ts';
import { readRecovery, type RecoveredStill } from './envelope.ts';

/** The generator identity a latent belongs to (recovery provenance: model and noise digests). */
export interface ModelIdentityRef {
  readonly modelSha256: string;
  readonly noiseSha256: string;
}

export type StillKind =
  | 'matching'
  | 'missing'
  | 'damaged'
  | 'incompatible-schema'
  | 'incompatible-model'
  | 'unknown-model';

export interface StillInspection {
  readonly kind: StillKind;
  /** The file's bytes exactly as given: what Save/Share hands over for every non-matching kind. */
  readonly image: Uint8Array;
  /** 'other' for a format that cannot carry recovery metadata (a camera JPEG, say). */
  readonly container: 'png' | 'webp' | 'other';
  /** Only for `matching`; never present otherwise, so a mismatched latent cannot reach the engine. */
  readonly recovered?: RecoveredStill;
  /** The identity the file claims, when it has a readable one. */
  readonly modelIdentity?: ModelIdentityRef;
  /** Plain reason for anything but `matching`. */
  readonly reason?: string;
  /** Whether the app may offer an explicit Encode image / Use as photo action (never automatic). */
  readonly photoActionAllowed: boolean;
}

const same = (a: ModelIdentityRef, b: ModelIdentityRef) =>
  a.modelSha256 === b.modelSha256 && a.noiseSha256 === b.noiseSha256;

/**
 * `loaded` is the model the app has loaded or will load; `known` lists every identity this build knows (the
 * loaded one included). Equal-shaped latents from another checkpoint are `incompatible-model`, not combinable.
 */
export function inspectStill(
  bytes: Uint8Array,
  models: { readonly loaded: ModelIdentityRef; readonly known: readonly ModelIdentityRef[] },
): StillInspection {
  const image = bytes;
  let container: StillInspection['container'] = 'other';
  try {
    const c = stillContainer(bytes);
    if (c) container = c.mime === 'image/png' ? 'png' : 'webp';
  } catch {
    // A malformed PNG/WebP container is reported by readRecovery below.
  }
  const r = readRecovery(bytes);
  if (r.kind === 'missing')
    return {
      kind: 'missing',
      image,
      container,
      reason: 'This image carries no FaceMorph recovery data.',
      photoActionAllowed: true,
    };
  if (r.kind === 'damaged') {
    return {
      kind: 'damaged',
      image,
      container,
      reason: `Its FaceMorph recovery data is damaged (${r.reason}).`,
      photoActionAllowed: true,
    };
  }
  if (r.kind === 'incompatible-schema') {
    return {
      kind: 'incompatible-schema',
      image,
      container,
      reason: `Its FaceMorph recovery data is version ${String(r.schemaVersion)}, which this version cannot read.`,
      photoActionAllowed: true,
    };
  }
  const { recovered } = r;
  const identity: ModelIdentityRef = {
    modelSha256: recovered.provenance.modelSha256,
    noiseSha256: recovered.provenance.noiseSha256,
  };
  if (same(identity, models.loaded))
    return {
      kind: 'matching',
      image,
      container,
      recovered,
      modelIdentity: identity,
      photoActionAllowed: false,
    };
  if (models.known.some((k) => same(k, identity))) {
    return {
      kind: 'incompatible-model',
      image,
      container,
      modelIdentity: identity,
      reason:
        'This face was made with a different model, so it cannot be combined with these faces.',
      photoActionAllowed: true,
    };
  }
  return {
    kind: 'unknown-model',
    image,
    container,
    modelIdentity: identity,
    reason: 'This face was made with a model this version does not know.',
    photoActionAllowed: true,
  };
}
