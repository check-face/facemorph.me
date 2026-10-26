// fm-qh1s: operate the real built result controls, with an actual worker HTTP503,
// retained pixels, and no fabricated browser/runtime outcomes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { press } from '../support/operate.ts';
import { typeMatchesBytes } from '../../src/media/export-policy.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/ci-runtime');
const artifactRoot = process.env['FACEMORPH_RESULT_ARTIFACT'] ?? REPO;
const out = join(REPO, 'apps/web/test-results/result-actions');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const suffix = (name: string) => name.slice(name.lastIndexOf('-'));

test(
  'prepared result actions: actual file delay/failure/retry, formats, names, reload and video at both widths',
  { timeout: 900_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: acquired real runtime absent at ${runtime}; owner fm-qh1s`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(artifactRoot);
    assert.deepEqual(artifact.findings, []);
    mkdirSync(out, { recursive: true });
    const faultFile = join(out, 'http-fault.json');
    rmSync(faultFile, { force: true });
    const assets = join(artifactRoot, 'deploy-next/assets');
    const worker = readdirSync(assets).find((name) => /^image-encoder-worker-.*\.js$/.test(name));
    assert.ok(worker, 'actual built image encoder worker');
    const site = await startControl({
      runtime,
      artifact: join(artifactRoot, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
      faultFile,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    const evidence: unknown[] = [];
    try {
      for (const width of [1280, 390]) {
        const context = await browser.newContext({
          ...(width === 390 ? devices['Pixel 7'] : {}),
          viewport: { width, height: 900 },
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
        });
        await context.addInitScript(() => {
          // Observe real inference dispatches; cached weights alone do not prove zero inference.
          const calls: string[] = [];
          Object.defineProperty(window, '__resultInference', { value: calls });
          const native = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (
            this: Worker,
            ...args: Parameters<Worker['postMessage']>
          ) {
            const message = args[0] as { type?: string } | null;
            if (
              message &&
              ['generate', 'synthesize', 'morph', 'encode-aligned'].includes(message.type ?? '')
            )
              calls.push(message.type!);
            return Reflect.apply(native, this, args);
          } as Worker['postMessage'];
        });
        const page = await context.newPage();
        const inferenceCalls = () =>
          page.evaluate(
            () => (window as unknown as { __resultInference: string[] }).__resultInference.length,
          );
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const modelRequests: string[] = [];
        page.on('request', (request) => {
          if (
            /^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(
              new URL(request.url()).pathname,
            )
          )
            modelRequests.push(request.url());
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch: width === 390 })).inside);
        const shot = async (name: string) =>
          page.screenshot({ path: join(out, `${width}-${name}.png`), fullPage: true });
        try {
          await page.goto(ORIGIN);
          const tiles = page.locator('section.next-face');
          await tiles.nth(1).waitFor();
          for (const control of [
            page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
            page.getByRole('button', { name: 'Ask me later' }),
          ]) {
            if (await control.isVisible()) await operate(control);
          }
          const tile = tiles.nth(1);
          const field = tile.locator('.next-field input');
          await operate(field);
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText('Emma');
          await operate(tile.locator('.next-face-generate'));
          const approval = page.locator('.next-download-accept');
          if (
            await approval.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(approval);
          const save = tile.getByRole('button', { name: 'Save image', exact: true });
          await save.waitFor({ timeout: 180_000 });
          await page.waitForFunction(
            () =>
              !(
                document
                  .querySelectorAll('section.next-face')[1]
                  ?.querySelector('.next-face-actions button') as HTMLButtonElement
              )?.disabled,
            null,
            { timeout: 180_000 },
          );
          const download = async (control: Locator, label: string) => {
            await page.waitForFunction(
              (element) => !(element as HTMLButtonElement).disabled,
              await control.elementHandle(),
              { timeout: 60_000 },
            );
            assert.ok(
              await control.evaluate((element) => {
                const area = element.closest('.next-actions');
                const box = element.getBoundingClientRect();
                const parent = area?.getBoundingClientRect();
                return parent && box.left >= parent.left - 1 && box.right <= parent.right + 1;
              }),
              'visible action wraps inside its result area',
            );
            const waiting = page.waitForEvent('download');
            await operate(control);
            const file = await waiting;
            const path = join(out, `${width}-${label}-${file.suggestedFilename()}`);
            await file.saveAs(path);
            return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
          };
          const initial = await download(save, 'initial');
          assert.ok(
            typeMatchesBytes(initial.bytes, { mime: 'image/webp', filename: initial.name }),
          );
          const beforeFormats = modelRequests.length;
          const beforeInference = await inferenceCalls();
          writeFileSync(
            faultFile,
            JSON.stringify({ path: '/assets/' + worker, delaySeconds: 5, status: 503 }),
          );
          const failedResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/assets/' + worker && response.status() === 503,
          );
          await operate(tile.getByLabel('Image format'));
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          const pending = tile.getByRole('button', { name: /Preparing file/ });
          await pending.waitFor();
          assert.ok(await pending.isDisabled());
          assert.ok(await save.isDisabled());
          assert.ok(await tile.locator('canvas[role=img],img.next-face-img').isVisible());
          await shot('preparing-file');
          await failedResponse;
          const retry = tile.getByRole('button', { name: /Retry file preparation/ });
          await retry.waitFor();
          assert.ok(await save.isDisabled());
          await shot('file-failed');
          rmSync(faultFile, { force: true });
          await operate(retry);
          await page.waitForFunction(
            () =>
              !(
                document
                  .querySelectorAll('section.next-face')[1]
                  ?.querySelector('.next-face-actions button') as HTMLButtonElement
              )?.disabled,
            null,
            { timeout: 60_000 },
          );
          const png = await download(save, 'png-retry');
          assert.ok(typeMatchesBytes(png.bytes, { mime: 'image/png', filename: png.name }));
          await operate(tile.getByLabel('Image format'));
          await page.keyboard.press('Home');
          await page.keyboard.press('Enter');
          const again = await download(save, 'webp-again');
          assert.equal(hash(again.bytes), hash(initial.bytes));
          assert.equal(again.name, initial.name);
          assert.equal(
            modelRequests.length,
            beforeFormats,
            'format/failure/retry never infer or acquire models',
          );
          assert.equal(
            await inferenceCalls(),
            beforeInference,
            'format/failure/retry dispatch zero inference',
          );
          const filename = tile.getByLabel('Image filename');
          for (const name of ['', 'a'.repeat(200), 'path/to\\face\u202ename.webp']) {
            await operate(filename);
            await page.keyboard.press('Control+A');
            if (name.includes('path/')) {
              await context.grantPermissions(['clipboard-read', 'clipboard-write']);
              await page.evaluate((text) => navigator.clipboard.writeText(text), name);
              await page.keyboard.press('Control+V');
            } else await page.keyboard.insertText(name);
            await page.keyboard.press('Tab');
            const value = await filename.inputValue();
            assert.ok(value.endsWith(suffix(initial.name)));
            assert.ok(value.slice(0, -5).length <= 64);
            assert.doesNotMatch(value, /[\\/\u202a-\u202e\u2066-\u2069]/);
          }
          const edited = await download(save, 'edited');
          const repeat = await download(save, 'repeat');
          assert.equal(hash(edited.bytes), hash(repeat.bytes));
          assert.equal(edited.name, repeat.name);
          assert.equal(
            await inferenceCalls(),
            beforeInference,
            'rename and repeat Save dispatch zero inference',
          );
          await shot('face-actions');
          // A real second face and a short MP4. The visible controls own the journey.
          await operate(tiles.nth(0).locator('.next-face-generate'));
          await tiles
            .nth(0)
            .getByRole('button', { name: 'Save image', exact: true })
            .waitFor({ timeout: 180_000 });
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          await page.getByLabel('Morph shape', { exact: true }).selectOption('linear');
          await page.getByLabel('Morph length', { exact: true }).selectOption('8');
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          await operate(page.getByRole('button', { name: 'Create morph', exact: true }));
          const videoSave = page.getByRole('button', { name: 'Save video', exact: true });
          await videoSave.waitFor({ timeout: 240_000 });
          const movie = await download(videoSave, 'video');
          assert.ok(typeMatchesBytes(movie.bytes, { mime: 'video/mp4', filename: movie.name }));
          const videoRepeat = await download(videoSave, 'video-repeat');
          assert.equal(hash(movie.bytes), hash(videoRepeat.bytes));
          assert.equal(movie.name, videoRepeat.name);
          const videoName = page.getByLabel('Video filename');
          await operate(videoName);
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText('My morph');
          await page.keyboard.press('Tab');
          assert.ok((await videoName.inputValue()).endsWith(suffix(movie.name)));
          await page.locator('[data-next-video-width="512"]').waitFor();
          assert.ok(
            await page
              .getByText(
                'Video; reopening this file as a project is not available in this release.',
                { exact: true },
              )
              .isVisible(),
          );
          await shot('video-actions');
          // The prepared export identity survives the real session restore. No inference.
          const beforeReload = modelRequests.length;
          await page.reload();
          await save.waitFor();
          const restored = await download(save, 'restored');
          assert.equal(
            suffix(restored.name),
            suffix(initial.name),
            'restored export keeps its identity suffix',
          );
          assert.equal(modelRequests.length, beforeReload, 'restored save has zero model requests');
          assert.equal(await inferenceCalls(), 0, 'restored Save dispatches zero inference');
          const restoredVideo = await download(videoSave, 'restored-video');
          assert.equal(
            suffix(restoredVideo.name),
            suffix(movie.name),
            'restored video keeps its identity suffix',
          );
          assert.equal(await inferenceCalls(), 0, 'restored video Save dispatches zero inference');
          assert.equal(
            modelRequests.length,
            beforeReload,
            'restored video Save has zero model requests',
          );
          evidence.push({
            width,
            face: {
              initial: initial.name,
              initialSha256: hash(initial.bytes),
              png: png.name,
              pngSha256: hash(png.bytes),
              edited: edited.name,
              restored: restored.name,
            },
            formatsModelRequests: modelRequests.length - beforeReload,
            video: { name: movie.name, sha256: hash(movie.bytes), restored: restoredVideo.name },
          });
          await shot('restored');
          assert.deepEqual(pageErrors, [], 'operated result actions have no page errors');
        } finally {
          rmSync(faultFile, { force: true });
          await context.tracing.stop({ path: join(out, `${width}-trace.zip`) });
          await context.close();
        }
      }
      writeFileSync(
        join(out, 'report.json'),
        JSON.stringify({ artifact: artifact.identity.deploySource, cases: evidence }, null, 2) +
          '\n',
      );
    } finally {
      await browser.close();
      await site.stop();
      rmSync(faultFile, { force: true });
    }
  },
);
