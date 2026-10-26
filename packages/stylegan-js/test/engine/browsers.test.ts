// The engine in real browsers with the real model (fm-3h3w): each retained route through its adapter on the manager's
// verified local reads, from the built packages (npm run build -w packages/stylegan-js -w packages/browser-model-manager).
//
// Per cell: the manager acquires the route's assets into OPFS / Cache Storage first (the setup step, the only one
// allowed the network); then, in the 'engine' step, the engine imports the pinned ORT runtime from those verified
// bytes, loads the route's generator, runs all seven product canaries (CI's fullQualify) against the references at
// the frozen gates, maps and synthesizes a face with timing hooks, runs a bounded pipelined sequence and disposes,
// and the interception helper must count zero requests of every host class in that step. On the GPU cells a real
// GPU-process crash (CDP Browser.crashGpuProcess) then loses the device under a running face, which must settle
// typed and release.
//
// Cells: Playwright Chromium, Firefox and WebKit on the CPU route; system Chromium with WebGPU (CHROMIUM_PATH, default
// /usr/bin/chromium; headed, Vulkan) on the ORT WebGPU engine and the direct engine. A cell whose browser does not
// start, has no hardware adapter or lacks the runtime is reported untested. Run correctness cells with a bounded command:
//   python3 autoresearch/run.py -- npm test -w packages/stylegan-js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import { assertNoRequests, bindOrigins, step } from '../../../../scripts/ci/intercept/record.ts';
import { acquiredManifest, RUNTIME, UNTESTED } from './support/runtime.ts';
import { homedir } from 'node:os';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS: Record<string, string> = {
  '/stylegan/': join(REPO, 'packages/stylegan-js/dist/'),
  '/manager/': join(REPO, 'packages/browser-model-manager/dist/'),
  '/runtime/': RUNTIME + '/',
};
const BUILT =
  existsSync(join(ROOTS['/stylegan/']!, 'engine/index.js')) &&
  existsSync(join(ROOTS['/manager/']!, 'index.js'));
const runtime = acquiredManifest();
// The classic full31 research suite, regenerated from the checkpoint and the pinned runtime by
// test/research/full31/regenerate.py (FACEMORPH_FULL31 to override). Absent here, it is reported untested.
const FULL31 = process.env['FACEMORPH_FULL31'] ?? join(homedir(), '.cache/facemorph-full31');
ROOTS['/full31/'] = FULL31 + '/';

