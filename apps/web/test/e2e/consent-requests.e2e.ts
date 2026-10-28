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
          // Escape, the backdrop and Back each equal Cancel (fm-9kr8): nothing fetched, and focus is back on the
          // Generate control that asked.
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
      await crop.locator('.next-encode-preview img').waitFor({ timeout: 120_000 });
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
      await operate(crop.getByRole('button', { name: 'Use Crop', exact: true }));
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
      assert.deepEqual(
        warmRequests.filter((row) => row.hostClass !== 'app'),
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
