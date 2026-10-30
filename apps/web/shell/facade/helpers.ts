// The rest of what Product.fs imported (fm-pia9): the estimator, the crop view's pure state functions and the
// photo-selection and focus helpers, typed. These modules compute or touch the DOM; nothing here changes them.
import {
  createEstimator as createEstimatorJs,
  describeMeasuredMs as describeMeasuredMsJs,
  describeMs as describeMsJs,
  isSlowJob as isSlowJobJs,
} from '../../src/Next/estimate.mjs';
import {
  alignedCrop as alignedCropJs,
  createCrop as createCropJs,
  editorLayout as editorLayoutJs,
  move as moveJs,
  previewFrame as previewFrameJs,
  rect as rectJs,
  resize as resizeJs,
  resizeViewport as resizeViewportJs,
  rotate as rotateJs,
  turnTo as turnToJs,
} from '../../src/Next/photo/crop-view.mjs';
import {
  closeNamesFocus as closeNamesFocusJs,
  dragPhoto as dragPhotoJs,
  focusCropArea as focusCropAreaJs,
  invalidatePhotoSelections as invalidatePhotoSelectionsJs,
  namesKey as namesKeyJs,
  openNamesFocus as openNamesFocusJs,
  openPhotoPicker as openPhotoPickerJs,
  photoFiles as photoFilesJs,
} from '../../src/Next/photo-selection.mjs';
import { FacadeError } from './records.ts';

// ---- estimates -----------------------------------------------------------------------------------------------------

export interface Estimator {
  measured(): boolean;
  coldFaceMs(): number | null;
  faceMs(): number | null;
  frameMs(): number | null;
  predict(units: { faces?: number; frames?: number; encodeFrames?: number }): number | null;
  remaining(units: {
    facesLeft?: number;
    framesLeft?: number;
    encodeFramesLeft?: number;
  }): number | null;
}
export interface EstimatorSources {
  readonly faceMs?: () => number | null;
  readonly frameMs?: () => number | null;
  readonly encodeMs?: () => number | null;
  readonly route?: () => string | null;
}
export const createEstimator = (sources: EstimatorSources): Estimator =>
  (createEstimatorJs as unknown as (s: EstimatorSources) => Estimator)(sources);
export const describeMs = (ms: number): string => String(describeMsJs(ms));
export const describeMeasuredMs = (ms: number): string => String(describeMeasuredMsJs(ms));
export const isSlowJob = (ms: number): boolean => isSlowJobJs(ms) === true;

// ---- crop view (photo/crop-view.mjs: a square stencil over the turned photo, preview pixels) ----------------------

export interface CropState {
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly scale: number;
  /** The editor's square, CSS pixels. */
  readonly viewport: number;
  /** The square's centre and side, preview pixels. */
  readonly cx: number;
  readonly cy: number;
  readonly side: number;
  /** quarter * 90 + fine, normalised to (-180, 180]: the photo's turn about the square's centre, clockwise. */
  readonly rotation: number;
  /** 0-3 quarter turns from the rotate button. */
  readonly quarter: number;
  /** The fine-rotation slider, -45 to 45 degrees. */
  readonly fine: number;
}
export interface CropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/** The editor in its own CSS pixels: the photo's transform (origin 0 0), its turned box and the stencil. */
export interface CropLayout {
  readonly k: number;
  readonly boxX: number;
  readonly boxY: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly transform: string;
  readonly left: number;
  readonly top: number;
  readonly size: number;
}
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const numbers = <T extends object>(
  record: string,
  value: unknown,
  keys: readonly (keyof T & string)[],
): T => {
  if (typeof value !== 'object' || value === null)
    throw new FacadeError(record, '', 'expected an object');
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new FacadeError(record, k, 'expected a finite number');
  }
  return value as T;
};
const STATE_KEYS = [
  'previewWidth',
  'previewHeight',
  'scale',
  'viewport',
  'cx',
  'cy',
  'side',
  'rotation',
  'quarter',
  'fine',
] as const;
const state = (v: unknown): CropState => numbers<CropState>('CropState', v, STATE_KEYS);
type Untyped = (...args: unknown[]) => unknown;