const PAGE = `<!doctype html><meta charset="utf-8"><title>engine</title><script type="module">
import * as engine from '/stylegan/engine/index.js';
import * as manager from '/manager/index.js';
const assetsOf = (v, out = []) => { if (!v || typeof v !== 'object') return out; if (typeof v.sha256 === 'string' && typeof v.url === 'string') { out.push(v); return out; } for (const x of Array.isArray(v) ? v : Object.values(v)) assetsOf(x, out); return out; };
window.harness = {
  async acquire(manifest, scope) {
    const cache = await manager.createBrowserModelCache();
    const parts = [manifest.runtime, manifest.mapping, manifest.average, manifest.noise, manifest.sampleIndices, manifest.canaries,
      scope === 'cpu' ? manifest.synthesis : scope === 'ort' ? manifest.webgpu : manifest.webgl];
    const list = [...new Map(assetsOf(parts).filter((a) => a.url !== manifest.webgpu?.kernel?.url).map((a) => [a.sha256, a])).values()];
    // The setup step's download, under one grant for exactly these assets (fm-fr9s: no grant, no transfer).
    const grant = { manifestSha256: '', route: scope === 'cpu' ? 'cpu' : 'webgpu', purpose: 'generate', owners: ['face:harness'],
      assets: list.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
      remainingBytes: 5 * list.reduce((n, a) => n + a.size, 0) };
    for (const a of list) await cache.acquire(a, { grant, owner: 'face:harness' });
    return list.length;
  },
  async run(manifest, manifestSha256, scope) {
    const cache = await manager.createBrowserModelCache();
    const reader = cache.local;
    const host = engine.browserModuleHost();
    const threads = engine.cpuThreads({ sharedArrayBuffer: typeof SharedArrayBuffer === 'function', crossOriginIsolated: globalThis.crossOriginIsolated === true, hardwareConcurrency: navigator.hardwareConcurrency });
    let cpu = null;
    const cpuOrt = async () => (cpu ??= await engine.loadOrtRuntime(reader, engine.cpuRuntimeAssets(manifest.runtime), host, threads)).ort;
    const started = performance.now();
    const g = scope === 'cpu' ? await engine.loadCpuGenerator({ reader, manifest, manifestSha256, ort: cpuOrt })
      : scope === 'ort' ? await engine.loadOrtWebGpuGenerator({ reader, manifest, manifestSha256, gpu: navigator.gpu, host, cpuOrt })
      : await engine.loadDirectWebGpuGenerator({ reader, manifest, manifestSha256, gpu: navigator.gpu, cpuOrt });
    const loadMs = performance.now() - started;
    await g.mappingReady();
    const q = engine.createCanaryQualification({ manifest, manifestSha256, route: g.route, bundle: engine.canaryBundle(manifest, g.route, scope === 'direct' ? 'direct' : 'ort'), records: cache.records, reader, synthesizeRaw: (v, n) => g.synthesizeRaw(v, n), full: true });
    const e = engine.createEngine({ generator: g, qualification: q });
    const receipt = await e.admit();
    const timings = [];
    const ids = (n) => ({ requestId: 'r' + n, inputRevision: n, attemptId: 0 });
    const mapped = await e.map({ ids: ids(1), z: engine.inputLatent('seed', '7').z, truncation: { psi: 0.7, cutoff: 8 } }, { onTiming: (t) => timings.push(t) });
    const faces = [];
    for (let i = 2; i < 5; i++) faces.push(await e.synthesize({ ids: ids(i), wPlus: mapped.result.wPlus, output: 'rgba' }, { onTiming: (t) => timings.push(t) }));
    const face = faces.at(-1).result;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', face.rgba)), (x) => x.toString(16).padStart(2, '0')).join('');
    // A pipelined sequence of four faces: each landing time, then the per-face interval.
    const landed = [];
    const t0 = performance.now();
    await g.synthesizeSequence([0, 1, 2, 3].map(() => mapped.result.wPlus.values), () => { landed.push(performance.now() - t0); });
    const inspectLive = g.inspect();
    window.__live = { g, e, mapped };
    return { engine: g.engine, route: g.route, provider: g.provider, loadMs, loadTrace: g.loadTrace, receipt, timings, statuses: faces.map((f) => f.status), digest, landed, inspectLive, threads };
  },
  /** A face left running on the live generator, settled after the GPU process is crashed under it. */
  startFace() {
    const { e, mapped } = window.__live;
    // Enough faces queued that the crash lands while one is running; the last must not produce a face.
    const queued = Array.from({ length: 40 }, (_, i) => e.synthesize({ ids: { requestId: 'loss' + i, inputRevision: 99, attemptId: 0 }, wPlus: mapped.result.wPlus, output: 'rgba' }, { slot: 'loss' + i }));
    window.__pending = queued.at(-1);
    window.__lost = new Promise((r) => window.__live.g.onLost((kind, message) => r({ kind, message })));
  },
  async settleLoss() {
    const settled = await window.__pending;
    const lost = await Promise.race([window.__lost, new Promise((r) => setTimeout(() => r(null), 5000))]);
    const after = await window.__live.e.synthesize({ ids: { requestId: 'after', inputRevision: 100, attemptId: 0 }, wPlus: window.__live.mapped.result.wPlus, output: 'rgba' });
    await window.__live.e.dispose();
    return { settled: { status: settled.status, error: settled.error }, lost, after: { status: after.status, error: after.error }, inspect: window.__live.g.inspect() };
  },
  /** The full31 research suite on the live generator: fixture bytes come from /full31/, after the engine step. */
  async research(cases) {
    const get = async (f) => new Uint8Array(await (await fetch('/full31/' + f)).arrayBuffer());
    const indices = new Uint32Array((await get('sample-indices.i32')).buffer);
    const checks = [];
    for (const c of cases) {
      const raw = await window.__live.g.synthesizeRaw(new Float32Array((await get(c.w)).buffer), c.noise);
      const reference = (await engine.decodeReferencePng(await get(c.reference))).rgba;
      checks.push(engine.compareCanary(c.name, raw, indices, new Float32Array((await get(c.samples)).buffer), reference));
    }
    return checks;
  },
  async dispose() { await window.__live.e.dispose(); return window.__live.g.inspect(); },
  async adapter() {
    const a = await navigator.gpu?.requestAdapter();
    return a ? { fallback: a.info?.isFallbackAdapter === true, vendor: a.info?.vendor ?? '', architecture: a.info?.architecture ?? '', description: a.info?.description ?? '' } : null;
  },
};
window.ready = true;
</script>`;

