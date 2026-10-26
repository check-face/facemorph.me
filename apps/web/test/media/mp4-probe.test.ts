// fm-fy2.9 MP4 probe: the fixed order (WebCodecs avc1.42002A 1024, then 512, then the FFmpeg 512 fallback
// only when its asset is cached or inside the approved acquisition scope), settings from export-policy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIDEO_CODEC,
  videoEncoderSettings,
  type VideoEncoderSettings,
} from '../../src/media/export-policy.ts';
import { MP4_UNAVAILABLE, probeMp4, type FfmpegAvailability } from '../../src/media/mp4-probe.ts';

function answers(supported: readonly number[] | null, ffmpeg: FfmpegAvailability) {
  const asked: VideoEncoderSettings[] = [];
  let ffmpegAsked = 0;
  return {
    asked,
    ffmpegAsked: () => ffmpegAsked,
    fps: 16,
    webcodecs: supported
      ? async (s: VideoEncoderSettings) => {
          asked.push(s);
          return supported.includes(s.width);
        }
      : null,
    ffmpeg: async () => {
      ffmpegAsked++;
      return ffmpeg;
    },
  };
}

test('mp4-probe.1024', async () => {
  const a = answers([1024, 512], 'cached');
  const route = await probeMp4(a);
  assert.deepEqual(route, {
    ok: true,
    encoder: 'webcodecs',
    width: 1024,
    height: 1024,
    needsConsent: false,
    disclosure: '',
  });
  assert.deepEqual(a.asked, [videoEncoderSettings(1024, 16)], 'settings from export-policy');
  assert.equal(a.asked[0]?.codec, VIDEO_CODEC);
  assert.equal(VIDEO_CODEC, 'avc1.42002A');
  assert.equal(a.ffmpegAsked(), 0, 'FFmpeg is not considered when WebCodecs encodes');
});

test('mp4-probe.512-webcodecs', async () => {
  const a = answers([512], 'cached');
  const route = await probeMp4(a);
  assert.ok(route.ok && route.encoder === 'webcodecs' && route.width === 512);
  assert.deepEqual(
    a.asked.map((s) => s.width),
    [1024, 512],
    '1024 is tried first',
  );
  assert.equal(a.ffmpegAsked(), 0);
});

test('mp4-probe.ffmpeg-cached', async () => {
  for (const scope of ['cached', 'in-scope'] as const) {
    for (const supported of [null, []] as const) {
      const a = answers(supported, scope);
      const route = await probeMp4(a);
      assert.ok(
        route.ok && route.encoder === 'ffmpeg' && route.width === 512 && !route.needsConsent,
      );
      assert.equal(a.ffmpegAsked(), 1);
      if (supported)
        assert.deepEqual(
          a.asked.map((s) => s.width),
          [1024, 512],
        );
    }
  }
});

test('mp4-probe.ffmpeg-needs-consent', async () => {
  const route = await probeMp4(answers(null, 'needs-consent'));
  assert.ok(
    route.ok && route.encoder === 'ffmpeg' && route.needsConsent,
    'acquisition consent asks',
  );
});

test('mp4-probe.none', async () => {
  for (const supported of [null, []] as const) {
    const route = await probeMp4(answers(supported, 'absent'));
    assert.deepEqual(route, { ok: false, reason: 'no-encoder', message: MP4_UNAVAILABLE });
  }
  // A throwing browser answer is no route, never an exception.
  const route = await probeMp4({
    fps: 16,
    webcodecs: async () => {
      throw Error('isConfigSupported failed');
    },
    ffmpeg: async () => {
      throw Error('inventory unavailable');
    },
  });
  assert.equal(route.ok, false);
  assert.match(MP4_UNAVAILABLE, /ready faces can still be saved/);
});

test('mp4-probe.disclosure-512', async () => {
  for (const [supported, ffmpeg] of [
    [[512], 'absent'],
    [null, 'cached'],
    [null, 'needs-consent'],
  ] as const) {
    const route = await probeMp4(answers(supported, ffmpeg));
    assert.ok(route.ok);
    assert.equal(
      route.disclosure,
      'This browser can only encode a smaller video, so this morph’s MP4 will be 512 × 512.',
    );
  }
  const full = await probeMp4(answers([1024], 'absent'));
  assert.ok(full.ok && full.disclosure === '');
});
