// The blend view (face.blend-view, fm-2kse). Blend* messages own the slot list, weights and the blend run; every
// per-face message aimed at a slot (words, seed, names, photo, crop, Generate/Cancel) runs the existing reducer
// through a lens that shows it the slots as its Inputs, so slots behave exactly like faces while never changing a
// morph face, the morph video or the remembered morph session.
import { msg, type Msg } from '../msg.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import type { Face, State } from '../state.ts';
import { gateScope } from '../derived.ts';
import { admitTo, refusal, type AdmissionFacts } from '../admission.ts';
import {
  BLEND_RESULT,
  addSlot,
  blendRefusal,
  emptyBlend,
  isBlendId,
  makeItOne,
  removeSlot,
  resetWeights,
  seedSlots,
  setWeight,
  usedSlots,
  withWeights,
  type BlendSlot,
  type BlendState,
} from '../blend.ts';

/** Fresh slot ids from the effect runner (randomness stays outside the reducers). */
export interface BlendFacts extends AdmissionFacts {
  readonly blendIds?: readonly string[];
  /** Add to morph's new morph face id. */
  readonly newFaceId?: string;
}
const GRANT_REFUSAL = /not covered by an approved download|needs more data than was approved/;

const blendOf = (state: State): BlendState => state.Blend ?? emptyBlend();
const withBlend = (state: State, blend: BlendState): State => ({ ...state, Blend: blend });

/** Runs the blend of the current weights: refused in one line, asked about through the consent modal, or queued. */
function run(state: State, blend: BlendState): Transition {
  const refusal = blendRefusal(blend.slots);
  const cancel: Effect[] = blend.running !== null ? [{ type: 'cancelBlend' }] : [];
  if (refusal)
    return {
      state: withBlend(state, { ...blend, running: null, error: refusal, retry: false }),
      effects: cancel,
    };
  const used = usedSlots(blend.slots);
  // The existing download question: photo scope when a weighted photo slot still needs its encode.
  const needsPhoto = used.some(
    (slot) => slot.input.mode === 'photo' && !blend.faces.some((face) => face.id === slot.input.id),
  );
  const scope = gateScope(
    {
      ...state,
      Inputs: [{ id: BLEND_RESULT, mode: needsPhoto ? 'photo' : 'text', value: '', file: null }],
      Faces: [],
    },
    msg('Run', 'blend'),
  );
  if (scope && !state.Gate)
    return {
      state: withBlend({ ...state, Gate: [scope, msg('BlendRun')] }, { ...blend, error: '' }),
      effects: [],
    };
  const revision = blend.revision + 1;
  return {
    state: withBlend(state, { ...blend, revision, running: revision, error: '', retry: false }),
    effects: [
      {
        type: 'runBlend',
        revision,
        inputs: used.map((slot) => slot.input),
        weights: used.map((slot) => slot.weight),
        provider: state.Provider,
      },
    ],
  };
}
/** A weight change regenerates once a blend has been asked for; before that the person presses Blend. */
const changed = (state: State, blend: BlendState): Transition =>
  blend.revision > 0 ? run(state, blend) : { state: withBlend(state, blend), effects: [] };

