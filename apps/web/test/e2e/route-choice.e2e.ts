// Route choice against the real runtime and the real ort-worker in real browsers (fm-x6h5, after the removal of
// WebGL execution). The runtime and worker are bundled by Vite from the page in route-choice/; the model files are
// the acquired runtime under .cache/runtime, served from disk at the manifest's own origin through request
// interception that only counts and serves (nothing is stubbed, no browser API is replaced).
//
//   node --test test/e2e/route-choice.e2e.ts                       CPU and null-adapter cases (Playwright Chromium)
//   FACEMORPH_ROUTE_GPU=1 node --test test/e2e/route-choice.e2e.ts  adds the WebGPU cases (system Chromium, eris
//                                                                   GPU; run under the browser-gpu lease)
//
// GPU asset = any URL in manifest.webgpu or manifest.webgl (the ORT WebGPU bundle and the direct engine's
// coefficients; the two sets share nothing with the CPU bundle). `requestAdapter` calls are observed with the
// DevTools debugger (a breakpoint on the browser's own function that resumes at once), not by wrapping it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import base, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'vite';

const app = fileURLToPath(new URL('../../', import.meta.url));
const RUNTIME = fileURLToPath(new URL('../../../../.cache/runtime/', import.meta.url));
// Without the acquired runtime (a hosted runner) every case is reported untested, never run against something else.
const UNTESTED = existsSync(join(RUNTIME, 'manifest.json'))
  ? null
  : 'untested: no acquired runtime at .cache/runtime';
const test = ((name: string, ...rest: unknown[]) =>
  UNTESTED
    ? base(name, { skip: UNTESTED }, () => {})
    : (base as (...a: unknown[]) => unknown)(name, ...rest)) as unknown as typeof base;
const ORIGIN = 'https://next.facemorph.me';
const GPU = process.env['FACEMORPH_ROUTE_GPU'] === '1';
const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
];
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

type Json = Record<string, unknown>;
interface Manifest {
  canaries: { name: string }[];
  synthesis: unknown;
  mapping: unknown;
  webgpu: unknown;
  webgl: unknown;
}

/** Every {url, sha256} object under a manifest value: the assets (and chunks) a bundle needs. */
function assetsOf(value: unknown, out: { path: string; sha256: string }[] = []) {
  if (Array.isArray(value)) for (const v of value) assetsOf(v, out);
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o['url'] === 'string' && typeof o['sha256'] === 'string')
      out.push({ path: new URL(o['url']).pathname, sha256: o['sha256'] });
    for (const v of Object.values(o)) assetsOf(v, out);
  }
  return out;
}

let bundleDir = '';
let manifest: Manifest;
let gpuAssets = new Map<string, string>();
let cpuAssets = new Map<string, string>();
const browsers: Partial<Record<'cpu' | 'gpu', Browser>> = {};
const started = Date.now();
const log = (line: string) => console.log(`# ${line}`);

before(async () => {
  if (UNTESTED) return;
  assert.ok(existsSync(join(RUNTIME, 'manifest.json')), 'no acquired runtime at .cache/runtime');
  manifest = JSON.parse(readFileSync(join(RUNTIME, 'manifest.json'), 'utf8')) as Manifest;
  gpuAssets = new Map(
    [...assetsOf(manifest.webgpu), ...assetsOf(manifest.webgl)].map((a) => [a.path, a.sha256]),
  );
  cpuAssets = new Map(
    [...assetsOf(manifest.synthesis), ...assetsOf(manifest.mapping)].map((a) => [a.path, a.sha256]),
  );
  for (const path of gpuAssets.keys())
    assert.ok(!cpuAssets.has(path), `${path} is in both bundles`);
  bundleDir = mkdtempSync(join(tmpdir(), 'route-choice-'));
  await build({
    root: join(app, 'test/e2e/route-choice'),
    configFile: false,
    logLevel: 'warn',
    build: { outDir: bundleDir, emptyOutDir: true, target: 'esnext', sourcemap: false },
    worker: { format: 'es' },
  });
});
after(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
  log(`wall time ${((Date.now() - started) / 1000).toFixed(1)} s`);
});

