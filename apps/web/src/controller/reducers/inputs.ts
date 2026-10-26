import type { Input, State } from '../state.ts';
import { msg, type Msg } from '../msg.ts';
import { unchanged, type Transition } from '../effects.ts';
import { forgetStill } from './photo.ts';
import { admitTo, refused, type AdmissionFacts } from '../admission.ts';
export function change(state: State, id: string, replace: (input: Input) => Input): State {
  const cached = new Set(state.CachedFaces);
  cached.delete(id);
  const preparing = new Set(state.PreparingFaces);
  preparing.delete(id);
  return {
    ...state,
    CachedFaces: cached,
    PreparingFaces: preparing,
    PendingFaces: state.PendingFaces.filter((slot) => slot !== id),
    PendingJobs: state.PendingJobs.filter(
      (job) =>
        !(job.type === 'RunFace' && job.args[0] === id) &&
        !(job.type === 'Run' && job.args[0] === 'morph'),
    ),
    PendingMorph: false,
    Stage: state.Busy && state.ActiveFace === id ? 'cancelling' : state.Stage,
    Faces: state.Faces.filter((f) => f.id !== id),
    Inputs: state.Inputs.map((i) => (i.id === id ? replace(i) : i)),
    VideoUrl: '',
    Status: state.Busy && state.ActiveFace !== id ? state.Status : '',
  };
}
/** AddAt's fresh ID is supplied by the effect runner, keeping randomness outside pure reducers. */
export interface InputFacts extends AdmissionFacts {
  readonly newFaceId?: string;
}
export function inputs(message: Msg, state: State, facts: InputFacts = {}): Transition | null {
  switch (message.type) {
    case 'Edit': {
      const [id, value] = message.args;
      const released = forgetStill(state, id, true);
      const next = change(released.state, id, (item) => ({
        ...item,
        value,
      }));
      return {
        state: next,
        effects: [
          ...released.effects,
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidatePhotoSelections', id },
          { type: 'invalidateFace', id },
        ],
      };
    }
    case 'Mode': {
      const [id, mode] = message.args;
      const released = forgetStill(state, id, true);
      const next = change(released.state, id, (item) => ({
        ...item,
        mode,
        file: null,
        value: item.mode === 'photo' || item.mode === 'project' ? '' : item.value,
      }));
      return {
        state: next,
        effects: [
          ...released.effects,
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidatePhotoSelections', id },
          { type: 'invalidateFace', id },
          ...(next.Inputs.some((i) => i.id === id) ? [{ type: 'publicPreview' as const, id }] : []),
        ],
      };
    }
    case 'AddAt': {
      // No face count (fm-id4c): only the admission budgets refuse a new face, and then nothing is added.
      const admission = admitTo(state, { files: [] }, facts);
      if (!admission.ok) return { state: refused(state, admission), effects: [] };
      const position = Math.max(0, Math.min(state.Inputs.length, message.args[0]));
      if (!facts.newFaceId || state.Inputs.some((i) => i.id === facts.newFaceId))
        throw new Error('AddAt requires a fresh face ID');
      const input: Input = { id: facts.newFaceId, mode: 'text', value: '', file: null };
      return {
        state: {
          ...state,
          Inputs: [...state.Inputs.slice(0, position), input, ...state.Inputs.slice(position)],
          NextId: state.NextId + 1,
          VideoUrl: '',
        },
        effects: [{ type: 'invalidateArrivalRestore' }, { type: 'invalidateMorph' }],
      };
    }
    case 'Remove': {
      if (state.Inputs.length <= 1) return unchanged(state);
      const [id] = message.args;
      const released = forgetStill(state, id, true);
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      const cached = new Set(state.CachedFaces);
      cached.delete(id);
      return {
        state: {
          ...released.state,
          Faces: state.Faces.filter((f) => f.id !== id),
          PreparingFaces: preparing,
          CachedFaces: cached,
          Inputs: state.Inputs.filter((i) => i.id !== id),
          PendingJobs: state.PendingJobs.filter((j) => j.type !== 'RunFace' || j.args[0] !== id),
          PendingFaces: state.PendingFaces.filter((x) => x !== id),
          VideoUrl: '',
        },
        effects: [
          ...released.effects,
          { type: 'invalidateFace', id },
          { type: 'invalidatePhotoSelections', id },
        ],
      };
    }
    case 'Kind':
    case 'PinchToggle':
    case 'Quality':
    case 'Frames': {
      const patch =
        message.type === 'Kind'
          ? { Kind: message.args[0] }
          : message.type === 'Frames'
            ? { Frames: message.args[0] }
            : message.type === 'Quality'
              ? { Quality: message.args[0] }
              : { Pinch: message.args[0] };
      return {
        state: { ...state, ...patch, VideoUrl: '', SliderFrames: null },
        effects: [{ type: 'invalidateMorph' }],
      };
    }
    case 'CachedFaceChecked': {
      const [item, hit] = message.args;
      if (
        !state.Inputs.some(
          (i) =>
            i.id === item.id &&
            i.mode === item.mode &&
            i.value === item.value &&
            i.file === item.file,
        )
      )
        return unchanged(state);
      if (!hit)
        return {
          state: {
            ...state,
            Gate: [item.mode === 'photo' ? 'photo' : 'route', msg('RunFace', item.id)],
          },
          effects: [],
        };
      return {
        state: { ...state, CachedFaces: new Set([...state.CachedFaces, item.id]) },
        effects: [{ type: 'dispatch', message: msg('RunFace', item.id) }],
      };
    }
    case 'Provider':
      return state.Busy
        ? unchanged(state)
        : { state: { ...state, Provider: message.args[0] }, effects: [] };
    case 'OverflowToggle':
      return { state: { ...state, Overflow: message.args[0] }, effects: [] };
    default:
      return null;
  }
}
