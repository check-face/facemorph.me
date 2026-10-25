// Native persistence timing (fm-fy2.13): the observer forwards the browser's original method,
// receiver, arguments and Promise. No permission is pre-granted and no result is simulated.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const { engine, browser, newContext, unavailable } = await componentBrowser();
const work = mkdtempSync(join(tmpdir(), 'manager-storage-permission-'));
const built = join(work, 'dist');
let server: ReturnType<typeof createServer> | undefined;
let permissionBrowser: Browser | undefined;
test.after(async () => {
  await permissionBrowser?.close();
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(work, { recursive: true, force: true });
});

interface NativeCall {
  stage: string;
  time: number;
  active: boolean;
  trustedClick: boolean;
  result?: boolean;
  error?: string;
}
interface PermissionEvidence {
  stage: string;
  calls: NativeCall[];
  checkpoints: { stage: string; calls: number }[];
  click?: { trusted: boolean; active: boolean; time: number };
  requestedStatus?: { persistence: string };
  observedStatus?: { persistence: string };
  permissionBefore?: string;
  permissionAfter?: string;
  settled: boolean;
  error?: string;
}

const observeSource = String.raw`
const state = window.permissionEvidence = { stage: 'before-import', calls: [], checkpoints: [], settled: false };
const storage = navigator.storage;
const nativePersist = storage?.persist;
if (typeof nativePersist !== 'function') {
  window.permissionUntested = 'navigator.storage.persist is not a native method in this browser';
} else {
  // Return the original Promise, preserving the native API's settlement and permission decision.
  const observedPersist = function (...args) {
    const call = { stage: state.stage, time: performance.now(), active: navigator.userActivation?.isActive === true, trustedClick: state.click?.trusted === true };
    state.calls.push(call);
    let promise;
    try { promise = Reflect.apply(nativePersist, this, args); }
    catch (error) { call.error = String(error); throw error; }
    promise.then(result => { call.result = result; }, error => { call.error = String(error); });
    return promise;
  };
  storage.persist = observedPersist;
  if (storage.persist !== observedPersist) throw new Error('native persist observer could not be installed');
  window.restorePersistenceObserver = () => { storage.persist = nativePersist; };
  try {
    state.stage = 'import';
    const manager = await import('/pkg/index.js');
    state.checkpoints.push({ stage: state.stage, calls: state.calls.length });
    window.completePersistenceSetup = async () => {
      state.stage = 'construction';
      await manager.createBrowserModelCache();
      state.checkpoints.push({ stage: state.stage, calls: state.calls.length });
      state.stage = 'default-status';
      state.observedStatus = await manager.storageStatus();
      try { state.permissionBefore = (await navigator.permissions.query({ name: 'persistent-storage' })).state; }
      catch (error) { state.permissionBefore = 'query unavailable: ' + String(error); }
      state.checkpoints.push({ stage: state.stage, calls: state.calls.length });
      state.stage = 'awaiting-approval';
      document.querySelector('button').addEventListener('click', async event => {
        state.click = { trusted: event.isTrusted, active: navigator.userActivation?.isActive === true, time: performance.now() };
        state.stage = 'approved-request';
        try {
          state.requestedStatus = await manager.storageStatus({ requestPersistence: true });
          state.stage = 'after-request-default-status';
          state.observedStatus = await manager.storageStatus();
          try { state.permissionAfter = (await navigator.permissions.query({ name: 'persistent-storage' })).state; }
          catch (error) { state.permissionAfter = 'query unavailable: ' + String(error); }
        } catch (error) { state.error = String(error); }
        finally { state.settled = true; }
      }, { once: true });
    };
  } catch (error) { state.error = String(error); throw error; }
}
`;