export function blend(message: Msg, state: State, facts: BlendFacts = {}): Transition | null {
  const current = blendOf(state);
  switch (message.type) {
    case 'BlendView': {
      const [open] = message.args;
      if (!open)
        // Leaving the view cancels a pending blend synthesis; slot photo encodes keep running.
        return current.running === null
          ? unchanged(state)
          : {
              state: withBlend(state, { ...current, running: null }),
              effects: [{ type: 'cancelBlend' }],
            };
      if (state.Blend) return unchanged(state);
      const ids = facts.blendIds ?? [];
      const seeded = seedSlots(state.Inputs, state.Faces, ids);
      const slots: readonly BlendSlot[] = seeded.slots.length
        ? seeded.slots
        : ids.at(-1)
          ? addSlot([], ids.at(-1)!)
          : [];
      const copied = new Map(seeded.copies.map(([from, to]) => [to, from]));
      const faces: Face[] = [];
      for (const slot of slots) {
        const from = copied.get(slot.input.id);
        const face = from && state.Faces.find((item) => item.id === from);
        if (face) faces.push({ ...face, id: slot.input.id });
      }
      return {
        state: withBlend(state, { ...emptyBlend(), slots, faces }),
        effects: seeded.copies.map(([from, to]) => ({ type: 'copyFace', from, to })),
      };
    }
    case 'BlendAdd': {
      const id = facts.blendIds?.[0];
      if (!id) return unchanged(state);
      return {
        state: withBlend(state, { ...current, slots: addSlot(current.slots, id) }),
        effects: [],
      };
    }
    case 'BlendRemove': {
      const [id] = message.args;
      if (current.slots.length <= 1 || !current.slots.some((slot) => slot.input.id === id))
        return unchanged(state);
      const next = {
        ...current,
        slots: removeSlot(current.slots, id),
        faces: current.faces.filter((face) => face.id !== id),
      };
      const transition = changed(
        {
          ...state,
          PendingJobs: state.PendingJobs.filter(
            (job) => !(job.type === 'RunFace' && job.args[0] === id),
          ),
        },
        next,
      );
      return {
        ...transition,
        effects: [
          { type: 'cancelSlot', id },
          { type: 'invalidateFace', id },
          ...transition.effects,
        ],
      };
    }
    case 'BlendWeight': {
      const [id, weight] = message.args;
      return changed(state, { ...current, slots: setWeight(current.slots, id, weight) });
    }
    case 'BlendWeights':
      return changed(state, { ...current, slots: withWeights(current.slots, message.args[0]) });
    case 'BlendReset':
      return changed(state, { ...current, slots: resetWeights(current.slots) });
    case 'BlendNormalize':
      return changed(state, { ...current, slots: makeItOne(current.slots) });
    case 'BlendRun':
      return run(state, current);
    case 'BlendSlotReady': {
      const [face] = message.args;
      if (!current.slots.some((slot) => slot.input.id === face.id)) return unchanged(state);
      return {
        state: withBlend(state, {
          ...current,
          faces: [...current.faces.filter((item) => item.id !== face.id), face],
        }),
        effects: [],
      };
    }
    case 'BlendCompleted': {
      const [revision, face] = message.args;
      if (revision !== current.running) return unchanged(state);
      return {
        state: withBlend(state, {
          ...current,
          running: null,
          error: '',
          retry: false,
          faces: [
            ...current.faces.filter((item) => item.id !== BLEND_RESULT),
            { ...face, id: BLEND_RESULT },
          ],
        }),
        effects: [],
      };
    }
    case 'BlendFailed': {
      const [revision, error] = message.args;
      if (revision !== current.running) return unchanged(state);
      const settled = { ...current, running: null };
      // A model file outside the approval is a new cost: the existing download question is asked again.
      if (GRANT_REFUSAL.test(error))
        return {
          state: withBlend(
            { ...state, DownloadConsent: new Set<string>(), Gate: ['route', msg('BlendRun')] },
            settled,
          ),
          effects: [],
        };
      return {
        state: withBlend(state, {
          ...settled,
          error: error || 'This blend could not finish.',
          retry: true,
        }),
        effects: [],
      };
    }
    case 'BlendAddToMorph': {
      // The shown blend joins the end of the morph row as an ordinary face (zero inference: its latent, pixels
      // and file are copied), through the same admission check as any new face; refused, nothing is added.
      const result = current.faces.find((face) => face.id === BLEND_RESULT);
      const id = facts.newFaceId;
      if (!result || current.running !== null || !id || state.Inputs.some((i) => i.id === id))
        return unchanged(state);
      const admission = admitTo(state, { files: [] }, facts);
      if (!admission.ok) return refusal(state, admission);
      const label = result.label || 'Blended face';
      return {
        state: {
          ...state,
          Inputs: [...state.Inputs, { id, mode: 'project', value: label, file: null }],
          Faces: [
            ...state.Faces.filter((face) => face.id !== id),
            // Drawn from the bridge's copy: the blend's own URL is revoked when it is blended again.
            { ...result, id, raw: true, url: '' },
          ],
          NextId: state.NextId + 1,
          VideoUrl: '',
          Status: `${label} added to the morph as face ${state.Inputs.length + 1}.`,
        },
        effects: [
          { type: 'copyFace', from: BLEND_RESULT, to: id },
          { type: 'invalidateArrivalRestore' },
          { type: 'invalidateMorph' },
        ],
      };
    }
    case 'BlendSettled': {
      const [revision] = message.args;
      return revision === current.running
        ? { state: withBlend(state, { ...current, running: null }), effects: [] }
        : unchanged(state);
    }
    default:
      return null;
  }
}

// ---- the slot lens --------------------------------------------------------------------------------------------------

