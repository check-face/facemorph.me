// The lossy export policy, stated once (fm-l6mq): the only source of encoder settings for stills, morph video
// and the scrub/display derivative. No DOM, no Save/Share, no gesture: callers pass what the browser can do
// (`webpEncodes`, a WebCodecs support answer) as plain values. The figures are the candidate's
// (apps/web/src/Next/media.mjs probeVideoEncoder, image-encoder-worker.mjs, recovery-metadata.mjs); there is no
// quality setting a person can change.
//
// PNG is the browser's own lossless encoder output. A PNG re-filtering pass is not part of this policy: the
// sub-filter variant (eris-it1-png-sub-filter, -29% bytes, +157 ms per still) was measured and rejected, and
// must not return (docs/research-import/provenance.md).

export type StillFormat = 'webp' | 'png';
export type ExportContainer = StillFormat | 'mp4';

export interface ContainerType {
  readonly mime: string;
  readonly extension: string;
}

export const CONTAINER_TYPE: Readonly<Record<ExportContainer, ContainerType>> = Object.freeze({
  webp: Object.freeze({ mime: 'image/webp', extension: 'webp' }),
  png: Object.freeze({ mime: 'image/png', extension: 'png' }),
  mp4: Object.freeze({ mime: 'video/mp4', extension: 'mp4' }),
});

/** Lossy WebP quality for saved stills (recovery-metadata.mjs, image-encoder-worker.mjs default). */
export const WEBP_QUALITY = 0.8;
/** JPEG quality for the scrub and display derivative only; never a saved export. */
export const SCRUB_JPEG_QUALITY = 0.85;

export interface StillSettings {
  readonly format: StillFormat;
  readonly type: ContainerType;
  /** Encoder quality for lossy WebP; PNG is lossless and takes none. */
  readonly quality?: number;
  readonly lossless: boolean;
  /** Why this format: the default, an explicit lossless request, or the fallback where WebP does not encode. */
  readonly reason: 'default' | 'explicit-lossless' | 'webp-unavailable';
}

/** The settings for a saved still: WebP 0.8 unless PNG is asked for or the browser cannot encode WebP. */
export function stillSettings(options: { readonly lossless?: boolean; readonly webpEncodes: boolean }): StillSettings {
  if (options.lossless) return { format: 'png', type: CONTAINER_TYPE.png, lossless: true, reason: 'explicit-lossless' };
  if (!options.webpEncodes) return { format: 'png', type: CONTAINER_TYPE.png, lossless: true, reason: 'webp-unavailable' };
  return { format: 'webp', type: CONTAINER_TYPE.webp, quality: WEBP_QUALITY, lossless: false, reason: 'default' };
}

/** The WebCodecs H.264 profile/level the candidate encodes (constrained baseline, level 4.2). */
export const VIDEO_CODEC = 'avc1.42002A';
export const VIDEO_WIDTH = 1024;
export const VIDEO_FALLBACK_WIDTH = 512;
/** The single tiny encode that proves an encoder produces decodable output before a morph relies on it. */
export const CORRECTNESS_ENCODE = Object.freeze({ width: 64, height: 64 });
/** Where WebCodecs cannot encode, FFmpeg (WASM) encodes at this width. */
export const FFMPEG_WIDTH = 512;

export interface VideoEncoderSettings {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly framerate: number;
}

/** The WebCodecs configuration for one square size: 0.25 bits per pixel per frame, rounded to whole kbit/s. */
export function videoEncoderSettings(size: number, fps: number): VideoEncoderSettings {
  if (!Number.isInteger(size) || size <= 0 || !(fps > 0)) throw new RangeError('size and fps must be positive');
  return { codec: VIDEO_CODEC, width: size, height: size, bitrate: Math.round((size * size * fps * 0.25) / 1000) * 1000, framerate: fps };
}

/** The configurations tried in order: full size, then the fallback size; FFmpeg at FFMPEG_WIDTH after both. */
export function videoEncoderCandidates(fps: number): readonly VideoEncoderSettings[] {
  return [VIDEO_WIDTH, VIDEO_FALLBACK_WIDTH].map((size) => videoEncoderSettings(size, fps));
}

export type VideoChoice =
  | ({ readonly kind: 'webcodecs' } & VideoEncoderSettings)
  | { readonly kind: 'ffmpeg'; readonly width: number; readonly height: number; readonly reason: 'webcodecs-unavailable' | 'webcodecs-unsupported' };

/**
 * The encoder for a morph, from the browser's answers as plain values: `supported(config)` is
 * VideoEncoder.isConfigSupported plus the correctness encode, or null when WebCodecs is absent.
 */
export function chooseVideoEncoder(fps: number, supported: ((s: VideoEncoderSettings) => boolean) | null): VideoChoice {
  const fallback = { width: FFMPEG_WIDTH, height: FFMPEG_WIDTH };
  if (!supported) return { kind: 'ffmpeg', ...fallback, reason: 'webcodecs-unavailable' };
  for (const s of videoEncoderCandidates(fps)) if (supported(s)) return { kind: 'webcodecs', ...s };
  return { kind: 'ffmpeg', ...fallback, reason: 'webcodecs-unsupported' };
}

/** The container the bytes actually are, from their signature; null when they are none of the three. */
export function sniffContainer(bytes: Uint8Array): ExportContainer | null {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 12 && ascii(4, 4) === 'ftyp') return 'mp4';
  return null;
}

/** Whether a file's declared MIME type and extension both match its bytes. */
export function typeMatchesBytes(bytes: Uint8Array, declared: { readonly mime: string; readonly filename: string }): boolean {
  const actual = sniffContainer(bytes);
  if (!actual) return false;
  const t = CONTAINER_TYPE[actual];
  return declared.mime === t.mime && declared.filename.toLowerCase().endsWith(`.${t.extension}`);
}
