// The Choose faces view (fm-zigt, with fm-id4c item 12 and fm-q5b9): a pick, drop or paste of several files, or one
// photo with two or more detected faces, opens one view instead of allocating one face per file. Every file was
// classified first (fm-4f5m): a saved FaceMorph still is a ready face (installed without inference), a still from
// another model or an unreadable version is selectable as held media with compute disabled, a damaged still offers
// Use as photo only as an explicit action, a photo offers a box on each face the on-device detector found (asked
// for through the photo-setup download decision first when its files are missing) or, when detection did not run
// or found nothing, the whole photo, and an unreadable file offers nothing. The order of faces is the person's global
// tap order across files (contracts/batch.ts). Each picked photo face uses its aligned proposal as it is; the tray's
// optional Adjust opens the crop editor for that pick only. Cancel discards the proposal and changes nothing; OK runs
// one admission check for every selected file, then replaces the originating face with the first pick and inserts
// the rest right after it in tap order. The tray was the confirmation: photo faces are cropped at OK exactly as
// accepted and encode one at a time in pick order, with no further crop prompt (operator, 28 October 2026).
import {
  allocateKeypoints,
  applyClick,
  type BatchSelection,
  type CandidateId,
  type CropOffer,
  type DetectedFace,
  type InputRevision,
} from '../batch-selection.ts';
import { msg, type ClassifiedStill, type Msg } from '../msg.ts';
import type { CropChoice, Input, State } from '../state.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import { admitTo, refusal, type AdmissionFacts } from '../admission.ts';
import { schedule } from './schedule.ts';
import { cropsPending, hold } from './photo.ts';
import { alignCrop, createCrop, cropRect } from '../geometry.ts';
import type { CropView } from '../msg.ts';

/** A detected face's box, as fractions of the photo. */
export interface BatchBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a file is in the batch view. */
export type BatchRole = 'recovered' | 'held' | 'damaged' | 'photo';

/** One file of the batch: its classification, what it shows and which faces it offers. */
export interface BatchGroup {
  /** `f<index>`: the file's position in its pick or drop (never contains '#'). */
  readonly id: string;
  readonly entry: ClassifiedStill;
  readonly role: BatchRole;
  /** Damaged still turned into a photo by the explicit Use as photo action. */
  readonly asPhoto: boolean;
  /**
   * loading: its preview is being decoded; ready: it offers its candidates; unreadable: its pixels do not decode,
   * so it is left out; unavailable: photo encoding is not available here (photos only).
   */
  readonly status: 'loading' | 'ready' | 'unreadable' | 'unavailable';
  /** The URL shown for it ('' while loading or when nothing can be shown). */
  readonly url: string;
  /** A photo's decoded preview, the coordinates its faces and crops are in. */
  readonly offer: CropOffer | null;
  /**
   * Photos only. not-run: photo processing is not set up on this device (or was declined), so the whole photo is
   * offered; running: the on-device detector is looking; done: it finished (a box on each face, or the whole photo
   * when it found none).
   */
  readonly detection: 'not-run' | 'running' | 'done';
  readonly faces: readonly DetectedFace[];
  readonly candidates: readonly CandidateId[];
}

/** The crop editor open on one pick (Adjust in the tray): its view, and the view Cancel restores. */
export interface BatchEditing {
  readonly candidate: CandidateId;
  readonly view: CropView;
  readonly previous: CropView;
}

export interface BatchState {
  readonly key: string;
  readonly token: number;
  readonly pick: boolean;
  /** The originating face; null for a drop on the page. */
  readonly target: string | null;
  readonly groups: readonly BatchGroup[];
  readonly order: readonly CandidateId[];
  /** Picks the person adjusted: their crop instead of the proposal. */
  readonly crops?: ReadonlyMap<CandidateId, CropView>;
  readonly editing?: BatchEditing;
  /** The photo-setup download decision was asked for this view (asked once). */
  readonly asked?: boolean;
  /** The admission refusal of the last OK, shown in the view (the selection is kept to reduce). */
  readonly refused?: string;
}

