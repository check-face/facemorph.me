import { msg, type Msg } from '../msg.ts';
import type { State } from '../state.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import { change } from './inputs.ts';
import { schedule, enqueue, without, runFace } from './schedule.ts';
import { createCrop } from '../geometry.ts';
import type { ClassifiedStill } from '../msg.ts';
import type { CropChoice, HeldStill } from '../state.ts';
import { admitTo, refusal, type AdmissionFacts } from '../admission.ts';
import { openBatch, proposedView } from './batch.ts';
type Offer = Extract<Extract<Msg, { type: 'Photo' }>['args'][1], { kind: 'crop' }>['offer'];

export interface PhotoFacts extends AdmissionFacts {
  readonly photoRevision?: number;
  readonly newPhotoIds?: readonly string[];
}
/** Kinds a face holds as media; `matching` and `missing` continue to the bridge's own entry. */
const isHeld = (kind: ClassifiedStill['kind']): kind is HeldStill['kind'] =>
  kind !== 'matching' && kind !== 'missing';
/** The still-check key of a drop on the page rather than on a face. */
export const DROP_KEY = '*';
/** A fresh classification token for `key`; a later pick or drop on the same key supersedes it. */
function checkStill(state: State, key: string): readonly [State, number] {
  const token = (state.StillSeq ?? 0) + 1;
  const checks = new Map(state.StillChecks ?? []);
  checks.set(key, token);
  return [{ ...state, StillSeq: token, StillChecks: checks }, token];
}
/**
 * The face no longer holds its still (it was replaced, edited or removed); with `checks`, a classification still
 * pending for it is superseded too, so its late verdict is discarded.
 */
