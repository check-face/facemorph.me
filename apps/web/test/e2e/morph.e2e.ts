// The rendering port's morph and video slots in the real shell (dist/render-check.html, plain state, no
// controller) in real Chromium, Firefox and WebKit at desktop (mouse) and phone (touch) width: Create morph and
// its reason at one face, More options with shape, length and pinch, the processing mode above the faces (Automatic,
// CPU, WebGPU), playing a finished morph, Use Slider and scrubbing, the slider position surviving hide and show,
// and frames not yet stored. Each control is pressed at its visible centre after elementFromPoint shows it is
// there; a native select's choice is made by name once it has been pressed (its list is not page DOM).
// Creating the morph itself needs the candidate controller (fm-qkke): untested here.
//   node --test test/e2e/morph.e2e.ts        (screenshots in test-results/morph/)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { press } from '../support/operate.ts';
import { serve, type Served } from '../support/serve.ts';

const app = new URL('../../', import.meta.url);
const results = new URL('test-results/morph/', app);
const WIDTHS = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
const FRAMES = Array.from({ length: 8 }, (_, i) => `/fixtures/morph/frame-${i + 1}.png`);

let site: Served;
before(async () => {
  assert.ok(
    existsSync(new URL('dist/render-check.html', app)),
    'no dist/: run `npm run build` first',
  );
  site = await serve(new URL('dist', app).pathname, {
    '/fixtures/': new URL('test/fixtures', app).pathname,
  });
  mkdirSync(results, { recursive: true });
});
after(async () => {
  await site?.close();
});

const shot = (page: Page, name: string) =>
  page.screenshot({ path: new URL(`${name}.png`, results).pathname });
// The slider's canvas shows a frame: some pixel is not transparent.
const painted = (page: Page) =>
  page.locator('.next-slider canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    return !!d && d.some((v, i) => i % 4 === 3 && v > 0);
  });

