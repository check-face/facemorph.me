// Real-browser checks of the recovery schema core (fm-fzzd) on the built package (npm run build -w
// packages/stylegan-js first), in Playwright Chromium:
// - forced WebCodecs 512: the page encodes a 32-frame morph-like clip with VideoEncoder at exactly the export
//   policy's settings (avc1.42002A, 512 x 512, bitrate formula, keyframe every 2 s as video-worker.mjs), the app's
//   own muxMp4 (src/Next/video-worker.mjs) muxes it, embedMp4Project adds a schema-2 project;
// - forced FFmpeg: the pinned ffmpeg-core 0.12.10 (sha256 9f57947a..., the candidate runtime manifest's codec) runs
//   in the page with video-worker.mjs's exact libx264 segment and concat arguments at 512 x 512;
//   each file plays in a <video> to its end at 512 x 512, upright (red top-left marker), ffprobe decodes the
//   expected frame count, the internal reader recovers the exact ordered controls and settings, and a truncated
//   copy is rejected;
// - lossy WebP 0.8 still (the browser's own encoder, as the app's): the schema-3 envelope round-trips the exact
//   latent and model identity, the file decodes at 1024 x 1024 upright, and a chunk copied onto another lossy
//   encode fails its integrity check. Payload, metadata and total bytes are reported.
//
//   node packages/stylegan-js/test/browser/mp4-project-browsers.mjs
// Set FM_FFMPEG_CORE_DIR to the @ffmpeg/core 0.12.10 dist/esm directory (default: the device-lab copy).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis; // video-worker.mjs installs an onmessage handler on import
const pkg = fileURLToPath(new URL('../../', import.meta.url));
const web = join(pkg, '../../apps/web');
const require = createRequire(join(web, 'package.json'));
const { chromium } = require('playwright');
const { muxMp4 } = await import(join(web, 'src/Next/video-worker.mjs'));
const { chooseVideoEncoder, videoEncoderSettings, WEBP_QUALITY } = await import(
  join(web, 'src/media/export-policy.ts')
);
const m = await import(join(pkg, 'dist/index.js'));

const ORIGIN = 'https://media.test';
const FFMPEG_DIR =
  process.env.FM_FFMPEG_CORE_DIR ??
  '/mnt/nas/files/facemorph-device-lab/assets/facemorph.me/experiment/device-lab/node_modules/@ffmpeg/core/dist/esm';
const FFMPEG_WASM_SHA256 = '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7';
const FRAMES = 32;
const FPS = 16;

