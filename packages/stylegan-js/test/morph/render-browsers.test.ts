// renderMorph's raw frames in a real browser against the control (fm-suaa), from the built packages (npm run build
// -w packages/stylegan-js -w packages/browser-model-manager). The workload is the 32-frame, 16 FPS, 1024 px morph: a
// closed two-face pairwise ellipse at width 0.7 between two shipped W+ latents, 16 frames per segment.
//
// Control: the app's latent-path-v1 module (apps/web/src/Next/geometry/latent-path.mjs) gives each frame's latent,
// and onnxruntime-web's WASM CPU backend in Node synthesizes it through the package's CPU adapter on the pinned
// runtime. Candidate: in Playwright Chromium the manager acquires the CPU assets, then renderMorph drives the
// package geometry and the browser's CPU generator on the raw-sparse-anchors branch (anchors retained first, then
// the ordered stream). Every frame must match the control at the frozen synthesis gate: max RGB difference 1
// (alpha excluded) and max sampled raw-float error 0.002.
//   FACEMORPH_MORPH_PARITY=1 python3 autoresearch/run.py -- node --test packages/stylegan-js/test/morph/render-browsers.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as onnx from 'onnxruntime-web';
import { loadCpuGenerator } from '../../src/engine/adapters/cpu.ts';
import type { GeneratorManifest } from '../../src/engine/adapters/generator.ts';
import type { OrtModule } from '../../src/engine/adapters/ort.ts';
import { toRgba8 } from '../../src/engine/identity.ts';
import { floats } from '../../src/engine/reader.ts';
import { acquiredManifest, RUNTIME, runtimeReader, UNTESTED } from '../engine/support/runtime.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'render-browsers-'));
after(() => rmSync(work, { recursive: true, force: true }));
const REF = join(work, 'ref');
const ROOTS: Record<string, string> = {
  '/stylegan/': join(REPO, 'packages/stylegan-js/dist/'),
  '/manager/': join(REPO, 'packages/browser-model-manager/dist/'),
  '/runtime/': RUNTIME + '/',
  '/ref/': REF + '/',
};
const BUILT =
  existsSync(join(ROOTS['/stylegan/']!, 'morph/render.js')) &&
  existsSync(join(ROOTS['/manager/']!, 'index.js'));
const runtime = acquiredManifest();
const ENDPOINTS = ['frame-00', 'trunc-psi-1'];
const SETTINGS = {
  kind: 'pairwise-ellipse',
  closed: true,
  pinchCenter: false,
  width: 0.7,
  framesPerSegment: 16,
  framesPerSecond: 16,
};

