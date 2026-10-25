import type { State } from '../state.ts';
import type { Msg } from '../msg.ts';
import type { Transition } from '../effects.ts';
/** Completion of the synchronous reporting effect; reporting permission stays unchanged. */
export const reportSent = (state: State, sent: boolean): State =>
  sent ? { ...state, DebugStatus: 'Sending this report…' } : state;
export function reporting(message: Msg, state: State): Transition | null {
  switch (message.type) {
    case 'Debug':
    case 'Consent': {
      const enabled = message.args[0],
        basis = message.type === 'Debug' ? 'checkbox' : message.args[1];
      return {
        state: { ...state, Debug: enabled, Invite: false, ConsentPrompt: false },
        effects: [{ type: 'setDebug', enabled, basis }],
      };
    }
    case 'SendReportOnce':
      return { state, effects: [{ type: 'sendReportOnce' }] };
    case 'ReportFailure':
      return {
        state: { ...state, Debug: true, Invite: false, ConsentPrompt: false, FailureToast: false },
        effects: [{ type: 'setDebug', enabled: true, basis: 'toast' }],
      };
    case 'DismissConsentPrompt':
      return { state: { ...state, ConsentPrompt: false }, effects: [] };
    case 'DismissInvite':
      return { state: { ...state, Invite: false }, effects: [] };
    case 'DismissWarn':
      return { state: { ...state, Warn: null }, effects: [] };
    case 'DismissError':
      return { state: { ...state, Error: null, FailureToast: false }, effects: [] };
    case 'DismissFailureToast':
      return { state: { ...state, FailureToast: false }, effects: [] };
    default:
      return null;
  }
}
