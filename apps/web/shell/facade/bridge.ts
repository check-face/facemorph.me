// The typed facade over the retained candidate bridge (fm-pia9): every bridge export the classic UI imported
// (Product.fs lines 29-213), with typed arguments and every result read from `unknown` by facade/records.ts. The
// bridge's behaviour is unchanged; a result that is not the promised record throws a FacadeError naming the field,
// instead of reaching the interface as `undefined`. tsc reads the real .mjs modules (allowJs, no checkJs), so a name
// they do not export is a compile error here, and scripts/check-bridge-imports.mjs checks the same; every name
// imported here is exported by its module.
import * as bridge from '../../src/Next/product-bridge.mjs';
import {
  rememberSlider as rememberSliderJs,
  sliderPosition as sliderPositionJs,
  sliderPreference as sliderPreferenceJs,
} from '../../src/controller/preferences.ts';
import { nextScheduled as nextScheduledJs } from '../../src/Next/scheduler.mjs';
import { MULTIPLE_FACES_MESSAGE as multipleFacesJs } from '../../src/Next/photo/align-photo.mjs';
import {
  FacadeError,
  readBoolean,
  readCroppedFile,
  readDownloads,
  readInteger,
  readJobProgress,
  readMeasured,
  readNameFaces,
  readOutput,
  readPhotoSelection,
  readProgress,
  readString,
  type CropOffer,
  type DetectedFaces,
  type Downloads,
  type Input,
  type JobProgress,
  type MorphKind,
  type NameFace,
  type Output,
  type PhotoSelection,
  type Progress,
  type Request,
} from './records.ts';

export * from './records.ts';

// ---- jobs ----------------------------------------------------------------------------------------------------------

/** Runs one job (a face, every face, or a morph) and settles with its Output; failures are in `errorMessage`. */
export async function execute(request: Request): Promise<Output> {
  return readOutput(await bridge.execute(request));
}

/** Progress of the job in flight. A malformed event is dropped and reported, never passed on. */
export function subscribe(
  callback: (progress: Progress) => void,
  onInvalid: (error: FacadeError) => void = report,
): () => void {
  return bridge.subscribe((value: unknown) => {
    let progress: Progress;
    try {
      progress = readProgress(value);
    } catch (error) {
      if (error instanceof FacadeError) return onInvalid(error);
      throw error;
    }
    callback(progress);
  });
}

export const cancel = (): void => bridge.cancel();
export const jobProgress = (): JobProgress => readJobProgress(bridge.jobProgress());
export const measuredFaceMs = (): number | null =>
  readMeasured(bridge.measuredFaceMs(), 'measuredFaceMs');
export const measuredFrameMs = (): number | null =>
  readMeasured(bridge.measuredFrameMs(), 'measuredFrameMs');
export const measuredVideoMs = (): number | null =>
  readMeasured(bridge.measuredVideoMs(), 'measuredVideoMs');

export interface MorphSettings {
  readonly inputs: readonly Input[];
  readonly kind: MorphKind;
  readonly width: number;
  readonly pinch: boolean;
  readonly frames: number;
  readonly fps: number;
}
/** Frames the settings would render, or null while a face is missing or fewer than two exist. */
export function plannedFrames(options: MorphSettings): number | null {
  const v = bridge.plannedFrames(options);
  return v === null || v === undefined ? null : readInteger(v, 'plannedFrames');
}
export const rememberView = (options: MorphSettings): void => bridge.rememberView(options);

/** Display-size frame URLs of the current morph for the slider, or null when they are not on this device. */
export async function sliderFrames(): Promise<readonly string[] | null> {
  const v = await bridge.sliderFrames();
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new FacadeError('sliderFrames', '', 'expected string URLs or null');
  return v as string[];
}

// ---- faces ---------------------------------------------------------------------------------------------------------

export async function prepareFaceFile(id: string): Promise<Output> {
  return readOutput(await bridge.prepareFaceFile(id));
}
export const drawFace = (canvas: HTMLCanvasElement, id: string): void =>
  bridge.drawFace(canvas, id);
export const invalidateFace = (id: string): void => bridge.invalidateFace(id);
export const invalidateMorph = (): void => bridge.invalidateMorph();
export const invalidateArrivalRestore = (): void => bridge.invalidateArrivalRestore();
export const queueFace = (id: string, depth: number): void => bridge.queueFace(id, depth);
export const cancelQueuedFace = (id: string): void => bridge.cancelQueuedFace(id);
export const displayMilestone = (kind: 'preview' | 'face' | 'morph'): void =>
  bridge.displayMilestone(kind);
export async function checkCachedFace(item: Input): Promise<boolean> {
  return readBoolean(await bridge.checkCachedFace(item), 'checkCachedFace');
}
export const photoRevision = (id: string): number =>
  readInteger(bridge.photoRevision(id), 'photoRevision');
export async function restoreLastResult(): Promise<Output | null> {
  const v = await bridge.restoreLastResult();
  return v === null || v === undefined ? null : readOutput(v);
}

// ---- names and previews --------------------------------------------------------------------------------------------

export async function loadNames(): Promise<readonly NameFace[]> {
  return readNameFaces(await bridge.loadNames());
}
/** The published preview image URL for a name or seed ('' when there is none). */
export async function publicPreview(mode: 'text' | 'seed', value: string): Promise<string> {
  const v = await bridge.publicPreview(mode, value);
  return v === null || v === undefined ? '' : readString(v, 'publicPreview');
}

