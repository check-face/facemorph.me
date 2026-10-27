// fm-qrfz: the real mounted Product previously threw React185 on the 53rd microtask-spaced Progressed.
// This is a controller/render fixture, with no model execution: state and ordinary subscribers must remain
// synchronous while React paints the latest progress, cancellation state and restored controls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import type { Store } from '../../src/controller/store.ts';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { STORE_HOOK } from '../support/face-fixture.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
type FixtureWindow = Window & { __fmStore: Store };

test(
  'mounted Product renders the latest microtask progress burst and cancellation without React185',
  {
    timeout: 120_000,
  },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    let browser;
    try {
      browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addInitScript(STORE_HOOK);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(ORIGIN);
      await page.waitForFunction(() => !!(window as unknown as FixtureWindow).__fmStore);
      // Controlled inputs must paint in their native event. Deferring these notifications lets React
      // restore an older value between Backspace events, so even deleting an entire word loses keys.
      const field = page.locator('section.next-face .next-field input').first();
      const original = await field.inputValue();
      await field.click();
      await page.keyboard.press('End');
      for (let i = 0; i < original.length + 2; i++) await page.keyboard.press('Backspace');
      const typed = 'native typing stays exact';
      await page.keyboard.type(typed, { delay: 1 });
      assert.equal(await field.inputValue(), typed, 'rapid native editing retains every key');
      assert.equal(
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__fmStore.getState().Inputs[0]!.value,
        ),
        typed,
      );
      const burst = await page.evaluate(async () => {
        const store = (window as unknown as FixtureWindow).__fmStore;
        let notifications = 0;
        let observed = '';
        const off = store.subscribe(() => {
          notifications++;
          observed = store.getState().Status;
        });
        try {
          store.update((state) => ({
            state: {
              ...state,
              Busy: true,
              JobId: 9001,
              ActiveFace: state.Inputs[0]!.id,
              ConsentPrompt: false,
            },
            effects: [],
          }));
          for (let i = 0; i < 300; i++) {
            const text = `Acquiring fixture ${i}`;
            store.dispatch({
              type: 'Progressed',
              args: [{ jobId: 9001, stage: 'models-download', text, fraction: i / 300 }],
            });
            if (store.getState().Status !== text || observed !== text)
              throw Error('Controller state and subscribers must update synchronously');
            await Promise.resolve();
          }
          return {
            notifications,
            status: store.getState().Status,
            fraction: store.getState().Fraction,
          };
        } finally {
          off();
        }
      });
      assert.deepEqual(burst, {
        notifications: 301,
        status: 'Acquiring fixture 299',
        fraction: 299 / 300,
      });
      await page.waitForFunction(
        () => document.querySelector('.next-tile-status')?.textContent === 'Acquiring fixture 299',
      );
      const downloads = await page.evaluate(async () => {
        const store = (window as unknown as FixtureWindow).__fmStore;
        let notifications = 0;
        const off = store.subscribe(() => notifications++);
        try {
          for (let i = 0; i < 300; i++) {
            store.dispatch({
              type: 'DownloadsChanged',
              args: [
                { ...store.getState().Downloads, phase: 'downloading', loaded: i, total: 300 },
              ],
            });
            if (store.getState().Downloads.loaded !== i || notifications !== i + 1)
              throw Error('Download state and ordinary subscribers must remain synchronous');
            await Promise.resolve();
          }
          return { notifications, loaded: store.getState().Downloads.loaded };
        } finally {
          off();
        }
      });
      assert.deepEqual(downloads, { notifications: 300, loaded: 299 });
      await page.waitForFunction(() => {
        const progress = document.querySelector('[aria-label="Model download progress"]');
        return Math.abs(Number(progress?.getAttribute('aria-valuenow')) - (299 / 300) * 100) < 0.1;
      });
      assert.equal(await page.getByLabel('Processing mode').isDisabled(), true);
      const operation = page.locator('section.next-face').first().locator('.next-face-operation');
      assert.equal(await operation.textContent(), 'Cancel');
      await operation.click();
      assert.equal(
        await page.evaluate(() => (window as unknown as FixtureWindow).__fmStore.getState().Stage),
        'cancelling',
      );
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('.next-face-operation');
        return button?.disabled && button.textContent === 'Cancelling';
      });
      // Settle the controller fixture as the cancelled operation would; this test starts no processing worker.
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).__fmStore.update((state) => ({
          state: {
            ...state,
            Busy: false,
            ActiveFace: null,
            Stage: 'done',
            Status: 'Cancelled fixture',
          },
          effects: [],
        })),
      );
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLSelectElement>('[aria-label="Processing mode"]')?.disabled ===
          false,
      );
      assert.equal(await operation.isEnabled(), true);
      assert.equal(await operation.textContent(), 'Generate');
      assert.deepEqual(errors, []);
      t.diagnostic(
        `artifact ${artifact.identity.deploySource.buildId}: 300 microtask updates, latest snapshot rendered, Cancel disabled then idle controls restored; no React errors`,
      );
    } finally {
      await browser?.close();
      await site.stop();
    }
  },
);
