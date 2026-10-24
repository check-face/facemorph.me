// Release consistency on the client (fm-fy2.14), in real Chromium against a staging model origin whose releases and
// faults are switched for real: an open tab that loaded release 1 keeps asking for release 1's digests after
// release 2 is published; an old file that has gone answers 404 and the tab gets the reload instruction after one
// request, never a request for release 2's file in its place; an acquisition cut off mid-chunk resumes with its
// verified chunks kept, and the resumed bytes are exactly the remaining bytes, as the origin sent them (the browser
// reports a chunk the manager has read to its exact size and then released as failed, with no size). Requests are
// recorded by the interception helper (scripts/ci/intercept/playwright.ts) by host class. A host where Chromium cannot
// start reports these cases untested. The same cases against the deployed test origin are the staging
// qualification's.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface Recorded {
  steps: { name: string }[];
  requests: { step: number; url: string; hostClass: string; bytes?: number }[];
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
};
const record = (await import(join(REPO, 'scripts/ci/intercept/record.ts'))) as {
  step(rec: Recorded, name: string): void;
};

/** Deterministic bytes (xorshift). */
function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const work = mkdtempSync(join(tmpdir(), 'manager-release-'));
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
const listen = (s: Server) =>
  new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

// The package as consumers get it: its build output, in a scratch directory.
const built = join(work, 'dist');
execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(PKG, 'tsconfig.build.json'),
  '--outDir',
  built,
]);

// Two releases. Release 1: a plain file and a three-chunk file. Release 2: a new plain file.
const r1Plain = bytes(40_000, 11);
const r1Parts = [bytes(60_000, 12), bytes(60_000, 13), bytes(60_000, 14)];
const r2Plain = bytes(40_000, 21);
const path = (b: Uint8Array) => `/runtime/assets/${sha(b)}.bin`;