// HTTPS, as the manager's acquisition requires: a throwaway self-signed certificate (the contexts ignore its errors).
const work = mkdtempSync(join(tmpdir(), 'engine-browsers-'));
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
const tls = {
  key: readFileSync(join(work, 'key.pem')),
  cert: readFileSync(join(work, 'cert.pem')),
};

let server: Server, origin: string;
before(async () => {
  server = createServer(tls, (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    // Cross-origin isolated, as the product is, so the CPU route may use its bounded threads.
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
    const type =
      extname(file) === '.js' || extname(file) === '.mjs'
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
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = {
  newContext(o?: object): Promise<Context>;
  close(): Promise<void>;
  newBrowserCDPSession?(): Promise<{ send(m: string): Promise<unknown> }>;
};
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium' | 'firefox' | 'webkit',
  { launch(o: object): Promise<Browser> }
>;

/** The manifest with its asset URLs on the harness origin; content and digests unchanged. */
const localManifest = () =>
  JSON.parse(
    readFileSync(join(RUNTIME, 'manifest.json'), 'utf8').replaceAll(
      'https://next.facemorph.me/runtime/',
      `${origin}/runtime/`,
    ),
  );

const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]: [string, unknown[]]) =>
      (window as unknown as { harness: Record<string, (...x: unknown[]) => T> }).harness[n]!(...a),
    [name, args] as never,
  ) as Promise<T>;

interface RunOut {
  engine: string;
  route: string;
  provider: { actual: string };
  loadMs: number;
  loadTrace: string[];
  receipt: {
    ran: number;
    checks: { name: string; maxRgb: number; maxFloat: number; passed: boolean }[];
  };
  timings: {
    stage: string;
    boundary: string;
    startedAtMs: number;
    completedAtMs: number;
    route: string;
  }[];
  statuses: string[];
  digest: string;
  landed: number[];
  inspectLive: { liveSessions: number };
  threads: number;
}

async function cell(
  t: { diagnostic(m: string): void; skip(m: string): void },
  browser: Browser,
  scope: 'cpu' | 'ort' | 'direct',
  label: string,
): Promise<{
  page: Page;
  out: RunOut;
  net: ReturnType<typeof attachPlaywright>;
  context: Context;
} | null> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const net = attachPlaywright(context as never, bindOrigins(DEFAULT_HOST_MAP, { app: [origin] }));
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  const manifest = localManifest();
  step(net.rec, 'acquire');
  const acquired = await call<number>(page, 'acquire', manifest, scope);
  t.diagnostic(`${label}: acquired ${acquired} assets into local storage`);
  step(net.rec, 'engine');
  const out = await call<RunOut>(page, 'run', manifest, runtime!.sha256, scope);
  await net.settled();
  const quiet = () => {};
  for (const cls of ['app', 'model-host', 'third-party', 'collector', 'names-host'] as const)
    assert.equal(
      assertNoRequests(net.rec, cls, { fromStep: 'engine' }, quiet).verdict,
      'pass',
      `${label}: no ${cls} request from the engine`,
    );
  return { page, out, net, context };
}

