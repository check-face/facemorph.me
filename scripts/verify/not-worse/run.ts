// Not-worse workload runner (fm-0q4h, slice 2): drives the real built UI of the control (and, when given, the build
// under test) in a real browser through the fixed visitor journey, detects every boundary from the DOM through the
// selector maps in workload.ts, takes its timestamps in the page, and writes one run.schema.json document plus the
// raw trace per scheduled run (ABBA order, a discarded warmup, a fresh profile per run).
//
//   python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 3600 -- \
//     node scripts/verify/not-worse/run.ts --control deploy-next --pairs 5 --provider cpu \
//       --browser chromium --label <fresh> --out /home/cdilga/Work/runs/facemorph-research
//
// Serving, the verified runtime, the network guard, the timing-lock check and artifact verification are the research
// drivers' (autoresearch/drivers/lib/*.mjs, as built-ui-paired.mjs uses them); journey.mjs's step helpers read the
// window.Worker instrumentation that the bead forbids (a mocked browser API), so the journey here is written against
// the DOM instead. Nothing is mocked or stubbed: the page-side code only observes (event listeners, a rAF loop, a
// PerformanceObserver) and the UI is driven with real pointer, keyboard and file-chooser input.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, loadavg, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BUILD_SELECTORS,
  CONTROL_SELECTORS,
  abbaSchedule,
  measures,
  reliability,
  type Boundary,
  type ScheduledRun,
  type SelectorMap,
  type Side,
  type TraceEvent,
} from './workload.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const lib = (name: string): Promise<Record<string, any>> =>
  import(new URL(`../../../autoresearch/drivers/lib/${name}`, import.meta.url).href);

/** The committed inputs: three typed words (the app derives each face from its word) and the one-face photo. */
const WORDS = ['lighthouse', 'meadow', 'harbour'] as const;
const PHOTO = {
  path: 'apps/web/src/public/preview/hello-1024.webp',
  sha256: '0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615',
};
/** The candidate's default morph length (the research drivers' 'video32' step); the played video's duration is recorded. */
const MORPH_FRAMES = 32;
const STAGE_MS = { face: 300_000, morph: 600_000, photo: 600_000, save: 120_000, page: 90_000 };

// ---- page side: observation only ---------------------------------------------------------------------------------
// Epoch milliseconds (timeOrigin + now) are the one clock for page and Node, so CDP latency never enters a timestamp.
const OBSERVE = `(() => {
  const nw = (window.__nw = { last: {}, inputs: [], gaps: [], longTasks: [], waits: [], origin: performance.timeOrigin });
  const now = () => performance.timeOrigin + performance.now();
  let pending = null;
  for (const ev of ['pointerdown', 'keydown', 'input', 'change', 'click'])
    addEventListener(ev, () => {
      nw.last[ev] = now();
      if (ev === 'pointerdown' || ev === 'keydown' || ev === 'input') pending ??= now();
    }, true);
  let prev = performance.now();
  const frame = (ts) => {
    const gap = ts - prev;
    prev = ts;
    if (gap > 100) nw.gaps.push({ t: now(), ms: gap });
    if (pending !== null) { nw.inputs.push({ t: pending, responseMs: now() - pending }); pending = null; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) nw.longTasks.push({ t: performance.timeOrigin + e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // The person's answers to the consent toast, the download dialog and (builds only) the confirmed-crop OK; the time
  // they stay up is a scripted wait.
  const seen = new Map();
  setInterval(() => {
    const targets = [
      document.querySelector('.next-download-dialog .next-download-accept'),
      document.querySelector('.next-encode-dialog .next-encode-confirmation .next-encode-ok'),
      document.querySelector('.next-consent-toast button[aria-label="Ask me later"]'),
      [...document.querySelectorAll('.next-model-toast button')].find((b) => b.textContent.trim() === 'Not now'),
    ];
    for (const el of targets) {
      if (!el) continue;
      if (!seen.has(el)) { const w = { t: now(), end: now() }; seen.set(el, w); nw.waits.push(w); }
      else seen.get(el).end = now();
      el.click();
    }
  }, 30);
})()`;