interface Session {
  page: Page;
  context: BrowserContext;
  /** Requests served by path since the last reset. */
  counts: Map<string, number>;
  reset(): void;
  gpuRequests(): number;
  cpuRequests(): number;
  requestedGpuDigests(): string[];
  adapterCalls(): number;
  harness<T>(fn: string, ...args: unknown[]): Promise<T>;
  close(): Promise<void>;
}

async function launch(kind: 'cpu' | 'gpu'): Promise<Browser> {
  return kind === 'gpu'
    ? chromium.launch({ executablePath: '/usr/bin/chromium', headless: false, args: GPU_ARGS })
    : chromium.launch();
}

async function open(
  kind: 'cpu' | 'gpu',
  { userAgent }: { userAgent?: string } = {},
): Promise<Session> {
  const browser = (browsers[kind] ??= await launch(kind));
  const context = await browser.newContext(userAgent ? { userAgent } : {});
  const counts = new Map<string, number>();
  await context.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const file = path.startsWith('/runtime/')
      ? join(RUNTIME, path.slice('/runtime/'.length))
      : join(bundleDir, path === '/' ? 'index.html' : path);
    const inside = file.startsWith(path.startsWith('/runtime/') ? RUNTIME : bundleDir);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      body: readFileSync(file),
      headers: {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      },
    });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(
    () => (window as unknown as { harnessReady?: boolean }).harnessReady === true,
  );
  counts.clear();
  // Observe navigator.gpu.requestAdapter with the debugger: pause on the call, count it, resume.
  const cdp = await context.newCDPSession(page);
  let adapter = 0;
  cdp.on('Debugger.paused', () => {
    adapter++;
    void cdp.send('Debugger.resume');
  });
  await cdp.send('Debugger.enable');
  const fn = await cdp.send('Runtime.evaluate', { expression: 'navigator.gpu.requestAdapter' });
  const objectId = fn.result.objectId;
  assert.ok(objectId, 'navigator.gpu.requestAdapter is not a function object in this browser');
  await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId });
  const total = (m: Map<string, string>) => () =>
    [...counts].reduce((n, [p, c]) => n + (m.has(p) ? c : 0), 0);
  return {
    page,
    context,
    counts,
    reset: () => {
      counts.clear();
      adapter = 0;
    },
    gpuRequests: total(gpuAssets),
    cpuRequests: total(cpuAssets),
    requestedGpuDigests: () =>
      [...new Set([...counts.keys()].flatMap((p) => gpuAssets.get(p) ?? []))].sort(),
    adapterCalls: () => adapter,
    harness: (fn: string, ...args: unknown[]) =>
      page.evaluate(
        ([name, rest]) => {
          const h = (window as unknown as { harness: Record<string, (...a: unknown[]) => unknown> })
            .harness;
          return (h[name as string] as (...a: unknown[]) => unknown)(...(rest as unknown[]));
        },
        [fn, args] as const,
      ) as Promise<never>,
    close: () => context.close(),
  };
}

interface Outcome {
  ok: boolean;
  rgbaBytes?: number;
  error?: Json;
  status: { route: string; deviceValidated: boolean };
}
interface Qualified {
  ok: boolean;
  provider: string;
  checks: { name: string; maxRgb: number; maxFloat: number; passed: boolean }[];
  error?: Json;
}
type Event = { stage: string; provider?: string; outcome?: string };
const attempts = (events: Event[], provider: string) =>
  events.filter((e) => e.stage === 'route-attempt' && e.provider === provider).length;
