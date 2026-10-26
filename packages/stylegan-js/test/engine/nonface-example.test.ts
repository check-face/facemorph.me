// The non-face example (examples/non-face, fm-tohj) from the packed tarballs in real Chromium on the CPU.
//
// @facemorph/stylegan-js and @facemorph/browser-model-manager are built fresh from their sources and `npm pack`ed
// (test/support/packed.ts, packed-manager.ts), both tarballs are installed into a clean project in os.tmpdir()
// (outside the monorepo), the example is compiled there by tsc against the emitted .d.ts only, and its index.html is
// served as-is over HTTPS with COOP/COEP (an import map onto node_modules; no bundler). The converted AFHQ cat model
// (packages/model-conv/out/afhqcat, FACEMORPH_AFHQ_CAT; gitignored) and the acquired CPU runtime
// (test/engine/support/runtime.ts) are served from a second origin, the model host.
//
// Both variants run in Playwright Chromium, each in a fresh context: manager-loaded (the manager acquires and
// verifies the AFHQ assets and the CPU runtime under one grant; the engine reads its verified local reader) and
// caller-loaded (the caller's own verifying reader; no manager module requested). Each loads AFHQ cat on the CPU,
// maps seeds 0 and 1, synthesizes them, renders a five-frame morph with renderMorph, exports seed 0 as PNG and
// lossless WebP with recovery metadata and reopens both. Checked here: the example's own report (exact endpoints,
// exact reopen of latent, model identity and pixels); both seeds' W+ and raw output against the upstream reference
// at AFHQ cat's declared tolerance; zero requests of any class at construction and status reads; zero requests
// during generation for the manager-loaded variant; and across the whole run no request naming a face detector,
// the FFHQ e4e encoder, its streamed shards or any photo-pipeline asset. Absent the converted model, its reference
// or the pinned runtime, it reports untested.
//   node --test packages/stylegan-js/test/engine/nonface-example.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import {
  bindOrigins,
  requestsIn,
  step,
  type NetworkRecord,
} from '../../../../scripts/ci/intercept/record.ts';
import { packManagerFresh } from '../support/packed-manager.ts';
import {
  compileClean,
  installClean,
  PKG,
  packFresh,
  REPO,
  repoVersion,
} from '../support/packed.ts';
import { acquiredManifest, RUNTIME, UNTESTED } from './support/runtime.ts';

const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
const REFERENCE = JSON.parse(
  readFileSync(new URL('../vectors/afhq-cat-512/reference.json', import.meta.url), 'utf8'),
) as {
  tolerance: { rawFloat: number; rgb: number };
  cases: { seed: number; w: { file: string }; raw: { file: string } }[];
  converted: { manifestSha256: string };
};
const sha256File = (p: string) =>
  execFileSync('sha256sum', [p], { encoding: 'utf8' }).split(' ')[0] ?? '';
const runtime = acquiredManifest();
const HAVE_MODEL =
  existsSync(join(MODEL, 'manifest.json')) &&
  REFERENCE.cases.every(
    (c) =>
      existsSync(join(MODEL, 'reference', c.w.file)) &&
      existsSync(join(MODEL, 'reference', c.raw.file)),
  );
const SKIP = !runtime
  ? UNTESTED
  : !HAVE_MODEL
    ? `untested: the converted AFHQ cat model and its reference are not at ${MODEL}`
    : sha256File(join(MODEL, 'manifest.json')) !== REFERENCE.converted.manifestSha256
      ? `untested: ${MODEL}/manifest.json is not the converted model the reference names`
      : false;