/** A rendered face surface's identity: a decoded image's URL, or an 8x8 downsample of a drawn canvas ('' if neither). */
const SIGNATURE = `(el) => {
  if (!el) return '';
  if (el.tagName === 'IMG') return el.complete && el.naturalWidth > 0 ? 'img:' + (el.currentSrc || el.src) : '';
  if (el.tagName !== 'CANVAS' || el.dataset.faceDrawn !== 'true') return '';
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.drawImage(el, 0, 0, 8, 8);
  return 'canvas:' + x.getImageData(0, 0, 8, 8).data.join(',');
}`;

/** True (as an epoch timestamp) once the boundary's condition holds; throws on the app's own error or a crop dialog. */
const BOUNDARY = `({ sel, cond, tile, before }) => {
  const signature = ${SIGNATURE};
  const err = document.querySelector('.next-error');
  if (err && err.innerText) throw new Error('app error: ' + err.innerText);
  if (document.querySelector('.next-crop-view')) throw new Error('the crop dialog opened');
  const sections = [...document.querySelectorAll('section.next-face')];
  const el = [...document.querySelectorAll(sel)].find((e) => tile === null || e.closest('section.next-face') === sections[tile]);
  if (!el) return false;
  let ok = false;
  if (cond === 'enabled') ok = !el.disabled;
  else if (cond === 'decoded') {
    // a new face: rendered, different from the one shown before the action, and its tile no longer working
    const sig = el.closest('section.next-face')?.classList.contains('next-face-active') ? '' : signature(el);
    ok = sig !== '' && sig !== before;
  }
  else if (cond === 'canplaythrough') ok = el.readyState >= 4 && el.videoWidth > 0 && Number.isFinite(el.duration);
  return ok ? performance.timeOrigin + performance.now() : false;
}`;

const MEMORY = `(async () => {
  try {
    if (!performance.measureUserAgentSpecificMemory) return null;
    const m = await performance.measureUserAgentSpecificMemory();
    return typeof m.bytes === 'number' ? m.bytes : null;
  } catch { return null; }
})()`;