export interface BatchFacts extends AdmissionFacts {
  readonly newPhotoIds?: readonly string[];
  /** The bridge's revision of every face at OK: a photo pick's crop lands only on the face it was made for. */
  readonly photoRevisions?: Readonly<Record<string, number>>;
}

const isPhotoKind = (kind: ClassifiedStill['kind']) => kind === 'missing';
const roleOf = (entry: ClassifiedStill): BatchRole =>
  entry.kind === 'matching'
    ? 'recovered'
    : isPhotoKind(entry.kind)
      ? 'photo'
      : entry.kind === 'damaged'
        ? 'damaged'
        : 'held';
export const candidateOf = (group: string, index: number): CandidateId => `${group}#${index}`;
export const groupOf = (candidate: CandidateId): string =>
  candidate.slice(0, candidate.indexOf('#'));
export const indexOf = (candidate: CandidateId): number =>
  Number(candidate.slice(candidate.indexOf('#') + 1));
export const isPhoto = (group: Pick<BatchGroup, 'role' | 'asPhoto'>) =>
  group.role === 'photo' || group.asPhoto;

/** Photo encoding is known to be unavailable on this device (no encoder bundle, or no route for it). */
const photoUnavailable = (state: State) => state.Downloads.known && !state.Downloads.photoAvailable;
/** The on-device detector can run without a new download or decision. */
const detectorReady = (state: State) => state.Downloads.known && state.Downloads.photoReady;

/** The faces a group offers, from its role and status. */
function candidates(group: Omit<BatchGroup, 'candidates'>): readonly CandidateId[] {
  if (group.status !== 'ready') return [];
  if (group.role === 'recovered' || group.role === 'held') return [candidateOf(group.id, 0)];
  if (!isPhoto(group) || group.detection === 'running') return [];
  return group.faces.length
    ? group.faces.map((_, i) => candidateOf(group.id, i))
    : [candidateOf(group.id, 0)];
}
const withCandidates = (group: Omit<BatchGroup, 'candidates'>): BatchGroup => ({
  ...group,
  candidates: candidates(group),
});

/** A detected face's aligned square as a crop view of `offer`'s preview (the proposal, fm-k09b). */
export function faceView(view: CropView, face: DetectedFace): CropView {
  const { cx, cy, side, rotation } = face.align;
  return alignCrop(view, {
    cx: cx * view.previewWidth,
    cy: cy * view.previewHeight,
    side: side * view.previewWidth,
    rotation,
  });
}

/** The crop a photo pick gets: the person's adjusted crop, else its face's aligned proposal, else the centred square. */
export function pickView(batch: BatchState, candidate: CandidateId): CropView | null {
  const adjusted = batch.crops?.get(candidate);
  if (adjusted) return adjusted;
  const group = batch.groups.find((g) => g.id === groupOf(candidate));
  if (!group?.offer || !isPhoto(group)) return null;
  const base = createCrop({
    previewWidth: group.offer.previewWidth,
    previewHeight: group.offer.previewHeight,
    scale: group.offer.scale,
    viewport: 320,
  });
  const face = group.faces[indexOf(candidate)];
  return face ? faceView(base, face) : base;
}

/** The selection in contract terms: held media counts as a ready still; files offering nothing as corrupt. */
export function selection(batch: BatchState): BatchSelection {
  return {
    files: batch.groups.map((group) => ({
      id: group.id,
      kind: !group.candidates.length
        ? 'corrupt'
        : group.role === 'recovered' || group.role === 'held'
          ? 'recovered-still'
          : 'photo',
      candidates: group.candidates,
    })),
    order: batch.order,
  };
}

