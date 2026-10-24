#!/usr/bin/env node
// Names data-shape spike (fm-zg31, plan:names.spike). Measures, per alternative:
//   - first-paint bytes (names text + manifest, calibrated against the live candidate catalogue),
//   - per-pick bytes and requests (one result object plus the integrity lookup, if any),
//   - preview packaging: bytes, requests and scroll smoothness (long tasks, dropped frames, blank tiles)
//     during a scripted scroll at fixed viewports in a real browser over a local HTTP/2 server,
//   - asset count against the Workers Free limit.
// Inputs are real: the candidate catalogue (pinned SHA-256), its published 200 px previews, 1,024 px
// historic faces and W+ latents, fetched once into a cache. Nothing calls the hosted API.
//
//   node measure.mjs [--catalogue URL|PATH] [--cache DIR] [--out DIR] [--alternatives files,pack-24,...]
//                    [--viewports desktop,phone (opt-in scroll runs)] [--speeds 2400,6000] [--network 4g|none] [--repeats 3]
//                    [--browser chromium|firefox|webkit] [--executable PATH] [--skip-browser] [--preview-limit N]
// Firefox and WebKit have no network/CPU emulation or long-task entries here; those cells read "n/a".
import { parseArgs } from 'node:util';
import { createSecureServer } from 'node:http2';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc } from 'node:zlib';
import * as shapes from './shapes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The candidate's catalogue at reviewed commit b2d945a (facemorph.me-classic hosting/next-static/catalogue.json),
// served unchanged at next.facemorph.me while the candidate reads it.
export const PINNED_CATALOGUE = { url: 'https://next.facemorph.me/catalogue.json', sha256: '4a9e1c199e2a629f11cc5d016128b36efbcde301928ae2735c42e5025c13c341' };
const GALLERY = 'https://facemorph-seed-gallery.cdilga.workers.dev';
const NAME_ORIGIN = 'https://facemorph-name-catalogue.cdilga.workers.dev';
// The phone viewport runs on eris with Chromium's CPU throttling (a real browser feature) as a mid-range
// phone proxy; it is emulation, not phone evidence. Physical-phone scroll belongs to the picker's lab run.
const VIEWPORTS = {
  desktop: { context: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, cpuThrottle: 1 },
  phone: { context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, cpuThrottle: 4 },
};
// Chromium network emulation (a real browser feature, not a mock): Chrome DevTools-style "Fast 4G".
const NETWORKS = { none: null, '4g': { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } };

// Candidate runtime identity (classic hosting/next-static/runtime-overlay/manifest.json at b2d945a): only the
// envelope's size depends on these, and every field has a fixed length.
const CANDIDATE_RUNTIME = { bundleVersion: 'next-browser-cpu-v1', manifestSha256: 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c', noiseSha256: 'e76258b02e159f69788bd941c9cd087200647eeb9d38f022b756143ad7fcb191' };

const OPTIONS = {
  catalogue: { type: 'string', default: PINNED_CATALOGUE.url },
  'any-catalogue': { type: 'boolean', default: false },
  cache: { type: 'string', default: join(homedir(), '.cache', 'facemorph-names-spike') },
  out: { type: 'string', default: join(here, 'out', new Date().toISOString().replace(/[:.]/g, '-')) },
  alternatives: { type: 'string', default: 'files,pack-12,pack-24,pack-48,atlas-24' },
  viewports: { type: 'string', default: '' }, // scroll runs are opt-in: --viewports desktop,phone
  network: { type: 'string', default: '4g' },
  repeats: { type: 'string', default: '3' },
  browser: { type: 'string', default: 'chromium' },
  executable: { type: 'string' },
  shards: { type: 'string', default: '16,32,64,128,256' },
  speeds: { type: 'string', default: '2400,6000' }, // px/s: a steady browse and a fling
  duration: { type: 'string', default: '6000' },
  'atlas-quality': { type: 'string', default: '0.85' },
  'result-sample': { type: 'string', default: '12' },
  'preview-limit': { type: 'string' },
  'skip-browser': { type: 'boolean', default: false },
};

const log = (...a) => console.error('[names-spike]', ...a);

async function getBytes(url, { tries = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'facemorph-names-spike/1 (fm-zg31)' } });
      if (!response.ok) throw Error(`${response.status} ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** Bytes the live server sends for one encoding, counted before decoding. */
function liveWireBytes(url, encoding) {
  return new Promise((resolveBytes, reject) => {
    const req = httpsRequest(url, { headers: { 'accept-encoding': encoding, 'user-agent': 'facemorph-names-spike/1 (fm-zg31)' } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolveBytes({ encoding: res.headers['content-encoding'] ?? 'identity', bytes: n, status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Fetch once into the cache; the rename keeps an interrupted run from leaving a partial file behind. */
async function cached(path, fetcher) {
  if (existsSync(path)) return readFileSync(path);
  const bytes = await fetcher();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
  return bytes;
}

// The gallery publishes no per-preview hashes, so check each is a whole JPEG before measuring with it.
function wholeJpeg(bytes, url) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) throw Error(`Not a whole JPEG: ${url}`);
  return bytes;
}

async function pool(items, width, fn) {
  const out = Array.from({ length: items.length });
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 500 === 0) log(`  ${done}/${items.length}`);
    }
  }));
  return out;
}

const galleryPath = (id, dim, fmt) => `${GALLERY}/outputImages/hash-${id.slice(0, 2)}/${id.slice(2, 4)}/hash-${id}_${dim}.${fmt}`;

/** The v2 envelope chunk a result carries (mirrors candidate image-envelope.mjs embedRecovery for WebP). */
export function envelopeChunkBytes({ latent, generationSha256, modelSha256, noiseSha256, manifestSha256, bundleVersion }) {
  const record = {
    schema: 2, kind: 'facemorph-image-v2', generationKind: 'seed', generationSha256,
    provenance: { bundleVersion, manifestSha256, modelSha256, noiseSha256, provider: 'webgpu', mappingProvider: 'cpu', route: 'webgpu', truncationPsi: 0.7, truncationCutoff: 8, createdAt: '2026-10-24T00:00:00.000Z' },
    width: 1024, height: 1024, mime: 'image/webp', imageSha256: '0'.repeat(64), latentSha256: shapes.sha256Hex(latent),
    latent: { space: 'w-plus', shape: [18, 512], encoding: 'float32-le-base64', data: latent.toString('base64') },
  };
  const json = Buffer.byteLength(JSON.stringify(record));
  return 8 + json + (json & 1);
}

export function selfSignedCert(dir) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

const TYPES = { html: 'text/html; charset=utf-8', mjs: 'text/javascript', txt: 'text/plain; charset=utf-8', json: 'application/json', jpg: 'image/jpeg', webp: 'image/webp', bin: 'application/octet-stream', f32: 'application/octet-stream' };
const COMPRESSIBLE = new Set(['html', 'mjs', 'txt', 'json']);

/** Real local HTTP/2 server. Counts requests and body bytes per run (URL prefix /r/<run>/), with phase marks. */
export function startServer(files, tls) {
  const runs = new Map();
  const brCache = new Map();
  const server = createSecureServer({ ...tls, allowHTTP1: true }, (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    const m = url.pathname.match(/^\/r\/([a-z0-9-]+)\/(.+)$/);
    if (!m) { res.writeHead(404); res.end(); return; }
    const [, run, path] = m;
    const stats = runs.get(run) ?? runs.set(run, { requests: 0, bytes: 0, byClass: {}, marks: {} }).get(run);
    if (path === 'mark') {
      stats.marks[url.searchParams.get('phase')] = { requests: stats.requests, bytes: stats.bytes, byClass: structuredClone(stats.byClass) };
      res.writeHead(204); res.end(); return;
    }
    const body = files(path);
    if (!body) { res.writeHead(404); res.end(); return; }
    const ext = path.split('.').pop();
    let out = body, encoding;
    if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
      out = brCache.get(path) ?? brCache.set(path, brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } })).get(path);
      encoding = 'br';
    }
    const cls = path.split('/')[0].replace(/\.\w+$/, '');
    stats.requests++; stats.bytes += out.length;
    const c = stats.byClass[cls] ?? (stats.byClass[cls] = { requests: 0, bytes: 0 });
    c.requests++; c.bytes += out.length;
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': out.length, 'cache-control': 'public, max-age=86400', ...(encoding ? { 'content-encoding': encoding } : {}) });
    res.end(out);
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port, runs })));
}

async function main() {
  const { values: opt } = parseArgs({ options: OPTIONS });
  const repeats = Number(opt.repeats), shardCounts = opt.shards.split(',').map(Number);
  const out = resolve(opt.out);
  mkdirSync(out, { recursive: true });
  const results = { bead: 'fm-zg31', at: new Date().toISOString(), host: process.env.HOSTNAME || execFileSync('hostname').toString().trim(), node: process.version, options: opt };

  // ---- Catalogue -------------------------------------------------------------------------------------
  const catalogueBytes = /^https?:/.test(opt.catalogue) ? await getBytes(opt.catalogue) : readFileSync(opt.catalogue);
  const catalogueSha = shapes.sha256Hex(catalogueBytes);
  if (catalogueSha !== PINNED_CATALOGUE.sha256 && !opt['any-catalogue']) throw Error(`Catalogue SHA-256 ${catalogueSha} is not the pinned candidate catalogue; pass --any-catalogue to measure another.`);
  const catalogue = JSON.parse(catalogueBytes);
  const { rows, identity } = shapes.parseCatalogue(catalogue);
  const n = rows.length;
  log(`catalogue ${catalogueSha.slice(0, 12)}: ${n} names`);
  const live = /^https?:/.test(opt.catalogue) ? await Promise.all(['br', 'gzip'].map((e) => liveWireBytes(opt.catalogue, e))) : null;
  results.catalogue = { sha256: catalogueSha, source: opt.catalogue, names: n, identity, candidate: { ...shapes.wire(catalogueBytes), live } };

  // ---- Names + integrity shapes ----------------------------------------------------------------------
  // Stand-in result digests: the candidate's per-name latent SHA-256s. Real SHA-256 values, so they are as
  // incompressible as the result digests names.generator will publish; only their values differ.
  const digests = rows.map((r) => Buffer.from(r.latentSha256, 'hex'));
  const version = '2026-10-24-spike';
  const plainNames = shapes.namesText(rows);
  results.namesFormats = { text: shapes.wire(plainNames), json: shapes.wire(shapes.namesJson(rows)) };

  // ---- Inputs: previews, historic 1,024 px faces and latents for the result-size sample -------------
  const cache = join(opt.cache, catalogueSha.slice(0, 16));
  const previewRows = opt['preview-limit'] ? rows.slice(0, Number(opt['preview-limit'])) : rows;
  log(`fetching ${previewRows.length} previews into ${cache} (cached after the first run)`);
  const previews = await pool(previewRows, 8, async (r) => wholeJpeg(await cached(join(cache, 'previews', `${r.id}.jpg`), () => getBytes(galleryPath(r.id, 200, 'jpg'))), r.id));
  const previewSizes = previews.map((b) => b.length);
  const sampleRows = catalogue.names.filter((r) => r.full === 'webp').slice(0, Number(opt['result-sample']));
  const fulls = await pool(sampleRows, 4, (r) => cached(join(cache, 'full', `${r.id}.webp`), () => getBytes(galleryPath(r.id, 1024, 'webp'))));
  const latents = await pool(sampleRows, 4, async (r) => {
    const bytes = await cached(join(cache, 'latent', `${r.id}.f32`), () => getBytes(`${NAME_ORIGIN}/latent/${r.id}.f32`));
    if (bytes.length !== r.latent.size || shapes.sha256Hex(bytes) !== r.latent.sha256) throw Error(`Latent for ${r.value} fails its published SHA-256.`);
    return bytes;
  });

  // ---- Preview packaging: byte-exact packs (atlases are built in the browser below) -----------------
  const alternatives = opt.alternatives.split(',');
  const generated = new Map();
  for (const alt of alternatives.filter((a) => a.startsWith('pack-'))) {
    const k = Number(alt.split('-')[1]);
    shapes.packAll(previews, k).forEach((p, i) => generated.set(`previews-pack-${k}/${i}.bin`, p));
  }

  // ---- Server --------------------------------------------------------------------------------------
  const headerManifest = Buffer.from(JSON.stringify(shapes.manifest({ version, names: plainNames, identity, integrity: { scheme: 'result-header' } })));
  const previewById = new Map(previewRows.map((r, i) => [r.id, previews[i]]));
  const fullById = new Map(sampleRows.map((r, i) => [r.id, fulls[i]]));
  const servedNames = previewRows === rows ? plainNames : shapes.namesText(previewRows);
  const servedManifest = previewRows === rows ? headerManifest : Buffer.from(JSON.stringify(shapes.manifest({ version, names: servedNames, identity, integrity: { scheme: 'result-header' } })));
  const files = (path) => {
    if (path === 'grid.html' || path === 'grid.mjs') return readFileSync(join(here, path));
    if (path === 'blank.html') return Buffer.from('<!doctype html><title>build</title>');
    if (path === 'names.txt') return servedNames;
    if (path === 'manifest.json') return servedManifest;
    let m = path.match(/^previews\/([a-f0-9]{64})\.jpg$/);
    if (m) return previewById.get(m[1]);
    m = path.match(/^full\/([a-f0-9]{64})\.webp$/);
    if (m) return fullById.get(m[1]);
    return generated.get(path);
  };
  const tlsDir = mkdtempSync(join(tmpdir(), 'names-spike-tls-'));
  const { server, port, runs } = await startServer(files, selfSignedCert(tlsDir));
  const origin = `https://127.0.0.1:${port}`; // eris resolves localhost to ::1 first

  let browserInfo = null, resultSizes = null, atlasStats = {};
  const scroll = [];
  if (!opt['skip-browser']) {
    const pw = await import('playwright');
    const type = pw[opt.browser];
    const launchArgs = opt.browser === 'chromium' ? ['--ignore-certificate-errors'] : [];
    const browser = await type.launch({ executablePath: opt.executable, args: launchArgs });
    browserInfo = { name: opt.browser, version: browser.version(), executable: opt.executable ?? 'playwright' };
    log(`browser ${opt.browser} ${browser.version()}`);

    // Build atlases and sample result sizes in Chromium's own encoders (Firefox/WebKit only measure scroll).
    const builderBrowser = opt.browser === 'chromium' ? browser : await pw.chromium.launch({ args: ['--ignore-certificate-errors'] });
    const builder = await (await builderBrowser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await builder.goto(`${origin}/r/build/blank.html`);
    for (const alt of alternatives.filter((a) => a.startsWith('atlas-'))) {
      const k = Number(alt.split('-')[1]);
      const { cols, rows: gridRows } = shapes.atlasGrid(k);
      const quality = Number(opt['atlas-quality']);
      const diffs = [];
      for (let at = 0; at < previewRows.length; at += k * 8) {
        const batch = [];
        for (let p = at; p < Math.min(previewRows.length, at + k * 8); p += k) batch.push(previewRows.slice(p, p + k).map((r) => r.id));
        const built = await builder.evaluate(buildAtlases, { batch, cols, rows: gridRows, quality });
        built.forEach((b, j) => { generated.set(`previews-atlas-${k}/${at / k + j}.jpg`, Buffer.from(b.b64, 'base64')); diffs.push(b); });
      }
      const bytes = [...generated].filter(([p]) => p.startsWith(`previews-atlas-${k}/`)).map(([, b]) => b.length);
      const pixels = diffs.reduce((s, d) => s + d.pixels, 0);
      atlasStats[alt] = {
        quality, cols, rows: gridRows, files: bytes.length, bytes: bytes.reduce((a, b) => a + b, 0),
        meanAbsDiff: diffs.reduce((s, d) => s + d.absSum, 0) / pixels,
        maxAbsDiff: Math.max(...diffs.map((d) => d.maxDiff)),
        psnr: 10 * Math.log10((255 * 255) / (diffs.reduce((s, d) => s + d.sqSum, 0) / pixels)),
      };
      log(`${alt}: ${bytes.length} atlases, ${atlasStats[alt].bytes} bytes, PSNR ${atlasStats[alt].psnr.toFixed(1)} dB vs the original previews`);
    }
    const webpSizes = await builder.evaluate(encodeResults, { ids: sampleRows.map((r) => r.id) });
    const chunks = latents.map((latent) => envelopeChunkBytes({ latent, generationSha256: identity.generationSha256, modelSha256: identity.modelSha256, ...CANDIDATE_RUNTIME }));
    const totals = webpSizes.map((w, i) => w + chunks[i]);
    resultSizes = { sample: sampleRows.length, webpQuality: 0.8, webp: webpSizes, envelope: chunks, totals, median: shapes.median(totals), max: Math.max(...totals) };
    log(`result objects: median ${resultSizes.median} bytes (WebP q0.8 + v2 envelope ${chunks[0]} bytes)`);
    if (builderBrowser !== browser) await builderBrowser.close();

    // Scroll runs. Each is a fresh context: empty memory and disk cache.
    const speeds = opt.speeds.split(',').map(Number);
    for (const vp of opt.viewports.split(',').filter(Boolean)) for (const speed of speeds) for (const alt of alternatives) for (let rep = 0; rep < repeats; rep++) {
      const run = `${vp}-${speed}-${alt}-${rep}`.toLowerCase();
      const ctxOptions = { ...VIEWPORTS[vp].context, ignoreHTTPSErrors: true };
      if (opt.browser === 'firefox') delete ctxOptions.isMobile;
      const context = await browser.newContext(ctxOptions);
      const page = await context.newPage();
      const chromium = opt.browser === 'chromium';
      const network = chromium ? NETWORKS[opt.network] : null;
      const cpuThrottle = chromium ? VIEWPORTS[vp].cpuThrottle : 1;
      if (chromium) {
        const cdp = await context.newCDPSession(page);
        if (network) {
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', { offline: false, ...network });
        }
        if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
      }
      const atlas = alt.startsWith('atlas-') ? shapes.atlasGrid(Number(alt.split('-')[1])) : null;
      await page.goto(`${origin}/r/${run}/grid.html?alt=${alt}&speed=${speed}&duration=${opt.duration}${atlas ? `&cols=${atlas.cols}&rows=${atlas.rows}` : ''}`);
      await page.waitForFunction(() => window.__result, null, { timeout: 240000, polling: 250 });
      const r = await page.evaluate(() => window.__result);
      await context.close();
      if (r.error) throw Error(`${run}: ${r.error}`);
      const vsync = shapes.median(r.idle.slice(1).map((t, i) => t - r.idle[i]));
      const stats = runs.get(run);
      const first = stats.marks.first, during = stats.marks.scroll;
      const visibleCount = Math.min(n, r.columns * Math.ceil(r.viewportHeight / r.tileHeight));
      scroll.push({
        run, viewport: vp, speed, alt, repeat: rep, network: network ? opt.network : 'none', cpuThrottle,
        columns: r.columns, tileHeight: r.tileHeight, visibleTiles: visibleCount, idMs: r.idMs,
        firstViewport: { ms: r.firstViewportMs, requests: first.requests, bytes: first.bytes, byClass: first.byClass, visiblePreviewBytes: previewSizes.slice(0, visibleCount).reduce((a, b) => a + b, 0) },
        scroll: { scrolledPx: r.scrolledPx, requests: during.requests - first.requests, bytes: during.bytes - first.bytes, vsyncMs: vsync, ...shapes.droppedFrames(r.frames, vsync), longTasks: r.longTasks?.scroll ?? null, blankTileFraction: r.blankTileFraction, framesWithBlank: r.framesWithBlank },
        loadLongTasks: r.longTasks?.load ?? null,
      });
      const s = scroll.at(-1);
      log(`${run}: first viewport ${s.firstViewport.ms.toFixed(0)} ms, ${s.firstViewport.requests} req, ${s.firstViewport.bytes} B; scroll dropped ${s.scroll.dropped}/${s.scroll.frames}, long tasks ${s.scroll.longTasks?.count ?? 'n/a'}, blank ${(s.scroll.blankTileFraction * 100).toFixed(1)}%`);
    }
    await browser.close();
  }
  server.close();
  rmSync(tlsDir, { recursive: true, force: true });

  // ---- Accounting --------------------------------------------------------------------------------------
  const resultBytes = resultSizes?.median ?? 129932; // candidate first-Save evidence: hello-1024 WebP q0.8 + envelope
  results.resultObject = resultSizes ?? { estimate: resultBytes, source: 'candidate direct-rgba-media-v1 correctness evidence (hello-1024, WebP q0.8, 80,130 + 49,802 bytes)' };
  const previewFiles = (alt) => alt === 'files' ? n : Math.ceil(n / Number(alt.split('-')[1]));
  results.shapes = shapes.integrityPlacements(digests, shardCounts).map((placement) => {
    const names = placement.namesSuffix ? shapes.namesWithSuffix(rows, placement.namesSuffix) : plainNames;
    const man = Buffer.from(JSON.stringify(shapes.manifest({ version, names, identity, integrity: placement.manifest })));
    const namesWire = shapes.wire(names), manifestWire = shapes.wire(man);
    const lookupFiles = placement.files.length;
    return {
      key: placement.key, names: namesWire, manifest: manifestWire,
      ...shapes.shapeCosts({ namesWire: namesWire.br, manifestWire: manifestWire.br, placement, resultBytes, rowCount: n }),
      // Previews either stay on the seed-gallery Worker or move beside the results, packaged per alternative.
      assets: {
        previewsSeparate: shapes.assetCount({ rowCount: n, integrityFiles: lookupFiles, previewFiles: 0 }),
        ...Object.fromEntries(alternatives.map((alt) => [alt, shapes.assetCount({ rowCount: n, integrityFiles: lookupFiles, previewFiles: previewFiles(alt) })])),
      },
    };
  });
  results.previews = {
    count: previewSizes.length, bytes: previewSizes.reduce((a, b) => a + b, 0), median: shapes.median(previewSizes), max: Math.max(...previewSizes),
    packs: Object.fromEntries(alternatives.filter((a) => a.startsWith('pack-')).map((alt) => {
      const k = Number(alt.split('-')[1]);
      const sizes = [...generated].filter(([p]) => p.startsWith(`previews-pack-${k}/`)).map(([, b]) => b.length);
      return [alt, { files: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0), headerOverhead: sizes.length * 8 + previewSizes.length * 4 }];
    })),
    atlases: atlasStats,
  };
  results.browser = browserInfo;
  results.scroll = scroll;
  results.scrollSummary = summarizeScroll(scroll);

  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1) + '\n');
  writeFileSync(join(out, 'summary.md'), summaryMarkdown(results));
  log(`wrote ${join(out, 'results.json')} and summary.md`);
  console.log(summaryMarkdown(results));
}

