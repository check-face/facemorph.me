#!/usr/bin/env node
// Qualifies an onnxruntime-web release against the product's numerical canaries (fm-bxwv). Runs the candidate's own
// runtime (classic src/Next at the pinned commit, from Git objects) in eris's Chromium with the pinned runtime
// manifest, or with a variant whose six ORT entries (the WASM route's ort.wasm.min.mjs and threaded .mjs/.wasm,
// the selected WebGPU module, factory and wasm) point at a local onnxruntime-web dist, digests
// computed from the bytes. Every model file, canary input and reference stays pinned and comes from its manifest
// URL. Under Playwright the worker runs every canary (full qualification) at the fixed gates: RGB max <= 1,
// sampled float <= 0.002, unchanged.
//
// Routes: cpu (ORT WASM), webgpu-ort (ORT's selected build on the GPU: the engine phones use; on a desktop the runtime
// picks it for a mobile user agent, so this route presents one; the inference and GPU are real), webgpu (the
// desktop default, the direct WGSL engine: ORT is not on its path, a control).
//
//   node tools/ort-qualify/qualify.mjs --ort <onnxruntime-web package dir | pinned> [--routes cpu,webgpu-ort]
//        [--gpu-build webgpu|jspi|jsep] [--classic ../facemorph.me-classic] [--chromium /usr/bin/chromium] [--out <file>]
// Run with the bounded command runner. One JSON line per route, then a summary; exit 1 when any route fails.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED, prepareClassic } from '../names-generator/generate.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright');
const NAMES = fileURLToPath(new URL('../names-generator/', import.meta.url));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const WASM_FILES = [
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];
// The WebGPU route's module and factory. Up to 1.22 ort.webgpu.min.mjs used the JSEP build; from 1.23 it names the
// native WebGPU execution provider's asyncify build, and the JSEP build pairs with the general ort.min.mjs.
export const GPU_BUILDS = {
  jsep122: {
    module: 'ort.webgpu.min.mjs',
    factory: 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: 'ort-wasm-simd-threaded.jsep.wasm',
  },
  webgpu: {
    module: 'ort.webgpu.min.mjs',
    factory: 'ort-wasm-simd-threaded.asyncify.mjs',
    wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
  },
  jspi: {
    module: 'ort.jspi.min.mjs',
    factory: 'ort-wasm-simd-threaded.jspi.mjs',
    wasm: 'ort-wasm-simd-threaded.jspi.wasm',
  },
  jsep: {
    module: 'ort.min.mjs',
    factory: 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: 'ort-wasm-simd-threaded.jsep.wasm',
  },
};

/** The pinned manifest with its ORT entries replaced by the files in `dist`, served under `base`. */
export function withOrt(manifest, dist, base, version, gpuBuild = 'webgpu') {
  if (!Object.hasOwn(GPU_BUILDS, gpuBuild)) throw new Error(`unknown --gpu-build ${gpuBuild}`);
  const GPU_FILES = GPU_BUILDS[gpuBuild];
  const entry = (name) => {
    const bytes = readFileSync(join(dist, name));
    return { url: `${base}${name}`, sha256: sha256(bytes), size: bytes.length };
  };
  const m = structuredClone(manifest);
  m.runtime = {
    ...m.runtime,
    version,
    moduleUrl: `${base}${WASM_FILES[0]}`,
    wasmPaths: base,
    assets: WASM_FILES.map(entry),
  };
  m.webgpu = {
    ...m.webgpu,
    runtime: {
      ...m.webgpu.runtime,
      version,
      ...Object.fromEntries(Object.entries(GPU_FILES).map(([k, f]) => [k, entry(f)])),
    },
  };
  return m;
}

