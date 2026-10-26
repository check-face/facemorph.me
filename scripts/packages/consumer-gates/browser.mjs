// Real browser gate over the single external consumer's already-built Vite output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../ci/intercept/playwright.ts';
import { assertNoRequests, requestsIn, step } from '../../ci/intercept/record.ts';

const filesUnder = (root, prefix = '') =>
  readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(root, join(prefix, entry.name)) : [join(prefix, entry.name)],
  );
const classes = [
  'app',
  'model-host',
  'names-host',
  'collector',
  'analytics',
  'third-party',
  'local',
];
const expectedOperations = [
  'manager.createBrowserModelCache',
  'engine.createEngine',
  'manager.cache.has',
  'manager.cache.peek',
  'manager.cache.local.read',
  'manager.storageStatus',
  'engine.state',
  'engine.trace',
  'engine.qualified',
  'engine.capabilities',
  'engine.supportedRoutes',
  'engine.rankedRoutes',
  'engine.dispose',
  'manager.native-cache-cleanup',
];

/** Bound browser evaluations too: Playwright's default timeout does not cover evaluate().
 * Accepting a function also catches a synchronous callback failure in the same cleanup path.
 */
export async function bounded(operation, timeoutMs, label) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'A positive finite timeout is required');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => (typeof operation === 'function' ? operation() : operation)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(label + ' timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One temporary native browser/server session over the existing packed consumer.
 * No navigation or package construction occurs before fn; shared observation is already attached.
 * roots (alias extraRoots) maps URL prefixes to directories, e.g. /converted/ and /runtime/.
 * Returns fn's value; failures throw after retaining screenshot/trace and releasing resources.
 */
export async function withBrowserPage(
  { outDir, roots = {}, extraRoots = {}, evidenceDir, executablePath, timeoutMs = 30000 } = {},
  fn,
) {
  assert.ok(
    outDir && typeof fn === 'function',
    'Existing consumer output and callback are required',
  );
  const root = realpathSync(outDir);
  const mounts = Object.entries({ ...extraRoots, ...roots }).map(([prefix, directory]) => {
    assert.ok(/^\/[\w-]+\/$/.test(prefix), 'Static root requires a simple absolute URL prefix');
    return [prefix, realpathSync(directory)];
  });
  evidenceDir = resolve(evidenceDir ?? join(dirname(root), 'browser-gate'));
  mkdirSync(evidenceDir, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), 'facemorph-consumer-browser-'));
  let browser,
    context,
    page,
    server,
    tracing = false,
    observation,
    origin,
    result,
    failure;
  const serverRequests = [],
    cleanupErrors = [];
  try {
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
        '-keyout',
        join(temporary, 'key.pem'),
        '-out',
        join(temporary, 'cert.pem'),
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore', timeout: 20000 },
    );
    server = createServer(
      {
        key: readFileSync(join(temporary, 'key.pem')),
        cert: readFileSync(join(temporary, 'cert.pem')),
      },
      (request, response) => {
        const pathname = new URL(request.url, 'https://127.0.0.1').pathname;
        serverRequests.push({ method: request.method, path: pathname });
        let body, type;
        if (pathname === '/') {
          body = Buffer.from(
            '<!doctype html><meta charset="utf-8"><title>Packed consumer browser gate</title><link rel="icon" href="data:,">',
          );
          type = 'text/html';
        } else {
          try {
            const mount = mounts.find(([prefix]) => pathname.startsWith(prefix));
            const directory = mount?.[1] ?? root;
            const file = realpathSync(
              join(
                directory,
                decodeURIComponent(mount ? pathname.slice(mount[0].length) : pathname),
              ),
            );
            const rel = relative(directory, file);
            if (
              rel.startsWith('..' + sep) ||
              rel === '..' ||
              !statSync(file).isFile() ||
              (!mount && extname(file) !== '.js')
            )
              throw Error('Not a public consumer file');
            body = readFileSync(file);
            type =
              {
                '.js': 'text/javascript',
                '.mjs': 'text/javascript',
                '.wasm': 'application/wasm',
                '.json': 'application/json',
                '.png': 'image/png',
              }[extname(file)] ?? 'application/octet-stream';
          } catch {
            response.writeHead(404);
            response.end();
            return;
          }
        }
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        response.end(body);
      },
    );
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    origin = `https://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
    const host = new URL(origin).host;
    observation = attachPlaywright(context, {
      version: DEFAULT_HOST_MAP.version,
      rules: [
        ...mounts.map(([pathPrefix]) => ({ host, pathPrefix, class: 'model-host' })),
        { host, class: 'app' },
        { host: 'model-host.invalid', class: 'model-host' },
        ...DEFAULT_HOST_MAP.rules,
      ],
    });
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    tracing = true;
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    result = await bounded(
      () => fn({ page, context, browser, origin, observation, serverRequests }),
      timeoutMs,
      'Consumer browser callback',
    );
  } catch (error) {
    failure = error;
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({ path: join(evidenceDir, 'failure.png'), timeout: 3000 });
      } catch (error) {
        cleanupErrors.push('screenshot: ' + String(error));
      }
    }
  } finally {
    try {
      if (tracing)
        await bounded(
          context.tracing.stop(failure ? { path: join(evidenceDir, 'failure.zip') } : {}),
          5000,
          'Browser trace cleanup',
        );
    } catch (error) {
      cleanupErrors.push('trace: ' + String(error));
    }
    try {
      await bounded(context?.close(), 3000, 'Browser context cleanup');
    } catch (error) {
      cleanupErrors.push('context: ' + String(error));
    }
    try {
      await bounded(browser?.close(), 3000, 'Browser process cleanup');
    } catch (error) {
      cleanupErrors.push('browser: ' + String(error));
    }
    if (server) {
      server.closeAllConnections();
      try {
        await bounded(
          new Promise((yes) => server.close(yes)),
          2000,
          'Browser HTTPS server cleanup',
        );
      } catch (error) {
        cleanupErrors.push('server: ' + String(error));
      }
    }
    rmSync(temporary, { recursive: true, force: true });
    writeFileSync(
      join(evidenceDir, 'network.json'),
      JSON.stringify(observation?.rec ?? null, null, 2) + '\n',
    );
    writeFileSync(
      join(evidenceDir, 'server-requests.json'),
      JSON.stringify(serverRequests, null, 2) + '\n',
    );
    if (failure || cleanupErrors.length)
      writeFileSync(
        join(evidenceDir, 'failure.json'),
        JSON.stringify(
          { error: failure ? String(failure.stack || failure) : null, cleanupErrors },
          null,
          2,
        ) + '\n',
      );
  }
  if (failure) throw failure;
  if (cleanupErrors.length) throw Error('Browser gate cleanup failed: ' + cleanupErrors.join('; '));
  return result;
}

/** Acquisition-free constructor/status gate; statusEntry is relative to existing Vite output.
 * Returns ok:false on executed failure. evidenceDir should survive temporary consumer cleanup.
 */
export async function runBrowserGate(options = {}) {
  const { outDir, timeoutMs = 30000 } = options;
  assert.ok(outDir, 'Existing consumer Vite output directory is required');
  const root = realpathSync(outDir),
    files = filesUnder(root);
  let { statusEntry } = options;
  if (!statusEntry) {
    const matches = files.filter((file) => /(?:^|\/)status(?:[-.][^/]*)?\.js$/.test(file));
    assert.equal(matches.length, 1, 'Expected one emitted consumer status entry');
    [statusEntry] = matches;
  }
  assert.ok(files.includes(statusEntry), 'Status entry must be an existing emitted consumer file');
  const evidenceDir = resolve(options.evidenceDir ?? join(dirname(root), 'browser-status'));
  const errors = [],
    assertions = [];
  let outcome, network, browserIdentity;
  try {
    await withBrowserPage(
      { ...options, evidenceDir },
      async ({ page, context, browser, origin, observation }) => {
        network = observation.rec;
        browserIdentity = {
          family: 'chromium',
          version: browser.version(),
          executable: options.executablePath ?? chromium.executablePath(),
        };
        step(network, 'bootstrap');
        let phase = 'bootstrap';
        await context.route(/^https?:\/\//, (route) =>
          phase === 'bootstrap' && new URL(route.request().url()).origin === origin
            ? route.continue()
            : route.abort('blockedbyclient'),
        );
        await context.exposeFunction('__consumerGateStep', (name) => {
          assert.ok(
            ['construct', 'status', 'cleanup'].includes(name),
            'Unknown consumer browser phase',
          );
          phase = name;
          step(network, name);
        });
        page.on('pageerror', (error) => errors.push(String(error.stack || error)));
        await page.goto(origin + '/');
        await bounded(
          () =>
            page.evaluate(
              async (entry) => {
                const module = await import(entry);
                if (typeof module.exerciseStatus !== 'function')
                  throw Error('Packed consumer has no exerciseStatus export');
                window.__packedConsumerExercise = module.exerciseStatus;
              },
              '/' + statusEntry.split(sep).join('/'),
            ),
          timeoutMs,
          'Packed consumer status module import',
        );
        await observation.settled(2000);
        outcome = await bounded(
          () =>
            page.evaluate(() =>
              window.__packedConsumerExercise((name) => window.__consumerGateStep(name)),
            ),
          timeoutMs,
          'Packed consumer construction/status',
        );
        await page.waitForTimeout(100);
        await observation.settled(2000);
        assert.deepEqual(
          outcome.operations,
          expectedOperations,
          'Required public operations did not execute',
        );
        assert.equal(outcome.scope.grantApproved, false);
        assert.equal(outcome.scope.modelLoaded, false);
        assert.equal(outcome.scope.admissionAttempted, false);
        assert.equal(outcome.scope.inferenceExecuted, false);
        assert.equal(outcome.cleanup.callerCapabilityDisposals, 1);
        assert.deepEqual(
          network.steps.map((value) => value.name),
          ['bootstrap', 'construct', 'status', 'cleanup'],
        );
        for (const name of ['construct', 'status', 'cleanup']) {
          const window = { fromStep: name, toStep: name };
          for (const hostClass of classes) {
            const verdict = assertNoRequests(network, hostClass, window, (line) =>
              assertions.push(line),
            );
            assert.equal(verdict.verdict, 'pass', `${name}: unexpected ${hostClass} request`);
          }
          const all = requestsIn(network, window, (line) => assertions.push(line));
          assert.equal(all.count, 0, `${name}: unexpected request outside declared host classes`);
        }
        // Import is outside the constructor/status windows, but cannot hide a model fetch there.
        assert.equal(
          assertNoRequests(network, 'model-host', {}, (line) => assertions.push(line)).verdict,
          'pass',
        );
        assert.equal(
          assertNoRequests(network, 'third-party', {}, (line) => assertions.push(line)).verdict,
          'pass',
        );
        assert.equal(network.console.length, 0, 'Browser reported console errors');
        assert.deepEqual(errors, []);
      },
    );
  } catch (error) {
    errors.push(String(error.stack || error));
  }
  const report = {
    ok: errors.length === 0,
    statusEntry,
    browser: browserIdentity,
    operations: outcome,
    network: network ?? null,
    assertions,
    errors,
  };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, 'assertions.jsonl'),
    assertions.map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
  writeFileSync(join(evidenceDir, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