/** Every URL the batch owns (its previews and the classification's held-still URLs). */
function batchUrls(batch: BatchState, keep: ReadonlySet<string> = new Set()): Effect[] {
  const urls = new Set<string>();
  for (const group of batch.groups) {
    if (group.url) urls.add(group.url);
    if (group.offer?.url) urls.add(group.offer.url);
    if (group.entry.url) urls.add(group.entry.url);
  }
  return [...urls].filter((url) => !keep.has(url)).map((url) => ({ type: 'revokeUrl', url }));
}

/** Opens the batch view for a classified pick or drop of several files (nothing about the faces changes). */
export function openBatch(
  state: State,
  key: string,
  token: number,
  pick: boolean,
  target: string | null,
  entries: readonly ClassifiedStill[],
): Transition {
  const previous = state.Batch ? batchUrls(state.Batch) : [];
  const groups = entries.map((entry, index) => {
    const role = roleOf(entry);
    const held = role === 'held' || role === 'damaged';
    return withCandidates({
      id: `f${index}`,
      entry,
      role,
      asPhoto: false,
      status:
        role === 'photo' && photoUnavailable(state) ? 'unavailable' : held ? 'ready' : 'loading',
      url: held && role !== 'damaged' ? (entry.url ?? '') : '',
      offer: null,
      detection: 'not-run',
      faces: [],
    });
  });
  const batch: BatchState = { key, token, pick, target, groups, order: [] };
  const stage = groups
    .filter((group) => group.status === 'loading' || group.status === 'unavailable')
    .map((group) => ({
      id: group.id,
      file: group.entry.file,
      photo: group.role === 'photo',
    }));
  // Nothing is prepared while the person chooses: the originating face stays as it is until OK.
  const preparing = new Set(state.PreparingFaces);
  if (target !== null) preparing.delete(target);
  return {
    state: { ...state, Batch: batch, Error: null, PreparingFaces: preparing },
    effects: [
      ...previous,
      ...(stage.length ? [{ type: 'stageBatch' as const, token, files: stage }] : []),
    ],
  };
}

/**
 * One photo with two or more detected faces (fm-zigt): its open crop becomes the Choose faces view, on the face it
 * was opened for. The view takes over the crop's preview URL.
 */
export function chooseFromCrop(
  state: State,
  choice: CropChoice,
  faces: readonly DetectedFace[],
): Transition {
  const token = (state.StillSeq ?? 0) + 1;
  const view = choice.previousView ?? choice.view;
  const file =
    choice.file instanceof File
      ? choice.file
      : new File([choice.file], 'photo', { type: 'image/png' });
  const offer: CropOffer = {
    file,
    blob: choice.preview ?? file,
    url: choice.url,
    sourceWidth: view.previewWidth / (choice.scale || 1),
    sourceHeight: view.previewHeight / (choice.scale || 1),
    previewWidth: view.previewWidth,
    previewHeight: view.previewHeight,
    scale: choice.scale,
    resized: choice.scale !== 1,
  };
  const group = withCandidates({
    id: 'f0',
    entry: { index: 0, file, bytes: file.size, kind: 'missing', reason: null },
    role: 'photo',
    asPhoto: false,
    status: 'ready',
    url: choice.url,
    offer,
    detection: 'done',
    faces,
  });
  const batch: BatchState = {
    key: choice.faceId,
    token,
    pick: true,
    target: choice.faceId,
    groups: [group],
    order: [],
    asked: true,
  };
  const preparing = new Set(state.PreparingFaces);
  preparing.delete(choice.faceId);
  return {
    state: { ...state, Crop: null, Batch: batch, StillSeq: token, PreparingFaces: preparing },
    effects: [],
  };
}

type Staged = Extract<Msg, { type: 'BatchStaged' }>['args'][2];

const replaceGroup = (
  batch: BatchState,
  id: string,
  change: (group: BatchGroup) => Omit<BatchGroup, 'candidates'>,
): BatchState => ({
  ...batch,
  groups: batch.groups.map((group) => (group.id === id ? withCandidates(change(group)) : group)),
});

