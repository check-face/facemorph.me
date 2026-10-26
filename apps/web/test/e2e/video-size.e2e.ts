// fm-36ag: the morph video is 512 × 512 by default and Full quality makes it at the model's own size (1024 for
// FFHQ), with a Custom frames-per-face count. The identified build:next destination with the real product bridge
// and runtime bytes on the CPU route: each morph completes, plays to its end in the browser, and ffprobe confirms
// its width, height and frame count. Chromium by default; FACEMORPH_E2E_ENGINES=chromium,firefox adds Firefox.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/video-size.e2e.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, PORT, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/video-size');
const engines = process.env['FACEMORPH_E2E_ENGINES']?.split(',') ?? ['chromium'];

type Model = { VideoUrl: string; Error: string | null; Busy: boolean; Status: string };
const model = (page: Page) =>
  page.evaluate(() => (window as unknown as { __elmish: { model: Model } }).__elmish.model);

async function morph(
  browser: Browser,
  origin: string,
  engine: string,
  name: string,
  options: { readonly quality?: 'full'; readonly custom?: number; readonly length?: string },
): Promise<{ width: number; height: number; frames: number; played: number }> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(INSTALL_HOOK);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const step = (what: string) => console.log(`fm-36ag ${engine} ${name}: ${what}`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    step(`open ${origin}`);
    await page.goto(origin);
    await page.locator('section.next-face').nth(1).waitFor();
    step('settings');
    for (const control of [
      page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
      page.getByRole('button', { name: 'Ask me later' }),
    ])
      if (
        await control.waitFor({ timeout: 5000 }).then(
          () => true,
          () => false,
        )
      )
        await control.click(); // setup
    await page.getByRole('button', { name: 'More options' }).click(); // setup
    await page.getByLabel('Processing mode').selectOption('cpu'); // setup
    if (options.length) await page.getByLabel('Morph length').selectOption(options.length);
    if (options.custom !== undefined) {
      await page.getByLabel('Morph length').selectOption('custom');
      const field = page.getByLabel('Frames per face');
      await field.fill(String(options.custom));
    }
    if (options.quality) await page.getByLabel('Video size').selectOption(options.quality);
    const summary = await page.locator('#next-custom-frames-note').innerText();
    await page.screenshot({ path: join(results, `${engine}-${name}-settings.png`) });
    await page.locator('.next-primary-action').click();
    // The download question (first use) or the job itself follows; answer the question when it is asked.
    await page.waitForFunction(
      () => !!document.querySelector('.next-product[data-next-busy=true], .next-download-accept'),
      null,
      { timeout: 60_000 },
    );
    const accept = page.locator('.next-download-accept');
    if (await accept.isVisible()) await accept.click();
    const ticker = setInterval(() => {
      void model(page)
        .then((m) => console.log(`fm-36ag ${engine} ${name}: ${m.Status}`))
        .catch(() => {});
    }, 30_000);
    await page.waitForFunction(
      () => {
        const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
        return !!m.VideoUrl || m.Error !== null;
      },
      null,
      { timeout: 1_500_000 },
    );
    clearInterval(ticker);
    const done = await model(page);
    assert.equal(done.Error, null, `${engine} ${name}: the morph failed: ${done.Error}`);
    // Play to the end in the page, as a person would see it.
    const played = await page.locator('.next-video-slot video').evaluate(
      (v: HTMLVideoElement) =>
        new Promise<number>((ok, fail) => {
          // The result video loops; this check plays it once through to its end.
          v.loop = false;
          setTimeout(
            () => fail(Error(`playback stopped at ${v.currentTime} s of ${v.duration} s`)),
            60_000,
          );
          v.muted = true;
          v.playbackRate = 4;
          v.addEventListener('ended', () => ok(v.currentTime), { once: true });
          v.addEventListener('error', () => fail(Error('the MP4 does not decode')), { once: true });
          v.currentTime = 0;
          void v.play().catch(fail);
        }),
    );
    const bytes = await page.evaluate(async (url) => {
      const buffer = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let text = '';
      for (let i = 0; i < buffer.length; i += 0x8000)
        text += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      return btoa(text);
    }, done.VideoUrl);
    const file = join(results, `${engine}-${name}.mp4`);
    writeFileSync(file, Buffer.from(bytes, 'base64'));
    const probe = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,nb_read_frames',
        '-of',
        'json',
        file,
      ]).toString(),
    ) as { streams: [{ width: number; height: number; nb_read_frames: string }] };
    const stream = probe.streams[0];
    await page.screenshot({ path: join(results, `${engine}-${name}-done.png`) });
    console.log(`fm-36ag ${engine} ${name}`, JSON.stringify({ summary, ...stream, played }));
    assert.deepEqual(errors, []);
    return {
      width: stream.width,
      height: stream.height,
      frames: Number(stream.nb_read_frames),
      played,
    };
  } catch (error) {
    await page
      .screenshot({ path: join(results, `${engine}-${name}-FAILED.png`), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

test(
  'Standard 512 × 512 by default; Full quality at 1024 × 1024 with a Custom count',
  { timeout: 3_600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-36ag; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    mkdirSync(results, { recursive: true });
    try {
      for (const engine of engines) {
        const browser =
          engine === 'firefox'
            ? await firefox.launch()
            : await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
        const origin = engine === 'firefox' ? `https://localhost:${PORT}/` : ORIGIN;
        try {
          // Two faces, Length short (8 per face): 16 frames at the Standard size.
          const standard = await morph(browser, origin, engine, 'standard', { length: '8' });
          assert.deepEqual([standard.width, standard.height, standard.frames], [512, 512, 16]);
          assert.ok(standard.played > 0.9, `${engine}: played to the end (${standard.played} s)`);
          // Full quality with a Custom, odd count: 2 faces × 5 = 10 frames at the model's size.
          const full = await morph(browser, origin, engine, 'full-custom-5', {
            quality: 'full',
            custom: 5,
          });
          assert.deepEqual([full.width, full.height, full.frames], [1024, 1024, 10]);
          assert.ok(full.played > 0.55, `${engine}: played to the end (${full.played} s)`);
        } finally {
          await browser.close();
        }
      }
    } finally {
      await site.stop();
    }
  },
);
