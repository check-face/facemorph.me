// Descriptions, not callbacks. Input-bearing operations resolve their slot at the synchronous dispatch boundary.
import type { ConsentBasis, Msg } from './msg.ts';
import type { State } from './state.ts';
export type Effect =
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
  | { readonly type: 'rememberSourcePhoto'; readonly id: string; readonly file: null }
  | {
      readonly type: 'dispatch';
      readonly message: Extract<Msg, { type: 'RunFace' | 'BrowseNames' }>;
    }
  | { readonly type: 'setDebug'; readonly enabled: boolean; readonly basis: ConsentBasis }
  | { readonly type: 'rememberSlider'; readonly enabled: boolean; readonly frame: number };
export interface Transition {
  readonly state: State;
  readonly effects: readonly Effect[];
}
export const unchanged = (state: State): Transition => ({ state, effects: [] });
export type Reducer = (message: Msg, state: State) => Transition | null;
