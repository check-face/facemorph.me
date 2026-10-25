import { msg, type Msg } from '../msg.ts';
import type { State } from '../state.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import { change } from './inputs.ts';
import { schedule, enqueue, without, runFace } from './schedule.ts';
import { createCrop } from '../geometry.ts';
type Offer = Extract<Extract<Msg, { type: 'Photo' }>['args'][1], { kind: 'crop' }>['offer'];

export interface PhotoFacts {
  readonly photoRevision?: number;
  readonly newPhotoIds?: readonly string[];
}
export function revision(facts: PhotoFacts): number {
  if (facts.photoRevision === undefined)
    throw new Error('Photo transition requires its current revision');
  return facts.photoRevision;
}
/** Runs one genuine selection at a time. Pending photos keep their original File and order. */
export function dequeue(state: State, effects: readonly Effect[] = []): Transition {
  const next = state.PhotoQueue[0];
  return !next
    ? { state, effects }
    : {
        state: {
          ...state,
          PhotoQueue: state.PhotoQueue.slice(1),
          PreparingFaces: new Set([...state.PreparingFaces, next[0]]),
        },
        effects: [...effects, { type: 'selectPhoto', id: next[0], files: [next[1]] }],
      };
}
export function offerCrop(state: State, id: string, offer: Offer): Transition {
  const preparing = new Set(state.PreparingFaces);
  preparing.delete(id);
  const choice = {
    faceId: id,
    url: offer.url,
    file: offer.file,
    scale: offer.scale,
    view: createCrop({
      previewWidth: offer.previewWidth,
      previewHeight: offer.previewHeight,
      scale: offer.scale,
      viewport: 320,
    }),
  };
  const next = { ...state, PreparingFaces: preparing, Error: null };
  return state.Crop && state.Crop.faceId !== id
    ? {
        state: { ...next, CropQueue: [...state.CropQueue, choice] },
        effects: [],
      }
    : {
        state: { ...next, Crop: choice },
        effects: [
          ...(state.Crop ? [{ type: 'revokeUrl' as const, url: state.Crop.url }] : []),
          { type: 'focusCropArea' },
        ],
      };
}
const fileName = (file: Blob): string =>
  'name' in file && typeof file.name === 'string' ? file.name : '';