const served = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) served.set(`${ORIGIN}/${relative(pkg, p)}`, readFileSync(p));
  }
};
walk(join(pkg, 'dist'));
let ffmpeg = 'untested: ffmpeg-core not found';
if (existsSync(join(FFMPEG_DIR, 'ffmpeg-core.wasm'))) {
  const wasm = readFileSync(join(FFMPEG_DIR, 'ffmpeg-core.wasm'));
  const digest = createHash('sha256').update(wasm).digest('hex');
  if (digest === FFMPEG_WASM_SHA256) {
    served.set(`${ORIGIN}/ffmpeg/ffmpeg-core.wasm`, wasm);
    served.set(`${ORIGIN}/ffmpeg/ffmpeg-core.js`, readFileSync(join(FFMPEG_DIR, 'ffmpeg-core.js')));
    ffmpeg = 'available';
  } else ffmpeg = `untested: ffmpeg-core.wasm digest ${digest} is not the pinned codec`;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const descriptor = m.FFHQ_1024_DESCRIPTOR;
const latent = (k) => ({
  space: 'w-plus',
  shape: [18, 512],
  values: Float32Array.from({ length: 18 * 512 }, (_, i) => Math.sin(i * 0.37 + k) * 2.5),
});
const morph = {
  algorithmVersion: 'geometry-v1',
  kind: 'pairwise-figure8',
  closed: true,
  width: 0.4,
  pinchCenter: false,
  framesPerSegment: 16,
  framesPerSecond: FPS,
  controls: ['A', 'B'].map((visitId, k) => ({ visitId, latent: latent(k) })),
};

const browser = await chromium.launch();
const browserVersion = browser.version();
const page = await browser.newPage();
const requests = [];
await page.route('**/*', (route) => {
  const url = route.request().url();
  requests.push(url);
  const body =
    served.get(url) ??
    (url === `${ORIGIN}/` ? Buffer.from('<!doctype html><title>mp4</title>') : null);
  if (!body) return route.fulfill({ status: 404, body: '' });
  const type = url.endsWith('.js')
    ? 'text/javascript'
    : url.endsWith('.wasm')
      ? 'application/wasm'
      : 'text/html';
  return route.fulfill({ status: 200, body, contentType: type });
});
await page.goto(`${ORIGIN}/`);

/** The clip's frames, drawn identically in both routes: a red top-left marker and a moving bar. */
const FRAME_SOURCE = `(i, size) => {
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(30,60,200)'; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgb(230,20,20)'; g.fillRect(0, 0, size / 2, size / 2);
  g.fillStyle = 'rgb(240,240,240)'; g.fillRect(((i * 13) % (size - 40)), size * 0.75, 40, size / 8);
  return g.getImageData(0, 0, size, size).data;
}`;

await page.addScriptTag({ content: `globalThis.fmFrame = ${FRAME_SOURCE};` });

const results = { ffmpeg };
let failed = false;
const check = (name, ok, detail) => {
  results[name] = { ok, ...detail };
  failed ||= !ok;
};

async function webcodecs512() {
  const choice = chooseVideoEncoder(FPS, (s) => s.width === 512); // 1024 refused: the forced fallback size
  const cfg = videoEncoderSettings(choice.width, FPS);
  const out = await page.evaluate(
    async ({ cfg, frames }) => {
      const frame = globalThis.fmFrame;
      const chunks = [];
      let description = null;
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          description ??= meta?.decoderConfig?.description ?? null;
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push({
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            size: data.length,
            data: btoa(String.fromCharCode(...data)),
          });
        },
        error: (e) => {
          throw e;
        },
      });
      const support = await VideoEncoder.isConfigSupported({ ...cfg, avc: { format: 'avc' } });
      enc.configure({
        codec: cfg.codec,
        width: cfg.width,
        height: cfg.height,
        bitrate: cfg.bitrate,
        framerate: cfg.framerate,
        avc: { format: 'avc' },
        latencyMode: 'quality',
      });
      for (let i = 0; i < frames; i++) {
        const f = new VideoFrame(frame(i, cfg.width), {
          format: 'RGBA',
          codedWidth: cfg.width,
          codedHeight: cfg.height,
          timestamp: Math.round((i * 1e6) / cfg.framerate),
          duration: Math.round(1e6 / cfg.framerate),
        });
        enc.encode(f, { keyFrame: i % Math.max(1, Math.round(cfg.framerate * 2)) === 0 });
        f.close();
      }
      await enc.flush();
      enc.close();
      const d = new Uint8Array(description);
      return { supported: support.supported, chunks, description: btoa(String.fromCharCode(...d)) };
    },
    { cfg, frames: FRAMES },
  );
  const samples = out.chunks.map((c) => ({ ...c, data: unb64(c.data) }));
  return {
    choice,
    settings: cfg,
    mp4: muxMp4(samples, unb64(out.description), cfg.width, cfg.height, FPS),
  };
}

async function ffmpeg512() {
  const choice = chooseVideoEncoder(FPS, null); // no WebCodecs: the FFmpeg fallback
  const out = await page.evaluate(
    async ({ origin, size, fps, frames }) => {
      const frame = globalThis.fmFrame;
      const { default: create } = await import(`${origin}/ffmpeg/ffmpeg-core.js`);
      const wasm = new Uint8Array(
        await (await fetch(`${origin}/ffmpeg/ffmpeg-core.wasm`)).arrayBuffer(),
      );
      const core = await create({
        wasmBinary: wasm,
        locateFile: () => `${origin}/ffmpeg/ffmpeg-core.wasm`,
      });
      core.setLogger(() => {});
      const segments = [];
      // video-worker.mjs flush(): eight-frame raw segments, each encoded with these exact arguments.
      for (let at = 0; at < frames; at += 8) {
        const n = Math.min(8, frames - at);
        const raw = new Uint8Array(size * size * 4 * n);
        for (let k = 0; k < n; k++) raw.set(frame(at + k, size), k * size * size * 4);
        core.FS.writeFile('frames.rgba', raw);
        const name = `part-${String(segments.length).padStart(6, '0')}.mp4`;
        core.setTimeout(120000);
        const code = core.exec(
          '-f',
          'rawvideo',
          '-pixel_format',
          'rgba',
          '-video_size',
          `${size}x${size}`,
          '-framerate',
          String(fps),
          '-i',
          'frames.rgba',
          '-frames:v',
          String(n),
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '20',
          '-profile:v',
          'baseline',
          '-pix_fmt',
          'yuv420p',
          '-threads',
          '1',
          '-an',
          name,
        );
        core.reset();
        core.FS.unlink('frames.rgba');
        if (code !== 0) throw new Error(`segment exit ${code}`);
        segments.push(name);
      }
      core.FS.writeFile('parts.txt', segments.map((x) => `file '${x}'`).join('\n'));
      core.setTimeout(120000);
      const code = core.exec(
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'parts.txt',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        'morph.mp4',
      );
      core.reset();
      if (code !== 0) throw new Error(`concat exit ${code}`);
      const bytes = core.FS.readFile('morph.mp4');
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768)
        s += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(s);
    },
    { origin: ORIGIN, size: choice.width, fps: FPS, frames: FRAMES },
  );
  return { choice, mp4: unb64(out) };
}