// ---- Node side ---------------------------------------------------------------------------------------------------
// The slice of Playwright's API this runner uses; the module itself ships no types here.
interface Locator {
  click(o?: object): Promise<void>;
  fill(v: string): Promise<void>;
  waitFor(o?: object): Promise<void>;
  setInputFiles(f: object): Promise<void>;
  selectOption(v: string): Promise<unknown>;
  evaluate(fn: (e: { open: boolean }) => unknown): Promise<unknown>;
  getAttribute(n: string): Promise<string | null>;
  nth(i: number): Locator;
  last(): Locator;
  locator(s: string): Locator;
  getByRole(r: string, o: object): Locator;
  count(): Promise<number>;
}
interface Download {
  failure(): Promise<string | null>;
  path(): Promise<string>;
}
interface Page {
  goto(u: string, o?: object): Promise<unknown>;
  evaluate<T = unknown>(fn: string | ((a: never) => T), arg?: unknown): Promise<T>;
  waitForFunction(
    fn: string,
    arg: unknown,
    o: object,
  ): Promise<{ jsonValue(): Promise<unknown>; dispose(): Promise<void> }>;
  waitForEvent(n: string, o?: object): Promise<Download>;
  locator(s: string): Locator;
  getByRole(r: string, o: object): Locator;
  getByLabel(l: string): Locator;
  keyboard: { press(k: string): Promise<void> };
  on(ev: string, fn: (...a: never[]) => void): void;
  mainFrame(): unknown;
}
interface Context {
  pages(): Page[];
  newPage(): Promise<Page>;
  addInitScript(s: string | { content: string }): Promise<void>;
  on(ev: string, fn: (...a: never[]) => void): void;
  newCDPSession(p: Page): Promise<{ send(m: string, params: object): Promise<unknown> }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (n: Record<string, { bytes: number }>) =>
  Object.values(n).reduce((s, c) => s + c.bytes, 0);

interface RunTrace {
  readonly events: TraceEvent[];
  failure: string | null;
  readonly observations: {
    longTasks: { t: number; ms: number }[];
    memorySamples: (number | null)[];
    routeCaptions: string[];
    network: Record<string, { requests: number; bytes: number }>;
    videoDurationS: number | null;
  };
}

interface Cell {
  provider: 'cpu' | 'webgpu' | 'auto';
  browser: 'chromium' | 'system-chromium';
}

/** One scheduled run: a fresh profile, a cold visit (first face, next face, saves, morph, photo) and a return visit. */
async function execute(opts: {
  side: Side;
  artifactDir: string;
  source: string;
  selectors: SelectorMap;
  cell: Cell;
  profile: string;
  dir: string;
  photo: Buffer;
  runtime: string;
  session: Record<string, any>;
  playwright: { chromium: { launchPersistentContext(p: string, o: object): Promise<Context> } };
}): Promise<{ trace: RunTrace; browserVersion: string; userAgent: string }> {
  const { session, cell, selectors } = opts;
  const events: TraceEvent[] = [];
  const trace: RunTrace = {
    events,
    failure: null,
    observations: {
      longTasks: [],
      memorySamples: [],
      routeCaptions: [],
      network: {},
      videoDurationS: null,
    },
  };
  const t0 = Date.now();
  const rel = (epochMs: number) => Math.round((epochMs - t0) * 1000) / 1000;
  const server = await session.serve({
    artifact: opts.artifactDir,
    source: opts.source,
    runtime: opts.runtime,
    log: join(opts.dir, 'server.log'),
  });
  const headed = cell.provider === 'webgpu';
  const context = await opts.playwright.chromium.launchPersistentContext(opts.profile, {
    ...(cell.browser === 'system-chromium' ? { executablePath: session.CHROMIUM } : {}),
    headless: !headed,
    viewport: { width: 1280, height: 960 },
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      // A visitor's browser reports navigator.webdriver false. Both the control and the build branch on it (full
      // canary and encoder qualification, analytics eligibility), so an automated page would time a path no
      // visitor runs. Both sides launch here, so both measure the visitor path; the trace proves it below.
      '--disable-blink-features=AutomationControlled',
      ...(await import(
        new URL('../../../apps/web/test/parity/control-server.ts', import.meta.url).href
      ).then((m: { chromiumArgs: string[] }) => m.chromiumArgs)),
      ...(headed
        ? [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,WebGPU',
            '--use-angle=vulkan',
            '--ignore-gpu-blocklist',
          ]
        : []),
    ],
  });
  let page: Page | undefined;
  let browserVersion = 'unknown';
  let userAgent = '';
  let failed = true;
  try {
    await (context as unknown as { tracing: { start(o: object): Promise<void> } }).tracing.start({
      screenshots: true,
      snapshots: true,
    });
    trace.observations.network = await session.guardNetwork(context);
    await context.addInitScript(OBSERVE);
    page = context.pages()[0] ?? (await context.newPage());
    const p = page;
    let navigations = 0;
    let scripted = 0;
    // A reload is a new document. framenavigated also fires for same-document history entries, which the build's
    // dialogs push and pop (Back closes a dialog), so only document loads are counted.
    p.on('domcontentloaded', (() => {
      navigations++;
      if (navigations > scripted)
        events.push({ t: rel(Date.now()), kind: 'reload', detail: 'unscripted navigation' });
    }) as never);
    p.on('crash', (() => events.push({ t: rel(Date.now()), kind: 'crash' })) as never);
    p.on('pageerror', ((e: { message: string }) => {
      events.push({ t: rel(Date.now()), kind: 'uncaught-error', detail: e.message.slice(0, 300) });
      if (/out of memory|allocation failed|memory access out of bounds/i.test(e.message))
        events.push({ t: rel(Date.now()), kind: 'oom', detail: e.message.slice(0, 300) });
    }) as never);
    p.on('console', ((m: { type(): string; text(): string }) => {
      if (m.type() === 'error' && /out of memory/i.test(m.text()))
        events.push({ t: rel(Date.now()), kind: 'oom', detail: m.text().slice(0, 300) });
    }) as never);

    const tile = (i: number) => p.locator('section.next-face').nth(i);
    const lastAt = (kind: string) =>
      p.evaluate<number>(`window.__nw.last[${JSON.stringify(kind)}]`);
    const wait = (from: number, to: number) =>
      events.push({ t: rel(from), kind: 'wait', end: rel(to) });

    /** Pull what the page observed so far (it is lost on navigation). */
    const drain = async () => {
      const d = await p.evaluate<{
        inputs: { t: number; responseMs: number }[];
        gaps: { t: number; ms: number }[];
        longTasks: { t: number; ms: number }[];
        waits: { t: number; end: number }[];
      }>(
        `(() => { const n = window.__nw; const o = { inputs: n.inputs, gaps: n.gaps, longTasks: n.longTasks, waits: n.waits };
          n.inputs = []; n.gaps = []; n.longTasks = []; n.waits = []; return o; })()`,
      );
      for (const i of d.inputs)
        events.push({ t: rel(i.t), kind: 'input', responseMs: Math.round(i.responseMs * 10) / 10 });
      for (const g of d.gaps)
        events.push({ t: rel(g.t), kind: 'paint-gap', ms: Math.round(g.ms * 10) / 10 });
      for (const w of d.waits) wait(w.t, w.end);
      for (const l of d.longTasks) trace.observations.longTasks.push({ t: rel(l.t), ms: l.ms });
    };
    const memory = async () => {
      const bytes = await p.evaluate<number | null>(MEMORY);
      trace.observations.memorySamples.push(bytes);
      events.push({ t: rel(Date.now()), kind: 'memory', bytes });
    };
    const boundary = async (
      name: Boundary,
      tileIndex: number | null,
      before: string,
      timeout: number,
    ) => {
      const s = selectors[name];
      const handle = await p.waitForFunction(
        `(${BOUNDARY})(${JSON.stringify({ sel: s.selector, cond: s.condition, tile: tileIndex, before })})`,
        null,
        { timeout, polling: 10 },
      );
      const at = (await handle.jsonValue()) as number;
      await handle.dispose();
      events.push({ t: rel(at), kind: 'boundary', name });
    };
    const srcOf = (i: number) =>
      p.evaluate<string>(
        `(${SIGNATURE})(document.querySelectorAll('section.next-face')[${i}]?.querySelector('.next-face-img:not([data-public-preview])'))`,
      );

    const open = async (action: string) => {
      scripted++;
      await p.goto(`https://next.facemorph.me/`, { waitUntil: 'commit' });
      events.push({
        t: rel(await p.evaluate<number>('window.__nw.origin')),
        kind: 'action',
        name: action,
      });
      await boundary('usable-page', null, '', STAGE_MS.page);
      await p.waitForFunction(
        `document.querySelector('.next-product')?.getAttribute('data-next-busy') === 'false'`,
        null,
        { timeout: STAGE_MS.page, polling: 10 },
      );
      await p.getByRole('button', { name: 'More options', exact: true }).click();
      // The control keeps the processing mode under Advanced; the build has it above the faces (fm-5kpx).
      if (await p.locator('.next-advanced').count())
        await p.locator('.next-advanced').evaluate((e) => (e.open = true));
      await p.getByLabel('Processing mode').selectOption(cell.provider);
      await p.keyboard.press('Escape');
    };
    const routeCheck = async () => {
      const actual = await p
        .locator('.next-route-caption')
        .getAttribute('data-next-route')
        .catch(() => null);
      if (actual === null) return;
      trace.observations.routeCaptions.push(actual);
      events.push({
        t: rel(Date.now()),
        kind: 'route',
        requested: cell.provider,
        actual: /cpu/i.test(actual) ? 'cpu' : 'webgpu',
      });
    };
    const generate = async (
      i: number,
      word: string,
      action: string,
      produced: 'face' | undefined = 'face',
    ) => {
      const before = await srcOf(i);
      await tile(i).locator('.next-field input').fill(word);
      await tile(i).locator('.next-face-generate').click();
      events.push({ t: rel(await lastAt('click')), kind: 'action', name: action });
      await boundary('face-rendered', i, before, STAGE_MS.face);
      if (produced) events.push({ t: rel(Date.now()), kind: 'produced', what: produced });
    };
    const save = async (action: string) => {
      const pending = p.waitForEvent('download', { timeout: STAGE_MS.save });
      await tile(0).getByRole('button', { name: 'Save image' }).click();
      events.push({ t: rel(await lastAt('click')), kind: 'action', name: action });
      const file = await pending;
      const failure = await file.failure();
      if (failure) throw new Error(`download failed: ${failure}`);
      await file.path();
      events.push({ t: rel(Date.now()), kind: 'boundary', name: 'save-ready' });
    };
    const bytesMark = async (visit: 'first' | 'return', before: number) => {
      await sleep(400); // request sizes arrive asynchronously
      const total = sum(trace.observations.network);
      events.push({ t: rel(Date.now()), kind: 'bytes', visit, bytes: total - before });
      return total;
    };

    try {
      // Visit 1: a fresh profile, so everything below the first face is cold.
      await open('navigate');
      browserVersion =
        /(?:Chrome|Chromium)\/([\d.]+)/.exec(
          await p.evaluate<string>('navigator.userAgent'),
        )?.[1] ?? 'unknown';
      userAgent = await p.evaluate<string>('navigator.userAgent');
      if (await p.evaluate<boolean>('navigator.webdriver === true'))
        throw new Error(
          'navigator.webdriver is true: this page would time the automation path, not the visitor path',
        );
      await generate(0, WORDS[0], 'generate-cold');
      await routeCheck();
      await generate(1, WORDS[1], 'generate-next');
      await save('save-first');
      await save('save-repeat');

      await p.locator('.next-primary-action').click();
      events.push({ t: rel(await lastAt('click')), kind: 'action', name: 'create-morph' });
      await boundary('morph-playable', null, '', STAGE_MS.morph);
      events.push({ t: rel(Date.now()), kind: 'produced', what: 'video' });
      trace.observations.videoDurationS = await p.evaluate<number | null>(
        `(() => { const v = document.querySelector('video.next-video'); return v ? v.duration : null; })()`,
      );
      await memory();

      const photoBefore = await srcOf(1);
      const stamp = Date.now();
      // The control's photo input is 'Choose photo'; the build's face card is the entry, 'Encode image' (fm-25um).
      await tile(1)
        .locator(
          'input[type="file"][aria-label="Choose photo"], input[type="file"][aria-label="Encode image"]',
        )
        .last()
        .setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: opts.photo });
      events.push({
        t: rel((await lastAt('change').catch(() => stamp)) || stamp),
        kind: 'action',
        name: 'confirm-photo',
      });
      await boundary('photo-face-rendered', 1, photoBefore, STAGE_MS.photo);
      events.push({ t: rel(Date.now()), kind: 'produced', what: 'photo-face' });
      await memory();
      await drain();
      const firstBytes = await bytesMark('first', 0);

