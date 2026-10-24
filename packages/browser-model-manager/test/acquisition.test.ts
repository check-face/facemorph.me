// Acquisition primitives (fm-fr9s), in real Chromium against real local https servers with a fault switch: grant
// enforcement (no request without a grant, scope, bytes that never inflate), shared fetch ownership and transfer,
// the retry schedule on real timers with alternate-origin alternation, no alternate configured means no other
// origin, priority classes and the aggregate slot budget across real workers (Web Locks), digest deduplication,
// output-cache-first, and the stall bound and silence deadline. Every claim about the network is read from the
// servers' own request logs (and, for "nothing at all", from the interception helper by host class). A host where
// Chromium cannot start reports these cases untested.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface Recorded {
  steps: { name: string }[];
  requests: { step: number; url: string; hostClass: string }[];
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
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

// ---------------------------------------------------------------- certificate, package build, servers

const work = mkdtempSync(join(tmpdir(), 'manager-acquisition-'));
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

const built = join(work, 'dist');
execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(PKG, 'tsconfig.build.json'),
  '--outDir',
  built,
]);

/** A module worker that acquires what it is told with the package's browser cache and its own slot view. */
const WORKER = `import * as m from '/pkg/index.js';
self.onmessage = async ({ data }) => {
  try {
    const cache = await m.createBrowserModelCache({
      slots: m.createAcquisitionSlots({ locks: navigator.locks, count: data.slots }),
      readAhead: data.readAhead, retryDelaysMs: [],
    });
    await Promise.all(data.assets.map((a) => cache.acquire(a, { grant: data.grant, owner: data.owner })));
    postMessage({ ok: true });
  } catch (e) { postMessage({ ok: false, message: String(e && e.message || e) }); }
};`;

const app = createServer(tls, (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
  const send = (type: string, body: Uint8Array | string) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (path === '/') return send('text/html', '<!doctype html><title>acquisition</title>');
  if (path === '/worker.js') return send('text/javascript', WORKER);
  if (path.startsWith('/pkg/')) {
    try {
      return send(
        extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream',
        readFileSync(join(built, path.slice(5))),
      );
    } catch {
      /* 404 below */
    }
  }
  res.writeHead(404);
  res.end();
});

/** What the fault switch does to one path, once per request until used up. */
interface Fault {
  /** Answer HTTP 500 this many more times. */
  fail?: number;
  /** Send half the body, then nothing (no reset), once. */
  silentOnce?: boolean;
  /** Send one byte wrong, once. */
  corruptOnce?: boolean;
  /** Stream the body in 8 pieces this far apart. */
  pieceDelayMs?: number;
}
interface Logged {
  readonly host: 'primary' | 'alternate';
  readonly path: string;
  readonly start: number;
  status: number;
  end: number;
  closedEarly: boolean;
}
const files = new Map<string, Uint8Array>();
const faults = new Map<string, Fault>(); // key `${host}:${path}`
const log: Logged[] = [];
let inFlight = 0;
let maxInFlight = 0;

