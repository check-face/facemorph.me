// The rest of what Product.fs imported (fm-pia9): the estimator, the crop view's pure state functions and the
// photo-selection and focus helpers, typed. These modules compute or touch the DOM; nothing here changes them.
import {
  createEstimator as createEstimatorJs,
  describeMeasuredMs as describeMeasuredMsJs,
  describeMs as describeMsJs,
  isSlowJob as isSlowJobJs,
} from '../../src/Next/estimate.mjs';
import {
  createCrop as createCropJs,
  frame as frameJs,
  pan as panJs,
  rect as rectJs,
  resizeViewport as resizeViewportJs,
  rotate as rotateJs,
  zoomTo as zoomToJs,
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

// ---- crop view (photo/crop-view.mjs: preview pixels, offsets from the centre) --------------------------------------

export interface CropState {
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly scale: number;
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** 0, 90, 180 or 270. */
  readonly rotation: number;
  /** The on-screen square, CSS pixels. */
  readonly viewport: number;
}
export interface CropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface CropFrame {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly originX: number;
  readonly originY: number;
}
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
  'zoom',
  'offsetX',
  'offsetY',
  'rotation',
  'viewport',
] as const;
const state = (v: unknown): CropState => numbers<CropState>('CropState', v, STATE_KEYS);
type Untyped = (...args: unknown[]) => unknown;

export const createCrop = (preview: {
  previewWidth: number;
  previewHeight: number;
  scale?: number;
  viewport?: number;
}): CropState => state((createCropJs as Untyped)(preview));
export const panCrop = (s: CropState, dx: number, dy: number): CropState =>
  state((panJs as Untyped)(s, dx, dy));
export const zoomCrop = (s: CropState, zoom: number): CropState =>
  state((zoomToJs as Untyped)(s, zoom));
export const rotateCrop = (s: CropState): CropState => state((rotateJs as Untyped)(s));
export const resizeCrop = (s: CropState, viewport: number): CropState =>
  state((resizeViewportJs as Untyped)(s, viewport));
export const cropRect = (s: CropState): CropRect =>
  numbers<CropRect>('CropRect', (rectJs as Untyped)(s), ['left', 'top', 'width', 'height']);
export const cropFrame = (s: CropState, viewport: number): CropFrame =>
  numbers<CropFrame>('CropFrame', (frameJs as Untyped)(s, viewport), [
    'width',
    'height',
    'x',
    'y',
    'rotation',
    'originX',
    'originY',
  ]);

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
/** Escape closes the names dialog; Tab keeps focus inside it. */
export const namesKey = (
  event: { key: string; preventDefault(): void; shiftKey: boolean; currentTarget: Element },
  close: () => void,
): void => void (namesKeyJs as Untyped)(event, close);
