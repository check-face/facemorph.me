// fm-qrfz: the built app's model requests follow the person's decision. Cold profile, the identified build:next
// destination with the real bridge, workers and runtime bytes, Chromium on the CPU route, 1280 px (mouse) and 390 px
// (touch), controls pressed at their visible centres:
// - arrival, the open download question, and Cancel: zero model requests;
// - approval: only this route's files (the served manifest's routeAssets), never the photo detector or encoder;
// - a second Generate inside the approved scope asks nothing and still requests only route files.
// Requests are classed by path against the URLs (and chunk URLs) the served manifest gives this route's files.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/consent-requests.e2e.ts
// The overlap case also measures real seed/photo Save handover and a fresh-session warm-model replay.
// FACEMORPH_CONSENT_ROUTE=webgpu uses installed, headed Google Chrome (LAB_CHROME or google-chrome), and
// requires a hardware adapter plus actual WebGPU route captions and saved recovery provenance; no CPU fallback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, request as requestHttps } from 'node:https';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page, type Request } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO, PORT } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { routeAssets } from '../../src/Next/model-inventory.mjs';
import { press } from '../support/operate.ts';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';
import { typeMatchesBytes } from '../../src/media/export-policy.ts';
import { readRecovery } from 'stylegan-js';
import { downloadMegabytes as megabytes } from '../../src/controller/derived.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/consent-requests');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
const measuredRoute = process.env['FACEMORPH_CONSENT_ROUTE'] ?? 'cpu';
assert.ok(
  ['cpu', 'webgpu'].includes(measuredRoute),
  'FACEMORPH_CONSENT_ROUTE must be cpu or webgpu',
);
interface OverlapObservation {
  timeOrigin: number;
  approvedAt: number;
  cropOKAt: number;
  encodes: number;
  queuedAt: number;
  encodingAt: number;
  completedAt: number;
  fileReadyAt: Record<string, number>;
  keyToFrameMs: number[];
  keyHandlerToFrameMs: number[];
}

/** Processing setup, wherever this build keeps it (above the faces, or under More options › Advanced). */
async function chooseCpu(page: Page, route = 'cpu'): Promise<void> {
  const select = page.getByLabel('Processing mode');
  if (!(await select.isVisible())) {
    await page.getByRole('button', { name: 'More options' }).click(); // setup
    const advanced = page.locator('.next-advanced');
    if (await advanced.count())
      await advanced.evaluate((e) => ((e as HTMLDetailsElement).open = true));
  }
  await select.selectOption(route); // setup
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
          // Desktop in the light scheme, phone in the dark one: the modal is operated in both (fm-9kr8).
          colorScheme: touch ? 'dark' : 'light',
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
          // Optional preparation sits in the Processing group above the first face (fm-9kr8); choosing the
          // provider above started nothing, and no face card carries a preparation control of its own.
          const prepare = page
            .getByRole('group', { name: 'Processing' })
            .getByRole('button', { name: 'Prepare encoder' });
          assert.ok(await prepare.isVisible(), `${name}: Prepare encoder beside the selector`);
          const [prepareBox, firstFace] = await Promise.all([
            prepare.boundingBox(),
            tiles.nth(0).boundingBox(),
          ]);
          assert.ok(
            prepareBox && firstFace && prepareBox.y + prepareBox.height <= firstFace.y,
            `${name}: Prepare encoder is above the first face`,
          );
          assert.equal(
            await tiles.getByRole('button', { name: /Prepare encoder/ }).count(),
            0,
            `${name}: no per-card preparation`,
          );

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
          // Escape, the backdrop and Back each equal Cancel (fm-9kr8): nothing fetched, and focus is back on the
          // Generate control that asked (never the face's field, which would open a phone's keyboard).
          const generate = tiles.nth(0).locator('.next-face-generate');
          const focusedOnGenerate = () => generate.evaluate((el) => el === document.activeElement);
          assert.ok(await focusedOnGenerate(), `${name}: Cancel returns focus to Generate`);
          for (const exit of ['Escape', 'backdrop', 'Back'] as const) {
            await operate(generate);
            await dialog.waitFor();
            if (exit === 'Escape') await page.keyboard.press('Escape');
            else if (exit === 'Back') await page.goBack();
            else {
              // The backdrop at its visible position: the overlay itself, not its panel, is under the point.
              assert.ok(
                await dialog.evaluate((el) => document.elementFromPoint(6, 6) === el),
                `${name}: the backdrop is under the pressed point`,
              );
              if (touch) await page.touchscreen.tap(6, 6);
              else await page.mouse.click(6, 6);
            }
            await dialog.waitFor({ state: 'detached' });
            await page.waitForTimeout(1000);
            assert.deepEqual(models, [], `${name}: no model request after ${exit}`);
            assert.ok(await focusedOnGenerate(), `${name}: ${exit} returns focus to Generate`);
          }

          // Create morph asks the same question first, with only the Generate row; Escape starts nothing
          // and returns focus to Create morph (fm-9kr8).
          await tiles.nth(1).locator('.next-field input').fill('consent morph'); // setup
          const morph = page.locator('.next-primary-action');
          await operate(morph);
          await dialog.waitFor({ timeout: 60_000 });
          assert.deepEqual(
            await dialog
              .locator('[data-download-purpose]')
              .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-download-purpose'))),
            ['generate'],
            `${name}: Morph asks only for Generate`,
          );
          assert.deepEqual(
            models,
            [],
            `${name}: no model request while the Morph question is open`,
          );
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });
          await page.waitForTimeout(1000);
          assert.deepEqual(models, [], `${name}: no model request after the Morph question`);
          assert.ok(
            await morph.evaluate((el) => el === document.activeElement),
            `${name}: focus back on Create morph`,
          );

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

