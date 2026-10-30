// The batch view (fm-id4c item 12 with the folded fm-3peb scope, fm-q5b9): a pick, drop or paste of several files
// opens one "Choose faces" view instead of allocating one face per file. Every file was classified first (fm-4f5m):
// a saved FaceMorph still is a ready face (installed without inference), a still from another model or an
// unreadable version is selectable as held media with compute disabled, a damaged still offers Use as photo only as
// an explicit action, a photo offers its detected faces (when photo processing is ready on this device) or the
// whole photo for the existing crop confirmation, and an unreadable file offers nothing. The order of faces is the
// person's global click order across files (contracts/batch.ts). Cancel discards the proposal and changes nothing;
// OK runs one admission check for every selected file, then replaces the originating face with the first pick and
// inserts the rest right after it, in click order.
import {
  allocateKeypoints,
  applyClick,
  type BatchSelection,
  type CandidateId,
  type CropOffer,
  type InputRevision,
} from '../batch-selection.ts';
import type { ClassifiedStill, Msg } from '../msg.ts';
import type { Input, State } from '../state.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import { admitTo, refusal, type AdmissionFacts } from '../admission.ts';
import { schedule } from './schedule.ts';
import { hold } from './photo.ts';
import { alignCrop } from '../geometry.ts';
import type { CropView } from '../msg.ts';

/** A detected face, as fractions of the photo. */
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
  /** A photo's decoded preview, the coordinates its detected boxes are cropped in. */
  readonly offer: CropOffer | null;
  /**
   * Photos only. not-run: photo processing is not set up on this device, so the whole photo is offered for the
   * crop confirmation after OK; running: the on-device detector is looking; done: it finished (boxes when it found
   * two or more faces, else the whole photo).
   */
  readonly detection: 'not-run' | 'running' | 'done';
  readonly boxes: readonly BatchBox[];
  readonly candidates: readonly CandidateId[];
}

export interface BatchState {
  readonly key: string;
  readonly token: number;
  readonly pick: boolean;
  /** The originating face; null for a drop on the page. */
  readonly target: string | null;
  readonly groups: readonly BatchGroup[];
  readonly order: readonly CandidateId[];
  /** The admission refusal of the last OK, shown in the view (the selection is kept to reduce). */
  readonly refused?: string;
}

/** A detected box as the crop view's proposal (zoom and centre in preview pixels), inside the photo. */
export function proposedView(view: CropView, box: BatchBox): CropView {
  const side = Math.min(box.width * view.previewWidth, box.height * view.previewHeight);
  if (!(side > 0)) return view;
  return alignCrop(view, {
    cx: (box.x + box.width / 2) * view.previewWidth,
    cy: (box.y + box.height / 2) * view.previewHeight,
    side,
    rotation: 0,
  });
}

export interface BatchFacts extends AdmissionFacts {
  readonly newPhotoIds?: readonly string[];
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
const groupOf = (candidate: CandidateId): string => candidate.slice(0, candidate.indexOf('#'));
const indexOf = (candidate: CandidateId): number =>
  Number(candidate.slice(candidate.indexOf('#') + 1));
const isPhoto = (group: Pick<BatchGroup, 'role' | 'asPhoto'>) =>
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
  return group.boxes.length > 1
    ? group.boxes.map((_, i) => candidateOf(group.id, i))
    : [candidateOf(group.id, 0)];
}
const withCandidates = (group: Omit<BatchGroup, 'candidates'>): BatchGroup => ({
  ...group,
  candidates: candidates(group),
});

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
      boxes: [],
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

/** Photo processing became ready while the view is open (Set up photo processing): look for faces now. */
export function detectOnReady(previous: State, transition: Transition): Transition {
  const batch = transition.state.Batch;
  if (!batch || detectorReady(previous) || !detectorReady(transition.state)) return transition;
  const found = detect(transition.state, batch);
  return found.effects.length
    ? {
        state: { ...transition.state, Batch: found.batch },
        effects: [...transition.effects, ...found.effects],
      }
    : transition;
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
  const found = detect(state, next);
  return { state: { ...state, Batch: found.batch }, effects: found.effects };
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
  if (!batch.order.length) return unchanged(state);
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
  const proposals = new Map(next.CropProposals ?? []);
  for (const { position } of allocation) {
    const { group, index } = picks[position]!;
    const id = place.ids[position]!;
    effects.push({ type: 'invalidatePhotoSelections', id });
    if (group.role === 'held' && !group.asPhoto) {
      const t = hold(next, id, group.entry);
      next = t.state;
      effects.push(...t.effects);
      if (group.entry.url) heldUrls.add(group.entry.url);
      continue;
    }
    // A saved face recovers through the bridge without inference. A photo face enters the existing crop
    // confirmation in pick order, one at a time; a detected face's box is its proposed crop there.
    queue.push([id, group.entry.file]);
    const box = isPhoto(group) && group.boxes.length > 1 ? group.boxes[index] : undefined;
    if (box) proposals.set(id, box);
    else proposals.delete(id);
  }
  effects.push(...batchUrls(batch, heldUrls));
  next = { ...next, CropProposals: proposals };
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
      const boxes =
        faces && faces.length > 1
          ? faces.map(({ x, y, width, height }) => ({ x, y, width, height }))
          : [];
      const group = open.groups.find((g) => g.id === id);
      if (!group || group.detection !== 'running') return unchanged(state);
      const next = replaceGroup(open, id, (g) => ({
        ...g,
        detection: 'done',
        boxes,
      }));
      return unchanged({ ...state, Batch: next });
    }
    case 'BatchPick': {
      if (!open) return unchanged(state);
      const picked = applyClick(selection(open), { candidate: message.args[0] });
      if (picked.order === open.order) return unchanged(state);
      const { refused: _, ...rest } = open;
      return unchanged({ ...state, Batch: { ...rest, order: picked.order } });
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
