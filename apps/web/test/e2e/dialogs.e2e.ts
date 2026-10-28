// Rendering/reducer-message qualification from plain inputs. No bridge, model, reporting or download is simulated.
// Actual controller/bridge effect execution is qualified separately in facade.e2e.ts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { downloadMegabytes as megabytes } from '../../src/controller/derived.ts';
import test, { before, after } from 'node:test';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { press } from '../support/operate.ts';
import { serve, type Served } from '../support/serve.ts';
import { operatedClick, StepLog } from '../verify/operated.ts';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';
import { bindOrigins, DEFAULT_HOST_MAP } from '../verify/artifact.ts';

const app = new URL('../../', import.meta.url);
const phoneCpuCheck = JSON.parse(
  readFileSync(new URL('test/fixtures/phone-cpu-check.json', app), 'utf8'),
);
const results = new URL('test-results/dialogs/', app);
const engines: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
let site: Served;
before(async () => {
  site = await serve(process.env['FACEMORPH_DIALOGS_BUILD'] ?? new URL('dist', app).pathname);
  mkdirSync(results, { recursive: true });
});
after(async () => {
  await site?.close();
});
const last = (page: Page, type: string) =>
  page.waitForSelector(`output[data-dialog-message="${type}"]`);

// fm-9kr8: batch rows and the narrow-width copy. With 1, 2, 3, 30, 64 and 150 photo faces the Encode row names the
// per-face and the batch estimate (labelled unknown with no measurement) and the modal stays inside a 320 px
// viewport with its decision reachable; at 320 px only the requested action's rows show, with no technical
// breakdown, and an inventory still being checked renders labelled unknown figures, still usable. Light and dark.
test('chromium: batch photo rows and the 320 px consent copy stay inside the modal', async () => {
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 320, height: 640 },
        hasTouch: true,
        isMobile: true,
        colorScheme,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      const technical = /sha|chunk|shard|wasm|onnx|manifest|webgpu|\bcpu\b|\bort\b|grant|bytes\b/i;
      const fits = async (gate: ReturnType<Page['locator']>, label: string) => {
        const outside = await gate.evaluate((root) => {
          const width = document.documentElement.clientWidth;
          return [...root.querySelectorAll<HTMLElement>('.next-crop-panel *')]
            .filter((el) => el.getClientRects().length > 0)
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.left < -0.5 || box.right > width + 0.5;
            })
            .map((el) => el.outerHTML.slice(0, 120));
        });
        assert.deepEqual(outside, [], `${colorScheme} ${label}: everything inside 320 px`);
        // Each bundle choice is one unbroken line: its radio never separates from its words.
        const broken = await gate.evaluate((root) =>
          [...root.querySelectorAll('fieldset label')]
            .filter((el) => el.getClientRects().length !== 1)
            .map((el) => el.textContent),
        );
        assert.deepEqual(broken, [], `${colorScheme} ${label}: bundle choices stay whole`);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= 320),
          true,
          `${colorScheme} ${label}: no horizontal page scroll`,
        );
        // The decision is reachable: each button, scrolled into view, is the element at its own centre.
        for (const name of ['Download and continue', 'Cancel']) {
          const control = gate.getByRole('button', { name, exact: true });
          await control.scrollIntoViewIfNeeded();
          assert.ok(
            await control.evaluate((el) => {
              const box = el.getBoundingClientRect();
              const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return !!at && (at === el || el.contains(at));
            }),
            `${colorScheme} ${label}: ${name} is reachable`,
          );
        }
      };
      for (const count of [1, 2, 3, 30, 64, 150]) {
        await page.goto(`${site.origin}/render-check.html?dialogs&photoFaces=${count}`);
        await page.getByRole('button', { name: 'Offer batch photo encoder', exact: true }).click(); // setup
        const gate = page.getByRole('dialog', { name: 'Download the photo encoder?' });
        await gate.waitFor();
        const encode = await gate.locator('[data-download-purpose="encode"]').innerText();
        assert.match(encode, /Encode time unknown per face/i, `${count}: per-face estimate`);
        assert.ok(
          encode
            .toLowerCase()
            .includes(
              `batch encode time unknown for ${count.toLocaleString('en-US')} ${count === 1 ? 'face' : 'faces'}`,
            ),
          `${count}: batch estimate: ${encode}`,
        );
        await fits(gate, `${count} photo faces`);
        if ([1, 150].includes(count))
          await page.screenshot({
            path: new URL(`batch-${count}-${colorScheme}.png`, results).pathname,
          });
      }
      // The requested action's rows only, no technical breakdown, at 320 px.
      for (const [trigger, rows] of [
        ['Offer face model', ['generate']],
        ['Offer photo encoder', ['generate', 'encode']],
      ] as const) {
        await page.goto(`${site.origin}/render-check.html?dialogs`);
        await page.getByRole('button', { name: trigger, exact: true }).click(); // setup
        const gate = page.locator('.next-download-dialog');
        await gate.waitFor();
        assert.deepEqual(
          await gate
            .locator('[data-download-purpose]')
            .evaluateAll((items) =>
              items.map((item) => item.getAttribute('data-download-purpose')),
            ),
          rows,
        );
        const text = await gate.locator('.next-crop-panel').innerText();
        assert.doesNotMatch(text, technical, `${colorScheme} ${trigger}: no technical breakdown`);
        await fits(gate, trigger);
      }
      // An inventory still being checked: labelled unknown, the decision still usable.
      await page.goto(`${site.origin}/render-check.html?dialogs&inventoryUnknown`);
      await page.getByRole('button', { name: 'Offer photo encoder', exact: true }).click(); // setup
      const unknown = page.locator('.next-download-dialog');
      await unknown.waitFor();
      for (const purpose of ['generate', 'encode'])
        assert.match(
          await unknown.locator(`[data-download-purpose="${purpose}"]`).innerText(),
          /Download size unknown; download time unknown/,
        );
      await page.screenshot({ path: new URL(`unknown-320-${colorScheme}.png`, results).pathname });
      await fits(unknown, 'unknown inventory');
      await press(
        page,
        unknown.getByRole('button', { name: 'Download and continue', exact: true }),
        {
          touch: true,
        },
      );
      await last(page, 'GateAccept');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
