#!/usr/bin/env node
// GPU lane (fm-wzy), carried over from classic's next-gpu-lane.yml onto eris's RTX 2080 SUPER. Runs classic's own
// driver (apps/web/scripts/next-gpu-benchmark.py, unedited) through browser-harness 0.1.8 against a Chrome with
// WebGPU on Vulkan via ANGLE, and reports, in this order: the host GPU (nvidia-smi), the in-page adapter, the
// product's own synthesis canary results for the webgpu route (RGB <= 1, sampled raw float <= 0.002), and only
// then the per-face timings. Named failures: "software adapter" (llvmpipe, SwiftShader, a fallback adapter; no
// timings), "canaries" (missing or failing; timings withheld). Not a promotion gate, not a required status.
//
// Origin: by default the verified control served locally at https://next.facemorph.me (the parity specs' control
// server and a host mapping), never assumed production; --url benchmarks a staged or qualified origin instead.
// The browser gets its own profile and its own free CDP port, and the harness is pointed at the exact WebSocket
// URL the browser printed (127.0.0.1:9222 on eris is the USB phone's Chrome).
//
//   node scripts/ci/gpu-lane/lane.mjs --chrome <binary> [--url <origin>] [--faces 6] [--out next-gpu-evidence]
//        [--runtime <acquired runtime>] [--software]      (--software forces SwiftShader: the named-failure case)
// Run it under autoresearch/run.py --exclusive gpu-timing. Exit 0 green, 1 failed (named in the report).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const REPO = resolve(new URL('../../..', import.meta.url).pathname);
const DRIVER = join(REPO, 'apps/web/scripts/next-gpu-benchmark.py');
const HARNESS =
  process.env['BROWSER_HARNESS'] ?? join(homedir(), 'Work/runs/venv-bh/bin/browser-harness');
const GPU_FLAGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-vulkan',
];

/** Verdict from the lane's facts, in report order. Pure. */
export function verdict({ adapterFailure, canaries, timings }) {
  if (adapterFailure)
    return { ok: false, failure: 'software adapter', detail: adapterFailure, timings: null };
  const webgpu = (canaries ?? [])
    .filter((r) => r.provider === 'webgpu')
    .flatMap((r) => r.checks ?? []);
  const bad = webgpu.filter((c) => !(c.passed === true && c.maxRgb <= 1 && c.maxFloat <= 0.002));
  if (!webgpu.length || bad.length)
    return {
      ok: false,
      failure: 'canaries',
      detail: webgpu.length
        ? `failing: ${bad.map((c) => c.name).join(', ')}`
        : 'no webgpu canary result recorded',
      timings: null,
    };
  if (!timings) return { ok: false, failure: 'benchmark', detail: 'no timings', timings: null };
  return {
    ok: true,
    failure: null,
    detail: `${webgpu.length} webgpu canaries within RGB 1 / float 0.002`,
    timings,
  };
}

const freePort = () =>
  new Promise((r) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

function harness(script, env, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(HARNESS, [], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    p.stdin.end(script);
  });
}

const CANARY_READOUT = `
import json, os
new_tab(os.environ['LANE_ORIGIN'])
wait_for_load()
print('CANARIES ' + json.dumps(js("""(async()=>{const c=await caches.open('checkface-model-blobs-v1');const out=[];
  for(const r of await c.keys()){if(!r.url.includes('canary-qualification'))continue;
    const j=await (await c.match(r)).json().catch(()=>null);if(j)out.push({provider:j.provider,manifestSha256:j.manifestSha256,checks:j.checks});}
  return out;})()""")))
`;