const PAGE = `<!doctype html><meta charset="utf-8"><title>render</title><script type="module">
import * as engine from '/stylegan/engine/index.js';
import { createLatentPath } from '/stylegan/morph/latent-path.js';
import { infillFrames } from '/stylegan/morph/infill.js';
import { renderMorph } from '/stylegan/morph/render.js';
import * as manager from '/manager/index.js';
const assetsOf = (v, out = []) => { if (!v || typeof v !== 'object') return out; if (typeof v.sha256 === 'string' && typeof v.url === 'string') { out.push(v); return out; } for (const x of Array.isArray(v) ? v : Object.values(v)) assetsOf(x, out); return out; };
const read = async (reader, asset) => { const r = await reader.read(asset); if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value; };
const get = async (f) => new Uint8Array(await (await fetch('/ref/' + f)).arrayBuffer());
window.harness = {
  async acquire(manifest) {
    const cache = await manager.createBrowserModelCache();
    const list = [...new Map(assetsOf([manifest.runtime, manifest.mapping, manifest.average, manifest.noise, manifest.sampleIndices, manifest.canaries, manifest.synthesis]).map((a) => [a.sha256, a])).values()];
    const grant = { manifestSha256: '', route: 'cpu', purpose: 'generate', owners: ['face:harness'], assets: list.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })), remainingBytes: 5 * list.reduce((n, a) => n + a.size, 0) };
    for (const a of list) await cache.acquire(a, { grant, owner: 'face:harness' });
    return list.length;
  },
  async run(manifest, manifestSha256, endpoints, settings) {
    const cache = await manager.createBrowserModelCache();
    const reader = cache.local;
    const host = engine.browserModuleHost();
    const threads = engine.cpuThreads({ sharedArrayBuffer: typeof SharedArrayBuffer === 'function', crossOriginIsolated: globalThis.crossOriginIsolated === true, hardwareConcurrency: navigator.hardwareConcurrency });
    let cpu = null;
    const g = await engine.loadCpuGenerator({ reader, manifest, manifestSha256, ort: async () => (cpu ??= await engine.loadOrtRuntime(reader, engine.cpuRuntimeAssets(manifest.runtime), host, threads)).ort });
    const indices = new Uint32Array((await read(reader, manifest.sampleIndices)).slice().buffer);
    const byName = Object.fromEntries(manifest.canaries.map((c) => [c.name, c]));
    const controls = [];
    for (const name of endpoints) controls.push({ visitId: name, latent: { space: 'w-plus', shape: [18, 512], values: new Float32Array((await read(reader, byName[name].w)).slice().buffer) } });
    const morph = { algorithmVersion: 'latent-path-v1', ...settings, controls };
    const path = createLatentPath(morph);
    const produce = async (l) => {
      const raw = await g.synthesizeRaw(l.values);
      return { rgba: engine.toRgba8(raw).buffer, samples: Float32Array.from(indices, (i) => raw[i]) };
    };
    const checks = new Map(), images = new Map();
    const compare = async (frame, index) => {
      const ref = new Uint8Array((await get('frame-' + index + '.rgba')).buffer), rgba = new Uint8Array(frame.rgba);
      let maxRgb = 0; for (let i = 0; i < rgba.length; i++) if (i % 4 !== 3) maxRgb = Math.max(maxRgb, Math.abs(rgba[i] - ref[i]));
      const refSamples = new Float32Array((await get('frame-' + index + '.samples.f32')).buffer);
      let maxFloat = 0; for (let i = 0; i < refSamples.length; i++) maxFloat = Math.max(maxFloat, Math.abs(frame.samples[i] - refSamples[i]));
      checks.set(index, { index, maxRgb, maxFloat });
      const image = { size: rgba.length, type: 'image/png', index };
      images.set(index, image);
      return 'display-' + index;
    };
    const written = [];
    const writer = {
      add: async (blob, index) => { written.push(index); },
      addRaw: async (frame, index) => { written.push(index); return compare(frame, index); },
      retainRaw: (frame, index) => compare(frame, index),
      retain: async (blob, index) => 'display-' + index,
      finish: async () => ({ size: written.length, type: 'video/mp4' }),
      dispose() {},
    };
    const store = { get: async () => null, getOne: async (_key, index) => images.get(index) ?? null };
    const source = {
      synthesize: (l) => produce(l),
      async synthesizeFrames(latents, options) { for (let at = 0; at < latents.length; at++) await options.onFrame(at, await produce(latents[at])); },
    };
    const started = performance.now();
    const out = await renderMorph({ path, canonical: () => infillFrames(path, morph), source, writer, store, framesKey: 'harness', branch: 'raw-sparse-anchors' });
    const ms = performance.now() - started;
    await g.dispose();
    return { status: out.status, branch: out.branch, frames: out.frames, totalFrames: path.totalFrames, written, checks: [...checks.values()].sort((a, b) => a.index - b.index), ms, threads };
  },
};
window.ready = true;
</script>`;

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
// About eleven minutes on eris (the 32 control frames in Node, then the browser run): opt in where it is affordable.
const SKIP =
  process.env['FACEMORPH_MORPH_PARITY'] !== '1'
    ? 'untested here: set FACEMORPH_MORPH_PARITY=1 to run the 32-frame control comparison'
    : !runtime
      ? UNTESTED
      : !BUILT
        ? 'untested: build the packages first (npm run build -w packages/stylegan-js -w packages/browser-model-manager)'
        : false;

