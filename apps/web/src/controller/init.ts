import { msg } from './msg.ts';
import type { Transition, Effect } from './effects.ts';
import { emptyBlend, type BlendSlot } from './blend.ts';
export interface InitialFacts {
  readonly today: string;
  readonly url: string;
  readonly consentAnswered: boolean;
  /** The restored standing debug-report choice (fm-szbf): the first render shows it, never a false Off. */
  readonly debugOn?: boolean;
  readonly sliderPreference: boolean;
  readonly sliderPosition: number;
  /** The remembered morph video size (fm-36ag); Standard when absent. */
  readonly videoQuality?: 'standard' | 'full';
  /** The blend view's slots and weights restored from this tab's session (fm-2kse). */
  readonly blend?: readonly BlendSlot[];
}
export const namesRequested = (url: URL): boolean =>
  url.pathname === '/names' || url.pathname === '/names/' || url.searchParams.has('names');
export const testingInvited = (url: URL): boolean => url.searchParams.has('testing');
export const labsOrigin = (url: URL): boolean => url.hostname.startsWith('labs.');
export function init(facts: InitialFacts): Transition {
  const url = new URL(facts.url);
  const effects: Effect[] = [
    { type: 'restoreLastResult' },
    { type: 'subscribe' },
    { type: 'subscribeDownloads' },
  ];
  if (namesRequested(url))
    effects.push({ type: 'dispatch', message: msg('BrowseNames', 'face-1') });
  return {
    state: {
      Inputs: [
        { id: 'face-1', mode: 'text', value: 'hello', file: null },
        { id: 'face-2', mode: 'text', value: facts.today, file: null },
      ],
      Faces: [],
      Previews: [{ id: 'face-1', mode: 'text', value: 'hello', url: '/preview/hello-1024.webp' }],
      VideoUrl: '',
      Kind: 'full-smooth-figure8',
      Width: 0.2,
      Pinch: true,
      Frames: 16,
      Fps: 16,
      ...(facts.videoQuality === 'full' ? { Quality: 'full' as const } : {}),
      ...(facts.blend?.length ? { Blend: { ...emptyBlend(), slots: facts.blend } } : {}),
      Provider: 'auto',
      Busy: false,
      JobId: 0,
      Stage: 'idle',
      Status: '',
      Fraction: 0,
      Preparing: '',
      Browse: null,
      Names: [],
      NameQuery: '',
      NameLimit: 48,
      Error: null,
      DebugStatus: '',
      Debug: facts.debugOn === true,
      NextId: 3,
      Crop: null,
      CropQueue: [],
      Route: '',
      Rejected: null,
      Invite: testingInvited(url),
      UseSlider: facts.sliderPreference,
      SliderFrames: null,
      SliderFrame: facts.sliderPosition,
      Warn: null,
      Overflow: false,
      PhotoQueue: [],
      PendingFaces: [],
      PendingJobs: [],
      PendingMorph: false,
      PendingImport: null,
      RunInputs: [],
      RunSettings: '',
      PreparingFaces: new Set(),
      CachedFaces: new Set(),
      ActiveFace: null,
      Remaining: '',
      ConsentPrompt:
        !testingInvited(url) &&
        !labsOrigin(url) &&
        !facts.consentAnswered &&
        facts.debugOn !== true,
      Downloads: {
        known: false,
        phase: 'idle',
        scope: '',
        loaded: 0,
        total: 0,
        routeReady: false,
        photoReady: false,
        photoAvailable: false,
        routeBytes: 0,
        photoBytes: 0,
      },
      ModelToastHidden: false,
      DownloadConsent: new Set(),
      Gate: null,
      LastRun: null,
      FailureToast: false,
    },
    effects,
  };
}