// The staging model origin. `files` is what the current deployment serves; `cut` names a path whose next answer is
// cut off part-way (the socket is destroyed after half its bytes).
const site = {
  files: new Map<string, Uint8Array>(),
  cut: new Set<string>(),
  sent: [] as { path: string; bytes: number }[],
};
const publish = (release: 1 | 2, keepOld: boolean) => {
  site.files.clear();
  if (release === 1 || keepOld) {
    site.files.set(path(r1Plain), r1Plain);
    for (const p of r1Parts) site.files.set(path(p), p);
  }
  if (release === 2) site.files.set(path(r2Plain), r2Plain);
};
const model = createServer(tls, (req, res) => {
  const p = new URL(req.url ?? '/', 'https://x').pathname;
  const body = site.files.get(p);
  if (!body) return res.writeHead(404, { 'access-control-allow-origin': '*' }).end();
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(body.byteLength),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  if (site.cut.delete(p)) {
    site.sent.push({ path: p, bytes: body.byteLength >> 1 });
    res.write(body.subarray(0, body.byteLength >> 1));
    return void setTimeout(() => res.socket?.destroy(), 50);
  }
  site.sent.push({ path: p, bytes: body.byteLength });
  res.end(body);
});
const app = createServer(tls, (req, res) => {
  const p = new URL(req.url ?? '/', 'https://x').pathname;
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>r</title>');
  if (p.startsWith('/pkg/'))
    try {
      const body = readFileSync(join(built, p.slice(5)));
      return res
        .writeHead(200, {
          'content-type': extname(p) === '.js' ? 'text/javascript' : 'application/octet-stream',
        })
        .end(body);
    } catch {
      /* 404 below */
    }
  res.writeHead(404).end();
});
const appPort = await listen(app);
const modelPort = await listen(model);
const APP = `https://127.0.0.1:${appPort}`;
const MODEL = `https://127.0.0.1:${modelPort}`;
const hostMap = {
  version: 1,
  rules: [
    { host: `127.0.0.1:${appPort}`, class: 'app' },
    { host: `127.0.0.1:${modelPort}`, class: 'model-host' },
  ],
};
const asset = (b: Uint8Array) => ({
  sha256: sha(b),
  size: b.byteLength,
  url: `${MODEL}${path(b)}`,
});
const whole = new Uint8Array(Buffer.concat(r1Parts));
const release1 = {
  plain: asset(r1Plain),
  chunked: {
    sha256: sha(whole),
    size: whole.byteLength,
    url: `${MODEL}/runtime/assets/${sha(whole)}`,
    chunks: r1Parts.map(asset),
  },
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
  .launch({ executablePath: process.env['CHROMIUM_PATH'] })
  .catch(() => null);
const NO_BROWSER = browser ? false : 'untested: Chromium does not start here';
test.after(async () => {
  await browser?.close();
  app.close();
  model.close();
});

async function session() {
  const context = await browser!.newContext({ ignoreHTTPSErrors: true });
  const att = helper.attachPlaywright(context, hostMap);
  const page = await context.newPage();
  await page.goto(`${APP}/`);
  return { context, page, rec: att.rec, settled: () => att.settled() };
}

type Outcome =
  | { ok: true; sha256: string }
  | { ok: false; message: string; reload?: boolean; status?: number };
/** In the page: acquire one asset with the package's browser cache (OPFS shards), retries as configured. */
const acquire = (page: Page, input: object, retryDelaysMs: number[] = []) =>
  page.evaluate(
    async ({ input, retryDelaysMs }) => {
      const m = await import(String('/pkg/index.js'));
      const cache = await m.createBrowserModelCache({ retryDelaysMs });
      try {
        const handle = await cache.acquire(input);
        const b = await handle.bytes();
        const d = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
        return { ok: true, sha256: d };
      } catch (e) {
        const err = e as Error & { reload?: boolean; status?: number };
        return { ok: false, message: err.message, reload: err.reload, status: err.status };
      }
    },
    { input, retryDelaysMs },
  ) as Promise<Outcome>;

const modelRequests = (rec: Recorded, stepName: string) =>
  rec.requests.filter((r) => rec.steps[r.step]?.name === stepName && r.hostClass === 'model-host');

test(
  'an open tab keeps release 1 after release 2 is published; a gone file gets the reload instruction after one request',
  { skip: NO_BROWSER },
  async () => {
    publish(1, false);
    const { context, page, rec, settled } = await session();
    try {
      // Release 2 is published while the tab is open; release 1's files are still held.
      publish(2, true);
      record.step(rec, 'old-tab');
      assert.deepEqual(await acquire(page, release1.chunked), {
        ok: true,
        sha256: release1.chunked.sha256,
      });
      await settled();
      const urls = modelRequests(rec, 'old-tab').map((r) => new URL(r.url).pathname);
      const release1Paths = r1Parts.map(path);
      assert.ok(urls.length > 0 && urls.every((u) => release1Paths.includes(u)), urls.join(' '));

      // Release 1's files have gone (past the retention window): the old tab asks once, then is told to reload.
      publish(2, false);
      record.step(rec, 'gone');
      const gone = await acquire(page, release1.plain, [0, 0, 0]);
      await settled();
      assert.equal(gone.ok, false);
      assert.ok(!gone.ok && gone.reload === true && gone.status === 404, JSON.stringify(gone));
      assert.match(!gone.ok ? gone.message : '', /Reload the page/);
      const asked = modelRequests(rec, 'gone').map((r) => new URL(r.url).pathname);
      assert.deepEqual(asked, [path(r1Plain)], 'one request, for the old digest only');
    } finally {
      await context.close();
    }
  },
);

test(
  'an acquisition cut off mid-chunk resumes with verified chunks kept: the resumed bytes are the remaining bytes',
  { skip: NO_BROWSER },
  async (t) => {
    publish(1, false);
    const { context, page, rec, settled } = await session();
    try {
      site.cut.add(path(r1Parts[1]!));
      record.step(rec, 'cut');
      const first = await acquire(page, release1.chunked);
      assert.equal(first.ok, false, 'no retries configured: the cut fails the acquisition');
      await settled();
      // The chunks the manager verified and kept before the cut, read from its own OPFS shard store.
      const kept = await page.evaluate(async (units) => {
        const m = await import(String('/pkg/index.js'));
        const store = await m.openShardStore({ readOnly: true });
        const out: string[] = [];
        for (const u of units) if (await store.has(u.sha256, u.size)) out.push(u.sha256);
        return out;
      }, release1.chunked.chunks);
      assert.ok(!kept.includes(sha(r1Parts[1]!)), 'the cut chunk is not kept');
      assert.ok(kept.length > 0, 'a chunk verified before the cut is kept');
      t.diagnostic(`kept before the cut: ${kept.length} of ${r1Parts.length} chunks`);
      record.step(rec, 'resume');
      site.sent = [];
      assert.deepEqual(await acquire(page, release1.chunked), {
        ok: true,
        sha256: release1.chunked.sha256,
      });
      await settled();
      const resumed = modelRequests(rec, 'resume');
      const resumedPaths = resumed.map((r) => new URL(r.url).pathname).sort();
      const remaining = r1Parts.filter((p) => !kept.includes(sha(p)));
      assert.deepEqual(resumedPaths, remaining.map(path).sort(), 'only chunks not yet verified');
      assert.equal(
        site.sent.reduce((n, r) => n + r.bytes, 0),
        remaining.reduce((n, p) => n + p.byteLength, 0),
        'resumed bytes (as the origin sent them) equal the remaining bytes',
      );
    } finally {
      await context.close();
    }
  },
);
