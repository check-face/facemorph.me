// Verified local reads (fm-eulc/fm-fy2.13), in the selected real engine on both backends: OPFS shards and Cache Storage. An https app
// origin serves the built package and the candidate's own frozen cache modules; an https model-host origin
// serves pinned test assets. Network is observed with the request-interception helper
// (scripts/ci/intercept/playwright.ts) and counted by host class: every local read, and constructing the cache and
// reading its status, must issue zero requests. Corruption and eviction are made the way they happen: bytes
// changed or removed in the browser's own storage behind the cache's back. Unavailable engines report an
// explicit untested reason; the manager-cache CI lane requires its selected browser to start.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';
import type { Page } from 'playwright';
import { componentBrowser } from './support/browser.ts';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const FIXTURES = join(PKG, 'test/fixtures/candidate-cache');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface Recorded {
  steps: { name: string }[];
  requests: {
    step: number;
    url: string;
    hostClass: string;
    bytes: number | null;
    status: number | null;
    failed: boolean;
  }[];
}
interface Helper {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
}
interface Record_ {
  step(rec: Recorded, name: string): void;
  requestsIn(
    rec: Recorded,
    q: { fromStep?: string; toStep?: string; hostClass?: string },
    log?: (l: unknown) => void,
  ): { verdict: string; count: number };
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as Helper;
const record = (await import(join(REPO, 'scripts/ci/intercept/record.ts'))) as Record_;

// ---------------------------------------------------------------- fixtures: assets, origins, certificate

/** Deterministic bytes (xorshift), so assets are the same on every run. */
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
const parts = [bytes(70_000, 1), bytes(70_000, 2), bytes(70_000, 3)];
const whole = Buffer.concat(parts);
const plain = bytes(50_000, 9);
const files: Record<string, Uint8Array> = {
  '/part-0': parts[0]!,
  '/part-1': parts[1]!,
  '/part-2': parts[2]!,
  '/chunked.bin': whole,
  '/plain.bin': plain,
};

const work = mkdtempSync(join(tmpdir(), 'manager-local-'));
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

// The frozen candidate modules are served only when their bytes are the allowlist's.
const frozen: Record<string, Buffer> = {};
const allowlist = JSON.parse(readFileSync(join(REPO, 'import/allowlist.json'), 'utf8')) as {
  files: { destination: string; sha256: string }[];
};
for (const name of ['model-cache', 'shard-store', 'sha256']) {
  const body = readFileSync(join(FIXTURES, `${name}.mjs.frozen`));
  const pinned = allowlist.files.find(
    (f) => f.destination === `apps/web/src/Next/Assets/${name}.mjs`,
  );
  if (sha(body) !== pinned?.sha256)
    throw new Error(`${name}.mjs.frozen is not the frozen candidate's bytes`);
  frozen[`/candidate/${name}.mjs`] = body;
}

// The package as consumers get it: its build output (into a scratch directory, so a concurrent test that builds
// dist/ is not raced).
const built = join(work, 'dist');
execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(PKG, 'tsconfig.build.json'),
  '--outDir',
  built,
]);

