#!/usr/bin/env node
// fm-qeh: package synthesis, not a built-UI or encoder benchmark. No build is performed here.
// Noise and comparison are separate write-once runs. Both require genuine full31 execution receipts.
// Under run.py --exclusive cpu-timing (CPU) / gpu-timing (native or direct), with absolute
// FACEMORPH_LOCK_DIR, invoke:
//   node tools/ort-qualify/paired.mjs --mode noise --control-runtime ROOT --control-sha SHA
//     --control-engine cpu|ort|native|direct --control-numerics FULL31_RECEIPT --browser LAUNCH_TARGET
// 'ort' permits the pinned JSEP control; 'native' additionally requires asyncify/JSPI factory pins.
//     --profile-root EXISTING_DIR --profile-storage disk|tmpfs --max-load CEILING --out FRESH_DIR
// Compare adds --candidate-runtime ROOT --candidate-sha SHA --candidate-engine ENGINE
// --candidate-numerics FULL31_RECEIPT --noise NOISE_DIR/report.json. Both collect two discarded
// warmups then ABBA x3. --mode smoke runs one qualified control visit with no evaluated verdict.
// --mode identity only prints current package/test identities; no browser is launched.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import { cpus, hostname, loadavg, platform, release } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { abbaSchedule } from '../../scripts/verify/not-worse/workload.ts';
import { measureVerdict, noiseMargin } from '../../scripts/verify/not-worse.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonSha = (value) => sha(JSON.stringify(value));
const fail = (message) => {
  throw new Error(message);
};
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const engines = {
  cpu: 'ort-wasm',
  ort: 'ort-webgpu',
  native: 'ort-webgpu',
  direct: 'direct-webgpu',
};
export const METRICS = [
  'coldStartMs',
  'warmMsPerFrame',
  'runtimeDownloadBytes',
  'peakBrowserRssBytes',
];
const suitePath = 'packages/stylegan-js/test/full31/manifest.json';
const harnessPath = 'packages/stylegan-js/test/full31/full31.test.ts';
const supportPath = 'packages/stylegan-js/test/engine/support/runtime.ts';
const distRoots = ['packages/stylegan-js/dist', 'packages/browser-model-manager/dist'];
const order = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Exact bytes of all potentially executed package modules, including their relative imports. */
export function packageIdentity(repo = REPO) {
  const files = [];
  const walk = (path) => {
    for (const e of readdirSync(join(repo, path), { withFileTypes: true })) {
      const p = `${path}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const bytes = readFileSync(join(repo, p));
        files.push({ path: p, sha256: sha(bytes), size: bytes.length });
      } else fail(`package tree must contain regular files: ${p}`);
    }
  };
  distRoots.forEach(walk);
  files.sort(order);
  return {
    distSha256: jsonSha(files),
    files,
    harnessSha256: sha(readFileSync(join(repo, harnessPath))),
    runtimeSupportSha256: sha(readFileSync(join(repo, supportPath))),
    pinnedSuiteSha256: sha(readFileSync(join(repo, suitePath))),
  };
}

/** A URL is a logical runtime path; no external fetch or unpinned file is allowed by the server. */
export function runtimePath(url) {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !path.startsWith('/runtime/') ||
    path.includes('\\') ||
    /(^|\/)\.\.?($|\/)/.test(path) ||
    /(^|\/)\.\.?($|\/)/.test(url) ||
    /%2e|%2f|%5c/i.test(url)
  )
    fail(`not a canonical runtime asset URL: ${url}`);
  return path.slice('/runtime/'.length);
}

/** Independently verify the entire pinned graph, nested manifests, chunks and reconstructed wholes. */
export async function verifyRuntime(root, expected) {
  if (!digest(expected)) fail('an explicit lowercase runtime manifest SHA-256 is required');
  root = realpathSync(root);
  const bytes = readFileSync(join(root, 'manifest.json'));
  if (sha(bytes) !== expected) fail('runtime manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  const files = new Map();
  const checked = new Map();
  const checkedJson = new Set();
  const safeFile = (path) => {
    const file = realpathSync(join(root, path));
    // Acquisition deliberately uses symlinks into immutable control stores. Verify their bytes,
    // while never deriving a filesystem path from an unchecked URL or serving arbitrary files.
    if (!statSync(file).isFile()) fail(`runtime asset is not a regular file: ${path}`);
    return file;
  };
  async function part(a, whole) {
    if (!digest(a.sha256) || !Number.isSafeInteger(a.size) || a.size < 0)
      fail('invalid pinned asset identity');
    const path = runtimePath(a.url);
    const old = files.get(path);
    if (old && (old.sha256 !== a.sha256 || old.size !== a.size)) fail('asset path collision');
    const file = safeFile(path);
    if (statSync(file).size !== a.size) fail(`runtime asset size mismatch: ${path}`);
    if (whole || !checked.has(`${path}:${a.sha256}`)) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) {
        hash.update(chunk);
        whole?.update(chunk);
      }
      if (hash.digest('hex') !== a.sha256) fail(`runtime asset digest mismatch: ${path}`);
      checked.set(`${path}:${a.sha256}`, true);
    }
    files.set(path, { path, file, sha256: a.sha256, size: a.size });
    return path;
  }
  async function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string' && typeof value.sha256 === 'string') {
      // The root kernel provenance link omits size but is also pinned by the bundle.
      const a = { ...value };
      if (a.size === undefined) a.size = statSync(safeFile(runtimePath(a.url))).size;
      if (a.chunks?.length) {
        const hash = createHash('sha256');
        let size = 0;
        for (const c of a.chunks) {
          await part(c, hash);
          size += c.size;
        }
        if (size !== a.size || hash.digest('hex') !== a.sha256)
          fail('chunked whole digest/size mismatch');
        const path = runtimePath(a.url);
        if (path.endsWith('.json') && !checkedJson.has(path)) {
          if (a.size > 16 * 1024 * 1024) fail('nested JSON descriptor exceeds size bound');
          checkedJson.add(path);
          const bytes = Buffer.concat(
            a.chunks.map((c) => readFileSync(files.get(runtimePath(c.url)).file)),
          );
          await visit(JSON.parse(bytes.toString('utf8')));
        }
      } else {
        const path = await part(a);
        if (path.endsWith('.json') && !checkedJson.has(path)) {
          if (a.size > 16 * 1024 * 1024) fail('nested JSON descriptor exceeds size bound');
          checkedJson.add(path);
          await visit(JSON.parse(readFileSync(files.get(path).file, 'utf8')));
        }
      }
      return;
    }
    for (const child of Object.values(value)) await visit(child);
  }
  await visit(manifest);
  if (!files.size || !manifest.runtime || manifest.canaries?.length !== 7)
    fail('runtime lacks the product graph/canaries');
  return { root, manifest, manifestSha256: expected, files };
}

/** Receipt is emitted only after the real full31 assertions by its separate executable test. */
export function validateNumerics(receipt, side, identity, browser, pinnedSuite) {
  if (
    receipt.schema !== 'facemorph.full31-numerics/1' ||
    receipt.passed !== true ||
    receipt.manifestSha256 !== side.manifestSha256
  )
    fail('missing/mismatched passing full31 receipt');
  for (const key of ['harnessSha256', 'runtimeSupportSha256', 'distSha256', 'pinnedSuiteSha256'])
    if (receipt.identity?.[key] !== identity[key])
      fail(`numerics ${key} differs from executed code`);
  if (!digest(receipt.identity?.suiteSha256)) fail('numerics acquired suite identity missing');
  const engine = engines[side.engine];
  const route = side.engine === 'cpu' ? 'cpu' : 'webgpu';
  const cell = receipt.cells?.find(
    (c) =>
      c.actual?.engine === engine &&
      c.actual?.route === route &&
      c.actual?.provider === route &&
      c.browser?.version === browser.version &&
      c.browser?.executableSha256 === browser.executableSha256 &&
      c.browser?.launchTargetSha256 === browser.launchTargetSha256,
  );
  if (
    !cell ||
    cell.passed !== true ||
    cell.requested?.engine !== engine ||
    cell.requested?.route !== route ||
    cell.requested?.provider !== route ||
    receipt.thresholds?.maxRgb !== 1 ||
    receipt.thresholds?.maxFloat !== 0.002
  )
    fail('no numerical receipt for the requested engine/browser/provider');
  if (route === 'webgpu' && (!cell.adapter || cell.adapter.fallback !== false))
    fail('numerics lacks a real nonfallback adapter');
  if (
    cell.cases?.length !== 31 ||
    cell.cases.some(
      (c, i) =>
        c.name !== pinnedSuite.cases[i]?.name ||
        c.passed !== true ||
        !Number.isFinite(c.maxRgb) ||
        c.maxRgb < 0 ||
        c.maxRgb > 1 ||
        !Number.isFinite(c.maxFloat) ||
        c.maxFloat < 0 ||
        c.maxFloat > 0.002,
    )
  )
    fail('full31 numerical gate not met at the frozen tolerances');
  return cell;
}

export function assertEngineManifest(engine, manifest) {
  if (
    engine === 'native' &&
    !/\.(?:asyncify|jspi)\.mjs$/.test(manifest.webgpu?.runtime?.factory?.url ?? '')
  )
    fail('native engine requires a pinned asyncify or JSPI factory; use ort for the JSEP control');
}

export function requireIsolation(engineList, maxLoad, env = process.env, measured = loadavg()) {
  const lock = engineList.some((e) => e !== 'cpu') ? 'gpu-timing' : 'cpu-timing';
  if (
    env.FACEMORPH_EXCLUSIVE !== lock ||
    !env.FACEMORPH_RUN ||
    !env.FACEMORPH_LOCK_DIR ||
    !isAbsolute(env.FACEMORPH_LOCK_DIR)
  )
    fail(`timing requires existing run.py --exclusive ${lock} and absolute FACEMORPH_LOCK_DIR`);
  if (!Number.isFinite(maxLoad) || maxLoad <= 0 || measured[0] > maxLoad)
    fail(`load ${measured[0]} exceeds declared ceiling ${maxLoad}`);
  return {
    run: env.FACEMORPH_RUN,
    exclusive: lock,
    lockDir: env.FACEMORPH_LOCK_DIR,
    maxLoad,
    load: measured,
  };
}

export function filesystem(path) {
  const stat = statfsSync(path);
  return {
    path: realpathSync(path),
    type: stat.type,
    kind: stat.type === 0x01021994 ? 'tmpfs' : 'disk',
  };
}

/** Track the unique browser profile and all descendants, including children without profile argv. */
export function processRss(rows, profile) {
  const selected = new Set(rows.filter((r) => r.cmdline.includes(profile)).map((r) => r.pid));
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows)
      if (selected.has(r.ppid) && !selected.has(r.pid)) {
        selected.add(r.pid);
        changed = true;
      }
  }
  return rows.filter((r) => selected.has(r.pid)).reduce((sum, r) => sum + r.rss, 0);
}

function rssSampler(profile) {
  const samples = [];
  const sample = () => {
    const rows = [];
    for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        rows.push({
          pid: Number(pid),
          ppid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
          rss: Number(/^VmRSS:\s+(\d+) kB/m.exec(status)?.[1] ?? 0) * 1024,
          cmdline: readFileSync(`/proc/${pid}/cmdline`, 'utf8'),
        });
      } catch {
        /* a process ended during this sample */
      }
    }
    samples.push({
      at: new Date().toISOString(),
      bytes: processRss(rows, profile),
      load: loadavg(),
    });
  };
  sample();
  const timer = setInterval(sample, 100);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return samples;
    },
  };
}

/** A launch target can be a shell wrapper; bind the running browser binary as well. */
function liveBrowserBinary(beforePids) {
  const matches = [];
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p) && !beforePids.has(p))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
      if (
        Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) === process.pid &&
        /(?:^|\s)--remote-debugging-pipe(?:\s|$)/.test(command)
      ) {
        const executablePath = realpathSync(`/proc/${pid}/exe`);
        matches.push({ executablePath, executableSha256: sha(readFileSync(executablePath)) });
      }
    } catch {
      /* another task's process ended */
    }
  }
  if (matches.length !== 1) fail('cannot identify one newly launched browser executable');
  return matches[0];
}

export function summarizeRuns(runs, frozen = null) {
  const scored = runs.filter((r) => !r.warmup);
  const expected = abbaSchedule(6).filter((r) => r.pair !== null);
  if (
    runs.length !== 14 ||
    runs.filter((r) => r.warmup).length !== 2 ||
    scored.length !== 12 ||
    scored.some(
      (r, i) =>
        r.side !== expected[i].side || r.pair !== expected[i].pair || r.order !== expected[i].order,
    )
  )
    fail('two discarded warmups then ABBA x3 are required');
  const pairs = Array.from({ length: 6 }, (_, pair) => {
    const entries = scored.filter((r) => r.pair === pair);
    if (
      entries.length !== 2 ||
      !entries.find((r) => r.side === 'control') ||
      !entries.find((r) => r.side === 'build')
    )
      fail('six complete ABBA pairs are required');
    return {
      control: entries.find((r) => r.side === 'control'),
      build: entries.find((r) => r.side === 'build'),
    };
  });
  return Object.fromEntries(
    METRICS.map((key) => {
      const values = pairs.map((p) => ({ control: p.control[key], candidate: p.build[key] }));
      if (values.some((p) => !(p.control > 0 && p.candidate > 0))) fail(`unmeasured ${key}`);
      if (frozen === null) return [key, { pairs: values, margin: noiseMargin(values) }];
      const margin = frozen[key]?.margin;
      if (!Number.isFinite(margin) || margin < 0) fail(`invalid frozen noise margin for ${key}`);
      return [key, { pairs: values, ...measureVerdict({ pairs: values, noise: margin }) }];
    }),
  );
}

export function validateNoise(noise, report) {
  if (
    noise.schema !== report.schema ||
    noise.mode !== 'noise' ||
    noise.passed !== true ||
    jsonSha(noise.cell) !== jsonSha(report.cell) ||
    jsonSha(noise.control) !== jsonSha(report.control) ||
    jsonSha(noise.build) !== jsonSha(noise.control)
  )
    fail('noise receipt is not from this exact control/cell/workload');
  const metrics = summarizeRuns(noise.runs);
  if (jsonSha(metrics) !== jsonSha(noise.metrics))
    fail('frozen noise receipt does not match raw pairs');
  return metrics;
}

// The page drives the actual package loaders; it does not replace a runtime or inference API.
export const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import * as e from '/stylegan/engine/index.js';
import * as manager from '/manager/index.js';
const assets = (v, out = []) => {
  if (!v || typeof v !== 'object') return out;
  if (typeof v.url === 'string' && typeof v.sha256 === 'string' && typeof v.size === 'number') { out.push(v); return out; }
  for (const x of Object.values(v)) assets(x, out); return out;
};
window.run = async ({manifest, manifestSha256, engine, latents, expectedAdapter}) => {
  const started = performance.now();
  const route = engine === 'cpu' ? 'cpu' : 'webgpu';
  let adapter = null;
  if(route==='webgpu')for(const deadline=performance.now()+15000;;){
    adapter=await navigator.gpu?.requestAdapter();
    if(adapter||!navigator.gpu||performance.now()>=deadline)break;
    await new Promise(r=>setTimeout(r,250));
  }
  if (route === 'webgpu' && (!adapter || adapter.info?.isFallbackAdapter === true || adapter.isFallbackAdapter === true)) throw Error('hardware WebGPU adapter required');
  const adapterInfo = adapter ? { vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,description:adapter.info?.description,fallback:false } : null;
  if(route==='webgpu'&&(!expectedAdapter||['vendor','architecture','description'].some(k=>(adapterInfo[k]??'')!==(expectedAdapter[k]??''))))throw Error('current adapter differs from full31 numerical receipt');
  const cache = await manager.createBrowserModelCache();
  const parts = [manifest.runtime, manifest.mapping, manifest.average, manifest.noise, manifest.sampleIndices, manifest.canaries,
    engine === 'cpu' ? manifest.synthesis : engine === 'direct' ? manifest.webgl : manifest.webgpu];
  const list = [...new Map(assets(parts).filter(a => a.url !== manifest.webgpu?.kernel?.url).map(a => [a.sha256,a])).values()];
  const grant = {manifestSha256,route,purpose:'generate',owners:['face:paired'],assets:list.map(a=>({sha256:a.sha256,bytes:a.size,priority:'foreground-required'})),remainingBytes:5*list.reduce((n,a)=>n+a.size,0)};
  for (const a of list) await cache.acquire(a,{grant,owner:'face:paired'});
  const acquisitionMs = performance.now()-started;
  const reader=cache.local,host=e.browserModuleHost();
  const threads=e.cpuThreads({sharedArrayBuffer:typeof SharedArrayBuffer==='function',crossOriginIsolated:globalThis.crossOriginIsolated===true,hardwareConcurrency:navigator.hardwareConcurrency});
  let cpu;
  const cpuOrt=async()=> (cpu ??= await e.loadOrtRuntime(reader,e.cpuRuntimeAssets(manifest.runtime),host,threads)).ort;
  let g;
  try {
    g=engine==='cpu' ? await e.loadCpuGenerator({reader,manifest,manifestSha256,ort:cpuOrt})
      :engine==='direct'?await e.loadDirectWebGpuGenerator({reader,manifest,manifestSha256,gpu:navigator.gpu,cpuOrt})
      :await e.loadOrtWebGpuGenerator({reader,manifest,manifestSha256,gpu:navigator.gpu,host,cpuOrt});
    const expected=engine==='cpu'?'ort-wasm':engine==='direct'?'direct-webgpu':'ort-webgpu';
    if(g.engine!==expected||g.route!==route||g.provider.actual!==route||g.geometry.width!==1024||g.geometry.height!==1024)throw Error('unexpected engine/provider/geometry');
    await g.mappingReady();
    const q=e.createCanaryQualification({manifest,manifestSha256,route:g.route,bundle:e.canaryBundle(manifest,g.route,engine==='direct'?'direct':'ort'),records:cache.records,reader,synthesizeRaw:(v,n)=>g.synthesizeRaw(v,n)});
    await q.admit();
    let produced=0;
    const check=(index,rgba)=>{if(index!==produced||rgba.length!==1024*1024*4)throw Error('incomplete RGBA8 output');produced++;};
    const input=latents.map(x=>new Float32Array(x));
    await g.synthesizeSequence([input[0]],check);
    if(produced!==1)throw Error('cold face absent');
    const coldStartMs=performance.now()-started;
    produced=0;
    const frameCompletionMs=[],warmStart=performance.now();
    const count=await g.synthesizeSequence(input,(i,rgba)=>{check(i,rgba);frameCompletionMs.push(performance.now()-warmStart);});
    const warmSequenceMs=performance.now()-warmStart;
    if(count!==32||produced!==32)throw Error('warm workload must produce32frames');
    return {coldStartMs,acquisitionMs,warmSequenceMs,warmMsPerFrame:warmSequenceMs/32,frameCompletionMs,threads,actual:{engine:g.engine,route:g.route,provider:g.provider.actual},adapter:adapterInfo,checks:q.checks()};
  }finally{await g?.dispose?.();}
};
window.ready=true;
</script>`;

export function rewrittenManifest(manifest, origin) {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    fail('paired acquisition origin must be HTTPS without credentials');
  const walk = (v) => {
    if (typeof v === 'string' && /^https:\/\/[^/]+\/runtime\//.test(v))
      return `${origin}${new URL(v).pathname}`;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(manifest);
}

/** Real loopback HTTPS, with one task-owned certificate directory removed on success and failure. */
export async function serveHttps(handler, parent) {
  const directory = mkdtempSync(join(parent, 'ort-paired-https-'));
  let server;
  try {
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
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    const cert = readFileSync(join(directory, 'cert.pem'));
    server = createServer({ key: readFileSync(join(directory, 'key.pem')), cert }, handler);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    return {
      origin: `https://127.0.0.1:${server.address().port}`,
      certificateSha256: sha(cert),
      async stop() {
        try {
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    server?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function oneRun({
  side,
  browserType,
  browser,
  profileRoot,
  maxLoad,
  workload,
  identity,
  runMeta,
}) {
  const before = requireIsolation([side.engine], maxLoad);
  const profile = mkdtempSync(join(profileRoot, 'ort-paired-'));
  const requests = [],
    errors = [];
  let context, sampler, samples, result, transport;
  const handler = (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'https://127.0.0.1').pathname);
      let body;
      if (path === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      if (path === '/') body = Buffer.from(PAGE);
      else if (path.startsWith('/runtime/')) {
        const row = side.runtime.files.get(path.slice(9));
        if (!row) throw Error('unverified runtime path');
        body = readFileSync(row.file);
        if (body.length !== row.size || sha(body) !== row.sha256)
          throw Error('runtime changed after preflight');
        requests.push({
          path,
          bytes: body.length,
          runtimeOnly: workload.runtimePaths.includes(path.slice(9)),
        });
      } else {
        const prefix = path.startsWith('/stylegan/')
          ? '/stylegan/'
          : path.startsWith('/manager/')
            ? '/manager/'
            : null;
        if (!prefix) throw Error('unknown request');
        const rel = path.slice(prefix.length);
        const p = `${prefix === '/stylegan/' ? distRoots[0] : distRoots[1]}/${rel}`;
        const row = identity.files.find((f) => f.path === p);
        if (!row) throw Error('unverified package path');
        body = readFileSync(join(REPO, p));
        if (sha(body) !== row.sha256) throw Error('package changed after preflight');
      }
      const ext = extname(path);
      res
        .writeHead(200, {
          'content-type':
            path === '/'
              ? 'text/html'
              : ext === '.js' || ext === '.mjs'
                ? 'text/javascript'
                : ext === '.wasm'
                  ? 'application/wasm'
                  : 'application/octet-stream',
          'content-length': body.length,
          'cache-control': 'no-store',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cross-origin-resource-policy': 'same-origin',
        })
        .end(body);
    } catch (error) {
      errors.push(error.message);
      res.writeHead(500).end('refused');
    }
  };
  try {
    transport = await serveHttps(handler, profileRoot);
    const origin = transport.origin;
    const manifest = rewrittenManifest(side.runtime.manifest, origin);
    const servedManifestSha256 = jsonSha(manifest);
    const beforePids = new Set(readdirSync('/proc'));
    context = await browserType.launchPersistentContext(profile, {
      executablePath: browser.launchTargetPath,
      ignoreHTTPSErrors: true,
      headless: side.engine === 'cpu',
      args: [
        '--no-sandbox',
        ...(side.engine === 'cpu' ? [] : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']),
      ],
    });
    if (
      jsonSha(liveBrowserBinary(beforePids)) !==
      jsonSha({
        executablePath: browser.executablePath,
        executableSha256: browser.executableSha256,
      })
    )
      fail('sample browser executable changed since numerical gate');
    sampler = rssSampler(profile);
    await context.route('**/*', (r) => {
      if (new URL(r.request().url()).origin === origin) return r.continue();
      errors.push(`external request refused: ${new URL(r.request().url()).origin}`);
      return r.abort();
    });
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.ready === true);
    result = await page.evaluate((input) => window.run(input), {
      manifest,
      manifestSha256: servedManifestSha256,
      engine: side.engine,
      latents: workload.latents,
      expectedAdapter: side.numericalCell.adapter,
    });
    samples = sampler.stop();
    sampler = null;
    if (errors.length) fail(errors.join('; '));
    if (context.browser()?.version() !== browser.version)
      fail('executed browser differs from numerical receipt');
    const peakBrowserRssBytes = Math.max(...samples.map((s) => s.bytes));
    if (samples.some((s) => s.load[0] > maxLoad)) fail('load ceiling exceeded during measurement');
    if (!(peakBrowserRssBytes > 0)) fail('browser process RSS unavailable');
    const runtimeDownloadBytes = requests
      .filter((r) => r.runtimeOnly)
      .reduce((n, r) => n + r.bytes, 0);
    if (!(runtimeDownloadBytes > 0)) fail('runtime download was not observed on the cold profile');
    return {
      ...runMeta,
      ...result,
      runtimeDownloadBytes,
      peakBrowserRssBytes,
      memory: {
        metric:
          'sum of browser process and descendant RSS; shared pages may be counted per process',
        intervalMs: 100,
        samples,
      },
      requests,
      servedManifestSha256,
      servedOrigin: origin,
      certificateSha256: transport.certificateSha256,
      before,
      after: requireIsolation([side.engine], maxLoad),
    };
  } finally {
    sampler?.stop();
    try {
      await context?.close();
    } finally {
      try {
        await transport?.stop();
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    }
  }
}

function assetParts(asset) {
  return asset.chunks?.length ? asset.chunks : [asset];
}
export function workloadFor(runtime) {
  const canaries = runtime.manifest.canaries;
  const read = (a) =>
    Buffer.concat(
      assetParts(a).map((p) => readFileSync(runtime.files.get(runtimePath(p.url)).file)),
    );
  const points = canaries.slice(0, 2).map((c) => {
    const b = read(c.w);
    if (b.length !== 18 * 512 * 4) fail('workload requires1024FFHQW+');
    return new Float32Array(Uint8Array.from(b).buffer);
  });
  const latents = Array.from({ length: 32 }, (_, i) =>
    Array.from(points[0], (v, d) => Math.fround(v + ((points[1][d] - v) * i) / 31)),
  );
  const runtimePaths = [];
  const collect = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.url && v.sha256) {
      runtimePaths.push(...assetParts(v).map((p) => runtimePath(p.url)));
      return;
    }
    Object.values(v).forEach(collect);
  };
  collect(runtime.manifest.runtime);
  collect(runtime.manifest.webgpu.runtime);
  return {
    latents,
    runtimePaths: [...new Set(runtimePaths)].sort(),
    identity: {
      frames: 32,
      fps: 16,
      width: 1024,
      height: 1024,
      algorithm: 'linear W+ endpoints, inclusive, Float32; no pacing',
      inputs: canaries.slice(0, 2).map((c) => c.w.sha256),
      latentsSha256: sha(
        Buffer.concat(latents.map((x) => Buffer.from(new Float32Array(x).buffer))),
      ),
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values: o } = parseArgs({
    args: argv,
    options: Object.fromEntries(
      [
        'mode',
        'control-runtime',
        'control-sha',
        'control-engine',
        'control-numerics',
        'candidate-runtime',
        'candidate-sha',
        'candidate-engine',
        'candidate-numerics',
        'noise',
        'browser',
        'out',
        'profile-root',
        'profile-storage',
        'max-load',
      ].map((k) => [k, { type: 'string' }]),
    ),
  });
  const identity = packageIdentity();
  if (o.mode === 'identity') {
    console.log(JSON.stringify(identity, null, 2));
    return;
  }
  if (!['smoke', 'noise', 'compare'].includes(o.mode))
    fail('--mode identity|smoke|noise|compare is required');
  for (const k of [
    'control-runtime',
    'control-sha',
    'control-engine',
    'control-numerics',
    'browser',
    'out',
    'profile-root',
    'profile-storage',
    'max-load',
  ])
    if (!o[k]) fail(`--${k} is required`);
  if (o.mode === 'compare')
    for (const k of [
      'candidate-runtime',
      'candidate-sha',
      'candidate-engine',
      'candidate-numerics',
      'noise',
    ])
      if (!o[k]) fail(`--${k} is required`);
  if (!Object.hasOwn(engines, o['control-engine']))
    fail('engine must be cpu, ort, native, or direct');
  const profileRoot = realpathSync(o['profile-root']);
  const profileStorage = filesystem(profileRoot);
  if (
    !['tmpfs', 'disk'].includes(o['profile-storage']) ||
    profileStorage.kind !== o['profile-storage']
  )
    fail('profile storage declaration differs from actual filesystem');
  const engineList = [
    o['control-engine'],
    ...(o.mode === 'compare' ? [o['candidate-engine']] : []),
  ];
  if (engineList.includes('cpu') && engineList.some((e) => e !== 'cpu'))
    fail('CPU and WebGPU are separate measurement cells');
  const isolation = requireIsolation(engineList, Number(o['max-load']));
  const browserPath = realpathSync(o.browser);
  const browserType = createRequire(join(REPO, 'apps/web/package.json'))('playwright').chromium;
  // Identity probe launches no page, workload or adapter. The same binary launches each sample.
  const beforePids = new Set(readdirSync('/proc'));
  const probe = await browserType.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox'],
  });
  let browser;
  try {
    browser = {
      ...liveBrowserBinary(beforePids),
      launchTargetPath: browserPath,
      launchTargetSha256: sha(readFileSync(browserPath)),
      version: probe.version(),
    };
  } finally {
    await probe.close();
  }
  const pinnedSuite = JSON.parse(readFileSync(join(REPO, suitePath), 'utf8'));
  const side = async (prefix) => {
    if (!Object.hasOwn(engines, o[`${prefix}-engine`]))
      fail(`--${prefix}-engine must be cpu, ort, native, or direct`);
    const runtime = await verifyRuntime(o[`${prefix}-runtime`], o[`${prefix}-sha`]);
    assertEngineManifest(o[`${prefix}-engine`], runtime.manifest);
    const receiptBytes = readFileSync(o[`${prefix}-numerics`]);
    const value = {
      runtime,
      manifestSha256: runtime.manifestSha256,
      engine: o[`${prefix}-engine`],
    };
    const numericalCell = validateNumerics(
      JSON.parse(receiptBytes),
      value,
      identity,
      browser,
      pinnedSuite,
    );
    return { ...value, numericalCell, numericsSha256: sha(receiptBytes) };
  };
  const control = await side('control');
  const build = o.mode === 'compare' ? await side('candidate') : control;
  const workload = workloadFor(control.runtime);
  if (jsonSha(workload.identity) !== jsonSha(workloadFor(build.runtime).identity))
    fail('candidate workload differs from control');
  const cell = {
    host: hostname(),
    nodeVersion: process.version,
    os: `${platform()} ${release()}`,
    cpus: cpus().length,
    browser,
    profileStorage,
    distSha256: identity.distSha256,
    driverSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    scheduleSha256: sha(readFileSync(join(REPO, 'scripts/verify/not-worse/workload.ts'))),
    comparisonMathSha256: sha(readFileSync(join(REPO, 'scripts/verify/not-worse.mjs'))),
    workload: workload.identity,
    maxLoad: Number(o['max-load']),
  };
  const configuration = (s) => ({
    manifestSha256: s.manifestSha256,
    engine: s.engine,
    numericsSha256: s.numericsSha256,
    runtimeStorage: filesystem(s.runtime.root),
    verifiedGraphSha256: jsonSha(
      [...s.runtime.files.values()]
        .map(({ path, sha256, size }) => ({ path, sha256, size }))
        .sort(order),
    ),
    verifiedFiles: s.runtime.files.size,
  });
  const report = {
    schema: 'facemorph.ort-paired/1',
    boundaries: {
      coldStartMs:
        'fresh profile: adapter probe + acquisition + loader + mapping ready + product admission + first completed RGBA8; excludes browser launch/page import',
      warmMsPerFrame:
        'elapsed synthesizeSequence of 32 fixed W+ inputs through CPU readback and RGBA8 conversion divided by 32; no 16FPS pacing',
      runtimeDownloadBytes:
        'successful HTTP response body bytes for CPU and GPU runtime module/factory/WASM paths only, excluding models, fixtures and package code',
      peakBrowserRssBytes:
        'maximum sum of browser and descendant process RSS observed every 100ms during page and engine workload; shared pages may be counted per process',
    },
    scope:
      'Exact package synthesis to CPU RGBA8 on localhost with verified local acquisition; no video encoding, compositor, product UI or phone qualification. RSS is sampled browser-process memory, not total GPU allocation.',
    mode: o.mode,
    evaluated: o.mode === 'compare',
    startedAt: new Date().toISOString(),
    cell,
    identity,
    isolation,
    control: configuration(control),
    build: configuration(build),
    runs: [],
  };
  let frozen = null;
  let frozenCell = null;
  if (o.mode === 'compare') {
    const noiseBytes = readFileSync(o.noise);
    const noise = JSON.parse(noiseBytes);
    frozen = validateNoise(noise, report);
    frozenCell = noise.runs[0];
    report.noiseSha256 = sha(noiseBytes);
  }
  const out = resolve(o.out);
  mkdirSync(out, { recursive: false });
  const save = () =>
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  try {
    // Discard both sides' warmup. Every visit, including every scored visit, has a fresh profile.
    const schedule =
      o.mode === 'smoke'
        ? [{ side: 'control', pair: null, order: 'warmup', index: 0 }]
        : [
            { side: 'control', pair: null, order: 'warmup', index: -2 },
            { side: 'build', pair: null, order: 'warmup', index: -1 },
            ...abbaSchedule(6).filter((r) => r.pair !== null),
          ];
    for (const meta of schedule) {
      const selected = meta.side === 'control' ? control : build;
      requireIsolation(engineList, Number(o['max-load']));
      const run = await oneRun({
        side: selected,
        browserType,
        browser,
        profileRoot,
        maxLoad: Number(o['max-load']),
        workload: { ...workload, runtimePaths: workloadFor(selected.runtime).runtimePaths },
        identity,
        runMeta: { ...meta, warmup: meta.pair === null },
      });
      const baseline = frozenCell ?? report.runs[0];
      if (
        baseline &&
        (jsonSha(run.adapter) !== jsonSha(baseline.adapter) || run.threads !== baseline.threads)
      )
        fail('adapter or thread count changed within the measured cell');
      report.runs.push(run);
      save();
      console.log(
        JSON.stringify({
          index: meta.index,
          side: meta.side,
          warmup: meta.pair === null,
          ...Object.fromEntries(METRICS.map((k) => [k, run[k]])),
        }),
      );
    }
    report.metrics = o.mode === 'smoke' ? null : summarizeRuns(report.runs, frozen);
    report.passed =
      o.mode !== 'compare' || Object.values(report.metrics).every((m) => m.verdict === 'passed');
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