/** Bind a canary result to exact served manifests, local release bytes and the unchanged classic source. */
export function qualificationIdentity({
  controlBytes,
  candidateBytes,
  gpuBuild,
  packageBytes = null,
}) {
  if (!Object.hasOwn(GPU_BUILDS, gpuBuild)) throw new Error(`unknown --gpu-build ${gpuBuild}`);
  const control = JSON.parse(controlBytes.toString('utf8'));
  const candidate = JSON.parse(candidateBytes.toString('utf8'));
  let release;
  if (packageBytes !== null) {
    const pkg = JSON.parse(packageBytes.toString('utf8'));
    if (pkg.name !== 'onnxruntime-web' || typeof pkg.version !== 'string' || !pkg.version.trim())
      throw new Error('ORT release must identify the onnxruntime-web package and a version');
    if (
      candidate.runtime.version !== pkg.version ||
      candidate.webgpu.runtime.version !== pkg.version
    )
      throw new Error('candidate runtime versions differ from the supplied ORT release');
    release = { package: pkg.name, version: pkg.version, packageJsonSha256: sha256(packageBytes) };
  } else {
    if (!Buffer.from(controlBytes).equals(Buffer.from(candidateBytes)))
      throw new Error('a variant runtime requires the supplied ORT package identity');
    release = {
      package: 'onnxruntime-web',
      cpuVersion: control.runtime.version,
      webgpuVersion: control.webgpu.runtime.version,
    };
  }
  const assets = [
    ...candidate.runtime.assets,
    candidate.webgpu.runtime.module,
    candidate.webgpu.runtime.factory,
    candidate.webgpu.runtime.wasm,
  ].map((asset) => ({
    file: new URL(asset.url).pathname.split('/').at(-1),
    url: asset.url,
    sha256: asset.sha256,
    size: asset.size,
  }));
  return {
    schema: 'facemorph.ort-qualification/1',
    scope: 'pinned-classic-synthesis-canaries; not monorepo or encoder adoption',
    source: {
      classicCommit: PINNED.commit,
      classicManifestSha256: sha256(controlBytes),
      qualifierSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      harnessSha256: sha256(readFileSync(join(NAMES, 'harness.mjs'))),
    },
    controlManifestSha256: sha256(controlBytes),
    candidateManifestSha256: sha256(candidateBytes),
    release,
    gpuBuild,
    assets,
    runtimeSetSha256: sha256(
      JSON.stringify({
        release,
        gpuBuild,
        assets: assets.map(({ file, sha256, size }) => ({ file, sha256, size })),
      }),
    ),
  };
}

