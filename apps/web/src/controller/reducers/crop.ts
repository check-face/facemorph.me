import type { Msg } from '../msg.ts';
import { msg } from '../msg.ts';
import type { CropChoice, State } from '../state.ts';
import type { Effect, Transition } from '../effects.ts';
import { unchanged } from '../effects.ts';
import {
  alignCrop,
  cropRect,
  panCrop,
  resizeCrop,
  resizeStencil,
  rotateCrop,
  turnCrop,
} from '../geometry.ts';
import type { CropView } from '../msg.ts';
import type { DetectedFace } from '../batch-selection.ts';
import { cropsPending, dequeue, revision, type PhotoFacts } from './photo.ts';
import { schedule } from './schedule.ts';
import { batchFacesFirst, chooseFromCrop, editPick, finishPick } from './batch.ts';

export function nextCrop(state: State, effects: readonly Effect[] = []): Transition {
  const next = state.CropQueue[0];
  return next
    ? {
        state: { ...state, Crop: next, CropQueue: state.CropQueue.slice(1) },
        effects: [...effects, { type: 'focusCropArea' }],
      }
    : { state, effects };
}

/** A detected face's aligned square as the crop view's proposal (fm-k09b): preview pixels and its angle. */
export function alignedView(view: CropView, face: DetectedFace): CropView {
  const { cx, cy, side, rotation } = face.align;
  return alignCrop(view, {
    cx: cx * view.previewWidth,
    cy: cy * view.previewHeight,
    side: side * view.previewWidth,
    rotation,
  });
}

/**
 * Faces first (fm-k09b, operator ruling 28 October 2026): an open crop waiting for the detector runs it as soon as
 * photo processing is ready on this device. When its files are missing, the existing photo-setup download decision
 * is asked once for this photo; declining it (or a failed download, or no photo processing here) means detection did
 * not run, a neutral note, never "unable to align". Runs after every transition, so whichever message makes the
 * detector ready (the inventory, the decision, the download) starts it.
 */
export function faceFirst(transition: Transition): Transition {
  return batchFacesFirst(cropFacesFirst(transition));
}
function cropFacesFirst(transition: Transition): Transition {
  const state = transition.state;
  const choice = state.Crop;
  if (!choice || choice.detect !== 'waiting') return transition;
  const downloads = state.Downloads;
  const set = (
    change: Partial<CropChoice>,
    extra: Partial<State> = {},
    effects: Effect[] = [],
  ) => ({
    state: { ...state, ...extra, Crop: { ...choice, ...change } },
    effects: [...transition.effects, ...effects],
  });
  if (!downloads.known) return transition;
  if (downloads.photoReady)
    return choice.preview
      ? set({ detect: 'running' }, {}, [
          {
            type: 'detectCropFaces',
            id: choice.faceId,
            url: choice.url,
            file: choice.preview,
          },
        ])
      : set({ detect: 'not-run' });
  if (!downloads.photoAvailable) return set({ detect: 'not-run' });
  if (!choice.asked) {
    if (state.EncoderSetup === 'active') return set({ asked: true });
    // The photo files were already approved in this session (an earlier photo's OK): the rest of them, the
    // detector's, download within that approval rather than asking again.
    if (state.DownloadConsent.has('photo'))
      return set({ asked: true }, { EncoderSetup: 'active' }, [
        { type: 'downloadModels', includePhoto: true },
      ]);
    // Declined in this session already (here or by the page's own setup): not asked again.
    if (state.EncoderSetup === 'cancelled') return set({ detect: 'not-run' });
    if (state.Gate) return transition;
    return set(
      { asked: true },
      { EncoderSetup: 'requested', Gate: ['photo', msg('DownloadNow', true)] },
    );
  }
  return state.EncoderSetup === 'requested' || state.EncoderSetup === 'active'
    ? transition
    : set({ detect: 'not-run' });
}

/** The detector's faces for the open crop (stale answers are ignored). */
function detected(state: State, faces: readonly DetectedFace[] | null): Transition {
  const choice = state.Crop!;
  const proposal = (view: CropView): Pick<CropChoice, 'view' | 'previousView'> =>
    choice.previousView ? { view: choice.view, previousView: view } : { view };
  if (!faces) return unchanged({ ...state, Crop: { ...choice, detect: 'not-run' } });
  if (!faces.length) return unchanged({ ...state, Crop: { ...choice, detect: 'none' } });
  // Two or more faces in one photo: the Choose faces view, in tap order (fm-zigt).
  if (faces.length > 1) return chooseFromCrop(state, choice, faces);
  const base = choice.previousView ?? choice.view;
  return unchanged({
    ...state,
    Crop: {
      ...choice,
      ...proposal(alignedView(base, faces[0]!)),
      detect: 'one',
    },
  });
}