before(async () => {
  if (SKIP) return;
  // The control frames: app geometry, Node ORT CPU through the package adapter.
  const manifest = runtime!.manifest as unknown as GeneratorManifest & {
    canaries: { name: string; w: { sha256: string; size: number; url: string } }[];
    sampleIndices: { sha256: string; size: number; url: string };
  };
  onnx.env.wasm.numThreads = 1;
  const reader = runtimeReader();
  const read = async (a: { sha256: string; size: number }) => {
    const r = await reader.read(a);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  };
  const g = await loadCpuGenerator({
    reader,
    manifest,
    manifestSha256: runtime!.sha256,
    ort: async () => onnx as unknown as OrtModule,
  });
  const indices = new Uint32Array((await read(manifest.sampleIndices)).slice().buffer);
  const controls = [];
  for (const name of ENDPOINTS) {
    const c = manifest.canaries.find((x) => x.name === name)!;
    controls.push({
      visitId: name,
      latent: {
        space: 'w-plus',
        shape: [18, 512],
        values: new Float32Array(floats(await read(c.w))),
      },
    });
  }
  const { createLatentPath } = (await import(
    join(REPO, 'apps/web/src/Next/geometry/latent-path.mjs')
  )) as {
    createLatentPath(m: unknown): {
      totalFrames: number;
      frames(): Iterable<{ index: number; values: ArrayLike<number> }>;
    };
  };
  const path = createLatentPath({ algorithmVersion: 'latent-path-v1', ...SETTINGS, controls });
  mkdirSync(REF, { recursive: true });
  for (const frame of path.frames()) {
    const raw = await g.synthesizeRaw(Float32Array.from(frame.values));
    writeFileSync(join(REF, `frame-${frame.index}.rgba`), toRgba8(raw));
    writeFileSync(
      join(REF, `frame-${frame.index}.samples.f32`),
      Float32Array.from(indices, (i) => raw[i]!),
    );
  }
  await g.dispose();

  const tls = {
    key: readFileSync(join(work, 'key.pem')),
    cert: readFileSync(join(work, 'cert.pem')),
  };
  server = createServer(tls, (req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const headers = {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    };
    if (p === '/') return res.writeHead(200, { ...headers, 'content-type': 'text/html' }).end(PAGE);
    const prefix = Object.keys(ROOTS).find((x) => p.startsWith(x));
    const root = prefix ? (ROOTS[prefix] as string) : '';
    const file = prefix ? normalize(join(root, p.slice(prefix.length))) : '';
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
  'chromium',
  { launch(o: object): Promise<Browser> }
>;
const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]: [string, unknown[]]) =>
      (window as unknown as { harness: Record<string, (...x: unknown[]) => T> }).harness[n]!(...a),
    [name, args] as never,
  );

test(
  'renderMorph raw frames in Chromium equal the control within RGB 1 / sampled float 0.002 (32 frames, 16 FPS, 1024 px)',
  { timeout: 1_800_000, skip: SKIP },
  async (t) => {
    const browser = await pw.chromium.launch({}).catch(() => null);
    if (!browser) return t.skip('untested: Playwright chromium does not start here');
    t.after(() => browser.close());
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
    const manifest = JSON.parse(
      readFileSync(join(RUNTIME, 'manifest.json'), 'utf8').replaceAll(
        'https://next.facemorph.me/runtime/',
        `${origin}/runtime/`,
      ),
    );
    await call(page, 'acquire', manifest);
    const out = await call<{
      status: string;
      branch: string;
      frames: number;
      totalFrames: number;
      written: number[];
      checks: { index: number; maxRgb: number; maxFloat: number }[];
      ms: number;
      threads: number;
    }>(page, 'run', manifest, runtime!.sha256, ENDPOINTS, SETTINGS);
    t.diagnostic(
      `chromium: ${out.status} ${out.branch} ${out.frames}/${out.totalFrames} frames in ${Math.round(out.ms)} ms (${out.threads} threads); max RGB ${Math.max(...out.checks.map((c) => c.maxRgb))}, max sampled float ${Math.max(...out.checks.map((c) => c.maxFloat)).toExponential(2)}`,
    );
    assert.deepEqual(
      [out.status, out.branch, out.totalFrames, out.frames],
      ['complete', 'raw-sparse-anchors', 32, 32],
    );
    assert.deepEqual(
      out.written,
      Array.from({ length: 32 }, (_, i) => i),
    );
    assert.equal(out.checks.length, 32, 'every frame compared');
    for (const c of out.checks) assert.ok(c.maxRgb <= 1 && c.maxFloat <= 0.002, JSON.stringify(c));
  },
);