// ---- photos --------------------------------------------------------------------------------------------------------

export async function selectPhoto(request: {
  readonly id: string;
  readonly files: readonly File[];
}): Promise<PhotoSelection> {
  return readPhotoSelection(await bridge.selectPhotoReported(request));
}
export async function previewPhoto(
  file: Blob,
  options: { readonly edge?: number } | null = null,
): Promise<CropOffer> {
  const v = await bridge.previewPhotoReported(file, options);
  return readPhotoSelectionOffer(v, file);
}
function readPhotoSelectionOffer(value: unknown, file: Blob): CropOffer {
  const selection = readPhotoSelection(
    value && typeof value === 'object' ? { crop: true, file, ...value } : value,
  );
  if (selection.kind !== 'crop') throw new FacadeError('previewPhoto', '', 'expected a preview');
  return selection.offer;
}
export interface CropArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export async function cropPhoto(
  file: Blob,
  area: CropArea,
  options: { readonly previewScale: number; readonly rotation: number },
): Promise<File> {
  return readCroppedFile(await bridge.cropPhotoReported(file, area, options), 'cropPhoto');
}
export async function chooseDetectedFace(choice: DetectedFaces, index: number): Promise<File> {
  return readCroppedFile(await bridge.chooseDetectedFace(choice, index), 'chooseDetectedFace');
}
export const cancelPhotoRun = (): void => bridge.cancelPhotoRun();
export const warmPhotoTools = (): void => bridge.warmPhotoTools();
export const rememberSourcePhoto = (id: string, file: Blob | null): void =>
  bridge.rememberSourcePhoto(id, file);
export const sourcePhotoUrl = (id: string): string =>
  readString(bridge.sourcePhotoUrl(id), 'sourcePhotoUrl');
export const MULTIPLE_FACES_MESSAGE: string = readString(multipleFacesJs, 'MULTIPLE_FACES_MESSAGE');

// ---- results and projects ------------------------------------------------------------------------------------------

/** 'video' or a face id. Settles with the sentence to show. */
export async function saveMedia(id: string): Promise<string> {
  return readString(await bridge.saveMedia(id), 'saveMedia');
}
export async function shareMedia(id: string): Promise<string> {
  return readString(await bridge.shareMedia(id), 'shareMedia');
}
export async function exportProject(options: MorphSettings | null): Promise<string> {
  return readString(await bridge.exportProject(options ?? {}), 'exportProject');
}
export async function importProject(request: {
  readonly file: Blob;
  readonly inputs?: readonly Input[];
  readonly jobId?: number;
  readonly provider?: 'auto' | 'cpu' | 'webgpu';
  readonly routeSnapshot?: import('../../src/contracts/scheduler.ts').RouteSnapshot;
}): Promise<Output> {
  return readOutput(await bridge.importProject(request));
}

// ---- downloads -----------------------------------------------------------------------------------------------------

export function subscribeDownloads(
  callback: (downloads: Downloads) => void,
  onInvalid: (error: FacadeError) => void = report,
): () => void {
  return bridge.subscribeDownloads((value: unknown) => {
    let downloads: Downloads;
    try {
      downloads = readDownloads(value);
    } catch (error) {
      if (error instanceof FacadeError) return onInvalid(error);
      throw error;
    }
    callback(downloads);
  });
}
export const downloadModels = (includePhoto: boolean): void => bridge.downloadModels(includePhoto);
export const consentToDownload = (scope: string): string =>
  readString(bridge.consentToDownload(scope), 'consentToDownload');

// ---- reporting and links -------------------------------------------------------------------------------------------

export const setDebug = (enabled: boolean, basis: string): void => bridge.setDebug(enabled, basis);
export const sendReportOnce = (): boolean => readBoolean(bridge.sendReportOnce(), 'sendReportOnce');
export const consentAnswered = (): boolean =>
  readBoolean(bridge.consentAnswered(), 'consentAnswered');
export const stagedReportCount = (): number =>
  readInteger(bridge.stagedReportCount(), 'stagedReportCount');
export const reportReference = (): string =>
  readString(bridge.reportReference(), 'reportReference');
export const sourceVersion = (): string => readString(bridge.sourceVersion(), 'sourceVersion');
export const issueUrl = (route: string): string => readString(bridge.issueUrl(route), 'issueUrl');

// ---- slider preference and scheduling ------------------------------------------------------------------------------

export const sliderPreference = (): boolean =>
  readBoolean(sliderPreferenceJs(), 'sliderPreference');
export const sliderPosition = (): number => readInteger(sliderPositionJs(), 'sliderPosition');
export const rememberSlider = (enabled: boolean, frame: number): void =>
  rememberSliderJs(enabled, frame);

export type ScheduledJob =
  | { readonly kind: 'face'; readonly id: string }
  | { readonly kind: 'morph' }
  | { readonly kind: 'import' };
/** Index of the next job to start, or -1 while busy or everything is blocked. */
export function nextScheduled(
  jobs: readonly ScheduledJob[],
  options: {
    readonly busy?: boolean;
    readonly blockedFaces?: readonly string[];
    readonly blockMorph?: boolean;
  },
): number {
  // The module's defaults make tsc infer `blockedFaces: never[]`; it takes any ids.
  return readInteger(
    (nextScheduledJs as (jobs: unknown, options: unknown) => unknown)(jobs, options),
    'nextScheduled',
  );
}

function report(error: FacadeError): void {
  console.error('[facemorph-facade]', error.message);
}
export * from './helpers.ts';
