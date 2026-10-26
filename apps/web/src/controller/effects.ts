// Descriptions, not callbacks. Input-bearing operations resolve their slot at the synchronous dispatch boundary.
import { msg, type ConsentBasis, type Msg } from './msg.ts';
import type { State, Input, Request } from './state.ts';
import type { DetectedFaces } from '../../shell/facade/records.ts';
import type { CropRect } from '../../shell/facade/helpers.ts';
import { isRefusal } from '../Next/photo/refusal.mjs';
export interface ViewSnapshot {
  readonly inputs: readonly Input[];
  readonly kind: State['Kind'];
  readonly width: number;
  readonly pinch: boolean;
  readonly frames: number;
  readonly fps: number;
}
export type EverydayEffect =
  | {
      readonly type:
        | 'restoreLastResult'
        | 'subscribe'
        | 'subscribeDownloads'
        | 'invalidateArrivalRestore'
        | 'invalidateMorph'
        | 'openNamesFocus'
        | 'closeNamesFocus'
        | 'loadNames'
        | 'sliderFrames'
        | 'sendReportOnce';
    }
  | {
      readonly type: 'invalidateFace' | 'invalidatePhotoSelections' | 'publicPreview';
      readonly id: string;
    }
  | {
      readonly type: 'dispatch';
      readonly message: Extract<Msg, { type: 'RunFace' | 'BrowseNames' }>;
    }
  | { readonly type: 'setDebug'; readonly enabled: boolean; readonly basis: ConsentBasis }
  | { readonly type: 'rememberSlider'; readonly enabled: boolean; readonly frame: number };
/** Private execution descriptors stay in memory; none is a diagnostic/report payload. */
export type Effect =
  | EverydayEffect
  | PhotoEffect
  | { readonly type: 'dispatch'; readonly message: Msg }
  | { readonly type: 'rememberView' | 'exportProject'; readonly view: ViewSnapshot }
  | { readonly type: 'execute'; readonly request: Request }
  | {
      readonly type: 'importProject';
      readonly file: Blob;
      readonly jobId: number;
      readonly provider: State['Provider'];
      readonly view: ViewSnapshot;
    }
  | { readonly type: 'checkCachedFace'; readonly input: Input }
  | { readonly type: 'consentToDownload'; readonly scope: string }
  | { readonly type: 'downloadModels'; readonly includePhoto: boolean }
  | { readonly type: 'cancelWork' | 'requestNext' }
  | { readonly type: 'queueFace'; readonly id: string; readonly depth: number }
  | { readonly type: 'cancelQueuedFace' | 'saveMedia' | 'shareMedia'; readonly id: string };
export type PhotoEffect =
  | { readonly type: 'focusCropArea' | 'cancelPhotoRun' }
  | { readonly type: 'revokeUrl'; readonly url: string }
  | { readonly type: 'selectPhoto'; readonly id: string; readonly files: readonly File[] }
  | {
      readonly type: 'classifyStills';
      readonly key: string;
      readonly token: number;
      readonly pick: boolean;
      readonly target: string | null;
      readonly files: readonly File[];
    }
  | { readonly type: 'previewPhoto'; readonly id: string; readonly file: Blob }
  | {
      readonly type: 'cropPhoto';
      readonly id: string;
      readonly revision: number;
      readonly file: Blob;
      readonly area: CropRect;
      readonly options: { readonly previewScale: number; readonly rotation: number };
    }
  | {
      readonly type: 'chooseDetectedFace';
      readonly id: string;
      readonly revision: number;
      readonly choice: DetectedFaces;
      readonly index: number;
    };
export interface Transition {
  readonly state: State;
  readonly effects: readonly Effect[];
}
export const unchanged = (state: State): Transition => ({ state, effects: [] });
export type Reducer = (message: Msg, state: State) => Transition | null;
/** Rejections are a pure controller decision, separate from the promise/browser that failed. */
export function rejection(effect: Effect, error: unknown, input?: Input): Msg {
  const text = error instanceof Error ? error.message : String(error);
  switch (effect.type) {
    case 'publicPreview':
      if (!input) throw new Error('Preview rejection requires its captured input');
      return msg('PreviewLoaded', input.id, input.mode, input.value, '');
    case 'checkCachedFace':
      return msg('CachedFaceChecked', effect.input, false);
    case 'saveMedia':
    case 'shareMedia':
      return msg('Notice', "Couldn't save or share this file. Try Save instead.");
    case 'sliderFrames':
      return msg('SliderLoaded', null);
    case 'restoreLastResult':
      return msg('Notice', '');
    case 'importProject':
      return msg('Failed', effect.jobId, text);
    case 'execute':
      return msg('Failed', effect.request.jobId, text);
    case 'loadNames':
      // The open picker owns this failure: shown inside the dialog, which stays dismissible.
      return msg('NamesFailed', text);
    case 'exportProject':
      return msg('Notice', text);
    case 'classifyStills':
      return msg('PhotoFailed', effect.target ?? '', text);
    case 'selectPhoto':
    case 'previewPhoto':
    case 'cropPhoto':
    case 'chooseDetectedFace':
      // An expected refusal (unreadable, unsupported or oversized photo, cancelled crop) has
      // the error area as its one owner; an unexpected failure keeps the Off-state report ask.
      return isRefusal(error)
        ? msg('PhotoRefused', effect.id, text)
        : msg('PhotoFailed', effect.id, text);
    default:
      throw new Error(`Effect ${effect.type} has no promise rejection mapping`);
  }
}
export const viewSnapshot = (state: State): ViewSnapshot => ({
  inputs: state.Inputs,
  kind: state.Kind,
  width: state.Width,
  pinch: state.Pinch,
  frames: state.Frames,
  fps: state.Fps,
});
