// A non-face model in real browsers (fm-qjcs): AFHQ cat 512 through the package's CPU generator with its descriptor,
// from the built packages (npm run build -w packages/stylegan-js -w packages/browser-model-manager), with every
// request intercepted. Steps: 'acquire' (the manager downloads the AFHQ assets and the pinned CPU runtime under one
// grant, the only step allowed the network), 'engine' (load, map seed 0, synthesize; zero requests of any class),
// 'compare' (the upstream reference arrays are fetched and compared in the page at the model's own tolerance).
// Across every step, no request may name a face detector, the FFHQ e4e encoder, its streamed shards or any
// photo-pipeline asset. Absent the converted model, its reference, the runtime or the build, it reports untested.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import { assertNoRequests, bindOrigins, step } from '../../../../scripts/ci/intercept/record.ts';
import { AFHQ_CAT_512_DESCRIPTOR } from '../../src/contracts/descriptor.ts';
import { acquiredManifest, RUNTIME, UNTESTED } from './support/runtime.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
const PROVENANCE = JSON.parse(
  readFileSync(new URL('../vectors/afhq-cat-512/reference.json', import.meta.url), 'utf8'),
) as {
  tolerance: { rawFloat: number; rgb: number };
  truncation: { psi: number; cutoff: number };
  cases: {
    seed: number;
    w: { file: string; sha256: string };
    raw: { file: string; sha256: string };
  }[];
  converted: { manifestSha256: string };
};
const ROOTS: Record<string, string> = {
  '/stylegan/': join(REPO, 'packages/stylegan-js/dist/'),
  '/manager/': join(REPO, 'packages/browser-model-manager/dist/'),
  '/runtime/': RUNTIME + '/',
  '/afhq/': MODEL + '/',
};
const BUILT =
  existsSync(join(ROOTS['/stylegan/']!, 'engine/model.js')) &&
  existsSync(join(ROOTS['/manager/']!, 'index.js'));
const runtime = acquiredManifest();
const HAVE_MODEL =
  existsSync(join(MODEL, 'manifest.json')) && existsSync(join(MODEL, 'reference/reference.json'));

const PAGE = `<!doctype html><meta charset="utf-8"><title>non-face</title><script type="module">
import * as engine from '/stylegan/engine/index.js';
import * as manager from '/manager/index.js';
const digest = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('');
window.harness = {
  async acquire(list) {
    const cache = await manager.createBrowserModelCache();
    const grant = { manifestSha256: '', route: 'cpu', purpose: 'generate', owners: ['face:harness'],
      assets: list.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
      remainingBytes: 5 * list.reduce((n, a) => n + a.size, 0) };
    for (const a of list) await cache.acquire(a, { grant, owner: 'face:harness' });
    return list.length;
  },
  async run(model, manifestSha256, cpuRuntime, descriptor, truncation) {
    const cache = await manager.createBrowserModelCache();
    const reader = cache.local;
    const reads = [];
    const logged = { allowRepair: false, read: (a) => (reads.push(a.sha256), reader.read(a)) };
    let cpu = null;
    const ort = async () => (cpu ??= await engine.loadOrtRuntime(logged, engine.cpuRuntimeAssets(cpuRuntime), engine.browserModuleHost(), 1)).ort;
    const g = await engine.loadCpuGenerator({ reader: logged, manifest: model, manifestSha256, ort, descriptor });
    const ids = (n) => ({ requestId: 'nf' + n, inputRevision: n, attemptId: 0 });
    const mapped = await g.map({ ids: ids(1), z: engine.inputLatent('seed', '0', g.latent).z, truncation });
    const face = await g.synthesize({ ids: ids(2), wPlus: mapped.wPlus, output: 'rgba-and-raw-float' });
    window.__face = { w: mapped.wPlus.values, raw: face.rawFloat, rgba: face.rgba };
    const inspect = g.inspect();
    await g.dispose();
    return { latent: g.latent, image: g.image, shape: mapped.wPlus.shape, width: face.width, height: face.height, faceSha256: await digest(face.rgba), reads, live: inspect.liveSessions, after: g.inspect().liveSessions };
  },
  async compare(w, raw) {
    const get = async (f) => new Float32Array(await (await fetch('/afhq/reference/' + f)).arrayBuffer());
    const max = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    const rw = await get(w), rr = await get(raw);
    const expected = engine.toRgba8(rr, 512, 512);
    let rgb = 0; for (let i = 0; i < expected.length; i++) rgb = Math.max(rgb, Math.abs(window.__face.rgba[i] - expected[i]));
    return { w: max(window.__face.w, rw), raw: max(window.__face.raw, rr), rgb };
  },
};
window.ready = true;
</script>`;

