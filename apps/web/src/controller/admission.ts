// One admission check (face.many, fm-id4c): every entry path that adds faces or photo inputs (insertion +,
// Add face, multi-file drop, a drop on the page, a pick or paste onto a face) asks this before any bridge
// call. It checks real budgets only, the contracts ceilings for retained photo-input bytes and the stored
// session, and never a face count (operator, 24 October). A refusal adds nothing and names the limit
// reached in one plain message.

import { checkCeiling, lookupCeiling, type CeilingName } from '../contracts/ceilings.ts';
import type { State } from './state.ts';
import type { Effect, Transition } from './effects.ts';

/** The budgets an addition can reach. */
export type AdmissionBudget = Extract<
  CeilingName,
  'BATCH_RETAINED_INPUT_BYTES' | 'STORED_SESSION_BYTES'
>;

/** What the runner knows that controller state does not. */
export interface AdmissionFacts {
  /** Bytes the stored session holds now (the face results it would keep); 0 when unknown. */
  readonly storedSessionBytes?: number;
}

export interface AdmissionRequest {
  /** The photo or still files the request brings in (dropped, picked or pasted). */
  readonly files: readonly Blob[];
  /** The face whose retained files the request replaces, so they are not counted twice. */
  readonly replacing?: string | null;
  /** Bytes the request adds to the stored session at once (an empty face adds none until it is generated). */
  readonly sessionBytes?: number;
}

export interface AdmissionUsage {
  readonly retainedPhotoBytes: number;
  readonly storedSessionBytes: number;
}

export type Admission =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly budget: AdmissionBudget;
      readonly limit: number;
      readonly requested: number;
      readonly message: string;
    };

const ALL = { kind: 'all-routes' } as const;

const megabytes = (bytes: number): string => {
  const mb = bytes / 2 ** 20;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
};

/** The one plain message for each budget, naming its limit and what to do (reduce the selection). */
export function refusalMessage(budget: AdmissionBudget, limit: number): string {
  return budget === 'BATCH_RETAINED_INPUT_BYTES'
    ? `Not added: photos for your faces can use at most ${megabytes(limit)}, and this would go over it. Choose fewer or smaller photos, or remove a photo face.`
    : `Not added: a saved session can hold at most ${megabytes(limit)}, and this would go over it. Remove some faces first.`;
}

/**
 * The photo-input bytes the controller retains: each face's photo or held still, the queued photos and the
 * crop choices, each Blob once. `except` leaves out the files of a face the request replaces.
 */
export function retainedPhotoBytes(state: State, except: string | null = null): number {
  const blobs = new Set<Blob>();
  const keep = (id: string, file: Blob | null | undefined) => {
    if (file && id !== except) blobs.add(file);
  };
  for (const input of state.Inputs) keep(input.id, input.file);
  for (const [id, held] of state.Held ?? []) keep(id, held.file);
  for (const [id, file] of state.PhotoQueue) keep(id, file);
  for (const choice of [state.Crop, ...state.CropQueue])
    if (choice) keep(choice.faceId, choice.file);
  let bytes = 0;
  for (const blob of blobs) bytes += blob.size;
  return bytes;
}

/** Checks a request against the current usage. Pure: budgets only, never a count of faces. */
export function admit(usage: AdmissionUsage, request: AdmissionRequest): Admission {
  const incoming = request.files.reduce((n, file) => n + file.size, 0);
  const checks: readonly (readonly [AdmissionBudget, number])[] = [
    ['BATCH_RETAINED_INPUT_BYTES', usage.retainedPhotoBytes + incoming],
    ['STORED_SESSION_BYTES', usage.storedSessionBytes + (request.sessionBytes ?? 0)],
  ];
  for (const [budget, requested] of checks) {
    if (checkCeiling(budget, ALL, requested).ok) continue;
    // Over the ceiling, or an amount that is not a byte count: refused either way, naming the ceiling.
    const found = lookupCeiling(budget, ALL);
    const limit = found.admitted ? found.ceiling.value : 0;
    return { ok: false, budget, limit, requested, message: refusalMessage(budget, limit) };
  }
  return { ok: true };
}

/** The admission of `request` in `state`, with the runner's facts. */
export function admitTo(
  state: State,
  request: AdmissionRequest,
  facts: AdmissionFacts = {},
): Admission {
  return admit(
    {
      retainedPhotoBytes: retainedPhotoBytes(state, request.replacing ?? null),
      storedSessionBytes: facts.storedSessionBytes ?? 0,
    },
    request,
  );
}

/** A refused request changes nothing but the status line, which names the limit. */
export function refused(state: State, admission: Extract<Admission, { ok: false }>): State {
  return { ...state, Status: admission.message };
}

/** The refusal as a transition: the status names the limit, and the trace records it (no silent no-op). */
export function refusal(
  state: State,
  admission: Extract<Admission, { ok: false }>,
  effects: readonly Effect[] = [],
): Transition {
  return {
    state: refused(state, admission),
    effects: [...effects, { type: 'admissionRefused', budget: admission.budget }],
  };
}
