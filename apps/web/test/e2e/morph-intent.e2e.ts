// fm-8w99: Morph is one current intent, operated in the identified, composed application (build:next destination,
// real bridge and runtime bytes, Chromium on the CPU route). At 2, 3, 8, 64 and 150 faces, at 1280 px (mouse) and
// 390 px (touch): Create morph is pressed at its visible centre after elementFromPoint shows it there, a repeated
// press while that morph runs starts nothing new (same job, nothing queued behind it), and Cancel stops it with no
// video. By-name clicks are setup only. A screenshot per case.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/morph-intent.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { STORE_HOOK, setFaces } from '../support/face-fixture.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/morph-intent');

type Model = {
  Busy: boolean;
  JobId: number;
  PendingMorph: boolean;
  PendingJobs: readonly unknown[];
  VideoUrl: string;
  Status: string;
};
const model = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
    return {
      Busy: m.Busy,
      JobId: m.JobId,
      PendingMorph: m.PendingMorph,
      pending: m.PendingJobs.length,
      VideoUrl: m.VideoUrl,
      Status: m.Status,
    };
  });

test(
  'Morph accept, a repeated press and Cancel at 2, 3, 8, 64 and 150 faces, at visible positions',
  { timeout: 3_600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-8w99; run on the runtime lane`;
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
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const)
        for (const count of [2, 3, 8, 64, 150]) {
          const at = `${name}-${count}`;
          const context = await browser.newContext({
            ...(touch ? devices['iPhone 13'] : {}),
            viewport: { width, height: 900 },
            hasTouch: touch,
            isMobile: touch,
            ignoreHTTPSErrors: true,
          });
          await context.addInitScript(`${INSTALL_HOOK}\n${STORE_HOOK}`);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const operate = async (control: Locator) =>
            assert.ok((await press(page, control, { touch })).inside, `${at}: ${control}`);
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
                await operate(control);
            await page.getByRole('button', { name: 'More options' }).click(); // setup
            await page.getByLabel('Processing mode').selectOption('cpu'); // setup
            await page.getByRole('button', { name: 'More options' }).click(); // setup: close
            // Setup: the faces through the controller (the 150-face strip is virtualised, so tiles are not all in the
            // DOM); words for most, seeds for every third.
            await setFaces(page, count);
            // Accept: Create morph at its visible centre; the download question (first use) is answered.
            const create = page.locator('.next-primary-action');
            await operate(create);
            await page.waitForFunction(
              () =>
                !!document.querySelector(
                  '.next-product[data-next-busy=true], .next-download-accept',
                ),
              null,
              { timeout: 60_000 },
            );
            const accept = page.locator('.next-download-accept');
            if (await accept.isVisible()) await operate(accept);
            await page.waitForFunction(
              () => !!document.querySelector('.next-product[data-next-busy=true]'),
              null,
              {
                timeout: 60_000,
              },
            );
            const running = await model(page);
            assert.equal(running.Busy, true, `${at}: accepted`);
            await page.screenshot({ path: join(results, `${at}-accepted.png`) });
            // A repeated press while that morph runs: the same job, nothing queued behind it. Create morph is
            // disabled while it runs (no pointer events), so the real press at its visible centre lands on the
            // morph controls' region around it; elementFromPoint shows that region there and the button disabled.
            await create.scrollIntoViewIfNeeded();
            const box = await create.boundingBox();
            assert.ok(box && box.width > 0 && box.height > 0, `${at}: Create morph is visible`);
            const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
            const hit = await create.evaluate(
              (el, [px, py]) => {
                const at = document.elementFromPoint(px as number, py as number);
                return {
                  disabled: (el as HTMLButtonElement).disabled,
                  region:
                    !!at && (el === at || el.contains(at) || at === el.closest('.next-morph-slot')),
                };
              },
              [cx, cy],
            );
            assert.deepEqual(
              hit,
              { disabled: true, region: true },
              `${at}: repeated press at Create morph`,
            );
            if (touch) await page.touchscreen.tap(cx, cy);
            else await page.mouse.click(cx, cy);
            await page.waitForTimeout(1000);
            const repeated = await model(page);
            assert.equal(repeated.JobId, running.JobId, `${at}: no second job`);
            assert.equal(repeated.PendingMorph, false, `${at}: no morph queued behind it`);
            assert.equal(repeated.pending, running.pending, `${at}: nothing added to the queue`);
            assert.notEqual(await create.innerText(), 'Morph queued');
            await page.screenshot({ path: join(results, `${at}-repeated.png`) });
            // Cancel, in the morph controls, at its visible centre.
            await operate(page.locator('.next-morph-slot').getByRole('button', { name: 'Cancel' }));
            await page.waitForFunction(
              () => !document.querySelector('.next-product[data-next-busy=true]'),
              null,
              { timeout: 300_000 },
            );
            const cancelled = await model(page);
            assert.equal(cancelled.VideoUrl, '', `${at}: no video after Cancel`);
            assert.equal(cancelled.PendingMorph, false);
            await page.screenshot({ path: join(results, `${at}-cancelled.png`) });
            assert.deepEqual(errors, []);
            console.log(`fm-8w99 ${at}`, JSON.stringify({ running, repeated, cancelled }));
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
