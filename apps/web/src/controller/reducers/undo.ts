// Remove, Start over and their Undo (fm-id4c). A removed face is hidden, not destroyed: it leaves Inputs (so Morph
// excludes it and the current morph is invalidated) and its owned work is cancelled, but the bridge keeps its
// retained result until the Undo notice ends. The facade's invalidateFace is deferred to that moment (timeout or
// the next action), so Undo re-shows the same result with no bridge call and no inference. One notice at a time:
// a new Remove or Start over first commits the previous one (undo depth 1).
import type { Face, Input, State } from '../state.ts';
import type { Msg } from '../msg.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import { forgetStill } from './photo.ts';

/** How long the Undo notice is offered before the removal becomes final. */
export const UNDO_MS = 10_000;

export interface UndoNotice {
  readonly seq: number;
  readonly kind: 'remove' | 'start-over';
  /** The removed face's index (remove), or 0 (start over). */
  readonly index: number;
  /** The hidden faces, in their original order, with their positions in the Inputs before the action. */
  readonly hidden: readonly { readonly index: number; readonly input: Input }[];
  /** Finished faces of the hidden inputs, re-shown by Undo. */
  readonly faces: readonly Face[];
  /** Faces that existed only for the Start over (two empty ones), dropped again by Undo. */
  readonly placeholders: readonly string[];
}

export interface UndoFacts {
  /** Two fresh face IDs for Start over, supplied by the effect runner like AddAt's. */
  readonly startOverIds?: readonly [string, string];
}

/** Messages that are a person's next action: they end an open Undo notice before they apply. */
export const NEXT_ACTIONS: ReadonlySet<Msg['type']> = new Set<Msg['type']>([
  'Edit',
  'Mode',
  'PickPhoto',
  'Photos',
  'AddAt',
  'Kind',
  'Frames',
  'Quality',
  'Provider',
  'Run',
  'RunFace',
  'Cancel',
  'CancelFace',
  'Save',
  'Share',
  'Export',
  'Import',
  'BrowseNames',
  'PinchToggle',
  'RequestCrop',
  'UseAsPhoto',
  'UseSliderToggle',
  'SliderFrameSet',
]);

/** Ends the open notice for good: the hidden faces' results are released (one invalidateFace each). */
export function commitUndo(state: State): Transition {
  const notice = state.Undo;
  if (!notice) return unchanged(state);
  let next: State = { ...state };
  delete (next as { Undo?: UndoNotice }).Undo;
  const effects: Effect[] = [];
  for (const { input } of notice.hidden) {
    if (next.Inputs.some((i) => i.id === input.id)) continue;
    const released = forgetStill(next, input.id, true);
    next = released.state;
    effects.push(...released.effects, { type: 'invalidateFace', id: input.id });
  }
  return { state: next, effects };
}

/** Cancels whatever the hidden faces own, without releasing their retained results. */
function cancelOwned(state: State, ids: ReadonlySet<string>): Effect[] {
  const effects: Effect[] = [];
  for (const id of ids)
    effects.push(
      { type: 'cancelQueuedFace', id },
      { type: 'cancelSlot', id },
      { type: 'invalidatePhotoSelections', id },
    );
  if (state.Busy && state.ActiveFace !== null && ids.has(state.ActiveFace))
    effects.push({ type: 'cancelWork' });
  return effects;
}

function hide(state: State, ids: ReadonlySet<string>): State {
  const preparing = new Set([...state.PreparingFaces].filter((id) => !ids.has(id)));
  const cached = new Set([...state.CachedFaces].filter((id) => !ids.has(id)));
  return {
    ...state,
    Inputs: state.Inputs.filter((i) => !ids.has(i.id)),
    Faces: state.Faces.filter((f) => !ids.has(f.id)),
    PreparingFaces: preparing,
    CachedFaces: cached,
    PendingJobs: state.PendingJobs.filter(
      (job) =>
        !(job.type === 'RunFace' && ids.has(job.args[0])) &&
        !(job.type === 'Run' && job.args[0] === 'morph'),
    ),
    PendingFaces: state.PendingFaces.filter((id) => !ids.has(id)),
    PendingMorph: false,
    Stage:
      state.Busy && state.ActiveFace !== null && ids.has(state.ActiveFace)
        ? 'cancelling'
        : state.Stage,
    VideoUrl: '',
  };
}