// A real HTTPS response is suspended after its first bytes reach the browser. The upstream is the existing
// pinned runtime server; no asset is replaced, fulfilled from a mock, or allowed to fall through to the internet.
async function overlapServer(encoder: Set<string>) {
  const directory = mkdtempSync(join(tmpdir(), 'facemorph-consent-transfer-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=next.facemorph.me',
      '-keyout',
      join(directory, 'key'),
      '-out',
      join(directory, 'cert'),
    ],
    { stdio: 'ignore' },
  );
  let release!: () => void,
    released = false;
  const suspended = new Promise<void>((resolve) => {
    release = () => {
      released = true;
      resolve();
    };
  });
  const log: {
    path: string;
    hostClass: string;
    start: number;
    firstByte: number;
    end: number;
    bytes: number;
    closedEarly: boolean;
  }[] = [];
  const pending = new Set<ReturnType<typeof requestHttps>>();
  const server = createServer(
    { key: readFileSync(join(directory, 'key')), cert: readFileSync(join(directory, 'cert')) },
    (request, response) => {
      const path = new URL(request.url!, ORIGIN).pathname;
      const entry = {
        path,
        hostClass: path.startsWith('/runtime/photo/')
          ? 'detector'
          : MODEL.test(path)
            ? 'model'
            : 'app',
        start: performance.now(),
        firstByte: 0,
        end: 0,
        bytes: 0,
        closedEarly: false,
      };
      log.push(entry);
      const upstream = requestHttps(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: 'next.facemorph.me' },
          rejectUnauthorized: false,
        },
        (source) => {
          response.writeHead(source.statusCode!, source.headers);
          void (async () => {
            try {
              const write = async (body: Buffer) => {
                if (response.destroyed) return;
                entry.firstByte ||= performance.now();
                entry.bytes += body.length;
                if (!response.write(body)) await once(response, 'drain');
              };
              for await (const chunk of source) {
                if (response.destroyed) return;
                const body = chunk as Buffer;
                if (encoder.has(path) && !released) {
                  // Trickle the real body to keep the manager's unchanged 30s network watchdog healthy.
                  // Only one upstream chunk is retained; normal backpressure bounds the rest.
                  let at = 0;
                  while (at < body.length && !released) {
                    if (response.destroyed) return;
                    const end = Math.min(body.length, at + (entry.bytes ? 32 : 1024));
                    await write(body.subarray(at, end));
                    at = end;
                    await Promise.race([
                      suspended,
                      new Promise((resolve) => setTimeout(resolve, 5000)),
                    ]);
                  }
                  if (at < body.length) await write(body.subarray(at));
                } else {
                  await write(body);
                }
              }
              entry.end = performance.now();
              response.end();
            } catch (error) {
              if (!response.destroyed) response.destroy(error as Error);
            }
          })();
        },
      );
      pending.add(upstream);
      upstream.on('close', () => pending.delete(upstream));
      upstream.on('error', (error) => {
        if (!response.destroyed) response.destroy(error);
      });
      response.on('close', () => {
        entry.closedEarly = !response.writableFinished;
        upstream.destroy();
      });
      request.pipe(upstream);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    log,
    release,
    port,
    async close() {
      release();
      for (const request of pending) request.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test(
  'approved photo transfer overlaps operated seed generation and choosing/cropping; one OK queues one real encode',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-qrfz`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    type Asset = { url: string; chunks?: { url: string }[] };
    const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    > & { encoderStream: Asset };
    const descriptorPath = new URL(manifest.encoderStream.url).pathname;
    const descriptor = JSON.parse(
      readFileSync(join(runtime, descriptorPath.slice('/runtime/'.length)), 'utf8'),
    ) as { steps: Asset[] };
    const paths = (assets: Asset[]) =>
      new Set(
        assets
          .flatMap((a) => [a.url, ...(a.chunks ?? []).map((c) => c.url)])
          .map((url) => new URL(url, ORIGIN).pathname),
      );
    const synthesis = paths(
        measuredRoute === 'cpu'
          ? (routeAssets(manifest, 'cpu', 'ort') as Asset[])
          : ([
              ...routeAssets(manifest, 'webgpu', 'direct'),
              ...routeAssets(manifest, 'webgpu', 'ort'),
            ] as Asset[]),
      ),
      encoder = paths(descriptor.steps);
    let executable: string | undefined, browserVersion: string | undefined;
    if (measuredRoute === 'webgpu') {
      executable =
        process.env['LAB_CHROME'] ??
        execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
      browserVersion = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
      assert.match(
        browserVersion,
        /^Google Chrome(?: for Testing)? \d/,
        'actual Google Chrome required',
      );
    }
    const resultName = measuredRoute === 'cpu' ? 'desktop-overlap' : 'desktop-webgpu-overlap';
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const server = await overlapServer(encoder);
    const profile = await launchFreshChromiumProfile({
      ...(executable ? { executablePath: executable, headless: false } : {}),
      args: [
        ...chromiumArgs.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
        `--host-resolver-rules=MAP next.facemorph.me:443 127.0.0.1:${server.port}`,
        '--enable-automation',
        ...(measuredRoute === 'cpu'
          ? ['--disable-features=WebGPU']
          : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']),
      ],
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    });
    const context = profile.context,
      page = await context.newPage(),
      errors: string[] = [];
    // Context events include worker requests and hosts outside the mounted origin. The proxy's byte log alone
    // could otherwise miss a runtime fallback to a mirror; request.sizes reads metadata, never buffers a body.
    const network = new Map<
      Request,
      { url: string; hostClass: string; bytes: number; finished: boolean }
    >();
    const measurements: Promise<unknown>[] = [];
    context.on('request', (request) => {
      const url = new URL(request.url());
      network.set(request, {
        url: request.url(),
        hostClass: url.pathname.startsWith('/runtime/photo/')
          ? 'detector'
          : MODEL.test(url.pathname)
            ? 'model'
            : url.origin === ORIGIN
              ? 'app'
              : 'other',
        bytes: 0,
        finished: false,
      });
    });
    context.on('requestfinished', (request) => {
      const row = network.get(request);
      if (!row) return;
      row.finished = true;
      measurements.push(
        request
          .sizes()
          .then((size) => {
            row.bytes = size.responseBodySize;
          })
          .catch(() => {}),
      );
    });
    const times: Record<string, number> = {},
      observed: Record<string, unknown> = {};
    const admissions: unknown[] = [];
    page.on('console', (event) => {
      const text = event.text();
      if (text.startsWith('[facemorph-admission] '))
        admissions.push(JSON.parse(text.slice('[facemorph-admission] '.length)));
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(() => {
      const state = {
        timeOrigin: performance.timeOrigin,
        approvedAt: 0,
        cropOKAt: 0,
        encodes: 0,
        queuedAt: 0,
        encodingAt: 0,
        completedAt: 0,
        fileReadyAt: {} as Record<string, number>,
        keyToFrameMs: [] as number[],
        keyHandlerToFrameMs: [] as number[],
      };
      (window as unknown as { __consentOverlap: typeof state }).__consentOverlap = state;
      document.addEventListener(
        'pointerdown',
        (event) => {
          if (!event.isTrusted || !(event.target instanceof Element)) return;
          const button = event.target.closest('button');
          const label = button?.textContent?.trim() ?? '';
          if (button?.closest('.next-download-dialog') && /^Download and continue$/i.test(label))
            state.approvedAt ||= event.timeStamp;
          if (button?.closest('.next-crop-dialog') && label === 'OK')
            state.cropOKAt = event.timeStamp;
        },
        true,
      );
      document.addEventListener('keydown', (event) => {
        if (
          !event.isTrusted ||
          !(event.target instanceof Element) ||
          !event.target.closest('.next-crop-dialog')
        )
          return;
        const at = performance.now();
        requestAnimationFrame(() => {
          const frameAt = performance.now();
          state.keyToFrameMs.push(frameAt - event.timeStamp);
          state.keyHandlerToFrameMs.push(frameAt - at);
        });
      });
      new MutationObserver(() => {
        document.querySelectorAll('section.next-face').forEach((tile, index) => {
          const save = [...tile.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Save image' && !button.disabled,
          );
          if (save) state.fileReadyAt[index] ??= performance.now();
        });
      }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled'],
      });
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (
        message: { type?: string; id?: number },
        ...rest: unknown[]
      ) {
        if (message.type === 'encode-aligned') {
          state.encodes++;
          state.queuedAt = performance.now();
          this.addEventListener('message', ({ data }: MessageEvent) => {
            if (data.id !== message.id) return;
            if (data.type === 'progress' && data.stage === 'encoding')
              state.encodingAt = performance.now();
            if (data.type === 'complete') state.completedAt = performance.now();
          });
        }
        return Reflect.apply(post, this, [message, ...rest]);
      };
    });
    mkdirSync(results, { recursive: true });
    const operate = async (control: Locator) => assert.ok((await press(page, control)).inside);
    const modelRequests = () => server.log.filter((row) => row.hostClass !== 'app');
    const observedModels = () =>
      [...network.values()].filter(
        (row) =>
          row.hostClass === 'model' || row.hostClass === 'detector' || row.hostClass === 'other',
      );
    const transferring = () =>
      server.log.some(
        (row) => encoder.has(row.path) && row.bytes > 0 && !row.end && !row.closedEarly,
      );
    const readObservation = () =>
      page.evaluate('window.__consentOverlap') as Promise<OverlapObservation>;
    const waitForResult = async (index: number) => {
      await page.waitForFunction(
        (at) => {
          const image = document
            .querySelectorAll('section.next-face')
            [at]?.querySelector('.next-face-img:not([data-public-preview])');
          return image instanceof HTMLCanvasElement
            ? image.dataset['faceDrawn'] === 'true' && image.width === 1024 && image.height === 1024
            : image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth === 1024 &&
                image.naturalHeight === 1024;
        },
        index,
        { timeout: 900_000 },
      );
    };
    const checkRoute = async () => {
      const caption = page.locator('.next-route-caption');
      assert.equal(await caption.getAttribute('data-next-route'), measuredRoute);
      const text = await caption.innerText();
      assert.match(text, measuredRoute === 'webgpu' ? /GPU \(webgpu\)/ : /CPU/);
      if (measuredRoute === 'webgpu') assert.doesNotMatch(text, /CPU/);
      return text;
    };
    const chooseAndCrop = async (clock: Record<string, number>, cold: boolean) => {
      const tile = page.locator('section.next-face').nth(1);
      clock['photoChoose'] = performance.now();
      // An initialized text face has a Generate hint. Use its actual mode-menu photo entry.
      await operate(tile.getByRole('button', { name: 'Change mode', exact: true }));
      const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
      await entry.evaluate(async (el) => {
        const panel = el.closest('.MuiPaper-root');
        await Promise.allSettled(
          (panel?.getAnimations({ subtree: true }) ?? []).map((animation) => animation.finished),
        );
      });
      const chooser = page.waitForEvent('filechooser');
      await operate(entry);
      await (await chooser).setFiles(join(REPO, 'tests/crop/fixtures/no-face.jpg'));
      const crop = page.locator('.next-crop-dialog');
      // Faces first (fm-k09b): the confirmation shows the whole photo while the detector waits for the photo
      // files (cold: the encoder transfer is still held open) and the proposal once it has run (warm).
      await crop.locator('.next-encode-confirmation img').first().waitFor({ timeout: 120_000 });
      await page.waitForFunction(
        () =>
          document
            .querySelector('.next-encode-confirmation')
            ?.getAttribute('data-next-crop-state') !== 'running',
        null,
        { timeout: 120_000 },
      );
      clock['cropVisible'] = performance.now();
      if (cold)
        assert.ok(
          transferring(),
          'choosing and crop inspection overlap a real incomplete encoder response',
        );
      await operate(crop.getByRole('button', { name: 'ADJUST CROP', exact: true }));
      const area = crop.getByRole('application', { name: 'Crop area' });
      await area.waitFor();
      clock['cropInputStart'] = performance.now();
      await area.focus();
      await page.keyboard.press('+');
      await page.keyboard.press('-');
      clock['cropInputEnd'] = performance.now();
      await operate(crop.getByRole('button', { name: 'USE CROP', exact: true }));
      if (cold) assert.ok(transferring());
      clock['cropOKOperationStarted'] = performance.now();
      await operate(crop.getByRole('button', { name: 'OK', exact: true }));
      const cropObservation = await readObservation();
      assert.ok(
        cropObservation.cropOKAt > 0,
        'actual trusted crop OK pointer reached the document',
      );
      clock['cropOK'] =
        cropObservation.timeOrigin + cropObservation.cropOKAt - performance.timeOrigin;
      const deadline = performance.now() + 120_000;
      while ((await readObservation()).encodes === 0) {
        if (performance.now() > deadline) throw Error('Crop OK never queued its encoder');
        const accept = page.locator('.next-download-accept');
        if (await accept.isVisible()) {
          assert.ok(cold, 'verified warm models require no acquisition decision');
          await operate(accept);
        }
        await page.waitForTimeout(100);
      }
      assert.equal((await readObservation()).encodes, 1, 'one OK queues exactly one real encode');
    };
    const saveResult = async (index: number, phase: string, clock: Record<string, number>) => {
      const tile = page.locator('section.next-face').nth(index),
        save = tile.getByRole('button', { name: 'Save image', exact: true });
      await save.waitFor();
      await page.waitForFunction(
        (at) => {
          const card = document.querySelectorAll('section.next-face')[at];
          return (
            !!card &&
            [...card.querySelectorAll('button')].some(
              (button) => button.textContent?.trim() === 'Save image' && !button.disabled,
            )
          );
        },
        index,
        { timeout: 120_000 },
      );
      clock[`${index ? 'photo' : 'seed'}FileReady`] = performance.now();
      const download = page.waitForEvent('download');
      clock[`${index ? 'photo' : 'seed'}SaveRequested`] = performance.now();
      await operate(save);
      const file = await download;
      assert.equal(await file.failure(), null);
      const path = join(results, `${resultName}-${phase}-${index}-${file.suggestedFilename()}`);
      await file.saveAs(path);
      clock[`${index ? 'photo' : 'seed'}ExportCompleted`] = performance.now();
      const bytes = new Uint8Array(readFileSync(path)),
        recovery = readRecovery(bytes);
      assert.equal(recovery.kind, 'parsed', 'the actual saved file carries valid recovery');
      const face = recovery.recovered;
      assert.ok(typeMatchesBytes(bytes, { mime: face.mime, filename: file.suggestedFilename() }));
      assert.equal(face.width, 1024);
      assert.equal(face.height, 1024);
      assert.equal(
        face.generationKind,
        index === 0 ? 'seed' : 'photo',
        'saved recovery proves the expected operation',
      );
      assert.equal(
        face.provenance.route,
        measuredRoute,
        'saved provenance proves the executed route',
      );
      assert.equal(face.provenance.provider, measuredRoute === 'webgpu' ? 'webgpu' : 'wasm');
      return {
        filename: file.suggestedFilename(),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        schemaVersion: face.schemaVersion,
        generationKind: face.generationKind,
        generationSha256: face.generationSha256,
        imageSha256: face.imageSha256,
        latentSha256: face.latentSha256,
        provenance: face.provenance,
      };
    };
    const durations = (clock: Record<string, number>, state: OverlapObservation) => ({
      approvalToFirstModelByteMs:
        clock['approved'] === undefined ? null : modelRequests()[0]!.firstByte - clock['approved'],
      approvalToUsefulFaceMs:
        clock['approved'] === undefined ? null : clock['firstUsefulFace']! - clock['approved'],
      acquisition:
        clock['approved'] === undefined
          ? 'cached: no approval or model transfer needed'
          : 'cold approved transfer',
      seedRequestToUsefulFaceMs: clock['firstUsefulFace']! - clock['seedRequested']!,
      cropInputRoundtripMs: clock['cropInputEnd']! - clock['cropInputStart']!,
      nativeKeyToNextFrameMs: state.keyToFrameMs,
      nativeKeyHandlerToNextFrameMs: state.keyHandlerToFrameMs,
      cropOKToEncodeStartMs:
        state.timeOrigin + state.encodingAt - performance.timeOrigin - clock['cropOK']!,
      encodeEndToFileReadyMs: state.fileReadyAt['1']! - state.completedAt,
      chooseToPhotoExportMs: clock['photoExportCompleted']! - clock['photoChoose']!,
      seedRequestToExportMs: clock['seedExportCompleted']! - clock['seedRequested']!,
    });
    try {
      await page.goto(ORIGIN);
      const tiles = page.locator('section.next-face');
      await tiles.nth(1).waitFor();
      const cdp = await context.newCDPSession(page);
      const commandLine = await cdp.send('Browser.getBrowserCommandLine');
      observed['browser'] = {
        route: measuredRoute,
        launcher: executable ?? null,
        executable: commandLine.arguments[0],
        version: browserVersion ?? context.browser()?.version(),
        distribution: executable ? 'installed Google Chrome' : 'Playwright Chromium',
        protocolVersion: await cdp.send('Browser.getVersion'),
        commandLine,
      };
      observed['capability'] = await page.evaluate(async (gpu) => {
        const report: Record<string, unknown> = {
          secureContext: isSecureContext,
          userAgent: navigator.userAgent,
          url: location.href,
        };
        if (!gpu) return report;
        type Adapter = {
          info?: Record<string, unknown>;
          isFallbackAdapter?: boolean;
          limits: Record<string, number>;
        };
        const api = (
          navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }
        ).gpu;
        const adapter = await api?.requestAdapter();
        if (!adapter) throw Error('WebGPU adapter unavailable; CPU fallback is not a WebGPU pass');
        report['adapter'] = Object.fromEntries(
          ['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map((key) => [
            key,
            adapter.info?.[key] ?? null,
          ]),
        );
        report['limits'] = Object.fromEntries(
          ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize'].map(
            (key) => [key, adapter.limits[key]],
          ),
        );
        if (
          adapter.isFallbackAdapter ||
          adapter.info?.['isFallbackAdapter'] ||
          /swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(report['adapter']))
        )
          throw Error('Software/fallback adapter cannot qualify desktop WebGPU');
        return report;
      }, measuredRoute === 'webgpu');
      // Optional preparation becomes available after real inventory inspection, beside Processing.
      const prepare = page.locator('.next-provider-row').getByRole('button', {
        name: 'Prepare encoder',
        exact: true,
      });
      await prepare.waitFor();
      await chooseCpu(page, measuredRoute);
      await page.waitForTimeout(2000);
      assert.deepEqual(modelRequests(), [], 'cold arrival has no model-host request');
      assert.deepEqual(observedModels(), [], 'cold arrival has no worker or mirror model request');
      await tiles.nth(0).locator('.next-field input').fill('overlap seed');
      await operate(tiles.nth(0).locator('.next-face-generate'));
      const dialog = page.locator('.next-download-dialog');
      await dialog.waitFor();
      assert.deepEqual(modelRequests(), [], 'question alone grants no model transfer');
      assert.deepEqual(
        observedModels(),
        [],
        'question alone grants no worker or mirror model transfer',
      );
      await operate(dialog.getByRole('button', { name: 'Cancel' }));
      await dialog.waitFor({ state: 'detached' });
      await page.waitForTimeout(2000);
      assert.deepEqual(modelRequests(), [], 'Cancel leaves zero model-host requests');
      assert.deepEqual(observedModels(), [], 'Cancel leaves zero worker or mirror model requests');

      await prepare.waitFor();
      times['approvalOperationStarted'] = performance.now();
      await operate(prepare);
      await dialog.waitFor();
      assert.deepEqual(modelRequests(), [], 'opening optional setup grants no transfer');
      await operate(dialog.getByRole('button', { name: 'Download and continue', exact: true }));
      const approvalObservation = await readObservation();
      assert.ok(
        approvalObservation.approvedAt > 0,
        'actual trusted approval pointer reached the document',
      );
      times['approved'] =
        approvalObservation.timeOrigin + approvalObservation.approvedAt - performance.timeOrigin;
      const waitTransfer = async () => {
        const end = performance.now() + 180_000;
        let revised = 0;
        while (!transferring()) {
          if (performance.now() > end) throw Error('No real encoder response began');
          const accept = page.locator('.next-download-accept');
          if (await accept.isVisible()) {
            assert.equal(
              ++revised,
              1,
              'one explicit revised decision covers the discovered schedule',
            );
            observed['revisedPreparationDecision'] = await page
              .locator('.next-download-dialog')
              .innerText();
            times['revisedPreparationApproved'] = performance.now();
            await operate(accept);
          }
          await page.waitForTimeout(100);
        }
      };
      await waitTransfer();
      // The discovered descriptor can require another explicit decision before transfer starts.
      // Observe active transfer UI only after that decision; the same status assertion and bound apply.
      await page.waitForFunction(() => !!document.querySelector('.next-model-toast'), null, {
        timeout: 30_000,
      });
      times['encoderFirstByte'] = server.log.find(
        (row) => encoder.has(row.path) && row.bytes > 0,
      )!.firstByte;
      assert.ok(transferring());
      times['seedRequested'] = performance.now();
      await operate(tiles.nth(0).locator('.next-face-generate'));
      await waitForResult(0);
      times['firstUsefulFace'] = performance.now();
      assert.ok(
        transferring(),
        'first useful seed face precedes completion of the encoder transfer',
      );

      observed['seedRoute'] = await checkRoute();
      observed['seedExport'] = await saveResult(0, 'cold', times);
      await chooseAndCrop(times, true);
      assert.ok(transferring(), 'OK queues encoding before its assets finish');
      observed['beforeRelease'] = await page.evaluate('window.__consentOverlap');
      assert.equal((observed['beforeRelease'] as { encodes: number }).encodes, 1);
      times['transferReleased'] = performance.now();
      server.release();
      await waitForResult(1);
      times['photoFaceReady'] = performance.now();
      observed['afterResult'] = await page.evaluate('window.__consentOverlap');
      assert.equal(
        (observed['afterResult'] as { encodes: number }).encodes,
        1,
        'exactly one encoder attempt',
      );
      assert.ok(
        (observed['afterResult'] as { completedAt: number }).completedAt > 0,
        'real encoder completed',
      );
      observed['photoRoute'] = await checkRoute();
      observed['photoExport'] = await saveResult(1, 'cold', times);
      const coldState = await readObservation();
      assert.ok(coldState.keyToFrameMs.length >= 2, 'actual crop keys reached rendered frames');
      observed['afterResult'] = coldState;
      observed['coldDurations'] = durations(times, coldState);
      observed['clockOrigins'] = { node: performance.timeOrigin, coldPage: coldState.timeOrigin };
      await page.screenshot({ path: join(results, `${resultName}-complete.png`) });
      observed['firstModelRequest'] = modelRequests()[0];
      // Keep this literal: a descriptor fetched before generator assets is an acceptance gap, not a pass.
      assert.ok(
        synthesis.has(modelRequests()[0]!.path),
        `approval must request generator assets first; saw ${modelRequests()[0]!.path}`,
      );

      // Warm model bytes, fresh original/session identity: the lab uses this same storage boundary.
      // IndexedDB/localStorage contain originals and UI state; verified models remain in Cache Storage/OPFS.
      await page.goto('about:blank');
      await cdp.send('Storage.clearDataForOrigin', {
        origin: ORIGIN,
        storageTypes: 'indexeddb,local_storage',
      });
      const warmLogStart = server.log.length,
        warmTimes: Record<string, number> = {};
      await page.goto(ORIGIN);
      await tiles.nth(1).waitFor();
      await chooseCpu(page, measuredRoute);
      await page.waitForTimeout(2000);
      assert.deepEqual(
        server.log.slice(warmLogStart).filter((row) => row.hostClass !== 'app'),
        [],
        'warm arrival uses retained model bytes',
      );
      await tiles.nth(0).locator('.next-field input').fill('warm overlap seed');
      warmTimes['seedRequested'] = performance.now();
      await operate(tiles.nth(0).locator('.next-face-generate'));
      await waitForResult(0);
      warmTimes['firstUsefulFace'] = performance.now();
      assert.equal(await page.locator('.next-download-dialog').isVisible(), false);
      const warmSeedRoute = await checkRoute(),
        warmSeedExport = await saveResult(0, 'warm', warmTimes);
      assert.equal(
        (await readObservation()).encodes,
        0,
        'warm originals were cleared, not replayed',
      );
      await chooseAndCrop(warmTimes, false);
      await waitForResult(1);
      warmTimes['photoFaceReady'] = performance.now();
      const warmPhotoRoute = await checkRoute(),
        warmPhotoExport = await saveResult(1, 'warm', warmTimes),
        warmState = await readObservation();
      assert.equal(warmState.encodes, 1, 'one real warm encode');
      assert.ok(warmState.completedAt > 0);
      assert.ok(warmState.keyToFrameMs.length >= 2);
      const warmRequests = server.log.slice(warmLogStart);
      // Faces first (fm-k09b): the cold crop was adjusted while the encoder transfer was still held, so the
      // detector first runs in this warm session. Its own files are a first use (never fetched in the cold
      // session: its module, wasm and landmark predictor), each once; every model file the cold session fetched is
      // served from retained bytes.
      const coldPaths = new Set(server.log.slice(0, warmLogStart).map((row) => row.path));
      const landmarks = paths([manifest['landmarks'] as Asset]);
      const detectorFirstUse = warmRequests.filter(
        (row) =>
          (row.hostClass === 'detector' || landmarks.has(row.path)) && !coldPaths.has(row.path),
      );
      assert.equal(
        new Set(detectorFirstUse.map((row) => row.path)).size,
        detectorFirstUse.length,
        'detector files are fetched at most once',
      );
      console.log(
        'fm-9kr8 cold landmark rows',
        JSON.stringify(
          server.log
            .slice(0, warmLogStart)
            .filter((row) => landmarks.has(row.path))
            .map(({ path, bytes, closedEarly }) => ({
              path: path.slice(16, 24),
              bytes,
              closedEarly,
            })),
        ),
      );
      assert.deepEqual(
        warmRequests.filter((row) => row.hostClass !== 'app' && !detectorFirstUse.includes(row)),
        [],
        'warm seed, photo encoding and export transfer zero model bytes',
      );
      observed['warm'] = {
        times: warmTimes,
        state: warmState,
        seedRoute: warmSeedRoute,
        photoRoute: warmPhotoRoute,
        seedExport: warmSeedExport,
        photoExport: warmPhotoExport,
        requests: warmRequests,
        durations: durations(warmTimes, warmState),
      };
      await page.screenshot({ path: join(results, `${resultName}-warm-complete.png`) });
      if (measuredRoute === 'webgpu') {
        const actual = admissions as {
          operation?: string;
          decision?: string;
          provider?: string;
          fallback?: unknown;
        }[];
        const faces = actual.filter(
          (event) => event.operation === 'face' && event.decision === 'admitted',
        );
        assert.ok(
          faces.length >= 2 && faces.every((event) => event.provider === 'webgpu'),
          'actual runtime admission used WebGPU',
        );
        // The streamed photo encoder is deliberately CPU-only for every requested route (route-admission.ts).
        // Its following face synthesis and all saved recovery provenance must still prove the GPU route.
        assert.deepEqual(
          faces.filter((event) => event.provider === 'cpu'),
          [],
          'CPU fallback is not a WebGPU journey pass',
        );
        const encoders = actual.filter(
          (event) => event.operation === 'photo-encode' && event.decision === 'admitted',
        );
        assert.ok(
          encoders.length >= 2 && encoders.every((event) => event.provider === 'cpu'),
          'the actual streamed encoder used its admitted CPU provider',
        );
        assert.ok(
          actual.every((event) => event.fallback == null),
          'no GPU-to-CPU fallback',
        );
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(
        [...network.values()].filter((row) => new URL(row.url).origin !== ORIGIN),
        [],
        'all requests used the pinned local server, including any differently pathed model mirror',
      );
    } finally {
      await Promise.allSettled(measurements);
      observed['visibleAtEnd'] = await page
        .locator('body')
        .innerText()
        .catch(() => 'page unavailable');
      await page
        .screenshot({ path: join(results, `${resultName}-final.png`), fullPage: true })
        .catch(() => {});
      const evidence = {
        artifact: artifact.identity.deploySource,
        runtime: site.manifestSha256,
        route: measuredRoute,
        times,
        observed,
        errors,
        requests: server.log,
        network: [...network.values()],
        admissions,
      };
      writeFileSync(join(results, `${resultName}.json`), JSON.stringify(evidence, null, 2));
      console.log(
        'fm-qrfz operated-overlap',
        JSON.stringify({
          times,
          observed,
          errors,
          counts: server.log.reduce<Record<string, number>>((counts, row) => {
            counts[row.hostClass] = (counts[row.hostClass] ?? 0) + 1;
            return counts;
          }, {}),
        }),
      );
      server.release();
      await profile.close();
      await server.close();
      await site.stop();
    }
  },
);

// fm-9kr8: the video codec fallback is inside the one consent. Chromium with VideoEncoder removed from the page (a
// browser without an H.264 WebCodecs encoder, so the MP4 probe chooses the pinned FFmpeg codec), cold profile, the
// built app, 1280 px mouse and 390 px touch. The face model is approved and used first, so the Morph question asks
// for the codec alone: its Generate row names the codec's bytes, no codec byte is requested while it is open or
// after Cancel, and after approval the status line counts the same figure while the codec arrives.
test(
  'the video codec fallback is asked for in Generate, fetched only after approval, with one figure',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-9kr8`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    type Part = { url: string; size: number; chunks?: { url: string }[] };
    const served = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')) as {
      codec?: { wasm: Part; module: Part };
    };
    assert.ok(served.codec, 'the pinned runtime carries the codec fallback');
    const codecParts = [served.codec.wasm, served.codec.module];
    const codecPaths = new Set(
      codecParts.flatMap((p) =>
        [p.url, ...(p.chunks ?? []).map((c) => c.url)].map((u) => new URL(u).pathname),
      ),
    );
    const codecFigure = megabytes(codecParts.reduce((n, p) => n + p.size, 0));
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
          // Desktop in the light scheme, phone in the dark one: the modal is operated in both (fm-9kr8).
          colorScheme: touch ? 'dark' : 'light',
          ignoreHTTPSErrors: true,
        });
        await context.addInitScript(() => {
          delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
          // Every codec status line the page shows, however briefly (a local codec arrives in moments).
          const lines: string[] = ((globalThis as { __codecLines?: string[] }).__codecLines = []);
          new MutationObserver(() => {
            const match = /Preparing video export… [\d,]+ MB of [\d,]+ MB/.exec(
              document.body?.innerText ?? '',
            );
            if (match && lines.at(-1) !== match[0]) lines.push(match[0]);
            const model = /Downloading model files… [\d,]+ MB of [\d,]+ MB/.exec(
              document.body?.innerText ?? '',
            );
            const models = ((globalThis as { __modelLines?: string[] }).__modelLines ??= []);
            if (model && models.at(-1) !== model[0]) models.push(model[0]);
            const status = document.querySelector('.next-status')?.textContent ?? '';
            const seen = ((globalThis as { __statusSeen?: string[] }).__statusSeen ??= []);
            if (status && seen.at(-1) !== status && seen.length < 200) seen.push(status);
          }).observe(document, { subtree: true, childList: true, characterData: true });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        const codec: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        context.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (codecPaths.has(path)) codec.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
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
              await operate(control);
          await chooseCpu(page);
          const dialog = page.locator('.next-download-dialog');
          // The face model first, so the Morph question is the codec's alone.
          await tiles.nth(0).locator('.next-field input').fill('codec first'); // setup
          await tiles.nth(1).locator('.next-field input').fill('codec second'); // setup
          await operate(tiles.nth(0).locator('.next-face-generate'));
          await dialog.waitFor();
          const routeRow = await dialog.locator('[data-download-purpose="generate"]').innerText();
          const routeFigure = /^Generate: ([\d,]+ MB);/.exec(routeRow)?.[1];
          assert.ok(routeFigure, `${name}: the face model row names its bytes: ${routeRow}`);
          await operate(page.locator('.next-download-accept'));
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
          // One figure per purpose: every download status line counts toward the modal's own figure.
          const modelLines = await page.evaluate(
            () => (globalThis as { __modelLines?: string[] }).__modelLines ?? [],
          );
          assert.ok(modelLines.length > 0, `${name}: the face model download was counted`);
          for (const seen of modelLines)
            assert.ok(seen.endsWith(`of ${routeFigure}`), `${name}: ${seen} vs ${routeFigure}`);
          const morph = page.locator('.next-primary-action');
          await operate(morph);
          await dialog.waitFor({ timeout: 60_000 });
          const rows = dialog.locator('[data-download-purpose]');
          assert.equal(await rows.count(), 1, `${name}: only the Generate row`);
          const generate = await dialog.locator('[data-download-purpose="generate"]').innerText();
          assert.ok(
            generate.includes(codecFigure),
            `${name}: the Generate row names the codec's ${codecFigure}: ${generate}`,
          );
          await page.screenshot({ path: join(results, `${name}-codec-asked.png`) });
          assert.deepEqual(codec, [], `${name}: no codec request while the question is open`);
          await operate(dialog.getByRole('button', { name: 'Cancel' }));
          await dialog.waitFor({ state: 'detached' });
          await page.waitForTimeout(2000);
          assert.deepEqual(codec, [], `${name}: no codec request after Cancel`);
          assert.ok(
            await morph.evaluate((el) => el === document.activeElement),
            `${name}: Cancel returns focus to Create morph`,
          );
          await operate(morph);
          await dialog.waitFor({ timeout: 60_000 });
          await operate(page.locator('.next-download-accept'));
          // The status line counts the codec in the modal's unit while it arrives.
          await page.waitForFunction(
            () => ((globalThis as { __codecLines?: string[] }).__codecLines ?? []).length > 0,
            null,
            { timeout: 300_000 },
          );
          const lines = await page.evaluate(
            () => (globalThis as { __codecLines?: string[] }).__codecLines ?? [],
          );
          const status = lines.at(-1)!;
          for (const seen of lines)
            assert.ok(
              seen.endsWith(`of ${codecFigure}`),
              `${name}: status ${seen} vs ${codecFigure}`,
            );
          assert.ok(codec.length > 0, `${name}: the codec is fetched after approval`);
          console.log(
            `fm-9kr8 codec ${name}`,
            JSON.stringify({
              routeFigure,
              modelLine: modelLines.at(-1),
              codecFigure,
              generate,
              status,
              codecRequests: codec.length,
            }),
          );
          await page.screenshot({ path: join(results, `${name}-codec-progress.png`) });
          assert.deepEqual(errors, []);
        } catch (error) {
          await page
            .screenshot({ path: join(results, `${name}-codec-FAILED.png`), fullPage: true })
            .catch(() => {});
          console.log(
            `fm-9kr8 codec ${name} FAILED`,
            JSON.stringify({
              codec,
              statuses: await page
                .evaluate(() => (globalThis as { __statusSeen?: string[] }).__statusSeen ?? [])
                .catch(() => []),
            }),
          );
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

// fm-9kr8: choosing Generate from a fresh-photo consent. Cold profile, built app, Chromium on the CPU route, 1280 px
// mouse and 390 px touch. The photo is chosen through the face card's own chooser and confirmed; in the consent the
// person picks Generate: no photo-side file (detector, encoder) is requested, the face says encoding needs the photo
// encoder and keeps the photo, another face generates normally, and Resume encoding asks again (no chooser) and,
// approved, encodes that same photo.
test(
  'Generate chosen from a photo request: nothing for photos is fetched, the photo is held and later encoded',
  { timeout: 2_400_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-9kr8`;
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
          // Desktop in the light scheme, phone in the dark one: the modal is operated in both (fm-9kr8).
          colorScheme: touch ? 'dark' : 'light',
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        const errors: string[] = [];
        const models: string[] = [];
        let choosers = 0;
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('filechooser', () => choosers++);
        context.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (MODEL.test(path)) models.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
        try {
          const manifestResponse = page.waitForResponse('**/runtime/manifest.json');
          await page.goto(ORIGIN);
          const manifest = (await (await manifestResponse).json()) as Record<string, unknown>;
          type Asset = { url: string; chunks?: { url: string }[] };
          const route = new Set(
            (routeAssets(manifest, 'cpu', 'ort') as Asset[]).flatMap((a) =>
              [a.url, ...(a.chunks ?? []).map((c) => c.url)].map((u) => new URL(u).pathname),
            ),
          );
          const photoSide = () => models.filter((p) => !route.has(p));
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
          const photoTile = tiles.nth(0);
          await operate(photoTile.getByRole('button', { name: 'Change mode', exact: true }));
          const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
          await entry.evaluate(async (el) => {
            const panel = el.closest('.MuiPaper-root');
            await Promise.allSettled(
              (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
            );
          });
          const chooser = page.waitForEvent('filechooser');
          await operate(entry);
          await (await chooser).setFiles(join(REPO, 'tests/crop/fixtures/no-face.jpg'));
          // Faces first (fm-k09b): the photo-setup decision comes before the confirmation, with both purposes.
          const dialog = page.locator('.next-download-dialog');
          const purposes = () =>
            dialog
              .locator('[data-download-purpose]')
              .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-download-purpose')));
          const generateOnly = async () => {
            await dialog.waitFor({ timeout: 120_000 });
            assert.deepEqual(await purposes(), ['generate', 'encode']);
            await operate(dialog.getByRole('radio', { name: 'Generate', exact: true }));
            assert.deepEqual(await purposes(), ['generate']);
            assert.match(await dialog.innerText(), /Encoding needs the photo encoder/);
            await operate(page.locator('.next-download-accept'));
            await dialog.waitFor({ state: 'detached' });
          };
          await dialog.waitFor({ timeout: 120_000 });
          assert.deepEqual(models, [], `${name}: nothing requested before the decision`);
          await generateOnly();
          // Declined, the detector did not run: the confirmation says so neutrally, with no photo file fetched.
          const crop = page.locator('.next-crop-dialog.next-encode-dialog');
          await crop.locator('.next-encode-not-run').waitFor({ timeout: 120_000 });
          assert.deepEqual(
            photoSide(),
            [],
            `${name}: no detector or encoder request after declining`,
          );
          // Its OK still needs the encoder: the same question, answered Generate again, pauses the photo.
          await operate(crop.getByRole('button', { name: 'OK', exact: true }));
          await generateOnly();
          // The photo is paused and held; the face returns to useful generation.
          const paused = photoTile.getByText(
            'Encoding needs the photo encoder. Your chosen photo is kept in this tab.',
          );
          await paused.waitFor({ timeout: 60_000 });
          await page.screenshot({ path: join(results, `${name}-photo-paused.png`) });
          // Another face generates normally, under the Generate approval alone.
          await tiles.nth(1).locator('.next-field input').fill('generate only'); // setup
          await operate(tiles.nth(1).locator('.next-face-generate'));
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 600_000 },
          );
          await page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
          );
          assert.ok(models.length > 0, `${name}: the face model was fetched for Generate`);
          assert.deepEqual(
            photoSide(),
            [],
            `${name}: no detector or encoder request after Generate`,
          );
          assert.ok(await paused.isVisible(), `${name}: the photo is still held`);
          // Resume: no chooser, the same consent asks for the encoder, and the held photo is encoded.
          const chosen = choosers;
          await operate(photoTile.getByRole('button', { name: 'Resume encoding', exact: true }));
          await dialog.waitFor({ timeout: 120_000 });
          assert.deepEqual(
            await dialog
              .locator('[data-download-purpose]')
              .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-download-purpose'))),
            ['generate', 'encode'],
          );
          assert.deepEqual(photoSide(), [], `${name}: still nothing for photos before approval`);
          await operate(page.locator('.next-download-accept'));
          // The verified encoder description can revise the photo scope; that revision is asked again and approved.
          let revisions = 0;
          for (const deadline = Date.now() + 1_200_000; ;) {
            if (
              await page.evaluate(
                () =>
                  // A photo face keeps its photo state; its encoded face is the tile's image.
                  !!document
                    .querySelectorAll('section.next-face')[0]
                    ?.querySelector('[aria-label^="Generated face"], img[alt^="Generated face"]'),
              )
            )
              break;
            assert.ok(Date.now() < deadline, `${name}: the held photo was not encoded`);
            const accept = page.locator('.next-download-accept');
            if (await accept.isVisible()) {
              revisions++;
              assert.ok(revisions <= 2, `${name}: at most one revised photo decision`);
              await operate(accept);
            }
            await page.waitForTimeout(500);
          }
          assert.equal(choosers, chosen, `${name}: Resume did not open the chooser again`);
          assert.ok(photoSide().length > 0, `${name}: the approved encoder was fetched`);
          await page.screenshot({ path: join(results, `${name}-photo-resumed.png`) });
          assert.deepEqual(errors, []);
          console.log(
            `fm-9kr8 generate-only ${name}`,
            JSON.stringify({
              route: models.filter((p) => route.has(p)).length,
              photo: photoSide().length,
              revisions,
            }),
          );
        } catch (error) {
          await page
            .screenshot({ path: join(results, `${name}-generate-only-FAILED.png`), fullPage: true })
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

// fm-9kr8: acquisition failure after approval. The real pinned runtime server sits behind a local HTTPS proxy that
// answers HTTP 500 for one face-model chunk and serves another chunk with one byte flipped, until the test heals
// it. Cold profile, built app, Chromium CPU, 1280 px mouse and 390 px touch: the failure is said in plain words
// where the face is made, with downloaded and remaining bytes in the consent's unit; the operated Retry completes
// the face; every chunk verified before the failure is not downloaded again; a face already made is unchanged.
async function faultServer() {
  const directory = mkdtempSync(join(tmpdir(), 'facemorph-consent-fault-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=next.facemorph.me',
      '-keyout',
      join(directory, 'key'),
      '-out',
      join(directory, 'cert'),
    ],
    { stdio: 'ignore' },
  );
  const faults = { fail: new Set<string>(), corrupt: new Set<string>() };
  const log: { path: string; status: number; bytes: number; complete: boolean }[] = [];
  const server = createServer(
    { key: readFileSync(join(directory, 'key')), cert: readFileSync(join(directory, 'cert')) },
    (request, response) => {
      const path = new URL(request.url!, ORIGIN).pathname;
      const entry = { path, status: 0, bytes: 0, complete: false };
      log.push(entry);
      if (faults.fail.has(path)) {
        entry.status = 500;
        response.writeHead(500, {
          'content-type': 'text/plain',
          'cache-control': 'no-store',
          // The mirror is another origin: as the real one does, it lets the page read its answers.
          'access-control-allow-origin': '*',
        });
        response.end('injected fault');
        return;
      }
      const upstream = requestHttps(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: 'next.facemorph.me' },
          rejectUnauthorized: false,
        },
        (source) => {
          entry.status = source.statusCode!;
          response.writeHead(source.statusCode!, {
            ...source.headers,
            'access-control-allow-origin': source.headers['access-control-allow-origin'] ?? '*',
          });
          let first = true;
          source.on('data', (chunk: Buffer) => {
            let body = chunk;
            if (first && faults.corrupt.has(path) && body.length) {
              body = Buffer.from(body);
              body[0] = body[0]! ^ 0xff;
            }
            first = false;
            entry.bytes += body.length;
            response.write(body);
          });
          source.on('end', () => {
            entry.complete = true;
            response.end();
          });
          source.on('error', (error) => response.destroy(error));
        },
      );
      upstream.on('error', (error) => response.destroy(error));
      request.pipe(upstream);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    faults,
    log,
    port: (server.address() as AddressInfo).port,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test(
  'acquisition failure: plain words and bytes where the face is made, and Retry downloads only what is missing',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-9kr8`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    type Asset = { url: string; chunks?: { url: string }[] };
    const chunks = (routeAssets(manifest, 'cpu', 'ort') as Asset[]).flatMap((a) =>
      (a.chunks ?? []).map((c) => new URL(c.url).pathname),
    );
    assert.ok(chunks.length >= 6, 'the face model is chunked');
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const server = await faultServer();
        const failing = chunks[2]!,
          corrupt = chunks[4]!;
        server.faults.fail.add(failing);
        server.faults.corrupt.add(corrupt);
        const profile = await launchFreshChromiumProfile({
          args: [
            ...chromiumArgs.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
            // The model mirror the app retries a refused chunk from is the same local server, never the internet.
            `--host-resolver-rules=MAP next.facemorph.me:443 127.0.0.1:${server.port}, MAP models.facemorph.me:443 127.0.0.1:${server.port}`,
            '--disable-features=WebGPU',
          ],
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          // Desktop in the light scheme, phone in the dark one: the modal is operated in both (fm-9kr8).
          colorScheme: touch ? 'dark' : 'light',
          ignoreHTTPSErrors: true,
        });
        const page = await profile.context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
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
              await operate(control);
          await chooseCpu(page);
          // A face already made before the failure: the app's own saved still, reinstalled in face 2 with no model.
          // It must be the same face, unchanged, after both failures and the Retry.
          // Setup: dropped on face 2, as a person drags a file (a cold profile's Encode image asks about the
          // encoder first, which this case is not about).
          await tiles.nth(1).scrollIntoViewIfNeeded();
          const dropAt = (await tiles.nth(1).locator('.next-face-image').boundingBox())!;
          await page.evaluate(
            ([x, y, bytes]) => {
              const dt = new DataTransfer();
              dt.items.add(
                new File([new Uint8Array(bytes as number[])], 'saved.png', { type: 'image/png' }),
              );
              const at = document.elementFromPoint(x as number, y as number)!;
              for (const type of ['dragenter', 'dragover', 'drop'])
                at.dispatchEvent(
                  new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
                );
            },
            [
              dropAt.x + dropAt.width / 2,
              dropAt.y + dropAt.height / 2,
              [...readFileSync(join(REPO, 'apps/web/test/fixtures/verify/stills/recovery-v2.png'))],
            ] as const,
          );
          const madeImage = tiles.nth(1).locator('img.next-face-img');
          await madeImage.waitFor({ timeout: 60_000 });
          const made = async () => ({
            state: await tiles.nth(1).getAttribute('data-next-state'),
            src: await madeImage.getAttribute('src'),
            value: await tiles.nth(1).locator('.next-field input').inputValue(),
          });
          const madeBefore = await made();
          // A reinstalled saved face is shown in its project state, its picture in place.
          assert.equal(madeBefore.state, 'project', `${name}: face 2 is made before the failure`);
          assert.ok(madeBefore.src, `${name}: face 2 shows its picture`);
          assert.equal(
            await page.locator('.next-download-dialog').count(),
            0,
            'a saved still asks nothing',
          );
          await tiles.nth(0).locator('.next-field input').fill('fault first'); // setup
          await operate(tiles.nth(0).locator('.next-face-generate'));
          const dialog = page.locator('.next-download-dialog');
          await dialog.waitFor();
          const row = await dialog.locator('[data-download-purpose="generate"]').innerText();
          const figure = /^Generate: ([\d,]+ MB);/.exec(row)?.[1];
          assert.ok(figure, row);
          await operate(page.locator('.next-download-accept'));
          // The failure is said in plain words with the downloaded and remaining bytes in the modal's unit, and
          // Try again is offered; first the damaged chunk, then (healed) the chunk the server keeps refusing.
          const errorBox = page.locator('.next-error');
          const said = async (pattern: RegExp, label: string) => {
            await page
              .waitForFunction(
                (source) =>
                  new RegExp(source).test(document.querySelector('.next-error')?.textContent ?? ''),
                pattern.source,
                { timeout: 600_000 },
              )
              .catch(async (error: unknown) => {
                await page.screenshot({
                  path: join(results, `${name}-fault-${label}-FAILED.png`),
                  fullPage: true,
                });
                console.log(
                  `fm-9kr8 fault ${name} ${label} FAILED`,
                  JSON.stringify({
                    error: await errorBox.innerText().catch(() => ''),
                    status: await page.locator('[role="status"]').allInnerTexts(),
                    log: server.log.slice(-20),
                  }),
                );
                throw error;
              });
            const text = await errorBox.locator('p').first().innerText();
            assert.match(text, pattern, `${name} ${label}: ${text}`);
            assert.doesNotMatch(
              text,
              /integrity|sha|chunk|asset/i,
              `${name} ${label}: plain words`,
            );
            // Kept and remaining, against the consent's own figure, once the verified files are re-measured.
            const mb = (value: string) => Number(value.replace(/[^\d]/g, ''));
            const counted = await page.waitForFunction(
              () => {
                const line = document.querySelector('.next-error-bytes')?.textContent ?? '';
                const m = /^Kept ([\d,]+ MB) of ([\d,]+ MB); ([\d,]+ MB) remaining\.$/.exec(line);
                return m && m[1] !== '0 MB' ? [m[1], m[2], m[3]] : null;
              },
              null,
              { timeout: 30_000 },
            );
            const [kept, total, remaining] = (await counted.jsonValue()) as [
              string,
              string,
              string,
            ];
            assert.equal(total, figure, `${name} ${label}: the modal's figure`);
            assert.ok(
              Math.abs(mb(kept) + mb(remaining) - mb(total)) <= 1,
              `${name} ${label}: ${kept} + ${remaining} = ${total}`,
            );
            await page.screenshot({ path: join(results, `${name}-fault-${label}.png`) });
            return `${text} Kept ${kept} of ${total}; ${remaining} remaining.`;
          };
          const damaged = await said(/^A downloaded model file arrived damaged/, 'damaged');
          server.faults.corrupt.clear();
          await operate(errorBox.getByRole('button', { name: 'Try again', exact: true }));
          const refused = await said(
            /^The model download server had a temporary fault \(HTTP 500\)/,
            'http-500',
          );
          assert.deepEqual(
            await made(),
            madeBefore,
            `${name}: the failures leave face 2 as it was`,
          );
          server.faults.fail.clear();
          const resumedAt = server.log.length;
          await operate(errorBox.getByRole('button', { name: 'Try again', exact: true }));
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[0]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 600_000 },
          );
          // Try again downloads only what the app said remained: the bytes crossing the network after the last
          // Try again are that remaining figure, so no file verified before the failures was fetched again.
          const remaining = /; ([\d,]+) MB remaining\.$/.exec(refused)![1]!.replace(/,/g, '');
          const MiB = 1024 * 1024;
          const resumed = server.log
            .slice(resumedAt)
            .filter((r) => MODEL.test(r.path))
            .reduce((n, r) => n + r.bytes, 0);
          assert.ok(
            Math.abs(resumed - Number(remaining) * MiB) <= MiB,
            `${name}: Try again fetched ${resumed} bytes for ${remaining} MB remaining`,
          );
          assert.deepEqual(
            await made(),
            madeBefore,
            `${name}: the face made before the failure is unchanged`,
          );
          await page.screenshot({ path: join(results, `${name}-fault-recovered.png`) });
          console.log(
            `fm-9kr8 fault ${name}`,
            JSON.stringify({
              figure,
              damaged,
              refused,
              chunkRequests: server.log.filter((r) => chunks.includes(r.path)).length,
              chunks: chunks.length,
              resumedBytes: resumed,
            }),
          );
          assert.deepEqual(errors, []);
        } finally {
          await profile.close();
          await server.close();
        }
      }
    } finally {
      await site.stop();
    }
  },
);

