// The caller-loaded example (examples/caller-loaded, fm-1jr7) from the packed tarball in a real browser.
//
// This package's sources are built fresh and `npm pack`ed, the tarball is installed into a clean project in
// os.tmpdir() (outside the monorepo), the example is compiled there by tsc against the emitted .d.ts only, and its
// index.html is served as-is (an import map onto node_modules; no bundler, no manager). The acquired runtime
// (manifest.json and its assets; never committed) is served from a second origin, the model host.
//
// In Playwright Chromium (CPU), and in system Chromium with WebGPU where a real hardware adapter exists: construct
// and status reads; a load aborted mid-read; a load from a wrong base (a typed error); the real load with all seven
// admission canaries; seed A, seed B and their W+ midpoint through map/synthesize; the five original-noise canary
// latents synthesized through the public synthesize API with raw float output and compared here, independently of
// the package's comparison, against the runtime's reference PNG (decoded by the frozen candidate-control decoder)
// and sampled raw floats, at the frozen product gate RGB <= 1/255 and sampled raw float <= 0.002; an aborted and
// an invalid operation; dispose. Every request is intercepted by host class: none at construction and status
// reads, and afterwards only the model reads the example's own reader logged, from the page.
//   node --test packages/stylegan-js/test/engine/caller-loaded-example.test.ts
// FACEMORPH_RUNTIME_CACHE names the runtime directory (default ~/.cache/facemorph-device-lab/runtime-public, then
// ~/.cache/facemorph-runtime); CHROMIUM_PATH the WebGPU browser (default /usr/bin/chromium).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import {
  bindOrigins,
  requestsIn,
  step,
  type NetworkRecord,
} from '../../../../scripts/ci/intercept/record.ts';
import {
  compileClean,
  installClean,
  PKG,
  packFresh,
  REPO,
  repoVersion,
} from '../support/packed.ts';

const PINNED = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const sha256File = (p: string) =>
  execFileSync('sha256sum', [p], { encoding: 'utf8' }).split(' ')[0] ?? '';
const RUNTIME = (
  process.env['FACEMORPH_RUNTIME_CACHE']
    ? [process.env['FACEMORPH_RUNTIME_CACHE']]
    : [
        join(homedir(), '.cache/facemorph-device-lab/runtime-public'),
        join(homedir(), '.cache/facemorph-runtime'),
      ]
).find((d) => existsSync(join(d, 'manifest.json')));
const SKIP = !RUNTIME
  ? 'untested: the runtime is not acquired here (scripts/runtime/acquire.mjs)'
  : sha256File(join(RUNTIME, 'manifest.json')) !== PINNED
    ? `untested: ${RUNTIME}/manifest.json is not the pinned runtime`
    : false;

interface Asset {
  sha256: string;
  size: number;
  url: string;
}
interface Manifest {
  sampleIndices: Asset;
  canaries: { name: string; noise?: string; w: Asset; samples: Asset; reference: Asset }[];
}
const fileOf = (url: string) => join(RUNTIME ?? '', url.split('/runtime/')[1] ?? '');
/** A file's bytes in a fresh, exactly sized ArrayBuffer (a Buffer may sit in a shared pool). */
const bytesOf = (url: string) => Uint8Array.from(readFileSync(fileOf(url)));

// The frozen candidate decoder (test/vectors/candidate-control), not the package's: an independent reading.
const CONTROL = '../vectors/candidate-control/browser/png.mjs';
const controlPng = (await import(CONTROL)) as {
  decodeReferencePng(b: Uint8Array): Promise<{ rgba: Uint8ClampedArray }>;
};

const work = mkdtempSync(join(tmpdir(), 'stylegan-js-caller-loaded-'));
after(() => rmSync(work, { recursive: true, force: true }));
const project = join(work, 'consumer');
let compiled: ReturnType<typeof compileClean> | null = null;