export function forgetStill(state: State, id: string, checks: boolean): Transition {
  const held = state.Held?.get(id);
  const pending = checks && state.StillChecks?.has(id);
  if (!held && !pending) return { state, effects: [] };
  const next: { -readonly [K in keyof State]: State[K] } = { ...state };
  if (held) {
    const map = new Map(state.Held);
    map.delete(id);
    next.Held = map;
  }
  if (pending) {
    const map = new Map(state.StillChecks);
    map.delete(id);
    next.StillChecks = map;
  }
  return { state: next, effects: held?.url ? [{ type: 'revokeUrl', url: held.url }] : [] };
}
/** The face holds `entry` as media: shown, saved as its original bytes and never computed with. */
export function hold(state: State, id: string, entry: ClassifiedStill): Transition {
  if (!isHeld(entry.kind) || !entry.reason) throw new Error('Only a held kind is held by a face');
  const released = forgetStill(state, id, false);
  const preparing = new Set(released.state.PreparingFaces);
  preparing.delete(id);
  // A damaged still never replaces the face: its identity is unchanged, and Use as photo is explicit.
  const damaged = entry.kind === 'damaged';
  const base = damaged
    ? released.state
    : change(released.state, id, (item) => ({
        ...item,
        mode: 'project',
        file: null,
        value: 'Saved face',
      }));
  const still: HeldStill = {
    kind: entry.kind,
    reason: entry.reason,
    file: entry.file,
    url: damaged ? '' : (entry.url ?? ''),
    photoAction: entry.decodes === true,
  };
  const map = new Map(base.Held ?? []);
  map.set(id, still);
  const effects: Effect[] = [...released.effects];
  if (damaged && entry.url) effects.push({ type: 'revokeUrl', url: entry.url });
  if (!damaged) effects.push({ type: 'invalidateFace', id });
  return { state: { ...base, Held: map, PreparingFaces: preparing, Error: null }, effects };
}
function classified(
  [key, token, pick, target, entries]: Extract<Msg, { type: 'Classified' }>['args'],
  state: State,
  facts: PhotoFacts,
): Transition {
  const urls: Effect[] = entries.flatMap((entry) =>
    entry.url ? [{ type: 'revokeUrl' as const, url: entry.url }] : [],
  );
  // A verdict for a superseded pick or drop (a newer one, an edit, a removal) changes nothing.
  if (state.StillChecks?.get(key) !== token) return { state, effects: urls };
  const checks = new Map(state.StillChecks);
  checks.delete(key);
  // Admitted again as the faces are added (the state may have changed since the pick or drop): a refusal adds
  // nothing, not even part of the drop.
  const admission = admitTo(state, { files: entries.map((e) => e.file), replacing: target }, facts);
  if (!admission.ok) {
    const preparing = new Set(state.PreparingFaces);
    if (target !== null) preparing.delete(target);
    return refusal({ ...state, StillChecks: checks, PreparingFaces: preparing }, admission, urls);
  }
  let next: State = { ...state, StillChecks: checks };
  // Several files open one batch view (fm-id4c, fm-q5b9): nothing about the faces changes until its OK.
  if (entries.length > 1) {
    if (target !== null && !next.Inputs.some((input) => input.id === target))
      return { state: next, effects: urls };
    return openBatch(next, key, token, pick, target, entries);
  }
  const effects: Effect[] = [];
  const apply = (id: string, entry: ClassifiedStill) => {
    const t = hold(next, id, entry);
    next = t.state;
    effects.push(...t.effects);
  };
  const unused = (entry: ClassifiedStill) => {
    if (entry.url) effects.push({ type: 'revokeUrl', url: entry.url });
  };
  if (pick) {
    const id = target ?? '';
    if (!next.Inputs.some((input) => input.id === id)) return { state: next, effects: urls };
    const [first] = entries;
    if (entries.length === 1 && first && isHeld(first.kind)) {
      apply(id, first);
      return schedule(next, effects);
    }
    entries.forEach(unused);
    return {
      state: next,
      effects: [...effects, { type: 'selectPhoto', id, files: entries.map((e) => e.file) }],
    };
  }
  if (target !== null && !next.Inputs.some((input) => input.id === target)) {
    const preparing = new Set(next.PreparingFaces);
    preparing.delete(target);
    return { state: { ...next, PreparingFaces: preparing }, effects: urls };
  }
  const inputs = [...next.Inputs];
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
  for (let index = 1; index < entries.length; index++) targets.push(append());
  next = { ...next, Inputs: inputs };
  effects.push({ type: 'invalidateArrivalRestore' });
  for (const id of targets) effects.push({ type: 'invalidatePhotoSelections', id });
  const photos: (readonly [string, File])[] = [];
  entries.forEach((entry, index) => {
    const id = targets[index]!;
    if (isHeld(entry.kind)) apply(id, entry);
    else {
      unused(entry);
      photos.push([id, entry.file]);
    }
  });
  const [first, ...rest] = photos;
  if (!first) return schedule({ ...next, PhotoQueue: [] }, effects);
  effects.push({ type: 'selectPhoto', id: first[0], files: [first[1]] });
  return {
    state: {
      ...next,
      PhotoQueue: rest,
      Error: null,
      PreparingFaces: new Set([...next.PreparingFaces, first[0]]),
    },
    effects,
  };
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
  const input = state.Inputs.find((item) => item.id === id);
  if (!input) return { state, effects: [{ type: 'revokeUrl', url: offer.url }] };
  const preparing = new Set(state.PreparingFaces);
  preparing.delete(id);
  const initial = createCrop({
    previewWidth: offer.previewWidth,
    previewHeight: offer.previewHeight,
    scale: offer.scale,
    viewport: 320,
  });
  // A face picked by its detected box in the batch view opens with that box as the proposed crop; any other photo
  // waits for the detector first (fm-k09b, faceFirst), whose answer is the proposal.
  const box = state.CropProposals?.get(id);
  const choice: CropChoice = {
    faceId: id,
    input,
    url: offer.url,
    file: offer.file,
    scale: offer.scale,
    view: box ? proposedView(initial, box) : initial,
    preview: offer.blob,
    detect: box ? 'adjusted' : 'waiting',
  };
  const proposals = new Map(state.CropProposals ?? []);
  proposals.delete(id);
  const next = {
    ...state,
    PreparingFaces: preparing,
    Error: null,
    ModelToastHidden: true,
    ...(box ? { CropProposals: proposals } : {}),
  };
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
function acceptPhoto(input: State, id: string, file: Blob, fromCrop: boolean): Transition {
  const released = forgetStill(input, id, false);
  const state = released.state;
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
    [...released.effects, { type: 'invalidateFace', id }],
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
    : {
        ...queued,
        effects: [
          ...queued.effects,
          { type: 'dispatch', message: runFace(id), continuation: true },
        ],
      };
}
export function photo(message: Msg, state: State, facts: PhotoFacts = {}): Transition | null {
  switch (message.type) {
    case 'PickPhoto': {
      const [id, files] = message.args;
      if (!files.length || !state.Inputs.some((input) => input.id === id)) return unchanged(state);
      const admission = admitTo(state, { files, replacing: id }, facts);
      if (!admission.ok) return refusal(state, admission);
      // Classified first (fm-4f5m): nothing about the face changes until its file's verdict arrives.
      const [checked, token] = checkStill(state, id);
      return {
        state: {
          ...checked,
          PreparingFaces: new Set([...state.PreparingFaces, id]),
        },
        effects: [
          { type: 'invalidatePhotoSelections', id },
          { type: 'classifyStills', key: id, token, pick: true, target: id, files },
        ],
      };
    }
    case 'Cropped': {
      const [id, at, file] = message.args;
      return at !== revision(facts) || !state.Inputs.some((input) => input.id === id)
        ? unchanged(state)
        : acceptPhoto(state, id, file, true);
    }
    case 'PhotoRefused':
    case 'PhotoFailed': {
      const [id, error] = message.args;
      const preparing = new Set(state.PreparingFaces);
      preparing.delete(id);
      const next = dequeue({
        ...state,
        PreparingFaces: preparing,
        PendingJobs: without(state.PendingJobs, runFace(id)),
        PendingFaces: state.PendingFaces.filter((face) => face !== id),
        // An expected refusal (bad file, cancelled crop) is owned by the error area alone;
        // an unexpected failure keeps the Off-state report ask (flow-matrix R45).
        Error: error,
        FailureToast: message.type === 'PhotoRefused' ? false : !state.Debug,
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
          const released = forgetStill(state, id, false);
          const next = dequeue({
            ...released.state,
            Inputs: state.Inputs.map((item) =>
              item.id === id ? { ...item, mode: 'project', file: null, value: 'Saved face' } : item,
            ),
            CachedFaces: cached,
            Faces: [
              ...state.Faces.filter((face) => face.id !== id),
              ...selection.output.faces.filter((face) => face.id === id),
            ],
            PreparingFaces: preparing,
          });
          return schedule(next.state, [...released.effects, ...next.effects]);
        }
        case 'crop':
          return offerCrop(state, id, selection.offer);
        case 'photo':
          // Even a directly readable photo needs explicit crop confirmation before any encode.
          return { state, effects: [{ type: 'previewPhoto', id, file: selection.file }] };
      }
    }
    case 'Photos': {
      const [target, files] = message.args;
      if (!files.length) return unchanged(state);
      if (target !== null && !state.Inputs.some((input) => input.id === target))
        return unchanged(state);
      // One admission check for the whole drop, before any classification or bridge call (fm-id4c).
      const admission = admitTo(state, { files, replacing: target }, facts);
      if (!admission.ok) return refusal(state, admission);
      // Every file of the drop is classified before any target is chosen or changed (fm-4f5m).
      const key = target ?? DROP_KEY;
      const [checked, token] = checkStill(state, key);
      return {
        state: {
          ...checked,
          Error: null,
          PreparingFaces:
            target === null ? state.PreparingFaces : new Set([...state.PreparingFaces, target]),
        },
        effects: [{ type: 'classifyStills', key, token, pick: false, target, files }],
      };
    }
    case 'Classified':
      return classified(message.args, state, facts);
    case 'UseAsPhoto': {
      const [id] = message.args;
      const held = state.Held?.get(id);
      if (!held?.photoAction || !state.Inputs.some((input) => input.id === id))
        return unchanged(state);
      // Only this explicit action makes a held still a photo, through the confirmed-crop flow.
      return {
        state: { ...state, Error: null, PreparingFaces: new Set([...state.PreparingFaces, id]) },
        effects: [
          { type: 'invalidatePhotoSelections', id },
          { type: 'previewPhoto', id, file: held.file },
        ],
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
