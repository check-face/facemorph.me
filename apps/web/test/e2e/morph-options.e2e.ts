// fm-36ag UI review: the Custom frames-per-face field and the Video size choice in More options, on the
// identified build:next destination in Chromium at 1280 px (mouse) and 390 px (touch), light and dark.
// Controls are pressed at their visible centre after elementFromPoint shows them (support/operate.ts); a
// native select's choice is made by keyboard. Checks: keyboard-only Custom entry with the inline, announced
// reason; Create morph refused while the count is invalid; live total, length and fields; Tab order equal to
// visual order; text contrast >= 4.5:1; 44 px targets at touch width; no sideways page scroll.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/morph-options.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/morph-options');

/** WCAG contrast of an element's text against the first opaque background behind it, opacity included. */
const contrast = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number) as number[];
      const blend = (fg: number[], bg: number[], a: number) =>
        fg.slice(0, 3).map((v, i) => v * a + bg[i]! * (1 - a));
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      let alpha = 1;
      let bg: number[] | null = null;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        alpha *= Number(style.opacity);
        const b = rgba(style.backgroundColor);
        if (!bg && b.length >= 3 && (b[3] ?? 1) > 0.9) bg = b;
      }
      bg ??= matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255];
      const fg = rgba(getComputedStyle(el).color);
      const text = blend(fg, bg, alpha * (fg[3] ?? 1));
      const [hi, lo] = [lum(text), lum(bg)].sort((a, b) => b - a);
      return (hi! + 0.05) / (lo! + 0.05);
    });