      // Visit 2: the same profile with its downloaded models (Cache Storage, OPFS) kept and the saved session
      // (IndexedDB) and local storage dropped, as the device lab's warm face: a restored session disables the field.
      scripted++;
      await p.goto('about:blank');
      await (
        await context.newCDPSession(p)
      ).send('Storage.clearDataForOrigin', {
        origin: 'https://next.facemorph.me',
        storageTypes: 'indexeddb,local_storage',
      });
      await open('navigate-return');
      // A word not generated before in this profile, so no earlier result of it can be reused.
      await generate(0, WORDS[2], 'generate-warm');
      await memory();
      await drain();
      await bytesMark('return', firstBytes);
      failed = false;
    } catch (error) {
      trace.failure = error instanceof Error ? error.message : String(error);
      await drain().catch(() => undefined);
    }
  } finally {
    const kept = await session.finish(context, { failed, dir: opts.dir }).catch(() => []);
    if (kept.length) trace.observations.routeCaptions.push(`kept:${kept.join(',')}`);
    await server.stop();
  }
  return { trace, browserVersion, userAgent };
}

// ---- main --------------------------------------------------------------------------------------------------------
const { values: opt } = parseArgs({
  options: {
    control: { type: 'string' },
    'control-digest': { type: 'string' },
    build: { type: 'string' },
    'build-digest': { type: 'string' },
    'build-source': { type: 'string' },
    pairs: { type: 'string', default: '5' },
    // Adaptive (fm-mc27): with --margins (a JSON {measure: margin} from the cell's control/control run), inconclusive
    // measures get more pairs, two at a time, up to --max-pairs (default the gate's MAX_PAIRS).
    'max-pairs': { type: 'string' },
    margins: { type: 'string' },
    provider: { type: 'string', default: 'cpu' },
    browser: { type: 'string', default: 'chromium' },
    label: { type: 'string' },
    out: { type: 'string' },
    runtime: { type: 'string' },
    // The cell's device label in the run documents (default: the host name), e.g. where a container hides the host.
    device: { type: 'string' },
  },
});
if (!opt.label) throw new Error('--label <fresh run label> is required');
if (!['cpu', 'webgpu', 'auto'].includes(opt.provider!))
  throw new Error('--provider is cpu, webgpu or auto');