function modelHandler(host: Logged['host']) {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const path = new URL(req.url ?? '/', 'https://x').pathname;
    const entry: Logged = { host, path, start: Date.now(), status: 0, end: 0, closedEarly: false };
    log.push(entry);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // In flight from arrival until the last byte is written (or the connection closes first): a window inside the
    // client's slot hold, which starts before its request and ends after it has every byte.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inFlight--;
    };
    res.on('close', () => {
      finish();
      entry.end = Date.now();
      entry.closedEarly = !res.writableFinished;
    });
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    const body = files.get(path);
    const fault = faults.get(`${host}:${path}`) ?? {};
    if (!body) {
      entry.status = 404;
      res.writeHead(404, cors);
      return res.end();
    }
    if ((fault.fail ?? 0) > 0) {
      fault.fail!--;
      entry.status = 500;
      res.writeHead(500, cors);
      return res.end();
    }
    entry.status = 200;
    res.writeHead(200, {
      ...cors,
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
    });
    let out = body;
    if (fault.corruptOnce) {
      fault.corruptOnce = false;
      out = body.slice();
      out[7] = out[7]! ^ 0xff;
    }
    if (fault.silentOnce) {
      fault.silentOnce = false;
      res.write(out.subarray(0, out.byteLength >> 1));
      return; // and nothing more: the connection stays open and silent
    }
    const step = Math.ceil(out.byteLength / 8);
    let at = 0;
    const next = () => {
      if (res.destroyed) return;
      const piece = out.subarray(at, at + step);
      at += step;
      if (at >= out.byteLength) {
        finish();
        return void res.end(piece);
      }
      res.write(piece);
      setTimeout(next, fault.pieceDelayMs ?? 0);
    };
    next();
  };
}
const primary = createServer(tls, modelHandler('primary'));
const alternate = createServer(tls, modelHandler('alternate'));
const appPort = await listen(app);
const primaryPort = await listen(primary);
const alternatePort = await listen(alternate);
const APP = `https://127.0.0.1:${appPort}`;
const PRIMARY = `https://127.0.0.1:${primaryPort}`;
const ALTERNATE = `https://127.0.0.1:${alternatePort}`;
const hostMap = {
  version: 1,
  rules: [
    { host: `127.0.0.1:${appPort}`, class: 'app' },
    { host: `127.0.0.1:${primaryPort}`, class: 'model-host' },
    { host: `127.0.0.1:${alternatePort}`, class: 'alternate-host' },
  ],
};

const CHUNK = 64 * 1024;
interface AssetInput {
  sha256: string;
  size: number;
  url: string;
  chunks?: { sha256: string; size: number; url: string }[];
}
/** A pinned asset of `n` chunks (n = 0: one unchunked unit) served at /<name>/... */
function asset(name: string, n: number, seed: number): AssetInput & { parts: string[] } {
  if (n === 0) {
    const b = bytes(CHUNK, seed);
    files.set(`/${name}.bin`, b);
    return {
      sha256: sha(b),
      size: b.byteLength,
      url: `${PRIMARY}/${name}.bin`,
      parts: [`/${name}.bin`],
    };
  }
  const parts = Array.from({ length: n }, (_, i) => bytes(CHUNK, seed * 100 + i));
  const whole = Buffer.concat(parts);
  const paths = parts.map((_, i) => `/${name}/part-${i}`);
  parts.forEach((p, i) => files.set(paths[i]!, p));
  files.set(`/${name}.bin`, whole);
  return {
    sha256: sha(whole),
    size: whole.byteLength,
    url: `${PRIMARY}/${name}.bin`,
    chunks: parts.map((p, i) => ({
      sha256: sha(p),
      size: p.byteLength,
      url: `${PRIMARY}${paths[i]}`,
    })),
    parts: paths,
  };
}
const descriptor = ({ parts: _parts, ...a }: AssetInput & { parts: string[] }): AssetInput => a;
type Priority = 'foreground-required' | 'optional' | 'speculative-warming';
/** A grant as the app makes it: plain data. */
const grant = (
  owners: string[],
  assets: AssetInput[],
  remainingBytes: number,
  priority: Priority = 'foreground-required',
) => ({
  manifestSha256: 'acquisition-test',
  route: 'cpu',
  purpose: 'generate',
  assets: assets.map((a) => ({ sha256: a.sha256, bytes: a.size, priority })),
  remainingBytes,
  owners,
});
const requestsFor = (paths: string[], from = 0) =>
  log.slice(from).filter((l) => paths.includes(l.path));

// ---------------------------------------------------------------- browser

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
  for (const s of [app, primary, alternate]) s.close();
});

async function session() {
  const context = await browser!.newContext({ ignoreHTTPSErrors: true });
  const att = helper.attachPlaywright(context, hostMap);
  const page = await context.newPage();
  await page.goto(`${APP}/`);
  await page.evaluate(() => import(String('/pkg/index.js')), undefined);
  return { context, page, rec: att.rec, settled: () => att.settled() };
}

// ---------------------------------------------------------------- grants