async function main(argv) {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      chrome: { type: 'string' },
      url: { type: 'string' },
      faces: { type: 'string', default: '6' },
      out: { type: 'string', default: 'next-gpu-evidence' },
      runtime: {
        type: 'string',
        default: process.env['FACEMORPH_RUNTIME'] ?? join(homedir(), '.cache/facemorph-runtime'),
      },
      software: { type: 'boolean', default: false },
    },
  });
  if (!a.chrome) throw new Error('--chrome <binary> is required');
  const out = resolve(a.out);
  mkdirSync(out, { recursive: true });
  const report = {
    lane: 'gpu-lane',
    at: new Date().toISOString(),
    host: execFileSync('hostname', ['-s']).toString().trim(),
  };
  const save = () => writeFileSync(join(out, 'lane.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    report.hostGpu = execFileSync('nvidia-smi', [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader',
    ])
      .toString()
      .trim();
  } catch {
    report.hostGpu = 'nvidia-smi unavailable';
  }
  report.chrome = execFileSync(a.chrome, ['--version']).toString().trim();

  let control = null;
  const chromeArgs = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', ...GPU_FLAGS];
  if (a.software) chromeArgs.push('--use-webgpu-adapter=swiftshader');
  let origin = a.url;
  if (!origin) {
    const { startControl, chromiumArgs, ORIGIN } = await import(
      join(REPO, 'apps/web/test/parity/control-server.ts')
    );
    control = await startControl({ runtime: a.runtime, log: join(out, 'control-server.log') });
    report.origin = {
      url: ORIGIN,
      served: 'verified control artifact, local',
      identity: control.identity,
      manifestSha256: control.manifestSha256,
    };
    chromeArgs.push(...chromiumArgs);
    origin = `${ORIGIN}/`;
  } else report.origin = { url: origin, served: 'given' };
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'gpu-lane-'));
  const chrome = spawn(
    a.chrome,
    [...chromeArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const name = `gpu-lane-${process.pid}`;
  let bench;
  let canaries = [];
  try {
    const ws = await new Promise((resolveWs, reject) => {
      let log = '';
      const timer = setTimeout(
        () => reject(new Error(`Chrome did not report DevTools on ${port}: ${log.slice(-500)}`)),
        30_000,
      );
      chrome.stderr.on('data', (d) => {
        log += d;
        const m = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/\S+)/.exec(log);
        if (m && Number(m[2]) === port) {
          clearTimeout(timer);
          resolveWs(m[1]);
        }
      });
    });
    const env = {
      BU_NAME: name,
      BU_CDP_WS: ws,
      BU_CDP_URL: '',
      GPU_BENCH_URL: origin,
      GPU_BENCH_FACES: a.faces,
      GPU_BENCH_EVIDENCE: out,
      GPU_BENCH_HOST_GPU: report.hostGpu,
      LANE_ORIGIN: origin,
    };
    bench = await harness(readFileSync(DRIVER, 'utf8'), env, 2_100_000);
    writeFileSync(join(out, 'benchmark.log'), bench.out + bench.err);
    const read = await harness(CANARY_READOUT, env, 120_000);
    const line = read.out.split('\n').find((l) => l.startsWith('CANARIES '));
    canaries = line ? JSON.parse(line.slice(9)) : [];
  } finally {
    // This run's harness daemon and browser only: other sessions share the machine.
    let daemons = '';
    try {
      daemons = execFileSync('pgrep', ['-f', 'browser_harness'], { encoding: 'utf8' });
    } catch {
      /* none running */
    }
    for (const pid of daemons.split(/\s+/).filter(Boolean)) {
      try {
        if (readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`BU_NAME=${name}`))
          process.kill(Number(pid));
      } catch {
        /* gone */
      }
    }
    // Chrome flushes its profile on shutdown. Wait for it before removing that directory.
    if (chrome.exitCode === null && chrome.signalCode === null) {
      await new Promise((stopped) => {
        const timer = setTimeout(() => chrome.kill('SIGKILL'), 10_000);
        chrome.once('close', () => {
          clearTimeout(timer);
          stopped();
        });
        chrome.kill('SIGTERM');
      });
    }
    await control?.stop();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  let result = null;
  try {
    result = JSON.parse(readFileSync(join(out, 'gpu-benchmark.json'), 'utf8'));
  } catch {
    /* the driver stopped before its report */
  }
  report.adapter = result?.adapter ?? null;
  report.canaries = canaries;
  const adapterFailure = /software adapter|No WebGPU adapter|below the route binding floor/.exec(
    bench.out + bench.err,
  )
    ? (bench.out + bench.err)
        .split('\n')
        .find((l) => /software adapter|No WebGPU adapter|binding floor/.test(l))
        ?.trim()
    : null;
  const v = verdict({
    adapterFailure,
    canaries,
    timings: result
      ? {
          warmMsPerFace: result.warmMsPerFace,
          wallClockFirstFaceMs: result.wallClockFirstFaceMs,
          wallClockSubsequentMedianMs: result.wallClockSubsequentMedianMs,
          faces: result.faces,
          routeCaption: result.routeCaption,
        }
      : null,
  });
  Object.assign(report, { ok: v.ok, failure: v.failure, detail: v.detail, timings: v.timings });
  save();
  console.log(
    JSON.stringify({
      hostGpu: report.hostGpu,
      adapter: report.adapter,
      canaries: v.failure === 'canaries' ? v.detail : v.ok ? v.detail : null,
      failure: v.failure,
      timings: v.timings,
    }),
  );
  return v.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = await main(process.argv.slice(2));
