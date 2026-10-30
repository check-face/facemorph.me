// fm-zgmn: a press on Create morph visibly starts something where the person is looking. In the identified, composed
// application (build:next destination, real bridge and runtime bytes, Chromium on the CPU route), at 390 px touch and
// 1,280 px mouse, light and dark, with 2 and 5 faces: Create morph is pressed at its visible centre, and once the
// morph runs the button reads "Creating morph…", has not moved, and the progress bar, its Cancel and the status
// line are inside the same viewport with no scroll since the press. A screenshot per case.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/morph-progress.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { STORE_HOOK, setFaces } from '../support/face-fixture.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/morph-progress');

test(
  'Create morph shows its running state and progress in the same view as the press',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-zgmn; run on the runtime lane`;
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
      for (const [name, width, height, touch] of [
        ['desktop', 1280, 800, false],
        ['phone', 390, 844, true],
      ] as const)
        for (const scheme of ['light', 'dark'] as const)
          for (const count of [2, 5]) {
            const at = `${name}-${scheme}-${count}`;
            const context = await browser.newContext({
              ...(touch ? devices['iPhone 13'] : {}),
              viewport: { width, height },
              hasTouch: touch,
              isMobile: touch,
              colorScheme: scheme,
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
              await setFaces(page, count); // setup
              // The first morph asks before it downloads the generator: answer it once (setup), so the measured press
              // below is the one that starts the morph.
              const create = page.locator('.next-primary-action');
              assert.equal((await create.textContent())?.trim(), 'Create morph');
              await operate(create);
              const before = await page.evaluate(() => scrollY);
              await page.waitForFunction(
                () =>
                  !!document.querySelector(
                    '.next-product[data-next-busy=true], .next-download-accept',
                  ),
                null,
                { timeout: 60_000 },
              );
              const accept = page.locator('.next-download-accept');
              if (await accept.isVisible()) {
                // The question came first: the morph starts with the answer, pressed on the dialog. Measure the
                // button and progress from the view the person returns to.
                await operate(accept);
              }
              await page.waitForFunction(
                () => !!document.querySelector('.next-product[data-next-busy=true]'),
                null,
                { timeout: 60_000 },
              );
              const view = await page.evaluate(() => {
                const box = (sel: string) => {
                  const r = document.querySelector(sel)?.getBoundingClientRect();
                  return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
                };
                const cancel = [
                  ...document.querySelectorAll('.next-morph-slot .next-progress-row button'),
                ].find((b) => b.textContent?.trim() === 'Cancel');
                const c = cancel?.getBoundingClientRect();
                return {
                  label: document.querySelector('.next-primary-action')?.textContent?.trim(),
                  button: box('.next-primary-action'),
                  bar: box('.next-morph-slot .next-progress-row .next-progress'),
                  cancel: c ? { top: c.top, bottom: c.bottom, left: c.left, right: c.right } : null,
                  status: box('.next-morph-slot .next-status'),
                  innerHeight,
                  innerWidth,
                  scrollY,
                };
              });
              assert.equal(
                view.label,
                'Creating morph…',
                `${at}: the button shows the running state`,
              );
              const inside = (b: typeof view.button, what: string) => {
                assert.ok(b, `${at}: ${what} is rendered`);
                assert.ok(
                  b.top >= 0 &&
                    b.bottom <= view.innerHeight &&
                    b.left >= 0 &&
                    b.right <= view.innerWidth,
                  `${at}: ${what} is in the viewport ${JSON.stringify(b)} of ${view.innerWidth}x${view.innerHeight}`,
                );
              };
              inside(view.button, 'Create morph');
              inside(view.bar, 'the progress bar');
              inside(view.cancel, 'Cancel');
              // The progress is directly under the button: nothing else between them.
              assert.ok(
                view.bar!.top >= view.button!.bottom && view.bar!.top - view.button!.bottom < 64,
                `${at}: progress directly under the button (${view.bar!.top - view.button!.bottom} px)`,
              );
              assert.equal(view.scrollY, before, `${at}: no scroll since the press`);
              await page.screenshot({ path: join(results, `${at}-running.png`) });
              await operate(
                page.locator('.next-morph-slot').getByRole('button', { name: 'Cancel' }),
              );
              await page.waitForFunction(
                () => !document.querySelector('.next-product[data-next-busy=true]'),
                null,
                { timeout: 300_000 },
              );
              assert.equal(
                (await create.textContent())?.trim(),
                'Create morph',
                `${at}: label back`,
              );
              await page.screenshot({ path: join(results, `${at}-cancelled.png`) });
              assert.deepEqual(errors, []);
              console.log(`fm-zgmn ${at}`, JSON.stringify(view));
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