test(
  'no request without a grant: a missing grant, an owner it does not name, a digest or size outside it',
  { skip: NO_BROWSER },
  async () => {
    const X = asset('nogrant', 2, 1);
    const Y = asset('other', 0, 2);
    const s = await session();
    try {
      const from = log.length;
      const refusals = await s.page.evaluate(
        async ({ x, gOwner, gScope, gSize }) => {
          const m = await import(String('/pkg/index.js'));
          const cache = await m.createBrowserModelCache({ retryDelaysMs: [] });
          const out: string[] = [];
          for (const options of [
            undefined,
            { grant: gOwner, owner: 'face:b' },
            { grant: gScope, owner: 'face:a' },
            { grant: gSize, owner: 'face:a' },
          ]) {
            try {
              await cache.acquire(x, options);
              out.push('acquired');
            } catch (e) {
              out.push(
                e instanceof m.GrantRefused
                  ? (e as { refusal: string }).refusal
                  : `other: ${String(e)}`,
              );
            }
          }
          out.push(String(await cache.has(x)));
          return out;
        },
        {
          x: descriptor(X),
          gOwner: grant(['face:a'], [X], X.size),
          gScope: grant(['face:a'], [Y], 1 << 20),
          gSize: {
            ...grant(['face:a'], [X], 1 << 20),
            assets: [{ sha256: X.sha256, bytes: X.size + 1, priority: 'foreground-required' }],
          },
        },
      );
      assert.deepEqual(refusals, [
        'no-grant',
        'owner-not-in-grant',
        'out-of-scope',
        'out-of-scope',
        'false',
      ]);
      await s.settled();
      assert.equal(requestsFor([...X.parts, ...Y.parts], from).length, 0);
      assert.equal(
        s.rec.requests.filter((r) => r.hostClass !== 'app').length,
        0,
        'no model request of any kind',
      );
    } finally {
      await s.context.close();
    }
  },
);

