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

/** The candidate's WebCodecs codec at 1024 (constrained baseline, level 4.2); the level floor for every size. */
export const VIDEO_CODEC = 'avc1.42002A';
/** FFHQ's output size: the default model size wherever a caller names none. */
export const VIDEO_WIDTH = 1024;
/** Legacy name for the standard size; nothing chooses between only 1024 and 512 any more. */
export const VIDEO_FALLBACK_WIDTH = 512;
/** Standard quality (fm-36ag, the default): 512 × 512, or the model's own size where that is smaller. */
export const STANDARD_VIDEO_SIZE = 512;
/** The single tiny encode that proves an encoder produces decodable output before a morph relies on it. */
export const CORRECTNESS_ENCODE = Object.freeze({ width: 64, height: 64 });
/** Legacy name: FFmpeg (WASM) now encodes at the chosen quality's size, bounded by memory (ffmpegChoice). */
export const FFMPEG_WIDTH = VIDEO_WIDTH;

export type VideoQuality = 'standard' | 'full';
export type H264Profile = 'high' | 'baseline';

export interface VideoSizeOptions {
  /** The model's square output size; never exceeded (no upscaling). */
  readonly modelSize?: number;
  readonly quality?: VideoQuality;
  /** navigator.deviceMemory in GiB, or null when the browser does not say. */
  readonly deviceMemoryGiB?: number | null;
}

export interface VideoEncoderSettings {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly framerate: number;
}

const positiveSize = (n: number) => {
  if (!Number.isInteger(n) || n < 16) throw new RangeError('model size must be an integer of at least 16');
  return n - (n % 16);
};

/** The sizes Full quality tries: the model size (a multiple of 16), then down in steps of 128 to 256. */
export function videoSizes(modelSize: number): readonly number[] {
  const top = positiveSize(modelSize);
  const sizes = [top];
  for (let s = top - 128; s >= 256; s -= 128) sizes.push(s);
  return sizes;
}

/** The sizes a quality tries, largest first: Standard is one size, Full is the descending ladder. */
export function qualitySizes({ modelSize = VIDEO_WIDTH, quality = 'standard' }: VideoSizeOptions = {}): readonly number[] {
  return quality === 'full' ? videoSizes(modelSize) : [Math.min(STANDARD_VIDEO_SIZE, positiveSize(modelSize))];
}

/** H.264 Table A-1 (level_idc, MaxMBPS, MaxFS) from 4.2 up; lower levels are never named (the floor). */
const H264_LEVELS: readonly (readonly [number, number, number])[] = [
  [0x2a, 522240, 8704],
  [0x32, 589824, 22080],
  [0x33, 983040, 36864],
  [0x34, 2073600, 36864],
  [0x3c, 4177920, 139264],
  [0x3d, 8355840, 139264],
  [0x3e, 16711680, 139264],
];

/** The lowest level (at least 4.2) whose MaxFS and MaxMBPS cover a square size at fps. */
export function h264Level(size: number, fps: number): number {
  const fs = Math.ceil(size / 16) ** 2;
  const level = H264_LEVELS.find(([, mbps, maxFs]) => fs <= maxFs && fs * fps <= mbps);
  if (!level) throw new RangeError(`no H.264 level covers ${size} × ${size} at ${fps} fps`);
  return level[0];
}

/** `avc1.6400xx` (High) or `avc1.4200xx` (baseline) at the level covering size and fps. */
export function h264Codec(profile: H264Profile, size: number, fps: number): string {
  const level = h264Level(size, fps).toString(16).toUpperCase().padStart(2, '0');
  return `avc1.${profile === 'high' ? '6400' : '4200'}${level}`;
}

