// Photo admission (fm-smdf): the single-input limits applied to a photo's container header, before any full-size
// decode or copy, and whether the face detector may propose a crop. Pure: the caller reads the header (the app's
// image-header inspector) and supplies the decode, so a refused photo never reaches a decoder. Limits and
// messages are the candidate's (photo/crop.mjs, photo/align-photo.mjs).
//
// Byte ceilings per decode route come from contracts milestone 2's measurements (fm-2o8q). Until those land,
// there is no route ceiling here beyond the single-input limits: "measured, no threshold".
import { CROP_MAX_BYTES, CROP_MAX_EDGE, CROP_MAX_PIXELS } from './crop-policy.ts';

/** The detector (dlib alignment worker) only proposes crops for files up to this size (photo/align-photo.mjs). */
export const DETECTOR_MAX_BYTES = 25 * 1024 * 1024;
/** Smallest file a container header fits in (photo/crop.mjs). */
export const PHOTO_MIN_BYTES = 8;

export interface PhotoHeader {
  readonly width: number;
  readonly height: number;
  readonly encodedBytes: number;
}

export type AdmissionRefusal = 'too-many-bytes' | 'too-many-pixels' | 'edge-too-long' | 'malformed';

export const ADMISSION_MESSAGE: Readonly<Record<AdmissionRefusal, string>> = Object.freeze({
  'too-many-bytes': 'Choose a photo smaller than 64 MB.',
  'too-many-pixels': 'This photo is too large to open. Resize a copy and try again.',
  'edge-too-long': 'This photo is too large to open. Resize a copy and try again.',
  malformed: 'This photo could not be read. Try a JPEG or PNG copy.',
});

export type Admission =
  | {
      readonly admitted: true;
      /** `not-run` for files over DETECTOR_MAX_BYTES: no proposal, the person crops by hand. */
      readonly detector: 'propose' | 'not-run';
    }
  | { readonly admitted: false; readonly refusal: AdmissionRefusal; readonly message: string };

const refuse = (refusal: AdmissionRefusal): Admission => ({
  admitted: false,
  refusal,
  message: ADMISSION_MESSAGE[refusal],
});

/** Admission from the file size alone, before its bytes are read. */
export function admitSize(bytes: number): Admission {
  if (!Number.isSafeInteger(bytes) || bytes < PHOTO_MIN_BYTES) return refuse('malformed');
  if (bytes > CROP_MAX_BYTES) return refuse('too-many-bytes');
  return { admitted: true, detector: bytes > DETECTOR_MAX_BYTES ? 'not-run' : 'propose' };
}

/** Admission from the container header: size, then edge, then pixel count. */
export function admitHeader(header: PhotoHeader): Admission {
  const size = admitSize(header.encodedBytes);
  if (!size.admitted) return size;
  const { width, height } = header;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    return refuse('malformed');
  if (width > CROP_MAX_EDGE || height > CROP_MAX_EDGE) return refuse('edge-too-long');
  if (width * height > CROP_MAX_PIXELS) return refuse('too-many-pixels');
  return size;
}

export class PhotoAdmissionError extends Error {
  readonly refusal: AdmissionRefusal;
  constructor(refusal: AdmissionRefusal) {
    super(ADMISSION_MESSAGE[refusal]);
    this.refusal = refusal;
  }
}

/**
 * Reads the header, admits, and only then decodes. `inspect` only parses the header (no limits of its own): `decode` is never called for a refused photo, so no
 * full-size allocation happens before the check. A header the inspector cannot read is `malformed`.
 */
export function admitThenDecode<T>(
  bytes: Uint8Array,
  inspect: (bytes: Uint8Array) => PhotoHeader,
  decode: (bytes: Uint8Array, admission: Admission & { readonly admitted: true }) => T,
): T {
  const size = admitSize(bytes.length);
  if (!size.admitted) throw new PhotoAdmissionError(size.refusal);
  let header: PhotoHeader;
  try {
    header = inspect(bytes);
  } catch {
    throw new PhotoAdmissionError('malformed');
  }
  const admission = admitHeader({ ...header, encodedBytes: bytes.length });
  if (!admission.admitted) throw new PhotoAdmissionError(admission.refusal);
  return decode(bytes, admission);
}