async function scrubToEnd(page: Page, touch: boolean, at: string) {
  const rail = page.locator('.next-slider-control');
  await rail.scrollIntoViewIfNeeded();
  const box = await rail.boundingBox();
  assert.ok(box, `${at}: the slider has no box`);
  const x = box.x + box.width - 2,
    y = box.y + box.height / 2;
  assert.ok(
    await rail.evaluate(
      (el, [px, py]) => {
        const hit = document.elementFromPoint(px as number, py as number);
        return !!hit && el.contains(hit);
      },
      [x, y],
    ),
    `${at}: the slider's end is not where it is drawn`,
  );
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

for (const [engine, type] of Object.entries(ENGINES).filter(([e]) => !only || only.includes(e))) {
  test(`${engine}: morph settings, video and slider, operated by mouse and touch`, async (t) => {
    const browser = await type.launch();
    try {
      for (const [width, viewport] of Object.entries(WIDTHS)) {
        const touch = width === 'phone';
        const context = await browser.newContext({
          viewport,
          hasTouch: touch,
          isMobile: touch && engine !== 'firefox',
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const at = `${engine} ${width}`;

        // One face: no morph, and the reason says why.
        await page.goto(`${site.origin}/render-check.html?faces=1`);
        await page.waitForSelector('.next-morph-slot');
        assert.equal(
          await page.locator('.next-primary-action').isDisabled(),
          true,
          `${at}: Create morph off at one face`,
        );
        assert.match(
          await page.locator('.next-morph-reason').innerText(),
          /Add a second face to create a morph/,
        );

        // Two faces: Create morph, then More options.
        await page.goto(`${site.origin}/render-check.html?faces=2&route=cpu`);
        await page.waitForSelector('.next-morph-slot');
        assert.equal(
          await page.locator('.next-primary-action').isDisabled(),
          false,
          `${at}: Create morph on at two faces`,
        );
        assert.ok(
          (await press(page, page.locator('.next-primary-action'), { touch })).inside,
          `${at}: Create morph`,
        );
        assert.equal(
          await page.locator('.next-route-caption').innerText(),
          'Ready · this device’s CPU.',
        );
        assert.ok(
          (await press(page, page.getByRole('button', { name: 'More options' }), { touch })).inside,
          `${at}: More options`,
        );
        await page.locator('#next-overflow').waitFor();
        assert.equal(
          await page.getByRole('button', { name: 'More options' }).getAttribute('aria-expanded'),
          'true',
        );
        for (const [label, value] of [
          ['Morph shape', 'linear'],
          ['Morph length', '32'],
        ] as const) {
          const select = page.getByLabel(label);
          assert.ok((await press(page, select, { touch })).inside, `${at}: ${label}`);
          await page.keyboard.press('Escape'); // close the native list the press opened
          await select.selectOption(value);
          assert.equal(await select.inputValue(), value);
        }
        assert.match(
          await page.locator('#next-custom-frames-note').innerText(),
          /^64 frames total · 4\.0 s video$/,
          `${at}: 2 faces × 32 frames`,
        );
        const pinch = page.getByLabel('Pinch centre');
        assert.equal(await pinch.isChecked(), true);
        assert.ok((await press(page, pinch, { touch })).inside, `${at}: Pinch centre`);
        assert.equal(await pinch.isChecked(), false, `${at}: pinch toggled by the press`);
        // The processing selector sits above the faces (fm-5kpx), not under More options.
        assert.equal(await page.locator('.next-advanced').count(), 0, `${at}: no Advanced section`);
        const processing = page.getByLabel('Processing mode');
        assert.ok((await press(page, processing, { touch })).inside, `${at}: Processing mode`);
        await page.keyboard.press('Escape'); // close the native list the press opened
        const [above, faces] = await Promise.all([
          processing.boundingBox(),
          page.locator('section.next-face').first().boundingBox(),
        ]);
        assert.ok(
          above && faces && above.y + above.height <= faces.y,
          `${at}: above the first face`,
        );
        assert.deepEqual(
          await page
            .getByLabel('Processing mode')
            .locator('option')
            .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value)),
          ['auto', 'cpu', 'webgpu'],
          `${at}: no WebGL route`,
        );
        await shot(page, `${engine}-${width}-overflow`);

        // A finished morph: the video plays where this browser decodes H.264, then Use Slider replaces it.
        await page.goto(
          `${site.origin}/render-check.html?faces=2&video=/fixtures/morph/morph.mp4&frames=${FRAMES.join(',')}`,
        );
        const video = page.locator('video.next-video');
        await video.waitFor();
        const decodes = await video.evaluate(
          (v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.64001e"') !== '',
        );
        if (decodes) {
          await page.waitForFunction(
            () => (document.querySelector('video.next-video') as HTMLVideoElement).readyState >= 2,
            null,
            { timeout: 15_000 },
          );
          await video.evaluate((v: HTMLVideoElement) => {
            v.muted = true;
            return v.play();
          });
          const advanced = await page
            .waitForFunction(
              () =>
                (document.querySelector('video.next-video') as HTMLVideoElement).currentTime > 0,
              null,
              { timeout: 5000 },
            )
            .then(
              () => true,
              () => false,
            );
          if (!advanced)
            t.diagnostic(
              `${at}: the morph decoded (readyState >= 2) but its playback clock did not advance in this headless ${engine}: playback untested here`,
            );
          assert.equal(
            await video.evaluate((v: HTMLVideoElement) => v.loop),
            true,
            `${at}: the morph loops`,
          );
        } else
          t.diagnostic(
            `${at}: this ${engine} build has no H.264 decoder, so playback is untested here`,
          );
        await shot(page, `${engine}-${width}-video`);
        const useSlider = page.getByLabel('Use Slider');
        assert.ok((await press(page, useSlider, { touch })).inside, `${at}: Use Slider`);
        await page.locator('.next-slider canvas').waitFor();
        assert.equal(
          await page.locator('video.next-video').count(),
          0,
          `${at}: the slider replaces the video`,
        );
        await page.waitForFunction(() => {
          const c = document.querySelector('.next-slider canvas') as HTMLCanvasElement;
          return c.width > 0;
        });
        await page.waitForTimeout(300);
        assert.ok(
          await painted(page),
          `${at}: the first frame is drawn without touching the slider`,
        );
        // Scrub to the end: a real press at the slider's right end, checked to be on the slider first.
        await scrubToEnd(page, touch, at);
        await page.waitForFunction(
          () =>
            document.querySelector('.next-slider-control input')?.getAttribute('aria-valuenow') ===
            '8',
        );
        assert.equal(
          await page.locator('.next-slider-control .MuiSlider-thumb').getAttribute('style'),
          'left: 100%;',
          `${at}: the thumb is at the end`,
        );
        // The thumb glides and the frame's image loads after the value changes: screenshot once both have settled.
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (a) =>
                a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
            ),
        ); // the button gradient never ends
        await page.waitForFunction(() => {
          const c = document.querySelector('.next-slider canvas') as HTMLCanvasElement;
          return !!c.getContext('2d')?.getImageData(c.width - 1, c.height - 1, 1, 1).data[3];
        });
        await shot(page, `${engine}-${width}-slider-end`);
        // Hide the slider and bring it back: the position is kept.
        await press(page, useSlider, { touch });
        await video.waitFor();
        await press(page, useSlider, { touch });
        await page.locator('.next-slider canvas').waitFor();
        assert.equal(
          await page.locator('.next-slider-control input').getAttribute('aria-valuenow'),
          '8',
          `${at}: slider position survives hide and show`,
        );

        // Frames still queued: scrubbing onto one says so instead of showing a blank.
        const partial = FRAMES.map((f, i) => (i >= 4 ? '' : f));
        await page.goto(
          `${site.origin}/render-check.html?faces=2&video=/fixtures/morph/morph.mp4&frames=${partial.join(',')}`,
        );
        await press(page, page.getByLabel('Use Slider'), { touch });
        await scrubToEnd(page, touch, at);
        await page.getByText('This frame is still queued.').waitFor();
        // No retained frames at all: the slider says why it has nothing to scrub.
        await page.goto(`${site.origin}/render-check.html?faces=2&video=/fixtures/morph/morph.mp4`);
        await press(page, page.getByLabel('Use Slider'), { touch });
        await page.locator('.next-slider-empty').waitFor();
        await shot(page, `${engine}-${width}-no-frames`);

        assert.deepEqual(errors, [], `${at}: page errors`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
