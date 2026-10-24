// Ordered multi-file selection. The order of faces is the person's global selection-click order across all
// files: deselecting removes, reselecting appends; never file order, detector order or completion order.
// It survives cancellation, retry and out-of-order completion because nothing but a click changes it.

import type { InputRevision } from './inputs.ts';

/** A candidate face: `<fileId>#<face index>`. */
export type CandidateId = `${string}#${number}`;

export interface BatchFile {
  readonly id: string;
  /** A recovered still installs its latent; a photo goes to e4e; a corrupt file offers nothing to select. */
  readonly kind: 'photo' | 'recovered-still' | 'corrupt';
  readonly candidates: readonly CandidateId[];
}

export interface BatchSelection {
  readonly files: readonly BatchFile[];
  /** Global click order of the selected candidates. */
  readonly order: readonly CandidateId[];
}

export interface SelectionClick {
  readonly candidate: CandidateId;
}

export type GlobalClickOrder = BatchSelection['order'];

/** Applies one click: a selected candidate is removed, an unselected one appended. */
export function applyClick(selection: BatchSelection, click: SelectionClick): BatchSelection {
  const file = selection.files.find((f) => f.candidates.includes(click.candidate));
  if (!file || file.kind === 'corrupt') return selection;
  const order = selection.order.includes(click.candidate)
    ? selection.order.filter((c) => c !== click.candidate)
    : [...selection.order, click.candidate];
  return { ...selection, order };
}

/** Where a selected candidate goes: the first target tile, or an additional morph keypoint after it. */
export interface KeypointAllocation {
  readonly candidate: CandidateId;
  readonly target: 'first-target' | 'additional-keypoint';
  readonly position: number;
}

/**
 * Allocates the whole order atomically, and only when the source (batch) and target (morph inputs)
 * revisions still match the ones the dialog opened with; a stale dialog allocates nothing.
 */
export function allocateKeypoints(
  order: GlobalClickOrder,
  revisions: { readonly source: InputRevision; readonly sourceNow: InputRevision; readonly target: InputRevision; readonly targetNow: InputRevision },
): readonly KeypointAllocation[] | 'stale' {
  if (revisions.source !== revisions.sourceNow || revisions.target !== revisions.targetNow) return 'stale';
  return order.map((candidate, position) => ({ candidate, target: position === 0 ? 'first-target' : 'additional-keypoint', position }));
}

/** Tile Cancel is per slot; BatchCancel is the modal's pre-commit Cancel; nothing cancels a batch implicitly. */
export type BatchCancel = { readonly kind: 'batch-cancel'; readonly beforeCommit: true };

/** Retry is one existing slot with a new attempt ID, appended to the queue; pending siblings keep their order. */
export function retrySlot<T extends { readonly slot: string; readonly attemptId: string }>(queue: readonly T[], slot: string, attemptId: string, make: (slot: string, attemptId: string) => T): readonly T[] {
  return [...queue.filter((j) => j.slot !== slot), make(slot, attemptId)];
}

export interface BatchPayloadError {
  readonly code: 'not-an-object' | 'invalid-file' | 'invalid-order';
  readonly path: string;
}

const CANDIDATE = /^[^#\s]{1,128}#\d{1,4}$/;

/** Validates a batch selection restored from session state or a worker; every rejection is typed. */
export function parseBatchSelection(value: unknown): { readonly ok: true; readonly value: BatchSelection } | { readonly ok: false; readonly error: BatchPayloadError } {
  const fail = (code: BatchPayloadError['code'], path: string) => ({ ok: false as const, error: { code, path } });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('not-an-object', '$');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.files) || v.files.length > 1024) return fail('invalid-file', '$.files');
  const ids = new Set<string>();
  const all = new Set<string>();
  for (const [i, f] of (v.files as unknown[]).entries()) {
    const file = f as Record<string, unknown>;
    if (typeof f !== 'object' || f === null || typeof file.id !== 'string' || file.id === '' || file.id.includes('#') || ids.has(file.id)) return fail('invalid-file', `$.files[${i}].id`);
    if (!['photo', 'recovered-still', 'corrupt'].includes(file.kind as string)) return fail('invalid-file', `$.files[${i}].kind`);
    if (!Array.isArray(file.candidates) || !file.candidates.every((c) => typeof c === 'string' && CANDIDATE.test(c) && c.startsWith(`${file.id as string}#`))) return fail('invalid-file', `$.files[${i}].candidates`);
    if (file.kind === 'corrupt' && file.candidates.length > 0) return fail('invalid-file', `$.files[${i}].candidates`);
    ids.add(file.id as string);
    for (const c of file.candidates as string[]) all.add(c);
  }
  if (!Array.isArray(v.order) || !v.order.every((c) => typeof c === 'string' && all.has(c)) || new Set(v.order).size !== v.order.length) return fail('invalid-order', '$.order');
  return { ok: true, value: value as BatchSelection };
}
