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
// FACEMORPH_NUMERICS_OUT writes a new execution receipt only after every selected cell passes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
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
const NUMERICS_OUT = process.env['FACEMORPH_NUMERICS_OUT'];
if (NUMERICS_OUT !== undefined) {
  assert.ok(NUMERICS_OUT.length > 0, 'FACEMORPH_NUMERICS_OUT must name a new file');
  assert.equal(existsSync(NUMERICS_OUT), false, 'refuse to overwrite a numerical receipt');
}
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

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fileSha256 = (path: string) => sha256(readFileSync(path));

/** Bind every served package file using repository-relative POSIX paths and byte identities. */
function distSha256() {
  const files: { path: string; sha256: string; size: number }[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(entry.isFile(), `unsupported dist entry: ${path}`);
        const bytes = readFileSync(path);
        files.push({
          path: relative(REPO, path).split(sep).join('/'),
          sha256: sha256(bytes),
          size: bytes.length,
        });
      }
    }
  };
  visit(ROOTS['/stylegan/']!);
  visit(ROOTS['/manager/']!);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(JSON.stringify(files));
}

function numericalIdentity() {
  return {
    harnessSha256: fileSha256(fileURLToPath(import.meta.url)),
    runtimeSupportSha256: fileSha256(
      join(REPO, 'packages/stylegan-js/test/engine/support/runtime.ts'),
    ),
    suiteSha256: fileSha256(join(FULL31, 'manifest.json')),
    pinnedSuiteSha256: fileSha256(fileURLToPath(new URL('./manifest.json', import.meta.url))),
    distSha256: distSha256(),
  };
}

const numericalIdentityBefore = NUMERICS_OUT === undefined ? null : numericalIdentity();
const numericalCells: NumericalCell[] = [];
let attemptedCells = 0;

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

after(() => {
  if (NUMERICS_OUT === undefined) return;
  assert.ok(numericalCells.length > 0, 'a numerical receipt requires an executed passing cell');
  assert.equal(
    numericalCells.length,
    attemptedCells,
    'every attempted cell must pass before writing a receipt',
  );
  assert.deepEqual(
    numericalIdentity(),
    numericalIdentityBefore,
    'served code and fixture identities stayed unchanged',
  );
  assert.equal(
    fileSha256(join(RUNTIME, 'manifest.json')),
    runtime!.sha256,
    'runtime manifest stayed unchanged',
  );
  writeFileSync(
    resolve(NUMERICS_OUT),
    JSON.stringify(
      {
        schema: 'facemorph.full31-numerics/1',
        manifestSha256: runtime!.sha256,
        identity: numericalIdentityBefore,
        thresholds: { maxRgb: MAX_RGB, maxFloat: MAX_FLOAT },
        passed: true,
        cells: numericalCells,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
});

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
  version(): string;
  newContext(o?: object): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
};
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium' | 'firefox',
  { launch(o: object): Promise<Browser>; executablePath(): string }
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

interface Adapter {
  fallback: boolean;
  vendor: string;
  architecture: string;
  description: string;
}
interface NumericalCell {
  requested: { browser: string; engine: string; route: string; provider: string };
  browser: {
    version: string;
    executablePath: string;
    executableSha256: string;
    launchTargetPath: string;
    launchTargetSha256: string;
  };
  actual: { engine: string; route: string; provider: string };
  adapter: Adapter | null;
  cases: Out['checks'];
  passed: true;
}

/** Inspect only this test process's own directly spawned children, never peer browsers. */
function childBrowserProcesses() {
  assert.ok(
    existsSync('/proc/self/exe'),
    'numerical receipts require Linux /proc executable identity',
  );
  const children: { pid: string; executablePath: string }[] = [];
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      if (Number(/^PPid:\s+(\d+)$/m.exec(status)?.[1]) !== process.pid) continue;
      // Chromium may rewrite argv into one space-separated process-title argument.
      const args = readFileSync(`/proc/${pid}/cmdline`).toString().replaceAll('\0', ' ');
      if (!/(?:^|\s)(?:--remote-debugging-pipe|-juggler-pipe)(?:\s|$)/.test(args)) continue;
      children.push({ pid, executablePath: realpathSync(`/proc/${pid}/exe`) });
    } catch (error) {
      // A short-lived child may exit between /proc reads; all other errors fail closed.
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        (error as NodeJS.ErrnoException).code !== 'ESRCH'
      )
        throw error;
    }
  }
  return children;
}

