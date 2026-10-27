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
  /** Files still owned by asynchronous photo work, including superseded work until it settles. */
  readonly pendingPhotoFiles?: readonly Blob[];
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
 * crop choices and retained snapshots, each Blob once. `except` leaves out the installed files of a face
 * the request replaces; independent snapshots still retain their files.
 */
function retainedPhotos(state: State, except: string | null): Set<Blob> {
  const blobs = new Set<Blob>();
  const keep = (id: string, file: Blob | null | undefined) => {
    if (file && id !== except) blobs.add(file);
  };
  for (const input of state.Inputs) keep(input.id, input.file);
  // A Generate-only choice keeps the confirmed source independently of the current field.
  // This source remains independently retained while a replacement chooser/crop is open.
  for (const input of state.PausedPhotos?.values() ?? []) if (input.file) blobs.add(input.file);
  for (const [id, held] of state.Held ?? []) keep(id, held.file);
  for (const [id, file] of state.PhotoQueue) keep(id, file);
  for (const choice of [state.Crop, ...state.CropQueue])
    if (choice) {
      keep(choice.faceId, choice.file);
      // The crop also captures the previous input to reject a replaced proposal.
      if (choice.input?.file) blobs.add(choice.input.file);
    }
  if (state.PhotoChoice) blobs.add(state.PhotoChoice.file);
  // These snapshots remain live independently of the currently installed face.
  for (const { input } of state.Undo?.hidden ?? []) if (input.file) blobs.add(input.file);
  for (const input of state.RunInputs) if (input.file) blobs.add(input.file);
  return blobs;
}

export function retainedPhotoBytes(state: State, except: string | null = null): number {
  let bytes = 0;
  for (const blob of retainedPhotos(state, except)) bytes += blob.size;
  return bytes;
}

/** An idle run snapshot with a removed/replaced photo cannot describe the current project. A new selection
 * may also retire its target's idle cache snapshot before admission. Release strong references and the
 * settings key together; running requests retain their own task reservations. */
export function retirePhotoRunInputs(state: State, replacing: string | null = null): State {
  if (state.Busy || !state.RunInputs.some((input) => input.file)) return state;
  const installed = new Set(
    state.Inputs.flatMap((input) => (input.file && input.id !== replacing ? [input.file] : [])),
  );
  return state.RunInputs.some((input) => input.file && !installed.has(input.file))
    ? { ...state, RunInputs: [], RunSettings: '' }
    : state;
}

/** Checks a request against the current usage. Pure: budgets only, never a count of faces. */
export function admit(usage: AdmissionUsage, request: AdmissionRequest): Admission {
  const incoming = [...new Set(request.files)].reduce((n, file) => n + file.size, 0);
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
  const retained = retainedPhotos(state, request.replacing ?? null);
  // A task can still own an old file of the replaced face. Never discount that live reference.
  for (const file of facts.pendingPhotoFiles ?? []) retained.add(file);
  for (const file of request.files) retained.add(file);
  let retainedPhotoBytes = 0;
  for (const file of retained) retainedPhotoBytes += file.size;
  return admit(
    {
      retainedPhotoBytes,
      storedSessionBytes: facts.storedSessionBytes ?? 0,
    },
    { ...request, files: [] },
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