test(
  `${engine}: native persistence is requested exactly once after explained trusted approval, never at import/construction/status`,
  { skip: unavailable, timeout: 60_000 },
  async (t) => {
    execFileSync(process.execPath, [
      join(REPO, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(PKG, 'tsconfig.build.json'),
      '--outDir',
      built,
    ]);
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
    const serverRequests: string[] = [];
    server = createServer(
      { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
      (req, res) => {
        const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
        serverRequests.push(path);
        res.setHeader('cache-control', 'no-store');
        if (path === '/') {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(
            '<!doctype html><title>Native storage approval</title><p>Keeping downloaded models in persistent storage can reduce repeat downloads. Browser eviction policies still apply.</p><button>Approve download and request persistent storage</button>',
          );
        }
        if (path.startsWith('/pkg/')) {
          try {
            const body = readFileSync(join(built, path.slice(5)));
            res.writeHead(200, { 'content-type': 'text/javascript' });
            return res.end(body);
          } catch {
            /* 404 below */
          }
        }
        res.writeHead(404);
        res.end();
      },
    );
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Firefox's headless permission prompt cannot be clicked through the page. Use its real
    // ordinary deny-by-default permission policy; persist itself is never replaced or simulated.
    if (engine === 'firefox') {
      const playwright = createRequire(new URL('../../../apps/web/package.json', import.meta.url))(
        'playwright',
      ) as typeof import('playwright');
      permissionBrowser = await playwright.firefox.launch({
        firefoxUserPrefs: { 'permissions.default.persistent-storage': 2 },
      });
    }
    const context = permissionBrowser
      ? await permissionBrowser.newContext({ ignoreHTTPSErrors: true })
      : await newContext!({ ignoreHTTPSErrors: true });
    const network: { url: string; phase: string }[] = [];
    let phase = 'bootstrap';
    context.on('request', (request) => network.push({ url: request.url(), phase }));
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    try {
      await page.goto(origin);
      await page.evaluate('(async () => {' + observeSource + '})()');
      const untested = await page.evaluate(
        () => (window as unknown as { permissionUntested?: string }).permissionUntested,
      );
      if (untested) {
        t.skip(`untested: ${engine}: ${untested}`);
        return;
      }
      // The complete package import graph is loaded; all following work is local storage/permission I/O.
      const before = serverRequests.length;
      phase = 'local-permission-request';
      await context.route(/^https?:\/\//, (route) => route.abort('blockedbyclient'));
      await page.evaluate(() =>
        (
          window as unknown as { completePersistenceSetup: () => Promise<void> }
        ).completePersistenceSetup(),
      );
      const beforeApproval = await page.evaluate(
        () => (window as unknown as { permissionEvidence: PermissionEvidence }).permissionEvidence,
      );
      assert.equal(beforeApproval.error, undefined);
      assert.deepEqual(beforeApproval.checkpoints, [
        { stage: 'import', calls: 0 },
        { stage: 'construction', calls: 0 },
        { stage: 'default-status', calls: 0 },
      ]);
      assert.equal(beforeApproval.stage, 'awaiting-approval');
      assert.equal(beforeApproval.calls.length, 0);
      await page
        .getByRole('button', { name: 'Approve download and request persistent storage' })
        .click();
      await page.waitForFunction(
        () =>
          (window as unknown as { permissionEvidence: PermissionEvidence }).permissionEvidence
            .settled,
        undefined,
        { timeout: 20_000 },
      );
      const after = await page.evaluate(
        () => (window as unknown as { permissionEvidence: PermissionEvidence }).permissionEvidence,
      );
      assert.equal(after.error, undefined);
      assert.deepEqual(
        network.filter(
          (request) => request.phase === 'local-permission-request' && /^https?:/.test(request.url),
        ),
        [],
        'permission/status work attempted hidden network I/O',
      );
      assert.equal(serverRequests.length, before);
      assert.equal(after.click?.trusted, true, 'approval must be a real trusted browser click');
      assert.equal(after.click?.active, true, 'approval click must have transient user activation');
      assert.equal(
        after.calls.length,
        1,
        'explicit approval must invoke native persist exactly once',
      );
      const call = after.calls[0]!;
      assert.equal(call.stage, 'approved-request');
      assert.equal(call.trustedClick, true);
      assert.equal(call.active, true, 'native persist must be invoked during trusted activation');
      assert.ok(call.time >= after.click!.time);
      assert.equal(call.error, undefined);
      assert.equal(
        typeof call.result,
        'boolean',
        'native persist Promise must settle with its actual boolean',
      );
      assert.equal(after.requestedStatus?.persistence, call.result ? 'granted' : 'not-granted');
      assert.equal(after.observedStatus?.persistence, call.result ? 'granted' : 'not-granted');
      assert.equal(after.settled, true);
      if (engine === 'firefox') {
        assert.equal(call.result, false, 'native Firefox denial must settle false');
      }
      t.diagnostic(
        `native permission before=${after.permissionBefore}, after=${after.permissionAfter}; Firefox policy=${engine === 'firefox' ? 'permissions.default.persistent-storage=2' : 'default'}; persist result=${call.result}; reported persistence=${after.requestedStatus?.persistence}; trusted activation=${call.active}; calls before approval=0, after approval=1; HTTP(S) requests/bytes after import=0/0`,
      );
    } catch (error) {
      const dir = join(REPO, 'test-results/manager-cache', engine);
      mkdirSync(dir, { recursive: true });
      const evidence = await page
        .evaluate(
          () =>
            (window as unknown as { permissionEvidence?: PermissionEvidence }).permissionEvidence,
        )
        .catch(() => undefined);
      writeFileSync(
        join(dir, 'storage-permission-network.json'),
        JSON.stringify({ network, serverRequests, evidence }, null, 2),
      );
      await Promise.allSettled([
        page.screenshot({ path: join(dir, 'storage-permission.png') }),
        context.tracing.stop({ path: join(dir, 'storage-permission.zip') }),
      ]);
      throw error;
    } finally {
      await page
        .evaluate(() =>
          (
            window as unknown as { restorePersistenceObserver?: () => void }
          ).restorePersistenceObserver?.(),
        )
        .catch(() => {});
      await context.close();
    }
  },
);