function browserIdentity(browser: Browser, executablePath: string, before: readonly string[]) {
  const children = childBrowserProcesses().filter((child) => !before.includes(child.pid));
  assert.equal(
    children.length,
    1,
    'exactly one newly launched browser process must be identifiable',
  );
  const path = children[0]!.executablePath;
  const launchTargetPath = realpathSync(executablePath);
  return {
    version: browser.version(),
    executablePath: path,
    executableSha256: fileSha256(path),
    launchTargetPath,
    launchTargetSha256: fileSha256(launchTargetPath),
  };
}

function recordNumericalCell(cell: NumericalCell) {
  if (NUMERICS_OUT === undefined) return;
  assert.equal(
    fileSha256(cell.browser.executablePath),
    cell.browser.executableSha256,
    'browser executable stayed unchanged',
  );
  assert.equal(
    fileSha256(cell.browser.launchTargetPath),
    cell.browser.launchTargetSha256,
    'browser launch target stayed unchanged',
  );
  numericalCells.push(cell);
}

// Opening the local test page can fail at the network level while eris is busy with CI beside this job (net::ERR_TIMED_OUT
// in runs 40602031941 and 40615911412, before any numerics). Only that is retried; every check after it is unchanged.
async function open(page: Page, url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.goto(url);
    } catch (error) {
      if (attempt === 3 || !/net::ERR_(TIMED_OUT|CONNECTION_\w+)/.test(String(error))) throw error;
    }
  }
}

async function runCell(
  t: { diagnostic(m: string): void },
  browser: Browser,
  scope: 'cpu' | 'ort' | 'direct',
  label: string,
) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(3_000_000);
  await open(page, `${origin}/`);
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
      attemptedCells++;
      // Receipt mode selects an explicit target: Chromium's default headless-shell path differs
      // from BrowserType.executablePath(), so reporting the latter for a default launch is inaccurate.
      const executablePath = NUMERICS_OUT === undefined ? null : pw[kind].executablePath();
      const before =
        NUMERICS_OUT === undefined ? [] : childBrowserProcesses().map((child) => child.pid);
      const browser = await pw[kind]
        .launch(executablePath ? { executablePath } : {})
        .catch(() => null);
      if (!browser) return t.skip(`untested: Playwright ${kind} does not start here`);
      t.after(() => browser.close());
      const identity =
        executablePath === null ? null : browserIdentity(browser, executablePath, before);
      const out = await runCell(t, browser, 'cpu', `cpu-${kind}`);
      assert.deepEqual([out.engine, out.route, out.provider], ['ort-wasm', 'cpu', 'cpu']);
      if (identity)
        recordNumericalCell({
          requested: { browser: kind, engine: 'ort-wasm', route: 'cpu', provider: 'cpu' },
          browser: identity,
          actual: { engine: out.engine, route: out.route, provider: out.provider },
          adapter: null,
          cases: out.checks,
          passed: true,
        });
    },
  );

const CHROME = process.env['CHROMIUM_PATH'] ?? 'google-chrome';
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];

for (const scope of ['ort', 'direct'] as const)
  test(
    `full31 on WebGPU, ${scope === 'ort' ? 'ORT' : 'direct'} engine, in Chrome`,
    { timeout: 3_600_000, skip: SKIP },
    async (t) => {
      attemptedCells++;
      const executablePath = CHROME.includes('/')
        ? CHROME
        : execFileSync('which', [CHROME]).toString().trim();
      const before =
        NUMERICS_OUT === undefined ? [] : childBrowserProcesses().map((child) => child.pid);
      const browser = await pw.chromium
        .launch({ executablePath, headless: false, args: GPU_ARGS })
        .catch(() => null);
      if (!browser) return t.skip(`untested: Chrome does not start here (${CHROME})`);
      t.after(() => browser.close());
      const identity =
        NUMERICS_OUT === undefined ? null : browserIdentity(browser, executablePath, before);
      const probe = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
      // Like the run page: a loaded machine can take over Playwright's 30 s default to open it (run 40602031941).
      probe.setDefaultTimeout(300_000);
      await open(probe, `${origin}/`);
      await probe.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
      const adapter = await call<Adapter | null>(probe, 'adapter');
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
      if (identity)
        recordNumericalCell({
          requested: {
            browser: 'chromium',
            engine: scope === 'ort' ? 'ort-webgpu' : 'direct-webgpu',
            route: 'webgpu',
            provider: 'webgpu',
          },
          browser: identity,
          actual: { engine: out.engine, route: out.route, provider: out.provider },
          adapter,
          cases: out.checks,
          passed: true,
        });
    },
  );
