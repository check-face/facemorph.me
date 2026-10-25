#!/usr/bin/env node
// Catalogue result generator (bead fm-a40f): a canonical recovery-bearing WebP for every catalogue name,
// produced by the pinned candidate runtime in Chromium through the same text resolver typed input uses.
//
//   node generate.mjs --catalogue=<catalogue.json> --latents=<restored snapshot dir> [--out=<dir>]
//                     [--route=cpu|webgpu] [--reference-route=webgpu|cpu] [--reference=all|none|<n>]
//                     [--names=a,b] [--limit=<n>] [--classic=<path>] [--chromium=<path>] [--cache=<dir>]
// --latents is a names-snapshot restore of the name-catalogue latents (scripts/names-snapshot/restore.mjs),
// so the published reference latents come from the snapshot, never from the hosted API.
//
// Run it with the bounded command runner, e.g.
//   python3 autoresearch/run.py --timeout 3600 -- node tools/names-generator/generate.mjs ...
// The producer is the CPU route by default (deterministic, the typed-name path every device can run); the
// WebGPU route (direct WGSL engine) is the independent synthesis reference.
// Resumable: a row already in manifest.jsonl for this result set, with passing checks and its file intact,
// is never regenerated, so a killed or timed-out run continues where it stopped.
//
// Per row: the W+ inside the written WebP (read back with the candidate's own envelope reader) is
// byte-identical to the typed-name path's output under the catalogue's generation identity; that W+ is
// within LATENT_TOLERANCE of the published latent (independent NumPy Z, pinned CPU mapping); with a
// reference, the reference route's RGBA8 for the same W+ is within MAX_RGB_DIFF of the producer's
// lossless output. Every browser request is recorded by host; any request
// to api.facemorph.me or checkface.facemorph.me fails the run. Exit codes: 0 every row valid, 1 some row
// failed or an API request was seen, 2 usage.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  sha256,
  catalogueRows,
  resultSet,
  resultPath,
  parseManifest,
  headerLine,
  rowLine,
  plan,
  latentCheck,
  referenceLatentCheck,
  synthesisCheck,
  referenceRows,
  isApiHost,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PINNED = {
  commit: 'a42829bb0582b5a7a55ba6b1045a05861612b8a5',
  manifestSha256: 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c',
};
const DEFAULT_CACHE = join(homedir(), '.cache', 'facemorph-names-generator');

// classic's src/Next and runtime manifest at the pinned commit, from Git objects (never classic's checkout).
export function prepareClassic(classic, commit = PINNED.commit, cache = DEFAULT_CACHE) {
  const dir = join(cache, `classic-${commit.slice(0, 12)}`);
  if (!existsSync(join(dir, '.complete'))) {
    mkdirSync(dir, { recursive: true });
    const tar = execFileSync(
      'git',
      [
        '--no-optional-locks',
        '-C',
        classic,
        'archive',
        commit,
        'src/Next',
        'hosting/next-static/runtime-overlay/manifest.json',
      ],
      { maxBuffer: 512 * 1024 * 1024 },
    );
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    writeFileSync(join(dir, '.complete'), commit);
  }
  const manifestBytes = readFileSync(
    join(dir, 'hosting/next-static/runtime-overlay/manifest.json'),
  );
  if (sha256(manifestBytes) !== PINNED.manifestSha256)
    throw new Error('pinned runtime manifest digest mismatch');
  return { dir, manifest: JSON.parse(manifestBytes), manifestSha256: sha256(manifestBytes) };
}

const TYPES = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