function checkRun(
  t: { diagnostic(m: string): void },
  label: string,
  out: RunOut,
  expect: { engine: string; route: string; boundary: string; warm: boolean },
) {
  assert.deepEqual(
    [out.engine, out.route, out.provider.actual],
    [expect.engine, expect.route, expect.route],
    label,
  );
  assert.equal(out.receipt.ran, 7, `${label}: all seven canaries (full)`);
  for (const c of out.receipt.checks) {
    t.diagnostic(`${label} ${c.name}: maxRgb ${c.maxRgb}, maxFloat ${c.maxFloat}`);
    assert.ok(c.passed && c.maxRgb <= 1 && c.maxFloat <= 0.002, `${label} ${c.name}`);
  }
  assert.deepEqual(out.statuses, ['completed', 'completed', 'completed']);
  const synth = out.timings.filter((e) => e.stage === 'synthesis');
  assert.equal(synth.length, 3);
  for (const e of synth) assert.equal(e.boundary, expect.boundary, label);
  assert.equal(out.timings.find((e) => e.stage === 'mapping')?.boundary, 'readback-complete');
  const warmIdx = out.loadTrace.indexOf('mapping-load-start'),
    gpuDone = out.loadTrace.indexOf('synthesis-load-done');
  if (expect.warm)
    assert.ok(
      warmIdx >= 0 && warmIdx < gpuDone,
      `${label}: mapping warmed beside the GPU load (${out.loadTrace.join()})`,
    );
  else
    assert.ok(warmIdx > gpuDone, `${label}: CPU loading is sequential (${out.loadTrace.join()})`);
  t.diagnostic(
    `${label}: load ${Math.round(out.loadMs)} ms, faces ${synth.map((e) => Math.round(e.completedAtMs - e.startedAtMs)).join('/')} ms, sequence landed at ${out.landed.map(Math.round).join('/')} ms, threads ${out.threads}, face ${out.digest.slice(0, 12)}`,
  );
}

/** All 31 research cases through the cell's live generator at the frozen research gate (RGB 1, sampled float 0.002). */
async function research(t: { diagnostic(m: string): void }, page: Page, label: string) {
  const path = join(FULL31, 'manifest.json');
  if (!existsSync(path))
    return t.diagnostic(`${label}: full31 research suite untested (no fixtures at ${FULL31})`);
  const suite = JSON.parse(readFileSync(path, 'utf8')) as {
    cases: { name: string; noise: string; w: string; reference: string; samples: string }[];
    inputs: { runtimeManifestSha256: string };
  };
  assert.equal(
    suite.inputs.runtimeManifestSha256,
    runtime!.sha256,
    'full31 regenerated from this runtime',
  );
  assert.equal(suite.cases.length, 31);
  const checks = await call<{ name: string; maxRgb: number; maxFloat: number }[]>(
    page,
    'research',
    suite.cases,
  );
  assert.equal(checks.length, 31);
  for (const c of checks)
    assert.ok(c.maxRgb <= 1 && c.maxFloat <= 0.002, `${label} full31 ${JSON.stringify(c)}`);
  t.diagnostic(
    `${label}: full31 31/31, max RGB ${Math.max(...checks.map((c) => c.maxRgb))}, max sampled float ${Math.max(...checks.map((c) => c.maxFloat)).toExponential(2)}`,
  );
}

const SKIP = !runtime
  ? UNTESTED
  : !BUILT
    ? 'untested: build the packages first (npm run build -w packages/stylegan-js -w packages/browser-model-manager)'
    : false;
const faceDigests = new Map<string, string>();

