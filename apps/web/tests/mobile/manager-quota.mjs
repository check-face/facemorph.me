// Run after the baseline mobile report, against its still-running HTTPS fixture origin:
// node manager-quota.mjs <Android Chrome CDP endpoint> <origin> <runId> <output directory>
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
assert.equal(new URL(origin).origin, origin, 'Expected an origin without a path or trailing slash');
mkdirSync(output, { recursive: true });
const rows = [],
  requests = [],
  errors = [],
  cleanupErrors = [];
const ledger = () =>
  new Promise((resolve, reject) => {
    const request = get(origin + '/fixture/ledger', { rejectUnauthorized: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part) => {
        body += part;
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200);
          const value = JSON.parse(body);
          assert.equal(value.version, 1);
          assert.ok(Array.isArray(value.transfers));
          resolve(value.transfers);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(10000, () => request.destroy(Error('Native fixture ledger timed out')));
    request.on('error', reject);
  });
const network = (transfers) => ({
  requests: transfers.length,
  bytes: transfers.reduce((sum, transfer) => sum + transfer.bytes, 0),
  paths: transfers.map((transfer) => transfer.path),
  measurement: 'native-server-ledger',
  hostSeparation: false,
});
const delta = (before, after) => {
  const ids = new Set(before.map((transfer) => transfer.id));
  return after.filter((transfer) => !ids.has(transfer.id));
};
const browser = await chromium.connectOverCDP(endpoint, { timeout: 20000 });
let page,
  cdp,
  phase = 'bootstrap',
  traceStarted = false,
  disposed;
const call = (method, options) =>
  page.evaluate(([method, options]) => window.managerQuota(method, options), [method, options]);
const within = async (operation, milliseconds, description) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(description + ' timed out')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const restoreQuota = () =>
  within(cdp?.send('Storage.overrideQuotaForOrigin', { origin }), 2000, 'Native quota reset');
const dispose = () =>
  (disposed ||= (async () => {
    // Reset quota before cleanup writes and before destroying task-owned workers/tabs.
    try {
      await restoreQuota();
    } catch (error) {
      cleanupErrors.push(String(error));
    }
    if (page && !page.isClosed()) {
      try {
        await within(call('cleanup'), 2000, 'Native quota worker cleanup');
      } catch (error) {
        cleanupErrors.push(String(error));
      }
      try {
        // Closing the task-owned page terminates its worker even if its cleanup RPC hung.
        await within(page.close(), 3000, 'Native quota page close');
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    }
  })());
process.once('SIGTERM', () => {
  setTimeout(() => process.exit(1), 8000).unref();
  void dispose().finally(() => {
    writeFileSync(
      join(output, 'quota-cleanup.json'),
      JSON.stringify({ interrupted: true, cleanupErrors }),
    );
    process.exit(1);
  });
});
try {
  const context = browser.contexts()[0];
  assert.ok(context, 'Actual Android Chrome default context is absent');
  await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
  traceStarted = true;
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!/^https?:/.test(request.url())) return;
    const url = new URL(request.url());
    requests.push({
      url: request.url(),
      phase,
      hostClass:
        url.origin !== origin
          ? 'third-party'
          : url.pathname.startsWith('/fixture/')
            ? 'model-host'
            : 'app',
    });
  });
  await page.route(/^https?:\/\//, (route) => {
    const url = new URL(route.request().url());
    const allowed =
      url.origin === origin &&
      (phase === 'bootstrap'
        ? url.pathname.startsWith('/tests/mobile/') ||
          url.pathname.startsWith('/packages/browser-model-manager/')
        : phase !== 'local' && url.pathname === '/fixture/good');
    return allowed ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto(`${origin}/tests/mobile/manager-quota.html?run=${encodeURIComponent(runId)}`);
  await page.waitForFunction(() => typeof window.managerQuota === 'function');
  await page.bringToFront();
  cdp = await context.newCDPSession(page);
  for (const backend of ['opfs', 'cache-storage']) {
    const before = await ledger(),
      cleanupStart = cleanupErrors.length;
    let start;
    let identity, failure, retry, rowError;
    try {
      phase = 'bootstrap';
      identity = await call('init', { backend, name: `mobile-quota-${runId}-${backend}` });
      assert.equal(identity.secureContext, true);
      start = requests.length;
      await within(
        cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 }),
        2000,
        'Native quota override',
      );
      phase = 'quota';
      failure = await call('acquire');
      assert.equal(failure.acquired, false, 'Native quota must refuse the actual storage write');
      assert.equal(failure.name, 'QuotaExceededError');
      assert.equal(failure.cause, 'QuotaExceededError');
      assert.deepEqual(failure.typed, {
        code: 'quota',
        requiredBytes: 3,
        message: 'Not enough browser storage to save this model. Free some storage and try again.',
      });
      assert.ok(failure.events.includes('quota-exceeded'));
      const afterFailure = await ledger();
      assert.equal(
        delta(before, afterFailure).length,
        1,
        'Quota refusal repeated the model transfer',
      );
      phase = 'local';
      const localStart = requests.length;
      const local = await call('read');
      assert.equal(local.ok, false, 'Failed save must not leave verified local bytes');
      assert.equal(local.error.code, 'cache-miss');
      assert.deepEqual(requests.slice(localStart), [], 'Local miss attempted hidden HTTP repair');
      assert.deepEqual(await ledger(), afterFailure, 'Local miss transferred model bytes');
      await restoreQuota();
      phase = 'retry';
      retry = await call('acquire');
      assert.equal(
        retry.acquired,
        true,
        'Explicit new authorized acquisition must succeed after reset',
      );
      assert.deepEqual(retry.bytes, [97, 98, 99]);
      assert.equal(retry.remainingBytes, 0);
      phase = 'local';
      const retryReadStart = requests.length;
      assert.deepEqual(await call('read'), { ok: true, bytes: [97, 98, 99] });
      assert.deepEqual(requests.slice(retryReadStart), [], 'Verified retry read attempted HTTP');
      const transfers = delta(before, await ledger());
      assert.deepEqual(
        transfers.map((transfer) => transfer.path),
        ['/fixture/good', '/fixture/good'],
      );
      assert.ok(
        transfers.every(
          (transfer) =>
            transfer.status === 200 &&
            transfer.expectedBytes === 3 &&
            transfer.bytes === 3 &&
            transfer.finished &&
            !transfer.aborted,
        ),
        'Incomplete native fixture transfer',
      );
      const cellRequests = requests.slice(start);
      assert.deepEqual(
        cellRequests.map(({ hostClass, phase }) => ({ hostClass, phase })),
        [
          { hostClass: 'model-host', phase: 'quota' },
          { hostClass: 'model-host', phase: 'retry' },
        ],
        'Unexpected app/third-party/model request or repeated transfer',
      );
      assert.deepEqual(errors, []);
    } catch (error) {
      rowError = String(error.stack || error);
    } finally {
      try {
        await restoreQuota();
      } catch (error) {
        cleanupErrors.push(String(error));
      }
      try {
        await within(call('cleanup'), 2000, 'Native quota worker cleanup');
      } catch (error) {
        cleanupErrors.push(String(error));
      }
      phase = 'bootstrap';
    }
    if (cleanupErrors.length !== cleanupStart)
      rowError ||= 'Native quota cleanup failed: ' + cleanupErrors.slice(cleanupStart).join('; ');
    rows.push({
      id: backend + '.quota',
      backend,
      lane: identity?.userAgent || 'android-chrome-cdp',
      status: rowError ? 'fail' : 'pass',
      ...(rowError ? { reason: rowError } : {}),
      network: network(delta(before, await ledger())),
      details: {
        controller: 'actual-android-chrome-cdp',
        quotaSize: 1,
        failure,
        retry,
        quotaReset: cleanupErrors.length === cleanupStart,
        bodyBytesMeaning: 'successful native socket writes; not browser-received bytes',
        scope: 'real worker storage acquisition; no inference or physical-device qualification',
      },
    });
    if (rowError) process.exitCode = 1;
    if (cleanupErrors.length !== cleanupStart)
      throw Error('Native quota cleanup failed; stopping before another backend');
  }
} catch (error) {
  errors.push(String(error.stack || error));
  process.exitCode = 1;
} finally {
  if (process.exitCode && page && !page.isClosed()) {
    await page
      .screenshot({ path: join(output, 'quota-failure.png'), timeout: 3000 })
      .catch((error) => errors.push(String(error)));
  }
  try {
    if (traceStarted)
      await within(
        browser
          .contexts()[0]
          .tracing.stop(process.exitCode ? { path: join(output, 'quota-failure.zip') } : {}),
        5000,
        'Native quota trace stop',
      );
  } catch (error) {
    cleanupErrors.push(String(error));
  }
  await dispose();
  if (cleanupErrors.length) process.exitCode = 1;
  const report = { runId, rows, requests, errors, cleanupErrors };
  writeFileSync(
    join(output, process.exitCode ? 'quota-failure.json' : 'quota.json'),
    JSON.stringify(report, null, 2),
  );
}
// Disconnect only; the caller owns Chrome and its persistent native profile.
process.exit(process.exitCode || 0);
