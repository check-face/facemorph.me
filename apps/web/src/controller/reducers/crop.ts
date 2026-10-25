import type { Msg } from '../msg.ts';
import type { State } from '../state.ts';
import type { Effect, Transition } from '../effects.ts';
import { unchanged } from '../effects.ts';
import { resizeCrop, panCrop, zoomCrop, rotateCrop, cropRect } from '../geometry.ts';
import { dequeue, revision, type PhotoFacts } from './photo.ts';
import { schedule } from './schedule.ts';

export function nextCrop(state: State, effects: readonly Effect[] = []): Transition {
  const next = state.CropQueue[0];
  return next
    ? {
        state: { ...state, Crop: next, CropQueue: state.CropQueue.slice(1) },
        effects: [...effects, { type: 'focusCropArea' }],
      }
    : { state, effects };
}
export function crop(message: Msg, state: State, facts: PhotoFacts = {}): Transition | null {
  const choice = state.Crop;
  switch (message.type) {
    case 'CropAdjust':
      return choice && !choice.previousView
        ? { state: { ...state, Crop: { ...choice, previousView: choice.view } }, effects: [] }
        : unchanged(state);
    case 'CropUse': {
      if (!choice?.previousView) return unchanged(state);
      const { previousView: _saved, ...proposal } = choice;
      return { state: { ...state, Crop: proposal }, effects: [] };
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
      return !choice || Math.abs(choice.view.viewport - message.args[0]) <= 0.5
        ? unchanged(state)
        : {
            state: {
              ...state,
              Crop: { ...choice, view: resizeCrop(choice.view, message.args[0]) },
            },
            effects: [],
          };
    case 'CropPan':
      return choice
        ? {
            state: { ...state, Crop: { ...choice, view: panCrop(choice.view, ...message.args) } },
            effects: [],
          }
        : unchanged(state);
    case 'CropZoom':
      return choice
        ? {
            state: { ...state, Crop: { ...choice, view: zoomCrop(choice.view, message.args[0]) } },
            effects: [],
          }
        : unchanged(state);
    case 'CropRotate':
      return choice
        ? { state: { ...state, Crop: { ...choice, view: rotateCrop(choice.view) } }, effects: [] }
        : unchanged(state);
    case 'CropCancel': {
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
          ...(choice ? [{ type: 'invalidatePhotoSelections' as const, id: choice.faceId }] : []),
          ...(choice ? [{ type: 'revokeUrl' as const, url: choice.url }] : []),
        ],
      );
      const ready = dequeue(next.state, next.effects);
      return schedule(ready.state, ready.effects);
    }
    case 'CropAccept': {
      if (!choice || choice.previousView) return unchanged(state);
      // A replaced or removed target cannot commit an old proposal, even through a delayed event.
      if (choice.input && state.Inputs.find((input) => input.id === choice.faceId) !== choice.input)
        return crop({ type: 'CropCancel', args: [] }, state, facts);
      const next = nextCrop(
        {
          ...state,
          Crop: null,
          PreparingFaces: new Set([...state.PreparingFaces, choice.faceId]),
        },
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
            options: Object.freeze({ previewScale: choice.scale, rotation: choice.view.rotation }),
          },
        ],
      };
    }
    default:
      return null;
  }
}
