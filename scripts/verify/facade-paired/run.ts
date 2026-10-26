// Paired real-bridge facade comparison (fm-fy2.6): the imported candidate bridge and runtime loader at the fm-pia9
// facade commit (control) against the current app (build), in the same real-bridge facade harness, on one cell, in
// ABBA order, with a control/control noise set, under the strictly-not-worse rule (PLAN.md "Strictly not worse than
// the candidate"). The ABBA schedule is fm-0q4h's (not-worse/workload.ts), the verdict math fm-mc27's
// (not-worse.mjs); this file only produces and pairs the runs.
//
// Each side is its revision's tree exported with `git archive` into a disposable cache (never the shared working
// tree, which other sessions edit), with the checkout's node_modules linked in and the workspace packages linked to
// the exported tree's own packages (their dist built there). facade-paired/page.ts is copied into each tree and
// Vite-built exactly as test/e2e/facade.e2e.ts builds its page, then served at the production origin through
// Playwright routing with the acquired runtime at /runtime/ (pins checked first). Real CPU ORT work, headless
// Chromium.
//
// A run is two fresh persistent profiles (each its own browser): the photo profile (empty: cold photo
// time-to-encoded-face, peak stored bytes, memory) and the face profile (empty: cold first face, next face, stored
// bytes). Every run appends one line to <out>/runs.jsonl, so a cell can be filled over several bounded commands into
// the same --out; the report pairs everything in runs.jsonl.
//
//   python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 3600 -- \
//     node scripts/verify/facade-paired/run.ts --pairs 5 --noise-pairs 5 --out <dir>
//   node scripts/verify/facade-paired/run.ts --report-only --out <dir>     (table and report.json from runs.jsonl)
import { execFileSync, execSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, homedir, hostname, loadavg, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { abbaSchedule } from '../not-worse/workload.ts';
// @ts-expect-error plain ESM without declarations
import * as nw from '../not-worse.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const ORIGIN = 'https://next.facemorph.me';
const CELL = 'eris-cpu-chromium-facade';

const { values: args } = parseArgs({
  options: {
    'control-rev': { type: 'string', default: '1fc5a64' },
    'build-rev': { type: 'string', default: 'HEAD' },
    pairs: { type: 'string', default: '5' },
    'noise-pairs': { type: 'string', default: '5' },
    out: { type: 'string' },
    runtime: {
      type: 'string',
      default:
        process.env['FACEMORPH_RUNTIME_DIR'] ??
        join(homedir(), '.cache/facemorph-device-lab/runtime-public'),
    },
    cache: { type: 'string', default: join(homedir(), '.cache/facemorph-facade-paired') },
    'step-timeout': { type: 'string', default: '900' },
    'no-warmup': { type: 'boolean', default: false },
    'report-only': { type: 'boolean', default: false },
  },
});
if (!args.out) throw new Error('--out <dir> is required');
const OUT = resolve(args.out);
mkdirSync(OUT, { recursive: true });
const RUNS = join(OUT, 'runs.jsonl');
const log = (line: string) => console.log(`# ${line}`);
const sha = (rev: string) =>
  execFileSync('git', ['-C', repo, 'rev-parse', rev], { encoding: 'utf8' }).trim();

// ---- trees and bundles -------------------------------------------------------------------------------------------
const TREE_PATHS = [
  'apps/web',
  'packages',
  'hosting',
  'package.json',
  'tsconfig.base.json',
  'tsconfig.dom.json',
  'tsconfig.node.json',
  'tsconfig.worker.json',
];
/** The revision's apps/web and packages, exported and built once per commit into the disposable cache. */
function prepare(rev: string): { sha: string; tree: string; bundle: string } {
  const commit = sha(rev);
  const tree = join(resolve(args.cache!), commit);
  const bundle = join(tree, 'bundle');
  const stamp = join(tree, '.page-sha256');
  const pageSource = readFileSync(join(here, 'page.ts'));
  const pageHash = execFileSync('sha256sum', [join(here, 'page.ts')], { encoding: 'utf8' }).split(
    ' ',
  )[0]!;
  if (
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === pageHash &&
    existsSync(join(bundle, 'index.html'))
  )
    return { sha: commit, tree, bundle };
  mkdirSync(tree, { recursive: true });
  // The app's closure reaches the root hosting/ (environment and validation modules) besides apps/web and packages.
  const paths = TREE_PATHS.filter(
    (p) =>
      !existsSync(join(tree, p)) &&
      execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', commit, p], {
        encoding: 'utf8',
      }).trim() !== '',
  );
  if (paths.length)
    execSync(
      `git -C '${repo}' archive '${commit}' ${paths.map((p) => `'${p}'`).join(' ')} | tar -x -C '${tree}'`,
      {
        stdio: 'inherit',
      },
    );
  if (!existsSync(join(tree, 'node_modules'))) {
    // node_modules: the checkout's third-party packages, the workspace packages from this tree.
    const nm = join(tree, 'node_modules');
    mkdirSync(join(nm, '@facemorph'), { recursive: true });
    for (const entry of readdirSync(join(repo, 'node_modules')))
      if (entry !== '@facemorph' && entry !== '.vite')
        symlinkSync(join(repo, 'node_modules', entry), join(nm, entry));
    for (const [name, dir] of [
      ['web', 'apps/web'],
      ...readdirSync(join(tree, 'packages')).map((p) => [p, `packages/${p}`]),
    ] as const)
      symlinkSync(join(tree, dir), join(nm, '@facemorph', name));
    // Declarations and JS only: the packages' `build` scripts also write PROVENANCE.json through a repository script
    // this export does not carry.
    for (const p of ['stylegan-js', 'browser-model-manager'])
      execFileSync(join(repo, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.build.json'], {
        cwd: join(tree, 'packages', p),
        stdio: 'inherit',
      });
  }
  const pageDir = join(tree, 'apps/web/test/e2e/facade-paired');
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(pageDir, 'page.ts'), pageSource);
  copyFileSync(join(here, 'index.html'), join(pageDir, 'index.html'));
  writeFileSync(stamp, '');
  return { sha: commit, tree, bundle };
}
async function bundle(t: { tree: string; bundle: string }): Promise<void> {
  const pageHash = execFileSync('sha256sum', [join(here, 'page.ts')], { encoding: 'utf8' }).split(
    ' ',
  )[0]!;
  const stamp = join(t.tree, '.page-sha256');
  if (readFileSync(stamp, 'utf8') === pageHash && existsSync(join(t.bundle, 'index.html'))) return;
  const { build } = await import('vite');
  await build({
    root: join(t.tree, 'apps/web/test/e2e/facade-paired'),
    configFile: false,
    logLevel: 'warn',
    build: { outDir: t.bundle, emptyOutDir: true, target: 'esnext', sourcemap: false },
    worker: { format: 'es' },
  });
  writeFileSync(stamp, pageHash);
}