if (!['chromium', 'system-chromium'].includes(opt.browser!))
  throw new Error('--browser is chromium or system-chromium');
const cell: Cell = {
  provider: opt.provider as Cell['provider'],
  browser: opt.browser as Cell['browser'],
};

const artifact = await lib('artifact.mjs');
const session = await lib('session.mjs');
const journey = await lib('journey.mjs');
const control = {
  ...artifact.verifyArtifact(
    resolve(opt.control ?? join(REPO, artifact.CONTROL.path)),
    opt['control-digest'] ?? (opt.control ? undefined : artifact.CONTROL.treeSha256),
  ),
  source: artifact.CONTROL.source as string,
};
const build = opt.build
  ? {
      ...artifact.verifyArtifact(resolve(opt.build), opt['build-digest']),
      source: opt['build-source'] ?? `artifact:${opt['build-digest']}`,
    }
  : { ...control };
const timing = artifact.requireTimingLock();
const runtime = session.verifiedRuntime(resolve(opt.runtime ?? join(REPO, '.cache/runtime')));
const photo = readFileSync(join(REPO, PHOTO.path));
if (journey.sha(photo) !== PHOTO.sha256)
  throw new Error('the committed photo is not the recorded one');
const out: string = artifact.freshRunDir(artifact.outRoot(opt.out), opt.label);
const playwright = createRequire(join(REPO, 'apps/web/package.json'))('playwright');