const summary = (s: Session, events: Event[]) =>
  `gpuAssetRequests=${s.gpuRequests()} cpuAssetRequests=${s.cpuRequests()} requestAdapter=${s.adapterCalls()} events=${events
    .filter(
      (e) =>
        e.stage.startsWith('route') || e.stage.includes('fallback') || e.stage === 'routes-retried',
    )
    .map((e) => `${e.stage}:${e.provider ?? ''}${e.outcome ? `:${e.outcome}` : ''}`)
    .join(',')}`;

test('webgl requests are refused with RemovedRouteError (construct, setPreferredRoute, qualify)', async () => {
  const s = await open('cpu');
  try {
    const out = await s.harness<Record<string, Json | string>>('removedRouteChecks');
    for (const key of ['construct', 'setPreferredRoute', 'qualify'] as const) {
      const e = out[key] as Json;
      assert.equal(typeof e, 'object', `${key} was accepted`);
      assert.equal(e['name'], 'RemovedRouteError', key);
      assert.equal(e['code'], 'route-removed', key);
      assert.equal(e['route'], 'webgl', key);
    }
    assert.equal(s.gpuRequests(), 0);
  } finally {
    await s.close();
  }
});

test('(b) Auto with a null adapter runs CPU with zero GPU asset requests', async () => {
  const s = await open('cpu');
  try {
    const offer = await s.harness<{ hasGpuObject: boolean; adapter: boolean }>('gpuOffer');
    log(`browser offer: ${JSON.stringify(offer)}`);
    assert.equal(offer.adapter, false, 'this browser has an adapter: not a null-adapter case');
    s.reset();
    await s.harness('create', { preferredRoute: 'auto', fullQualify: false });
    const r = await s.harness<Outcome>('synthesize');
    const events = await s.harness<Event[]>('events');
    log(`(b) ${JSON.stringify(r)} hasGpuObject=${offer.hasGpuObject} ${summary(s, events)}`);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.status.route, 'cpu');
    assert.equal(r.rgbaBytes, 1024 * 1024 * 4);
    assert.equal(s.gpuRequests(), 0, 'GPU assets were requested');
    assert.ok(s.cpuRequests() > 0, 'the CPU bundle was never requested');
    assert.equal(attempts(events, 'webgpu'), 0);
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test('(d) explicit CPU acquires zero GPU assets', async () => {
  const s = await open('cpu');
  try {
    await s.harness('create', { preferredRoute: 'cpu', fullQualify: false });
    const r = await s.harness<Outcome>('synthesize');
    const events = await s.harness<Event[]>('events');
    log(`(d) ${JSON.stringify(r)} ${summary(s, events)}`);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.status.route, 'cpu');
    assert.equal(s.gpuRequests(), 0, 'GPU assets were requested');
    assert.ok(s.cpuRequests() > 0);
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

// fm-lt2p: per-operation admission in the runtime, on a real null adapter.
test('(lt2p) Auto with a null adapter: the admission event says auto -> cpu and its log line is printed', async () => {
  const s = await open('cpu');
  const lines: string[] = [];
  s.page.on('console', (m) => {
    if (m.text().startsWith('[facemorph-admission]')) lines.push(m.text());
  });
  try {
    s.reset();
    await s.harness('create', { preferredRoute: 'auto', fullQualify: false });
    const r = await s.harness<Outcome>('synthesize');
    const events = await s.harness<(Event & { admission?: Json })[]>('events');
    for (const line of lines) log(`(lt2p) ${line}`);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const admitted = events.find((e) => e.stage === 'route-admitted' && e.admission);
    assert.ok(admitted, 'no route-admitted event carried the admission');
    assert.equal(admitted.admission?.['operation'], 'face');
    assert.equal(admitted.admission?.['requestedProvider'], 'auto');
    assert.equal(admitted.admission?.['provider'], 'cpu');
    assert.ok(
      lines.some((l) =>
        /"operation":"face","requested":"auto","adapter":"(null adapter|absent)","decision":"admitted","provider":"cpu"/.test(
          l,
        ),
      ),
      `no structured admission line: ${lines.join(' | ')}`,
    );
    assert.equal(s.gpuRequests(), 0, 'GPU assets were requested');
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test('(lt2p) explicit WebGPU with a null adapter is refused before any model request, with a reason', async () => {
  const s = await open('cpu');
  try {
    const offer = await s.harness<{ hasGpuObject: boolean; adapter: boolean }>('gpuOffer');
    assert.equal(offer.adapter, false, 'this browser has an adapter: not a null-adapter case');
    await s.harness('create', { preferredRoute: 'webgpu', fullQualify: false });
    const canary = new URL((manifest.canaries[0] as unknown as { w: { url: string } }).w.url)
      .pathname;
    s.reset();
    const r = await s.harness<Outcome>('synthesize');
    const model = [...s.counts.keys()].filter(
      (p) => p.startsWith('/runtime/') && p !== '/runtime/manifest.json' && p !== canary,
    );
    log(
      `(lt2p) refused: ${JSON.stringify(r.error)} model requests: ${model.length} workers: ${await s.harness<number>('workerStarts')}`,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error?.['name'], 'AdmissionRefused');
    assert.equal(
      r.error?.['reasonKey'],
      offer.hasGpuObject ? 'webgpu-no-adapter' : 'webgpu-absent',
    );
    assert.match(String(r.error?.['helpAnchor']), /^#help-webgpu-/);
    assert.deepEqual(model, [], 'a refused route requested model or runtime files');
    assert.equal(await s.harness<number>('workerStarts'), 0, 'a refused route started a worker');
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test('(d) explicit CPU never calls navigator.gpu.requestAdapter', async () => {
  const s = await open('cpu');
  try {
    await s.harness('create', { preferredRoute: 'cpu', fullQualify: false });
    const r = await s.harness<Outcome>('synthesize');
    assert.equal(r.ok, true, JSON.stringify(r.error));
    log(`(d) requestAdapter calls during an explicit-CPU intent: ${s.adapterCalls()}`);
    assert.equal(s.adapterCalls(), 0, 'explicit CPU probed the GPU adapter');
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test(
  '(e) explicit WebGPU on failure settles with the error and substitutes no CPU',
  { skip: !GPU && 'needs the GPU lane (FACEMORPH_ROUTE_GPU=1)' },
  async () => {
    const s = await open('gpu');
    try {
      await s.harness('create', {
        preferredRoute: 'webgpu',
        failWebgpuCanary: true,
        fullQualify: false,
      });
      const r = await s.harness<Outcome>('synthesize');
      const events = await s.harness<Event[]>('events');
      log(`(e) ${JSON.stringify(r)} ${summary(s, events)}`);
      assert.equal(r.ok, false);
      assert.match(String(r.error?.['message']), /Device correctness check failed/);
      assert.equal(attempts(events, 'cpu'), 0, 'CPU was substituted for an explicit WebGPU choice');
      assert.equal(
        s.cpuRequests(),
        0,
        'CPU bundle bytes were fetched for an explicit WebGPU choice',
      );
      assert.ok(s.gpuRequests() > 0);
      await s.harness('dispose');
    } finally {
      await s.close();
    }
  },
);

test('(f) a worker start failure does not poison the route choice (null adapter, Auto)', async () => {
  const s = await open('cpu');
  try {
    await s.harness('create', { preferredRoute: 'auto', badWorkerStarts: 1, fullQualify: false });
    const before = await s.harness<{ route: string }>('plan');
    const first = await s.harness<Outcome>('synthesize');
    const events1 = (await s.harness<Event[]>('events')).slice();
    log(`(f) first ${JSON.stringify(first)} ${summary(s, events1)}`);
    assert.equal(first.ok, false);
    assert.equal(first.error?.['engineStopped'], true, 'not reported as a worker start failure');
    assert.equal(
      events1.some((e) => e.outcome === 'engine-stopped'),
      true,
    );
    assert.equal(
      events1.filter((e) => e.stage === 'route-attempt').length,
      1,
      'a second route was tried',
    );
    assert.equal((await s.harness<{ route: string }>('plan')).route, before.route);
    const second = await s.harness<Outcome>('synthesize');
    const events2 = await s.harness<Event[]>('events');
    log(
      `(f) second ${JSON.stringify(second)} workerStarts=${await s.harness('workerStarts')} ${summary(s, events2)}`,
    );
    assert.equal(second.ok, true, JSON.stringify(second.error));
    assert.equal(second.status.route, before.route);
    assert.equal(s.gpuRequests(), 0);
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test('CPU numerical canaries are within the frozen tolerances (RGB max 1, raw-float 0.002)', async () => {
  const s = await open('cpu');
  try {
    await s.harness('create', { preferredRoute: 'cpu' });
    const q = await s.harness<Qualified>('qualify', 'cpu');
    assert.equal(q.ok, true, JSON.stringify(q.error));
    assert.equal(q.checks.length, manifest.canaries.length, 'not every canary ran');
    const maxRgb = Math.max(...q.checks.map((c) => c.maxRgb));
    const maxFloat = Math.max(...q.checks.map((c) => c.maxFloat));
    log(
      `CPU canaries: n=${q.checks.length} maxRgb=${maxRgb} maxFloat=${maxFloat} per=${JSON.stringify(q.checks.map((c) => [c.name, c.maxRgb, c.maxFloat]))}`,
    );
    assert.ok(q.checks.every((c) => c.passed));
    assert.ok(maxRgb <= 1, `RGB max diff ${maxRgb}`);
    assert.ok(maxFloat <= 0.002, `raw-float max diff ${maxFloat}`);
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

const gpu = { skip: !GPU && 'needs the GPU lane (FACEMORPH_ROUTE_GPU=1)' };

test('(a) Auto with an admitted WebGPU adapter runs WebGPU', gpu, async () => {
  const s = await open('gpu');
  try {
    const offer = await s.harness<{ adapter: boolean }>('gpuOffer');
    assert.equal(offer.adapter, true, 'no adapter in the GPU lane');
    s.reset();
    await s.harness('create', { preferredRoute: 'auto', fullQualify: false });
    const r = await s.harness<Outcome>('synthesize');
    const events = await s.harness<Event[]>('events');
    log(`(a) ${JSON.stringify(r)} ${summary(s, events)}`);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.status.route, 'webgpu');
    assert.ok(s.gpuRequests() > 0);
    assert.equal(s.cpuRequests(), 0, 'the CPU bundle was fetched although WebGPU was admitted');
    assert.ok(s.adapterCalls() >= 1);
    await s.harness('dispose');
  } finally {
    await s.close();
  }
});

test(
  '(c) Auto after a WebGPU failure falls back to CPU once, records why, and does not retry GPU',
  gpu,
  async () => {
    const s = await open('gpu');
    try {
      await s.harness('create', {
        preferredRoute: 'auto',
        failWebgpuCanary: true,
        fullQualify: false,
      });
      const r = await s.harness<Outcome>('synthesize');
      const events = await s.harness<Event[]>('events');
      log(`(c) ${JSON.stringify(r)} ${summary(s, events)}`);
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.equal(r.status.route, 'cpu');
      assert.equal(attempts(events, 'cpu'), 1, 'CPU was attempted more than once');
      const firstCpu = events.findIndex((e) => e.stage === 'route-attempt' && e.provider === 'cpu');
      assert.ok(firstCpu > 0);
      assert.equal(
        events.slice(firstCpu).some((e) => e.stage === 'route-attempt' && e.provider === 'webgpu'),
        false,
        'GPU was retried after the CPU fallback',
      );
      // The direct engine may fall back to ORT on the same route first; each webgpu attempt is a distinct engine.
      assert.ok(attempts(events, 'webgpu') <= 2);
      assert.ok(
        events.some(
          (e) =>
            e.stage === 'route-admitted' &&
            e.provider === 'webgpu' &&
            e.outcome === 'canary-failed',
        ),
        'the refusal reason was not recorded',
      );
      assert.ok(s.cpuRequests() > 0);
      // A second intent in the same runtime stays on CPU and does not go back to the GPU.
      const gpuBefore = s.gpuRequests();
      const again = await s.harness<Outcome>('synthesize');
      assert.equal(again.ok, true, JSON.stringify(again.error));
      assert.equal(again.status.route, 'cpu');
      assert.equal(s.gpuRequests(), gpuBefore);
      await s.harness('dispose');
    } finally {
      await s.close();
    }
  },
);

test(
  '(f) a worker start failure does not poison the route choice (admitted WebGPU, Auto)',
  gpu,
  async () => {
    const s = await open('gpu');
    try {
      await s.harness('create', { preferredRoute: 'auto', badWorkerStarts: 1, fullQualify: false });
      const before = await s.harness<{ route: string }>('plan');
      assert.equal(before.route, 'webgpu');
      const first = await s.harness<Outcome>('synthesize');
      assert.equal(first.ok, false);
      assert.equal(first.error?.['engineStopped'], true);
      assert.equal(s.cpuRequests(), 0, 'CPU was substituted for a worker that never started');
      assert.equal((await s.harness<{ route: string }>('plan')).route, 'webgpu');
      const second = await s.harness<Outcome>('synthesize');
      log(`(f gpu) ${JSON.stringify(second)} ${summary(s, await s.harness<Event[]>('events'))}`);
      assert.equal(second.ok, true, JSON.stringify(second.error));
      assert.equal(second.status.route, 'webgpu');
      await s.harness('dispose');
    } finally {
      await s.close();
    }
  },
);

for (const [name, userAgent, engine] of [
  ['direct WebGPU (desktop)', undefined, 'direct'],
  ['mobile ORT WebGPU (Android user agent)', ANDROID_UA, 'ort'],
] as const) {
  test(`WebGPU canaries pass: ${name}`, gpu, async () => {
    const s = await open('gpu', userAgent ? { userAgent } : {});
    try {
      await s.harness('create', { preferredRoute: 'webgpu' });
      const plan = await s.harness<{ route: string; engine: string }>('plan');
      assert.equal(plan.engine, engine);
      s.reset();
      const q = await s.harness<Qualified>('qualify', 'webgpu');
      assert.equal(q.ok, true, JSON.stringify(q.error));
      assert.equal(q.checks.length, manifest.canaries.length);
      const maxRgb = Math.max(...q.checks.map((c) => c.maxRgb));
      const maxFloat = Math.max(...q.checks.map((c) => c.maxFloat));
      const digests = s.requestedGpuDigests();
      const bundle = createHash('sha256').update(digests.join('\n')).digest('hex');
      log(
        `${name}: engine=${plan.engine} canaries=${q.checks.length} maxRgb=${maxRgb} maxFloat=${maxFloat} gpuAssetDigests=${digests.length} bundleDigest=${bundle} cpuRequests=${s.cpuRequests()}`,
      );
      log(`${name}: coefficient/bundle digests acquired = ${digests.join(' ')}`);
      assert.ok(q.checks.every((c) => c.passed));
      assert.ok(maxRgb <= 1 && maxFloat <= 0.002);
      assert.equal(s.cpuRequests(), 0);
      const expected = new Set(
        (engine === 'direct' ? assetsOf(manifest.webgl) : assetsOf(manifest.webgpu)).map(
          (a) => a.sha256,
        ),
      );
      assert.ok(digests.length > 0);
      assert.ok(digests.every((d) => gpuAssets.size > 0 && [...gpuAssets.values()].includes(d)));
      for (const d of expected)
        assert.ok(digests.includes(d), `the ${engine} engine never acquired ${d}`);
      await s.harness('dispose');
    } finally {
      await s.close();
    }
  });
}
