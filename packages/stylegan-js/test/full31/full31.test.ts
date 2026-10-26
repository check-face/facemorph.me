// The classic full31 research/reference suite (fm-3h3w) through the package engine in real browsers.
//
// full31 was classic review-artifacts/browser-onnx-qualification/ (experiment/onnx/qualification_fixtures.py): 26
// video-frame W+ latents, the encoded synthetic photo, zero and alternate noise and truncation psi 0 and 1, each
// against an independent ORT CPU FP32 spatial reference (every RGB pixel plus 4091 sampled raw floats), at the
// suite's frozen gate: RGB <= 1 on 0-255 and sampled float <= 0.002 (the same values as the product canaries;
// never widened). The fixtures are regenerated from the original checkpoint and the shipped runtime by
// ./regenerate.py (no TrueNAS copy); they are run products, kept outside Git (FACEMORPH_FULL31, default
// <repo>/.cache/research/full31); every file is checked against the digests pinned in ./manifest.json.
//
// Each cell runs the engine with `full` qualification and the 31 cases in place of the seven product canaries:
// the CPU route in Playwright Chromium and Firefox, and the ORT WebGPU and direct WebGPU engines in Chrome with a
// hardware adapter (CHROMIUM_PATH, default google-chrome on PATH). A cell without its browser, adapter, runtime or
// fixtures is reported untested.
//   npm run build -w packages/stylegan-js -w packages/browser-model-manager
//   node --test packages/stylegan-js/test/full31/full31.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acquiredManifest, RUNTIME, UNTESTED } from '../engine/support/runtime.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FULL31 = process.env['FACEMORPH_FULL31'] ?? join(REPO, '.cache/research/full31');
const ROOTS: Record<string, string> = {
  '/stylegan/': join(REPO, 'packages/stylegan-js/dist/'),
  '/manager/': join(REPO, 'packages/browser-model-manager/dist/'),
  '/runtime/': RUNTIME + '/',
  '/full31/': FULL31 + '/',
};
const BUILT =
  existsSync(join(ROOTS['/stylegan/']!, 'engine/index.js')) &&
  existsSync(join(ROOTS['/manager/']!, 'index.js'));
const runtime = acquiredManifest();
const MAX_RGB = 1,
  MAX_FLOAT = 0.002; // full31's frozen research gate

interface Full31Case {
  name: string;
  noise: string;
  w: string;
  samples: string;
  reference: string;
}
interface Full31Manifest {
  cases: Full31Case[];
  sampleIndices: string;
  files: Record<string, string>;
  inputs: unknown;
}
const suite: Full31Manifest | null = existsSync(join(FULL31, 'manifest.json'))
  ? JSON.parse(readFileSync(join(FULL31, 'manifest.json'), 'utf8'))
  : null;
/** The committed digests of the regeneration that passed (./manifest.json): a fresh one must reproduce them. */
const pinned = JSON.parse(
  readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'),
) as Full31Manifest;

