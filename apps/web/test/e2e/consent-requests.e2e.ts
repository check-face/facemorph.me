// fm-qrfz: the built app's model requests follow the person's decision. Cold profile, the identified build:next
// destination with the real bridge, workers and runtime bytes, Chromium on the CPU route, 1280 px (mouse) and 390 px
// (touch), controls pressed at their visible centres:
// - arrival, the open download question, and Cancel: zero model requests;
// - approval: only this route's files (the served manifest's routeAssets), never the photo detector or encoder;
// - a second Generate inside the approved scope asks nothing and still requests only route files.
// Requests are classed by path against the URLs (and chunk URLs) the served manifest gives this route's files.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/consent-requests.e2e.ts
import assert from 'node:assert/strict';
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
    const synthesis = paths(routeAssets(manifest, 'cpu', 'ort') as Asset[]),
      encoder = paths(descriptor.steps);
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const server = await overlapServer(encoder);
    const profile = await launchFreshChromiumProfile({
      args: [
        ...chromiumArgs.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
        `--host-resolver-rules=MAP next.facemorph.me:443 127.0.0.1:${server.port}`,
        '--disable-features=WebGPU',
      ],
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
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
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(() => {
      const state = { encodes: 0, queuedAt: 0, encodingAt: 0, completedAt: 0 };
      (window as unknown as { __consentOverlap: typeof state }).__consentOverlap = state;
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
    try {
      await page.goto(ORIGIN);
      const tiles = page.locator('section.next-face');
      await tiles.nth(1).waitFor();
      // Inventory replaces the initial unknown-size toast. Wait for its real bounded offer;
      // the transient Ask me later control can disappear before a pointer reaches it.
      await page
        .locator('.next-model-toast')
        .getByRole('button', { name: /^Plus photo encoder/ })
        .waitFor();
      await chooseCpu(page);
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

      // The current shipped entry is operated as rendered. fm-9kr8 owns its replacement beside Processing mode.
      const prepare = page
        .locator('.next-model-toast')
        .getByRole('button', { name: /^Plus photo encoder/ });
      await prepare.waitFor();
      times['approved'] = performance.now();
      await operate(prepare);
      await page.waitForFunction(() => !!document.querySelector('.next-model-toast'), null, {
        timeout: 30_000,
      });
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
      times['encoderFirstByte'] = server.log.find(
        (row) => encoder.has(row.path) && row.bytes > 0,
      )!.firstByte;
      assert.ok(transferring());
      times['seedRequested'] = performance.now();
      await operate(tiles.nth(0).locator('.next-face-generate'));
      await tiles.nth(0).locator('.next-face-img').waitFor({ timeout: 900_000 });
      times['firstUsefulFace'] = performance.now();
      assert.ok(
        transferring(),
        'first useful seed face precedes completion of the encoder transfer',
      );

      times['photoChoose'] = performance.now();
      // This initialized text face has a value, so its image area is a Generate hint, not the
      // empty-face chooser. Open its actual mode menu, then press the rendered photo entry.
      await operate(tiles.nth(1).getByRole('button', { name: 'Change mode', exact: true }));
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
      times['cropVisible'] = performance.now();
      assert.ok(
        transferring(),
        'choosing and crop inspection overlap a real incomplete encoder response',
      );
      await operate(crop.getByRole('button', { name: 'ADJUST CROP', exact: true }));
      const area = crop.getByRole('application', { name: 'Crop area' });
      await area.waitFor();
      times['cropInputStart'] = performance.now();
      await area.focus();
      await page.keyboard.press('+');
      await page.keyboard.press('-');
      times['cropInputEnd'] = performance.now();
      await operate(crop.getByRole('button', { name: 'Use Crop', exact: true }));
      assert.ok(transferring());
      times['cropOK'] = performance.now();
      await operate(crop.getByRole('button', { name: 'OK', exact: true }));
      // Descriptor discovery may require an explicit revised decision; no failed encoder attempt may precede it.
      const deadline = performance.now() + 120_000;
      while (
        (await page.evaluate(
          () =>
            (window as unknown as { __consentOverlap: { encodes: number } }).__consentOverlap
              .encodes,
        )) === 0
      ) {
        if (performance.now() > deadline) throw Error('Crop OK never queued its encoder');
        const accept = page.locator('.next-download-accept');
        if (await accept.isVisible()) await operate(accept);
        await page.waitForTimeout(100);
      }
      assert.ok(transferring(), 'OK queues encoding before its assets finish');
      observed['beforeRelease'] = await page.evaluate('window.__consentOverlap');
      assert.equal((observed['beforeRelease'] as { encodes: number }).encodes, 1);
      times['transferReleased'] = performance.now();
      server.release();
      await tiles.nth(1).locator('.next-face-img').waitFor({ timeout: 900_000 });
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
      assert.deepEqual(errors, []);
      assert.deepEqual(
        [...network.values()].filter((row) => new URL(row.url).origin !== ORIGIN),
        [],
        'all requests used the pinned local server, including any differently pathed model mirror',
      );
      await page.screenshot({ path: join(results, 'desktop-overlap-complete.png') });
      observed['firstModelRequest'] = modelRequests()[0];
      // Keep this literal: a descriptor fetched before generator assets is an acceptance gap, not a pass.
      assert.ok(
        synthesis.has(modelRequests()[0]!.path),
        `approval must request generator assets first; saw ${modelRequests()[0]!.path}`,
      );
    } finally {
      await Promise.allSettled(measurements);
      observed['visibleAtEnd'] = await page
        .locator('body')
        .innerText()
        .catch(() => 'page unavailable');
      await page
        .screenshot({ path: join(results, 'desktop-overlap-final.png'), fullPage: true })
        .catch(() => {});
      const evidence = {
        artifact: artifact.identity.deploySource,
        runtime: site.manifestSha256,
        times,
        observed,
        errors,
        requests: server.log,
        network: [...network.values()],
      };
      writeFileSync(join(results, 'desktop-overlap.json'), JSON.stringify(evidence, null, 2));
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
