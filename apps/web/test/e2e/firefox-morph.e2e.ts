// fm-qa3q: a morph completes in Firefox. Firefox's WebCodecs encoder holds every output until flush(),
// which once left the video writer waiting on encoded output forever: the frames stalled a few in and the
// runtime's stall watchdog ended the job ("Generation stopped responding").
// Then Firefox's demuxer refused the muxed MP4 itself ("Parse MP4 metadata failed": a malformed tkhd
// and a dref outside dinf), so the video element never loaded. Real Firefox (Playwright),
// CPU route, the identified build:next destination served over TLS on localhost, real inference.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { firefox } from 'playwright';
import { startControl, PORT, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/firefox-morph');

test('a morph completes in Firefox with a playable MP4', { timeout: 1_800_000 }, async (t) => {
  if (!existsSync(join(runtime, 'manifest.json'))) {
    const reason = `untested: no acquired runtime at ${runtime}; owner fm-qa3q; run on the runtime lane`;
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
  const browser = await firefox.launch();
  mkdirSync(results, { recursive: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(INSTALL_HOOK);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`https://localhost:${PORT}/`);
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
    await tiles.nth(0).locator('.next-input-row .next-face-generate').click();
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
        document.querySelectorAll('section.next-face')[0]?.getAttribute('data-next-state') ===
        'filled',
      null,
      { timeout: 300_000 },
    );
    await page.waitForFunction(() => !document.querySelector('.next-product[data-next-busy=true]'));
    await page.locator('.next-primary-action').click();
    const began = Date.now();
    const ticker = setInterval(() => {
      void page
        .evaluate(() => {
          const m = (
            window as unknown as {
              __elmish: { model: { Status: string; Stage: string } };
            }
          ).__elmish.model;
          return `${m.Stage} ${m.Status}`;
        })
        .then((status) =>
          console.log(`fm-qa3q morph t+${Math.round((Date.now() - began) / 1000)}s ${status}`),
        )
        .catch(() => {});
    }, 15_000);
    t.after(() => clearInterval(ticker));
    await page.waitForFunction(
      () => {
        const model = (
          window as unknown as {
            __elmish: { model: { VideoUrl: string; Error: string | null } };
          }
        ).__elmish.model;
        return !!model.VideoUrl || model.Error !== null;
      },
      null,
      { timeout: 1_500_000 },
    );
    clearInterval(ticker);
    const error = await page.evaluate(
      () =>
        (
          window as unknown as {
            __elmish: { model: { Error: string | null } };
          }
        ).__elmish.model.Error,
    );
    assert.equal(error, null, `the morph failed: ${error}`);
    const video = page.locator('video').first();
    await video.waitFor();
    const playable = await video.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<{ duration: number; width: number }>((ok, fail) => {
          const done = () => ok({ duration: v.duration, width: v.videoWidth });
          // A refused file has already fired 'error' by now; waiting for it would hang the test.
          if (v.error) fail(Error(`the MP4 does not decode: ${v.error.message}`));
          else if (v.readyState >= 2) done();
          else {
            v.addEventListener('loadeddata', done, { once: true });
            v.addEventListener('error', () => fail(Error('the MP4 does not decode')), {
              once: true,
            });
          }
        }),
    );
    assert.ok(playable.duration > 0 && playable.width > 0, JSON.stringify(playable));
    await page.screenshot({ path: join(results, 'morph.png') });
    console.log('fm-qa3q firefox morph', JSON.stringify(playable));
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: join(results, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await site.stop();
  }
});
