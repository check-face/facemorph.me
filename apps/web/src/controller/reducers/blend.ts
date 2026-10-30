// The blend view (face.blend-view fm-2kse, fm-56e6). Blend and Morph share one list of faces: every per-face message
// (words, seed, names, photo, crop, Generate, Remove and its Undo, Choose faces) is the morph's own and shows in
// both modes. Blend* messages own only the weights (by face id) and the one-synthesis blend and its result.
import { msg, type Msg } from '../msg.ts';
import { unchanged, type Effect, type Transition } from '../effects.ts';
import type { State } from '../state.ts';
import { gateScope } from '../derived.ts';
import { admitTo, refusal, type AdmissionFacts } from '../admission.ts';
import {
  BLEND_RESULT,
  blendRefusal,
  blendSlots,
  emptyBlend,
  makeItOne,
  resetWeights,
  setWeight,
  usedSlots,
  withWeights,
  type BlendState,
} from '../blend.ts';

export interface BlendFacts extends AdmissionFacts {
  /** Add to morph's new face id. */
  readonly newFaceId?: string;
}
const GRANT_REFUSAL = /not covered by an approved download|needs more data than was approved/;

const blendOf = (state: State): BlendState => state.Blend ?? emptyBlend();
const withBlend = (state: State, blend: BlendState): State => ({ ...state, Blend: blend });

/** Runs the blend of the current weights: refused in one line, asked about through the consent modal, or queued. */
function run(state: State, blend: BlendState): Transition {
  const slots = blendSlots(state.Inputs, blend.weights);
  const refused = blendRefusal(slots);
  const cancel: Effect[] = blend.running !== null ? [{ type: 'cancelBlend' }] : [];
  if (refused)
    return {
      state: withBlend(state, { ...blend, running: null, error: refused, retry: false }),
      effects: cancel,
    };
  const used = usedSlots(slots);
  // The existing download question: photo scope when a weighted photo face still needs its encode.
  const needsPhoto = used.some(
    (slot) => slot.input.mode === 'photo' && !state.Faces.some((face) => face.id === slot.input.id),
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
        // Leaving the view cancels a pending blend synthesis; face photo encodes keep running.
        return current.running === null
          ? unchanged(state)
          : {
              state: withBlend(state, { ...current, running: null }),
              effects: [{ type: 'cancelBlend' }],
            };
      return state.Blend
        ? unchanged(state)
        : { state: withBlend(state, emptyBlend()), effects: [] };
    }
    case 'BlendWeight': {
      const [id, weight] = message.args;
      if (!state.Inputs.some((input) => input.id === id)) return unchanged(state);
      return changed(state, { ...current, weights: setWeight(current.weights, id, weight) });
    }
    case 'BlendWeights':
      return changed(state, {
        ...current,
        weights: withWeights(state.Inputs, current.weights, message.args[0]),
      });
    case 'BlendReset':
      return changed(state, { ...current, weights: resetWeights() });
    case 'BlendNormalize':
      return changed(state, {
        ...current,
        weights: makeItOne(blendSlots(state.Inputs, current.weights), current.weights),
      });
    case 'BlendRun':
      return run(state, current);
    case 'BlendSlotReady': {
      // A face the blend waited for finished on the way: it is the shared list's face, shown in both modes.
      const [face] = message.args;
      if (!state.Inputs.some((input) => input.id === face.id)) return unchanged(state);
      return {
        state: { ...state, Faces: [...state.Faces.filter((item) => item.id !== face.id), face] },
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