/** Median of each metric over repeats, per viewport, scroll speed and alternative. */
export function summarizeScroll(scroll) {
  const groups = new Map();
  for (const s of scroll) {
    const key = `${s.viewport}|${s.speed}|${s.alt}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
  }
  return [...groups].map(([key, list]) => {
    const [viewport, speed, alt] = key.split('|');
    const med = (f) => shapes.median(list.map(f).filter((v) => v !== null && v !== undefined));
    return {
      viewport, speed: Number(speed), alt, repeats: list.length, network: list[0].network, cpuThrottle: list[0].cpuThrottle, visibleTiles: list[0].visibleTiles,
      firstViewportMs: med((s) => s.firstViewport.ms), firstViewportRequests: med((s) => s.firstViewport.requests), firstViewportBytes: med((s) => s.firstViewport.bytes),
      visiblePreviewBytes: list[0].firstViewport.visiblePreviewBytes,
      scrollRequests: med((s) => s.scroll.requests), scrollBytes: med((s) => s.scroll.bytes),
      droppedFrames: med((s) => s.scroll.dropped), frames: med((s) => s.scroll.frames), worstFrameMs: med((s) => s.scroll.worstFrameMs),
      longTasks: med((s) => s.scroll.longTasks?.count), longTaskMs: med((s) => s.scroll.longTasks?.ms),
      blankTileFraction: med((s) => s.scroll.blankTileFraction),
    };
  });
}

const kb = (b) => (b / 1024).toFixed(1);
export function summaryMarkdown(r) {
  const lines = [`# Names data-shape spike (fm-zg31)`, '', `${r.at} on ${r.host}, ${r.browser ? `${r.browser.name} ${r.browser.version}` : 'no browser'}; catalogue \`${r.catalogue.sha256.slice(0, 12)}\`, ${r.catalogue.names} names.`, ''];
  const c = r.catalogue.candidate;
  lines.push(`Candidate catalogue.json: ${c.raw} B raw, ${c.gzip} B gzip-6, ${c.br} B brotli-5 locally; live ${(c.live ?? []).map((l) => `${l.encoding} ${l.bytes} B`).join(', ') || 'not fetched'}.`, '');
  lines.push(`Result object: ${r.resultObject.median ?? r.resultObject.estimate} B (${r.resultObject.median ? `median of ${r.resultObject.sample}` : 'estimate'}).`, '');
  lines.push('| Shape | Names (br) | Manifest (br) | First paint | First pick | Later pick | Integrity floor |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of r.shapes) lines.push(`| ${s.key} | ${s.names.br} | ${s.manifest.br} | ${s.firstPaint.requests} req, ${kb(s.firstPaint.bytes)} KB | ${s.firstPick.requests} req, ${kb(s.firstPick.bytes)} KB | ${s.laterPick.requests} req, ${kb(s.laterPick.bytes)} KB | ${kb(s.perNameFloor)} KB |`);
  lines.push('', `Previews: ${r.previews.count} files, ${kb(r.previews.bytes)} KB, median ${r.previews.median} B.`, '');
  if (r.scrollSummary.length) {
    lines.push(`Scroll: median of repeats; network ${r.scrollSummary[0].network}; phone = 390x844 at DPR 3 with ${r.scrollSummary.find((s) => s.viewport === 'phone')?.cpuThrottle ?? '-'}x CPU throttle (emulation).`, '');
    lines.push('| Viewport | px/s | Alternative | First viewport | Req | KB | Visible-preview KB | Scroll req | Scroll KB | Dropped / frames | Long tasks (ms) | Blank tiles |', '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const s of r.scrollSummary) lines.push(`| ${s.viewport} | ${s.speed} | ${s.alt} | ${s.firstViewportMs.toFixed(0)} ms | ${s.firstViewportRequests} | ${kb(s.firstViewportBytes)} | ${kb(s.visiblePreviewBytes)} | ${s.scrollRequests} | ${kb(s.scrollBytes)} | ${s.droppedFrames} / ${s.frames} | ${s.longTasks ?? 'n/a'} (${s.longTaskMs?.toFixed(0) ?? 'n/a'}) | ${(s.blankTileFraction * 100).toFixed(1)}% |`);
  }
  for (const [alt, a] of Object.entries(r.previews.atlases)) lines.push('', `${alt}: ${a.files} atlases, ${kb(a.bytes)} KB at JPEG q${a.quality}; mean abs diff ${a.meanAbsDiff.toFixed(2)}, max ${a.maxAbsDiff}, PSNR ${a.psnr.toFixed(1)} dB against the original previews.`);
  return lines.join('\n') + '\n';
}

// ---- Browser-side builders (run through page.evaluate; self-contained) ---------------------------------

async function buildAtlases({ batch, cols, rows, quality }) {
  const out = [];
  for (const ids of batch) {
    const canvas = new OffscreenCanvas(cols * 200, rows * 200);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const originals = [];
    for (let j = 0; j < ids.length; j++) {
      const bitmap = await createImageBitmap(await (await fetch(`previews/${ids[j]}.jpg`)).blob());
      ctx.drawImage(bitmap, (j % cols) * 200, Math.floor(j / cols) * 200, 200, 200);
      originals.push(ctx.getImageData((j % cols) * 200, Math.floor(j / cols) * 200, 200, 200).data);
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const decoded = new OffscreenCanvas(cols * 200, rows * 200).getContext('2d', { willReadFrequently: true });
    decoded.drawImage(await createImageBitmap(blob), 0, 0);
    let absSum = 0, sqSum = 0, maxDiff = 0, pixels = 0;
    originals.forEach((orig, j) => {
      const got = decoded.getImageData((j % cols) * 200, Math.floor(j / cols) * 200, 200, 200).data;
      for (let i = 0; i < orig.length; i += 4) for (let c = 0; c < 3; c++) {
        const d = Math.abs(orig[i + c] - got[i + c]);
        absSum += d; sqSum += d * d; if (d > maxDiff) maxDiff = d; pixels++;
      }
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ b64: btoa(s), absSum, sqSum, maxDiff, pixels });
  }
  return out;
}

/** WebP at the product's default export quality (0.8), from historic 1,024 px faces: the result size class. */
async function encodeResults({ ids }) {
  const canvas = new OffscreenCanvas(1024, 1024);
  const ctx = canvas.getContext('2d');
  const sizes = [];
  for (const id of ids) {
    ctx.drawImage(await createImageBitmap(await (await fetch(`full/${id}.webp`)).blob()), 0, 0, 1024, 1024);
    sizes.push((await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })).size);
  }
  return sizes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
