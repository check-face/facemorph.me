import { msg, type Msg } from '../msg.ts';
import { unchanged, type Transition, type Effect } from '../effects.ts';
import type { State, Input } from '../state.ts';
import type { ScheduledJob, SchedulingState } from '../../operations/service.ts';

export const sameInput = (a: Input, b: Input): boolean =>
  a.id === b.id && a.mode === b.mode && a.value === b.value && a.file === b.file;
export const sameInputs = (a: readonly Input[], b: readonly Input[]): boolean =>
  a.length === b.length && a.every((input, index) => sameInput(input, b[index]!));
export function sameMessage(a: Msg, b: Msg): boolean {
  return (
    a.type === b.type &&
    a.args.length === b.args.length &&
    a.args.every((value, index) => value === b.args[index])
  );
}
export const enqueue = (jobs: readonly Msg[], job: Msg): readonly Msg[] =>
  jobs.some((item) => sameMessage(item, job)) ? jobs : [...jobs, job];
export const without = (jobs: readonly Msg[], job: Msg): readonly Msg[] =>
  jobs.filter((item) => !sameMessage(item, job));
export function scheduling(state: State): {
  readonly jobs: readonly ScheduledJob[];
  readonly options: SchedulingState;
} {
  return {
    jobs: state.PendingJobs.map((job) =>
      job.type === 'RunFace'
        ? { kind: 'face', id: job.args[0] }
        : { kind: job.type === 'Run' && job.args[0] === 'morph' ? 'morph' : 'import' },
    ),
    options: {
      busy: state.Busy,
      blockedFaces: state.Inputs.filter(
        (input) =>
          state.PreparingFaces.has(input.id) ||
          state.Crop?.faceId === input.id ||
          state.CropQueue.some((crop) => crop.faceId === input.id) ||
          state.PhotoChoice?.id === input.id,
      ).map((input) => input.id),
      blockMorph:
        state.PreparingFaces.size > 0 ||
        state.PhotoChoice !== null ||
        state.Crop !== null ||
        state.CropQueue.length > 0 ||
        state.PhotoQueue.length > 0,
    },
  };
}
export function schedule(state: State, effects: readonly Effect[] = []): Transition {
  return {
    state: {
      ...state,
      PendingJobs: state.PendingJobs.filter(
        (job) => job.type !== 'RunFace' || state.Inputs.some((input) => input.id === job.args[0]),
      ),
    },
    effects: [...effects, { type: 'requestNext' }],
  };
}
/** The real operation service supplies the selected index; this transformation does no scheduling I/O. */
export function scheduled(state: State, index: number): Transition {
  if (index < 0) return unchanged(state);
  const job = state.PendingJobs[index];
  if (!job) throw new RangeError('Scheduler selected an absent job');
  return {
    state: { ...state, PendingJobs: state.PendingJobs.filter((_, i) => i !== index) },
    effects: [{ type: 'dispatch', message: job }],
  };
}
export const settingsKey = (state: State): string =>
  `${state.Kind}|${state.Width.toFixed(6)}|${state.Pinch}|${state.Frames}|${state.Fps}`;
export const runFace = (id: string): Msg => msg('RunFace', id);