test(
  'More options: Custom frames and Video size, operated at both widths in light and dark',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-36ag`;
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
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      for (const scheme of ['light', 'dark'] as const)
        for (const [name, width, touch] of [
          ['desktop', 1280, false],
          ['phone', 390, true],
        ] as const) {
          const at = `${name}-${scheme}`;
          const context = await browser.newContext({
            ...(touch ? devices['iPhone 13'] : {}),
            viewport: { width, height: 900 },
            hasTouch: touch,
            isMobile: touch,
            colorScheme: scheme,
            ignoreHTTPSErrors: true,
          });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const operate = async (selector: string) =>
            assert.ok(
              (await press(page, page.locator(selector).first(), { touch })).inside,
              `${at}: ${selector}`,
            );
          try {
            await page.goto(ORIGIN);
            await page.locator('section.next-face').nth(1).waitFor();
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
                await press(page, control, { touch });
            await press(page, page.getByRole('button', { name: 'More options' }), { touch });
            await page.locator('#next-overflow').waitFor();
            // Keyboard only from here: the length select chooses Custom, then the field takes a count.
            await operate('select[aria-label="Morph length"]');
            await page.keyboard.press('Escape'); // closes the native list a press may open; focus stays
            await page.locator('select[aria-label="Morph length"]').focus();
            await page.keyboard.press('End');
            assert.equal(
              await page.locator('select[aria-label="Morph length"]').inputValue(),
              'custom',
            );
            const field = page.getByLabel('Frames per face');
            await field.waitFor();
            await page.keyboard.press('Tab');
            assert.equal(
              await page.evaluate(() => document.activeElement?.closest('label')?.textContent),
              'Frames per face',
            );
            await page.keyboard.press('Control+A');
            await page.keyboard.type('1');
            const problem = page.locator('#next-custom-frames-note[role=alert]');
            await problem.waitFor();
            assert.match(
              await problem.innerText(),
              /^Enter a whole number from 2 to 2,048: a morph needs at least 2 frames per face\.$/,
            );
            assert.equal(await field.getAttribute('aria-invalid'), 'true');
            assert.equal(await field.getAttribute('aria-describedby'), 'next-custom-frames-note');
            assert.equal(
              await page.locator('.next-primary-action').isDisabled(),
              true,
              `${at}: an invalid count never starts a morph`,
            );
            assert.equal(
              await page.getByText('Add a second face to create a morph').count(),
              0,
              `${at}: the reason is the count, not the faces`,
            );
            await page.screenshot({ path: join(results, `${at}-custom-invalid.png`) });
            assert.ok(
              (await contrast(page, '#next-custom-frames-note')) >= 4.5,
              `${at}: reason contrast`,
            );
            await page.keyboard.press('Control+A');
            await page.keyboard.type('7');
            await page.waitForFunction(
              () => !document.querySelector('#next-custom-frames-note[role=alert]'),
            );
            assert.equal(
              await page.locator('#next-custom-frames-note').innerText(),
              '14 frames total · 0.9 s video',
            );
            assert.equal(await page.locator('.next-primary-action').isDisabled(), false);
            await page.keyboard.press('Control+A');
            await page.keyboard.type('300');
            assert.equal(
              await page.locator('#next-custom-frames-note').innerText(),
              '600 frames total · 38 s video',
            );
            // Video size by keyboard: Tab reaches it next, End picks Full quality, and the note says what it costs.
            await page.keyboard.press('Tab');
            assert.equal(
              await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
              'Video size',
            );
            assert.equal(
              await page.locator('select[aria-label="Video size"]').inputValue(),
              'standard',
            );
            assert.match(
              await page.locator('select[aria-label="Video size"] option:checked').innerText(),
              /^Standard · 512 × 512$/,
            );
            await page.keyboard.press('End');
            assert.equal(
              await page.locator('select[aria-label="Video size"]').inputValue(),
              'full',
            );
            assert.equal(
              await page.locator('#next-video-quality-note').innerText(),
              'Full quality takes longer and makes larger files.',
            );
            // Tab order equals visual order through the settings.
            await page.locator('select[aria-label="Morph shape"]').focus();
            const stops: { label: string; top: number; left: number }[] = [];
            for (let i = 0; i < 5; i++) {
              stops.push(
                await page.evaluate(() => {
                  const el = document.activeElement as HTMLElement;
                  const r = el.getBoundingClientRect();
                  return {
                    label: el.getAttribute('aria-label') ?? el.textContent ?? '',
                    top: r.top,
                    left: r.left,
                  };
                }),
              );
              await page.keyboard.press('Tab');
            }
            assert.deepEqual(
              stops.slice(0, 4).map((s) => s.label),
              ['Morph shape', 'Morph length', '300', 'Video size'].map((l, i) =>
                i === 2 ? stops[2]!.label : l,
              ),
            );
            for (let i = 1; i < stops.length; i++)
              assert.ok(
                stops[i]!.top >= stops[i - 1]!.top - 1,
                `${at}: Tab stop ${i} (${stops[i]!.label}) is not above the one before`,
              );
            // Contrast of every new text, and touch targets at phone width.
            for (const selector of [
              '#next-custom-frames-note',
              '#next-video-quality-note',
              'select[aria-label="Video size"]',
              'select[aria-label="Morph length"]',
              '.next-custom-frames input',
              '.next-custom-frames span',
            ]) {
              const ratio = await contrast(page, selector);
              assert.ok(ratio >= 4.5, `${at}: ${selector} contrast ${ratio.toFixed(2)}`);
            }
            if (touch)
              for (const selector of [
                'select[aria-label="Morph length"]',
                '.next-custom-frames input',
                'select[aria-label="Video size"]',
              ]) {
                const box = await page.locator(selector).boundingBox();
                assert.ok(box && box.height >= 44, `${at}: ${selector} is ${box?.height} px high`);
              }
            // A real pointer on Video size at its visible position.
            await operate('select[aria-label="Video size"]');
            await page.keyboard.press('Escape');
            const sideways = await page.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            );
            assert.ok(sideways <= 0, `${at}: page scrolls ${sideways} px sideways`);
            await page.locator('#next-overflow').scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(results, `${at}-settings.png`) });
            // The choice is remembered on this device.
            await page.reload();
            await page.locator('section.next-face').nth(1).waitFor();
            await page.getByRole('button', { name: 'More options' }).click(); // setup
            assert.equal(
              await page.locator('select[aria-label="Video size"]').inputValue(),
              'full',
            );
            assert.deepEqual(errors, []);
          } catch (error) {
            await page
              .screenshot({ path: join(results, `${at}-FAILED.png`), fullPage: true })
              .catch(() => {});
            throw error;
          } finally {
            await context.close();
          }
        }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);