for (const kind of ['chromium', 'firefox', 'webkit'] as const)
  test(
    `CPU route in Playwright ${kind}: canaries, a face, timing hooks, zero engine requests, released on dispose`,
    { timeout: 1_800_000, skip: SKIP },
    async (t) => {
      const browser = await pw[kind].launch({}).catch(() => null);
      if (!browser) return t.skip(`untested: Playwright ${kind} does not start here`);
      t.after(() => browser.close());
      const run = await cell(t, browser, 'cpu', kind);
      if (!run) return;
      checkRun(t, kind, run.out, {
        engine: 'ort-wasm',
        route: 'cpu',
        boundary: 'readback-complete',
        warm: false,
      });
      faceDigests.set(kind, run.out.digest);
      step(run.net.rec, 'research');
      await research(t, run.page, kind);
      assert.equal(
        (await call<{ liveSessions: number }>(run.page, 'dispose')).liveSessions,
        0,
        'dispose releases every session',
      );
    },
  );

const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium';
const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
];

for (const scope of ['ort', 'direct'] as const)
  test(
    `WebGPU ${scope === 'ort' ? 'ORT engine' : 'direct engine'} in system Chromium: canaries, mapAsync timings, overlap, zero requests, device loss settles typed`,
    { timeout: 1_800_000, skip: SKIP },
    async (t) => {
      const browser = existsSync(CHROMIUM)
        ? await pw.chromium
            .launch({ executablePath: CHROMIUM, headless: false, args: GPU_ARGS })
            .catch(() => null)
        : null;
      if (!browser) return t.skip(`untested: system Chromium does not start here (${CHROMIUM})`);
      t.after(() => browser.close());
      const probe = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
      await probe.goto(`${origin}/`);
      await probe.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
      const adapter = await call<{ fallback: boolean; vendor: string; description: string } | null>(
        probe,
        'adapter',
      );
      if (
        !adapter ||
        adapter.fallback ||
        /swiftshader|llvmpipe/i.test(`${adapter.vendor} ${adapter.description}`)
      )
        return t.skip(`untested: no hardware WebGPU adapter here (${JSON.stringify(adapter)})`);
      t.diagnostic(`adapter ${adapter.vendor} ${adapter.description}`);
      const run = await cell(t, browser, scope, `webgpu-${scope}`);
      if (!run) return;
      checkRun(t, `webgpu-${scope}`, run.out, {
        engine: scope === 'ort' ? 'ort-webgpu' : 'direct-webgpu',
        route: 'webgpu',
        boundary: 'map-async-complete',
        warm: true,
      });
      step(run.net.rec, 'research');
      await research(t, run.page, `webgpu-${scope}`);
      // Real device loss under a running face: the GPU process is crashed.
      await call(run.page, 'startFace');
      const cdp = await browser.newBrowserCDPSession!();
      await cdp.send('Browser.crashGpuProcess');
      const loss = await call<{
        settled: { status: string; error?: { code: string; cause?: string } };
        lost: { kind: string } | null;
        after: { status: string; error?: { code: string } };
        inspect: { liveSessions: number; pending: number; disposed: boolean };
      }>(run.page, 'settleLoss');
      t.diagnostic(`device loss: ${JSON.stringify(loss)}`);
      assert.deepEqual(loss.lost?.kind, 'device-loss', 'the loss reached the onLost listeners');
      assert.equal(loss.settled.status, 'failed', 'the running face did not produce a face');
      assert.deepEqual(
        [loss.settled.error?.code, loss.settled.error?.cause],
        ['route-failed', 'device-loss'],
      );
      assert.deepEqual(
        [loss.after.status, loss.after.error?.code],
        ['failed', 'route-failed'],
        'later work fails typed; no repair',
      );
      assert.deepEqual(
        [loss.inspect.liveSessions, loss.inspect.pending, loss.inspect.disposed],
        [0, 0, true],
        'everything released',
      );
    },
  );
