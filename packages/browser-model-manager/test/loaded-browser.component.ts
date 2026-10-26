// Isolated fm-fy2.13 loaded-handle component: real pinned CPU model + browser ORT/WASM,
// native OPFS and Web Locks. Keep this out of the fast acquisition timing suite.
// Android: tools/device-lab/android.py run --route cpu -- env FACEMORPH_REQUIRE_RUNTIME=1
// FACEMORPH_RUNTIME_CACHE=<verified runtime> node --test <this file>
// The runner supplies ANDROID_SERIAL and FACEMORPH_ANDROID_CDP; FACEMORPH_MANAGER_CDP overrides the endpoint.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type { BrowserContext, CDPSession, Page } from 'playwright';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const REPO = new URL('../../..', import.meta.url).pathname;
const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ??
  [
    join(homedir(), '.cache/facemorph-device-lab/runtime-public'),
    join(homedir(), '.cache/facemorph-runtime'),
  ].find((root) => existsSync(join(root, 'manifest.json'))) ??
  '';
const MANIFEST_SHA = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const CDP = process.env['FACEMORPH_MANAGER_CDP'] ?? process.env['FACEMORPH_ANDROID_CDP'];
const ANDROID_SERIAL = process.env['ANDROID_SERIAL'];
const WORKER = process.env['FACEMORPH_MANAGER_WORKER'] === '1';
const BACKEND = process.env['FACEMORPH_MANAGER_BACKEND'] ?? 'opfs';
assert.ok(['opfs', 'cache-storage'].includes(BACKEND), 'unknown loaded component backend');
const adb = (...args: string[]): string =>
  execFileSync('adb', ['-s', ANDROID_SERIAL!, ...args], { encoding: 'utf8', timeout: 15000 });
const clearTaskStorage = async (page: Page) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(async () => {
        for (const name of await caches.keys()) await caches.delete(name);
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('task origin cleanup exceeded 3 seconds')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Attach only to the explicitly leased emulator. Never launch/restart Chrome or change its profile. */
async function emulatorBrowser(endpoint: string) {
  assert.ok(
    ANDROID_SERIAL === 'emulator-5560' || ANDROID_SERIAL === 'emulator-5554',
    'CDP mode requires the explicit local or hosted task emulator serial',
  );
  assert.equal(
    adb('shell', 'getprop', 'ro.kernel.qemu').trim(),
    '1',
    'CDP target must be an actual emulator',
  );
  const url = new URL(endpoint);
  assert.ok(
    ['http:', 'ws:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'emulator CDP must use a loopback adb-forwarded endpoint',
  );
  const port = url.port || (url.protocol === 'http:' ? '80' : '');
  const forwarded = adb('forward', '--list')
    .trim()
    .split('\n')
    .some((line) => {
      const [serial, local, remote] = line.trim().split(/\s+/);
      return (
        serial === ANDROID_SERIAL &&
        local === `tcp:${port}` &&
        remote === 'localabstract:chrome_devtools_remote'
      );
    });
  assert.ok(forwarded, 'CDP endpoint must be the actual task emulator Chrome DevTools adb forward');
  const nativeVersion = (await (
    await fetch(new URL('/json/version', `http://${url.host}`), {
      signal: AbortSignal.timeout(5000),
    })
  ).json()) as { 'Android-Package'?: string; Browser?: string };
  assert.ok(
    ['org.chromium.chrome', 'com.android.chrome'].includes(nativeVersion['Android-Package'] ?? ''),
    'forwarded CDP must report an actual supported Android Chromium package',
  );
  const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))(
    'playwright',
  ) as typeof import('playwright');
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 30000, noDefaults: true });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close(); // For connectOverCDP this disconnects the transport; it does not stop Chrome.
    throw new Error('emulator Chrome has no default browser context');
  }
  return {
    engine: 'android-emulator-chromium',
    browser,
    unavailable: false as const,
    existingContext: context,
    androidPackage: nativeVersion['Android-Package'],
  };
}

interface Evidence {
  threads: number;
  warm: {
    milliseconds: number;
    rgbaBytes: number;
    digest: string;
    canary: { passed: boolean; maxRgb: number; maxFloat: number };
  };
  rows: {
    cause: string;
    settledMs: number;
    after: { generator: { liveSessions: number }; leases: string[] };
    nativeLocksReleased: boolean;
  }[];
}