function serve(classicDir, manifest, dist) {
  const srcRoot = join(classicDir, 'src/Next');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null,
      body = null;
    if (path === '/names-generator.html') file = join(NAMES, 'harness.html');
    else if (path === '/harness.mjs') file = join(NAMES, 'harness.mjs');
    else if (path === '/runtime/manifest.json') body = manifest.bytes;
    else if (dist && path.startsWith('/ort/')) {
      const target = resolve(dist, `.${path.slice('/ort'.length)}`);
      if (target.startsWith(dist + sep) && existsSync(target)) file = target;
    } else if (path.startsWith('/src/Next/')) {
      const target = resolve(srcRoot, `.${path.slice('/src/Next'.length)}`);
      if (target.startsWith(srcRoot + sep) && existsSync(target) && statSync(target).isFile())
        file = target;
    }
    if (!file && !body) return res.writeHead(404).end();
    const type = { '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' };
    res
      .writeHead(200, {
        'content-type': body
          ? 'application/json'
          : (type[extname(file)] ?? 'application/octet-stream'),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin',
      })
      .end(body ?? readFileSync(file));
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({ server, origin: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

// The runtime acquires assets only over HTTPS, so the variant's ORT files come from a real local HTTPS server with
// a self-signed certificate made for this run (Chromium is told to accept it), cross-origin readable as a host
// serving runtime assets is. Requests are served, never intercepted.
function serveOrt(dist) {
  const dir = mkdtempSync(join(tmpdir(), 'ort-qualify-tls-'));
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
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const type = { '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
  const server = createHttpsServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (req, res) => {
      const target = resolve(
        dist,
        `.${decodeURIComponent(new URL(req.url, 'https://x').pathname)}`,
      );
      if (!target.startsWith(dist + sep) || !existsSync(target)) return res.writeHead(404).end();
      res
        .writeHead(200, {
          'content-type': type[extname(target)] ?? 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        })
        .end(readFileSync(target));
    },
  );
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({ server, base: `https://127.0.0.1:${server.address().port}/` }),
    ),
  );
}

async function qualifyRoute({ origin, route, chromiumPath }) {
  const gpu = route !== 'cpu';
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'ort-qualify-')),
    {
      executablePath: chromiumPath,
      headless: !gpu, // headless Chromium gets no WebGPU adapter on eris
      args: [
        ...(gpu
          ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
          : ['--disable-features=WebGPU']),
        '--ignore-certificate-errors', // the run's own self-signed ORT host (serveOrt)
      ],
      viewport: { width: 640, height: 480 },
      ignoreHTTPSErrors: true, // the run's own self-signed ORT host (serveOrt)
      ...(route === 'webgpu-ort' ? { userAgent: ANDROID_UA } : {}),
    },
  );
  const ortRequests = [];
  context.on('requestfinished', (r) => {
    if (/\/ort[.-]/.test(r.url())) ortRequests.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(0);
    await page.goto(`${origin}/names-generator.html`);
    await page.waitForFunction(() => window.harnessReady === true);
    const started = Date.now();
    const { admission, status } = await page.evaluate(
      (r) => window.setup(r),
      route === 'cpu' ? 'cpu' : 'webgpu',
    );
    const checks = admission?.checks ?? [];
    return {
      route,
      engine: status?.engine ?? status?.gpuEngine ?? null,
      provider: admission?.provider ?? null,
      canaries: checks.map((c) => ({
        name: c.name,
        passed: c.passed,
        maxRgb: c.maxRgb,
        maxFloat: c.maxFloat,
      })),
      ok: checks.length > 0 && checks.every((c) => c.passed === true),
      ms: Date.now() - started,
      ortFiles: [...new Set(ortRequests)],
    };
  } catch (e) {
    return { route, ok: false, error: String(e?.message ?? e).slice(0, 400) };
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (acc, x, i, all) => (x.startsWith('--') ? [...acc, [x.slice(2), all[i + 1]]] : acc),
        [],
      ),
  );
  const classic = prepareClassic(resolve(a.classic ?? join(REPO, '../facemorph.me-classic')));
  let manifest = classic.manifest,
    dist = null,
    packageBytes = null,
    version = `pinned (WASM ${manifest.runtime.version}, WebGPU ${manifest.webgpu.runtime.version})`;
  const controlBytes = readFileSync(
    join(classic.dir, 'hosting/next-static/runtime-overlay/manifest.json'),
  );
  if (a.ort && a.ort !== 'pinned') {
    dist = resolve(a.ort, 'dist');
    packageBytes = readFileSync(resolve(a.ort, 'package.json'));
    version = JSON.parse(packageBytes.toString('utf8')).version;
  }
  const gpuBuild = dist ? (a['gpu-build'] ?? 'webgpu') : 'jsep122';
  const served = { bytes: Buffer.alloc(0) };
  const { server, origin } = await serve(classic.dir, served, null);
  const ortHost = dist ? await serveOrt(dist) : null;
  if (dist) manifest = withOrt(manifest, dist, ortHost.base, version, gpuBuild);
  // The pinned run serves the manifest's own bytes (its digest is the pinned one); the variant is a new manifest.
  served.bytes = dist ? Buffer.from(JSON.stringify(manifest)) : controlBytes;
  const provenance = qualificationIdentity({
    controlBytes,
    candidateBytes: served.bytes,
    gpuBuild,
    packageBytes,
  });
  const results = [];
  for (const route of (a.routes ?? 'cpu,webgpu-ort').split(',')) {
    const r = await qualifyRoute({
      origin,
      route,
      chromiumPath: a.chromium ?? '/usr/bin/chromium',
    });
    const result = { ort: version, provenance, ...r };
    console.log(JSON.stringify(result));
    results.push(result);
  }
  server.close();
  ortHost?.server.close();
  const summary = {
    ort: version,
    provenance,
    routes: results.length,
    failed: results.filter((r) => !r.ok).map((r) => r.route),
  };
  console.log(JSON.stringify({ summary }));
  if (a.out) writeFileSync(a.out, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  process.exit(summary.failed.length ? 1 : 0);
}
