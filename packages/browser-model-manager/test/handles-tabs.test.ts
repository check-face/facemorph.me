// Leases across real browser tabs (fm-ffn7): two Chromium tabs on one origin share OPFS, Web Locks and a
// BroadcastChannel, running the package's built handles module (dist/, `npm run build -w ...`). A leased asset
// survives the other tab's eviction until its lease is released; the person's explicit deletion in one tab removes it
// anyway and invalidates the other tab's lease with 'cross-tab-deletion'. The deletion steps make no request (the
// request-interception helper's record, fm-o8xn).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { attachPlaywright } from '../../../scripts/ci/intercept/playwright.ts';
import { assertNoRequests, bindOrigins, step } from '../../../scripts/ci/intercept/record.ts';
import { DEFAULT_HOST_MAP } from '../../../scripts/ci/intercept/playwright.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PAGE = `<!doctype html><meta charset="utf-8"><title>tab</title><script type="module">
  import * as m from '/handles/index.js';
  const dir = await navigator.storage.getDirectory();
  const store = { remove: (sha) => dir.removeEntry(sha).catch(() => {}) };
  const registry = m.createLeaseRegistry({ locks: navigator.locks });
  const invalidations = [];
  const holder = { invalidated: (cause, error) => invalidations.push({ cause, code: error.code }) };
  const channel = new BroadcastChannel(m.DELETION_CHANNEL);
  m.listenForDeletions(channel, registry);
  const leases = new Map();
  window.tab = {
    write: async (sha) => { const w = await (await dir.getFileHandle(sha, { create: true })).createWritable(); await w.write(sha); await w.close(); },
    has: async (sha) => dir.getFileHandle(sha).then(() => true, () => false),
    lease: (sha) => { leases.set(sha, registry.lease([{ sha256: sha, bytes: 64 }], holder)); },
    release: (sha) => { for (const l of leases.get(sha) ?? []) l.release(); leases.delete(sha); },
    evict: (shas) => m.evictUnleased(shas, [store], registry, navigator.locks),
    remove: (shas) => m.deleteAssets(shas, [store], channel),
    invalidations: () => invalidations,
    leased: () => registry.leased(),
  };
  window.ready = true;
</script>`;

type Page = {
  evaluate<T, A>(fn: (a: A) => T | Promise<T>, arg: A): Promise<T>;
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
};
type Browser = { newContext(): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> };
// Playwright from apps/web, as the package's other browser cases (cache-local.test.ts); where Chromium does not
// start (triton's scaffold lane), this case reports untested; the manager-cache lane runs it on eris.
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as {
  chromium: { launch(o: object): Promise<Browser> };
};
const browser = await chromium
  .launch({ executablePath: process.env['CHROMIUM_PATH'] })
  .catch(() => null);
const NO_BROWSER = browser ? false : 'untested: Chromium does not start here';
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
  'a lease in one tab survives eviction in another; deletion there invalidates it, with no request',
  { timeout: 120_000, skip: NO_BROWSER },
  async () => {
    assert.ok(
      existsSync(join(dist, 'handles/index.js')),
      'no dist/: run `npm run build -w packages/browser-model-manager` first',
    );
    const context = await browser!.newContext();
    const net = attachPlaywright(
      context as never,
      bindOrigins(DEFAULT_HOST_MAP, { app: [origin] }),
    );
    const quiet = () => {};
    const [a, b] = [await context.newPage(), await context.newPage()];
    for (const p of [a, b]) {
      await p.goto(`${origin}/tab.html`);
      await p.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
    }
    const [x, y, z] = [sha('a'), sha('b'), sha('c')];
    for (const s of [x, y, z]) await call(a, 'write', s);
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
        (window as unknown as { tab: { invalidations(): unknown[] } }).tab.invalidations().length >
        0,
    );
    assert.deepEqual(await call(b, 'invalidations'), [
      { cause: 'cross-tab-deletion', code: 'invalidated' },
    ]);
    assert.equal(await call(a, 'has', x), false);
    await net.settled();
    for (const cls of ['app', 'model-host', 'third-party'] as const)
      assert.equal(
        assertNoRequests(net.rec, cls, { fromStep: 'evict-in-a' }, quiet).verdict,
        'pass',
        `no ${cls} request while evicting or deleting`,
      );

    await call(b, 'release', x);
    assert.deepEqual(await call(b, 'leased'), [], 'tab B holds nothing after release');
  },
);