const app = createServer(tls, (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
  const send = (type: string, body: Uint8Array | string) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (path === '/') return send('text/html', '<!doctype html><title>manager</title>');
  if (frozen[path]) return send('text/javascript', frozen[path]);
  if (path.startsWith('/pkg/')) {
    try {
      const body = readFileSync(join(built, path.slice(5)));
      return send(extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream', body);
    } catch {
      /* 404 below */
    }
  }
  res.writeHead(404);
  res.end();
});
const model = createServer(tls, (req, res) => {
  const body = files[new URL(req.url ?? '/', 'https://x').pathname];
  if (!body) {
    res.writeHead(404, { 'access-control-allow-origin': '*' });
    return res.end();
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(body.byteLength),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
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
const unit = (b: Uint8Array, i: number) => ({
  sha256: sha(b),
  size: b.byteLength,
  url: `${MODEL}/part-${i}`,
});
const ASSETS = {
  chunked: {
    sha256: sha(whole),
    size: whole.byteLength,
    url: `${MODEL}/chunked.bin`,
    chunks: parts.map(unit),
  },
  plain: { sha256: sha(plain), size: plain.byteLength, url: `${MODEL}/plain.bin` },
  never: { sha256: sha('never stored'), size: 12, url: `${MODEL}/never.bin` },
};

// ---------------------------------------------------------------- browser

const { engine, browser, newContext, unavailable: NO_BROWSER } = await componentBrowser();
test.after(async () => {
  await browser?.close();
  await Promise.all(
    [app, model].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  rmSync(work, { recursive: true, force: true });
});

/** A fresh context and page on the app origin, with the interception helper attached. */
async function session(name: string, persistent = true) {
  const options = { ignoreHTTPSErrors: true };
  const context = persistent ? await newContext!(options) : await browser!.newContext(options);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const att = helper.attachPlaywright(context, hostMap);
  const page = await context.newPage();
  await page.goto(`${APP}/`);
  return {
    context,
    page,
    rec: att.rec,
    settled: () => att.settled(),
    async capture() {
      const dir = join(REPO, 'test-results/manager-cache', engine);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${name}-network.json`), JSON.stringify(att.rec));
      await Promise.allSettled([
        page.screenshot({ path: join(dir, `${name}.png`) }),
        context.tracing.stop({ path: join(dir, `${name}.zip`) }),
      ]);
    },
  };
}

/** Requests of any host class in one step: local work must have none. */
function quiet(rec: Recorded, stepName: string) {
  const v = record.requestsIn(rec, { fromStep: stepName, toStep: stepName }, () => {});
  assert.equal(v.verdict, 'pass', `${stepName}: no data for the window`);
  assert.equal(
    v.count,
    0,
    `${stepName}: ${JSON.stringify(rec.requests.filter((r) => rec.steps[r.step]?.name === stepName))}`,
  );
}

type Backend = 'opfs' | 'cache-storage';
type ReadOut = { ok: boolean; code?: string; sha256?: string; size?: number };

/** In the page: the package's cache on one backend, then a local read of one asset. */
const readIn = (page: Page, backend: Backend, asset: object, fresh = true) =>
  page.evaluate(
    async ({ backend, asset, fresh }) => {
      const m = await import(String('/pkg/index.js'));
      const w = window as unknown as { __cache?: unknown };
      if (fresh || !w.__cache)
        w.__cache = await m.createBrowserModelCache(backend === 'opfs' ? {} : { shards: null });
      const r = await (
        w.__cache as {
          local: {
            read(a: object): Promise<{ ok: boolean; value?: Uint8Array; error?: { code: string } }>;
          };
        }
      ).local.read(asset);
      if (!r.ok) return { ok: false, code: r.error!.code };
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', r.value! as Uint8Array<ArrayBuffer>)),
        (x) => x.toString(16).padStart(2, '0'),
      ).join('');
      return { ok: true, sha256: digest, size: r.value!.byteLength };
    },
    { backend, asset, fresh },
  ) as Promise<ReadOut>;

/** In the page: acquire assets with the package's cache (over the network, as setup). */
const acquireIn = (page: Page, backend: Backend, assets: object[], module = '/pkg/index.js') =>
  page.evaluate(
    async ({ backend, assets, module }) => {
      const m = await import(module);
      const cache = await m.createBrowserModelCache(backend === 'opfs' ? {} : { shards: null });
      (window as unknown as { __cache: unknown }).__cache = cache;
      // The package's cache acquires only under a grant (fm-fr9s); the candidate's takes none.
      const grant = {
        manifestSha256: 'cache-local',
        route: 'cpu',
        purpose: 'generate',
        assets: (assets as { sha256: string; size: number }[]).map((a) => ({
          sha256: a.sha256,
          bytes: a.size,
          priority: 'foreground-required',
        })),
        remainingBytes: 1 << 30,
        owners: ['face:setup'],
      };
      for (const a of assets) await cache.acquire(a, { grant, owner: 'face:setup' });
    },
    { backend, assets, module },
  );

/** In the page: change or remove bytes in the browser's storage behind the cache. */
const tamper = (
  page: Page,
  backend: Backend,
  what: 'corrupt' | 'remove',
  target: { sha256: string; size: number },
  whole: string,
) =>
  page.evaluate(
    async ({ backend, what, target, whole }) => {
      if (backend === 'opfs') {
        const dir = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('checkface-model-shards-v1');
        if (what === 'remove') return dir.removeEntry(target.sha256);
        // A committed-looking unit: right size and a valid trailer for the pinned digest, wrong payload.
        const m = await import(String('/pkg/index.js'));
        const w = await (
          await dir.getFileHandle(target.sha256)
        ).createWritable({ keepExistingData: false });
        await w.write(new Uint8Array(target.size).fill(7));
        await w.write(m.trailer(target.sha256, target.size));
        await w.close();
        return;
      }
      const cache = await caches.open('checkface-model-blobs-v1');
      const key = new URL(`/__checkface_model_blobs__/sha256/${whole}`, location.origin).href;
      if (what === 'remove') return void (await cache.delete(key));
      await cache.put(key, new Response(new Uint8Array(target.size).fill(7)));
    },
    { backend, what, target, whole },
  );

for (const backend of ['opfs', 'cache-storage'] as const) {
  const name = backend === 'opfs' ? 'readShards (OPFS)' : 'openVerified (Cache Storage)';

  test(`${engine} ${backend} action cache cells`, { skip: NO_BROWSER }, async (t) => {
    const s = await session(`${backend}-action-cells`);
    const output = { id: 'completed-result', sha256: ASSETS.plain.sha256 };
    const cell = (name: string, run: () => Promise<void>) =>
      t.test(name, async () => {
        try {
          await run();
        } catch (error) {
          await s.capture();
          throw error;
        }
      });
    try {
      await s.page.evaluate(() => import(String('/pkg/index.js')));
      // These are component inputs, not evidence of synthesis. Use an app-owned Cache
      // Storage entry for the completed output, separate from either model backend.
      const action = (remainingBytes: number, authorized = true) =>
        s.page.evaluate(
          async ({ backend, asset, remainingBytes, authorized }) => {
            const m = await import(String('/pkg/index.js'));
            const cache = await m.createBrowserModelCache(
              backend === 'opfs' ? {} : { shards: null },
            );
            const outputs = await caches.open('manager-test-app-outputs');
            const result = await m.satisfyAction(
              async () => (await outputs.match('/completed-result'))?.json(),
              () =>
                cache.acquire(asset, {
                  owner: 'face:cache-cells',
                  grant: {
                    manifestSha256: 'action-cache-cells',
                    route: 'cpu',
                    purpose: 'generate',
                    assets: [
                      {
                        sha256: asset.sha256,
                        bytes: asset.size,
                        priority: 'foreground-required',
                      },
                    ],
                    owners: authorized ? ['face:cache-cells'] : [],
                    remainingBytes,
                  },
                }),
            );
            if (result.from === 'output-cache') return result;
            const read = await cache.local.read(asset);
            if (!read.ok) throw new Error(JSON.stringify(read.error));
            return {
              from: result.from,
              sha256: Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', read.value)),
                (x) => x.toString(16).padStart(2, '0'),
              ).join(''),
              size: read.value.byteLength,
            };
          },
          { backend, asset: ASSETS.chunked, remainingBytes, authorized },
        );
      const modelResult = {
        from: 'model',
        sha256: ASSETS.chunked.sha256,
        size: ASSETS.chunked.size,
      };
      await cell('cold: output miss acquires exact pinned model chunks', async () => {
        record.step(s.rec, 'action:cold');
        assert.deepEqual(await action(ASSETS.chunked.size), modelResult);
        await s.settled();
        const requests = s.rec.requests.filter((r) => r.hostClass === 'model-host');
        assert.deepEqual(
          requests.map((r) => r.url).sort(),
          ASSETS.chunked.chunks.map((part) => part.url).sort(),
          'cold action downloads each chunk exactly once',
        );
        assert.ok(
          requests.every((r) => r.bytes !== null),
          'every response byte count is observed',
        );
        assert.ok(
          requests.every((r) => r.status === 200 && !r.failed),
          `successfully consumed chunks must complete their HTTP requests without cancellation: ${JSON.stringify(requests)}`,
        );
        assert.equal(
          requests.reduce((sum, r) => sum + r.bytes!, 0),
          ASSETS.chunked.size,
          'cold transfer bytes equal the pinned model size',
        );
      });
      await cell('model-cached: reload uses verified model bytes with zero requests', async () => {
        await s.page.reload();
        await s.page.evaluate(() => import(String('/pkg/index.js')));
        record.step(s.rec, 'action:model-cached');
        // No transfer budget remains. A hidden re-download would refuse the action.
        assert.deepEqual(await action(0), modelResult);
        await s.settled();
        quiet(s.rec, 'action:model-cached');
      });
      await cell(
        'output-cached: reload without models or grant uses output with zero requests',
        async () => {
          await s.page.evaluate(async (output) => {
            const outputs = await caches.open('manager-test-app-outputs');
            await outputs.put('/completed-result', new Response(JSON.stringify(output)));
          }, output);
          for (const part of backend === 'opfs' ? ASSETS.chunked.chunks : [ASSETS.chunked])
            await tamper(s.page, backend, 'remove', part, ASSETS.chunked.sha256);
          await s.page.reload();
          assert.deepEqual(await readIn(s.page, backend, ASSETS.chunked), {
            ok: false,
            code: 'cache-miss',
          });
          record.step(s.rec, 'action:output-cached');
          // Revoked ownership makes reaching model acquisition a hard failure even
          // before I/O. Output reuse must precede model admission and grant checks.
          assert.deepEqual(await action(0, false), { from: 'output-cache', output });
          await s.settled();
          quiet(s.rec, 'action:output-cached');
          await s.page.evaluate(async () => {
            const outputs = await caches.open('manager-test-app-outputs');
            await outputs.delete('/completed-result');
          });
          record.step(s.rec, 'action:no-output-no-grant');
          await assert.rejects(action(0, false), /owner-not-in-grant/);
          await s.settled();
          quiet(s.rec, 'action:no-output-no-grant');
        },
      );
    } catch (error) {
      await s.capture();
      throw error;
    } finally {
      await s.context.close();
    }
  });

  test(
    `${engine} ${name}, allowRepair:false: verified bytes, then typed miss, corruption and eviction, no request`,
    { skip: NO_BROWSER },
    async () => {
      const s = await session(`${backend}-local`);
      try {
        record.step(s.rec, 'setup');
        await acquireIn(s.page, backend, [ASSETS.chunked, ASSETS.plain]);
        await s.settled();
        assert.ok(
          s.rec.requests.some((r) => r.hostClass === 'model-host'),
          'setup downloads from the model host',
        );

        record.step(s.rec, 'local:verified');
        const ok = await readIn(s.page, backend, ASSETS.chunked, false);
        assert.deepEqual(ok, { ok: true, sha256: ASSETS.chunked.sha256, size: whole.byteLength });

        record.step(s.rec, 'local:miss');
        assert.deepEqual(await readIn(s.page, backend, ASSETS.never, false), {
          ok: false,
          code: 'cache-miss',
        });

        const target = backend === 'opfs' ? ASSETS.chunked.chunks[1]! : ASSETS.chunked;
        await tamper(s.page, backend, 'corrupt', target, ASSETS.chunked.sha256);
        record.step(s.rec, 'local:corrupt');
        assert.deepEqual(await readIn(s.page, backend, ASSETS.chunked, false), {
          ok: false,
          code: 'corrupt',
        });

        await tamper(
          s.page,
          backend,
          'remove',
          backend === 'opfs' ? ASSETS.plain : ASSETS.plain,
          ASSETS.plain.sha256,
        );
        record.step(s.rec, 'local:evicted');
        assert.deepEqual(await readIn(s.page, backend, ASSETS.plain, false), {
          ok: false,
          code: 'evicted',
        });
        await s.settled();
        for (const w of ['local:verified', 'local:miss', 'local:corrupt', 'local:evicted'])
          quiet(s.rec, w);
      } catch (error) {
        await s.capture();
        throw error;
      } finally {
        await s.context.close();
      }
    },
  );

  test(
    `${engine} ${name}: presence or an unchecked peek never bypasses the digest`,
    { skip: NO_BROWSER },
    async () => {
      const s = await session(`${backend}-digest`);
      try {
        await acquireIn(s.page, backend, [ASSETS.chunked]);
        const target = backend === 'opfs' ? ASSETS.chunked.chunks[0]! : ASSETS.chunked;
        await tamper(s.page, backend, 'corrupt', target, ASSETS.chunked.sha256);
        record.step(s.rec, 'local:peek');
        const seen = await s.page.evaluate(
          async ({ asset, backend }) => {
            const m = await import(String('/pkg/index.js'));
            const cache = (
              window as unknown as {
                __cache: {
                  has(a: object): Promise<boolean>;
                  peek(a: object): Promise<Response | null>;
                  local: { read(a: object): Promise<{ ok: boolean; error?: { code: string } }> };
                };
              }
            ).__cache;
            // a new cache: nothing verified in its memory
            const fresh = await m.createBrowserModelCache(
              backend === 'opfs' ? {} : { shards: null },
            );
            const peeked = await fresh.peek(asset);
            const peekedBytes = peeked ? new Uint8Array(await peeked.arrayBuffer()) : null;
            return {
              has: await cache.has(asset),
              peekServedCorrupt: Boolean(peekedBytes && peekedBytes.every((b: number) => b === 7)),
              read: (await fresh.local.read(asset)).error?.code ?? 'ok',
            };
          },
          { asset: ASSETS.chunked, backend },
        );
        // Presence says yes on both (Cache Storage: the entry exists; OPFS: size and trailer match). peek() is the
        // candidate's unchecked look: on Cache Storage it hands back the stored entry as it is, on OPFS it reads
        // through readShards and finds nothing it can vouch for. Neither is a verified read: the local reader
        // digests the bytes and reports corruption.
        assert.equal(seen.has, true);
        assert.equal(seen.peekServedCorrupt, backend === 'cache-storage');
        assert.equal(seen.read, 'corrupt');
        await s.settled();
        quiet(s.rec, 'local:peek');
      } catch (error) {
        await s.capture();
        throw error;
      } finally {
        await s.context.close();
      }
    },
  );

  test(
    `${engine} ${name}: entries the control's own cache wrote are read locally without a download`,
    { skip: NO_BROWSER },
    async () => {
      const s = await session(`${backend}-candidate`);
      try {
        record.step(s.rec, 'candidate-writes');
        await acquireIn(
          s.page,
          backend,
          [ASSETS.chunked, ASSETS.plain],
          '/candidate/model-cache.mjs',
        );
        await s.page.evaluate(() => import(String('/pkg/index.js')), undefined); // module loading is app traffic
        await s.settled();
        record.step(s.rec, 'package-reads');
        for (const asset of [ASSETS.chunked, ASSETS.plain]) {
          const r = await readIn(s.page, backend, asset, true);
          assert.deepEqual(r, { ok: true, sha256: asset.sha256, size: asset.size });
        }
        await s.settled();
        quiet(s.rec, 'package-reads');
      } catch (error) {
        await s.capture();
        throw error;
      } finally {
        await s.context.close();
      }
    },
  );
}

if (engine === 'webkit')
  test(
    'webkit ephemeral OPFS unavailable: automatic Cache Storage fallback verifies local bytes without repair',
    { skip: NO_BROWSER },
    async () => {
      const s = await session('automatic-fallback', false);
      try {
        const directory = await s.page.evaluate(async () => {
          try {
            await navigator.storage.getDirectory();
            return { available: true, error: '' };
          } catch (error) {
            return { available: false, error: String(error) };
          }
        });
        assert.equal(directory.available, false, 'this cell requires genuinely unavailable OPFS');
        assert.ok(directory.error.length > 0);
        // Default options: no injected backend, patched API or simulated storage failure.
        await acquireIn(s.page, 'opfs', [ASSETS.chunked]);
        await s.settled();
        record.step(s.rec, 'local:auto-fallback');
        const stored = await s.page.evaluate(async (digest) => {
          const blobs = await caches.open('checkface-model-blobs-v1');
          const key = new URL(`/__checkface_model_blobs__/sha256/${digest}`, location.origin);
          return !!(await blobs.match(key));
        }, ASSETS.chunked.sha256);
        assert.equal(stored, true, 'the default cache actually stored the asset in Cache Storage');
        assert.deepEqual(await readIn(s.page, 'opfs', ASSETS.chunked), {
          ok: true,
          sha256: ASSETS.chunked.sha256,
          size: whole.byteLength,
        });
        await tamper(s.page, 'cache-storage', 'corrupt', ASSETS.chunked, ASSETS.chunked.sha256);
        assert.deepEqual(await readIn(s.page, 'opfs', ASSETS.chunked), {
          ok: false,
          code: 'corrupt',
        });
        await s.settled();
        quiet(s.rec, 'local:auto-fallback');
      } catch (error) {
        await s.capture();
        throw error;
      } finally {
        await s.context.close();
      }
    },
  );

test(
  `${engine} constructing the cache and reading status and presence issue zero requests`,
  { skip: NO_BROWSER },
  async () => {
    const s = await session('status');
    try {
      await s.page.evaluate(() => import(String('/pkg/index.js')), undefined); // the module itself is app traffic, before the window
      record.step(s.rec, 'construct');
      const out = await s.page.evaluate(async (asset) => {
        const m = await import(String('/pkg/index.js'));
        const opfs = await m.createBrowserModelCache({});
        const cacheOnly = await m.createBrowserModelCache({ shards: null });
        const ro = await m.createBrowserModelCache({ readOnly: true });
        const status = await m.storageStatus();
        return {
          status: status.persistence,
          has: [await opfs.has(asset), await cacheOnly.has(asset), await ro.has(asset)],
        };
      }, ASSETS.chunked);
      assert.deepEqual(out.has, [false, false, false]);
      await s.settled();
      quiet(s.rec, 'construct');
    } catch (error) {
      await s.capture();
      throw error;
    } finally {
      await s.context.close();
    }
  },
);

for (const backend of ['opfs', 'cache-storage'] as const)
  test(
    `${engine} ${backend} actual quota exhaustion is typed, settles without repair, and permits an explicit retry`,
    {
      skip:
        NO_BROWSER ||
        (engine !== 'chromium' && 'untested: browser quota override requires Chromium CDP'),
      timeout: 120_000,
    },
    async () => {
      const s = await session(`quota-${backend}`);
      const cdp = await s.context.newCDPSession(s.page);
      try {
        // Initialize the real backend before constraining this isolated origin's storage.
        await s.page.evaluate(async (backend) => {
          const m = await import(String('/pkg/index.js'));
          await m.createBrowserModelCache(backend === 'opfs' ? {} : { shards: null });
        }, backend);
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: APP, quotaSize: 1 });
        const out = await s.page.evaluate(
          async ({ backend, asset }) => {
            const m = await import(String('/pkg/index.js'));
            const events: string[] = [];
            const cache = await m.createBrowserModelCache({
              ...(backend === 'opfs' ? {} : { shards: null }),
              report: (event: { status: string }) => events.push(event.status),
            });
            const grant = {
              manifestSha256: 'quota-cell',
              route: 'cpu',
              purpose: 'generate',
              assets: [
                { sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' },
              ],
              remainingBytes: asset.size,
              owners: ['face:quota'],
            };
            try {
              await cache.acquire(asset, { grant, owner: 'face:quota' });
              return { acquired: true };
            } catch (error) {
              const e = error as {
                name: string;
                error?: { code: string; requiredBytes: number };
                cause?: { name: string };
              };
              return {
                acquired: false,
                name: e.name,
                typed: e.error,
                cause: e.cause?.name,
                events,
              };
            }
          },
          { backend, asset: ASSETS.plain },
        );
        assert.equal(out.acquired, false, 'the real browser must refuse the storage write');
        assert.equal(out.name, 'QuotaExceededError');
        assert.deepEqual(out.typed, {
          code: 'quota',
          requiredBytes: ASSETS.plain.size,
          message:
            'Not enough browser storage to save this model. Free some storage and try again.',
        });
        assert.equal(out.cause, 'QuotaExceededError');
        assert.ok(out.events?.includes('quota-exceeded'));
        await s.settled();
        assert.equal(
          s.rec.requests.filter((request) => request.hostClass === 'model-host').length,
          1,
          'quota refusal must not start another model transfer',
        );
        record.step(s.rec, 'local:quota-failure');
        assert.equal((await readIn(s.page, backend, ASSETS.plain)).ok, false);
        await s.settled();
        quiet(s.rec, 'local:quota-failure');
        // A separate authorized acquisition after freeing storage succeeds; the failed
        // operation itself never fetches replacement bytes behind the caller's back.
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: APP });
        await acquireIn(s.page, backend, [ASSETS.plain]);
        assert.deepEqual(await readIn(s.page, backend, ASSETS.plain), {
          ok: true,
          sha256: ASSETS.plain.sha256,
          size: ASSETS.plain.size,
        });
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
