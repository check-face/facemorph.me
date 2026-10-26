// fm-vbj7 (defect 15): with the models cached and the network off, a new face still completes, and the
// job makes zero network requests. The identified build:next destination with the real bridge and runtime.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/offline');

test(
  'a cached-model face completes offline with zero network requests',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-vbj7; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript(INSTALL_HOOK);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(ORIGIN);
      const tiles = page.locator('section.next-face');
      await tiles.nth(1).waitFor();
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
      await page.getByText('Advanced', { exact: true }).click(); // setup
      await page.getByLabel('Processing mode').selectOption('cpu');
      const generate = async (index: number, words: string) => {
        const field = tiles.nth(index).locator('.next-field input');
        await field.fill(words);
        await tiles.nth(index).locator('.next-input-row .next-face-generate').click();
        const consent = page.locator('.next-download-accept');
        if (
          await consent.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        )
          await consent.click();
        await page.waitForFunction(
          (i) =>
            document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state') ===
            'filled',
          index,
          { timeout: 240_000 },
        );
      };
      // Online once: the models are acquired and cached.
      await generate(0, 'online first face');
      await page.waitForFunction(
        () => !document.querySelector('.next-product[data-next-busy=true]'),
      );
      // Network off: every request from now on is recorded and fails.
      const offline: string[] = [];
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) offline.push(request.url());
      });
      await context.setOffline(true);
      await generate(1, 'a new face with the network off');
      await page.screenshot({ path: join(results, 'offline-face.png') });
      assert.equal(await page.locator('.next-error').count(), 0, 'no failure shown');
      assert.deepEqual(offline, [], 'the cached job makes zero network requests');
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: join(results, 'failure.png'), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
      await site.stop();
    }
  },
);

test(
  'a genuinely missing asset offline settles with a typed failure and Retry, never "engine stopped"',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-vbj7; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    // A fresh profile: nothing is cached, so the model assets are genuinely missing once offline.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript(INSTALL_HOOK);
    const page = await context.newPage();
    try {
      await page.goto(ORIGIN);
      const tiles = page.locator('section.next-face');
      await tiles.nth(1).waitFor();
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
      await page.getByText('Advanced', { exact: true }).click(); // setup
      await page.getByLabel('Processing mode').selectOption('cpu');
      await context.setOffline(true);
      await tiles.nth(1).locator('.next-field input').fill('missing assets offline');
      await tiles.nth(1).locator('.next-input-row .next-face-generate').click();
      const consent = page.locator('.next-download-accept');
      if (
        await consent.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await consent.click();
      await page.waitForFunction(
        () =>
          !document.querySelector('.next-product[data-next-busy=true]') &&
          (window as unknown as { __elmish: { model: { Error: string | null } } }).__elmish.model
            .Error !== null,
        null,
        { timeout: 240_000 },
      );
      const state = await page.evaluate(() => {
        const model = (
          window as unknown as { __elmish: { model: { Error: string; LastRun: unknown } } }
        ).__elmish.model;
        return { error: model.Error, retry: model.LastRun !== null };
      });
      await page.screenshot({ path: join(results, 'missing-asset.png') });
      assert.doesNotMatch(state.error, /engine stopped/i, 'never the generic engine-stopped error');
      assert.equal(state.retry, true, 'Retry is offered for the same request');
      assert.equal(await page.locator('.next-error-retry').count(), 1);
      console.log('fm-vbj7 missing-asset offline failure:', JSON.stringify(state.error));
    } finally {
      await context.close();
      await browser.close();
      await site.stop();
    }
  },
);
