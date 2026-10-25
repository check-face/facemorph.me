import type { Input, State } from '../state.ts';
import { msg, type Msg } from '../msg.ts';
import { unchanged, type Transition } from '../effects.ts';
export function change(state: State, id: string, replace: (input: Input) => Input): State {
  const cached = new Set(state.CachedFaces);
  cached.delete(id);
  return {
    ...state,
    CachedFaces: cached,
    Faces: state.Faces.filter((f) => f.id !== id),
    Inputs: state.Inputs.map((i) => (i.id === id ? replace(i) : i)),
    VideoUrl: '',
    Status: '',
  };
}
const digits = (value: string) => [...value].filter((c) => /\p{Nd}/u.test(c)).join('');
/** AddAt's fresh ID is supplied by the effect runner, keeping randomness outside pure reducers. */
export interface InputFacts {
  readonly newFaceId?: string;
}
export function inputs(message: Msg, state: State, facts: InputFacts = {}): Transition | null {
  switch (message.type) {
    case 'Edit': {
      const [id, value] = message.args;
      const next = change(state, id, (item) => ({
        ...item,
        value: item.mode === 'seed' ? digits(value) : value,
      }));
      return {
        state: next,
        effects: [
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidatePhotoSelections', id },
          { type: 'invalidateFace', id },
          ...(next.Inputs.some((i) => i.id === id) ? [{ type: 'publicPreview' as const, id }] : []),
        ],
      };
    }
    case 'Mode': {
      const [id, mode] = message.args;
      const next = change(state, id, (item) => ({
        ...item,
        mode,
        file: null,
        value:
          item.mode === 'photo' || item.mode === 'project'
            ? ''
            : mode === 'seed'
              ? digits(item.value)
              : item.value,
      }));
      return {
        state: next,
        effects: [
          { type: 'invalidateArrivalRestore' },
          { type: 'rememberSourcePhoto', id, file: null },
          { type: 'invalidatePhotoSelections', id },
          { type: 'invalidateFace', id },
          ...(next.Inputs.some((i) => i.id === id) ? [{ type: 'publicPreview' as const, id }] : []),
        ],
      };
    }
    case 'AddAt': {
      if (state.Inputs.length >= 64) return unchanged(state);
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
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      const cached = new Set(state.CachedFaces);
      cached.delete(id);
      return {
        state: {
          ...state,
          Faces: state.Faces.filter((f) => f.id !== id),
          PreparingFaces: preparing,
          CachedFaces: cached,
          Inputs: state.Inputs.filter((i) => i.id !== id),
          PendingJobs: state.PendingJobs.filter((j) => j.type !== 'RunFace' || j.args[0] !== id),
          PendingFaces: state.PendingFaces.filter((x) => x !== id),
          VideoUrl: '',
        },
        effects: [
          { type: 'invalidateFace', id },
          { type: 'rememberSourcePhoto', id, file: null },
          { type: 'invalidatePhotoSelections', id },
        ],
      };
    }
    case 'Kind':
    case 'PinchToggle':
    case 'Frames': {
      const patch =
        message.type === 'Kind'
          ? { Kind: message.args[0] }
          : message.type === 'Frames'
            ? { Frames: message.args[0] }
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
    case 'Compare':
      return { state: { ...state, Comparing: message.args[0] }, effects: [] };
    default:
      return null;
  }
}
