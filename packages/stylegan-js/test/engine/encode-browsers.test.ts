// The streamed e4e encoder in a real browser (fm-qjcs), from the built packages (npm run build -w
// packages/stylegan-js -w packages/browser-model-manager): the manager acquires the encoder descriptor, its
// pinned 1.24.3 unshared runtime, the 108 shards and one qualification case into local storage (the setup
// step, the only one allowed the network); then, in the 'encode' step, the encoder imports that runtime from
// verified bytes with the heap observer, encodes the case and is compared with the native reference at 0.0001,
// and a second encode is cancelled between sessions. The interception helper must count zero requests of every
// host class in the 'encode' step. Engines: FACEMORPH_ENCODE_ENGINES (comma list; default chromium).
//   python3 autoresearch/run.py -- node --test packages/stylegan-js/test/engine/encode-browsers.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import { assertNoRequests, bindOrigins, step } from '../../../../scripts/ci/intercept/record.ts';
import { acquiredManifest, RUNTIME, UNTESTED } from './support/runtime.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS: Record<string, string> = {
  '/stylegan/': join(REPO, 'packages/stylegan-js/dist/'),
  '/manager/': join(REPO, 'packages/browser-model-manager/dist/'),
  '/runtime/': RUNTIME + '/',
};
const BUILT =
  existsSync(join(ROOTS['/stylegan/']!, 'engine/encode.js')) &&
  existsSync(join(ROOTS['/manager/']!, 'index.js'));
const runtime = acquiredManifest();

const PAGE = `<!doctype html><meta charset="utf-8"><title>encode</title><script type="module">
import * as encode from '/stylegan/engine/encode.js';
import { browserModuleHost } from '/stylegan/engine/adapters/ort.js';
import * as manager from '/manager/index.js';
const text = (bytes) => new TextDecoder().decode(bytes);
const read = async (reader, asset) => { const r = await reader.read(asset); if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value; };
window.harness = {
  async acquire(manifest, manifestSha256, origin) {
    const cache = await manager.createBrowserModelCache();
    const local = (a) => ({ ...a, url: a.url.replace('https://next.facemorph.me', origin) });
    const descriptor = local(manifest.encoderStream);
    const grantOf = (assets) => ({ manifestSha256, route: 'cpu', purpose: 'prepare-encoder', owners: ['face:harness'],
      assets: assets.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
      remainingBytes: assets.reduce((n, a) => n + a.size, 0) });
    await cache.acquire(descriptor, { grant: grantOf([descriptor]), owner: 'face:harness' });
    const config = JSON.parse(text(await read(cache.local, descriptor)));
    const c = config.canaries[0];
    const units = [config.runtime.module, config.runtime.factory, config.runtime.wasm, ...config.steps, c.input, c.reference].map(local);
    const grant = grantOf(units);
    for (const u of units) await cache.acquire(u, { grant, owner: 'face:harness' });
    return { units: units.length, bytes: units.reduce((n, u) => n + u.size, 0) };
  },
  async run(manifest) {
    const cache = await manager.createBrowserModelCache();
    const reader = cache.local;
    const config = encode.admitEncoderManifest(JSON.parse(text(await read(reader, manifest.encoderStream))));
    const c = config.canaries[0];
    const rt = await encode.loadEncoderRuntime(reader, config.runtime, browserModuleHost());
    const encoder = encode.loadStreamedEncoder({ manifest: config, reader, ort: rt.ort, snapshotMemory: rt.snapshotMemory });
    const input = new Float32Array((await read(reader, c.input)).slice().buffer);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input.buffer)), (x) => x.toString(16).padStart(2, '0')).join('');
    const request = (n) => ({ ids: { requestId: 'e' + n, inputRevision: n, attemptId: 0 }, input: { tensor: input, tensorDigest: digest, policyVersion: 'crop-preprocessing-v1' }, confirmedCropId: 'c'.repeat(64) });
    const stages = [];
    const out = await encoder.encode(request(1), undefined, (e) => stages.push(e.stage));
    const error = encode.maxWPlusError(out.wPlus.values, await read(reader, c.reference));
    const heap = rt.snapshotMemory();
    const afterFirst = encoder.inspect();
    // A second encode cancelled after its third session ran.
    const controller = new AbortController();
    let runs = 0, at = 0;
    const cancelled = await encoder.encode(request(2), controller.signal, (e) => { if (e.stage === 'encoder-run' && ++runs === 3) { at = performance.now(); controller.abort(); } })
      .then(() => null, (e) => ({ name: e.name, kind: e.kind }));
    const settleMs = performance.now() - at;
    const afterCancel = encoder.inspect();
    await encoder.dispose();
    rt.release();
    return { id: c.id, threshold: c.threshold, error, timings: out.timings, stages: { create: stages.filter((s) => s === 'encoder-session-create').length, run: stages.filter((s) => s === 'encoder-run').length },
      heap, afterFirst, cancelled, runs, settleMs, afterCancel, disposed: encoder.inspect() };
  },
};
window.ready = true;
</script>`;

const work = mkdtempSync(join(tmpdir(), 'encode-browsers-'));
after(() => rmSync(work, { recursive: true, force: true }));
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