const PAGE = `<!doctype html><meta charset="utf-8"><title>full31</title><script type="module">
import * as engine from '/stylegan/engine/index.js';
import * as manager from '/manager/index.js';
const assetsOf = (v, out = []) => { if (!v || typeof v !== 'object') return out; if (typeof v.sha256 === 'string' && typeof v.url === 'string') { out.push(v); return out; } for (const x of Array.isArray(v) ? v : Object.values(v)) assetsOf(x, out); return out; };
window.harness = {
  async run(manifest, manifestSha256, scope) {
    const cache = await manager.createBrowserModelCache();
    const parts = [manifest.runtime, manifest.mapping, manifest.average, manifest.noise, manifest.sampleIndices, manifest.canaries,
      scope === 'cpu' ? manifest.synthesis : scope === 'ort' ? manifest.webgpu : manifest.webgl];
    const list = [...new Map(assetsOf(parts).filter((a) => a.url !== manifest.webgpu?.kernel?.url).map((a) => [a.sha256, a])).values()];
    const grant = { manifestSha256: '', route: scope === 'cpu' ? 'cpu' : 'webgpu', purpose: 'generate', owners: ['face:full31'],
      assets: list.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
      remainingBytes: 5 * list.reduce((n, a) => n + a.size, 0) };
    for (const a of list) await cache.acquire(a, { grant, owner: 'face:full31' });
    const reader = cache.local;
    const host = engine.browserModuleHost();
    const threads = engine.cpuThreads({ sharedArrayBuffer: typeof SharedArrayBuffer === 'function', crossOriginIsolated: globalThis.crossOriginIsolated === true, hardwareConcurrency: navigator.hardwareConcurrency });
    let cpu = null;
    const cpuOrt = async () => (cpu ??= await engine.loadOrtRuntime(reader, engine.cpuRuntimeAssets(manifest.runtime), host, threads)).ort;
    const g = scope === 'cpu' ? await engine.loadCpuGenerator({ reader, manifest, manifestSha256, ort: cpuOrt })
      : scope === 'ort' ? await engine.loadOrtWebGpuGenerator({ reader, manifest, manifestSha256, gpu: navigator.gpu, host, cpuOrt })
      : await engine.loadDirectWebGpuGenerator({ reader, manifest, manifestSha256, gpu: navigator.gpu, cpuOrt });
    await g.mappingReady();
    const q = engine.createCanaryQualification({ manifest, manifestSha256, route: g.route, bundle: engine.canaryBundle(manifest, g.route, scope === 'direct' ? 'direct' : 'ort'), records: cache.records, reader, synthesizeRaw: (v, n) => g.synthesizeRaw(v, n), full: true });
    const started = performance.now();
    let checks, failure = null;
    try { checks = (await q.admit()).checks; } catch (e) { checks = q.checks(); failure = { message: String(e?.message ?? e), check: e?.check ?? null }; }
    const ms = performance.now() - started;
    const out = { engine: g.engine, route: g.route, provider: g.provider.actual, threads, checks, failure, ms };
    await g.dispose?.();
    return out;
  },
  async adapter() {
    const a = await navigator.gpu?.requestAdapter();
    return a ? { fallback: a.info?.isFallbackAdapter === true, vendor: a.info?.vendor ?? '', architecture: a.info?.architecture ?? '', description: a.info?.description ?? '' } : null;
  },
};
window.ready = true;
</script>`;

const work = mkdtempSync(join(tmpdir(), 'full31-'));
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

/** A served full31 file as an engine asset, verified against the regenerated manifest's digest. */
function asset(file: string) {
  const bytes = readFileSync(join(FULL31, file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, suite!.files[file], `${file} matches the full31 manifest`);
  return { url: `${origin}/full31/${file}`, sha256, size: bytes.length };
}

/** The shipped runtime manifest on the harness origin, with the 31 cases in place of the product canaries. */
function full31Manifest() {
  const manifest = JSON.parse(
    readFileSync(join(RUNTIME, 'manifest.json'), 'utf8').replaceAll(
      'https://next.facemorph.me/runtime/',
      `${origin}/runtime/`,
    ),
  );
  assert.deepEqual(
    suite!.files,
    pinned.files,
    'the regenerated fixtures reproduce the pinned digests',
  );
  const indices = asset(suite!.sampleIndices);
  assert.equal(indices.sha256, manifest.sampleIndices.sha256, 'full31 samples the shipped indices');
  manifest.canaries = suite!.cases.map((c) => ({
    name: c.name,
    noise: c.noise,
    w: asset(c.w),
    samples: asset(c.samples),
    reference: asset(c.reference),
  }));
  return manifest;
}

type Page = {
  evaluate<T>(fn: (a: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg?: unknown, o?: object): Promise<unknown>;
  setDefaultTimeout(ms: number): void;
};
type Browser = {
  newContext(o?: object): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
};
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium' | 'firefox',
  { launch(o: object): Promise<Browser> }
>;
const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]: [string, unknown[]]) =>
      (window as unknown as { harness: Record<string, (...x: unknown[]) => T> }).harness[n]!(...a),
    [name, args] as never,
  ) as Promise<T>;