/** Detection for every ready photo with no picked face yet, when the detector is ready. */
function detect(state: State, batch: BatchState): { batch: BatchState; effects: Effect[] } {
  if (!detectorReady(state)) return { batch, effects: [] };
  const effects: Effect[] = [];
  let next = batch;
  for (const group of batch.groups) {
    if (!isPhoto(group) || group.status !== 'ready' || group.detection !== 'not-run') continue;
    if (!group.offer) continue;
    if (batch.order.some((candidate) => groupOf(candidate) === group.id)) continue;
    next = replaceGroup(next, group.id, (g) => ({ ...g, detection: 'running' }));
    effects.push({
      type: 'detectBatchFaces',
      token: batch.token,
      group: group.id,
      file: group.offer.blob,
    });
  }
  return { batch: next, effects };
}

/**
 * Faces first in the view (fm-zigt): photos waiting to be looked at are detected as soon as photo processing is
 * ready; when its files are missing the photo-setup download decision is asked once for the view (declined: the
 * photos stay whole). Runs after every transition.
 */
export function batchFacesFirst(transition: Transition): Transition {
  const state = transition.state;
  const batch = state.Batch;
  if (!batch) return transition;
  const waiting = batch.groups.some(
    (group) =>
      isPhoto(group) &&
      (group.status === 'ready' || group.status === 'loading') &&
      group.detection === 'not-run',
  );
  if (!waiting) return transition;
  const downloads = state.Downloads;
  if (!downloads.known) return transition;
  if (downloads.photoReady) {
    const found = detect(state, batch);
    return found.effects.length
      ? {
          state: { ...state, Batch: found.batch },
          effects: [...transition.effects, ...found.effects],
        }
      : transition;
  }
  if (
    downloads.photoAvailable &&
    !batch.asked &&
    state.EncoderSetup !== 'active' &&
    state.DownloadConsent.has('photo')
  )
    // Approved in this session already (an earlier photo's OK): the detector's files download within it.
    return {
      state: { ...state, Batch: { ...batch, asked: true }, EncoderSetup: 'active' },
      effects: [...transition.effects, { type: 'downloadModels', includePhoto: true }],
    };
  if (
    !downloads.photoAvailable ||
    batch.asked ||
    state.Gate ||
    state.EncoderSetup === 'active' ||
    state.EncoderSetup === 'cancelled'
  )
    return transition;
  return {
    state: {
      ...state,
      Batch: { ...batch, asked: true },
      EncoderSetup: 'requested',
      Gate: ['photo', msg('DownloadNow', true)],
    },
    effects: transition.effects,
  };
}

function staged(state: State, batch: BatchState, id: string, result: Staged): Transition {
  const group = batch.groups.find((g) => g.id === id);
  const urls: Effect[] = [];
  if (result.url) urls.push({ type: 'revokeUrl', url: result.url });
  if (result.offer) urls.push({ type: 'revokeUrl', url: result.offer.url });
  if (!group || (group.status !== 'loading' && group.status !== 'unavailable'))
    return { state, effects: urls };
  const next = replaceGroup(batch, id, (g) => ({
    ...g,
    status: g.status === 'unavailable' ? 'unavailable' : result.ok ? 'ready' : 'unreadable',
    url: result.offer?.url ?? result.url ?? '',
    offer: result.offer ?? null,
  }));
  return unchanged({ ...state, Batch: next });
}

/** Where each pick goes: the originating face (or the first empty one), then new faces right after it. */
function placements(
  state: State,
  batch: BatchState,
  count: number,
  facts: BatchFacts,
): { inputs: Input[]; ids: string[] } | null {
  const inputs = [...state.Inputs];
  const fresh = facts.newPhotoIds ?? [];
  if (fresh.length < count) throw new Error('Batch OK requires fresh face IDs');
  let first: string;
  if (batch.target !== null) {
    if (!inputs.some((input) => input.id === batch.target)) return null;
    first = batch.target;
  } else {
    const empty = inputs.find(
      (item) => item.mode !== 'photo' && item.mode !== 'project' && !item.value.trim(),
    );
    if (empty) first = empty.id;
    else {
      first = fresh[0]!;
      inputs.push({ id: first, mode: 'text', value: '', file: null });
    }
  }
  const ids = [first];
  let at = inputs.findIndex((input) => input.id === first) + 1;
  for (let k = 1; k < count; k++) {
    const id = fresh[k]!;
    if (inputs.some((input) => input.id === id))
      throw new Error('Batch OK requires fresh face IDs');
    inputs.splice(at++, 0, { id, mode: 'text', value: '', file: null });
    ids.push(id);
  }
  return { inputs, ids };
}