let server: Server, origin: string;
before(async () => {
  const tls = {
    key: readFileSync(join(work, 'key.pem')),
    cert: readFileSync(join(work, 'cert.pem')),
  };
  server = createServer(tls, (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const headers = {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    };
    if (path === '/')
      return res.writeHead(200, { ...headers, 'content-type': 'text/html' }).end(PAGE);
    const prefix = Object.keys(ROOTS).find((p) => path.startsWith(p));
    const root = prefix ? (ROOTS[prefix] as string) : '';
    const file = prefix ? normalize(join(root, path.slice(prefix.length))) : '';
    if (!prefix || !file.startsWith(root) || !existsSync(file))
      return res.writeHead(404, headers).end();
    const body = readFileSync(file);
    const type = ['.js', '.mjs'].includes(extname(file))
      ? 'text/javascript'
      : 'application/octet-stream';
    res
      .writeHead(200, { ...headers, 'content-type': type, 'content-length': String(body.length) })
      .end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  origin = `https://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(() => server?.close());

type Page = {
  evaluate<T>(fn: (a: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
};
type Browser = {
  newContext(o?: object): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
};
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium' | 'firefox' | 'webkit',
  { launch(o: object): Promise<Browser> }
>;
const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]: [string, unknown[]]) =>
      (window as unknown as { harness: Record<string, (...x: unknown[]) => T> }).harness[n]!(...a),
    [name, args] as never,
  );

const SKIP = !runtime
  ? UNTESTED
  : !BUILT
    ? 'untested: build the packages first (npm run build -w packages/stylegan-js -w packages/browser-model-manager)'
    : false;
const ENGINES = (process.env['FACEMORPH_ENCODE_ENGINES'] ?? 'chromium').split(',') as (
  | 'chromium'
  | 'firefox'
  | 'webkit'
)[];

for (const kind of ENGINES)
  test(
    `streamed e4e in Playwright ${kind}: W+ within 0.0001, one live session, bounded unshared heap, cancel releases, zero requests`,
    { timeout: 1_800_000, skip: SKIP },
    async (t) => {
      const browser = await pw[kind].launch({}).catch(() => null);
      if (!browser) return t.skip(`untested: Playwright ${kind} does not start here`);
      t.after(() => browser.close());
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const net = attachPlaywright(
        context as never,
        bindOrigins(DEFAULT_HOST_MAP, { app: [origin] }),
      );
      const page = await context.newPage();
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
      const manifest = runtime!.manifest;
      step(net.rec, 'acquire');
      const acquired = await call<{ units: number; bytes: number }>(
        page,
        'acquire',
        manifest,
        runtime!.sha256,
        origin,
      );
      t.diagnostic(`${kind}: acquired ${acquired.units} encoder units, ${acquired.bytes} bytes`);
      step(net.rec, 'encode');
      const out = await call<{
        id: string;
        threshold: number;
        error: number;
        timings: {
          verifiedReadMs: number;
          sessionCreateMs: number;
          runMs: number;
          totalMs: number;
          wasmHeapBytes: number;
          maxLiveSessions: number;
        };
        stages: { create: number; run: number };
        heap: { available: boolean; shared: boolean; currentBytes: number };
        afterFirst: {
          liveSessions: number;
          maxLiveSessions: number;
          sessionsCreated: number;
          sessionsReleased: number;
          heapMeasured: boolean;
        };
        cancelled: { name: string; kind: string } | null;
        runs: number;
        settleMs: number;
        afterCancel: {
          liveSessions: number;
          running: boolean;
          sessionsCreated: number;
          sessionsReleased: number;
        };
        disposed: { disposed: boolean; liveSessions: number };
      }>(page, 'run', { encoderStream: { ...(manifest['encoderStream'] as object) } });
      await net.settled();
      for (const cls of ['app', 'model-host', 'third-party', 'collector', 'names-host'] as const)
        assert.equal(
          assertNoRequests(net.rec, cls, { fromStep: 'encode' }, () => {}).verdict,
          'pass',
          `${kind}: no ${cls} request while encoding`,
        );
      t.diagnostic(
        `${kind} ${out.id}: max |W+ error| ${out.error.toExponential(2)}; read ${Math.round(out.timings.verifiedReadMs)} ms, create ${Math.round(out.timings.sessionCreateMs)} ms, run ${Math.round(out.timings.runMs)} ms, total ${Math.round(out.timings.totalMs)} ms; heap ${out.timings.wasmHeapBytes} B; cancel settled in ${Math.round(out.settleMs)} ms`,
      );
      assert.ok(out.error <= out.threshold && out.threshold === 0.0001, `${kind}: ${out.error}`);
      assert.deepEqual(out.stages, { create: 108, run: 108 });
      assert.equal(out.timings.maxLiveSessions, 1);
      assert.ok(out.afterFirst.heapMeasured && out.heap.available && !out.heap.shared);
      assert.ok(out.timings.wasmHeapBytes > 0 && out.timings.wasmHeapBytes <= 268_435_456);
      assert.deepEqual([out.afterFirst.liveSessions, out.afterFirst.maxLiveSessions], [0, 1]);
      assert.equal(out.afterFirst.sessionsCreated, out.afterFirst.sessionsReleased);
      assert.deepEqual(out.cancelled, { name: 'EncoderUnavailable', kind: 'cancelled' });
      assert.equal(out.runs, 3, 'no session ran after the cancel');
      assert.ok(out.settleMs < 5000, `cancel settled in ${out.settleMs} ms`);
      assert.deepEqual([out.afterCancel.liveSessions, out.afterCancel.running], [0, false]);
      assert.equal(out.afterCancel.sessionsCreated, out.afterCancel.sessionsReleased);
      assert.deepEqual([out.disposed.disposed, out.disposed.liveSessions], [true, 0]);
    },
  );