const work = mkdtempSync(join(tmpdir(), 'nonface-browsers-'));
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
  server = createServer(
    { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
    (req, res) => {
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
    },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  origin = `https://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(() => server?.close());

type Asset = { sha256: string; size: number; file?: string; url?: string; chunks?: Asset[] };
/** The converted manifest with its files on the harness origin; content and digests unchanged. */
function afhqManifest() {
  const m = JSON.parse(readFileSync(join(MODEL, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  > & {
    mapping: Asset;
    synthesis: Asset;
    average: Asset;
    noise: Asset[];
  };
  const locate = (a: Asset): Asset => ({
    ...a,
    url: `${origin}/afhq/${a.file}`,
    ...(a.chunks ? { chunks: a.chunks.map(locate) } : {}),
  });
  return {
    ...m,
    mapping: locate(m.mapping),
    synthesis: locate(m.synthesis),
    average: locate(m.average),
    noise: m.noise.map(locate),
  };
}
const ffhq = () =>
  JSON.parse(
    readFileSync(join(RUNTIME, 'manifest.json'), 'utf8').replaceAll(
      'https://next.facemorph.me/runtime/',
      `${origin}/runtime/`,
    ),
  ) as Record<string, unknown> & { runtime: { assets: Asset[]; moduleUrl: string } };

/** Every digest of the photo pipeline: the detector (landmarks), the e4e encoder and its chunks, the stream. */
function photoDigests(m: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const r = v as Record<string, unknown>;
    if (typeof r['sha256'] === 'string') out.add(r['sha256'] as string);
    for (const x of Array.isArray(v) ? v : Object.values(r)) walk(x);
  };
  for (const k of [
    'encoder',
    'encoderStream',
    'landmarks',
    'photo',
    'photoCanary',
    'photoCanaries',
  ])
    walk(m[k]);
  const stream = join(RUNTIME, 'encoder-stream');
  // The streamed encoder's own schedule: its 108 shards, runtime and canaries.
  if (existsSync(stream))
    for (const dir of readdirSync(stream)) {
      out.add(dir);
      const m = join(stream, dir, 'manifest.json');
      if (existsSync(m)) walk(JSON.parse(readFileSync(m, 'utf8')));
    }
  return out;
}

const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium' | 'firefox' | 'webkit',
  {
    launch(o: object): Promise<{
      newContext(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
      close(): Promise<void>;
    }>;
  }
>;
type Page = {
  evaluate<T>(fn: (a: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
};
const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]: [string, unknown[]]) =>
      (window as unknown as { harness: Record<string, (...x: unknown[]) => T> }).harness[n]!(...a),
    [name, args] as never,
  ) as Promise<T>;

const SKIP = !runtime
  ? UNTESTED
  : !HAVE_MODEL
    ? `untested: the converted AFHQ cat model and its reference are not at ${MODEL}`
    : !BUILT
      ? 'untested: build the packages first (npm run build -w packages/stylegan-js -w packages/browser-model-manager)'
      : false;

for (const kind of ['chromium', 'firefox', 'webkit'] as const)
  test(
    `non-face AFHQ cat 512 in Playwright ${kind}: descriptor-driven face, zero engine requests, no detector or e4e request at all`,
    { timeout: 900_000, skip: SKIP },
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
      const model = afhqManifest();
      const product = ffhq();
      const cpuRuntime = product.runtime;
      const list = [
        ...new Map(
          [...cpuRuntime.assets, model.mapping, model.synthesis, model.average, ...model.noise].map(
            (a) => [a.sha256, a],
          ),
        ).values(),
      ];
      step(net.rec, 'acquire');
      t.diagnostic(`${kind}: acquired ${await call<number>(page, 'acquire', list)} assets`);
      step(net.rec, 'engine');
      const out = await call<{
        latent: { layers: number; width: number };
        image: { width: number; height: number };
        shape: number[];
        width: number;
        height: number;
        faceSha256: string;
        reads: string[];
        live: number;
        after: number;
      }>(
        page,
        'run',
        model,
        PROVENANCE.converted.manifestSha256,
        cpuRuntime,
        AFHQ_CAT_512_DESCRIPTOR,
        PROVENANCE.truncation,
      );
      await net.settled();
      for (const cls of ['app', 'model-host', 'third-party', 'collector', 'names-host'] as const)
        assert.equal(
          assertNoRequests(net.rec, cls, { fromStep: 'engine' }, () => {}).verdict,
          'pass',
          `${kind}: no ${cls} request from the engine`,
        );
      assert.deepEqual([out.latent.layers, out.latent.width, out.shape], [16, 512, [16, 512]]);
      assert.deepEqual([out.image, out.width, out.height], [{ width: 512, height: 512 }, 512, 512]);
      assert.deepEqual([out.after], [0], 'dispose releases every session');
      step(net.rec, 'compare');
      const c = PROVENANCE.cases.find((x) => x.seed === 0)!;
      const err = await call<{ w: number; raw: number; rgb: number }>(
        page,
        'compare',
        c.w.file,
        c.raw.file,
      );
      t.diagnostic(
        `${kind}: seed 0 W+ ${err.w.toExponential(2)}, raw ${err.raw.toExponential(2)}, RGB ${err.rgb}, face ${out.faceSha256.slice(0, 12)}`,
      );
      assert.ok(
        err.w <= PROVENANCE.tolerance.rawFloat &&
          err.raw <= PROVENANCE.tolerance.rawFloat &&
          err.rgb <= PROVENANCE.tolerance.rgb,
        JSON.stringify(err),
      );
      await net.settled();
      // No request in any step names the photo pipeline.
      // The encoder stream reuses the CPU runtime's ORT API module byte for byte; what the generator legitimately
      // reads (its own model and the CPU runtime) is not a photo-pipeline asset.
      const forbidden = photoDigests(product);
      for (const a of list) forbidden.delete(a.sha256);
      assert.ok(forbidden.size > 108, `photo digests known (${forbidden.size})`);
      const urls = net.rec.requests.map((r) => r.url);
      const named = urls.filter(
        (u) =>
          /encoder|landmark|detector|\/photo\//i.test(u) ||
          [...forbidden].some((s) => u.includes(s)),
      );
      assert.deepEqual(named, [], `${kind}: no detector or e4e asset request`);
      assert.ok(!out.reads.some((s) => forbidden.has(s)), 'no photo-pipeline asset read');
      t.diagnostic(`${kind}: ${urls.length} requests recorded, none for a detector or e4e asset`);
      await context.close();
    },
  );
