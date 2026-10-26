// fm-fy2.9 MP4 probe with fm-36ag sizes: Standard (the default) is 512, or a smaller model's own size, with no
// disclosure; Full tries the model size down in steps of 128, High before baseline at each, and discloses any
// size below the model's. The FFmpeg fallback is asked only when no WebCodecs candidate encodes, and only when
// its asset is cached or inside the approved acquisition scope. Settings from export-policy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  videoEncoderSettings,
  type VideoEncoderSettings,
  type VideoQuality,
} from '../../src/media/export-policy.ts';
import {
  MP4_UNAVAILABLE,
  probeMp4,
  sizeDisclosure,
  type FfmpegAvailability,
} from '../../src/media/mp4-probe.ts';

function answers(
  supported: readonly number[] | null,
  ffmpeg: FfmpegAvailability,
  options: { quality?: VideoQuality; modelSize?: number; deviceMemoryGiB?: number | null } = {},
) {
  const asked: VideoEncoderSettings[] = [];
  let ffmpegAsked = 0;
  return {
    asked,
    ffmpegAsked: () => ffmpegAsked,
    fps: 16,
    deviceMemoryGiB: null,
    ...options,
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
const full = { quality: 'full' } as const;
const tried = (a: { asked: VideoEncoderSettings[] }) => a.asked.map((s) => `${s.width}:${s.codec}`);

test('mp4-probe.standard: 512 by default for FFHQ (1024) and AFHQ cat (512), no disclosure', async () => {
  for (const modelSize of [undefined, 1024, 512]) {
    const a = answers([1024, 896, 768, 640, 512], 'cached', modelSize ? { modelSize } : {});
    const route = await probeMp4(a);
    assert.deepEqual(route, {
      ok: true,
      encoder: 'webcodecs',
      width: 512,
      height: 512,
      needsConsent: false,
      disclosure: '',
    });
    assert.deepEqual(
      a.asked,
      [videoEncoderSettings(512, 16, 'high')],
      'High first, settings from export-policy',
    );
    assert.equal(a.asked[0]?.codec, 'avc1.64002A');
    assert.equal(a.ffmpegAsked(), 0, 'FFmpeg is not considered when WebCodecs encodes');
  }
  // Standard is one size: High then baseline at 512, then FFmpeg at 512 — never 1024, never disclosed.
  const a = answers([], 'cached');
  const route = await probeMp4(a);
  assert.deepEqual(tried(a), ['512:avc1.64002A', '512:avc1.42002A']);
  assert.ok(
    route.ok && route.encoder === 'ffmpeg' && route.width === 512 && route.disclosure === '',
  );
  // A model smaller than 512 is its own standard size.
  const small = answers([256, 512], 'absent', { modelSize: 256 });
  const smallRoute = await probeMp4(small);
  assert.ok(smallRoute.ok && smallRoute.width === 256 && smallRoute.disclosure === '');
  assert.deepEqual(tried(small), ['256:avc1.64002A']);
});

test('mp4-probe.full-size: the model size is accepted with High, nothing smaller is asked', async () => {
  const a = answers([1024, 768, 512], 'cached', full);
  const route = await probeMp4(a);
  assert.deepEqual(route, {
    ok: true,
    encoder: 'webcodecs',
    width: 1024,
    height: 1024,
    needsConsent: false,
    disclosure: '',
  });
  assert.deepEqual(a.asked, [videoEncoderSettings(1024, 16, 'high')]);
  assert.equal(a.ffmpegAsked(), 0);
});

test('mp4-probe.full-768: the largest working size, High before baseline at each size tried', async () => {
  const a = answers([768, 512], 'cached', full);
  const route = await probeMp4(a);
  assert.ok(
    route.ok && route.encoder === 'webcodecs' && route.width === 768 && route.height === 768,
  );
  assert.equal(
    route.disclosure,
    'This browser can make up to 768 × 768, so this morph’s MP4 will be 768 × 768.',
  );
  assert.deepEqual(tried(a), [
    '1024:avc1.64002A',
    '1024:avc1.42002A',
    '896:avc1.64002A',
    '896:avc1.42002A',
    '768:avc1.64002A',
  ]);
  assert.equal(a.ffmpegAsked(), 0);
});

test('mp4-probe.full-512: only 512 encodes, disclosed before frames start', async () => {
  const a = answers([512], 'cached', full);
  const route = await probeMp4(a);
  assert.ok(route.ok && route.encoder === 'webcodecs' && route.width === 512);
  assert.equal(route.disclosure, sizeDisclosure(512));
  assert.deepEqual(
    a.asked.map((s) => s.width),
    [1024, 1024, 896, 896, 768, 768, 640, 640, 512],
    'largest first, two profiles per size',
  );
  // A 512-native model makes Full identical to Standard: no 1024 asked, no disclosure.
  const cat = answers([1024, 512], 'cached', { ...full, modelSize: 512 });
  const catRoute = await probeMp4(cat);
  assert.ok(catRoute.ok && catRoute.width === 512 && catRoute.disclosure === '');
  assert.deepEqual(tried(cat), ['512:avc1.64002A']);
  assert.ok(Math.max(...cat.asked.map((s) => s.width)) <= 512, 'never tries 1024');
});

test('mp4-probe.ffmpeg-cached: Standard at 512, Full at the model size when memory allows', async () => {
  for (const scope of ['cached', 'in-scope'] as const) {
    for (const supported of [null, []] as const) {
      const a = answers(supported, scope);
      const route = await probeMp4(a);
      assert.ok(
        route.ok && route.encoder === 'ffmpeg' && route.width === 512 && !route.needsConsent,
      );
      assert.equal(route.ok && route.disclosure, '');
      assert.equal(a.ffmpegAsked(), 1);
      if (supported)
        assert.deepEqual(
          a.asked.map((s) => s.width),
          [512, 512],
        );
      // WebCodecs absent (or refusing everything) in Full quality: FFmpeg at the full model size.
      for (const deviceMemoryGiB of [null, 2, 8]) {
        const f = answers(supported, scope, { ...full, deviceMemoryGiB });
        const fullRoute = await probeMp4(f);
        assert.deepEqual(fullRoute, {
          ok: true,
          encoder: 'ffmpeg',
          width: 1024,
          height: 1024,
          needsConsent: false,
          disclosure: '',
        });
        if (supported) assert.equal(f.asked.length, 14, 'every Full candidate was asked first');
      }
    }
  }
  // Too little memory for 1024's frame buffers: the largest size that fits, disclosed.
  const low = await probeMp4(answers(null, 'cached', { ...full, deviceMemoryGiB: 1 }));
  assert.ok(low.ok && low.encoder === 'ffmpeg' && low.width === 512);
  assert.equal(low.disclosure, sizeDisclosure(512));
});

test('mp4-probe.ffmpeg-needs-consent', async () => {
  const route = await probeMp4(answers(null, 'needs-consent'));
  assert.ok(
    route.ok && route.encoder === 'ffmpeg' && route.needsConsent,
    'acquisition consent asks',
  );
});

test('mp4-probe.none', async () => {
  for (const quality of ['standard', 'full'] as const)
    for (const supported of [null, []] as const) {
      const route = await probeMp4(answers(supported, 'absent', { quality }));
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

test('mp4-probe.disclosure: Full below the model size only; never Standard, never the full size', async () => {
  for (const [supported, ffmpeg, deviceMemoryGiB] of [
    [[512], 'absent', null],
    [null, 'cached', 1],
    [null, 'needs-consent', 1],
  ] as const) {
    const route = await probeMp4(answers(supported, ffmpeg, { ...full, deviceMemoryGiB }));
    assert.ok(route.ok);
    assert.equal(
      route.disclosure,
      'This browser can make up to 512 × 512, so this morph’s MP4 will be 512 × 512.',
    );
    const standard = await probeMp4(answers(supported, ffmpeg, { deviceMemoryGiB }));
    assert.ok(
      standard.ok && standard.width === 512 && standard.disclosure === '',
      'Standard 512 is the default',
    );
  }
  const fullSize = await probeMp4(answers([1024], 'absent', full));
  assert.ok(fullSize.ok && fullSize.width === 1024 && fullSize.disclosure === '');
});
