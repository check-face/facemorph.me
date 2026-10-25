// Rendering/reducer-message qualification from plain inputs. No bridge, model, reporting or download is simulated.
// Actual controller/bridge effect execution is qualified separately in facade.e2e.ts.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import test, { before, after } from 'node:test';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { press } from '../support/operate.ts';
import { serve, type Served } from '../support/serve.ts';
import { operatedClick, StepLog } from '../verify/operated.ts';
import { bindOrigins, DEFAULT_HOST_MAP } from '../verify/artifact.ts';

const app = new URL('../../', import.meta.url);
const results = new URL('test-results/dialogs/', app);
const engines: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
let site: Served;
before(async () => {
  site = await serve(new URL('dist', app).pathname);
  mkdirSync(results, { recursive: true });
});
after(async () => {
  await site?.close();
});
const last = (page: Page, type: string) =>
  page.waitForSelector(`output[data-dialog-message="${type}"]`);

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
        const hit = async (control: ReturnType<Page['locator']>) =>
          assert.ok((await press(page, control, { touch })).inside);
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
        assert.equal(await names.locator('.next-name-choice').count(), 48);
        await shot('names');
        await hit(names.getByRole('button', { name: 'Show more', exact: true }));
        assert.equal(await names.locator('.next-name-choice').count(), 96);
        await last(page, 'MoreNames');
        const search = names.getByRole('textbox', { name: 'Search names' });
        await hit(search);
        await page.keyboard.type('no matching name '.repeat(20), { delay: 5 });
        assert.equal(await names.locator('.next-name-choice').count(), 0);
        await names.getByRole('status').waitFor();
        await shot('names-long-empty');
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        if (engine === 'chromium') {
          await page.evaluate(() => navigator.clipboard.writeText('Charlotte'));
          await page.keyboard.press('ControlOrMeta+V');
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLInputElement>('[aria-label="Search names"]')?.value ===
              'Charlotte',
          );
          assert.equal(await names.locator('.next-name-choice').count(), 13);
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
        }
        const more = names.getByRole('button', { name: 'Show more', exact: true });
        await more.focus();
        await page.keyboard.press('Tab');
        assert.equal(
          await names
            .getByRole('button', { name: 'Close', exact: true })
            .evaluate((e) => e === document.activeElement),
          true,
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(await more.evaluate((e) => e === document.activeElement), true);
        await page.keyboard.press('Escape');
        await names.waitFor({ state: 'detached' });
        await last(page, 'CloseNames');
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.waitFor();
        await page.goBack();
        await names.waitFor({ state: 'detached' });
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.waitFor();
        await hit(names.getByRole('button', { name: 'Close', exact: true }));
        await names.waitFor({ state: 'detached' });
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
          const controls = modal.locator(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
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
          assert.equal(await names.locator('.next-name-choice').count(), count);
          assert.equal(
            await names.locator('.next-name-panel').evaluate((e) => getComputedStyle(e).color),
            'rgb(255, 255, 255)',
          );
          await shot(`names-${count}`);
          await hit(names.getByRole('button', { name: 'Close', exact: true }));
          await names.waitFor({ state: 'detached' });
        }
        await open('namesFailed');
        await hit(page.getByRole('button', { name: 'Browse names', exact: true }));
        await names.getByRole('status').waitFor();
        assert.match((await names.getByRole('status').textContent()) ?? '', /could not be loaded/);
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
          assert.match((await gate.textContent()) ?? '', photo ? /1\.2 GB/ : /200 MB/);
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
        await hit(failure.getByRole('button', { name: 'Send report', exact: true }));
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
        await hit(page.getByRole('checkbox'));
        await last(page, 'Debug');
        assert.equal(
          await page.locator('output[data-debug-enabled]').getAttribute('data-debug-enabled'),
          'true',
        );
        await hit(page.getByRole('checkbox'));
        await last(page, 'Debug');
        for (const action of ['Turn on', 'No thanks', 'Ask me later']) {
          await open('firstVisit');
          const consent = page.locator('.next-consent-toast');
          await consent.waitFor();
          assert.equal(await page.locator('.next-model-toast, .next-failure-toast').count(), 0);
          await shot(`consent-${action.replaceAll(' ', '-')}`);
          await hit(consent.getByRole('button', { name: action, exact: true }));
          await last(page, action === 'Ask me later' ? 'DismissConsentPrompt' : 'Consent');
          await consent.waitFor({ state: 'detached' });
        }
        for (const action of ['Download · 200 MB', 'Plus photo encoder · 1.2 GB', 'Not now']) {
          await open();
          await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
          const model = page.locator('.next-model-toast');
          await model.waitFor();
          await shot('model-offer');
          await hit(model.getByRole('button', { name: action, exact: true }));
          await last(page, action === 'Not now' ? 'HideModelToast' : 'DownloadNow');
        }
        await open('phase=failed');
        await hit(page.getByRole('button', { name: 'Show model toast', exact: true }));
        await hit(
          page.locator('.next-model-toast').getByRole('button', { name: 'Try again', exact: true }),
        );
        await last(page, 'DownloadNow');
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
          /^https:\/\/github.com\/check-face\/facemorph.me\/issues\/new\?/,
        );
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