test(
  'grant bytes never inflate: a corrupt stored chunk is refetched only under a grant that still covers it',
  { skip: NO_BROWSER },
  async () => {
    const X = asset('exact', 3, 3);
    const Y = asset('wire', 2, 4);
    faults.set(`primary:${Y.parts[0]}`, { corruptOnce: true });
    const s = await session();
    try {
      const before = log.length;
      const out = await s.page.evaluate(
        async ({ x, y, g1, g2, gy }) => {
          const m = await import(String('/pkg/index.js'));
          // One chunk at a time, so what each attempt receives is deterministic.
          const cache = await m.createBrowserModelCache({ retryDelaysMs: [], readAhead: 1 });
          const steps: Record<string, unknown> = {};
          const h1 = await cache.acquire(x, { grant: g1, owner: 'face:a' });
          steps.afterAcquire = m.grantRemaining(g1);
          // Corrupt chunk 1 in OPFS behind the cache's back: right size, valid trailer, wrong payload.
          const unit = x.chunks![1]!;
          const dir = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('checkface-model-shards-v1');
          const w = await (
            await dir.getFileHandle(unit.sha256)
          ).createWritable({ keepExistingData: false });
          await w.write(new Uint8Array(unit.size).fill(7));
          await w.write(m.trailer(unit.sha256, unit.size));
          await w.close();
          steps.mark1 = performance.now();
          try {
            await h1.bytes();
            steps.repairUnderSpentGrant = 'served';
          } catch (e) {
            steps.repairUnderSpentGrant =
              e instanceof m.GrantRefused ? (e as { refusal: string }).refusal : String(e);
          }
          steps.afterRefusal = m.grantRemaining(g1);
          // An asset outside the grant is refused, whatever is left in it.
          try {
            await cache.acquire(y, { grant: g1, owner: 'face:a' });
          } catch (e) {
            steps.outOfScope =
              e instanceof m.GrantRefused ? (e as { refusal: string }).refusal : String(e);
          }
          // A revised grant (a new decision, a new object) for one chunk's bytes repairs it.
          const h2 = await cache.acquire(x, { grant: g2, owner: 'face:a' });
          const b = await h2.bytes();
          steps.repaired =
            Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (v) =>
              v.toString(16).padStart(2, '0'),
            ).join('') === x.sha256;
          steps.afterRepair = m.grantRemaining(g2);
          // A chunk corrupted on the wire is rejected and nothing is stored; its bytes stay spent.
          try {
            await cache.acquire(y, { grant: gy, owner: 'face:a' });
            steps.wire = 'acquired';
          } catch (e) {
            steps.wire = String((e as Error).message);
          }
          steps.wireHas = await cache.has(y);
          steps.wireRemaining = m.grantRemaining(gy);
          await cache.acquire(y, { grant: gy, owner: 'face:a' });
          steps.wireRetried = m.grantRemaining(gy);
          return steps;
        },
        {
          x: descriptor(X),
          y: descriptor(Y),
          g1: grant(['face:a'], [X], X.size),
          g2: grant(['face:a'], [X], CHUNK),
          gy: grant(['face:a'], [Y], Y.size + CHUNK),
        },
      );
      assert.equal(out.afterAcquire, 0);
      assert.equal(out.repairUnderSpentGrant, 'revision-required');
      assert.equal(out.afterRefusal, 0, 'a refused repair does not add to the grant');
      assert.equal(out.outOfScope, 'out-of-scope');
      assert.equal(out.repaired, true);
      assert.equal(out.afterRepair, 0);
      // X: three chunks, then exactly one refetch of chunk 1 (under g2), nothing under the spent g1.
      assert.deepEqual(
        requestsFor(X.parts, before).map((l) => l.path),
        [...X.parts, X.parts[1]],
      );
      assert.match(String(out.wire), /integrity/i);
      assert.equal(out.wireHas, false);
      assert.equal(
        out.wireRemaining,
        Y.size + CHUNK - CHUNK,
        'the corrupt chunk was received, so it was spent',
      );
      assert.equal(
        out.wireRetried,
        0,
        'the second attempt fetched the rest within what was approved',
      );
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

// ---------------------------------------------------------------- shared fetch ownership

test(
  'two owners share one fetch; the first leaving hands it on; the last leaving stops it; verified chunks are kept',
  { skip: NO_BROWSER },
  async () => {
    const S = asset('shared', 5, 5);
    for (const p of S.parts) faults.set(`primary:${p}`, { pieceDelayMs: 40 }); // about 300 ms a chunk
    const s = await session();
    try {
      const before = log.length;
      const out = await s.page.evaluate(
        async ({ a, ga, gb }) => {
          const m = await import(String('/pkg/index.js'));
          let units = 0;
          const waiters: (() => void)[] = [];
          const waitUnits = (n: number) =>
            new Promise<void>((r) => {
              const f = () => units >= n && r();
              waiters.push(f);
              f();
            });
          const cache = await m.createBrowserModelCache({
            retryDelaysMs: [],
            readAhead: 1,
            slots: null,
            report: (e: { status: string }) => {
              if (e.status !== 'progress') return;
              units++;
              for (const f of waiters) f();
            },
          });
          (window as unknown as { __cache: unknown }).__cache = cache;
          const ca = new AbortController();
          const cb = new AbortController();
          const pa = cache.acquire(a, { grant: ga, owner: 'face:a', signal: ca.signal }).then(
            () => 'done',
            (e: Error) => e.name,
          );
          const pb = cache.acquire(a, { grant: gb, owner: 'face:b', signal: cb.signal }).then(
            () => 'done',
            (e: Error) => e.name,
          );
          await waitUnits(1);
          ca.abort();
          const afterA = await pa;
          await waitUnits(3);
          await new Promise((r) => setTimeout(r, 150)); // halfway through the fourth chunk
          const abortedAt = Date.now();
          cb.abort();
          const afterB = await pb;
          return {
            afterA,
            afterB,
            abortedAt,
            paidA: a.size - m.grantRemaining(ga),
            paidB: a.size - m.grantRemaining(gb),
            kept: units,
          };
        },
        {
          a: descriptor(S),
          ga: grant(['face:a'], [S], S.size),
          gb: grant(['face:b'], [S], S.size),
        },
      );
      assert.equal(out.afterA, 'AbortError', 'the first owner leaves');
      assert.equal(out.afterB, 'AbortError', 'the last owner leaves');
      assert.ok(out.paidA > 0, 'a paid while it owned the fetch');
      assert.ok(
        out.paidB > 0,
        'b carried the fetch on under its own grant after a left (ownership transfer)',
      );
      assert.ok(
        out.paidA + out.paidB <= S.size + CHUNK,
        'the two grants together paid for no more than one fetch and the cut chunk',
      );
      await new Promise((r) => setTimeout(r, 500));
      const shared = requestsFor(S.parts, before);
      // The last owner's cancel stopped the transfer: the request in flight was cut within a second, and nothing was
      // asked after it.
      const cut = shared.filter((l) => l.closedEarly);
      assert.equal(cut.length, 1, JSON.stringify(shared));
      assert.ok(
        cut[0]!.end - out.abortedAt < 1000,
        `cut ${cut[0]!.end - out.abortedAt} ms after the cancel`,
      );
      assert.ok(
        shared.every((l) => l.start <= out.abortedAt),
        'no request after the last owner left',
      );
      assert.ok(shared.length < S.parts.length, 'the fetch stopped before the asset was complete');

      // A third owner later: only what was not verified and kept is fetched.
      const fromC = log.length;
      const remainingC = await s.page.evaluate(
        async ({ a, gc }) => {
          const m = await import(String('/pkg/index.js'));
          const cache = (
            window as unknown as { __cache: { acquire(a: object, o: object): Promise<unknown> } }
          ).__cache;
          await cache.acquire(a, { grant: gc, owner: 'face:c' });
          return m.grantRemaining(gc) as number;
        },
        { a: descriptor(S), gc: grant(['face:c'], [S], S.size) },
      );
      const byC = requestsFor(S.parts, fromC).map((l) => l.path);
      assert.deepEqual(
        byC,
        S.parts.slice(out.kept),
        'c fetched exactly the chunks that were not kept',
      );
      assert.equal(remainingC, S.size - byC.length * CHUNK, 'c paid for exactly those chunks');
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

// ---------------------------------------------------------------- retries and alternate origins (real timers)

/** In the page: acquire one asset under a grant for exactly its bytes, with the given cache options. */
const acquireOne = (page: Page, a: AssetInput, g: object, options: object) =>
  page.evaluate(
    async ({ a, g, options }) => {
      const m = await import(String('/pkg/index.js'));
      const cache = await m.createBrowserModelCache({ slots: null, ...options });
      try {
        await cache.acquire(a, { grant: g, owner: 'face:a' });
        return { ok: true, remaining: m.grantRemaining(g) as number, message: '' };
      } catch (e) {
        return {
          ok: false,
          remaining: m.grantRemaining(g) as number,
          message: String((e as Error).message),
        };
      }
    },
    { a, g, options },
  );

const gaps = (entries: Logged[]) => entries.slice(1).map((l, i) => l.start - entries[i]!.start);
/** Each pause is at least its scheduled delay, and not much more (request set-up only). */
function assertSchedule(entries: Logged[], delays: number[]) {
  const seen = gaps(entries);
  assert.equal(seen.length, delays.length, JSON.stringify(seen));
  seen.forEach((gap, i) =>
    assert.ok(
      gap >= delays[i]! - 5 && gap < delays[i]! + 1500,
      `pause ${i}: ${gap} ms, scheduled ${delays[i]} ms`,
    ),
  );
}

test(
  'a transient 500 is retried on the 1, 4, 10 s schedule and recovers; with no alternate configured, nothing leaves the primary origin',
  { skip: NO_BROWSER, timeout: 60_000 },
  async () => {
    const R = asset('flaky', 0, 6);
    faults.set(`primary:${R.parts[0]}`, { fail: 3 });
    const s = await session();
    try {
      const from = log.length;
      const out = await acquireOne(s.page, descriptor(R), grant(['face:a'], [R], R.size), {});
      assert.deepEqual(out, { ok: true, remaining: 0, message: '' });
      const tries = requestsFor(R.parts, from);
      assert.deepEqual(
        tries.map((l) => [l.host, l.status]),
        [
          ['primary', 500],
          ['primary', 500],
          ['primary', 500],
          ['primary', 200],
        ],
      );
      assertSchedule(tries, [1000, 4000, 10000]);
      await s.settled();
      assert.equal(
        s.rec.requests.filter((r) => r.hostClass === 'alternate-host').length,
        0,
        'zero requests to any other origin',
      );
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

test(
  'retries alternate between the primary and the alternate origin in the candidate order, inside the grant',
  { skip: NO_BROWSER, timeout: 60_000 },
  async () => {
    const R = asset('mirrored', 0, 7);
    faults.set(`primary:${R.parts[0]}`, { fail: 99 });
    faults.set(`alternate:${R.parts[0]}`, { fail: 1 });
    files.set(R.parts[0]!, files.get(R.parts[0]!)!); // the alternate serves the same path
    const s = await session();
    try {
      const from = log.length;
      // The grant covers exactly the asset: failed attempts sent no body, so the alternate's bytes fit.
      const out = await acquireOne(s.page, descriptor(R), grant(['face:a'], [R], R.size), {
        alternateOrigins: [ALTERNATE],
      });
      assert.deepEqual(out, { ok: true, remaining: 0, message: '' });
      const tries = requestsFor(R.parts, from);
      assert.deepEqual(
        tries.map((l) => [l.host, l.status]),
        [
          ['primary', 500],
          ['alternate', 500],
          ['primary', 500],
          ['alternate', 200],
        ],
      );
      assertSchedule(tries, [1000, 4000, 10000]);
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

// ---------------------------------------------------------------- priority, aggregate budget, deduplication

test(
  'foreground-required work outranks optional preparation for the next free slot',
  { skip: NO_BROWSER },
  async () => {
    const O = asset('optional', 3, 8);
    const F = asset('foreground', 2, 9);
    for (const p of [...O.parts, ...F.parts]) faults.set(`primary:${p}`, { pieceDelayMs: 40 });
    const s = await session();
    try {
      const from = log.length;
      await s.page.evaluate(
        async ({ o, f, go, gf }) => {
          const m = await import(String('/pkg/index.js'));
          const cache = await m.createBrowserModelCache({
            retryDelaysMs: [],
            slots: m.createAcquisitionSlots({
              locks: navigator.locks,
              count: 1,
              name: 'priority-test',
            }),
          });
          let started!: () => void;
          const firstOptional = new Promise<void>((r) => (started = r));
          const pending = cache.acquire(o, { grant: go, owner: 'warming:o' });
          // The foreground request arrives while the first optional chunk holds the only slot.
          setTimeout(started, 120);
          await firstOptional;
          await Promise.all([pending, cache.acquire(f, { grant: gf, owner: 'face:f' })]);
        },
        {
          o: descriptor(O),
          f: descriptor(F),
          go: grant(['warming:o'], [O], O.size, 'optional'),
          gf: grant(['face:f'], [F], F.size, 'foreground-required'),
        },
      );
      const order = requestsFor([...O.parts, ...F.parts], from).map((l) => l.path);
      assert.deepEqual(order, [O.parts[0], F.parts[0], F.parts[1], O.parts[1], O.parts[2]]);
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

test(
  'the aggregate budget holds across workers, and an identical digest is fetched once',
  { skip: NO_BROWSER, timeout: 60_000 },
  async () => {
    const W = [asset('w0', 3, 10), asset('w1', 3, 11), asset('w2', 3, 12)];
    const D = asset('dup', 3, 13);
    const C = [asset('c0', 3, 17), asset('c1', 3, 18), asset('c2', 3, 19)];
    for (const a of [...W, D, ...C])
      for (const p of a.parts) faults.set(`primary:${p}`, { pieceDelayMs: 30 });
    const s = await session();
    try {
      // Three module workers with read-ahead 2 each: alone they would hold six chunks.
      const run = (jobs: { assets: AssetInput[]; owner: string }[], slots = 2) =>
        s.page.evaluate(
          async ({ jobs, grants, slots }) => {
            const results = await Promise.all(
              jobs.map(
                (job, i) =>
                  new Promise<{ ok: boolean; message?: string }>((resolve) => {
                    const worker = new Worker('/worker.js', { type: 'module' });
                    worker.onmessage = ({ data }) => {
                      worker.terminate();
                      resolve(data);
                    };
                    worker.postMessage({
                      assets: job.assets,
                      grant: grants[i],
                      owner: job.owner,
                      slots,
                      readAhead: 2,
                    });
                  }),
              ),
            );
            return results;
          },
          { jobs, grants: jobs.map((j) => grant([j.owner], j.assets, 1 << 24)), slots },
        );
      // Control: with six slots the same load does put more than two chunks in flight, so the bound below is the
      // slots' doing and the measurement can see a breach.
      maxInFlight = inFlight;
      await run(
        C.map((a, i) => ({ assets: [descriptor(a)], owner: `face:c${i}` })),
        6,
      );
      assert.ok(maxInFlight > 2, `control: ${maxInFlight} in flight with six slots`);

      const from = log.length;
      maxInFlight = inFlight;
      const spread = await run(W.map((a, i) => ({ assets: [descriptor(a)], owner: `face:w${i}` })));
      assert.deepEqual(
        spread,
        W.map(() => ({ ok: true })),
      );
      assert.ok(
        maxInFlight <= 2,
        `at most two chunks in flight across workers, saw ${maxInFlight}`,
      );
      assert.equal(maxInFlight, 2, 'and the budget is used');
      assert.equal(
        requestsFor(
          W.flatMap((a) => a.parts),
          from,
        ).length,
        9,
      );

      const fromDup = log.length;
      const dup = await run([
        { assets: [descriptor(D)], owner: 'face:d0' },
        { assets: [descriptor(D)], owner: 'face:d1' },
      ]);
      assert.deepEqual(dup, [{ ok: true }, { ok: true }]);
      assert.deepEqual(
        requestsFor(D.parts, fromDup)
          .map((l) => l.path)
          .sort(),
        [...D.parts].sort(),
        'each chunk fetched once',
      );
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

test(
  'across workers, optional work takes no slot while foreground work waits in another worker',
  { skip: NO_BROWSER, timeout: 60_000 },
  async () => {
    // The page holds both slots: SA1 for about 1.2 s, SA2 for about 0.6 s. Worker C asks for foreground F and worker
    // B for optional O while both are held. The slot SA2 frees must go to F, whichever slot F queued behind.
    const SA1 = asset('hold-long', 0, 20);
    const SA2 = asset('hold-short', 0, 21);
    const F = asset('cross-fg', 0, 22);
    const O = asset('cross-opt', 0, 23);
    faults.set(`primary:${SA1.parts[0]}`, { pieceDelayMs: 150 });
    faults.set(`primary:${SA2.parts[0]}`, { pieceDelayMs: 75 });
    const s = await session();
    try {
      const from = log.length;
      const results = await s.page.evaluate(
        async ({ held, gHeld, f, gf, o, go }) => {
          const m = await import(String('/pkg/index.js'));
          const cache = await m.createBrowserModelCache({
            retryDelaysMs: [],
            slots: m.createAcquisitionSlots({ locks: navigator.locks, count: 2 }),
          });
          const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const inWorker = (assets: object[], grant: object, owner: string) =>
            new Promise<{ ok: boolean; message?: string }>((resolve) => {
              const worker = new Worker('/worker.js', { type: 'module' });
              worker.onmessage = ({ data }) => {
                worker.terminate();
                resolve(data);
              };
              worker.postMessage({ assets, grant, owner, slots: 2, readAhead: 1 });
            });
          const page = Promise.all(
            held.map((a: object) => cache.acquire(a, { grant: gHeld, owner: 'face:held' })),
          );
          await pause(200);
          const fg = inWorker([f], gf, 'face:f');
          await pause(150);
          const opt = inWorker([o], go, 'warming:o');
          await page;
          return Promise.all([fg, opt]);
        },
        {
          held: [descriptor(SA1), descriptor(SA2)],
          gHeld: grant(['face:held'], [SA1, SA2], SA1.size + SA2.size),
          f: descriptor(F),
          gf: grant(['face:f'], [F], F.size),
          o: descriptor(O),
          go: grant(['warming:o'], [O], O.size, 'optional'),
        },
      );
      assert.deepEqual(results, [{ ok: true }, { ok: true }]);
      const at = (a: { parts: string[] }) => requestsFor(a.parts, from)[0]!;
      assert.ok(
        at(F).start < at(O).start,
        `foreground at ${at(F).start - at(SA1).start} ms, optional at ${at(O).start - at(SA1).start} ms`,
      );
      assert.ok(
        at(O).start >= at(SA1).end - 50 || at(O).start >= at(F).end - 50,
        'optional waited for a slot no one else wanted',
      );
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);

// ---------------------------------------------------------------- output cache first

test(
  'an output-cache hit issues zero downloads; a miss acquires under the grant',
  { skip: NO_BROWSER },
  async () => {
    const X = asset('output', 2, 14);
    const s = await session();
    try {
      const from = log.length;
      const out = await s.page.evaluate(
        async ({ x, g }) => {
          const m = await import(String('/pkg/index.js'));
          const outputs = await caches.open('facemorph-output-test');
          const key = new URL('/outputs/face-emma.webp', location.origin).href;
          await outputs.put(
            key,
            new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
          );
          const cache = await m.createBrowserModelCache({ retryDelaysMs: [] });
          const action = () =>
            m.satisfyAction(
              () => outputs.match(key),
              () => cache.acquire(x, { grant: g, owner: 'face:emma' }),
            );
          const hit = (await action()).from;
          const afterHit = await cache.has(x);
          await outputs.delete(key);
          const miss = (await action()).from;
          return { hit, afterHit, miss };
        },
        { x: descriptor(X), g: grant(['face:emma'], [X], X.size) },
      );
      assert.deepEqual(out, { hit: 'output-cache', afterHit: false, miss: 'model' });
      assert.deepEqual(
        requestsFor(X.parts, from).map((l) => l.path),
        X.parts,
        'only the miss downloaded',
      );
    } finally {
      await s.context.close();
    }
  },
);

// ---------------------------------------------------------------- stall bound and silence deadline

test(
  'a chunk silent mid-body is abandoned and retried on a fresh request; a slow but steady asset outlives the deadline',
  { skip: NO_BROWSER, timeout: 60_000 },
  async () => {
    const T = asset('silent', 2, 15);
    faults.set(`primary:${T.parts[0]}`, { silentOnce: true });
    const U = asset('steady', 3, 16);
    for (const p of U.parts) faults.set(`primary:${p}`, { pieceDelayMs: 120 }); // about a second a chunk
    const s = await session();
    try {
      const from = log.length;
      const silent = await acquireOne(s.page, descriptor(T), grant(['face:a'], [T], T.size * 2), {
        stallMs: 600,
        retryDelaysMs: [50],
        readAhead: 1,
      });
      assert.equal(silent.ok, true, silent.message);
      const tries = requestsFor([T.parts[0]!], from);
      assert.equal(tries.length, 2);
      assert.ok(tries[0]!.closedEarly, 'the silent attempt was abandoned');
      assert.ok(tries[1]!.start - tries[0]!.start >= 600, 'after the stall bound');
      assert.equal(
        silent.remaining,
        T.size * 2 - T.size - CHUNK / 2,
        'the half chunk received before the silence is spent',
      );

      // Three seconds of steady arrival against a one-second silence deadline: it completes.
      const steady = await acquireOne(s.page, descriptor(U), grant(['face:a'], [U], U.size), {
        timeoutMs: 1000,
        stallMs: 1000,
        readAhead: 1,
        retryDelaysMs: [],
      });
      assert.deepEqual(steady, { ok: true, remaining: 0, message: '' });
    } finally {
      faults.clear();
      await s.context.close();
    }
  },
);
