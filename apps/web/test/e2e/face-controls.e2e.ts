// fm-25um: operated controls in the identified, composed application, with real CPU synthesis.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/face-controls');

test(
  'composed tile validation, exact values, Enter, Cancel and Retry at visible positions',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-25um; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
        });
        // Omit DOM snapshots and source files: runtime model responses can otherwise make traces enormous.
        await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
        await context.addInitScript(INSTALL_HOOK);
        const page = await context.newPage();
        const errors: string[] = [];
        const modelRequests: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (/^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(path))
            modelRequests.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside);
        const shot = async (caseName: string) =>
          page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: true });
        const replace = async (field: Locator, value: string) => {
          await operate(field);
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText(value);
          assert.equal(await field.inputValue(), value);
        };
        const idle = async () =>
          page.waitForFunction(
            () => !document.querySelector('.next-product[aria-busy=true]'),
            null,
            { timeout: 180_000 },
          );
        try {
          await page.goto(ORIGIN);
          await page.locator('section.next-face').nth(1).waitFor();
          for (const control of [
            page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
            page.getByRole('button', { name: 'Ask me later' }),
          ]) {
            if (
              await control.waitFor({ timeout: 5000 }).then(
                () => true,
                () => false,
              )
            )
              await operate(control);
          }
          await operate(page.getByRole('button', { name: 'More options' }));
          await operate(page.getByText('Advanced', { exact: true }));
          await page.getByLabel('Processing mode').selectOption('cpu');
          const tile = page.locator('section.next-face').nth(1);
          const field = tile.locator('.next-field input');
          for (const [attribute, value] of [
            ['autocapitalize', 'off'],
            ['autocorrect', 'off'],
            ['spellcheck', 'false'],
          ])
            assert.equal(await field.getAttribute(attribute!), value);
          const mode = async (label: string) => {
            await operate(tile.getByRole('button', { name: 'Change mode' }));
            await operate(page.getByRole('menuitem', { name: label, exact: true }));
          };
          await mode('Numeric seed');
          for (const value of ['0', '4294967295', '-1', '1.5', '4294967296', '', ' 42 ']) {
            await replace(field, value);
            assert.equal(
              await tile.locator('.next-face-generate').isDisabled(),
              !['0', '4294967295'].includes(value),
              value,
            );
            await shot(`seed-${value.replace(/\W/g, '_') || 'empty'}`);
          }
          await mode('Name or words');
          for (const [caseName, value, valid] of [
            ['empty', '', false],
            ['whitespace', '   ', false],
            ['512-bytes', 'é'.repeat(256), true],
            ['513-bytes', 'a'.repeat(513), false],
            ['lowercase', 'hello', true],
          ] as const) {
            await replace(field, value);
            assert.equal(await tile.locator('.next-face-generate').isDisabled(), !valid, caseName);
            await shot(caseName);
          }
          assert.deepEqual(modelRequests, [], 'typing and invalid Generate acquire no model');
          await operate(field);
          await page.keyboard.press('Enter');
          const download = page.locator('.next-download-accept');
          if (
            await download.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(download);
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 180_000 },
          );
          await idle();
          assert.match(await page.locator('.next-route-caption').innerText(), /CPU/);
          assert.equal(
            await tile.locator('.next-face-generate').count(),
            0,
            'verified result has no Generate',
          );
          assert.equal(await page.locator('.next-compare, .next-file').count(), 0);
          await shot('generated');
          await replace(field, 'cancel this exact input');
          assert.notEqual(
            await tile.getAttribute('data-next-state'),
            'filled',
            'edit clears the old result',
          );
          const action = tile.locator('.next-face-image .next-face-generate');
          await operate(action);
          await page.waitForFunction(
            () =>
              document
                .querySelectorAll('section.next-face')[1]
                ?.querySelector('.next-tile-status')
                ?.textContent?.trim() === 'Generating…',
            null,
            { timeout: 180_000 },
          );
          await operate(action);
          const stopping = (await action.textContent())?.trim();
          if (stopping === 'Cancelling') assert.equal(await action.isDisabled(), true);
          else {
            // CPU worker termination can settle before the pointer action returns.
            // An enabled Retry is truthful only after the real operation has settled.
            assert.equal(stopping, 'Retry');
            assert.equal(await page.evaluate('window.__elmish.model.Busy'), false);
          }
          await page.waitForFunction(
            () =>
              document
                .querySelectorAll('section.next-face')[1]
                ?.querySelector('.next-face-generate')
                ?.textContent?.trim() === 'Retry',
            null,
            { timeout: 180_000 },
          );
          assert.equal(await field.inputValue(), 'cancel this exact input');
          await shot('retry');
          await operate(action);
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 180_000 },
          );
          await idle();
          await shot('retried');
          assert.deepEqual(errors, []);
        } catch (error) {
          await shot('failure').catch(() => {});
          throw error;
        } finally {
          await context.tracing.stop({ path: join(results, `${name}-trace.zip`) });
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);