/** The WebCodecs configuration for one square size: 0.25 bits per pixel per frame, rounded to whole kbit/s. */
export function videoEncoderSettings(size: number, fps: number, profile: H264Profile = 'baseline'): VideoEncoderSettings {
  if (!Number.isInteger(size) || size <= 0 || !(fps > 0)) throw new RangeError('size and fps must be positive');
  return { codec: h264Codec(profile, size, fps), width: size, height: size, bitrate: Math.round((size * size * fps * 0.25) / 1000) * 1000, framerate: fps };
}

/** The configurations tried in order: largest size first, High before baseline at each size. */
export function videoEncoderCandidates(fps: number, options: VideoSizeOptions = {}): readonly VideoEncoderSettings[] {
  return qualitySizes(options).flatMap((size) => [videoEncoderSettings(size, fps, 'high'), videoEncoderSettings(size, fps, 'baseline')]);
}

/**
 * Estimated peak bytes the FFmpeg (WASM) encode holds at one square size S: the worker's eight-frame raw RGBA
 * segment in MEMFS (8 × 4·S²), libx264's YUV 4:2:0 working pictures (about 16 × 1.5·S² for references,
 * lookahead and padding at -preset ultrafast), the compressed-output cap the worker keeps in MEMFS (48 MiB,
 * video-worker.mjs MAX_COMPRESSED) and the ffmpeg-core heap and code (about 64 MiB). 1024 → ~168 MiB; 512 → ~126 MiB.
 */
export function ffmpegEncodeBytes(size: number): number {
  return (8 * 4 + 16 * 1.5) * size * size + (48 + 64) * 2 ** 20;
}
/** The share of navigator.deviceMemory the encode may take; the model, page and OS keep the rest. */
export const FFMPEG_MEMORY_SHARE = 1 / 8;

export type VideoChoice =
  | ({ readonly kind: 'webcodecs'; /** The size the quality aimed for (full size). */ readonly targetSize?: number } & VideoEncoderSettings)
  | {
      readonly kind: 'ffmpeg';
      readonly width: number;
      readonly height: number;
      readonly reason: 'webcodecs-unavailable' | 'webcodecs-unsupported';
      /** 'target': the quality's own size; 'ffmpeg-memory': Full quality reduced to fit device memory. */
      readonly sizeReason: 'target' | 'ffmpeg-memory';
    };

/**
 * The FFmpeg fallback at the quality's size. Standard stays at its size (classic encoded 512 everywhere). Full
 * takes the largest Full size, not below Standard, whose ffmpegEncodeBytes fits FFMPEG_MEMORY_SHARE of a known
 * deviceMemory; unknown memory is no reason to shrink.
 */
export function ffmpegChoice(reason: 'webcodecs-unavailable' | 'webcodecs-unsupported', options: VideoSizeOptions = {}): VideoChoice {
  const sizes = qualitySizes(options);
  const floor = qualitySizes({ ...options, quality: 'standard' })[0]!;
  const memory = options.deviceMemoryGiB;
  const budget = typeof memory === 'number' && memory > 0 ? memory * 2 ** 30 * FFMPEG_MEMORY_SHARE : Infinity;
  const size = sizes.find((s) => s >= floor && ffmpegEncodeBytes(s) <= budget) ?? floor;
  return { kind: 'ffmpeg', width: size, height: size, reason, sizeReason: size === sizes[0] ? 'target' : 'ffmpeg-memory' };
}

/**
 * The encoder for a morph, from the browser's answers as plain values: `supported(config)` is
 * VideoEncoder.isConfigSupported plus the correctness encode, or null when WebCodecs is absent.
 */
export function chooseVideoEncoder(
  fps: number,
  supported: ((s: VideoEncoderSettings) => boolean) | null,
  options: VideoSizeOptions = {},
): VideoChoice {
  if (!supported) return ffmpegChoice('webcodecs-unavailable', options);
  for (const s of videoEncoderCandidates(fps, options)) if (supported(s)) return { kind: 'webcodecs', ...s, targetSize: qualitySizes(options)[0]! };
  return ffmpegChoice('webcodecs-unsupported', options);
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
