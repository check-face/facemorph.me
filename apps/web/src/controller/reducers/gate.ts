import { gateScope } from '../derived.ts';
import { unchanged, type Transition } from '../effects.ts';
import type { State } from '../state.ts';
import type { Msg } from '../msg.ts';

export function gate(message: Msg, state: State): Transition | null {
  if (!state.Busy && ['RunFace', 'Run', 'Import'].includes(message.type)) {
    const scope = gateScope(state, message);
    if (scope) {
      if (message.type === 'RunFace') {
        const input = state.Inputs.find((item) => item.id === message.args[0]);
        return input ? { state, effects: [{ type: 'checkCachedFace', input }] } : unchanged(state);
      }
      return { state: { ...state, Gate: [scope, message] }, effects: [] };
    }
  }
  switch (message.type) {
    case 'GateAccept': {
      if (state.Gate === null) return unchanged(state);
      const [scope, pending] = state.Gate;
      return {
        state: {
          ...state,
          Gate: null,
          DownloadConsent: new Set([
            ...state.DownloadConsent,
            scope,
            ...(scope === 'photo' ? ['route'] : []),
          ]),
          ModelToastHidden: true,
        },
        effects: [
          { type: 'consentToDownload', scope },
          { type: 'dispatch', message: pending },
        ],
      };
    }
    case 'GateCancel':
      return { state: { ...state, Gate: null }, effects: [] };
    case 'DownloadsChanged':
      return { state: { ...state, Downloads: message.args[0] }, effects: [] };
    case 'DownloadNow':
      return {
        state: {
          ...state,
          DownloadConsent: new Set([
            ...state.DownloadConsent,
            'route',
            ...(message.args[0] ? ['photo'] : []),
          ]),
          ModelToastHidden: false,
        },
        effects: [{ type: 'downloadModels', includePhoto: message.args[0] }],
      };
    case 'HideModelToast':
      return { state: { ...state, ModelToastHidden: true }, effects: [] };
    default:
      return null;
  }
}
