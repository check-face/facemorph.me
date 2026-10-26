// CDP controls two real Android Chrome tabs; the browser's native workers own all storage/locks.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [endpoint, origin, runId, output] = process.argv.slice(2);
assert.ok(
  endpoint && origin && runId && output,
  'CDP endpoint, origin, run ID and output required',
);
mkdirSync(output, { recursive: true });
const ledger = () =>
  new Promise((resolve, reject) => {
    get(origin + '/fixture/ledger', { rejectUnauthorized: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part) => (body += part));
      response.on('end', () => {
        try {
          resolve(JSON.parse(body).transfers);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
assert.ok(context, 'Actual Android Chrome default context is absent');
const pages = [],
  requests = [],
  errors = [],
  rows = [];
let phase = 'bootstrap';
const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const call = (page, method, options) =>
  page.evaluate(([method, options]) => window.managerTab(method, options), [method, options]);
const bounded = async (operation, milliseconds, message) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
let cleanup;
const disposeTabs = () =>
  (cleanup ||= (async () => {
    const results = await Promise.allSettled(
      pages.map((page) => bounded(call(page, 'cleanup'), 2500, 'Worker cleanup did not settle')),
    );
    const closes = await Promise.allSettled(
      pages.map((page) => bounded(page.close(), 3000, 'Native tab close did not settle')),
    );
    return results
      .concat(closes)
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason));
  })());
process.once('SIGTERM', () => {
  // The Python controller allows ten seconds for task-owned workers/tabs to release.
  setTimeout(() => process.exit(1), 8000).unref();
  void disposeTabs()
    .then((errors) => {
      writeFileSync(
        join(output, 'cross-tab-cleanup.json'),
        JSON.stringify({ interrupted: true, errors }),
      );
    })
    .finally(() => process.exit(1));
});
await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
try {
  for (let i = 0; i < 2; i++) {
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push({ url: request.url(), phase });
    });
    await page.route(/^https?:\/\//, (route) =>
      phase === 'local' ? route.abort('blockedbyclient') : route.continue(),
    );
    await page.goto(
      `${origin}/tests/mobile/manager-tab.html?run=${encodeURIComponent(runId)}&tab=${i}`,
    );
    await page.waitForFunction(() => typeof window.managerTab === 'function');
  }
  const identities = await Promise.all(
    pages.map((page) => page.evaluate(() => window.managerTabIdentity)),
  );
  assert.notEqual(identities[0], identities[1], 'Must control independent documents');
  const [a, b] = pages;
  for (const backend of ['opfs', 'cache-storage']) {
    const name = 'mobile-tabs-' + runId + '-' + backend;
    const before = await ledger();
    const identity = await call(a, 'init', { backend, name });
    await call(b, 'init', { backend, name });
    phase = 'local';
    const start = requests.length;
    try {
      assert.equal(identity.secureContext, true);
      await call(a, 'seed');
      assert.deepEqual(await call(b, 'read'), { ok: true, bytes: [97, 98, 99] });
      await call(b, 'lease');
      await a.bringToFront();
      assert.deepEqual(await call(a, 'evict'), { removed: [], kept: [sha256] });
      assert.deepEqual(await call(a, 'remove'), [sha256]);
      await b.bringToFront();
      await b.waitForFunction(async () => (await window.managerTab('invalidations')).length > 0);
      assert.deepEqual(await call(b, 'invalidations'), [
        { cause: 'cross-tab-deletion', code: 'invalidated' },
      ]);
      const missing = await call(b, 'read');
      assert.equal(missing.ok, false);
      assert.equal(missing.error.code, 'evicted');
      assert.deepEqual(await call(b, 'release'), []);
      await a.waitForFunction(async () => await window.managerTab('exclusive'));
      assert.deepEqual(
        await Promise.all(pages.map((page) => page.evaluate(() => window.managerTabIdentity))),
        identities,
        'Tab focus must not navigate or reload either document',
      );
      assert.deepEqual(await ledger(), before, 'Cross-tab operations issued model transfers');
      assert.deepEqual(
        requests.slice(start),
        [],
        'Cross-tab operations attempted HTTP(S), including blocked repair',
      );
      assert.deepEqual(errors, []);
      rows.push({
        id: backend + '.cross-tab',
        backend,
        lane: identity.userAgent,
        status: 'pass',
        network: {
          requests: 0,
          bytes: 0,
          paths: [],
          measurement: 'native-server-ledger',
          hostSeparation: false,
        },
        details: {
          controller: 'actual-android-chrome-cdp',
          independentDocuments: identities,
          nativeWebLocksReleased: true,
          invalidation: 'cross-tab-deletion',
          localRead: 'evicted',
          httpAttemptsByClass: { app: 0, 'model-host': 0, 'third-party': 0 },
          scope: 'native storage/leases; loaded inference disposal is a separate component',
        },
      });
    } finally {
      await call(b, 'release');
      await call(a, 'cleanup');
      await call(b, 'cleanup').catch((error) => {
        if (!String(error).includes('NotFoundError')) throw error;
      });
      phase = 'bootstrap';
    }
  }
  writeFileSync(
    join(output, 'cross-tab.json'),
    JSON.stringify({ runId, rows, requests, errors }, null, 2),
  );
} catch (error) {
  writeFileSync(
    join(output, 'cross-tab-failure.json'),
    JSON.stringify({ runId, rows, requests, errors, error: String(error.stack || error) }, null, 2),
  );
  await Promise.allSettled(
    pages.map((page, i) => page.screenshot({ path: join(output, `cross-tab-${i}.png`) })),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    await bounded(
      context.tracing.stop(process.exitCode ? { path: join(output, 'cross-tab-failure.zip') } : {}),
      5000,
      'Native cross-tab trace did not settle',
    );
  } finally {
    const cleanupErrors = await disposeTabs();
    if (cleanupErrors.length) {
      writeFileSync(join(output, 'cross-tab-cleanup.json'), JSON.stringify(cleanupErrors));
      process.exitCode = 1;
    }
  }
}
// The caller owns the emulator/browser lifecycle. Exit drops CDP without stopping Chrome.
process.exit(process.exitCode || 0);
