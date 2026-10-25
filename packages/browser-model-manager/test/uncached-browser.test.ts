// Genuine browser storage refusal/full cells (fm-fy2.13). The product's source and manager run
// unchanged, with opaque-origin sandbox denial or Chromium's native quota controller.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import test from 'node:test';
import type { Frame } from 'playwright';
import { componentBrowser } from './support/browser.ts';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const { engine, browser, newContext, unavailable } = await componentBrowser();
const work = mkdtempSync(join(tmpdir(), 'manager-uncached-browser-'));
const built = join(work, 'dist');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const parts = [0, 1, 2].map((seed) =>
  Uint8Array.from({ length: 16_391 }, (_, i) => (i * (17 + seed * 2) + seed * 31) % 256),
);
const whole = Buffer.concat(parts);
interface ResponseLedger {
  path: string;
  bytes: number;
  finished: boolean;
  aborted: boolean;
}
const ledger: ResponseLedger[] = [];
let app: Server | undefined;
let model: Server | undefined;
test.after(async () => {
  await browser?.close();
  await Promise.all(
    [app, model]
      .filter((server) => server !== undefined)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  rmSync(work, { recursive: true, force: true });
});

interface ResponseHeaders {
  step: number;
  url: string;
  status: number;
  bytes: number;
}
interface Recorded {
  steps: { name: string }[];
  requests: {
    step: number;
    url: string;
    hostClass: string;
    bytes: number | null;
    status: number | null;
    failed: boolean;
    errorText: string | null;
  }[];
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
};
const record = (await import(join(REPO, 'scripts/ci/intercept/record.ts'))) as {
  step(rec: Recorded, name: string): void;
};
let APP = '';
let MODEL = '';
let fixture: {
  sha256: string;
  size: number;
  url: string;
  chunks: { sha256: string; size: number; url: string }[];
};

async function start() {
  if (app) return;
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
  const tls = {
    key: readFileSync(join(work, 'key.pem')),
    cert: readFileSync(join(work, 'cert.pem')),
  };
  app = createServer(tls, (req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
    const send = (type: string, body: string | Uint8Array) => {
      res.writeHead(200, {
        'content-type': type,
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(body);
    };
    if (path === '/')
      return send(
        'text/html',
        '<!doctype html><title>Uncached storage component</title><iframe sandbox="allow-scripts" src="/realm"></iframe>',
      );
    if (path === '/realm')
      return send('text/html', '<!doctype html><title>Uncached model consumer</title>');
    if (path === '/browser/model-source.mjs')
      return send(
        'text/javascript',
        readFileSync(join(REPO, 'apps/web/src/Next/browser/model-source.mjs')),
      );
    if (path === '/Assets/model-cache.mjs')
      return send('text/javascript', "export * from '/pkg/index.js';");
    if (path.startsWith('/pkg/')) {
      try {
        return send('text/javascript', readFileSync(join(built, path.slice(5))));
      } catch {
        /* 404 below */
      }
    }
    res.writeHead(404);
    res.end();
  });
  model = createServer(tls, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x').pathname;
    const part = /^\/part-([0-2])$/.exec(path);
    const body = part ? parts[Number(part[1])] : undefined;
    const entry = { path, bytes: 0, finished: false, aborted: false };
    ledger.push(entry);
    res.once('finish', () => {
      entry.finished = true;
    });
    res.once('close', () => {
      entry.aborted = !res.writableFinished;
    });
    if (!body) {
      res.writeHead(404, { 'access-control-allow-origin': '*' });
      return res.end();
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.byteLength,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    entry.bytes = body.byteLength;
    res.end(body);
  });
  const listen = (server: Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
    );
  APP = `https://127.0.0.1:${await listen(app)}`;
  MODEL = `https://127.0.0.1:${await listen(model)}`;
  fixture = {
    sha256: sha(whole),
    size: whole.byteLength,
    url: `${MODEL}/whole`,
    chunks: parts.map((part, i) => ({
      sha256: sha(part),
      size: part.byteLength,
      url: `${MODEL}/part-${i}`,
    })),
  };
}

interface Source {
  readonly uncached: boolean;
  has(asset: object): Promise<boolean>;
  bytes(asset: object, request: object): Promise<Uint8Array<ArrayBuffer>>;
  acquire(asset: object, request: object): Promise<unknown>;
  records: {
    put(key: string, value: unknown): Promise<void>;
    get(key: string): Promise<unknown>;
    remove(key: string): Promise<void>;
  };
}
interface Realm {
  source: Source;
  grant: object;
  notices: { name: string; message: string; code?: string | undefined }[];
}

async function session(name: string, opaque: boolean) {
  await start();
  const context = await newContext!({ ignoreHTTPSErrors: true });
  const attached = helper.attachPlaywright(context, {
    version: 1,
    rules: [
      { host: new URL(APP).host, class: 'app' },
      { host: new URL(MODEL).host, class: 'model-host' },
    ],
  });
  const responseHeaders: ResponseHeaders[] = [];
  context.on('response', (response) => {
    responseHeaders.push({
      step: attached.rec.steps.length - 1,
      url: response.url(),
      status: response.status(),
      bytes: Number(response.headers()['content-length']),
    });
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const capture = async () => {
    const dir = join(REPO, 'test-results/manager-cache', engine);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${name}-network.json`),
      JSON.stringify({ network: attached.rec, responseHeaders, ledger }, null, 2),
    );
    await Promise.allSettled([
      page.screenshot({ path: join(dir, `${name}.png`) }),
      context.tracing.stop({ path: join(dir, `${name}.zip`) }),
    ]);
  };
  try {
    await page.goto(opaque ? APP : `${APP}/realm`);
    const frame = opaque
      ? page.frames().find((frame) => frame !== page.mainFrame() && frame.url() === `${APP}/realm`)!
      : page.mainFrame();
    assert.ok(frame, 'opaque sandbox iframe loaded');
    await frame.evaluate(async () => {
      await import(String('/browser/model-source.mjs'));
      await import(String('/pkg/index.js'));
    });
    return { context, page, frame, ...attached, responseHeaders, capture };
  } catch (error) {
    await capture();
    await context.close();
    throw error;
  }
}

async function initialize(frame: Frame, budget: number) {
  return frame.evaluate(
    async ({ asset, budget }) => {
      const m = await import(String('/browser/model-source.mjs'));
      const state = window as unknown as Realm;
      state.notices = [];
      state.source = await m.createModelSource(
        { readAhead: 1, retryDelaysMs: [] },
        (error: { name: string; message: string; error?: { code: string } }) =>
          state.notices.push({ name: error.name, message: error.message, code: error.error?.code }),
      );
      state.grant = {
        manifestSha256: 'native-uncached-cell',
        route: 'cpu',
        purpose: 'encode',
        assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
        remainingBytes: budget,
        owners: ['face:uncached'],
      };
      return { uncached: state.source.uncached, notices: state.notices };
    },
    { asset: fixture, budget },
  );
}
async function consume(frame: Frame) {
  return frame.evaluate(async (asset) => {
    const state = window as unknown as Realm;
    const manager = await import(String('/pkg/index.js'));
    const value = await state.source.bytes(asset, { grant: state.grant, owner: 'face:uncached' });
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    await state.source.records.put('uncached-canary', { forbidden: 'must never persist' });
    return {
      sha256: digest,
      size: value.byteLength,
      remaining: manager.grantRemaining(state.grant),
      uncached: state.source.uncached,
      notices: state.notices,
      has: await state.source.has(asset),
      record: await state.source.records.get('uncached-canary'),
    };
  }, fixture);
}
function requests(rec: Recorded, step: string) {
  return rec.requests.filter((request) => rec.steps[request.step]?.name === step);
}
function quiet(rec: Recorded, step: string) {
  assert.deepEqual(
    requests(rec, step).filter((request) => /^https?:/.test(request.url)),
    [],
    `${step}: no hidden HTTP(S)`,
  );
}
function transferred(
  rec: Recorded,
  step: string,
  paths: string[],
  entries: ResponseLedger[],
  responseHeaders: ResponseHeaders[],
) {
  const observed = requests(rec, step);
  assert.equal(observed.length, paths.length);
  assert.ok(
    observed.every((request) => request.hostClass === 'model-host' && request.status === 200),
  );
  assert.deepEqual(
    observed.map((request) => new URL(request.url).pathname).sort(),
    [...paths].sort(),
  );
  assert.ok(
    observed.every(
      (request) =>
        !request.failed || (engine === 'chromium' && request.errorText === 'net::ERR_ABORTED'),
    ),
    `unexpected protocol failure: ${JSON.stringify(observed)}`,
  );
  const bytes = paths.length * parts[0]!.byteLength;
  // Chromium can emit EOF ERR_ABORTED after full verified bytes were consumed. The shared
  // helper records that raw failure with bytes=0. Preserve it; prove transfer independently
  // with actual client digest/grant spend, response headers and server finished/sent bytes.
  assert.ok(
    observed.every((request) => request.bytes === (request.failed ? 0 : parts[0]!.byteLength)),
  );
  const headers = responseHeaders.filter((response) => rec.steps[response.step]?.name === step);
  assert.deepEqual(
    headers.map((response) => new URL(response.url).pathname).sort(),
    [...paths].sort(),
  );
  assert.ok(headers.every((response) => response.status === 200));
  assert.equal(
    headers.reduce((total, response) => total + response.bytes, 0),
    bytes,
  );
  assert.deepEqual(entries.map((entry) => entry.path).sort(), [...paths].sort());
  assert.ok(entries.every((entry) => entry.finished && !entry.aborted));
  assert.equal(
    entries.reduce((total, entry) => total + entry.bytes, 0),
    bytes,
  );
}
async function refusals(frame: Frame) {
  return frame.evaluate(async (asset) => {
    const state = window as unknown as Realm;
    let background = '',
      refused = '',
      exhausted = '';
    try {
      await state.source.acquire(asset, { grant: state.grant, owner: 'face:uncached' });
    } catch (error) {
      background = String((error as Error).message);
    }
    try {
      await state.source.bytes(asset, { grant: state.grant, owner: 'face:forbidden' });
    } catch (error) {
      refused = String((error as { refusal?: string }).refusal);
    }
    try {
      await state.source.bytes(asset, { grant: state.grant, owner: 'face:uncached' });
    } catch (error) {
      exhausted = String((error as { refusal?: string }).refusal);
    }
    return { background, refused, exhausted, notices: state.notices.length };
  }, fixture);
}

test(
  `${engine}: genuinely storage-denied opaque sandbox consumes verified uncached bytes under the original approval`,
  { skip: unavailable, timeout: 60_000 },
  async (t) => {
    const s = await session('uncached-storage-denied', true);
    try {
      record.step(s.rec, 'native-denial');
      const denial = await s.frame.evaluate(async () => {
        const error = async (operation: () => Promise<unknown>) => {
          try {
            await operation();
            return null;
          } catch (error) {
            return { name: (error as Error).name, message: (error as Error).message };
          }
        };
        return {
          opaque: window.origin === 'null',
          cache: await error(() => caches.open('native-refusal-probe')),
          opfs: await error(() => navigator.storage.getDirectory()),
        };
      });
      assert.equal(denial.opaque, true);
      assert.equal(denial.cache?.name, 'SecurityError');
      assert.equal(denial.opfs?.name, 'SecurityError');
      const setup = await initialize(s.frame, fixture.size);
      assert.equal(setup.uncached, true);
      assert.equal(setup.notices.length, 1);
      await s.settled();
      quiet(s.rec, 'native-denial');
      record.step(s.rec, 'uncached-consume');
      const before = ledger.length;
      const result = await consume(s.frame);
      assert.equal(result.sha256, fixture.sha256);
      assert.equal(result.size, fixture.size);
      assert.equal(result.remaining, 0);
      assert.equal(result.uncached, true);
      assert.equal(result.has, false);
      assert.equal(result.record, undefined);
      assert.equal(result.notices.length, 1);
      await s.settled();
      transferred(
        s.rec,
        'uncached-consume',
        ['/part-0', '/part-1', '/part-2'],
        ledger.slice(before),
        s.responseHeaders,
      );
      record.step(s.rec, 'background-and-forbidden');
      const stopped = await refusals(s.frame);
      assert.match(stopped.background, /storage is unavailable; background preparation stopped/i);
      assert.equal(stopped.refused, 'owner-not-in-grant');
      assert.equal(stopped.exhausted, 'revision-required');
      assert.equal(stopped.notices, 1);
      await s.settled();
      quiet(s.rec, 'background-and-forbidden');
      if (s.rec.requests.some((request) => request.failed))
        t.diagnostic(
          'Chromium EOF ERR_ABORTED retained in raw records; its raw byte metric is unavailable. Verified received/grant bytes, response lengths and finished server sent bytes agree.',
        );
      t.diagnostic(
        `native CacheStorage/OPFS SecurityError; uncached SHA=${result.sha256}; transferred/spent=${fixture.size}; notice once; no retained bytes/records; background/forbidden requests=0`,
      );
    } catch (error) {
      await s.capture();
      throw error;
    } finally {
      await s.context.close();
    }
  },
);

test(
  `${engine}: actual one-byte native quota failure continues uncached without replenishing approval`,
  {
    skip:
      unavailable ||
      (engine !== 'chromium' && 'untested: native quota override requires Chromium CDP'),
    timeout: 60_000,
  },
  async (t) => {
    const s = await session('uncached-quota-full', false);
    const cdp = await s.context.newCDPSession(s.page);
    try {
      const setup = await initialize(s.frame, fixture.size + parts[0]!.byteLength);
      assert.equal(setup.uncached, false);
      assert.equal(setup.notices.length, 0);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: APP, quotaSize: 1 });
      record.step(s.rec, 'quota-then-uncached');
      const before = ledger.length;
      const result = await consume(s.frame);
      assert.equal(result.sha256, fixture.sha256);
      assert.equal(result.size, fixture.size);
      assert.equal(
        result.remaining,
        0,
        'earlier failed native write must spend its actual downloaded chunk',
      );
      assert.equal(result.uncached, true);
      assert.equal(result.has, false);
      assert.equal(result.record, undefined);
      assert.equal(result.notices.length, 1);
      assert.equal(result.notices[0]?.name, 'QuotaExceededError');
      assert.equal(result.notices[0]?.code, 'quota');
      await s.settled();
      transferred(
        s.rec,
        'quota-then-uncached',
        ['/part-0', '/part-0', '/part-1', '/part-2'],
        ledger.slice(before),
        s.responseHeaders,
      );
      record.step(s.rec, 'quota-local-refusals');
      const stopped = await refusals(s.frame);
      assert.match(stopped.background, /background preparation stopped/i);
      assert.equal(stopped.refused, 'owner-not-in-grant');
      assert.equal(stopped.exhausted, 'revision-required');
      assert.equal(stopped.notices, 1);
      const durable = await s.frame.evaluate(async (asset) => {
        const m = await import(String('/pkg/index.js'));
        const cache = await m.createBrowserModelCache({ readOnly: true });
        const read = await cache.local.read(asset);
        const keys = (
          await Promise.all(
            (await caches.keys()).map(async (name) =>
              (await (await caches.open(name)).keys()).map((key) => key.url),
            ),
          )
        ).flat();
        return {
          has: await cache.has(asset),
          local: read.ok,
          record: await cache.records.get('uncached-canary'),
          keys,
        };
      }, fixture);
      assert.equal(durable.has, false);
      assert.equal(durable.local, false);
      assert.equal(durable.record, undefined);
      assert.deepEqual(durable.keys, []);
      await s.settled();
      quiet(s.rec, 'quota-local-refusals');
      if (s.rec.requests.some((request) => request.failed))
        t.diagnostic(
          'Chromium EOF ERR_ABORTED retained in raw records; its raw byte metric is unavailable. Verified received/grant bytes, response lengths and finished server sent bytes agree.',
        );
      t.diagnostic(
        `native quota=1; actual OPFS write failure=${result.notices[0]?.name}; same grant spent first chunk+asset=${fixture.size + parts[0]!.byteLength}; no durable result or record; component only`,
      );
    } catch (error) {
      await s.capture();
      throw error;
    } finally {
      try {
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: APP });
      } finally {
        await s.context.close();
      }
    }
  },
);
