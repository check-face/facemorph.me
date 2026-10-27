// fm-id4c: a real touch long-press leaves the tooltip open while native strip scrolling brings other
// controls under it. Labels must remain visible and accessible without intercepting image/Remove hits.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { serve } from '../support/serve.ts';

const app = new URL('../../', import.meta.url).pathname;
const built = process.env['FACEMORPH_DEPLOY_OUT'];
const directory = built ? join(built, 'deploy-next') : join(app, 'dist');

test(
  'open text tooltips preserve touch hit targets before and after native face-strip scrolling',
  {
    timeout: 60_000,
  },
  async (t) => {
    assert.ok(existsSync(join(directory, 'render-check.html')), 'run the application build first');
    const site = await serve(directory);
    let browser;
    try {
      browser = await chromium.launch();
      for (const [count, width, colorScheme] of [
        [8, 360, 'light'],
        [30, 320, 'dark'],
      ] as const) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          hasTouch: true,
          isMobile: true,
          colorScheme,
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(`${site.origin}/render-check.html?faces=${count}`);
          const tile = page.locator('[data-next-face="f0"]');
          const remove = tile.getByRole('button', { name: 'Remove Morph from', exact: true });
          await remove.scrollIntoViewIfNeeded();
          const box = await remove.boundingBox();
          assert.ok(box);
          const x = box.x + box.width / 2,
            y = box.y + box.height / 2;
          const cdp = await context.newCDPSession(page);
          let touching = false;
          try {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x, y }],
            });
            touching = true;
            const tooltip = page.getByRole('tooltip', { name: 'Remove Morph from', exact: true });
            await tooltip.waitFor({ state: 'visible' });
            const hits = await tile.evaluate((element) => {
              const image = element.querySelector('.next-face-image')!;
              const close = element.querySelector('.next-face-close')!;
              const imageBox = image.getBoundingClientRect();
              const closeBox = close.getBoundingClientRect();
              const hit = (target: Element, x: number, y: number) => {
                const top = document.elementFromPoint(x, y);
                return !!top && target.contains(top);
              };
              const inset = 0.5;
              return {
                image: hit(
                  image,
                  imageBox.x + imageBox.width / 2,
                  imageBox.y + imageBox.height / 2,
                ),
                corners: [
                  [closeBox.left + inset, closeBox.top + inset],
                  [closeBox.right - inset, closeBox.top + inset],
                  [closeBox.left + inset, closeBox.bottom - inset],
                  [closeBox.right - inset, closeBox.bottom - inset],
                ].map(([x, y]) => hit(close, x!, y!)),
                target: [closeBox.width, closeBox.height],
              };
            });
            assert.ok(hits.image, `${count}@${width}: an open Remove tooltip intercepts the image`);
            assert.deepEqual(hits.corners, [true, true, true, true]);
            assert.ok(hits.target.every((size) => size >= 44));
            assert.equal(await remove.getAttribute('aria-label'), 'Remove Morph from');
            // Move the held finger: a real compositor swipe cancels the Remove click and scrolls the strip.
            const before = await page
              .locator('[data-next-strip]')
              .evaluate((element) => element.scrollLeft);
            for (let step = 1; step <= 8; step++) {
              await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: x - ((x - 22) * step) / 8, y }],
              });
              await page.waitForTimeout(16);
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            touching = false;
            await page.waitForFunction(
              (before) => document.querySelector('[data-next-strip]')!.scrollLeft > before,
              before,
            );
            assert.equal(
              await page.locator('section.next-face').count(),
              count,
              'swiping does not remove a face',
            );
            assert.equal(
              await tooltip.evaluate((element) => getComputedStyle(element).pointerEvents),
              'none',
            );
          } finally {
            if (touching)
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
            await cdp.detach();
          }
          // Browse names uses the same text-tooltip policy, including in the dark palette.
          const browse = page
            .locator('[data-next-face="f1"]')
            .getByRole('button', { name: 'Browse names' });
          await browse.scrollIntoViewIfNeeded();
          const browseBox = await browse.boundingBox();
          assert.ok(browseBox);
          const touch = await context.newCDPSession(page);
          let browsing = false;
          try {
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [
                { x: browseBox.x + browseBox.width / 2, y: browseBox.y + browseBox.height / 2 },
              ],
            });
            browsing = true;
            const tooltip = page.getByRole('tooltip', { name: 'Browse names', exact: true });
            await tooltip.waitFor({ state: 'visible' });
            assert.equal(
              await tooltip.evaluate((element) => getComputedStyle(element).pointerEvents),
              'none',
            );
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            browsing = false;
            assert.equal(await browse.getAttribute('aria-label'), 'Browse names');
          } finally {
            if (browsing)
              await touch.send('Input.dispatchTouchEvent', {
                type: 'touchCancel',
                touchPoints: [],
              });
            await touch.detach();
          }
          assert.deepEqual(errors, []);
          t.diagnostic(
            `${count}@${width} ${colorScheme}: real long-press Remove/Browse tooltips, image + four44px corners hittable, native swipe preserved`,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  },
);