/** Plays the file to its end in a <video>; reports size, duration and the upright marker at mid-clip. */
const play = (bytes) =>
  page.evaluate(async (data) => {
    const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
      type: 'video/mp4',
    });
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    document.body.append(v);
    await new Promise((ok, bad) => {
      v.onloadeddata = ok;
      v.onerror = () => bad(new Error(`video error ${v.error?.code}`));
    });
    let presented = 0;
    const count = () => {
      presented++;
      v.requestVideoFrameCallback(count);
    };
    v.requestVideoFrameCallback(count);
    v.playbackRate = 1;
    await v.play();
    await new Promise((ok, bad) => {
      v.onended = ok;
      setTimeout(() => bad(new Error('playback did not end')), 20000);
    });
    const ended = v.ended;
    v.currentTime = v.duration / 2;
    await new Promise((ok) => (v.onseeked = ok));
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    const out = {
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      ended,
      presented,
      topLeft: px(20, 20),
      bottomRight: px(v.videoWidth - 20, 20 + v.videoHeight / 2),
    };
    URL.revokeObjectURL(v.src);
    v.remove();
    return out;
  }, b64(bytes));

const redTopLeft = (p) =>
  p.topLeft[0] > 180 && p.topLeft[2] < 80 && p.bottomRight[2] > 150 && p.bottomRight[0] < 90;
const tmp = mkdtempSync(join(tmpdir(), 'fm-mp4-'));
const ffprobeFrames = (bytes, name) => {
  const p = join(tmp, name);
  writeFileSync(p, bytes);
  try {
    return Number.parseInt(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'csv=p=0',
        p,
      ])
        .toString()
        .trim(),
      10,
    );
  } catch {
    return null; // ffprobe absent: the browser playback and the internal reader still apply
  }
};

async function route(name, produce) {
  const { choice, mp4, settings } = await produce();
  const report = m.videoFileResult(choice);
  const saved = m.embedMp4Project(mp4, {
    descriptor,
    bundle: { version: 'browser-test', manifestSha256: 'b'.repeat(64) },
    truncationPsi: 1,
    truncationCutoff: 0,
    morph,
    route: report,
  });
  const r = m.readMp4Project(saved);
  const p = r.kind === 'parsed' ? r.project : null;
  const exact =
    p?.schemaVersion === 2 &&
    p.morph.controls.length === 2 &&
    p.morph.controls.every(
      (c, k) =>
        c.visitId === morph.controls[k].visitId &&
        Buffer.from(c.latent.values.buffer).equals(
          Buffer.from(morph.controls[k].latent.values.buffer),
        ),
    ) &&
    [
      'algorithmVersion',
      'kind',
      'closed',
      'width',
      'pinchCenter',
      'framesPerSegment',
      'framesPerSecond',
    ].every((k) => p.morph[k] === morph[k]);
  const truncated = m.readMp4Project(saved.subarray(0, saved.length - 1000));
  const played = await play(saved);
  const frames = ffprobeFrames(saved, `${name}.mp4`);
  const ok =
    report.width === 512 &&
    report.height === 512 &&
    report.route === choice.kind &&
    r.kind === 'parsed' &&
    r.video.frameCount === FRAMES &&
    p.video.width === 512 &&
    exact &&
    truncated.kind === 'damaged' &&
    truncated.reason === 'truncated' &&
    played.ended &&
    played.width === 512 &&
    played.height === 512 &&
    Math.abs(played.duration - FRAMES / FPS) < 0.1 &&
    redTopLeft(played) &&
    (frames === null || frames === FRAMES);
  check(name, ok, {
    report,
    settings,
    bytes: saved.length,
    projectBytes: saved.length - mp4.length,
    video: r.kind === 'parsed' ? r.video : r,
    exactControlsAndSettings: exact,
    truncated: truncated.kind === 'damaged' ? truncated.reason : truncated.kind,
    played,
    ffprobeFrames: frames,
  });
}

