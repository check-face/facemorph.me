// Leases across real browser tabs (fm-ffn7/fm-fy2.13): two selected-engine tabs on one origin share OPFS, Web Locks and a
// BroadcastChannel, running the package's built handles module (dist/, `npm run build -w ...`). A leased asset
// survives the other tab's eviction until its lease is released; the person's explicit deletion in one tab removes it
// anyway and invalidates the other tab's lease with 'cross-tab-deletion'. The deletion steps make no request (the
// request-interception helper's record, fm-o8xn).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { componentBrowser } from './support/browser.ts';
import { attachPlaywright } from '../../../scripts/ci/intercept/playwright.ts';
import { assertNoRequests, bindOrigins, step } from '../../../scripts/ci/intercept/record.ts';
import { DEFAULT_HOST_MAP } from '../../../scripts/ci/intercept/playwright.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PAGE = `<!doctype html><meta charset="utf-8"><title>tab</title><script type="module">
  import * as m from '/handles/index.js';
  import { openShardStore } from '/cache/shard-store.js';
  const dir = await navigator.storage.getDirectory();
  const store = await openShardStore();
  if (!store) throw Error('This cell requires the real model shard store');
  const registry = m.createLeaseRegistry({ locks: navigator.locks });
  const invalidations = [];
  const holder = { invalidated: (cause, error) => invalidations.push({ cause, code: error.code }) };
  const channel = new BroadcastChannel(m.DELETION_CHANNEL);
  m.listenForDeletions(channel, registry);
  const leases = new Map();
  window.tab = {
    write: (sha) => store.write(sha, new TextEncoder().encode(sha)),
    has: (sha) => store.has(sha, 64),
    writeAppRecords: async (sha) => {
      // App-owned input records deliberately share a digest with model bytes,
      // but live outside the package's dedicated model directory.
      for (const suffix of ['', '.recovery']) {
        const w = await (await dir.getFileHandle(sha + suffix, { create: true })).createWritable();
        await w.write(suffix ? 'retained recovery record' : 'retained completed export');
        await w.close();
      }
    },
    appRecords: async (sha) => Promise.all(['', '.recovery'].map(async (suffix) =>
      (await (await dir.getFileHandle(sha + suffix)).getFile()).text())),
    lease: (sha) => { leases.set(sha, registry.lease([{ sha256: sha, bytes: 64 }], holder)); },
    release: (sha) => { for (const l of leases.get(sha) ?? []) l.release(); leases.delete(sha); },
    evict: (shas) => m.evictUnleased(shas, [store], registry, navigator.locks),
    remove: (shas) => m.deleteAssets(shas, [store], channel),
    invalidations: () => invalidations,
    leased: () => registry.leased(),
  };
  window.ready = true;
</script>`;

// Reuse the engine selection of cache-local.test.ts. Unavailable engines report their startup error;
// the manager-cache lane requires its selected browser to start.
const { engine, browser, newContext, unavailable: NO_BROWSER } = await componentBrowser();
after(() => browser?.close());

let server: Server, origin: string;
before(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/tab.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    const file = normalize(join(dist, path));
    if (!file.startsWith(dist) || !existsSync(file) || extname(file) !== '.js')
      return res.writeHead(404).end();
    const body = readFileSync(file);
    res
      .writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(body.length) })
      .end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(() => server?.close());

const sha = (c: string) => c.repeat(64);
const call = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) =>
      (window as unknown as Record<string, Record<string, (...x: unknown[]) => T>>)['tab']![
        f as string
      ]!(...(a as unknown[])),
    [fn, args] as const,
  );

test(
  `${engine} eviction preserves leased models and app records; cross-tab deletion invalidates without requests`,
  { timeout: 120_000, skip: NO_BROWSER },
  async () => {
    assert.ok(
      existsSync(join(dist, 'handles/index.js')),
      'no dist/: run `npm run build -w packages/browser-model-manager` first',
    );
    const context = await newContext!();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const net = attachPlaywright(
      context as never,
      bindOrigins(DEFAULT_HOST_MAP, { app: [origin] }),
    );
    const quiet = () => {};
    const [a, b] = [await context.newPage(), await context.newPage()];
    const errors: string[] = [];
    for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message));
    try {
      for (const p of [a, b]) {
        await p.goto(`${origin}/tab.html`);
        await p.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
      }
      const [x, y, z] = [sha('a'), sha('b'), sha('c')];
      for (const s of [x, y, z]) {
        await call(a, 'write', s);
        await call(a, 'writeAppRecords', s);
      }
      await call(b, 'lease', x);
      await call(b, 'lease', z);

      step(net.rec, 'evict-in-a');
      assert.deepEqual(
        await call(a, 'evict', [x, y]),
        { removed: [y], kept: [x] },
        "tab A's eviction keeps what tab B holds",
      );
      assert.equal(await call(a, 'has', x), true);
      assert.equal(await call(a, 'has', y), false);

      await call(b, 'release', z);
      assert.deepEqual(
        await call(a, 'evict', [z]),
        { removed: [z], kept: [] },
        'released in B, evictable in A',
      );

      step(net.rec, 'delete-in-a');
      assert.deepEqual(await call(a, 'remove', [x]), [x]);
      await b.waitForFunction(
        () =>
          (window as unknown as { tab: { invalidations(): unknown[] } }).tab.invalidations()
            .length > 0,
      );
      assert.deepEqual(await call(b, 'invalidations'), [
        { cause: 'cross-tab-deletion', code: 'invalidated' },
      ]);
      assert.equal(await call(a, 'has', x), false);
      for (const digest of [x, y, z])
        assert.deepEqual(
          await call(a, 'appRecords', digest),
          ['retained completed export', 'retained recovery record'],
          'eviction and explicit model deletion leave app-owned records byte-for-byte intact',
        );
      await net.settled();
      for (const cls of ['app', 'model-host', 'third-party'] as const)
        assert.equal(
          assertNoRequests(net.rec, cls, { fromStep: 'evict-in-a' }, quiet).verdict,
          'pass',
          `no ${cls} request while evicting or deleting`,
        );

      await call(b, 'release', x);
      assert.deepEqual(await call(b, 'leased'), [], 'tab B holds nothing after release');
    } catch (error) {
      const dir = fileURLToPath(new URL('../../../test-results/manager-cache/', import.meta.url));
      const out = join(dir, engine);
      mkdirSync(out, { recursive: true });
      writeFileSync(
        join(out, 'cross-tab-network.json'),
        JSON.stringify({ network: net.rec, errors }),
      );
      await Promise.allSettled([
        a.screenshot({ path: join(out, 'cross-tab.png') }),
        context.tracing.stop({ path: join(out, 'cross-tab.zip') }),
      ]);
      throw error;
    } finally {
      await context.close();
    }
  },
);