export const createCrop = (preview: {
  previewWidth: number;
  previewHeight: number;
  scale?: number;
  viewport?: number;
}): CropState => state((createCropJs as Untyped)(preview));
/** Moves the stencil by a pointer move in editor pixels. */
export const panCrop = (s: CropState, dx: number, dy: number): CropState =>
  state((moveJs as Untyped)(s, dx, dy));
/** Resizes the stencil from one of its eight handles by a pointer move in editor pixels. */
export const resizeStencil = (
  s: CropState,
  handle: CropHandle,
  dx: number,
  dy: number,
): CropState => state((resizeJs as Untyped)(s, handle, dx, dy));
export const rotateCrop = (s: CropState): CropState => state((rotateJs as Untyped)(s));
export const turnCrop = (s: CropState, fine: number): CropState =>
  state((turnToJs as Untyped)(s, fine));
/** The aligned proposal: centre and side in preview pixels and the angle that stands the face upright. */
export const alignCrop = (
  s: CropState,
  square: { cx: number; cy: number; side: number; rotation: number },
): CropState => state((alignedCropJs as Untyped)(s, square));
export const resizeCrop = (s: CropState, viewport: number): CropState =>
  state((resizeViewportJs as Untyped)(s, viewport));
export const cropRect = (s: CropState): CropRect =>
  numbers<CropRect>('CropRect', (rectJs as Untyped)(s), ['left', 'top', 'width', 'height']);
export const cropLayout = (s: CropState, viewport?: number): CropLayout => {
  const v = (editorLayoutJs as Untyped)(s, viewport ?? s.viewport) as CropLayout;
  if (typeof v?.transform !== 'string')
    throw new FacadeError('CropLayout', 'transform', 'expected a string');
  return numbers<CropLayout>('CropLayout', v, [
    'k',
    'boxX',
    'boxY',
    'boxWidth',
    'boxHeight',
    'left',
    'top',
    'size',
  ]);
};
/** The CSS transform (origin 0 0) that fills a `size` pixel square with the crop. */
export const cropPreview = (s: CropState, size: number): string => {
  const v = (previewFrameJs as Untyped)(s, size) as { transform?: unknown };
  if (typeof v?.transform !== 'string')
    throw new FacadeError('CropPreview', 'transform', 'expected a string');
  return v.transform;
};

// ---- photo selection and focus -------------------------------------------------------------------------------------

/** Files from a drop or a file input, in order; clears the input so the same file can be chosen again. */
export function photoFiles(event: {
  dataTransfer?: DataTransfer | null;
  target?: EventTarget | null;
}): File[] {
  const files = (photoFilesJs as Untyped)(event);
  if (!Array.isArray(files) || files.some((f) => !(f instanceof File)))
    throw new FacadeError('photoFiles', '', 'expected Files');
  return files as File[];
}
/** Opens the hidden file input `#photo-<id>`. */
export const openPhotoPicker = (id: string): void => void openPhotoPickerJs(id);
/** Marks a drop target while a photo is dragged over it; takes React's event (its currentTarget is the element). */
export const dragPhoto = (
  event: {
    preventDefault(): void;
    stopPropagation(): void;
    currentTarget: Element;
    dataTransfer: DataTransfer | null;
  },
  busy: boolean,
  leaving = false,
): void => void (dragPhotoJs as Untyped)(event, busy, leaving);
/** Forgets a pending selection for one face, or every face when id is ''. */
export const invalidatePhotoSelections = (id: string): void => void invalidatePhotoSelectionsJs(id);
export const focusCropArea = (): void => void focusCropAreaJs();
export const openNamesFocus = (): void => void openNamesFocusJs();
export const closeNamesFocus = (): void => void closeNamesFocusJs();
export const revokeUrl = (url: string): void => URL.revokeObjectURL(url);
/** Escape closes the names dialog; Tab keeps focus inside it. */
export const namesKey = (
  event: {
    key: string;
    preventDefault(): void;
    shiftKey: boolean;
    currentTarget: Element;
  },
  close: () => void,
): void => void (namesKeyJs as Untyped)(event, close);
