// The MP4 route probe (fm-fy2.9, morph.guards; sizes fm-36ag): run before the first synthesis of a morph, in a
// fixed order — WebCodecs at each of the quality's sizes, largest first, High before baseline (export-policy
// videoEncoderCandidates), then the FFmpeg fallback only when its asset is cached or inside the approved
// acquisition scope (acquisition consent asks for it). Standard quality is one size (512, or a smaller model's
// own) and is never disclosed; Full quality below the model size is. The browser's answers arrive as plain
// functions, so the order is testable without one.
import {
  ffmpegChoice,
  videoEncoderCandidates,
  videoSizes,
  type VideoEncoderSettings,
  type VideoQuality,
} from './export-policy.ts';

/**
 * Where the FFmpeg codec asset stands: already on the device, inside an acquisition the person has
 * approved, available but needing acquisition consent first, or not delivered at all.
 */
export type FfmpegAvailability = 'cached' | 'in-scope' | 'needs-consent' | 'absent';

export interface Mp4ProbeAnswers {
  readonly fps: number;
  /** The model's square output size (default 1024); the video is never larger. */
  readonly modelSize?: number;
  /** 'standard' (the default) or 'full'. */
  readonly quality?: VideoQuality;
  /** The browser's deviceMemory in GiB; null or left out when unknown (Full FFmpeg then stays at the model size). */
  readonly deviceMemoryGiB?: number | null;
  /** VideoEncoder.isConfigSupported for one configuration, or null when WebCodecs is absent. */
  readonly webcodecs: ((settings: VideoEncoderSettings) => Promise<boolean>) | null;
  /** Asked only when no WebCodecs candidate encodes. */
  readonly ffmpeg: () => Promise<FfmpegAvailability>;
}

export type Mp4Route =
  | {
      readonly ok: true;
      readonly encoder: 'webcodecs' | 'ffmpeg';
      readonly width: number;
      readonly height: number;
      /** FFmpeg needs acquisition consent before its asset is downloaded. */
      readonly needsConsent: boolean;
      /** Said in Morph status before frames start; empty for Standard and for Full at the model size. */
      readonly disclosure: string;
    }
  | { readonly ok: false; readonly reason: 'no-encoder'; readonly message: string };

export const MP4_UNAVAILABLE =
  'This browser cannot make the MP4 video for a morph: it has no H.264 video encoder, and the FFmpeg fallback is not available on this device. Nothing was generated. Your ready faces can still be saved.';
/** Full quality below the model size: the largest size this browser makes. */
export const sizeDisclosure = (size: number) =>
  `This browser can make up to ${size} × ${size}, so this morph’s MP4 will be ${size} × ${size}.`;

export async function probeMp4(answers: Mp4ProbeAnswers): Promise<Mp4Route> {
  const options = {
    modelSize: answers.modelSize ?? 1024,
    quality: answers.quality ?? 'standard',
    deviceMemoryGiB: answers.deviceMemoryGiB ?? null,
  } as const;
  const full = videoSizes(options.modelSize)[0]!;
  const disclosure = (size: number) => (options.quality === 'full' && size < full ? sizeDisclosure(size) : '');
  if (answers.webcodecs)
    for (const settings of videoEncoderCandidates(answers.fps, options)) {
      let supported = false;
      try {
        supported = await answers.webcodecs(settings);
      } catch {
        supported = false;
      }
      if (supported)
        return {
          ok: true,
          encoder: 'webcodecs',
          width: settings.width,
          height: settings.height,
          needsConsent: false,
          disclosure: disclosure(settings.width),
        };
    }
  const ffmpeg = await answers.ffmpeg().catch((): FfmpegAvailability => 'absent');
  if (ffmpeg === 'absent') return { ok: false, reason: 'no-encoder', message: MP4_UNAVAILABLE };
  const choice = ffmpegChoice(answers.webcodecs ? 'webcodecs-unsupported' : 'webcodecs-unavailable', options);
  return {
    ok: true,
    encoder: 'ffmpeg',
    width: choice.width,
    height: choice.height,
    needsConsent: ffmpeg === 'needs-consent',
    disclosure: disclosure(choice.width),
  };
}

/** The browser's WebCodecs answer, or null when VideoEncoder is absent. */
export function browserWebCodecs(): Mp4ProbeAnswers['webcodecs'] {
  const encoder = (
    globalThis as {
      VideoEncoder?: { isConfigSupported?: (c: VideoEncoderSettings) => Promise<{ supported?: boolean }> };
    }
  ).VideoEncoder;
  const check = encoder?.isConfigSupported?.bind(encoder);
  if (!check) return null;
  return async (settings) => (await check(settings)).supported === true;
}