// Same-origin, cross-origin-isolated server for the harness, the candidate modules and the manifest.
export function serve(classicDir) {
  const routes = [
    ['/names-generator.html', () => join(here, 'harness.html')],
    ['/harness.mjs', () => join(here, 'harness.mjs')],
    [
      '/runtime/manifest.json',
      () => join(classicDir, 'hosting/next-static/runtime-overlay/manifest.json'),
    ],
  ];
  const srcRoot = join(classicDir, 'src/Next');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = routes.find(([p]) => p === path)?.[1]();
    if (!file && path.startsWith('/src/Next/')) {
      const target = resolve(srcRoot, `.${path.slice('/src/Next'.length)}`);
      if (target.startsWith(srcRoot + sep) && existsSync(target) && statSync(target).isFile())
        file = target;
    }
    if (!file) return res.writeHead(404).end();
    res
      .writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin',
      })
      .end(readFileSync(file));
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({ server, origin: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

// Every request a browser context makes, by host, with transferred bytes.
export function recordRequests(context, hosts) {
  context.on('requestfinished', async (req) => {
    const host = new URL(req.url()).host || '(none)';
    const h = (hosts[host] ??= { requests: 0, bytes: 0 });
    h.requests++;
    try {
      const s = await req.sizes();
      h.bytes +=
        s.requestBodySize + s.requestHeadersSize + s.responseBodySize + s.responseHeadersSize;
    } catch {
      /* closed */
    }
  });
  context.on('requestfailed', (req) => {
    const host = new URL(req.url()).host || '(none)';
    (hosts[host] ??= { requests: 0, bytes: 0 }).requests++;
  });
}

export async function openHarness(pw, { origin, route, chromium, profile, hosts }) {
  const gpu = route === 'webgpu';
  // Headless on every route: no window on the shared desktop. On eris WebGPU reaches the NVIDIA card through
  // Vulkan via ANGLE (autoresearch/devices/eris/launch-chromium.sh); the adapter only appears once the GPU
  // process has started, so the GPU route waits for it below before the runtime qualifies its route.
  const args = gpu
    ? [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--enable-features=Vulkan',
        '--use-angle=vulkan',
        '--use-gl=angle',
        '--disable-vulkan-surface',
      ]
    : ['--disable-features=WebGPU'];
  const context = await pw.chromium.launchPersistentContext(profile, {
    executablePath: chromium,
    headless: true,
    args,
    viewport: { width: 640, height: 480 },
  });
  recordRequests(context, hosts);
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(0);
  await page.goto(`${origin}/names-generator.html`);
  await page.waitForFunction(() => window.harnessReady === true);
  if (gpu) {
    const adapter = await page.evaluate(async () => {
      for (const end = performance.now() + 15000; ;) {
        const a = await navigator.gpu?.requestAdapter();
        if (a)
          return {
            vendor: a.info?.vendor,
            architecture: a.info?.architecture,
            fallback: Boolean(a.info?.isFallbackAdapter),
          };
        if (!navigator.gpu || performance.now() > end) return null;
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    // A software rasteriser is not a GPU reference.
    if (
      !adapter ||
      adapter.fallback ||
      /swiftshader|llvmpipe|lavapipe/i.test(`${adapter.vendor} ${adapter.architecture}`)
    )
      throw new Error(
        `no hardware WebGPU adapter for the ${route} route: ${JSON.stringify(adapter)}`,
      );
  }
  const setup = await page.evaluate((r) => window.setup(r), route);
  return { context, page, setup };
}

export async function main(argv) {
  const a = Object.fromEntries(
    argv
      .map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2))
      .map(([k, v]) => [k, v ?? true]),
  );
  if (!a.catalogue || !a.latents) {
    console.error(
      'usage: generate.mjs --catalogue=<catalogue.json> --latents=<restored snapshot dir> [--out=] [--route=cpu|webgpu] [--reference-route=webgpu|cpu] [--reference=all|none|<n>] [--names=a,b] [--limit=n]',
    );
    return 2;
  }
  const log = (o) => console.log(JSON.stringify(o));
  // Cache: pinned classic tree and the browser profiles (one Chromium per profile, so concurrent runs
  // such as CI and a full run each need their own).
  const CACHE = resolve(a.cache ?? DEFAULT_CACHE);
  const out = resolve(a.out ?? join(CACHE, 'out'));
  const route = a.route ?? 'cpu';
  const referenceRoute = a['reference-route'] ?? (route === 'cpu' ? 'webgpu' : 'cpu');
  const latentFile = (id) =>
    join(resolve(a.latents), 'facemorph-name-catalogue.cdilga.workers.dev', 'latent', `${id}.f32`);
  const classic = prepareClassic(
    resolve(a.classic ?? join(here, '../../../facemorph.me-classic')),
    PINNED.commit,
    CACHE,
  );
  const { recoverEnvelope } = await import(
    pathToFileURL(join(classic.dir, 'src/Next/image-envelope.mjs')).href
  );

  let rows = catalogueRows(JSON.parse(readFileSync(resolve(a.catalogue), 'utf8')));
  const generationSha256 = [...new Set(rows.map((r) => r.generationSha256))];
  const modelSha256 = [...new Set(rows.map((r) => r.modelSha256))];
  if (
    generationSha256.length !== 1 ||
    modelSha256.length !== 1 ||
    modelSha256[0] !== classic.manifest.modelSourceSha256
  )
    throw new Error('catalogue latents do not share the pinned model and generation identity');
  const set = resultSet({
    manifestSha256: classic.manifestSha256,
    modelSha256: modelSha256[0],
    generationSha256: generationSha256[0],
  });
  const refSet = referenceRows(rows, a.reference ?? 'all');
  if (a.names) {
    const want = new Set(String(a.names).split(','));
    rows = rows.filter((r) => want.has(r.value));
  }
  if (a.limit) rows = rows.slice(0, Number(a.limit));

  mkdirSync(join(out, 'results', set.set), { recursive: true });
  const manifestPath = join(out, 'manifest.jsonl');
  if (!existsSync(manifestPath))
    writeFileSync(manifestPath, headerLine(set, { classicCommit: PINNED.commit }));
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const fileDigests = {};
  for (const r of manifest.rows.values())
    if (existsSync(join(out, r.file)))
      fileDigests[r.file] = sha256(readFileSync(join(out, r.file)));
  const work = plan(rows, manifest, set, fileDigests);
  log({
    event: 'plan',
    rows: rows.length,
    reuse: work.reuse.length,
    generate: work.generate.length,
    set: set.set,
    route,
  });

  const hosts = {};
  const failures = [];
  let generated = 0;
  if (work.generate.length) {
    const pw = await import('playwright');
    const { server, origin } = await serve(classic.dir);
    const chromium =
      a.chromium ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    const producer = await openHarness(pw, {
      origin,
      route,
      chromium,
      profile: join(CACHE, `profile-${route}`),
      hosts,
    });
    log({ event: 'producer', route, setup: producer.setup.status });
    const needRef = work.generate.some((r) => refSet.has(r.id));
    const reference = needRef
      ? await openHarness(pw, {
          origin,
          route: referenceRoute,
          chromium,
          profile: join(CACHE, `profile-reference-${referenceRoute}`),
          hosts,
        })
      : null;
    if (reference)
      log({ event: 'reference', route: referenceRoute, setup: reference.setup.status });
    try {
      for (const r of work.generate) {
        const started = Date.now();
        try {
          const withRef = refSet.has(r.id);
          const res = await producer.page.evaluate(
            ([v, w]) => window.generateName(v, { withPng: w }),
            [r.value, withRef],
          );
          const webp = Buffer.from(res.webp, 'base64');
          const env = await recoverEnvelope(new Blob([webp], { type: 'image/webp' }));
          const envelopeOk =
            env &&
            !env.legacy &&
            env.generationSha256 === r.generationSha256 &&
            env.provenance?.modelSha256 === classic.manifest.modelSourceSha256;
          const published = existsSync(latentFile(r.id)) ? readFileSync(latentFile(r.id)) : null;
          const publishedOk = published && sha256(published) === r.latentSha256;
          const produced = Buffer.from(res.latent, 'base64');
          const cmp = withRef
            ? await reference.page.evaluate(
                ([l, p]) => window.reference(l, p),
                [res.latent, res.png],
              )
            : null;
          const file = resultPath(set.set, r.id);
          const row = {
            id: r.id,
            value: r.value,
            name: r.name,
            resultSet: set.digest,
            file,
            bytes: webp.length,
            fileSha256: sha256(webp),
            imageSha256: env?.imageSha256 ?? null,
            latentSha256: res.latentSha256,
            latentCheck: latentCheck(
              {
                producedSha256: sha256(produced),
                envelopeSha256: envelopeOk ? env.latentSha256 : null,
                generationSha256: res.generationSha256,
              },
              r,
            ),
            referenceLatent: publishedOk
              ? referenceLatentCheck(
                  new Float32Array(produced.buffer, produced.byteOffset, produced.length / 4),
                  new Float32Array(published.buffer, published.byteOffset, published.length / 4),
                )
              : {
                  status: 'fail',
                  maxAbsDiff: null,
                  reason: published ? 'snapshot latent digest mismatch' : 'snapshot latent missing',
                },
            envelopeCheck: envelopeOk ? 'pass' : 'fail',
            synthesisCheck: synthesisCheck(cmp),
            mappingProvider: res.provenance?.mappingProvider ?? null,
            route: res.provenance?.route ?? route,
            sourceType: res.sourceType,
            ms: Date.now() - started,
            generatedAt: new Date().toISOString(),
          };
          if (
            row.latentCheck === 'exact' &&
            row.referenceLatent.status === 'pass' &&
            row.synthesisCheck.status !== 'fail'
          ) {
            writeFileSync(join(out, `${file}.tmp`), webp);
            renameSync(join(out, `${file}.tmp`), join(out, file));
          } else
            failures.push({
              id: r.id,
              value: r.value,
              latentCheck: row.latentCheck,
              referenceLatent: row.referenceLatent,
              synthesis: row.synthesisCheck.status,
            });
          appendFileSync(manifestPath, rowLine(row));
          generated++;
          if (generated % 25 === 0 || generated === work.generate.length)
            log({
              event: 'progress',
              generated,
              of: work.generate.length,
              lastMs: row.ms,
              failures: failures.length,
            });
        } catch (e) {
          failures.push({ id: r.id, value: r.value, error: e.message.slice(0, 300) });
          log({ event: 'row-error', value: r.value, error: e.message.slice(0, 300) });
        }
      }
    } finally {
      await producer.context.close();
      await reference?.context.close();
      server.close();
    }
  }

  const final = parseManifest(readFileSync(manifestPath, 'utf8'));
  const current = rows
    .map((r) => final.rows.get(r.id))
    .filter(
      (x) =>
        x &&
        x.resultSet === set.digest &&
        x.latentCheck === 'exact' &&
        x.referenceLatent?.status === 'pass' &&
        x.synthesisCheck?.status !== 'fail',
    );
  const sizes = current.map((x) => x.bytes).sort((x, y) => x - y);
  const apiRequests = Object.entries(hosts).filter(([h]) => isApiHost(h.split(':')[0]));
  const summary = {
    event: 'summary',
    set: set.set,
    rows: rows.length,
    valid: current.length,
    reused: work.reuse.length,
    generated,
    failures: failures.length,
    synthesisChecked: current.filter((x) => x.synthesisCheck?.status === 'pass').length,
    maxRgbDiff: Math.max(0, ...current.map((x) => x.synthesisCheck?.maxRgbDiff ?? 0)),
    maxLatentDiff: Math.max(0, ...current.map((x) => x.referenceLatent?.maxAbsDiff ?? 0)),
    bytes: sizes.reduce((t, b) => t + b, 0),
    medianBytes: sizes[Math.floor(sizes.length / 2)] ?? 0,
    maxBytes: sizes.at(-1) ?? 0,
    hosts,
    apiRequests: apiRequests.length,
  };
  log(summary);
  writeFileSync(
    join(out, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    `${JSON.stringify({ ...summary, failureRows: failures }, null, 1)}\n`,
  );
  return failures.length || apiRequests.length || current.length !== rows.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