function acceptPhoto(state: State, id: string, file: Blob, fromCrop: boolean): Transition {
  const preparing = new Set(state.PreparingFaces);
  preparing.delete(id);
  const next = change(state, id, (item) => ({
    ...item,
    mode: 'photo',
    file,
    value: fileName(file),
  }));
  const queued = dequeue(
    {
      ...next,
      Error: null,
      PreparingFaces: preparing,
      Busy: fromCrop && state.Stage === 'cropping' ? false : state.Busy,
      Status: !fromCrop && state.Busy ? state.Status : next.Status,
    },
    [{ type: 'invalidateFace', id }],
  );
  return queued.state.Busy
    ? {
        state: {
          ...queued.state,
          PendingFaces: [...new Set([...queued.state.PendingFaces, id])],
          PendingJobs: enqueue(queued.state.PendingJobs, runFace(id)),
        },
        effects: queued.effects,
      }
    : { ...queued, effects: [...queued.effects, { type: 'dispatch', message: runFace(id) }] };
}
export function photo(message: Msg, state: State, facts: PhotoFacts = {}): Transition | null {
  switch (message.type) {
    case 'PickPhoto': {
      const [id, files] = message.args;
      const cached = new Set(state.CachedFaces);
      cached.delete(id);
      return {
        state: {
          ...state,
          PreparingFaces: new Set([...state.PreparingFaces, id]),
          Faces: state.Faces.filter((face) => face.id !== id),
          CachedFaces: cached,
        },
        effects: [
          { type: 'invalidateFace', id },
          { type: 'invalidatePhotoSelections', id },
          ...(files[0] ? [{ type: 'rememberSourcePhoto' as const, id, file: files[0] }] : []),
          { type: 'selectPhoto', id, files },
        ],
      };
    }
    case 'Cropped': {
      const [id, at, file] = message.args;
      return at !== revision(facts) ? unchanged(state) : acceptPhoto(state, id, file, true);
    }
    case 'PhotoFailed': {
      const [id, error] = message.args;
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      const next = dequeue({
        ...state,
        PreparingFaces: preparing,
        PendingJobs: without(state.PendingJobs, runFace(id)),
        PendingFaces: state.PendingFaces.filter((face) => face !== id),
        Error: error,
        FailureToast: !state.Debug,
      });
      return schedule(next.state, next.effects);
    }
    case 'PhotoError': {
      return dequeue({
        ...state,
        Error: message.args[0],
        Stage: state.Stage === 'cropping' ? 'idle' : state.Stage,
        Status: '',
        FailureToast: !state.Debug,
        LastRun: null,
      });
    }
    case 'Photo': {
      const [id, selection] = message.args;
      switch (selection.kind) {
        case 'superseded': {
          const preparing = new Set(state.PreparingFaces);
          preparing.delete(id);
          return schedule({ ...state, PreparingFaces: preparing });
        }
        case 'project':
          return {
            state,
            effects: [{ type: 'dispatch', message: msg('Import', selection.projectFile) }],
          };
        case 'recovered': {
          const preparing = new Set(state.PreparingFaces);
          preparing.delete(id);
          const cached = new Set(state.CachedFaces);
          cached.delete(id);
          const next = dequeue({
            ...state,
            Inputs: state.Inputs.map((item) =>
              item.id === id ? { ...item, mode: 'project', file: null, value: 'Saved face' } : item,
            ),
            CachedFaces: cached,
            Faces: selection.output.faces,
            PreparingFaces: preparing,
          });
          return schedule(next.state, next.effects);
        }
        case 'crop':
          return offerCrop(state, id, selection.offer);
        case 'photo':
          return acceptPhoto(state, id, selection.file, false);
      }
    }
    case 'Photos': {
      const [target, files] = message.args;
      if (!files.length) return unchanged(state);
      const inputs = [...state.Inputs];
      const targets: string[] = [];
      let generated = 0;
      const append = (): string => {
        const id = facts.newPhotoIds?.[generated++];
        if (!id || inputs.some((input) => input.id === id))
          throw new Error('Photo drop requires fresh face IDs');
        inputs.push({ id, mode: 'text', value: '', file: null });
        return id;
      };
      const empty = inputs.find(
        (item) => item.mode !== 'photo' && item.mode !== 'project' && !item.value.trim(),
      );
      targets.push(target ?? empty?.id ?? append());
      for (let index = 1; index < files.length; index++) targets.push(append());
      const effects: Effect[] = [{ type: 'invalidateArrivalRestore' }];
      for (const [index, id] of targets.entries())
        effects.push(
          { type: 'invalidateFace', id },
          { type: 'invalidatePhotoSelections', id },
          { type: 'rememberSourcePhoto', id, file: files[index]! },
        );
      effects.push({ type: 'selectPhoto', id: targets[0]!, files: [files[0]!] });
      return {
        state: {
          ...state,
          Inputs: inputs,
          PhotoQueue: targets.slice(1).map((id, index) => [id, files[index + 1]!] as const),
          Error: null,
          PreparingFaces: new Set([...state.PreparingFaces, targets[0]!]),
          CachedFaces: new Set(),
          Faces: state.Faces.filter((face) => !targets.includes(face.id)),
        },
        effects,
      };
    }
    case 'DismissDetected': {
      const choice = state.PhotoChoice;
      return schedule(
        {
          ...state,
          PhotoChoice: null,
          PendingJobs: state.PendingJobs.filter(
            (job) => job.type !== 'RunFace' || job.args[0] !== choice?.id,
          ),
          PendingFaces: state.PendingFaces.filter((id) => id !== choice?.id),
        },
        [
          { type: 'closeNamesFocus' },
          ...(choice ? [{ type: 'revokeUrl' as const, url: choice.url }] : []),
        ],
      );
    }
    case 'ChooseDetected': {
      const choice = state.PhotoChoice;
      if (!choice) return { state, effects: [{ type: 'closeNamesFocus' }] };
      return {
        state: {
          ...state,
          PhotoChoice: null,
          PreparingFaces: new Set([...state.PreparingFaces, choice.id]),
        },
        effects: [
          { type: 'closeNamesFocus' },
          { type: 'revokeUrl', url: choice.url },
          {
            type: 'chooseDetectedFace',
            id: choice.id,
            revision: revision(facts),
            choice,
            index: message.args[0],
          },
        ],
      };
    }
    default:
      return null;
  }
}
