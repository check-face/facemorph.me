// Morph acceptance pre-checks (fm-fy2.9, morph.guards) that run before any acquisition or inference:
// the identical-neighbour rule (candidate defect 6) and the MP4 route probe. The frame budget is
// morph-budget.ts. Each check answers with a plain Morph status message.
//
// Every product morph is a closed loop (product-bridge.mjs builds all five shapes with `closed: true`),
// and latent-path-v1 rejects any cyclically adjacent pair whose chord norm is below 1e-12. Without this
// pre-check the same word twice, or A, B, A, fails late with a generic project error.
import { inputLatent } from '../Next/browser/identity.mjs';
import type { Mp4Route } from '../media/mp4-probe.ts';
import type { OperationFailure, OperationRequest, SourceSnapshot } from './service.ts';

/** The chord norm below which latent-path-v1 treats two adjacent faces as one. */
export const IDENTICAL_NORM = 1e-12;

/**
 * What a face is, independent of its label: the latent's digest under one model identity, and the
 * latent values when known. Display labels are never part of it.
 */
export interface FaceIdentity {
  readonly digest: string;
  readonly model: string;
  readonly values?: ArrayLike<number>;
}

/** Same face: equal digest and model identity, or (same model) latent difference norm below 1e-12. */
export function sameFace(a: FaceIdentity, b: FaceIdentity): boolean {
  if (a.model !== b.model) return false;
  if (a.digest === b.digest) return true;
  const x = a.values,
    y = b.values;
  if (!x || !y || x.length !== y.length) return false;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i]! - y[i]!) ** 2;
  return Math.sqrt(sum) < IDENTICAL_NORM;
}

/**
 * The first cyclically adjacent pair of identical faces (0-based, `second` follows `first` in the
 * loop, so the closing pair is `{ first: n - 1, second: 0 }`), or undefined. Unknown identities
 * (null) are never compared; non-adjacent repeats are allowed.
 */
export function identicalNeighbours(
  faces: readonly (FaceIdentity | null)[],
): { readonly first: number; readonly second: number } | undefined {
  const n = faces.length;
  if (n < 2) return;
  // Two faces form one loop A -> B -> A: one pair, reported once.
  const pairs = n === 2 ? 1 : n;
  for (let first = 0; first < pairs; first++) {
    const second = (first + 1) % n;
    const a = faces[first],
      b = faces[second];
    if (a && b && sameFace(a, b)) return { first, second };
  }
}

/** The plain message naming the faces (1-based, as the tiles are numbered). */
export function neighbourMessage(pair: {
  readonly first: number;
  readonly second: number;
}): string {
  const a = pair.first + 1,
    b = pair.second + 1;
  const tail = 'Change one of them or add a different face between them.';
  return pair.second === 0 && pair.first > 1
    ? `Faces ${a} and ${b} are the same, and the loop goes from face ${a} back to face ${b}. ${tail}`
    : `Faces ${a} and ${b} are the same, and they are next to each other in the loop. ${tail}`;
}

export type IdentityResolver = (
  source: SourceSnapshot,
  model: string,
) => Promise<FaceIdentity | null>;

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
const blobIds = new WeakMap<Blob, number>();
let blobSequence = 0;

/**
 * The model-free identity of a face input. Words and seeds resolve to their exact Z latent
 * (browser/identity.mjs, the same derivation generation uses; Z -> W+ is deterministic per model), so
 * two inputs with equal Z are the same face. A photo is the same face as another tile only when it is the
 * same file. Restored or unknown sources are not compared here.
 */
export async function resolveInputIdentity(
  source: SourceSnapshot,
  model: string,
): Promise<FaceIdentity | null> {
  const { mode, value, file } = source.input;
  if (mode === 'text' || mode === 'seed') {
    let latent: { values: Float32Array };
    try {
      latent = await inputLatent(mode, value);
    } catch {
      return null; // invalid inputs are refused by the dependency checks with their own message
    }
    const digest = hex(await crypto.subtle.digest('SHA-256', latent.values.slice().buffer));
    return { digest: `z:${digest}`, model, values: latent.values };
  }
  if (mode === 'photo' && file instanceof Blob) {
    let id = blobIds.get(file);
    if (id === undefined) blobIds.set(file, (id = ++blobSequence));
    return { digest: `photo-file:${id}`, model };
  }
  return null;
}

/** The identical-neighbour refusal for a morph request, or undefined when the loop is valid. */
export async function neighbourFailure(
  request: Extract<OperationRequest, { kind: 'morph' }>,
  resolve: IdentityResolver = resolveInputIdentity,
): Promise<Extract<OperationFailure, { kind: 'morph-neighbours' }> | undefined> {
  const model = request.route.modelSha256;
  const faces = await Promise.all(request.sources.map((source) => resolve(source, model)));
  const pair = identicalNeighbours(faces);
  if (!pair) return;
  return {
    kind: 'morph-neighbours',
    slots: [request.sources[pair.first]!.slot, request.sources[pair.second]!.slot],
    faces: [pair.first + 1, pair.second + 1],
    message: neighbourMessage(pair),
    recovery: 'change-face',
  };
}

/** The outcome of the pre-checks that need the browser: a refusal, or a disclosure for Morph status. */
export interface MorphCheck {
  readonly failure?: OperationFailure;
  readonly route?: Mp4Route;
}
export type MorphChecks = (
  request: Extract<OperationRequest, { kind: 'morph' }>,
) => Promise<MorphCheck>;

/** The neighbour rule, then the MP4 probe (only when the loop is valid), in that fixed order. */
export function morphChecks(options: {
  readonly resolve?: IdentityResolver;
  readonly probe?: (request: Extract<OperationRequest, { kind: 'morph' }>) => Promise<Mp4Route>;
}): MorphChecks {
  return async (request) => {
    const failure = await neighbourFailure(request, options.resolve);
    if (failure) return { failure };
    if (!options.probe) return {};
    const route = await options.probe(request);
    if (!route.ok)
      return { failure: { kind: 'mp4-route', message: route.message, recovery: 'save-faces' } };
    return { route };
  };
}
