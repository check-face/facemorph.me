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
import { diagnostics } from '../../src/Next/reporting.mjs';
import { nameResultFile } from '../../src/Next/name-results.mjs';
import { MULTIPLE_FACES_MESSAGE as multipleFacesJs } from '../../src/Next/photo/align-photo.mjs';
import {
  editRevision,
  forgetRestored,
  inputsToBridge,
  isRestored,
  noteEdit,
  toBridge,
  withRestoredWords,
} from '../session/restored-words.ts';
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
export interface ComputeAdmission {
  acquire(): Promise<void>;
  release(): Promise<void>;
}
export async function execute(request: Request, compute?: ComputeAdmission): Promise<Output> {
  return readOutput(
    await bridge.execute({ ...request, inputs: inputsToBridge(request.inputs) }, compute),
  );
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
  const v = bridge.plannedFrames(bridgeSettings(options));
  return v === null || v === undefined ? null : readInteger(v, 'plannedFrames');
}
export const rememberView = (options: MorphSettings): void =>
  bridge.rememberView(bridgeSettings(options));
/** Restored faces whose words came back unchanged reach the bridge as restored faces (fm-5hww). */
function bridgeSettings(options: MorphSettings): MorphSettings {
  return Array.isArray(options.inputs)
    ? { ...options, inputs: inputsToBridge(options.inputs) }
    : options;
}

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
export const invalidateFace = (id: string): void => {
  forgetRestored(id);
  bridge.invalidateFace(id);
};
/** A seeded blend slot (fm-2kse) starts as a copy of a finished morph face, under its own id. */
export const copyFace = (from: string, to: string): void => bridge.copyFace(from, to);
export const invalidateMorph = (): void => bridge.invalidateMorph();
export const invalidateArrivalRestore = (): void => {
  noteEdit();
  bridge.invalidateArrivalRestore();
};
export const queueFace = (id: string, depth: number): void => bridge.queueFace(id, depth);
export const cancelQueuedFace = (id: string): void => bridge.cancelQueuedFace(id);
export const displayMilestone = (
  kind: 'preview' | 'generated-visible' | 'restored-visible',
): void => bridge.displayMilestone(kind);
export async function checkCachedFace(item: Input): Promise<boolean> {
  // A restored face is already on screen: it needs no model.
  if (isRestored(item)) return true;
  return readBoolean(await bridge.checkCachedFace(toBridge(item)), 'checkCachedFace');
}
export const photoRevision = (id: string): number =>
  readInteger(bridge.photoRevision(id), 'photoRevision');
