import { codecMissingBytes, gateScope, scopeReady } from '../derived.ts';
import { unchanged, type Transition } from '../effects.ts';
import type { State } from '../state.ts';
import type { Msg } from '../msg.ts';
import { msg } from '../msg.ts';
import { change } from './inputs.ts';

function queuedPreparation(state: State): State {
  return state.Downloads.photoApprovalRequired && state.EncoderSetup !== 'cancelled'
    ? { ...state, Gate: ['photo', { type: 'DownloadNow', args: [true] }] }
    : state;
}

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
    case 'MorphCodecChecked': {
      const [run, needed, bytes] = message.args;
      return {
        state: { ...state, MorphCodec: { run, needed, bytes: needed ? bytes : 0 } },
        effects: [{ type: 'dispatch', message: run, continuation: true }],
      };
    }
    case 'ResumePhoto': {
      const [id] = message.args;
      const photo = state.PausedPhotos?.get(id);
      if (!photo || state.Busy || !state.Inputs.some((input) => input.id === id))
        return unchanged(state);
      const paused = new Map(state.PausedPhotos);
      paused.delete(id);
      return {
        state: { ...change(state, id, () => photo), PausedPhotos: paused },
        effects: [
          { type: 'invalidateFace', id },
          { type: 'dispatch', message: msg('RunFace', id), continuation: true },
        ],
      };
    }
    case 'PrepareEncoder':
      return state.Downloads.known &&
        state.Downloads.photoAvailable &&
        !state.Downloads.photoReady &&
        state.EncoderSetup !== 'active' &&
        !state.Gate
        ? {
            state: {
              ...state,
              EncoderSetup: 'requested',
              Gate: ['photo', { type: 'DownloadNow', args: [true] }],
            },
            effects: [],
          }
        : unchanged(state);
    case 'CancelEncoderSetup':
      if (state.EncoderSetup !== 'requested' && state.EncoderSetup !== 'active')
        return unchanged(state);
      return {
        state: {
          ...state,
          EncoderSetup: 'cancelled',
          Gate: state.Gate?.[1].type === 'DownloadNow' ? null : state.Gate,
          Downloads: { ...state.Downloads, photoApprovalRequired: false },
          DownloadConsent: new Set([...state.DownloadConsent].filter((scope) => scope !== 'photo')),
        },
        effects: [{ type: 'cancelDownloadSetup' }],
      };
    case 'GateAccept': {
      if (state.Gate === null) return unchanged(state);
      const [scope, pending] = state.Gate;
      const preparation = pending.type === 'DownloadNow';
      const bundle = message.args[0] ?? (scope === 'photo' ? 'photo' : 'route');
      if (bundle === 'photo' && message.args[0] && !state.Downloads.photoAvailable)
        return unchanged(state);
      // Approval of synthesis does not approve the pending photo operation. Keep its
      // exact inspected source, without a new chooser, under the same admission ceiling.
      if (scope === 'photo' && bundle === 'route' && !preparation) {
        const paused = new Map(state.PausedPhotos);
        const ids = new Set(
          state.Inputs.filter(
            (input) =>
              input.mode === 'photo' &&
              input.file &&
              (pending.type !== 'RunFace' || input.id === pending.args[0]) &&
              !state.Faces.some((face) => face.id === input.id),
          ).map((input) => {
            paused.set(input.id, input);
            return input.id;
          }),
        );
        return {
          state: {
            ...state,
            Gate: null,
            PausedPhotos: paused,
            Inputs: state.Inputs.map((input) =>
              ids.has(input.id)
                ? { ...input, mode: 'text' as const, value: '', file: null }
                : input,
            ),
            DownloadConsent: new Set([...state.DownloadConsent, 'route']),
            PendingFaces: state.PendingFaces.filter((id) => !ids.has(id)),
            PendingJobs: state.PendingJobs.filter(
              (job) => !(job.type === 'RunFace' && ids.has(job.args[0])) && job.type !== 'Run',
            ),
            PendingMorph: false,
            Status: 'Encoding needs the photo encoder.',
            ModelToastHidden: false,
          },
          effects: [{ type: 'downloadModels', includePhoto: false }],
        };
      }
      const optionalPhoto = scope !== 'photo' && bundle === 'photo';
      // The codec belongs to Generate, which every bundle includes: approving the decision approves its bytes.
      const codec = codecMissingBytes(state, pending) > 0;
      return {
        state: queuedPreparation({
          ...state,
          Gate: null,
          ...(preparation || optionalPhoto
            ? { EncoderSetup: bundle === 'photo' ? ('active' as const) : ('cancelled' as const) }
            : {}),
          Downloads: preparation
            ? { ...state.Downloads, photoApprovalRequired: false }
            : state.Downloads,
          DownloadConsent: new Set([
            ...state.DownloadConsent,
            bundle,
            ...(bundle === 'photo' ? ['route'] : []),
            ...(codec ? ['codec'] : []),
          ]),
          ModelToastHidden: true,
        }),
        effects: preparation
          ? [{ type: 'dispatch', message: msg('DownloadNow', bundle === 'photo') }]
          : [
              ...(optionalPhoto ? [{ type: 'downloadModels' as const, includePhoto: true }] : []),
              ...(codec ? [{ type: 'consentToDownload' as const, scope: 'codec' }] : []),
              { type: 'consentToDownload', scope: bundle },
              { type: 'dispatch', message: pending },
            ],
      };
    }
    case 'GateCancel': {
      const preparation = state.Gate?.[1].type === 'DownloadNow';
      return {
        state: queuedPreparation({
          ...state,
          Gate: null,
          ...(preparation
            ? {
                Downloads: { ...state.Downloads, photoApprovalRequired: false },
                EncoderSetup: 'cancelled' as const,
                DownloadConsent: new Set(
                  [...state.DownloadConsent].filter((scope) => scope !== 'photo'),
                ),
              }
            : {}),
        }),
        effects: preparation ? [{ type: 'cancelDownloadSetup' }] : [],
      };
    }
    case 'DownloadsChanged': {
      // A late setup revision cannot revive an explicitly cancelled owner. Card/photo
      // gates and their own explicit approvals remain independent of this setup notice.
      const downloads =
        state.EncoderSetup === 'cancelled' && message.args[0].photoApprovalRequired
          ? { ...message.args[0], photoApprovalRequired: false }
          : message.args[0];
      const { EncoderSetup: _owner, ...withoutOwner } = state;
      const settled =
        state.EncoderSetup === 'active' &&
        (downloads.photoReady || (downloads.phase === 'failed' && downloads.scope === 'photo'));
      const next = {
        ...(settled ? withoutOwner : state),
        Downloads: downloads,
        ...(downloads.photoApprovalRequired
          ? {
              DownloadConsent: new Set(
                [...state.DownloadConsent].filter((scope) => scope !== 'photo'),
              ),
            }
          : {}),
      };
      if (next.Downloads.photoApprovalRequired && !state.Gate)
        return {
          state: queuedPreparation(next),
          effects: [],
        };
      // A question asked while the inventory was still unknown resolves itself once the device finds it already
      // holds what the action needs: nothing to download, so nothing to approve (fm-qrfz).
      if (
        state.Gate &&
        !state.Downloads.known &&
        next.Downloads.known &&
        scopeReady(next.Downloads, state.Gate[0])
      )
        return {
          state: queuedPreparation({ ...next, Gate: null }),
          effects: [{ type: 'dispatch', message: state.Gate[1], continuation: true }],
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