const schedule = abbaSchedule(Number(opt.pairs));
const cellName = `${cell.provider}-${cell.browser}`;
const results: {
  run: ScheduledRun;
  file: string;
  values: Record<string, number | null>;
  failure: string | null;
}[] = [];

/** A WebGPU cell without an adapter is recorded untested with the reason, never run as something else. */
async function adapterGate(): Promise<string | null> {
  if (cell.provider !== 'webgpu') return null;
  const server = await session.serve({
    artifact: control.dir,
    source: control.source,
    runtime: runtime.dir,
    log: join(out, 'adapter-server.log'),
  });
  const profile = join(out, 'profiles', 'adapter');
  const { chromiumArgs } = (await import(
    new URL('../../../apps/web/test/parity/control-server.ts', import.meta.url).href
  )) as { chromiumArgs: string[] };
  const context = (await playwright.chromium.launchPersistentContext(profile, {
    ...(cell.browser === 'system-chromium' ? { executablePath: session.CHROMIUM } : {}),
    headless: false,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      ...chromiumArgs,
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU',
      '--use-angle=vulkan',
      '--ignore-gpu-blocklist',
    ],
  })) as Context & { close(): Promise<void> };
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://next.facemorph.me/', { waitUntil: 'commit' });
    const info = await session.adapterInfo(page);
    console.log(JSON.stringify({ cell: cellName, adapter: info }));
    return info ? null : 'navigator.gpu.requestAdapter() returned null for 15 s';
  } finally {
    await context.close();
    await server.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}

const gate = await adapterGate();
if (gate) {
  writeFileSync(
    join(out, 'untested.json'),
    JSON.stringify({ cell: cellName, status: 'untested', reason: gate, timing }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ summary: { cell: cellName, untested: gate, out } }));
  process.exit(0);
}