interface Out {
  engine: string;
  route: string;
  provider: string;
  threads: number;
  ms: number;
  checks: { name: string; maxRgb: number; maxFloat: number; passed: boolean }[];
  failure: { message: string } | null;
}

async function runCell(
  t: { diagnostic(m: string): void },
  browser: Browser,
  scope: 'cpu' | 'ort' | 'direct',
  label: string,
) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(3_000_000);
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  const out = await call<Out>(page, 'run', full31Manifest(), runtime!.sha256, scope);
  for (const c of out.checks)
    t.diagnostic(`${label} ${c.name}: maxRgb ${c.maxRgb}, maxFloat ${c.maxFloat}`);
  const maxRgb = Math.max(...out.checks.map((c) => c.maxRgb)),
    maxFloat = Math.max(...out.checks.map((c) => c.maxFloat));
  t.diagnostic(
    `${label}: ${out.engine}/${out.route}/${out.provider}, threads ${out.threads}, ${out.checks.length}/31 checked in ${Math.round(out.ms / 1000)} s, max RGB ${maxRgb}, max sampled float ${maxFloat}${out.failure ? `, FAILED ${out.failure.message}` : ''}`,
  );
  assert.equal(out.failure, null, `${label}: no case missed the gate`);
  assert.equal(out.checks.length, 31, `${label}: all 31 cases`);
  assert.deepEqual(
    out.checks.map((c) => c.name),
    suite!.cases.map((c) => c.name),
  );
  for (const c of out.checks)
    assert.ok(c.passed && c.maxRgb <= MAX_RGB && c.maxFloat <= MAX_FLOAT, `${label} ${c.name}`);
  return out;
}

const SKIP = !runtime
  ? UNTESTED
  : !BUILT
    ? 'untested: build the packages first (npm run build -w packages/stylegan-js -w packages/browser-model-manager)'
    : !suite
      ? `untested: full31 fixtures are not regenerated at ${FULL31} (test/full31/regenerate.py)`
      : false;

for (const kind of ['chromium', 'firefox'] as const)
  test(
    `full31 on the CPU route in Playwright ${kind}`,
    { timeout: 3_600_000, skip: SKIP },
    async (t) => {
      const browser = await pw[kind].launch({}).catch(() => null);
      if (!browser) return t.skip(`untested: Playwright ${kind} does not start here`);
      t.after(() => browser.close());
      const out = await runCell(t, browser, 'cpu', `cpu-${kind}`);
      assert.deepEqual([out.engine, out.route, out.provider], ['ort-wasm', 'cpu', 'cpu']);
    },
  );

const CHROME = process.env['CHROMIUM_PATH'] ?? 'google-chrome';
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];

for (const scope of ['ort', 'direct'] as const)
  test(
    `full31 on WebGPU, ${scope === 'ort' ? 'ORT' : 'direct'} engine, in Chrome`,
    { timeout: 3_600_000, skip: SKIP },
    async (t) => {
      const executablePath = CHROME.includes('/')
        ? CHROME
        : execFileSync('which', [CHROME]).toString().trim();
      const browser = await pw.chromium
        .launch({ executablePath, headless: false, args: GPU_ARGS })
        .catch(() => null);
      if (!browser) return t.skip(`untested: Chrome does not start here (${CHROME})`);
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
      const out = await runCell(t, browser, scope, `webgpu-${scope}`);
      assert.deepEqual(
        [out.engine, out.route, out.provider],
        [scope === 'ort' ? 'ort-webgpu' : 'direct-webgpu', 'webgpu', 'webgpu'],
      );
    },
  );