test('chromium: consent discloses a download exceeding the actual browser storage quota', async () => {
  for (const width of [1280, 390])
    for (const colorScheme of ['light', 'dark'] as const) {
      const touch = width === 390;
      const profile = await launchFreshChromiumProfile({
        viewport: { width, height: 900 },
        hasTouch: touch,
        isMobile: touch,
        colorScheme,
      });
      const context = profile.context;
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`${site.origin}/render-check.html?dialogs`);
        const storage = await page.evaluate(() => navigator.storage.estimate());
        const quota = storage.quota;
        assert.ok(typeof quota === 'number' && Number.isFinite(quota) && quota > 0);
        const bytes = quota + 1024 ** 2;
        assert.ok(quota - storage.usage! < bytes);
        await page.goto(`${site.origin}/render-check.html?dialogs&downloadBytes=${bytes}`);
        const opener = page.getByRole('button', { name: 'Offer face model', exact: true });
        await press(page, opener, { touch });
        const dialog = page.getByRole('dialog', { name: 'Download the face model?' });
        const warning = dialog.locator('.next-download-storage');
        await warning.waitFor();
        const amount = megabytes(bytes);
        assert.ok((await warning.innerText()).includes(amount));
        assert.match(await warning.innerText(), /downloaded again on each visit/);
        assert.ok(
          (await dialog.locator('[data-download-purpose="generate"]').innerText()).includes(amount),
        );
        assert.ok(
          await dialog.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth;
          }),
        );
        await page.screenshot({
          path: new URL(`storage-${width}-${colorScheme}.png`, results).pathname,
          fullPage: true,
        });
        await press(page, dialog.getByRole('button', { name: 'Cancel', exact: true }), { touch });
        await dialog.waitFor({ state: 'detached' });
        assert.ok(await opener.evaluate((element) => element === document.activeElement));
        assert.deepEqual(errors, []);
      } finally {
        await profile.close();
      }
    }
});

