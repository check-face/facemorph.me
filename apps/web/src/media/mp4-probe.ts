// The MP4 route probe (fm-fy2.9, morph.guards): run before the first synthesis of a morph, in a fixed
// order — WebCodecs `avc1.42002A` at 1024, then at 512, then the FFmpeg 512 fallback only when its asset
// is cached or inside the approved acquisition scope (acquisition consent asks for it). Settings come from
// export-policy. The browser's answers arrive as plain functions, so the order is testable without one.
import {
  FFMPEG_WIDTH,
  VIDEO_FALLBACK_WIDTH,
  VIDEO_WIDTH,
  videoEncoderSettings,
  type VideoEncoderSettings,
} from './export-policy.ts';

/**
 * Where the FFmpeg codec asset stands: already on the device, inside an acquisition the person has
 * approved, available but needing acquisition consent first, or not delivered at all.
 */
export type FfmpegAvailability = 'cached' | 'in-scope' | 'needs-consent' | 'absent';

export interface Mp4ProbeAnswers {
  readonly fps: number;
  /** VideoEncoder.isConfigSupported for one configuration, or null when WebCodecs is absent. */
  readonly webcodecs: ((settings: VideoEncoderSettings) => Promise<boolean>) | null;
  /** Asked only when neither WebCodecs size encodes. */
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
      /** Said in Morph status before frames start; empty at full size. */
      readonly disclosure: string;
    }
  | { readonly ok: false; readonly reason: 'no-encoder'; readonly message: string };

export const MP4_UNAVAILABLE =
  'This browser cannot make the MP4 video for a morph: it has no H.264 video encoder, and the FFmpeg fallback is not available on this device. Nothing was generated. Your ready faces can still be saved.';
export const disclosure512 = (size: number) =>
  `This browser can only encode a smaller video, so this morph’s MP4 will be ${size} × ${size}.`;

export async function probeMp4(answers: Mp4ProbeAnswers): Promise<Mp4Route> {
  if (answers.webcodecs)
    for (const size of [VIDEO_WIDTH, VIDEO_FALLBACK_WIDTH]) {
      let supported = false;
      try {
        supported = await answers.webcodecs(videoEncoderSettings(size, answers.fps));
      } catch {
        supported = false;
      }
      if (supported)
        return {
          ok: true,
          encoder: 'webcodecs',
          width: size,
          height: size,
          needsConsent: false,
          disclosure: size === VIDEO_WIDTH ? '' : disclosure512(size),
        };
    }
  const ffmpeg = await answers.ffmpeg().catch((): FfmpegAvailability => 'absent');
  if (ffmpeg === 'absent') return { ok: false, reason: 'no-encoder', message: MP4_UNAVAILABLE };
  return {
    ok: true,
    encoder: 'ffmpeg',
    width: FFMPEG_WIDTH,
    height: FFMPEG_WIDTH,
    needsConsent: ffmpeg === 'needs-consent',
    disclosure: disclosure512(FFMPEG_WIDTH),
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