const work = mkdtempSync(join(tmpdir(), 'stylegan-js-nonface-example-'));
after(() => rmSync(work, { recursive: true, force: true }));
const project = join(work, 'consumer');
let compiled: ReturnType<typeof compileClean> | null = null;
const timings: Record<string, number> = {};

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
/** A static HTTPS server over `roots` (path prefix to directory); `served` logs every path it was asked for. */
function staticServer(
  roots: Record<string, string>,
  headers: Record<string, string>,
  served: string[],
) {
  return createServer(tls, (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    served.push(path);
    const prefix = Object.keys(roots)
      .sort((a, b) => b.length - a.length)
      .find((p) => path.startsWith(p));
    const root = prefix === undefined ? '' : roots[prefix]!;
    const rest = prefix === undefined ? '' : path.slice(prefix.length);
    const file = normalize(join(root, rest === '' ? 'index.html' : rest));
    if (!prefix || !file.startsWith(root) || !existsSync(file))
      return res.writeHead(404, headers).end();
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
const appServed: string[] = [];
const modelServed: string[] = [];
before(async () => {
  if (SKIP) return;
  let t = performance.now();
  const stylegan = packFresh(work);
  const manager = packManagerFresh(work);
  timings['pack'] = performance.now() - t;
  t = performance.now();
  installClean(project, stylegan, [manager, `typescript@${repoVersion('typescript')}`]);
  timings['install'] = performance.now() - t;
  cpSync(join(PKG, 'examples/non-face'), project, { recursive: true });
  t = performance.now();
  compiled = compileClean(project);
  timings['compile'] = performance.now() - t;
  appServer = staticServer(
    { '/': project + '/' },
    {
      // Cross-origin isolated, so the CPU route may use its bounded threads.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    },
    appServed,
  );
  modelServer = staticServer(
    { '/afhq/': MODEL + '/', '/runtime/': RUNTIME + '/' },
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

/** Every digest of the photo pipeline in the runtime manifest: detector, e4e encoder and chunks, the stream. */
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
  if (existsSync(stream))
    for (const dir of readdirSync(stream)) {
      out.add(dir);
      const s = join(stream, dir, 'manifest.json');
      if (existsSync(s)) walk(JSON.parse(readFileSync(s, 'utf8')));
    }
  return out;
}

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

/** Runs `body` in the page with window.nonface in scope (a string, so it is the page's code, not this file's). */
const inPage = <T>(page: Page, body: string, arg?: unknown) =>
  page.evaluate(
    ([b, a]: [string, unknown]) =>
      new Function('example', 'arg', `return (async () => { ${b} })();`)(
        (window as unknown as { nonface: unknown }).nonface,
        a,
      ),
    [body, arg] as never,
  ) as Promise<T>;

const trace = (line: string) => process.stderr.write(`[nonface-example] ${line}\n`);
const inStep = (rec: NetworkRecord, name: string) =>
  requestsIn(rec, { fromStep: name, toStep: name }, () => {}).requests ?? [];

interface RunReport {
  ok: boolean;
  provider: string;
  threads: number;
  faces: {
    seed: number;
    width: number;
    height: number;
    sha256: string;
    mapMs: number;
    synthesizeMs: number;
  }[];
  morph: {
    status: string;
    branch: string | null;
    totalFrames: number;
    written: number;
    frames: { index: number; visitId: string | null; sha256: string }[];
    endpoints: { index: number; seed: number; latentExact: boolean; maxRgb: number }[];
    ms: number;
  };
  exports: {
    mime: string;
    bytes: number;
    kind: string;
    schemaVersion: number | null;
    seed: number | null;
    latentExact: boolean;
    modelExact: boolean;
    provenanceExact: boolean;
    pixelsExact: boolean;
    maxRgb: number;
    ms: number;
  }[];
  reads: number;
  ms: number;
  error?: unknown;
}

async function journey(
  t: { diagnostic(m: string): void },
  browser: Browser,
  variant: 'manager' | 'caller',
): Promise<void> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const net = attachPlaywright(
    context as never,
    bindOrigins(DEFAULT_HOST_MAP, { app: [appOrigin], 'model-host': [modelOrigin] }),
  );
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') trace(`${variant} console error: ${m.text().slice(0, 300)}`);
  });
  const app0 = appServed.length;
  const model0 = modelServed.length;
  const module = variant === 'manager' ? 'manager-loaded' : 'caller-loaded';

  step(net.rec, 'page');
  const q = new URLSearchParams({
    variant,
    model: `${modelOrigin}/afhq/`,
    runtime: `${modelOrigin}/runtime/`,
  });
  await page.goto(`${appOrigin}/?${q}`);
  await page.waitForFunction(() => 'nonface' in window);
  await net.settled();

  // Construction and status reads: a second example constructed and both read. Nothing may move.
  step(net.rec, 'construct');
  const servedBefore = [appServed.length, modelServed.length];
  const status = await inPage<{ subject: string; photoEncoder: boolean; reads: number }>(
    page,
    `const m = await import('./out/${module}.js');
     const other = m.${variant === 'manager' ? 'createManagerLoadedExample' : 'createCallerLoadedExample'}({ modelBase: arg, runtimeBase: arg });
     other.status();
     return example.status();`,
    `${modelOrigin}/afhq/`,
  );
  await net.settled();
  assert.deepEqual(inStep(net.rec, 'construct'), [], 'zero requests at construction and status');
  assert.deepEqual([appServed.length, modelServed.length], servedBefore, 'neither host served');
  assert.deepEqual([status.subject, status.photoEncoder, status.reads], ['non-face', false, 0]);

  step(net.rec, 'load');
  const load = await inPage<{
    ok: boolean;
    error?: unknown;
    provider: string;
    threads: number;
    prepareMs: number;
    loadMs: number;
    assets: number;
  }>(page, 'return example.load();');
  assert.ok(load.ok, JSON.stringify(load.error));
  assert.equal(load.provider, 'cpu');
  await net.settled();
  const loadRequests = inStep(net.rec, 'load');

  step(net.rec, 'run');
  const run = await inPage<RunReport>(page, 'return example.run();');
  await net.settled();
  assert.ok(run.ok, JSON.stringify(run).slice(0, 4000));
  const runRequests = inStep(net.rec, 'run');
  for (const r of runRequests)
    assert.ok(['model-host', 'local'].includes(r.hostClass), `run: ${r.hostClass} ${r.url}`);
  if (variant === 'manager')
    assert.deepEqual(
      runRequests.filter((r) => r.hostClass !== 'local').map((r) => r.url),
      [],
      'the manager-loaded engine reads only local verified bytes',
    );

  // The example's report: two 512 px faces, five frames whose endpoints are exactly the two faces, exact reopen.
  assert.deepEqual(
    run.faces.map((f) => [f.seed, f.width, f.height]),
    [
      [0, 512, 512],
      [1, 512, 512],
    ],
  );
  assert.notEqual(run.faces[0]!.sha256, run.faces[1]!.sha256, 'two different faces');
  assert.equal(run.morph.status, 'complete');
  assert.equal(run.morph.totalFrames, 5);
  assert.equal(run.morph.written, 5);
  assert.deepEqual(
    run.morph.frames.map((f) => f.index),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    [run.morph.frames[0]!.visitId, run.morph.frames[4]!.visitId],
    ['seed-0', 'seed-1'],
  );
  assert.deepEqual(
    [run.morph.frames[0]!.sha256, run.morph.frames[4]!.sha256],
    [run.faces[0]!.sha256, run.faces[1]!.sha256],
    'the morph endpoints are the two faces, byte for byte',
  );
  assert.equal(new Set(run.morph.frames.map((f) => f.sha256)).size, 5, 'five distinct frames');
  for (const e of run.morph.endpoints)
    assert.ok(e.latentExact && e.maxRgb === 0, JSON.stringify(e));
  assert.deepEqual(
    run.exports.map((e) => e.mime),
    ['image/png', 'image/webp'],
  );
  for (const e of run.exports)
    assert.deepEqual(
      [
        e.kind,
        e.schemaVersion,
        e.seed,
        e.latentExact,
        e.modelExact,
        e.provenanceExact,
        e.pixelsExact,
        e.maxRgb,
      ],
      ['parsed', 3, 0, true, true, true, true, 0],
      `${e.mime} reopens exactly`,
    );

  // Both seeds against the upstream reference, at AFHQ cat's own declared tolerance, compared in the page.
  step(net.rec, 'compare');
  for (const [i, c] of REFERENCE.cases.entries()) {
    const err = await inPage<{ w: number; raw: number; rgb: number }>(
      page,
      `const get = async (f) => new Float32Array(await (await fetch(arg.base + f)).arrayBuffer());
       const max = (a, b) => { if (a.length !== b.length) return Infinity; let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
       const face = example.tensors()[arg.i], rgba = example.images()[arg.i].rgba;
       const rw = await get(arg.w), rr = await get(arg.raw);
       const { toRgba8 } = await import('@facemorph/stylegan-js/engine');
       const expected = toRgba8(rr, 512, 512);
       let rgb = 0; for (let k = 0; k < expected.length; k++) rgb = Math.max(rgb, Math.abs(rgba[k] - expected[k]));
       return { w: max(face.w, rw), raw: max(face.raw, rr), rgb };`,
      { base: `${modelOrigin}/afhq/reference/`, i, w: c.w.file, raw: c.raw.file },
    );
    t.diagnostic(
      `${variant}: seed ${c.seed} W+ ${err.w.toExponential(2)}, raw ${err.raw.toExponential(2)}, RGB ${err.rgb} ` +
        `(tolerance raw ${REFERENCE.tolerance.rawFloat}, RGB ${REFERENCE.tolerance.rgb})`,
    );
    assert.equal(run.faces[i]!.seed, c.seed);
    assert.ok(
      err.w <= REFERENCE.tolerance.rawFloat &&
        err.raw <= REFERENCE.tolerance.rawFloat &&
        err.rgb <= REFERENCE.tolerance.rgb,
      `seed ${c.seed}: ${JSON.stringify(err)}`,
    );
  }

  step(net.rec, 'dispose');
  const inspect = await inPage<{ liveSessions: number } | null>(page, 'return example.dispose();');
  assert.equal(inspect?.liveSessions, 0, 'dispose releases every session');
  const reads = await inPage<string[]>(page, 'return example.reads();');
  await net.settled();

  // Across the whole run: nothing names the photo pipeline, by URL or by digest (the model host's own log has the
  // real paths; the record's are templated). The CPU runtime the generator reads is shared, not a photo asset.
  const forbidden = photoDigests(runtime!.manifest);
  const product = runtime!.manifest as { runtime: { assets: { sha256: string }[] } };
  for (const a of product.runtime.assets) forbidden.delete(a.sha256);
  assert.ok(forbidden.size > 0, 'photo-pipeline digests known');
  const urls = net.rec.requests.map((r) => r.url);
  const servedHere = [...appServed.slice(app0), ...modelServed.slice(model0)];
  const named = [...urls, ...servedHere].filter(
    (u) =>
      /encoder|landmark|detector|e4e|\/photo\//i.test(u) ||
      [...forbidden].some((s) => u.includes(s)),
  );
  assert.deepEqual(named, [], `${variant}: no detector or e4e request`);
  assert.ok(!reads.some((s) => forbidden.has(s)), 'no photo-pipeline asset read');
  if (variant === 'caller') {
    const manager = [...urls, ...appServed.slice(app0)].filter((u) =>
      u.includes('browser-model-manager'),
    );
    assert.deepEqual(manager, [], 'the caller-loaded page requests no manager module');
  }
  for (const cls of ['third-party', 'collector', 'names-host', 'analytics'] as const)
    assert.equal(
      net.rec.requests.filter((r) => r.hostClass === cls).length,
      0,
      `no ${cls} request`,
    );

  const count = (rs: { hostClass: string }[]) => {
    const by: Record<string, number> = {};
    for (const r of rs) by[r.hostClass] = (by[r.hostClass] ?? 0) + 1;
    return JSON.stringify(by);
  };
  t.diagnostic(
    `${variant}: load ${Math.round(load.prepareMs)} ms ${variant === 'manager' ? 'acquire' : 'manifests'} + ` +
      `${Math.round(load.loadMs)} ms engine load, ${load.threads} threads, ${load.assets} assets; ` +
      `faces ${run.faces.map((f) => `seed ${f.seed} map ${Math.round(f.mapMs)} ms synth ${Math.round(f.synthesizeMs)} ms`).join(', ')}; ` +
      `morph ${run.morph.branch} ${run.morph.totalFrames} frames ${Math.round(run.morph.ms)} ms; ` +
      `exports ${run.exports.map((e) => `${e.mime} ${e.bytes} B ${Math.round(e.ms)} ms`).join(', ')}; run ${Math.round(run.ms)} ms`,
  );
  t.diagnostic(
    `${variant}: requests construct 0, load ${count(loadRequests)}, run ${count(runRequests)}, total ${urls.length}; ` +
      `model host served ${modelServed.length - model0}; engine reads ${reads.length}; ` +
      `${forbidden.size} photo-pipeline digests checked, none requested or read`,
  );
  await context.close();
}

test(
  'the non-face example compiles in the clean project against the packed declarations only',
  { skip: SKIP },
  (t) => {
    assert.ok(compiled);
    assert.equal(compiled.status, 0, compiled.output);
    assert.ok(compiled.declarations.some((f) => f.includes('/@facemorph/browser-model-manager/')));
    assert.ok(compiled.declarations.some((f) => f.includes('/@facemorph/stylegan-js/')));
    assert.deepEqual(compiled.sources, []);
    for (const f of ['caller-loaded.js', 'nonface.js'])
      assert.doesNotMatch(
        readFileSync(join(project, 'out', f), 'utf8'),
        /browser-model-manager/,
        `${f} imports no manager`,
      );
    t.diagnostic(
      `pack ${Math.round(timings['pack'] ?? 0)} ms, install ${Math.round(timings['install'] ?? 0)} ms, ` +
        `compile ${Math.round(timings['compile'] ?? 0)} ms`,
    );
  },
);

for (const variant of ['manager', 'caller'] as const)
  test(
    `non-face example, ${variant}-loaded, CPU in Playwright Chromium: AFHQ cat seeds, renderMorph, PNG and lossless WebP reopen, no detector or e4e request`,
    { skip: SKIP, timeout: 1_800_000 },
    async (t) => {
      assert.equal(compiled?.status, 0, 'compiled');
      const browser = await pw.chromium.launch({}).catch(() => null);
      if (!browser) return t.skip('untested: Playwright Chromium does not start here');
      t.after(() => browser.close());
      const started = performance.now();
      await journey(t, browser, variant);
      t.diagnostic(`${variant}: journey ${Math.round(performance.now() - started)} ms`);
    },
  );