/** The blend slot a per-face message is aimed at, or null when it is a morph face's (or nobody's). */
export function blendSlotTarget(message: Msg, state: State): string | null {
  const blendState = state.Blend;
  if (!blendState) return null;
  let id: string | null | undefined = null;
  switch (message.type) {
    case 'Edit':
    case 'Mode':
    case 'Photo':
    case 'PickPhoto':
    case 'PhotoRefused':
    case 'PhotoFailed':
    case 'Photos':
    case 'CancelFace':
    case 'RunFace':
    case 'NamePicked':
    case 'BrowseNames':
    case 'PreviewLoaded':
    case 'RequestCrop':
    case 'Cropped':
    case 'UseAsPhoto':
    case 'ResumePhoto':
      id = message.args[0];
      break;
    case 'Classified':
      id = message.args[3];
      break;
    case 'CachedFaceChecked':
      id = message.args[0].id;
      break;
    case 'ChooseName':
    case 'SearchNames':
    case 'CloseNames':
    case 'MoreNames':
    case 'NamesLoaded':
    case 'NamesFailed':
      id = state.Browse;
      break;
    case 'CropAdjust':
    case 'CropUse':
    case 'CropViewport':
    case 'CropPan':
    case 'CropResize':
    case 'CropRotate':
    case 'CropTurn':
    case 'CropDetected':
    case 'CropAccept':
    case 'CropCancel':
      id = state.Crop?.faceId;
      break;
    case 'ChooseDetected':
    case 'DismissDetected':
      id = state.PhotoChoice?.id;
      break;
    case 'GateAccept':
    case 'GateCancel': {
      const pending = state.Gate?.[1];
      if (pending?.type === 'BlendRun') return BLEND_RESULT;
      return pending ? blendSlotTarget(pending, state) : null;
    }
    default:
      return null;
  }
  return id && isBlendId(id) && blendState.slots.some((slot) => slot.input.id === id) ? id : null;
}

/** Effects that belong to the morph session only: a slot change never touches them. */
const MORPH_ONLY = new Set<Effect['type']>([
  'rememberView',
  'invalidateArrivalRestore',
  'invalidateMorph',
]);

/** Runs `reduce` with the slots as Inputs and the slot faces as Faces, then puts the morph's own fields back. */
export function throughSlots(
  message: Msg,
  state: State,
  reduce: (message: Msg, state: State) => Transition | null,
): Transition | null {
  const blendState = state.Blend!;
  const { Blend: _blend, Undo: _undo, ...morph } = state;
  const projected: State = {
    ...morph,
    Inputs: blendState.slots.map((slot) => slot.input),
    Faces: blendState.faces,
    VideoUrl: '',
    PendingMorph: false,
  };
  const result = reduce(message, projected);
  if (!result) return null;
  const next = result.state;
  const weights = new Map(blendState.slots.map((slot) => [slot.input.id, slot.weight]));
  // Only slot ids stay slots; a reducer never invents morph faces here (multi-photo batches are not slot fills).
  const slots = next.Inputs.filter((input) => isBlendId(input.id)).map((input) => ({
    input,
    weight: weights.get(input.id) ?? 1 / Math.max(1, next.Inputs.length),
  }));
  const slotJob = (job: Msg) => job.type === 'RunFace' && isBlendId(job.args[0]);
  const kept = state.PendingJobs.filter(
    (job) => !slotJob(job) && !next.PendingJobs.some((other) => other === job),
  );
  const startedJob = next.JobId !== state.JobId;
  const { Blend: _b, Undo: _u, ...rest } = next;
  return {
    state: {
      ...rest,
      ...(state.Undo ? { Undo: state.Undo } : {}),
      Inputs: state.Inputs,
      Faces: state.Faces,
      VideoUrl: state.VideoUrl,
      PendingMorph: state.PendingMorph,
      PendingJobs: [...kept, ...next.PendingJobs],
      RunInputs: startedJob ? next.RunInputs : state.RunInputs,
      RunSettings: startedJob ? next.RunSettings : state.RunSettings,
      Blend: { ...blendState, slots, faces: next.Faces },
    },
    effects: result.effects.filter((effect) => !MORPH_ONLY.has(effect.type)),
  };
}

/** A finished main job's output also carries slot faces generated by a slot's Generate. */
export function withSlotFaces(state: State, faces: readonly Face[]): State {
  const blendState = state.Blend;
  if (!blendState) return state;
  const ids = new Set(blendState.slots.map((slot) => slot.input.id));
  const arrived = faces.filter((face) => ids.has(face.id));
  if (!arrived.length) return state;
  const replaced = new Set(arrived.map((face) => face.id));
  return {
    ...state,
    Blend: {
      ...blendState,
      faces: [...blendState.faces.filter((face) => !replaced.has(face.id)), ...arrived],
    },
  };
}