for (const [engine, type] of Object.entries(engines).filter(
  ([name]) => !only || only.includes(name),
)) {
  test(`${engine}: dialogs, keyboard focus, error/toast actions and support links at pointer/touch positions`, async () => {
    const browser = await type.launch();
    try {
      for (const width of [1280, 390]) {
        const touch = width === 390;
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch && engine !== 'firefox',
          ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const open = async (extra = '') => {
          await page.goto(`${site.origin}/render-check.html?dialogs&${extra}`);
          await page.getByRole('button', { name: 'Browse names', exact: true }).waitFor();
        };
        const hit = (() => {
          let tracing = false;
          let step = 0;
          const observe = () => {
            const w = window as unknown as { __target?: Element };
            const describe = (element: Element | null) => element?.outerHTML.slice(0, 800);
            const snapshot = () => ({
              now: performance.now(),
              expected: describe(w.__target ?? null),
              expectedConnected: w.__target?.isConnected,
              expectedBox: w.__target?.getBoundingClientRect().toJSON(),
              scroll: { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight },
              active: describe(document.activeElement),
            });
            const events: unknown[] = [];
            Object.assign(window, { __dialogsHit: { events, snapshot } });
            for (const name of ['pointerdown', 'pointerup', 'click'])
              document.addEventListener(
                name,
                (event) => {
                  const pointer = event as MouseEvent;
                  const target = event.target instanceof Element ? event.target : null;
                  const expected = w.__target;
                  if (events.length >= 250) events.shift();
                  events.push({
                    event: event.type,
                    trusted: event.isTrusted,
                    point: { x: pointer.clientX, y: pointer.clientY },
                    target: describe(target),
                    inside:
                      !!target && !!expected && (expected === target || expected.contains(target)),
                    atPoint: describe(document.elementFromPoint(pointer.clientX, pointer.clientY)),
                    ...snapshot(),
                  });
                },
                { capture: true, passive: true },
              );
          };
          return async (control: ReturnType<Page['locator']>) => {
            if (!tracing) {
              await context.tracing.start({ screenshots: true, snapshots: true });
              await context.addInitScript(observe);
              await page.evaluate(observe);
              tracing = true;
            }
            const currentStep = ++step;
            let landed: Awaited<ReturnType<typeof press>> | undefined;
            try {
              landed = await press(page, control, { touch });
              assert.ok(
                landed.inside,
                `${control}: real input landed outside the intended control`,
              );
            } catch (error) {
              const observation = await page.evaluate(() => {
                const probe = (
                  window as unknown as {
                    __dialogsHit?: { events: unknown[]; snapshot: () => unknown };
                  }
                ).__dialogsHit;
                return { events: probe?.events, after: probe?.snapshot() };
              });
              const prefix = `${engine}-${width}-hit-${currentStep}-failure`;
              const { writeFileSync } = await import('node:fs');
              writeFileSync(
                new URL(`${prefix}.json`, results),
                JSON.stringify(
                  { control: String(control), error: String(error), landed, observation },
                  null,
                  2,
                ) + '\n',
              );
              await page
                .screenshot({ path: new URL(`${prefix}.png`, results).pathname, fullPage: true })
                .catch(() => {});
              await context.tracing
                .stop({ path: new URL(`${prefix}-trace.zip`, results).pathname })
                .catch(() => {});
              throw error;
            }
          };
        })();
        const shot = (name: string) =>
          page.screenshot({
            path: new URL(`${engine}-${width}-${name}.png`, results).pathname,
            animations: 'disabled',
          });

        await open();
        assert.equal(
          await page.getByRole('button', { name: 'Generate faces', exact: true }).count(),
          0,
        );
        assert.equal(await page.locator('.next-invite').count(), 0);
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        const names = page.getByRole('dialog', { name: 'Browse names' });
        await names.waitFor();
        assert.ok(await names.evaluate((e) => e.contains(document.activeElement)));
        // fm-96if: headerless, searchless, windowed grid; names.e2e.ts qualifies it in depth.
        const rendered = await names.locator('.next-name-choice').count();
        assert.ok(rendered > 0 && rendered < 100, `windowed grid renders ${rendered} of 100`);
        assert.equal(await names.getByRole('textbox').count(), 0);
        assert.equal(await names.getByRole('heading').count(), 0);
        for (const label of ['Close', 'Show more'])
          assert.equal(await names.getByRole('button', { name: label, exact: true }).count(), 0);
        await shot('names');
        await page.keyboard.press('Tab');
        assert.ok(await names.evaluate((e) => e.contains(document.activeElement)));
        await page.keyboard.press('Shift+Tab');
        assert.ok(await names.evaluate((e) => e.contains(document.activeElement)));
        await page.keyboard.press('Escape');
        await names.waitFor({ state: 'detached' });
        await last(page, 'CloseNames');
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.waitFor();
        await page.goBack();
        await names.waitFor({ state: 'detached' });
        if (touch) {
          await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
          await names.waitFor();
          await hit(names.getByRole('button', { name: 'Back', exact: true }));
          await names.waitFor({ state: 'detached' });
        } else assert.equal(await page.locator('.next-names-back').count(), 0);
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.waitFor();
        await hit(names.locator('.next-name-choice').first());
        await last(page, 'ChooseName');
        await names.waitFor({ state: 'detached' });

        // Each modal traps Tab and closes by Escape and by actual browser Back, even when opened rapidly.
        for (const [trigger, label, closed] of [
          ['Crop photo', 'Encode an image', 'CropCancel'],
          ['Pick face', 'Which face?', 'DismissDetected'],
          ['Offer face model', 'Download the face model?', 'GateCancel'],
        ]) {
          await hit(page.getByRole('button', { name: trigger!, exact: true }));
          const modal = page.getByRole('dialog', { name: label!, exact: true });
          await modal.waitFor();
          // The same focusables the modal's Tab trap cycles, links included (the face-model offer's licence link).
          const controls = modal.locator(
            'a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          );
          await controls.first().focus();
          await page.keyboard.press('Shift+Tab');
          assert.equal(await controls.last().evaluate((e) => e === document.activeElement), true);
          await page.keyboard.press('Tab');
          assert.equal(await controls.first().evaluate((e) => e === document.activeElement), true);
          await page.keyboard.press('Escape');
          await modal.waitFor({ state: 'detached' });
          await last(page, closed!);
          await hit(page.getByRole('button', { name: trigger!, exact: true }));
          await modal.waitFor();
          await page.goBack();
          await modal.waitFor({ state: 'detached' });
        }
        for (const count of [1, 2, 3, 20]) {
          await open(`nameCount=${count}`);
          await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
          await names.waitFor();
          const shown = await names.locator('.next-name-choice').count();
          if (count <= 3) assert.equal(shown, count);
          else assert.ok(shown > 0 && shown <= count);
          assert.equal(
            await names
              .locator('.next-name-choice span')
              .first()
              .evaluate((e) => getComputedStyle(e).color),
            'rgb(255, 255, 255)',
          );
          await shot(`names-${count}`);
          if (touch) await hit(names.getByRole('button', { name: 'Back', exact: true }));
          else await page.keyboard.press('Escape');
          await names.waitFor({ state: 'detached' });
        }
        await open('namesFailed');
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.getByRole('alert').waitFor();
        assert.match((await names.getByRole('alert').textContent()) ?? '', /could not be loaded/);
        await shot('names-load-failed');
        await hit(names.getByRole('button', { name: 'Close', exact: true }));
        await names.waitFor({ state: 'detached' });

        await hit(page.getByRole('button', { name: 'Crop photo', exact: true }));
        const crop = page.getByRole('dialog', { name: 'Encode an image' });
        await crop.waitFor();
        await shot('crop-confirmation');
        await hit(crop.getByRole('button', { name: 'ADJUST CROP', exact: true }));
        await crop.getByRole('application', { name: 'Crop area' }).waitFor();
        await shot('crop-editor');
        assert.equal(
          await crop.getByRole('application').evaluate((e) => e === document.activeElement),
          true,
        );
        const background = await crop
          .locator('.next-crop-panel')
          .evaluate((e) => getComputedStyle(e).backgroundColor);
        assert.notEqual(background, 'rgba(0, 0, 0, 0)');
        await page.keyboard.press('ArrowLeft');
        await last(page, 'CropPan');
        await operatedClick(page, crop.getByRole('slider', { name: 'Zoom' }), {
          step: 'dialogs/crop/zoom',
          activation: 'range-input',
          touch,
          settleMs: 100,
          log: new StepLog({ map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }) }),
          region: { within: crop },
          effect: () => last(page, 'CropZoom'),
        });
        await last(page, 'CropZoom');
        await hit(crop.getByRole('button', { name: 'Rotate', exact: true }));
        await last(page, 'CropRotate');
        await hit(crop.getByRole('button', { name: 'Use Crop', exact: true }));
        await last(page, 'CropUse');
        await crop.getByRole('button', { name: 'OK', exact: true }).waitFor();
        await hit(crop.getByRole('button', { name: 'OK', exact: true }));
        await last(page, 'CropAccept');
        await crop.waitFor({ state: 'detached' });
        await hit(page.getByRole('button', { name: 'Crop photo', exact: true }));
        await crop.waitFor();
        await hit(crop.getByRole('button', { name: 'CANCEL', exact: true }));
        await last(page, 'CropCancel');
        await crop.waitFor({ state: 'detached' });

        for (const n of [1, 2, 3, 20]) {
          await open(`faces=${n}`);
          await hit(page.getByRole('button', { name: 'Pick face', exact: true }));
          const picker = page.getByRole('dialog', { name: 'Which face?' });
          await picker.waitFor();
          assert.equal(await picker.getByRole('button', { name: /Choose face/ }).count(), n);
          await shot(`picker-${n}`);
          await hit(picker.getByRole('button', { name: `Choose face ${n}`, exact: true }));
          await last(page, 'ChooseDetected');
          await picker.waitFor({ state: 'detached' });
        }
        await hit(page.getByRole('button', { name: 'Pick face', exact: true }));
        await hit(
          page
            .getByRole('dialog', { name: 'Which face?' })
            .getByRole('button', { name: 'Cancel', exact: true }),
        );
        await last(page, 'DismissDetected');
        for (const photo of [false, true]) {
          await hit(
            page.getByRole('button', {
              name: photo ? 'Offer photo encoder' : 'Offer face model',
              exact: true,
            }),
          );
          const gate = page.getByRole('dialog', {
            name: photo ? 'Download the photo encoder?' : 'Download the face model?',
          });
          await gate.waitFor();
          assert.ok(
            (await gate.locator('[data-download-purpose="generate"]').innerText()).includes(
              megabytes(phoneCpuCheck.cpuPackageBytes),
            ),
          );
          assert.equal(
            await gate.locator('[data-download-purpose="encode"]').count(),
            photo ? 1 : 0,
          );
          if (photo)
            assert.ok(
              (await gate.locator('[data-download-purpose="encode"]').innerText()).includes(
                megabytes(1024 ** 3),
              ),
            );
          // Selecting a bundle changes only the explanation, never approves a download.
          const lastBeforeChoice = await page
            .locator('output[data-dialog-message]')
            .getAttribute('data-dialog-message');
          await hit(gate.getByRole('radio', { name: 'Generate', exact: true }));
          assert.equal(await gate.locator('[data-download-purpose="encode"]').count(), 0);
          if (photo) assert.match(await gate.innerText(), /Encoding needs the photo encoder/);
          await hit(gate.getByRole('radio', { name: 'Generate and encode', exact: true }));
          assert.equal(await gate.locator('[data-download-purpose="encode"]').count(), 1);
          assert.equal(
            await page.locator('output[data-dialog-message]').getAttribute('data-dialog-message'),
            lastBeforeChoice,
          );
          if (!photo) await hit(gate.getByRole('radio', { name: 'Generate', exact: true }));
          await shot(photo ? 'download-photo' : 'download-face');
          await hit(gate.getByRole('button', { name: 'Cancel', exact: true }));
          await last(page, 'GateCancel');
          await gate.waitFor({ state: 'detached' });
          await hit(
            page.getByRole('button', {
              name: photo ? 'Offer photo encoder' : 'Offer face model',
              exact: true,
            }),
          );
          await gate.waitFor();
          await hit(gate.getByRole('button', { name: 'Download and continue', exact: true }));
          await last(page, 'GateAccept');
          await gate.waitFor({ state: 'detached' });
        }

        await open();
        await hit(page.getByRole('button', { name: 'Show error', exact: true }));
        const failure = page.locator('.next-failure-toast');
        await failure.waitFor();
        await shot('error-toast');
        await hit(failure.getByRole('button', { name: 'Send this report', exact: true }));
        await last(page, 'DismissFailureToast');
        assert.equal(
          await page.locator('output[data-debug-enabled]').getAttribute('data-debug-enabled'),
          'false',
        );
        await hit(
          page.locator('.next-error').getByRole('button', { name: 'Try again', exact: true }),
        );
        await last(page, 'Retry');
        await open();
        await hit(page.getByRole('button', { name: 'Show error', exact: true }));
        await hit(
          page.locator('.next-failure-toast').getByRole('button', { name: 'Not now', exact: true }),
        );
        await hit(
          page
            .locator('.next-error')
            .getByRole('button', { name: 'Send this report', exact: true }),
        );
        await last(page, 'SendReportOnce');
        await hit(
          page.locator('.next-error').getByRole('button', { name: 'Dismiss', exact: true }),
        );
        await last(page, 'DismissError');
        // The debug-report disclosure (fm-szbf): its summary opens it, then its own checkbox.
        await hit(page.locator('#debug-reporting > summary'));
        const debugBox = page.locator('#debug-reporting').getByRole('checkbox');
        await hit(debugBox);
        await last(page, 'Debug');
        assert.equal(
          await page.locator('output[data-debug-enabled]').getAttribute('data-debug-enabled'),
          'true',
        );
        await hit(debugBox);
        await last(page, 'Debug');
        for (const action of ['Turn on debug reporting', 'No thanks', 'Ask me later']) {
          await open('firstVisit');
          const consent = page.locator('.next-consent-toast');
          await consent.waitFor();
          assert.equal(await page.locator('.next-model-toast, .next-failure-toast').count(), 0);
          await shot(`consent-${action.replaceAll(' ', '-')}`);
          await hit(consent.getByRole('button', { name: action, exact: true }));
          await last(page, action === 'Ask me later' ? 'DismissConsentPrompt' : 'Consent');
          await consent.waitFor({ state: 'detached' });
        }
        await open();
        await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
        assert.equal(await page.locator('.next-model-toast').count(), 0, 'no proactive idle offer');
        await shot('no-idle-model-offer');
        // Try again resumes the failed download's own scope: a failed face-model download never approves the
        // photo encoder that is merely available (fm-9kr8); a failed photo-encoder download retries it.
        for (const [scope, includePhoto] of [
          ['route', false],
          ['photo', true],
        ] as const) {
          await open(`phase=failed&scope=${scope}`);
          await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
          await hit(
            page
              .locator('.next-model-toast')
              .getByRole('button', { name: 'Try again', exact: true }),
          );
          await last(page, 'DownloadNow');
          assert.deepEqual(
            JSON.parse((await page.locator('output[data-dialog-message]').textContent()) ?? '')
              .args,
            [includePhoto],
            `failed ${scope} download retries only its scope`,
          );
        }
        await open('phase=done');
        await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
        await page.locator('.next-model-toast').waitFor();
        await page.locator('.next-model-toast').waitFor({ state: 'detached', timeout: 8000 });
        await last(page, 'HideModelToast');
        await open('phase=done');
        await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
        await hit(
          page.locator('.next-model-toast').getByRole('button', { name: 'Hide', exact: true }),
        );
        await last(page, 'HideModelToast');
        await open('testing');
        await page.locator('.next-invite').waitFor();
        await shot('testing-invite');
        await hit(
          page.locator('.next-invite').getByRole('button', { name: 'Not now', exact: true }),
        );
        await last(page, 'DismissInvite');
        await hit(page.getByRole('button', { name: 'Generate faces', exact: true }));
        await last(page, 'Run');
        await open();
        for (const link of [
          page.locator('footer a[href^="mailto:"]'),
          page.locator('.next-debug a[href^="mailto:"]'),
        ])
          assert.match((await press(page, link, { touch, follow: false })).href ?? '', /^mailto:/);
        const navigations: string[] = [];
        await context.route('https://github.com/**', (route) => {
          navigations.push(route.request().url());
          return route.abort();
        });
        const popup = context.waitForEvent('page');
        const navigation = context.waitForEvent('requestfailed', (request) =>
          request.url().startsWith('https://github.com/'),
        );
        await hit(page.locator('footer a[href*="issues/new"]'));
        await popup;
        await navigation;
        assert.equal(navigations.length, 1);
        assert.match(
          navigations[0] ?? '',
          /^https:\/\/github.com\/facemorph-me\/facemorph.me\/issues\/new\?/,
        );
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