const tls = (() => {
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
    ].concat(['-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')]),
    { stdio: 'ignore' },
  );
  return { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) };
})();

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
/** A static HTTPS server over `root`; `served` logs each path it answered (the server's own count). */
function staticServer(root: string, headers: Record<string, string>, served: string[]) {
  return createServer(tls, (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    served.push(path);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404, headers).end();
    const body = readFileSync(file);
    res
      .writeHead(200, {
        ...headers,
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': String(body.length),
      })
      .end(body);
  });
}
const listen = async (s: Server) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  return `https://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
};

let appServer: Server, modelServer: Server, appOrigin: string, modelOrigin: string;
const modelServed: string[] = [];
before(async () => {
  if (SKIP) return;
  const tarball = packFresh(work);
  installClean(project, tarball, [`typescript@${repoVersion('typescript')}`]);
  cpSync(join(PKG, 'examples/caller-loaded'), project, { recursive: true });
  compiled = compileClean(project);
  appServer = staticServer(
    project,
    {
      // Cross-origin isolated, so the CPU route may use its bounded threads.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    },
    [],
  );
  modelServer = staticServer(
    RUNTIME!,
    { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' },
    modelServed,
  );
  appOrigin = await listen(appServer);
  modelOrigin = await listen(modelServer);
});
after(() => {
  appServer?.close();
  modelServer?.close();
});

type Page = {
  evaluate<T>(fn: (a: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
  on(e: 'console', fn: (m: { type(): string; text(): string }) => void): unknown;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o?: object): Promise<Context>; close(): Promise<void> };
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium',
  { launch(o: object): Promise<Browser> }
>;

/** Runs `body` in the page with window.demo in scope (a string, so it is the page's code, not this file's). */
const evaluate = <T>(page: Page, body: string, arg?: unknown) =>
  page.evaluate(
    ([b, a]: [string, unknown]) =>
      new Function('demo', 'arg', `return (async () => { ${b} })();`)(
        (window as unknown as { demo: unknown }).demo,
        a,
      ),
    [body, arg] as never,
  ) as Promise<T>;
/** evaluate(), bounded: past `ms` the demo's status and generator inspection are read and the step fails. */
async function inPage<T>(
  page: Page,
  body: string,
  arg?: unknown,
  ms = Number(process.env['CALLER_LOADED_STEP_MS'] ?? 300_000),
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void evaluate(
        page,
        'return { status: demo.status(), inspect: demo.generator()?.inspect() ?? null };',
      )
        .then((s) => reject(Error(`page step did not settle in ${ms} ms: ${JSON.stringify(s)}`)))
        .catch((e: unknown) =>
          reject(Error(`page step did not settle in ${ms} ms (${String(e)})`)),
        );
    }, ms);
  });
  try {
    return await Promise.race([evaluate<T>(page, body, arg), late]);
  } finally {
    clearTimeout(timer);
  }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const OTHER = ['app', 'third-party', 'collector', 'names-host', 'analytics'] as const;
const quiet = () => {};
/** Progress on stderr as it happens (node:test diagnostics print only at the end). */
const trace = (line: string) => process.stderr.write(`[caller-loaded] ${line}\n`);

function mark(rec: NetworkRecord, name: string) {
  trace(`step ${name}`);
  step(rec, name);
}

function inStep(rec: NetworkRecord, name: string) {
  return requestsIn(rec, { fromStep: name, toStep: name }, quiet).requests ?? [];
}

async function journey(
  t: { diagnostic(m: string): void },
  browser: Browser,
  route: 'cpu' | 'webgpu',
): Promise<void> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  t.diagnostic(`${route}: app ${appOrigin}, model host ${modelOrigin}`);
  const net = attachPlaywright(
    context as never,
    bindOrigins(DEFAULT_HOST_MAP, { app: [appOrigin], 'model-host': [modelOrigin] }),
  );
  const page = await context.newPage();
  const logs: string[] = [];
  page.on('console', (m) => {
    logs.push(m.text());
    if (m.type() === 'error' || !m.text().startsWith('{"event":"read"'))
      trace(`${route} console: ${m.text().slice(0, 300)}`);
  });
  mark(net.rec, 'page');
  await page.goto(`${appOrigin}/?runtime=${encodeURIComponent(`${modelOrigin}/`)}&route=${route}`);
  await page.waitForFunction(() => 'demo' in window);
  await net.settled();
  const served0 = modelServed.length;

  // Construction and status reads: a second demo constructed and read, the page's own read. Nothing may move.
  mark(net.rec, 'construct');
  const status = await inPage<{ threads: number; supportedRoutes: string[]; reads: number }>(
    page,
    `const { createCallerLoadedDemo } = await import('./out/caller-loaded.js');
     const d = createCallerLoadedDemo({ runtimeBase: arg, route: 'cpu' });
     const s1 = d.status(); const s2 = demo.status();
     return { ...s2, other: s1.reads };`,
    `${modelOrigin}/`,
  );
  await net.settled();
  assert.equal(
    inStep(net.rec, 'construct').length,
    0,
    'zero requests at construction and status reads',
  );
  assert.equal(modelServed.length, served0, 'the model host served nothing');
  assert.equal(status.reads, 0);
  t.diagnostic(`${route}: status ${JSON.stringify(status)}`);

  // A load from a wrong base: a typed error, not a throw.
  mark(net.rec, 'wrong-base');
  const wrong = await inPage<{ ok: boolean; error?: { code: string; cause?: string } }>(
    page,
    `const { createCallerLoadedDemo } = await import('./out/caller-loaded.js');
     const d = createCallerLoadedDemo({ runtimeBase: arg, route: 'cpu' });
     const r = await d.load(); await d.dispose(); return r;`,
    `${modelOrigin}/missing/`,
  );
  assert.equal(wrong.ok, false);
  assert.deepEqual(
    [wrong.error?.code, wrong.error?.cause],
    ['route-failed', 'cache-miss'],
    JSON.stringify(wrong),
  );

  // A load aborted as soon as the first model asset lands.
  mark(net.rec, 'load-abort');
  const aborted = await inPage<{ ok: boolean; error?: { code: string; cause?: string } }>(
    page,
    `const c = new AbortController();
     return demo.load({ signal: c.signal, onProgress: (p) => { if (p.phase === 'load' && p.detail) c.abort(); } });`,
  );
  assert.equal(aborted.ok, false, 'an aborted load does not load');
  assert.deepEqual(
    [aborted.error?.code, aborted.error?.cause],
    ['route-failed', 'aborted'],
    JSON.stringify(aborted),
  );

  // The real load: manifest, ORT runtime, generator, all seven admission canaries.
  mark(net.rec, 'load');
  const readsBefore = await inPage<number>(page, 'return demo.reads().length;');
  const load = await inPage<{
    ok: boolean;
    error?: unknown;
    report: {
      engine: string;
      provider: string;
      threads: number;
      loadMs: number;
      qualifyMs: number;
      receipt: {
        ran: number;
        checks: { name: string; maxRgb: number; maxFloat: number; passed: boolean }[];
      };
    };
  }>(page, 'return demo.load();');
  assert.ok(load.ok, JSON.stringify(load.error));
  const expected = route === 'cpu' ? ['ort-wasm', 'cpu'] : ['ort-webgpu', 'webgpu'];
  assert.deepEqual([load.report.engine, load.report.provider], expected);
  assert.equal(load.report.receipt.ran, 7, 'all seven canaries ran before the first face');
  for (const c of load.report.receipt.checks) {
    t.diagnostic(`${route} admission ${c.name}: maxRgb ${c.maxRgb}, maxFloat ${c.maxFloat}`);
    assert.ok(c.passed && c.maxRgb <= 1 && c.maxFloat <= 0.002, c.name);
  }

  // Seed A, seed B, the midpoint; then an aborted and an invalid operation.
  mark(net.rec, 'run');
  const run = await inPage<
    Record<string, { status: string; ms: number; value?: { sha256: string; provider: string } }>
  >(
    page,
    `const r = await demo.run({ seeds: ['7', '1234'] });
     const strip = (s) => s.status === 'completed' && s.value && 'rgba' in s.value
       ? { status: s.status, ms: s.ms, value: { sha256: s.value.sha256, provider: s.value.provider } }
       : { status: s.status, ms: s.ms };
     return { mapA: strip(r.mapA), faceA: strip(r.faceA), mapB: strip(r.mapB), faceB: strip(r.faceB), interpolated: strip(r.interpolated) };`,
  );
  for (const k of ['mapA', 'faceA', 'mapB', 'faceB', 'interpolated'])
    assert.equal(run[k]?.status, 'completed', `${k}: ${JSON.stringify(run[k])}`);
  const digests = ['faceA', 'faceB', 'interpolated'].map((k) => run[k]!.value!.sha256);
  assert.equal(new Set(digests).size, 3, 'three different faces');
  for (const k of ['faceA', 'faceB', 'interpolated'])
    assert.equal(run[k]!.value!.provider, expected[1]);
  t.diagnostic(
    `${route}: load ${Math.round(load.report.loadMs)} ms, qualify ${Math.round(load.report.qualifyMs)} ms, threads ${load.report.threads}, ` +
      Object.entries(run)
        .map(([k, v]) => `${k} ${Math.round(v.ms)} ms`)
        .join(', ') +
      `, faces ${digests.map((d) => d.slice(0, 12)).join('/')}`,
  );

  const ops = await inPage<{
    cancelled: string;
    preAborted: string;
    invalid: { status: string; error?: { code: string } };
    badSeed: { status: string; error?: { code: string } };
  }>(
    page,
    `const m = await demo.map('7');
     const c = new AbortController();
     const p = demo.synthesize(m.value, { signal: c.signal, slot: 'abort-me' });
     c.abort();
     const cancelled = (await p).status;
     const pre = new AbortController(); pre.abort();
     const preAborted = (await demo.map('8', pre.signal)).status;
     const invalid = await demo.synthesize({ space: 'w-plus', shape: [18, 512], values: new Float32Array(5) }, { slot: 'bad' });
     const badSeed = await demo.map('not a seed');
     return { cancelled, preAborted, invalid, badSeed };`,
  );
  assert.equal(ops.cancelled, 'cancelled', 'abort settles a running synthesis cancelled');
  assert.equal(ops.preAborted, 'cancelled');
  assert.deepEqual([ops.invalid.status, ops.invalid.error?.code], ['failed', 'invalid-request']);
  assert.deepEqual([ops.badSeed.status, ops.badSeed.error?.code], ['failed', 'invalid-request']);

  // Raw output against the runtime's references, compared here.
  mark(net.rec, 'references');
  const manifest = JSON.parse(readFileSync(join(RUNTIME!, 'manifest.json'), 'utf8')) as Manifest;
  const indices = new Uint32Array(bytesOf(manifest.sampleIndices.url).buffer);
  const ref = manifest.canaries.filter((c) => (c.noise ?? 'original') === 'original');
  assert.equal(ref.length, 5);
  for (const c of ref) {
    const w = bytesOf(c.w.url);
    const got = await inPage<{ status: string; rgba: string; sampled: number[] }>(
      page,
      `const w = Uint8Array.from(atob(arg.w), (ch) => ch.charCodeAt(0));
       const s = await demo.synthesize({ space: 'w-plus', shape: [18, 512], values: new Float32Array(w.buffer) }, { raw: true, slot: arg.name });
       if (s.status !== 'completed') return { status: s.status, rgba: '', sampled: [] };
       let bin = ''; const u = new Uint8Array(s.value.rgba.buffer);
       for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
       return { status: s.status, rgba: btoa(bin), sampled: arg.indices.map((i) => s.value.rawFloat[i]) };`,
      { w: b64(w), name: c.name, indices: Array.from(indices) },
    );
    assert.equal(got.status, 'completed', c.name);
    const actual = new Uint8Array(Buffer.from(got.rgba, 'base64'));
    const reference = (await controlPng.decodeReferencePng(bytesOf(c.reference.url))).rgba;
    assert.equal(actual.length, reference.length, `${c.name} size`);
    let maxRgb = 0;
    for (let i = 0; i < actual.length; i++)
      if (i % 4 !== 3) maxRgb = Math.max(maxRgb, Math.abs(actual[i]! - reference[i]!));
    const samples = new Float32Array(bytesOf(c.samples.url).buffer);
    assert.equal(samples.length, got.sampled.length);
    let maxFloat = 0;
    for (let i = 0; i < samples.length; i++)
      maxFloat = Math.max(maxFloat, Math.abs(got.sampled[i]! - samples[i]!));
    t.diagnostic(
      `${route} reference ${c.name}: maxRgb ${maxRgb}/255, maxFloat ${maxFloat.toExponential(3)} over ${samples.length} samples`,
    );
    assert.ok(maxRgb <= 1, `${c.name}: RGB ${maxRgb} > 1/255`);
    assert.ok(maxFloat <= 0.002, `${c.name}: raw float ${maxFloat} > 0.002`);
  }

  mark(net.rec, 'dispose');
  const inspect = await inPage<{ liveSessions: number; disposed: boolean } | null>(
    page,
    'return demo.dispose();',
  );
  assert.deepEqual(
    [inspect?.liveSessions, inspect?.disposed],
    [0, true],
    'dispose releases every session',
  );
  const statusAfter = await inPage<{ loaded: boolean }>(page, 'return demo.status();');
  assert.equal(statusAfter.loaded, false);
  await net.settled();

  // Every request after the page load: only model-host reads the example's reader made, from the page.
  const reads = await inPage<{ url: string }[]>(page, 'return demo.reads();');
  const logged = new Set(reads.map((r) => new URL(r.url).pathname));
  const byClass: Record<string, number> = {};
  for (const name of [
    'construct',
    'wrong-base',
    'load-abort',
    'load',
    'run',
    'references',
    'dispose',
  ]) {
    const rs = inStep(net.rec, name);
    for (const r of rs)
      byClass[`${name}:${r.hostClass}`] = (byClass[`${name}:${r.hostClass}`] ?? 0) + 1;
    for (const r of rs) {
      assert.ok(
        ['model-host', 'local'].includes(r.hostClass),
        `${name}: ${r.hostClass} request ${r.url}`,
      );
      if (r.hostClass === 'model-host' && name !== 'wrong-base')
        assert.ok(
          [...logged].some((p) => matchesTemplate(r.url, p)),
          `${name}: ${r.url} is not a read the caller made`,
        );
    }
  }
  for (const cls of OTHER)
    assert.equal(
      net.rec.requests.filter((r) => r.hostClass === cls && r.step > 0).length,
      0,
      `no ${cls} request after the page load`,
    );
  // The successful load's and the run's model requests are exactly the caller's logged reads (one each).
  const loadRun = ['load', 'run', 'references', 'dispose']
    .flatMap((n) => inStep(net.rec, n))
    .filter((r) => r.hostClass === 'model-host');
  assert.equal(loadRun.length, reads.length - readsBefore, 'one model request per caller read');
  assert.equal(inStep(net.rec, 'dispose').length, 0, 'dispose makes no request');
  const bytes = reads
    .slice(readsBefore)
    .reduce((n, r) => n + ((r as { bytes?: number }).bytes ?? 0), 0);
  t.diagnostic(
    `${route}: requests by step:class ${JSON.stringify(byClass)}; caller reads ${reads.length} (${readsBefore} before the real load), ` +
      `${(bytes / 1048576).toFixed(1)} MiB in the real load; model host served ${modelServed.length - served0}`,
  );
  t.diagnostic(
    `${route}: example log lines ${logs.filter((l) => l.startsWith('{"event"')).length}`,
  );
  await context.close();
}

/** A recorded URL is origin + path template (numeric segments ':n', long hex ':hex'); does it match `path`? */
function matchesTemplate(templated: string, path: string): boolean {
  const t = new URL(templated).pathname.split('/');
  const p = path.split('/');
  return (
    t.length === p.length &&
    t.every(
      (seg, i) =>
        seg === p[i] ||
        (seg === ':hex' && /^[0-9a-f]{16,}$/i.test(p[i]!)) ||
        (seg === ':n' && /^\d+$/.test(p[i]!)),
    )
  );
}

test(
  'the example compiles in the clean project against the packed declarations only',
  { skip: SKIP },
  () => {
    assert.ok(compiled);
    assert.equal(compiled.status, 0, compiled.output);
    assert.ok(compiled.declarations.length > 0);
    assert.deepEqual(compiled.sources, []);
    const js = readFileSync(join(project, 'out/caller-loaded.js'), 'utf8');
    assert.doesNotMatch(js, /browser-model-manager/, 'the example imports no manager');
  },
);

test(
  'caller-loaded example, CPU route in Playwright Chromium: references, abort, errors, requests by host class',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    assert.equal(compiled?.status, 0, 'compiled');
    const browser = await pw.chromium.launch({}).catch(() => null);
    if (!browser) return t.skip('untested: Playwright Chromium does not start here');
    t.after(() => browser.close());
    await journey(t, browser, 'cpu');
  },
);

const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium';
test(
  'caller-loaded example, WebGPU (ORT engine) in system Chromium with a hardware adapter',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    assert.equal(compiled?.status, 0, 'compiled');
    const browser = existsSync(CHROMIUM)
      ? await pw.chromium
          .launch({
            executablePath: CHROMIUM,
            headless: false,
            args: [
              '--enable-unsafe-webgpu',
              '--enable-features=Vulkan,WebGPU',
              '--use-angle=vulkan',
              '--ignore-gpu-blocklist',
            ],
          })
          .catch(() => null)
      : null;
    if (!browser) return t.skip(`untested: system Chromium does not start here (${CHROMIUM})`);
    t.after(() => browser.close());
    const probe = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await probe.goto(`${appOrigin}/`);
    const adapter = await probe.evaluate(async () => {
      const a = await (
        navigator as unknown as {
          gpu?: { requestAdapter(): Promise<{ info?: Record<string, unknown> } | null> };
        }
      ).gpu?.requestAdapter();
      return a
        ? {
            fallback: a.info?.['isFallbackAdapter'] === true,
            vendor: String(a.info?.['vendor'] ?? ''),
            description: String(a.info?.['description'] ?? ''),
          }
        : null;
    });
    if (
      !adapter ||
      adapter.fallback ||
      /swiftshader|llvmpipe/i.test(`${adapter.vendor} ${adapter.description}`)
    )
      return t.skip(`untested: no hardware WebGPU adapter here (${JSON.stringify(adapter)})`);
    t.diagnostic(`adapter ${adapter.vendor} ${adapter.description}`);
    await journey(t, browser, 'webgpu');
  },
);