function confirm(state: State, batch: BatchState, facts: BatchFacts): Transition {
  if (!batch.order.length || batch.editing) return unchanged(state);
  const picks = batch.order.map((candidate) => ({
    candidate,
    group: batch.groups.find((g) => g.id === groupOf(candidate))!,
    index: indexOf(candidate),
  }));
  const closed: State = { ...state, Batch: undefined };
  // One admission check for every selected file at once, before any face changes or bridge call.
  const files = [...new Set(picks.map((p) => p.group.entry.file))];
  const admission = admitTo(closed, { files, replacing: batch.target }, facts);
  if (!admission.ok) {
    const refused = refusal(state, admission);
    return {
      ...refused,
      state: { ...refused.state, Batch: { ...batch, refused: admission.message } },
    };
  }
  const place = placements(closed, batch, picks.length, facts);
  // The originating face was removed while the view was open: the whole proposal is void.
  const allocation = allocateKeypoints(batch.order, {
    source: batch.token as InputRevision,
    sourceNow: batch.token as InputRevision,
    target: 1 as InputRevision,
    targetNow: (place ? 1 : 0) as InputRevision,
  });
  if (!place || allocation === 'stale')
    return {
      state: {
        ...closed,
        Error: 'The face these were for was removed, so nothing was added.',
      },
      effects: batchUrls(batch),
    };
  const heldUrls = new Set<string>();
  let next: State = { ...closed, Inputs: place.inputs, Error: null };
  const effects: Effect[] = [{ type: 'invalidateArrivalRestore' }];
  const queue: (readonly [string, File])[] = [];
  const preparing = new Set(next.PreparingFaces);
  for (const { position } of allocation) {
    const { candidate, group } = picks[position]!;
    const id = place.ids[position]!;
    effects.push({ type: 'invalidatePhotoSelections', id });
    if (group.role === 'held' && !group.asPhoto) {
      const t = hold(next, id, group.entry);
      next = t.state;
      effects.push(...t.effects);
      if (group.entry.url) heldUrls.add(group.entry.url);
      continue;
    }
    const view = isPhoto(group) ? pickView(batch, candidate) : null;
    if (!view || !group.offer) {
      // A saved face recovers through the bridge's own entry, without inference.
      queue.push([id, group.entry.file]);
      continue;
    }
    // A photo face: its crop is frozen now, exactly as accepted in the tray, and goes to e4e as it stands. The
    // crops arrive in pick order and encode one at a time (the runner keeps their order).
    preparing.add(id);
    effects.push({
      type: 'cropPhoto',
      id,
      revision: facts.photoRevisions?.[id] ?? 0,
      file: group.offer.file,
      area: Object.freeze(cropRect(view)),
      options: Object.freeze({ previewScale: group.offer.scale, rotation: view.rotation }),
    });
  }
  effects.push(...batchUrls(batch, heldUrls));
  next = cropsPending(
    { ...next, PreparingFaces: preparing },
    effects.flatMap((effect) => (effect.type === 'cropPhoto' ? [effect.id] : [])),
  );
  const pendingQueue = [...next.PhotoQueue, ...queue];
  const idle = !next.Crop && next.PhotoQueue.length === 0;
  const [head, ...rest] = pendingQueue;
  if (idle && head) {
    effects.push({ type: 'selectPhoto', id: head[0], files: [head[1]] });
    return schedule(
      {
        ...next,
        PhotoQueue: rest,
        PreparingFaces: new Set([...next.PreparingFaces, head[0]]),
      },
      effects,
    );
  }
  return schedule({ ...next, PhotoQueue: pendingQueue }, effects);
}

