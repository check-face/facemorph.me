// fm-qrfz: the built app's model requests follow the person's decision. Cold profile, the identified build:next
// destination with the real bridge, workers and runtime bytes, Chromium on the CPU route, 1280 px (mouse) and 390 px
// (touch), controls pressed at their visible centres:
// - arrival, the open download question, and Cancel: zero model requests;
// - approval: only this route's files (the served manifest's routeAssets), never the photo detector or encoder;
// - a second Generate inside the approved scope asks nothing and still requests only route files.
// Requests are classed by path against the URLs (and chunk URLs) the served manifest gives this route's files.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/consent-requests.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { routeAssets } from '../../src/Next/model-inventory.mjs';
import { press } from '../support/operate.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/consent-requests');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;

/** The CPU choice, wherever this build keeps it (above the faces, or under More options › Advanced). */
async function chooseCpu(page: Page): Promise<void> {
  const select = page.getByLabel('Processing mode');
  if (!(await select.isVisible())) {
    await page.getByRole('button', { name: 'More options' }).click(); // setup
    const advanced = page.locator('.next-advanced');
    if (await advanced.count())
      await advanced.evaluate((e) => ((e as HTMLDetailsElement).open = true));
  }
  await select.selectOption('cpu'); // setup
}

test(
  'model requests follow the decision: none before approval or after Cancel, then only the route',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-qrfz; run on the runtime lane`;
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
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        const errors: string[] = [];
        const models: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (MODEL.test(path)) models.push(path);
        });
        // A worker's fetches are its own requests: count them too.
        context.on('request', (request) => {
          if (request.frame?.() === null) {
            const path = new URL(request.url()).pathname;
            if (MODEL.test(path) && !models.includes(path)) models.push(path);
          }
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
        try {
          const manifestResponse = page.waitForResponse('**/runtime/manifest.json');
          await page.goto(ORIGIN);
          const manifest = (await (await manifestResponse).json()) as Record<string, unknown>;
          // This route's files as the served manifest names them: each asset's URL and its chunks' URLs.
          type Asset = { url: string; chunks?: { url: string }[] };
          const route = new Set(
            (routeAssets(manifest, 'cpu', 'ort') as Asset[]).flatMap((a) =>
              [a.url, ...(a.chunks ?? []).map((c) => c.url)].map((u) => new URL(u).pathname),
            ),
          );
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
              await operate(control);
          await chooseCpu(page);
          await page.waitForTimeout(2000); // anything an arrival would fetch has had time to start
          assert.deepEqual(models, [], `${name}: no model request on arrival`);

          // The question is asked; while it is open, and after Cancel, nothing is fetched.
          await tiles.nth(0).locator('.next-field input').fill('consent first'); // setup
          await operate(tiles.nth(0).locator('.next-face-generate'));
          const dialog = page.locator('.next-download-dialog');
          await dialog.waitFor();
          await page.screenshot({ path: join(results, `${name}-asked.png`) });
          assert.deepEqual(models, [], `${name}: no model request while the question is open`);
          await operate(dialog.getByRole('button', { name: 'Cancel' }));
          await dialog.waitFor({ state: 'detached' });
          await page.waitForTimeout(2000);
          assert.deepEqual(models, [], `${name}: no model request after Cancel`);

          // Approval: the face is made from this route's files only.
          await operate(tiles.nth(0).locator('.next-face-generate'));
          await operate(page.locator('.next-download-accept'));
          await page.waitForFunction(
            () =>
              !!document.querySelector(
                'section.next-face[data-next-state="filled"] .next-face-img',
              ),
            null,
            { timeout: 600_000 },
          );
          const approved = [...models];
          assert.ok(approved.length > 0, `${name}: the approval fetched the face model`);
          const outside = approved.filter((p) => !route.has(p));
          assert.deepEqual(
            outside,
            [],
            `${name}: only this route's files after approving the face model`,
          );

          // A second Generate in the approved scope opens no question and stays inside the route.
          await tiles.nth(1).locator('.next-field input').fill('consent second'); // setup
          await operate(tiles.nth(1).locator('.next-face-generate'));
          const asked = await dialog.waitFor({ timeout: 3000 }).then(
            () => true,
            () => false,
          );
          assert.equal(asked, false, `${name}: no repeated question inside the approved scope`);
          await page.waitForFunction(
            () =>
              document.querySelectorAll(
                'section.next-face[data-next-state="filled"] .next-face-img',
              ).length >= 2,
            null,
            { timeout: 600_000 },
          );
          const later = models.filter((p) => !route.has(p));
          assert.deepEqual(later, [], `${name}: still only this route's files`);
          await page.screenshot({ path: join(results, `${name}-faces.png`) });
          assert.deepEqual(errors, []);
          console.log(
            `fm-qrfz ${name}`,
            JSON.stringify({ requested: models.length, routeFiles: route.size }),
          );
        } catch (error) {
          await page
            .screenshot({ path: join(results, `${name}-FAILED.png`), fullPage: true })
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