// ---- one run -----------------------------------------------------------------------------------------------------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.png': 'image/png',
};
const SEED0 = join(repo, 'packages/stylegan-js/test/vectors/candidate-preprocessing/seed-0.rgb');

interface PwPage {
  goto(u: string): Promise<unknown>;
  waitForFunction(fn: () => unknown, a?: unknown, o?: object): Promise<unknown>;
  evaluate<T>(fn: (a: never) => T | Promise<T>, a?: unknown): Promise<T>;
  on(e: string, cb: (x: { message?: string }) => void): void;
}
interface PwRoute {
  request(): { url(): string };
  fulfill(o: object): Promise<void>;
  abort(): Promise<void>;
}
interface PwContext {
  route(m: string | ((u: URL) => boolean), h: (r: PwRoute) => unknown): Promise<void>;
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
const { chromium } = (await import('playwright')) as unknown as {
  chromium: { launchPersistentContext(dir: string, o: object): Promise<PwContext> };
};

/**
 * Peak resident memory of one profile's browser (every process whose command line names its profile directory:
 * browser, renderer, GPU and utility processes, workers included), summed per sample from /proc every 250 ms.
 * performance.measureUserAgentSpecificMemory is not available to headless Chromium pages (SecurityError), so the
 * OS view stands in for it; both sides are sampled the same way.
 */
function rssSampler(profileDir: string) {
  let peak = 0;
  const sample = () => {
    let total = 0;
    for (const pid of readdirSync('/proc')) {
      if (!/^[0-9]+$/.test(pid)) continue;
      try {
        if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(profileDir)) continue;
        const kb = /VmRSS:\s+([0-9]+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
        if (kb) total += Number(kb) * 1024;
      } catch {
        /* the process ended between listing and reading */
      }
    }
    if (total > peak) peak = total;
  };
  const timer = setInterval(sample, 250);
  return {
    reset: () => {
      sample();
      const p = peak;
      peak = 0;
      return p;
    },
    stop: () => {
      clearInterval(timer);
      sample();
      return peak;
    },
  };
}

async function profile<T>(
  t: { tree: string; bundle: string },
  body: (call: <R>(fn: string, ...a: unknown[]) => Promise<R>, rss: () => number) => Promise<T>,
): Promise<
  T & {
    fetchedBytes: number;
    requests: number;
    external: string[];
    pageErrors: string[];
    peakRss: number;
  }
> {
  const dir = mkdtempSync(join(tmpdir(), 'facade-paired-profile-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
  });
  const rss = rssSampler(dir);
  let fetchedBytes = 0;
  let requests = 0;
  const external: string[] = [];
  const pageErrors: string[] = [];
  const app = join(t.tree, 'apps/web');
  try {
    await context.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const file =
        path === '/preview/hello-1024.webp'
          ? join(app, 'src/public/preview/hello-1024.webp')
          : path === '/catalogue.json'
            ? join(app, 'hosting/next-static/catalogue.json')
            : path === '/seed-0.rgb'
              ? SEED0
              : path.startsWith('/runtime/')
                ? join(args.runtime!, path.slice('/runtime/'.length))
                : join(t.bundle, path === '/' ? 'index.html' : path);
      if (!existsSync(file) || !statSync(file).isFile())
        return route.fulfill({ status: 404, body: 'not found' });
      const body = readFileSync(file);
      requests++;
      if (path !== '/seed-0.rgb') fetchedBytes += body.length;
      return route.fulfill({
        status: 200,
        body,
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cross-origin-resource-policy': 'same-origin',
          'cache-control': 'no-store',
        },
      });
    });
    await context.route(
      (url) => !url.href.startsWith(ORIGIN),
      (route) => {
        external.push(new URL(route.request().url()).host);
        return route.abort();
      },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(`${ORIGIN}/index.html`);
    await page.waitForFunction(
      () => (window as unknown as { harnessReady?: boolean }).harnessReady === true,
      null,
      {
        timeout: 120_000,
      },
    );
    const limit = Number(args['step-timeout']) * 1000;
    const call = <R>(fn: string, ...rest: unknown[]): Promise<R> =>
      Promise.race([
        page.evaluate(
          (([name, a]: [string, unknown[]]) =>
            (window as unknown as { harness: Record<string, (...x: unknown[]) => unknown> })
              .harness[name]!(...a)) as never,
          [fn, rest],
        ) as Promise<R>,
        new Promise<R>((_, reject) =>
          setTimeout(() => reject(new Error(`${fn}: step timeout ${limit} ms`)), limit),
        ),
      ]);
    rss.reset();
    const result = await body(call, rss.reset);
    return { ...result, fetchedBytes, requests, external, pageErrors, peakRss: rss.stop() };
  } finally {
    rss.stop();
    await context.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Step {
  ms: number;
  produced: boolean;
  error: string;
}
interface Run {
  set: 'warmup' | 'paired' | 'noise';
  pair: number | null;
  order: string;
  side: 'control' | 'build';
  sha: string;
  at: string;
  loadavg: number[];
  photo: (Step & { storedPeak: number; storedAfter: number; peakRss?: number }) | null;
  firstFace: (Step & { peakRss?: number }) | null;
  nextFace: (Step & { peakRss?: number }) | null;
  photoFetchedBytes: number | null;
  faceFetchedBytes: number | null;
  faceStoredBytes: number | null;
  failure: string;
  pageErrors: string[];
  external: string[];
}

async function runOnce(
  t: { sha: string; tree: string; bundle: string },
  meta: Pick<Run, 'set' | 'pair' | 'order' | 'side'>,
): Promise<Run> {
  const run: Run = {
    ...meta,
    sha: t.sha,
    at: new Date().toISOString(),
    loadavg: loadavg(),
    photo: null,
    firstFace: null,
    nextFace: null,
    photoFetchedBytes: null,
    faceFetchedBytes: null,
    faceStoredBytes: null,
    failure: '',
    pageErrors: [],
    external: [],
  };
  const began = Date.now();
  try {
    const p = await profile(t, async (call, rss) => {
      const photo = await call<NonNullable<Run['photo']>>('coldPhoto', `${ORIGIN}/seed-0.rgb`);
      return { photo: { ...photo, peakRss: rss() } };
    });
    run.photo = p.photo;
    run.photoFetchedBytes = p.fetchedBytes;
    run.pageErrors.push(...p.pageErrors);
    run.external.push(...p.external);
  } catch (e) {
    run.failure += `photo profile: ${(e as Error).message}; `;
    run.photo ??= {
      ms: 0,
      produced: false,
      error: (e as Error).message,
      storedPeak: 0,
      storedAfter: 0,
    };
  }
  try {
    const fp = await profile(t, async (call, rss) => {
      const first = await call<Step>('face', 'a', 'charlotte');
      const firstFace = { ...first, peakRss: rss() };
      const next = await call<Step>('face', 'b', 'chris');
      const nextFace = { ...next, peakRss: rss() };
      const stored = await call<number>('stored');
      return { firstFace, nextFace, stored };
    });
    run.firstFace = fp.firstFace;
    run.nextFace = fp.nextFace;
    run.faceStoredBytes = fp.stored;
    run.faceFetchedBytes = fp.fetchedBytes;
    run.pageErrors.push(...fp.pageErrors);
    run.external.push(...fp.external);
  } catch (e) {
    run.failure += `face profile: ${(e as Error).message}; `;
    run.firstFace ??= { ms: 0, produced: false, error: (e as Error).message };
    run.nextFace ??= { ms: 0, produced: false, error: (e as Error).message };
  }
  log(
    `${meta.set} ${meta.pair ?? '-'} ${meta.order} ${meta.side}: photo ${fmt(run.photo)} first ${fmt(run.firstFace)} next ${fmt(run.nextFace)} peak ${run.photo?.storedPeak ?? '-'} B (${((Date.now() - began) / 1000).toFixed(0)} s)${run.failure ? ` FAIL ${run.failure}` : ''}`,
  );
  return run;
}
const fmt = (s: Step | null) =>
  s ? (s.produced ? `${(s.ms / 1000).toFixed(1)}s` : `failed(${s.error})`) : '-';

// ---- report ------------------------------------------------------------------------------------------------------
type Extract = (r: Run) => number | null | undefined;
const timed =
  (step: (r: Run) => Step | null): Extract =>
  (r) => {
    const s = step(r);
    return s?.produced ? s.ms : null;
  };
const MEASURES: [string, Extract][] = [
  ['cold photo time-to-encoded-face (ms)', timed((r) => r.photo)],
  ['peak stored bytes, cold photo', (r) => (r.photo?.produced ? r.photo.storedPeak : null)],
  ['stored bytes after cold photo', (r) => (r.photo?.produced ? r.photo.storedAfter : null)],
  [
    'peak browser RSS during cold photo (bytes)',
    (r) => (r.photo?.produced ? r.photo.peakRss : null),
  ],
  ['fetched bytes, photo profile', (r) => (r.photo?.produced ? r.photoFetchedBytes : null)],
  ['cold first face (ms)', timed((r) => r.firstFace)],
  ['next face (ms)', timed((r) => r.nextFace)],
  [
    'peak browser RSS during first face (bytes)',
    (r) => (r.firstFace?.produced ? r.firstFace.peakRss : null),
  ],
  [
    'peak browser RSS during next face (bytes)',
    (r) => (r.nextFace?.produced ? r.nextFace.peakRss : null),
  ],
  ['stored bytes after two faces', (r) => (r.nextFace?.produced ? r.faceStoredBytes : null)],
  ['fetched bytes, face profile', (r) => (r.nextFace?.produced ? r.faceFetchedBytes : null)],
];
const RESULTS: [string, (r: Run) => boolean][] = [
  ['photo face', (r) => Boolean(r.photo?.produced)],
  ['first face', (r) => Boolean(r.firstFace?.produced)],
  ['next face', (r) => Boolean(r.nextFace?.produced)],
];
const ok = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

function report(controlSha: string, buildSha: string): { verdict: string; inconclusive: string[] } {
  const all = existsSync(RUNS)
    ? readFileSync(RUNS, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Run)
    : [];
  const runs = all.filter(
    (r) => r.set !== 'warmup' && (r.sha === controlSha || r.sha === buildSha),
  );
  const byPair = (set: Run['set']) => {
    const m = new Map<number, Run[]>();
    for (const r of runs.filter((x) => x.set === set))
      m.set(r.pair!, [...(m.get(r.pair!) ?? []), r]);
    return [...m.values()].filter((p) => p.length === 2);
  };
  const paired = byPair('paired')
    .map((p) => ({
      control: p.find((r) => r.side === 'control'),
      build: p.find((r) => r.side === 'build'),
    }))
    .filter((p): p is { control: Run; build: Run } => Boolean(p.control && p.build));
  // Control/control: the ratio second/first in run order.
  const noise = byPair('noise').map(
    (p) => [...p].sort((a, b) => a.at.localeCompare(b.at)) as [Run, Run],
  );
  const rows: Record<string, unknown>[] = [];
  const measures: Record<string, { verdict: string }> = {};
  for (const [name, get] of MEASURES) {
    const pairs = paired
      .map((p) => ({ control: get(p.control), candidate: get(p.build) }))
      .filter((p): p is { control: number; candidate: number } => ok(p.control) && ok(p.candidate));
    const noisePairs = noise
      .map(([a, b]) => ({ control: get(a), candidate: get(b) }))
      .filter((p): p is { control: number; candidate: number } => ok(p.control) && ok(p.candidate));
    const v = nw.measureVerdict({ pairs, noise: noisePairs }) as {
      verdict: string;
      reason?: string;
      ratio?: number;
      low?: number;
      high?: number;
      margin?: number;
      limit?: number;
    };
    const unmeasured = pairs.length === 0 && paired.length > 0;
    const verdict =
      v.verdict === 'untested' ? (unmeasured ? 'unmeasured' : 'inconclusive') : v.verdict;
    measures[name] = {
      verdict: verdict === 'passed' || verdict === 'failed' ? verdict : 'untested',
    };
    rows.push({
      cell: CELL,
      measure: name,
      pairs: pairs.length,
      noisePairs: noisePairs.length,
      controlMedian: median(pairs.map((p) => p.control)),
      buildMedian: median(pairs.map((p) => p.candidate)),
      ratio: v.ratio ?? null,
      low: v.low ?? null,
      high: v.high ?? null,
      margin: v.margin ?? (noisePairs.length >= nw.MIN_PAIRS ? nw.noiseMargin(noisePairs) : null),
      verdict,
      reason:
        v.reason ??
        (unmeasured
          ? 'no pair with a positive value on both sides (browser did not report it)'
          : ''),
    });
  }
  const reliabilityRuns = paired.flatMap((p) =>
    RESULTS.map(([what, produced]) => ({
      what,
      pair: p.control.pair,
      controlProduced: produced(p.control),
      candidateProduced: produced(p.build),
    })),
  );
  const reliability = nw.reliabilityVerdict(reliabilityRuns) as {
    verdict: string;
    lost?: number;
    runs?: number;
  };
  const lost = reliabilityRuns.filter((r) => r.controlProduced && !r.candidateProduced);
  const controlFailures = reliabilityRuns.filter((r) => !r.controlProduced);
  rows.push({
    cell: CELL,
    measure: 'reliability (face/photo produced on control and build)',
    pairs: paired.length,
    verdict:
      paired.length < nw.MIN_PAIRS && reliability.verdict === 'passed'
        ? 'inconclusive'
        : reliability.verdict,
    reason: lost.length
      ? `lost on build: ${lost.map((l) => `${l.what} pair ${l.pair}`).join(', ')}`
      : controlFailures.length
        ? `control did not produce: ${controlFailures.map((l) => `${l.what} pair ${l.pair}`).join(', ')}`
        : '',
  });
  const cell = nw.cellVerdict({ reliability, measures }) as { verdict: string };
  const anyFailed = rows.some((r) => r['verdict'] === 'failed');
  const cellVerdict = anyFailed ? 'failed' : cell.verdict === 'passed' ? 'passed' : 'inconclusive';
  const untestedCells = [
    {
      cell: 'eris-webgpu-chromium-facade',
      reason:
        'not run: the facade harness pins provider cpu and this runner drives headless Chromium only; needs a headed system Chromium WebGPU profile under the gpu-timing lock',
    },
    {
      cell: 'hosted-ubuntu-cpu-chromium-facade',
      reason:
        'not run: no runtime on hosted runners (the facade job runs on the self-hosted eris runner)',
    },
    {
      cell: 'android-emulator component lane',
      reason: 'not run: no paired driver for the mobile component lane',
    },
    {
      cell: 'ios-simulator component lane',
      reason: 'not run: no paired driver for the mobile component lane',
    },
    {
      cell: 'huawei-p30-pro component lane',
      reason: 'not run: no paired driver through tools/device-lab',
    },
  ];
  const inconclusive = rows
    .filter((r) => r['verdict'] === 'inconclusive' || r['verdict'] === 'unmeasured')
    .map((r) => `${CELL}: ${r['measure']} (${r['pairs']} pairs)`);
  const doc = {
    cell: CELL,
    host: hostname(),
    cpus: cpus().length,
    controlRev: controlSha,
    buildRev: buildSha,
    pairsCompleted: paired.length,
    noisePairsCompleted: noise.length,
    rule: 'fails when the 95% interval of build/control lies entirely above 1 + control/control noise margin; fewer than 5 pairs is inconclusive',
    cellVerdict,
    rows,
    reliabilityRuns,
    untestedCells,
    inconclusive,
  };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(doc, null, 2));
  const n = (x: unknown, d = 3) => (typeof x === 'number' ? x.toFixed(d) : '-');
  const big = (x: unknown) =>
    typeof x === 'number' ? (x >= 1e5 ? x.toExponential(3) : x.toFixed(0)) : '-';
  const md = [
    `### Paired facade comparison: ${CELL}`,
    '',
    `control ${controlSha.slice(0, 12)} (candidate bridge at the fm-pia9 facade commit) vs build ${buildSha.slice(0, 12)}; ${paired.length} ABBA pairs, ${noise.length} control/control pairs; host ${hostname()}`,
    '',
    '| cell | measure | pairs | control median | build median | ratio [95% interval] | margin | verdict |',
    '| --- | --- | ---: | ---: | ---: | --- | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r['cell']} | ${r['measure']} | ${r['pairs']} | ${big(r['controlMedian'])} | ${big(r['buildMedian'])} | ${r['ratio'] == null ? '-' : `${n(r['ratio'])} [${n(r['low'])}, ${n(r['high'])}]`} | ${n(r['margin'])} | ${r['verdict']}${r['reason'] ? ` (${r['reason']})` : ''} |`,
    ),
    '',
    `Cell verdict: **${cellVerdict}**`,
    '',
    'Untested cells (never passed):',
    ...untestedCells.map((u) => `- ${u.cell}: ${u.reason}`),
    ...(inconclusive.length
      ? ['', 'Inconclusive (never passed):', ...inconclusive.map((i) => `- ${i}`)]
      : []),
  ].join('\n');
  writeFileSync(join(OUT, 'report.md'), `${md}\n`);
  console.log(md);
  if (process.env['GITHUB_STEP_SUMMARY'])
    appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${md}\n`);
  return { verdict: cellVerdict, inconclusive };
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

// ---- main --------------------------------------------------------------------------------------------------------
const controlSha = sha(args['control-rev']!);
const buildSha = sha(args['build-rev']!);
if (!args['report-only']) {
  const started = Date.now();
  if (!existsSync(join(args.runtime!, 'manifest.json'))) {
    writeFileSync(
      join(OUT, 'untested.json'),
      JSON.stringify({ cell: CELL, reason: `no runtime at ${args.runtime}` }),
    );
    throw new Error(`untested: no acquired runtime at ${args.runtime}`);
  }
  const pins = execFileSync(
    process.execPath,
    [join(repo, 'scripts/runtime/check-pins.mjs'), '--runtime', args.runtime!],
    {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    },
  )
    .trim()
    .split('\n')
    .at(-1);
  log(`runtime pins: ${pins}`);
  const control = prepare(controlSha);
  const buildTree = prepare(buildSha);
  await bundle(control);
  await bundle(buildTree);
  log(`control ${control.sha} bundle ${control.bundle}`);
  log(`build ${buildTree.sha} bundle ${buildTree.bundle}`);
  const tree = (side: 'control' | 'build') => (side === 'control' ? control : buildTree);
  const record = (r: Run) => appendFileSync(RUNS, `${JSON.stringify(r)}\n`);
  const existing = existsSync(RUNS)
    ? readFileSync(RUNS, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Run)
    : [];
  const nextPair = (set: Run['set']) =>
    existing.filter((r) => r.set === set).reduce((m, r) => Math.max(m, (r.pair ?? -1) + 1), 0);
  const pairBase = nextPair('paired');
  const noiseBase = nextPair('noise');
  const pairs = Number(args.pairs);
  const noisePairs = Number(args['noise-pairs']);
  if (!args['no-warmup'])
    record(await runOnce(control, { set: 'warmup', pair: null, order: 'warmup', side: 'control' }));
  // ABBA order for the paired set (workload.ts), continuing the alternation across commands; control/control
  // pairs interleaved with them so both see the same drift.
  const abba = abbaSchedule(pairBase + Math.max(pairs, 1)).filter(
    (r) => r.pair !== null && r.pair >= pairBase,
  );
  for (let p = 0; p < Math.max(pairs, noisePairs); p++) {
    if (p < noisePairs)
      for (const order of ['A1', 'A2'])
        record(
          await runOnce(control, { set: 'noise', pair: noiseBase + p, order, side: 'control' }),
        );
    if (p < pairs)
      for (const s of abba.filter((r) => r.pair === pairBase + p))
        record(
          await runOnce(tree(s.side), {
            set: 'paired',
            pair: s.pair,
            order: s.order,
            side: s.side,
          }),
        );
  }
  log(`wall time ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
const { verdict } = report(controlSha, buildSha);
// Playwright and Vite can leave handles open after the last context closes; the evidence is written, so exit.
process.exit(verdict === 'failed' ? 1 : 0);