export async function restoreLastResult(): Promise<Output | null> {
  const since = editRevision();
  const v = await bridge.restoreLastResult();
  return v === null || v === undefined ? null : withRestoredWords(readOutput(v), since);
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
/**
 * A picked name (fm-ejwq): its published recovery-bearing result, installed without a model or inference as that
 * face's result for the unchanged text. A name without a published result, or one that fails its checks, is an
 * error: synthesis is never substituted; Generate remains the ordinary typed path.
 */
export async function pickName(request: {
  readonly id: string;
  readonly value: string;
}): Promise<PhotoSelection> {
  const file = await nameResultFile(request.value);
  if (!file)
    throw new Error('This name has no published picture. Press Generate to make this face.');
  return readPhotoSelection(
    await bridge.selectPhotoReported({ id: request.id, files: [file], name: request.value }),
  );
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
/** The faces the on-device detector finds in a batch photo's preview (fm-q5b9): fractions, two or more, else none. */
export async function detectFaces(
  file: Blob,
): Promise<readonly { x: number; y: number; width: number; height: number }[]> {
  const v: unknown = await bridge.detectFaces(file);
  if (!Array.isArray(v)) throw new FacadeError('detectFaces', '', 'expected a list of boxes');
  return v.map((box: unknown, i) => {
    const b = box as Record<string, unknown>;
    const read = (k: string) => {
      const n = b?.[k];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)
        throw new FacadeError('detectFaces', `[${i}].${k}`, 'expected a fraction');
      return n;
    };
    return { x: read('x'), y: read('y'), width: read('width'), height: read('height') };
  });
}
export async function chooseDetectedFace(choice: DetectedFaces, index: number): Promise<File> {
  return readCroppedFile(await bridge.chooseDetectedFace(choice, index), 'chooseDetectedFace');
}
export const cancelPhotoRun = (): void => bridge.cancelPhotoRun();
export const warmPhotoTools = (): void => bridge.warmPhotoTools();
export const MULTIPLE_FACES_MESSAGE: string = readString(multipleFacesJs, 'MULTIPLE_FACES_MESSAGE');

// ---- results and projects ------------------------------------------------------------------------------------------

/** 'video' or a face id. Settles with the sentence to show. */
export type StillFormat = 'webp' | 'png';
export interface PreparedMedia {
  readonly blob: Blob;
  readonly filename: string;
  readonly mime: string;
  readonly digest: string;
}
function readPreparedMedia(value: unknown): PreparedMedia {
  if (typeof value !== 'object' || value === null)
    throw new TypeError('preparedMedia: expected a file');
  const raw = value as Record<string, unknown>;
  if (
    !(raw['blob'] instanceof Blob) ||
    typeof raw['filename'] !== 'string' ||
    typeof raw['mime'] !== 'string' ||
    raw['mime'] !== raw['blob'].type ||
    typeof raw['digest'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw['digest'])
  )
    throw new TypeError('preparedMedia: invalid file identity');
  return { blob: raw['blob'], filename: raw['filename'], mime: raw['mime'], digest: raw['digest'] };
}
export const exportResultRevision = (id: string): number =>
  readInteger(bridge.exportResultRevision(id), 'exportResultRevision');
export async function prepareMedia(id: string, format: StillFormat): Promise<PreparedMedia> {
  return readPreparedMedia(await bridge.prepareMedia(id, { format }));
}
export function renamePreparedMedia(file: PreparedMedia, name: string): PreparedMedia {
  return readPreparedMedia(bridge.renamePreparedMedia(file, name));
}
export function handPreparedMedia(
  id: string,
  file: PreparedMedia,
  method: 'save' | 'share',
): Promise<string> {
  // Call the bridge before constructing any asynchronous continuation: Share keeps activation.
  return bridge
    .handPreparedMedia(id, file, method)
    .then((value: unknown) => readString(value, 'handPreparedMedia'));
}
/** `format`: a face's still as WebP (the default) or PNG (lossless); a morph is always MP4. */
export async function saveMedia(
  id: string,
  options?: { readonly format?: StillFormat },
): Promise<string> {
  return readString(await bridge.saveMedia(id, options), 'saveMedia');
}
export async function shareMedia(
  id: string,
  options?: { readonly format?: StillFormat },
): Promise<string> {
  return readString(await bridge.shareMedia(id, options), 'shareMedia');
}
/** Prepared-file counters: encodes into the store this session (a repeat Save or Share adds none). */
export function exportStats(): {
  readonly encodes: number;
  readonly known: number;
  readonly webpEncodes: boolean;
} {
  const s: unknown = bridge.exportStats();
  const field = (k: string): unknown =>
    s && typeof s === 'object' ? Reflect.get(s, k) : undefined;
  const encodes = field('encodes'),
    known = field('known'),
    webpEncodes = field('webpEncodes');
  if (typeof encodes !== 'number' || typeof known !== 'number' || typeof webpEncodes !== 'boolean')
    throw new TypeError('exportStats: not export counters');
  return { encodes, known, webpEncodes };
}
export async function exportProject(options: MorphSettings | null): Promise<string> {
  return readString(
    await bridge.exportProject(options ? bridgeSettings(options) : {}),
    'exportProject',
  );
}
export async function importProject(
  request: {
    readonly file: Blob;
    readonly inputs?: readonly Input[];
    readonly jobId?: number;
    readonly provider?: 'auto' | 'cpu' | 'webgpu';
    readonly routeSnapshot?: import('../../src/contracts/scheduler.ts').RouteSnapshot;
  },
  compute?: ComputeAdmission,
): Promise<Output> {
  return readOutput(
    await bridge.importProject(
      request.inputs ? { ...request, inputs: inputsToBridge(request.inputs) } : request,
      compute,
    ),
  );
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
export const cancelDownloadSetup = (): void => bridge.cancelDownloadSetup();
export const consentToDownload = (scope: string): string =>
  readString(bridge.consentToDownload(scope), 'consentToDownload');

// ---- reporting and links -------------------------------------------------------------------------------------------

export const setDebug = (enabled: boolean, basis: string): void => bridge.setDebug(enabled, basis);
export const sendReportOnce = (): boolean => readBoolean(bridge.sendReportOnce(), 'sendReportOnce');
export const consentAnswered = (): boolean =>
  readBoolean(bridge.consentAnswered(), 'consentAnswered');
export const stagedReportCount = (): number =>
  readInteger(bridge.stagedReportCount(), 'stagedReportCount');
/**
 * Restores the saved debug-report choice before the first render, so a saved On (or the labs default) is the
 * state the page first paints, never Off followed by On (fm-szbf). Idempotent: the bridge's own restore on
 * subscribe is then a no-op. Returns whether standing reporting is on.
 */
export const restoreDebug = (): boolean => {
  diagnostics.restore();
  return readBoolean(diagnostics.status().enabled, 'restoreDebug');
};
export interface ReportStatus {
  /** Whether the last choice reached storage; false means it holds for this tab only. */
  readonly persisted: boolean;
  /** Staged records of the most recent failed attempt, which "Send this report" would send. */
  readonly sendable: number;
}
export const reportStatus = (): ReportStatus => {
  const status: unknown = diagnostics.status();
  const record = (status ?? {}) as Record<string, unknown>;
  return {
    persisted: record['persisted'] !== false,
    sendable: readInteger(record['sendable'] ?? 0, 'reportStatus.sendable'),
  };
};
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