// fm-9kr8: a real browser storage quota that runs out on the model cache write. Chromium's own quota for the
// origin is lowered (Storage.overrideQuotaForOrigin) below the face model, so its Cache Storage write fails with a
// real QuotaExceededError. Cold profile, built app, Chromium CPU, 1280 px mouse and 390 px touch.
test(
  'storage quota: the model cache write fails with a real QuotaExceededError, worded as storage, and Save works',
  { timeout: 1_800_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-9kr8`;
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
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        // A real on-disk profile: an incognito context keeps a fixed in-memory quota the override cannot lower.
        const profile = await launchFreshChromiumProfile({
          args: [...chromiumArgs, '--disable-features=WebGPU'],
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
        });
        const context = profile.context;
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await context.addInitScript(() => {
          const seen: string[] = ((globalThis as { __statusSeen?: string[] }).__statusSeen = []);
          new MutationObserver(() => {
            const text = [...document.querySelectorAll('[role="status"], [role="alert"]')]
              .map((el) => el.textContent ?? '')
              .join(' | ');
            if (text && seen.at(-1) !== text && seen.length < 400) seen.push(text);
          }).observe(document, { subtree: true, childList: true, characterData: true });
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
        try {
          await page.goto(ORIGIN);
          const cdp = await context.newCDPSession(page);
          await cdp.send(
            'Storage.overrideQuotaForOrigin' as never,
            { origin: new URL(page.url()).origin, quotaSize: 40 * 1024 * 1024 } as never,
          );
          await page.reload();
          // The browser's own enforced quota (estimate() reports a fixed figure under automation).
          const quota = (await cdp.send(
            'Storage.getUsageAndQuota' as never,
            { origin: new URL(page.url()).origin } as never,
          )) as unknown as { quota: number; overrideActive: boolean };
          assert.ok(
            quota.overrideActive && quota.quota <= 40 * 1024 * 1024,
            `${name}: the lowered quota applies`,
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
          await tiles.nth(0).locator('.next-field input').fill('quota first'); // setup
          await operate(tiles.nth(0).locator('.next-face-generate'));
          const dialog = page.locator('.next-download-dialog');
          await dialog.waitFor();
          const warning = await dialog
            .locator('.next-download-storage')
            .innerText()
            .catch(() => '');
          await operate(page.locator('.next-download-accept'));
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[0]?.getAttribute('data-next-state') ===
                'filled' || !!document.querySelector('.next-error'),
            null,
            { timeout: 600_000 },
          );
          await page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
          );
          const statuses = await page.evaluate(
            () => (globalThis as { __statusSeen?: string[] }).__statusSeen ?? [],
          );
          const filled = (await tiles.nth(0).getAttribute('data-next-state')) === 'filled';
          let saved = false;
          if (filled) {
            const download = page.waitForEvent('download', { timeout: 60_000 });
            await operate(tiles.nth(0).getByRole('button', { name: 'Save image', exact: true }));
            saved = (await (await download).path()) !== null;
          }
          await page.screenshot({ path: join(results, `${name}-quota.png`), fullPage: true });
          console.log(
            `fm-9kr8 quota ${name}`,
            JSON.stringify({
              quota: quota.quota,
              after: await cdp.send(
                'Storage.getUsageAndQuota' as never,
                { origin: new URL(page.url()).origin } as never,
              ),
              warning,
              filled,
              saved,
              statuses: statuses.filter((line) => /storage|kept|keep/i.test(line)).slice(0, 6),
            }),
          );
          // The quota really refused the writes, the face was still made and saved, and the page says the
          // model was not kept, as storage (never as a limit of the device).
          const after = (await cdp.send(
            'Storage.getUsageAndQuota' as never,
            { origin: new URL(page.url()).origin } as never,
          )) as unknown as { usage: number; quota: number };
          assert.ok(
            after.usage <= after.quota && after.usage < 158 * 1024 * 1024,
            `${name}: storage refused`,
          );
          assert.ok(filled, `${name}: the face is made`);
          assert.ok(saved, `${name}: Save works`);
          const kept = statuses.find((line) =>
            line.includes('could not keep the downloaded model'),
          );
          assert.ok(kept, `${name}: the page says the model was not kept`);
          assert.match(kept, /browser storage is full/);
          assert.doesNotMatch(kept, /cannot run|not supported|capab/i);
          assert.deepEqual(errors, []);
        } finally {
          await profile.close();
        }
      }
    } finally {
      await site.stop();
    }
  },
);