test(
  'loaded CPU browser handles: release and actual leased-file loss/corruption settle pending operations and release native resources',
  { timeout: 300_000 },
  async (t) => {
    const manifestPath = join(RUNTIME, 'manifest.json');
    if (!RUNTIME || !existsSync(manifestPath)) {
      const reason =
        'untested: acquire the pinned CPU runtime with FACEMORPH_RUNTIME_CACHE or the device lab';
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw new Error(reason);
      return t.skip(reason);
    }
    const bytes = readFileSync(manifestPath);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), MANIFEST_SHA);
    const selection = CDP ? await emulatorBrowser(CDP) : await componentBrowser();
    const { engine, browser, unavailable } = selection;
    if (!browser) return t.skip(String(unavailable));
    const work = mkdtempSync(join(tmpdir(), 'manager-loaded-browser-'));
    const evidencePath = join(
      REPO,
      'test-results/manager-cache',
      engine,
      `loaded-browser${WORKER ? '-worker' : ''}${BACKEND === 'opfs' ? '' : '-cache-storage'}.json`,
    );
    let context: BrowserContext | undefined;
    let server: Server | undefined;
    let page: Page | undefined;
    let pageSession: CDPSession | undefined;
    let origin: string | undefined;
    let reversePort: number | undefined;
    const protocolTrace: { event: string; payload: unknown }[] = [];
    const recordProtocol = (event: string, payload: unknown) => {
      if (protocolTrace.length < 1000) protocolTrace.push({ event, payload });
    };
    t.after(async () => {
      const failures: unknown[] = [];
      const clean = async (run: () => unknown | Promise<unknown>) => {
        try {
          await run();
        } catch (error) {
          failures.push(error);
        }
      };
      // Closing a connected default context would stop its other tabs. Only our page is ours.
      if (CDP) {
        if (page && !page.isClosed()) {
          if (WORKER)
            await clean(() =>
              page!.evaluate(() =>
                (globalThis as unknown as { loadedWorker?: Worker }).loadedWorker?.terminate(),
              ),
            );
          await clean(() => clearTaskStorage(page!));
        }
        if (pageSession) {
          await pageSession
            .send('Security.setOverrideCertificateErrors', { override: false })
            .catch(() => {});
          await pageSession.detach().catch(() => {});
        }
        await clean(() => page?.close());
      } else await clean(() => context?.close());
      // Verified in installed Playwright1.64.1: CDP browserProcess.close closes only its WebSocket.
      // Never call context.close() or the protocol Browser.close command on the attached browser.
      await clean(() => browser.close());
      if (reversePort !== undefined)
        await clean(() => adb('reverse', '--remove', `tcp:${reversePort}`));
      if (server) {
        server.closeAllConnections();
        await clean(() => new Promise<void>((done) => server!.close(() => done())));
      }
      await clean(() => rmSync(work, { recursive: true, force: true }));
      if (failures.length) throw new AggregateError(failures, 'loaded component cleanup failed');
    });
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
        '/CN=127.0.0.1',
        '-keyout',
        join(work, 'key.pem'),
        '-out',
        join(work, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    const roots = {
      '/stylegan/': join(work, 'stylegan'),
      '/manager/': join(work, 'manager'),
      '/runtime/': RUNTIME,
    };
    for (const [pkg, output] of [
      ['stylegan-js', roots['/stylegan/']],
      ['browser-model-manager', roots['/manager/']],
    ]) {
      execFileSync(process.execPath, [
        join(REPO, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(REPO, 'packages', pkg!, 'tsconfig.build.json'),
        '--outDir',
        output!,
      ]);
    }
    let allowRuntime = true;
    const served: { path: string; bytes: number; finished: boolean; allowed: boolean }[] = [];
    server = createServer(
      { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
      (req, res) => {
        const path = new URL(req.url ?? '/', 'https://local').pathname;
        const headers = {
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cross-origin-resource-policy': 'same-origin',
          'cache-control': 'no-store',
        };
        if (path === '/')
          return void res
            .writeHead(200, { ...headers, 'content-type': 'text/html' })
            .end('<!doctype html><title>Loaded browser component</title>');
        if (path === '/manager-loaded-worker.mjs')
          return void res
            .writeHead(200, { ...headers, 'content-type': 'text/javascript' })
            .end(readFileSync(join(REPO, 'apps/web/tests/mobile/manager-loaded-worker.mjs')));
        if (path === '/case.js' || path === '/manager-loaded-driver.mjs')
          return void res
            .writeHead(200, { ...headers, 'content-type': 'text/javascript' })
            .end(readFileSync(new URL('./support/loaded-runtime-browser.mjs', import.meta.url)));
        const prefix = Object.keys(roots).find((candidate) => path.startsWith(candidate)) as
          | keyof typeof roots
          | undefined;
        if (!prefix) return void res.writeHead(404, headers).end();
        const file = resolve(roots[prefix], path.slice(prefix.length));
        if (!file.startsWith(`${resolve(roots[prefix])}/`) || !existsSync(file))
          return void res.writeHead(404, headers).end();
        let entry: (typeof served)[number] | undefined;
        if (prefix === '/runtime/') {
          entry = { path, bytes: 0, finished: false, allowed: allowRuntime };
          served.push(entry);
          if (!allowRuntime) return void res.writeHead(410, headers).end();
          res.once('finish', () => {
            entry!.finished = true;
          });
        }
        const stream = createReadStream(file);
        if (entry)
          stream.on('data', (piece) => {
            entry!.bytes += piece.length;
          });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        res.writeHead(200, {
          ...headers,
          'content-type':
            extname(file) === '.js' || extname(file) === '.mjs'
              ? 'text/javascript'
              : extname(file) === '.wasm'
                ? 'application/wasm'
                : 'application/octet-stream',
        });
        stream.pipe(res);
      },
    );
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    origin = `https://127.0.0.1:${port}`;
    if (CDP) {
      // --no-rebind refuses another task's mapping; only this exact mapping is removed on exit.
      adb('reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`);
      reversePort = port;
    }
    const manifest = JSON.parse(
      bytes.toString().replaceAll('https://next.facemorph.me/runtime/', `${origin}/runtime/`),
    );
    context =
      'existingContext' in selection
        ? selection.existingContext
        : await selection.newContext!({ ignoreHTTPSErrors: true });
    if (CDP)
      assert.ok(
        context.pages().every((existing) => new URL(existing.url()).origin !== origin),
        'ephemeral origin is already open in an existing emulator tab',
      );
    page = await context.newPage();
    const taskPage = page;
    let phase = 'setup';
    const requests: { url: string; phase: string }[] = [];
    const recordRequest = (request: import('playwright').Request) => {
      requests.push({ url: request.url(), phase });
    };
    if (CDP) taskPage.on('request', recordRequest);
    else context.on('request', recordRequest);
    page.on('console', (message) => {
      if (message.type() === 'error') t.diagnostic(`browser: ${message.text()}`);
    });
    // With snapshots disabled Playwright omits DOM/network payload snapshots, including model bodies.
    // Shared CDP contexts use page-only native protocol events, preserving other tabs' traces.
    if (!CDP) await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    try {
      if (CDP) {
        pageSession = await context.newCDPSession(taskPage);
        const session = pageSession;
        session.on('Security.certificateError', (event) => {
          // Native certificate handling is restricted to this page's unique task origin.
          const action = new URL(event.requestURL).origin === origin ? 'continue' : 'cancel';
          recordProtocol('Security.certificateError', { requestURL: event.requestURL, action });
          void session
            .send('Security.handleCertificateError', { eventId: event.eventId, action })
            .catch((error) =>
              recordProtocol('Security.handleCertificateError.failed', String(error)),
            );
        });
        session.on('Page.lifecycleEvent', (event) => recordProtocol('Page.lifecycleEvent', event));
        session.on('Runtime.exceptionThrown', (event) =>
          recordProtocol('Runtime.exceptionThrown', {
            text: event.exceptionDetails.text,
            url: event.exceptionDetails.url,
            description: event.exceptionDetails.exception?.description,
          }),
        );
        await session.send('Page.enable');
        await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
        await session.send('Runtime.enable');
        await session.send('Security.enable');
        await session.send('Security.setOverrideCertificateErrors', { override: true });
      }
      await page.goto(origin);
      if (CDP) await clearTaskStorage(page);
      const identity = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        secureContext: globalThis.isSecureContext,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        origin: location.origin,
      }));
      if (CDP)
        assert.equal(
          identity.secureContext,
          true,
          'the native Android HTTPS origin must be secure',
        );
      const setup = await page.evaluate(
        async ({ manifest, digest, worker, backend }) => {
          if (worker) {
            const native = new Worker('/manager-loaded-worker.mjs', { type: 'module' });
            const host = globalThis as unknown as {
              loadedDriver: { run(): Promise<Evidence> };
              loadedWorker: Worker;
            };
            host.loadedWorker = native;
            return await new Promise<{ assets: number; bytes: number; remainingBytes: number }>(
              (resolve, reject) => {
                native.onerror = (event) => reject(new Error(`native worker: ${event.message}`));
                native.onmessageerror = () =>
                  reject(new Error('native worker message clone failed'));
                native.onmessage = ({ data }) => {
                  if (data.type === 'error') {
                    reject(new Error(data.error));
                    return;
                  }
                  if (
                    data.type !== 'acquired' ||
                    data.backend !== backend ||
                    data.secureContext !== true
                  ) {
                    reject(new Error('native acquired worker identity differs'));
                    return;
                  }
                  host.loadedDriver = {
                    run: () =>
                      new Promise<Evidence>((resolveRun, rejectRun) => {
                        native.onerror = (event) =>
                          rejectRun(new Error(`native worker: ${event.message}`));
                        native.onmessageerror = () =>
                          rejectRun(new Error('native worker message clone failed'));
                        native.onmessage = ({ data }) => {
                          if (
                            data.type === 'result' &&
                            data.backend === backend &&
                            data.secureContext === true
                          )
                            resolveRun(data.result);
                          else
                            rejectRun(
                              new Error(data.error ?? 'native worker result identity differs'),
                            );
                        };
                        native.postMessage({ type: 'run' });
                      }),
                  };
                  resolve(data.setup);
                };
                native.postMessage({ type: 'acquire', manifest, manifestSha256: digest, backend });
              },
            );
          }
          const load = (path: string) => import(path);
          const driver = await load('/case.js');
          (globalThis as unknown as { loadedDriver: typeof driver }).loadedDriver = driver;
          return driver.acquire(manifest, digest, { backend }) as Promise<{
            assets: number;
            bytes: number;
            remainingBytes: number;
          }>;
        },
        { manifest, digest: MANIFEST_SHA, worker: WORKER, backend: BACKEND },
      );
      assert.equal(setup.remainingBytes, 0);
      assert.ok(served.length > 0 && served.every((entry) => entry.finished && entry.allowed));
      t.diagnostic(
        `${engine}: acquired ${setup.assets} pinned assets / ${setup.bytes} bytes; starting loaded-handle CPU component`,
      );
      phase = 'loaded';
      allowRuntime = false;
      const result = await page.evaluate(async () => {
        const driver = (globalThis as unknown as { loadedDriver: { run(): Promise<Evidence> } })
          .loadedDriver;
        return driver.run();
      });
      assert.deepEqual(
        result.rows.map((row) => row.cause),
        ['release', 'browser-eviction', 'corruption'],
      );
      assert.equal(result.warm.rgbaBytes, 1024 * 1024 * 4);
      assert.ok(
        result.warm.canary.passed &&
          result.warm.canary.maxRgb <= 1 &&
          result.warm.canary.maxFloat <= 0.002,
      );
      for (const row of result.rows) {
        assert.equal(row.after.generator.liveSessions, 0);
        assert.deepEqual(row.after.leases, []);
        assert.equal(row.nativeLocksReleased, true);
      }
      const loadedRequests = requests.filter(
        (request) => request.phase === 'loaded' && /^https?:/.test(request.url),
      );
      assert.deepEqual(
        loadedRequests,
        [],
        'loaded model operations must make zero HTTP requests of every host class',
      );
      assert.ok(
        served.every((entry) => entry.allowed),
        'no hidden network repair',
      );
      mkdirSync(join(REPO, 'test-results/manager-cache', engine), { recursive: true });
      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            engine,
            browserVersion: browser.version(),
            androidSerial: CDP ? ANDROID_SERIAL : undefined,
            androidPackage: 'androidPackage' in selection ? selection.androidPackage : undefined,
            identity,
            backend: BACKEND,
            nativeWorker: WORKER,
            setup,
            result,
            loadedRequests,
            served,
          },
          null,
          2,
        ),
      );
      await page.screenshot({ path: evidencePath.replace('.json', '.png'), timeout: 3000 });
      if (CDP)
        writeFileSync(
          evidencePath.replace('.json', '.trace.json'),
          JSON.stringify(protocolTrace, null, 2),
        );
      else await context.tracing.stop();
      t.diagnostic(`${engine}: ${JSON.stringify(result)}; evidence ${evidencePath}`);
    } catch (error) {
      mkdirSync(join(REPO, 'test-results/manager-cache', engine), { recursive: true });
      writeFileSync(
        evidencePath.replace('.json', '-failure.json'),
        JSON.stringify(
          {
            engine,
            browserVersion: browser.version(),
            androidSerial: CDP ? ANDROID_SERIAL : undefined,
            androidPackage: 'androidPackage' in selection ? selection.androidPackage : undefined,
            error: String(error),
            phase,
            requests,
            served,
          },
          null,
          2,
        ),
      );
      await page
        .screenshot({ path: evidencePath.replace('.json', '-failure.png'), timeout: 3000 })
        .catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          CDP
            ? Promise.resolve(
                writeFileSync(
                  evidencePath.replace('.json', '-failure.trace.json'),
                  JSON.stringify(protocolTrace, null, 2),
                ),
              )
            : context.tracing
                .stop({ path: evidencePath.replace('.json', '-failure.zip') })
                .catch(() => {}),
          new Promise<void>((done) => {
            timer = setTimeout(done, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      throw error;
    }
  },
);
