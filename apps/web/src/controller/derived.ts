// Pure snapshots of measured bridge facts. The estimator remains the retained candidate implementation.
// adapter-test: apps/web/test/controller/derived.test.ts
import {
  createEstimator as jsEstimator,
  describeMs,
  describeMeasuredMs,
} from '../Next/estimate.mjs';
import type { Estimator, EstimatorSources } from '../../shell/facade/helpers.ts';
import type { JobProgress } from '../../shell/facade/records.ts';
import type { Msg } from './msg.ts';
import type { State, Downloads } from './state.ts';
import type { Input } from './state.ts';
import { validateWords, validateSeedText } from '../contracts/inputs.ts';

/** The same validation owns field feedback and the pre-acquisition Generate boundary. */
export function faceInputProblem(input: Input): string | null {
  if (input.mode === 'seed')
    return validateSeedText(input.value) ? null : 'Use a whole number from 0 to 4294967295.';
  if (input.mode !== 'text') return null;
  const result = validateWords(input.value);
  return result.valid
    ? null
    : result.reason === 'too-long'
      ? 'Use at most 512 bytes of text.'
      : 'Type some words to make a face.';
}
export const describeDuration = (ms: number): string => describeMs(ms);
export interface Measurements {
  readonly faceMs: number | null;
  readonly frameMs: number | null;
  readonly videoMs: number | null;
  readonly plannedFrames: number | null;
}
const estimator = (state: State, facts: Measurements): Estimator =>
  (jsEstimator as unknown as (s: EstimatorSources) => Estimator)({
    faceMs: () => facts.faceMs,
    frameMs: () => facts.frameMs,
    route: () => state.Route,
  });
export function remainingText(state: State, facts: Measurements, progress: JobProgress): string {
  const ms = estimator(state, facts).remaining({
    facesLeft: progress.facesTotal - progress.facesDone,
    framesLeft: progress.framesTotal - progress.framesDone,
    encodeFramesLeft: progress.videoFramesTotal - progress.videoFramesDone,
  });
  return ms === null ? '' : `${describeMs(ms)} remaining`;
}
export function perFrameText(facts: Measurements): string {
  return facts.frameMs !== null
    ? `${describeMeasuredMs(facts.frameMs)} per frame`
    : facts.faceMs !== null
      ? `${describeMeasuredMs(facts.faceMs)} per face`
      : '';
}
export function predictedMorphMs(state: State, facts: Measurements): number | null {
  return facts.plannedFrames === null
    ? null
    : estimator(state, facts).predict({
        faces: state.Inputs.length,
        frames: facts.plannedFrames,
        encodeFrames: facts.plannedFrames,
      });
}
export const isSlowDevice = (state: State, faceMs: number | null): boolean =>
  state.Route === 'cpu' || (faceMs !== null && faceMs > 20_000);
export const scopeReady = (downloads: Downloads, scope: string): boolean =>
  downloads.routeReady && (scope !== 'photo' || downloads.photoReady);
export function gateScope(state: State, message: Msg): 'route' | 'photo' | null {
  let scope: 'route' | 'photo' | null = null;
  switch (message.type) {
    case 'RunFace': {
      const [id] = message.args;
      if (state.CachedFaces.has(id)) return null;
      const input = state.Inputs.find((i) => i.id === id);
      if (input && input.mode !== 'project') scope = input.mode === 'photo' ? 'photo' : 'route';
      break;
    }
    case 'Import':
      scope = 'route';
      break;
    case 'Run':
      scope = state.Inputs.some(
        (i) => i.mode === 'photo' && !state.Faces.some((f) => f.id === i.id),
      )
        ? 'photo'
        : 'route';
      break;
    default:
      break;
  }
  return scope &&
    state.Downloads.known &&
    !scopeReady(state.Downloads, scope) &&
    !state.DownloadConsent.has(scope)
    ? scope
    : null;
}
export const megabytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, bytes / 1024 ** 2).toFixed(0)} MB`;
export const estimate = (_state: State, facts: Measurements): readonly [number, number] | null =>
  facts.faceMs === null ? null : [facts.faceMs, facts.plannedFrames ?? 0];
export const failureToastVisible = (state: State, modelToast: boolean): boolean =>
  state.FailureToast && !state.Debug && state.Error !== null && !modelToast && state.Gate === null;
export const consentToastVisible = (state: State, modelToast: boolean): boolean =>
  state.ConsentPrompt &&
  !modelToast &&
  state.Gate === null &&
  !failureToastVisible(state, modelToast);
