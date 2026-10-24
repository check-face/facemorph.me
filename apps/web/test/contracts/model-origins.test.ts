// Model alternate origins (fm-fr9s): models.facemorph.me is an alternate only for facemorph.me page hosts. Pure cases,
// then real Chromium running the manager's built cache with this configuration read from the page's own
// location.hostname: a page served as next.facemorph.me (host-resolver rules point it, and models.facemorph.me, at
// local https servers; every other name is unresolvable) retries a failing chunk on models.facemorph.me, and a
// localhost harness makes zero requests to it. Requests are read from the servers' logs and the interception
// helper by host class. A host where Chromium cannot start reports the browser cases untested.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import {
  MODEL_ALTERNATE_ORIGIN,
  isFacemorphHost,
  modelAlternateOrigins,
} from '../../src/contracts/model-origins.ts';

test('models.facemorph.me only for facemorph.me and its subdomains', () => {
  for (const host of ['facemorph.me', 'next.facemorph.me', 'www.facemorph.me']) {
    assert.ok(isFacemorphHost(host), host);
    assert.deepEqual(modelAlternateOrigins(host), [MODEL_ALTERNATE_ORIGIN], host);
  }
  for (const host of [
    'localhost',
    '127.0.0.1',
    'notfacemorph.me',
    'facemorph.me.example.com',
    'facemorph.mex',
    '',
  ])
    assert.deepEqual(modelAlternateOrigins(host), [], host);
  assert.equal(MODEL_ALTERNATE_ORIGIN, 'https://models.facemorph.me');
});

// ---------------------------------------------------------------- servers and the built package

const REPO = new URL('../../../../', import.meta.url).pathname;
const MANAGER = join(REPO, 'packages/browser-model-manager');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'model-origins-'));
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
const built = join(work, 'dist');
execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(MANAGER, 'tsconfig.build.json'),
  '--outDir',
  built,
]);
const config = stripTypeScriptTypes(
  readFileSync(new URL('../../src/contracts/model-origins.ts', import.meta.url), 'utf8'),
);

const listen = (s: Server) =>
  new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const app = createServer(tls, (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
  const send = (type: string, body: Uint8Array | string) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (path === '/') return send('text/html', '<!doctype html><title>origins</title>');
  if (path === '/config/model-origins.js') return send('text/javascript', config);
  if (path.startsWith('/pkg/'))
    try {
      return send(
        extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream',
        readFileSync(join(built, path.slice(5))),
      );
    } catch {
      /* 404 below */
    }
  res.writeHead(404);
  res.end();
});

const chunk = new Uint8Array(32 * 1024).map((_, i) => (i * 7919) & 0xff);
const PATH = '/runtime/chunks/model-part-0';
const served: { host: string; status: number }[] = [];
let primaryFailures = 0;
const model = (host: 'primary' | 'mirror') =>
  createServer(tls, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x').pathname;
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    const fail = host === 'primary' && primaryFailures > 0;
    if (fail) primaryFailures--;
    const status = path !== PATH ? 404 : fail ? 500 : 200;
    served.push({ host, status });
    res.writeHead(status, cors);
    res.end(status === 200 ? chunk : undefined);
  });
const primary = model('primary');
const mirror = model('mirror');
const appPort = await listen(app);
const primaryPort = await listen(primary);
const mirrorPort = await listen(mirror);

interface Recorded {
  requests: { url: string; hostClass: string }[];
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
};
const hostMap = {
  version: 1,
  rules: [
    { host: `127.0.0.1:${appPort}`, class: 'app' },
    { host: 'next.facemorph.me', class: 'app' },
    { host: `127.0.0.1:${primaryPort}`, class: 'model-host' },
    { host: 'models.facemorph.me', class: 'models-facemorph-me' },
  ],
};

type Page = {
  goto(u: string): Promise<unknown>;
  evaluate<T, A>(fn: (a: A) => Promise<T> | T, arg: A): Promise<T>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as {
  chromium: { launch(o: object): Promise<Browser> };
};
const browser = await chromium
  .launch({
    executablePath: process.env['CHROMIUM_PATH'],
    // The two facemorph.me names reach only the local servers; every other name fails to resolve.
    args: [
      `--host-resolver-rules=MAP next.facemorph.me 127.0.0.1:${appPort}, MAP models.facemorph.me 127.0.0.1:${mirrorPort}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
    ],
  })
  .catch(() => null);
const NO_BROWSER = browser ? false : 'untested: Chromium does not start here';
test.after(async () => {
  await browser?.close();
  for (const s of [app, primary, mirror]) s.close();
});

/** On `pageUrl`: the cache configured from location.hostname acquires one chunk whose first try fails. */
async function acquireFrom(pageUrl: string) {
  const context = await browser!.newContext({ ignoreHTTPSErrors: true });
  const att = helper.attachPlaywright(context, hostMap);
  try {
    const page = await context.newPage();
    await page.goto(pageUrl);
    primaryFailures = 1;
    const from = served.length;
    const asset = {
      sha256: sha(chunk),
      size: chunk.byteLength,
      url: `https://127.0.0.1:${primaryPort}${PATH}`,
    };
    const out = await page.evaluate(
      async ({ asset }) => {
        const m = await import(String('/pkg/index.js'));
        const { modelAlternateOrigins } = await import(String('/config/model-origins.js'));
        const alternateOrigins = modelAlternateOrigins(location.hostname);
        const cache = await m.createBrowserModelCache({
          alternateOrigins,
          retryDelaysMs: [50, 50],
        });
        const grant = {
          manifestSha256: 'origins',
          route: 'cpu',
          purpose: 'generate',
          assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
          remainingBytes: asset.size,
          owners: ['face:a'],
        };
        await cache.acquire(asset, { grant, owner: 'face:a' });
        return { alternateOrigins, hostname: location.hostname };
      },
      { asset },
    );
    await att.settled();
    return { ...out, served: served.slice(from), rec: att.rec };
  } finally {
    await context.close();
  }
}

test(
  'a page on next.facemorph.me retries a failing chunk on models.facemorph.me',
  { skip: NO_BROWSER },
  async () => {
    const r = await acquireFrom('https://next.facemorph.me/');
    assert.equal(r.hostname, 'next.facemorph.me');
    assert.deepEqual(r.alternateOrigins, [MODEL_ALTERNATE_ORIGIN]);
    assert.deepEqual(r.served, [
      { host: 'primary', status: 500 },
      { host: 'mirror', status: 200 },
    ]);
    assert.equal(r.rec.requests.filter((q) => q.hostClass === 'models-facemorph-me').length, 1);
  },
);

test(
  'a localhost harness makes zero requests to models.facemorph.me',
  { skip: NO_BROWSER },
  async () => {
    const r = await acquireFrom(`https://127.0.0.1:${appPort}/`);
    assert.deepEqual(r.alternateOrigins, []);
    assert.deepEqual(r.served, [
      { host: 'primary', status: 500 },
      { host: 'primary', status: 200 },
    ]);
    assert.equal(
      r.rec.requests.filter((q) => new URL(q.url).hostname === 'models.facemorph.me').length,
      0,
    );
    assert.ok(r.rec.requests.length > 0, 'the recording saw the page traffic');
  },
);