const editing = (state: State, change: (view: CropView) => CropView): Transition => {
  const choice = state.Crop;
  // The editor open on one pick of the Choose faces view (its Adjust) changes only that pick.
  if (!choice && state.Batch?.editing) return editPick(state, change);
  return choice
    ? {
        state: { ...state, Crop: { ...choice, view: change(choice.view) } },
        effects: [],
      }
    : unchanged(state);
};

export function crop(message: Msg, state: State, facts: PhotoFacts = {}): Transition | null {
  const choice = state.Crop;
  switch (message.type) {
    case 'CropAdjust':
      return choice && !choice.previousView
        ? {
            state: { ...state, Crop: { ...choice, previousView: choice.view } },
            effects: [],
          }
        : unchanged(state);
    case 'CropUse': {
      if (!choice && state.Batch?.editing) return finishPick(state, true);
      if (!choice?.previousView) return unchanged(state);
      const { previousView: _saved, ...proposal } = choice;
      // The person's own crop: the confirmation shows it with no detector note.
      return {
        state: {
          ...state,
          Crop: {
            ...proposal,
            detect: choice.detect === 'running' ? 'running' : 'adjusted',
          },
        },
        effects: [],
      };
    }
    case 'CropDetected': {
      const [id, url, faces] = message.args;
      if (!choice || choice.faceId !== id || choice.url !== url || choice.detect !== 'running')
        return unchanged(state);
      return detected(state, faces);
    }
    case 'RequestCrop': {
      const [id] = message.args;
      if (state.ActiveFace === id) return unchanged(state);
      const input = state.Inputs.find((item) => item.id === id);
      return input?.file
        ? { state, effects: [{ type: 'previewPhoto', id, file: input.file }] }
        : unchanged(state);
    }
    case 'CropViewport':
      if (!choice && state.Batch?.editing)
        return editPick(state, (view) => resizeCrop(view, message.args[0]));
      return !choice || Math.abs(choice.view.viewport - message.args[0]) <= 0.5
        ? unchanged(state)
        : editing(state, (view) => resizeCrop(view, message.args[0]));
    case 'CropPan':
      return editing(state, (view) => panCrop(view, ...message.args));
    case 'CropResize':
      return editing(state, (view) => resizeStencil(view, ...message.args));
    case 'CropRotate':
      return editing(state, rotateCrop);
    case 'CropTurn':
      return editing(state, (view) => turnCrop(view, message.args[0]));
    case 'CropCancel': {
      if (!choice && state.Batch?.editing) return finishPick(state, false);
      if (choice?.previousView) {
        const { previousView, ...proposal } = choice;
        return {
          state: { ...state, Crop: { ...proposal, view: previousView } },
          effects: [],
        };
      }
      const next = nextCrop(
        {
          ...state,
          Crop: null,
          PendingJobs: state.PendingJobs.filter(
            (job) => job.type !== 'RunFace' || job.args[0] !== choice?.faceId,
          ),
          PendingFaces: state.PendingFaces.filter((id) => id !== choice?.faceId),
        },
        [
          { type: 'cancelPhotoRun' },
          ...(choice
            ? [
                {
                  type: 'invalidatePhotoSelections' as const,
                  id: choice.faceId,
                },
              ]
            : []),
          ...(choice ? [{ type: 'revokeUrl' as const, url: choice.url }] : []),
        ],
      );
      const ready = dequeue(next.state, next.effects);
      return schedule(ready.state, ready.effects);
    }
    case 'CropAccept': {
      // While faces are still being looked for (or photo processing is being decided) there is no proposal yet.
      if (
        !choice ||
        choice.previousView ||
        choice.detect === 'running' ||
        choice.detect === 'waiting'
      )
        return unchanged(state);
      // A replaced or removed target cannot commit an old proposal, even through a delayed event.
      if (choice.input && state.Inputs.find((input) => input.id === choice.faceId) !== choice.input)
        return crop({ type: 'CropCancel', args: [] }, state, facts);
      const next = nextCrop(
        cropsPending(
          {
            ...state,
            Crop: null,
            PreparingFaces: new Set([...state.PreparingFaces, choice.faceId]),
          },
          [choice.faceId],
        ),
        [{ type: 'revokeUrl', url: choice.url }],
      );
      return {
        ...next,
        effects: [
          ...next.effects,
          {
            type: 'cropPhoto',
            id: choice.faceId,
            revision: revision(facts),
            file: choice.file,
            area: Object.freeze(cropRect(choice.view)),
            options: Object.freeze({
              previewScale: choice.scale,
              rotation: choice.view.rotation,
            }),
          },
        ],
      };
    }
    default:
      return null;
  }
}
