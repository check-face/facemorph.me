import type { State } from '../state.ts';
import { msg, type Msg } from '../msg.ts';
import { unchanged, type Transition } from '../effects.ts';
import { change } from './inputs.ts';
// Request rule (fm-96if). Typing in a face field never sends a request: no instant picture and no
// name list per keystroke. The name list loads only when the picker opens (BrowseNames, below).
// An instant picture is described only for an explicit act: picking a name here (ChooseName) or
// switching a face's mode (inputs.ts `Mode`); the shipped default `hello` preview needs no request.
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
      return {
        state: {
          ...change(state, id, (i) => ({ ...i, mode: 'text', value: message.args[0], file: null })),
          Browse: null,
        },
        effects: [
          { type: 'closeNamesFocus' },
          { type: 'invalidateFace', id },
          { type: 'publicPreview', id },
          { type: 'dispatch', message: msg('RunFace', id) },
        ],
      };
    }
    case 'CloseNames':
      return { state: { ...state, Browse: null }, effects: [{ type: 'closeNamesFocus' }] };
    case 'MoreNames':
      return { state: { ...state, NameLimit: state.NameLimit + 48 }, effects: [] };
    default:
      return null;
  }
}