/** The crop editor's messages while it is open on one pick of the view (Adjust). */
export function editPick(state: State, change: (view: CropView) => CropView): Transition {
  const editing = state.Batch?.editing;
  return editing
    ? unchanged({
        ...state,
        Batch: { ...state.Batch!, editing: { ...editing, view: change(editing.view) } },
      })
    : unchanged(state);
}
export function finishPick(state: State, use: boolean): Transition {
  const batch = state.Batch;
  const editing = batch?.editing;
  if (!batch || !editing) return unchanged(state);
  const { editing: _closed, ...rest } = batch;
  if (!use) return unchanged({ ...state, Batch: rest });
  const crops = new Map(batch.crops ?? []);
  crops.set(editing.candidate, editing.view);
  return unchanged({ ...state, Batch: { ...rest, crops } });
}

export function batch(message: Msg, state: State, facts: BatchFacts = {}): Transition | null {
  const open = state.Batch;
  switch (message.type) {
    case 'BatchStaged': {
      const [token, id, result] = message.args;
      if (!open || open.token !== token)
        return {
          state,
          effects: [result.url, result.offer?.url]
            .filter((url): url is string => !!url)
            .map((url) => ({ type: 'revokeUrl', url })),
        };
      return staged(state, open, id, result);
    }
    case 'BatchDetected': {
      const [token, id, faces] = message.args;
      if (!open || open.token !== token) return unchanged(state);
      const group = open.groups.find((g) => g.id === id);
      if (!group || group.detection !== 'running') return unchanged(state);
      const next = replaceGroup(open, id, (g) => ({ ...g, detection: 'done', faces: faces ?? [] }));
      return unchanged({ ...state, Batch: next });
    }
    case 'BatchPick': {
      if (!open || open.editing) return unchanged(state);
      const picked = applyClick(selection(open), { candidate: message.args[0] });
      if (picked.order === open.order) return unchanged(state);
      const { refused: _, ...rest } = open;
      // An unpicked face forgets its adjusted crop; picking it again starts from its proposal.
      const crops = new Map(open.crops ?? []);
      for (const candidate of crops.keys())
        if (!picked.order.includes(candidate)) crops.delete(candidate);
      return unchanged({ ...state, Batch: { ...rest, order: picked.order, crops } });
    }
    case 'BatchAdjust': {
      const [candidate] = message.args;
      if (!open || open.editing || !open.order.includes(candidate)) return unchanged(state);
      const view = pickView(open, candidate);
      if (!view) return unchanged(state);
      return {
        state: { ...state, Batch: { ...open, editing: { candidate, view, previous: view } } },
        effects: [{ type: 'focusCropArea' }],
      };
    }
    case 'BatchUseAsPhoto': {
      const [id] = message.args;
      const group = open?.groups.find((g) => g.id === id);
      // Only this explicit action makes a damaged still a photo; its pixels must decode.
      if (!open || !group || group.role !== 'damaged' || group.asPhoto || !group.entry.decodes)
        return unchanged(state);
      const unavailable = photoUnavailable(state);
      const next = replaceGroup(open, id, (g) => ({
        ...g,
        asPhoto: true,
        status: unavailable ? 'unavailable' : 'loading',
      }));
      return {
        state: { ...state, Batch: next },
        effects: [
          {
            type: 'stageBatch',
            token: open.token,
            files: [{ id, file: group.entry.file, photo: true }],
          },
        ],
      };
    }
    case 'BatchCancel':
      return open ? schedule({ ...state, Batch: undefined }, batchUrls(open)) : unchanged(state);
    case 'BatchOk':
      return open ? confirm(state, open, facts) : unchanged(state);
    default:
      return null;
  }
}
