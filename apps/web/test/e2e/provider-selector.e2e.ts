// fm-5kpx: the processing selector above the first +, operated in the identified build:next destination with the
// real bridge, workers and runtime, Chromium with WebGPU disabled (a real null adapter), at 1280 px (mouse) and
// 390 px (touch). The selector is pressed at its visible centre (elementFromPoint), above the first face; every
// option can be chosen and there is no WebGL option or Advanced section; on CPU a face is made with the CPU route
// caption and no WebGPU-only file is requested; while that job runs the selector is disabled, so the running job
// keeps the route it started with. A screenshot per case.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/provider-selector.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { routeAssets } from '../../src/Next/model-inventory.mjs';
import { press } from '../support/operate.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/provider-selector');
type Asset = { url: string; chunks?: { url: string }[] };
const paths = (assets: Asset[]) =>
  new Set(
    assets.flatMap((a) =>
      [a.url, ...(a.chunks ?? []).map((c) => c.url)].map((u) => new URL(u).pathname),
    ),
  );

test(
  'the processing selector above the faces: operated, every option, CPU on a null adapter, locked while busy',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-5kpx; run on the runtime lane`;
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
        const requested: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        context.on('request', (request) => requested.push(new URL(request.url()).pathname));
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
        try {
          const manifestResponse = page.waitForResponse('**/runtime/manifest.json');
          await page.goto(ORIGIN);
          const manifest = (await (await manifestResponse).json()) as Record<string, unknown>;
          const cpu = paths(routeAssets(manifest, 'cpu', 'ort') as Asset[]);
          const gpuOnly = [
            ...paths(routeAssets(manifest, 'webgpu', 'ort') as Asset[]),
            ...paths(routeAssets(manifest, 'webgpu', 'direct') as Asset[]),
          ].filter((p) => !cpu.has(p));
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

          // Above the faces, at its visible position; no Advanced section, no WebGL option.
          const select = page.getByLabel('Processing mode');
          await operate(select);
          await page.keyboard.press('Escape'); // close the native list the press opened
          const [box, first] = await Promise.all([
            select.boundingBox(),
            tiles.first().boundingBox(),
          ]);
          assert.ok(box && first && box.y + box.height <= first.y, `${name}: above the first face`);
          assert.equal(
            await page.locator('.next-advanced').count(),
            0,
            `${name}: no Advanced section`,
          );
          const options = await select
            .locator('option')
            .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
          assert.deepEqual(options, ['auto', 'cpu', 'webgpu'], `${name}: no WebGL option`);
          for (const value of options) {
            await select.selectOption(value);
            assert.equal(await select.inputValue(), value, `${name}: ${value} chosen`);
          }
          await page.screenshot({ path: join(results, `${name}-selector.png`) });

          // CPU on a real null adapter: a face is made on the CPU, and no WebGPU-only file is requested.
          await select.selectOption('cpu');
          await tiles.nth(0).locator('.next-field input').fill('selector cpu'); // setup
          await operate(tiles.nth(0).locator('.next-face-generate'));
          const accept = page.locator('.next-download-accept');
          if (
            await accept.waitFor({ timeout: 10_000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(accept);
          await page.waitForFunction(
            () => !!document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 60_000 },
          );
          assert.equal(await select.isDisabled(), true, `${name}: locked while the job runs`);
          await page.waitForFunction(
            () =>
              !!document.querySelector(
                'section.next-face[data-next-state="filled"] .next-face-img',
              ),
            null,
            { timeout: 600_000 },
          );
          await page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
          );
          assert.equal(await select.isDisabled(), false, `${name}: free again when idle`);
          assert.match(
            await page.locator('.next-route-caption').innerText(),
            /this device’s CPU/,
            `${name}: the face ran on the CPU route`,
          );
          const gpuRequested = requested.filter((p) => gpuOnly.includes(p));
          assert.deepEqual(gpuRequested, [], `${name}: no WebGPU-only file requested`);
          await page.screenshot({ path: join(results, `${name}-cpu-face.png`) });
          assert.deepEqual(errors, []);
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