async function runOne(run: (typeof schedule)[number]): Promise<void> {
  const art = run.side === 'control' ? control : build;
  const digest = art.treeSha256 as string;
  const selectors = digest === control.treeSha256 ? CONTROL_SELECTORS : BUILD_SELECTORS;
  const id = `${String(run.index).padStart(2, '0')}-${run.side}-${run.order}${run.pair === null ? '' : `-p${run.pair}`}`;
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  console.log(
    JSON.stringify({
      cell: cellName,
      run: id,
      side: run.side,
      digest,
      pair: run.pair,
      order: run.order,
      load: loadavg()[0],
    }),
  );
  const profile = join(out, 'profiles', id);
  const started = Date.now();
  const r = await execute({
    side: run.side,
    artifactDir: art.dir,
    source: art.source,
    selectors,
    cell,
    profile,
    dir,
    photo,
    runtime: runtime.dir,
    session,
    playwright,
  });
  rmSync(profile, { recursive: true, force: true });
  const m = measures(r.trace.events, MORPH_FRAMES);
  const rel = reliability(r.trace.events);
  const doc = {
    schema: 'facemorph.not-worse-run/1',
    cell: {
      device: opt.device ?? hostname(),
      os: `${platform()} ${release()}`,
      browser: cell.browser,
      browserVersion: r.browserVersion,
      provider: cell.provider,
      cacheState: 'cold',
    },
    digests: { control: control.treeSha256, build: build.treeSha256 },
    runs: [{ ...run, measures: m, reliability: rel }],
  };
  writeFileSync(join(out, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
  writeFileSync(
    join(out, `${id}.trace.json`),
    JSON.stringify(
      {
        morphFrames: MORPH_FRAMES,
        words: WORDS,
        photoSha256: PHOTO.sha256,
        userAgent: r.userAgent,
        elapsedMs: Date.now() - started,
        failure: r.trace.failure,
        events: r.trace.events,
        observations: r.trace.observations,
      },
      null,
      2,
    ) + '\n',
  );
  results.push({
    run,
    file: `${id}.json`,
    values: { ...m.values, bytesFirst: m.bytes.first, bytesReturn: m.bytes.return },
    failure: r.trace.failure,
  });
  console.log(
    JSON.stringify({
      cell: cellName,
      run: id,
      done: true,
      failure: r.trace.failure,
      values: m.values,
      lockups: m.lockups,
    }),
  );
}
for (const run of schedule) await runOne(run);

// Adaptive pairs: while a measure is inconclusive and the cell is under the maximum, run two more ABBA pairs.
const nw = (await import(new URL('../not-worse.mjs', import.meta.url).href)) as {
  MAX_PAIRS: number;
  extendPlan(o: object): { verdicts: Record<string, Record<string, unknown>>; more: number };
};
const margins: Record<string, number> | null = opt.margins
  ? JSON.parse(readFileSync(opt.margins, 'utf8'))
  : null;
const maxPairs = Number(opt['max-pairs'] ?? nw.MAX_PAIRS);
let pairsRun = Number(opt.pairs);
/** Each measure's {control, candidate} pairs from the finished, unfailed runs. */
const paired = () => {
  const byPair = new Map<number, Record<string, (typeof results)[number]>>();
  for (const r of results)
    if (r.run.pair !== null && !r.failure)
      byPair.set(r.run.pair, { ...byPair.get(r.run.pair), [r.run.side]: r });
  return Object.fromEntries(
    Object.entries(margins ?? {}).map(([name, noise]) => [
      name,
      {
        noise,
        pairs: [...byPair.values()].flatMap((p) => {
          const control = p['control']?.values[name],
            candidate = p['build']?.values[name];
          return typeof control === 'number' &&
            control > 0 &&
            typeof candidate === 'number' &&
            candidate > 0
            ? [{ control, candidate }]
            : [];
        }),
      },
    ]),
  );
};
let plan = margins ? nw.extendPlan({ measures: paired(), maxPairs }) : null;
while (plan && plan.more > 0 && pairsRun < maxPairs) {
  const more = Math.min(plan.more, maxPairs - pairsRun);
  console.log(JSON.stringify({ cell: cellName, adaptive: { pairs: pairsRun, more } }));
  for (const run of abbaSchedule(pairsRun + more).filter(
    (r) => r.pair !== null && r.pair >= pairsRun,
  ))
    await runOne(run);
  pairsRun += more;
  plan = nw.extendPlan({ measures: paired(), maxPairs });
}
if (plan) {
  const adaptive = { pairs: pairsRun, maxPairs, margins, verdicts: plan.verdicts };
  writeFileSync(join(out, 'adaptive.json'), JSON.stringify(adaptive, null, 2) + '\n');
  console.log(JSON.stringify({ cell: cellName, adaptive }));
}
rmSync(join(out, 'profiles'), { recursive: true, force: true });

// Per-measure medians per side, the raw paired values, the per-pair ratio spread and, for control/control, the cell's
// noise margin per measure (summary.mjs, with the gate's own noiseMargin rule).
const { summarizeDir } = (await import(new URL('./summary.mjs', import.meta.url).href)) as {
  summarizeDir(
    dir: string,
    extra: object,
  ): { measures: Record<string, { noiseMargin?: number | null }> };
};
const summary = summarizeDir(out, { cell: cellName, pairs: pairsRun, timing });
console.log(
  JSON.stringify({
    cell: cellName,
    noiseMargins: Object.fromEntries(
      Object.entries(summary.measures).map(([k, v]) => [k, v.noiseMargin ?? null]),
    ),
  }),
);
console.log(JSON.stringify({ summary: { cell: cellName, out, runs: results.length } }));
if (results.some((r) => r.failure)) process.exitCode = 1;
