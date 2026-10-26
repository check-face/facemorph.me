import { gateScope, scopeReady } from '../derived.ts';
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
    case 'DownloadsChanged': {
      const next = { ...state, Downloads: message.args[0] };
      // A question asked while the inventory was still unknown resolves itself once the device finds it already
      // holds what the action needs: nothing to download, so nothing to approve (fm-qrfz).
      if (
        state.Gate &&
        !state.Downloads.known &&
        next.Downloads.known &&
        scopeReady(next.Downloads, state.Gate[0])
      )
        return {
          state: { ...next, Gate: null },
          effects: [{ type: 'dispatch', message: state.Gate[1] }],
        };
      return { state: next, effects: [] };
    }
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
