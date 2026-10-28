import type { State } from '../state.ts';
import type { Msg } from '../msg.ts';
import { unchanged, type Transition } from '../effects.ts';
import { change } from './inputs.ts';
import { schedule } from './schedule.ts';
// Request rule (fm-96if). Typing in a face field never sends a request: no instant picture and no
// name list per keystroke. The name list loads only when the picker opens (BrowseNames, below).
// An instant picture is described only for an explicit act: picking a name here (ChooseName) or
// switching a face's mode (inputs.ts `Mode`); the shipped default `hello` preview needs no request.
// A pick then installs that name's published result (pickName -> NamePicked), never a synthesis.
// Every remaining outside request is listed in src/controller/outside-requests.ts.
function withoutError(state: State): State {
  const { NamesError: _failed, ...rest } = state;
  return rest;
}
export function names(message: Msg, state: State): Transition | null {
  switch (message.type) {
    case 'BrowseNames':
      return {
        state: { ...withoutError(state), Browse: message.args[0], NameQuery: '', NameLimit: 48 },
        effects: [
          { type: 'openNamesFocus' },
          ...(state.Names.length ? [] : [{ type: 'loadNames' as const }]),
        ],
      };
    case 'NamesLoaded':
      return { state: { ...withoutError(state), Names: message.args[0] }, effects: [] };
    case 'NamesFailed':
      return { state: { ...state, NamesError: message.args[0] }, effects: [] };
    case 'PreviewLoaded': {
      const [id, mode, value, url] = message.args;
      if (!state.Inputs.some((i) => i.id === id && i.mode === mode && i.value === value))
        return unchanged(state);
      const remaining = state.Previews.filter((p) => p.id !== id);
      return {
        state: { ...state, Previews: url ? [{ id, mode, value, url }, ...remaining] : remaining },
        effects: [],
      };
    }
    case 'SearchNames':
      return { state: { ...state, NameQuery: message.args[0], NameLimit: 48 }, effects: [] };
    case 'ChooseName': {
      const id = state.Browse;
      if (id === null) return { state, effects: [{ type: 'closeNamesFocus' }] };
      // The picker is bound to the face that opened it: once that face is gone, the pick writes to no face.
      if (!state.Inputs.some((input) => input.id === id))
        return { state: { ...state, Browse: null }, effects: [{ type: 'closeNamesFocus' }] };
      const changed = change(state, id, (i) => ({
        ...i,
        mode: 'text',
        value: message.args[0],
        file: null,
      }));
      return {
        state: {
          ...changed,
          Browse: null,
          // Loading in that face until its published result is checked and installed (or refused).
          PreparingFaces: new Set([...changed.PreparingFaces, id]),
        },
        effects: [
          { type: 'closeNamesFocus' },
          { type: 'invalidateFace', id },
          { type: 'publicPreview', id },
          // The published result, not synthesis (fm-ejwq): no model download, no inference, no Generate step.
          { type: 'pickName', id },
        ],
      };
    }
    case 'NamePicked': {
      const [id, value, selection] = message.args;
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      const input = state.Inputs.find((i) => i.id === id);
      // An edit, a mode change or a removal since the pick supersedes it: nothing is installed.
      if (selection.kind !== 'recovered' || input?.mode !== 'text' || input.value !== value)
        return schedule({ ...state, PreparingFaces: preparing });
      const cached = new Set(state.CachedFaces);
      cached.delete(id);
      return schedule({
        ...state,
        PreparingFaces: preparing,
        CachedFaces: cached,
        Error: null,
        Faces: [
          ...state.Faces.filter((face) => face.id !== id),
          ...selection.output.faces.filter((face) => face.id === id),
        ],
      });
    }
    case 'CloseNames':
      return { state: { ...state, Browse: null }, effects: [{ type: 'closeNamesFocus' }] };
    case 'MoreNames':
      return { state: { ...state, NameLimit: state.NameLimit + 48 }, effects: [] };
    default:
      return null;
  }
}