await route('webcodecs-512', webcodecs512);
if (ffmpeg === 'available') await route('ffmpeg-512', ffmpeg512);

// Lossy WebP 0.8 still, as the app saves one.
{
  const encode = (shift) =>
    page.evaluate(
      async ({ q, shift }) => {
        const c = new OffscreenCanvas(1024, 1024);
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 1024, 1024);
        grad.addColorStop(0, 'rgb(40,90,160)');
        grad.addColorStop(1, `rgb(${200 - shift},180,120)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1024, 1024);
        g.fillStyle = 'rgb(230,20,20)';
        g.fillRect(0, 0, 256, 256);
        const blob = await c.convertToBlob({ type: 'image/webp', quality: q });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { type: blob.type, data: btoa(String.fromCharCode(...bytes)) };
      },
      { q: WEBP_QUALITY, shift },
    );
  const a = await encode(0);
  const other = await encode(60);
  const lossy = unb64(a.data);
  const l = latent(7);
  const meta = {
    descriptor,
    generationKind: 'latent',
    generationSha256: 'd'.repeat(64),
    provenance: {
      modelSha256: descriptor.identity.modelSha256,
      noiseSha256: descriptor.identity.noiseSha256,
    },
    latent: l,
  };
  const saved = m.embedRecoveryV3(lossy, meta);
  const r = m.readRecovery(saved);
  const exact =
    r.kind === 'parsed' &&
    r.recovered.schemaVersion === 3 &&
    Buffer.from(r.recovered.latent.values.buffer).equals(Buffer.from(l.values.buffer)) &&
    r.recovered.model.modelSha256 === descriptor.identity.modelSha256;
  const decoded = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/webp' }),
    );
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = c.getContext('2d');
    g.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      topLeft: Array.from(g.getImageData(20, 20, 1, 1).data.slice(0, 3)),
      bottomRight: Array.from(g.getImageData(1000, 1000, 1, 1).data.slice(0, 3)),
    };
  }, b64(saved));
  // Copy the envelope chunk (with its now-obsolete hash) onto a different lossy encode.
  const otherBytes = unb64(other.data);
  const chunk = saved.subarray(lossy.length);
  const copied = new Uint8Array(otherBytes.length + chunk.length);
  copied.set(otherBytes);
  copied.set(chunk, otherBytes.length);
  new DataView(copied.buffer).setUint32(4, copied.length - 8, true);
  const copiedRead = m.readRecovery(copied);
  const upright =
    decoded.topLeft[0] > 180 && decoded.topLeft[2] < 80 && decoded.bottomRight[0] > 120;
  check(
    'lossy-webp-0.8',
    a.type === 'image/webp' &&
      exact &&
      decoded.width === 1024 &&
      decoded.height === 1024 &&
      upright &&
      copiedRead.kind === 'damaged' &&
      copiedRead.reason === 'integrity',
    {
      payloadBytes: lossy.length,
      metadataBytes: saved.length - lossy.length,
      totalBytes: saved.length,
      exactLatentAndModel: exact,
      decoded,
      copiedObsoleteHash: copiedRead.kind === 'damaged' ? copiedRead.reason : copiedRead.kind,
    },
  );
}

await browser.close();
for (const f of readdirSync(tmp)) unlinkSync(join(tmp, f));
rmdirSync(tmp);
const unexpected = requests.filter((u) => u !== `${ORIGIN}/` && !served.has(u));
if (unexpected.length) check('requests', false, { unexpected });
console.log(JSON.stringify({ browser: 'chromium', version: browserVersion, ...results }, null, 1));
process.exitCode = failed ? 1 : 0;