const nextSeq = (state: State) => (state.Undo?.seq ?? state.UndoSeq ?? 0) + 1;

export function undo(message: Msg, state: State, facts: UndoFacts = {}): Transition | null {
  switch (message.type) {
    case 'Remove': {
      const [id] = message.args;
      const index = state.Inputs.findIndex((i) => i.id === id);
      // The last face is never removed: a morph always has a face to start from.
      if (index < 0 || state.Inputs.length <= 1) return unchanged(state);
      const seq = nextSeq(state);
      const committed = commitUndo(state);
      const base = committed.state;
      const ids = new Set([id]);
      const notice: UndoNotice = {
        seq,
        kind: 'remove',
        index,
        hidden: [{ index, input: base.Inputs[index]! }],
        faces: base.Faces.filter((f) => f.id === id),
        placeholders: [],
      };
      return {
        state: { ...hide(base, ids), Undo: notice, UndoSeq: seq },
        effects: [
          ...committed.effects,
          ...cancelOwned(base, ids),
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidateMorph' },
          { type: 'expireUndo', seq },
        ],
      };
    }
    case 'StartOver': {
      const fresh = facts.startOverIds;
      if (!fresh || fresh[0] === fresh[1] || state.Inputs.some((i) => fresh.includes(i.id)))
        throw new Error('StartOver requires two fresh face IDs');
      const seq = nextSeq(state);
      const committed = commitUndo(state);
      const base = committed.state;
      const ids = new Set(base.Inputs.map((i) => i.id));
      const notice: UndoNotice = {
        seq,
        kind: 'start-over',
        index: 0,
        hidden: base.Inputs.map((input, index) => ({ index, input })),
        faces: base.Faces.filter((f) => ids.has(f.id)),
        placeholders: [...fresh],
      };
      const hidden = hide(base, ids);
      return {
        state: {
          ...hidden,
          Inputs: fresh.map((id) => ({ id, mode: 'text' as const, value: '', file: null })),
          Status: base.Busy ? hidden.Status : '',
          Undo: notice,
          UndoSeq: seq,
        },
        effects: [
          ...committed.effects,
          ...cancelOwned(base, ids),
          ...(base.Busy && !(base.ActiveFace !== null && ids.has(base.ActiveFace))
            ? [{ type: 'cancelWork' } as const]
            : []),
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidateMorph' },
          { type: 'expireUndo', seq },
        ],
      };
    }
    case 'Undo': {
      const notice = state.Undo;
      if (!notice) return unchanged(state);
      const placeholders = new Set(notice.placeholders);
      const inputs = state.Inputs.filter((i) => !placeholders.has(i.id));
      const restored = [...inputs];
      for (const { index, input } of notice.hidden)
        restored.splice(Math.min(index, restored.length), 0, input);
      const next: State = {
        ...state,
        Inputs: restored,
        Faces: [
          ...state.Faces.filter((f) => !placeholders.has(f.id)),
          ...notice.faces.filter((f) => !state.Faces.some((g) => g.id === f.id)),
        ],
        VideoUrl: '',
      };
      delete (next as { Undo?: UndoNotice }).Undo;
      return {
        state: next,
        // The placeholders are pristine (any edit to one is a next action that ended the notice): no bridge call.
        effects: [{ type: 'invalidateArrivalRestore' }, { type: 'invalidateMorph' }],
      };
    }
    case 'UndoExpired': {
      const [seq] = message.args;
      return state.Undo?.seq === seq ? commitUndo(state) : unchanged(state);
    }
    default:
      return null;
  }
}
