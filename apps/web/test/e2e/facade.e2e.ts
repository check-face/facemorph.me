// The typed facade against the real candidate bridge, runtime and worker (fm-pia9). The page (facade/page.ts) is
// bundled by Vite and served at the production origin; the model files are the acquired runtime under
// .cache/runtime (digest-checked against its manifest before serving), so no request leaves the machine. Playwright
// Chromium, CPU route. Steps: a name, a seed, cancel mid-run, photo select/crop/encode, save a face, a short morph,
// restore after reload, the downloads subscription and report staging. Each step checks the typed records and that
// the lane is free again afterwards. Without the runtime every step is reported untested.
//   node --test test/e2e/facade.e2e.ts   (under the eris browser-cpu lease)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import base, { after, afterEach, before, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page, type Worker } from 'playwright';
import { build } from 'vite';

const app = fileURLToPath(new URL('../../', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const RUNTIME = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(repo, '.cache/runtime');
const PHOTO = join(repo, 'tests/crop/fixtures/non-square.jpg');
const ORIGIN = 'https://next.facemorph.me';
const results = join(app, 'test-results/facade');
const UNTESTED = existsSync(join(RUNTIME, 'manifest.json'))
  ? null
  : `untested: no acquired runtime at ${RUNTIME}`;
if (UNTESTED && process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw new Error(UNTESTED);
const test = ((name: string, ...rest: unknown[]) =>
  UNTESTED
    ? base(name, { skip: UNTESTED }, () => {})
    : (base as (...a: unknown[]) => unknown)(name, ...rest)) as unknown as typeof base;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
};
const log = (line: string) => console.log(`# ${line}`);

let bundleDir = '';
let browser: Browser;
let context: BrowserContext;
let page: Page;
const counts = new Map<string, number>();
let pageErrors: string[] = [];
const liveWorkers = new Set<Worker>();
let workersStarted = 0;
let workersClosed = 0;

/** Every runtime file the manifest names must be on disk at its pinned digest before anything is served. */
function verifiedRuntime(): void {
  // Reuse the complete acquisition inventory, including chunks and nested photo/encoder assets.
  // A manifest-only walk previously skipped missing files, chunked assets and files above 64 MiB.
  mkdirSync(results, { recursive: true });
  const report = join(results, 'runtime-pins.jsonl');
  const output = openSync(report, 'w');
  try {
    execFileSync(
      process.execPath,
      [join(repo, 'scripts/runtime/check-pins.mjs'), '--runtime', RUNTIME],
      {
        stdio: ['ignore', output, 'pipe'],
        timeout: 120_000,
      },
    );
  } finally {
    closeSync(output);
  }
  log(`runtime pins: ${readFileSync(report, 'utf8').trim().split('\n').at(-1)}`);
}

async function open(): Promise<void> {
  context = await browser.newContext({ acceptDownloads: true });
  // Keep action/screenshot traces without copying the entire model download into each failure archive.
  await context.tracing.start({ screenshots: true, snapshots: false, sources: true });
  await context.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const file =
      path === '/photo.jpg'
        ? PHOTO
        : path.startsWith('/runtime/')
          ? join(RUNTIME, path.slice('/runtime/'.length))
          : join(bundleDir, path === '/' ? 'index.html' : path);
    if (!existsSync(file) || !statSync(file).isFile())
      return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      status: 200,
      body: readFileSync(file),
      headers: {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      },
    });
  });
  // Anything not at the origin (a third party, a CDN) is refused and counted.
  await context.route(
    (url) => !url.href.startsWith(ORIGIN),
    (route) => {
      counts.set(`external:${new URL(route.request().url()).host}`, 1);
      return route.abort();
    },
  );
  page = await context.newPage();
  page.on('worker', (worker) => {
    workersStarted++;
    liveWorkers.add(worker);
    worker.on('close', () => {
      workersClosed++;
      liveWorkers.delete(worker);
    });
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await load();
}
async function load(): Promise<void> {
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(
    () => (window as unknown as { harnessReady?: boolean }).harnessReady === true,
  );
}
const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, rest]) =>
      (
        (window as unknown as { harness: Record<string, (...a: unknown[]) => unknown> }).harness[
          name as string
        ] as (...a: unknown[]) => unknown
      )(...(rest as unknown[])),
    [fn, args] as const,
  ) as Promise<T>;

before(async () => {
  if (UNTESTED) return;
  verifiedRuntime();
  bundleDir = mkdtempSync(join(tmpdir(), 'facade-'));
  await build({
    root: join(app, 'test/e2e/facade'),
    configFile: false,
    logLevel: 'warn',
    build: { outDir: bundleDir, emptyOutDir: true, target: 'esnext', sourcemap: false },
    worker: { format: 'es' },
  });
  browser = await chromium.launch();
  await open();
});
after(async () => {
  if (UNTESTED) return;
  await context?.close();
  await browser?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});
beforeEach(async () => {
  if (!UNTESTED) await context.tracing.startChunk();
});
afterEach(async (t) => {
  if (UNTESTED || !context) return;
  log(
    `worker inventory ${t.name}: live=${liveWorkers.size} started=${workersStarted} closed=${workersClosed}`,
  );
  const name = t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100);
  if (!t.passed) await keep(name);
  await context.tracing.stopChunk(t.passed ? {} : { path: join(results, `${name}-trace.zip`) });
});

interface Out {
  faces: { id: string; url: string; raw: boolean; label: string }[];
  message: string;
  errorMessage: string;
  videoUrl: string;
  restored: boolean;
}
interface Settled {
  job: { facesDone: number; facesTotal: number };
  progressEvents: number;
  invalid: string[];
}
const free = (s: Settled, what: string) => {
  assert.deepEqual(s.invalid, [], `${what}: a bridge payload failed the facade's reader`);
  log(
    `settled ${what}: workers=${liveWorkers.size} started=${workersStarted} closed=${workersClosed}`,
  );
};
const keep = async (name: string) => {
  mkdirSync(results, { recursive: true });
  await page.screenshot({ path: join(results, `${name}.png`) }).catch(() => {});
};

test('cpu-name: a name becomes a typed Output with its face', { timeout: 600_000 }, async () => {
  try {
    const r = await call<{ out: Out } & Settled>('face', 'a', 'text', 'charlotte');
    log(`cpu-name: ${r.out.message} faces=${r.out.faces.length} progress=${r.progressEvents}`);
    assert.equal(r.out.errorMessage, '', r.out.errorMessage);
    assert.ok(r.out.faces.some((f) => f.id === 'a'));
    assert.ok(r.progressEvents > 0, 'no typed progress reached the subscriber');
    assert.ok((await call<number>('draw', 'a')) > 0);
    free(r, 'cpu-name');
  } catch (e) {
    await keep('cpu-name');
    throw e;
  }
});

test('cpu-seed: a seed becomes a typed Output', { timeout: 300_000 }, async () => {
  const r = await call<{ out: Out } & Settled>('face', 'b', 'seed', '42');
  log(`cpu-seed: ${r.out.message}`);
  assert.equal(r.out.errorMessage, '', r.out.errorMessage);
  assert.ok(r.out.faces.some((f) => f.id === 'b'));
  free(r, 'cpu-seed');
});

test(
  'cancel-mid-run: the cancelled face has no late result and the lane makes the next face',
  { timeout: 600_000 },
  async () => {
    // Completed-file encoding may continue when a later compute job is cancelled.
    const previousWorkers = [...liveWorkers].filter((worker) =>
      /\/ort-worker[-.]/.test(worker.url()),
    );
    assert.ok(
      previousWorkers.length > 0,
      `no compute worker: ${[...liveWorkers].map((worker) => worker.url()).join(', ')}`,
    );
    const closedBefore = workersClosed;
    const r = await call<{ cancelled: Out; after: Out; late: string[] } & Settled>('cancelMidRun');
    log(`cancel: "${r.cancelled.message}" then "${r.after.message}"`);
    assert.match(r.cancelled.message, /Cancelled/);
    assert.deepEqual(r.late, []);
    assert.equal(r.after.errorMessage, '', r.after.errorMessage);
    assert.ok(
      r.after.faces.some((f) => f.id === 'd'),
      'the lane did not recover after the cancel',
    );
    assert.ok(workersClosed > closedBefore, 'cancel did not close a real worker');
    assert.ok(
      previousWorkers.every((worker) => !liveWorkers.has(worker)),
      'a cancelled compute worker survived',
    );
    free(r, 'cancel');
  },
);

test(
  'photo-preview-crop-encode: a photo selected, cropped when needed and encoded on the CPU',
  { timeout: 1_200_000 },
  async () => {
    const r = await call<{ selection: string; out?: Out } & Partial<Settled>>(
      'photo',
      'p',
      `${ORIGIN}/photo.jpg`,
    );
    log(`photo: selection=${r.selection} ${r.out?.message ?? ''} ${r.out?.errorMessage ?? ''}`);
    assert.ok(['photo', 'crop'].includes(r.selection), `selection was ${r.selection}`);
    assert.ok(r.out, 'no Output');
    assert.equal(r.out.errorMessage, '', r.out.errorMessage);
    assert.ok(r.out.faces.some((f) => f.id === 'p'));
  },
);

test('save-face: Save hands the browser a file', { timeout: 120_000 }, async () => {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  const message = await call<string>('save', 'a');
  const file = await download;
  log(`save: "${message}" -> ${file.suggestedFilename()}`);
  assert.equal(message, 'Your file is ready to save.');
  assert.match(file.suggestedFilename(), /\.(png|webp)$/);
});

test(
  'export-short-morph: two faces become a short morph with a video',
  { timeout: 1_200_000 },
  async () => {
    const r = await call<{ out: Out; planned: number | null } & Settled>('morph', 'a', 'b');
    log(`morph: ${r.out.message} planned=${r.planned} video=${Boolean(r.out.videoUrl)}`);
    assert.equal(r.out.errorMessage, '', r.out.errorMessage);
    assert.ok(r.out.videoUrl.startsWith('blob:'), 'no video');
    free(r, 'morph');
  },
);

test(
  'restore-last: after a reload the faces come back as a typed Output',
  { timeout: 300_000 },
  async () => {
    // execute() settles compute before the asynchronous session writer finishes. Observe real durable storage.
    const deadline = Date.now() + 60_000;
    let retained = await call<boolean>('retained');
    while (!retained && Date.now() < deadline) {
      await page.waitForTimeout(100);
      retained = await call<boolean>('retained');
    }
    assert.equal(
      retained,
      true,
      `session not retained: ${JSON.stringify(await call('retentionFacts'))}`,
    );
    await load();
    const out = await call<Out | null>('restore');
    log(`restore: ${out?.message ?? 'null'} faces=${out?.faces.length ?? 0}`);
    if (!out) log(`retention: ${JSON.stringify(await call('retentionFacts'))}`);
    assert.ok(out, 'nothing restored');
    assert.equal(out.restored, true);
    assert.ok(out.faces.length > 0);
  },
);

test(
  'downloads-subscription: the model inventory arrives as a typed Downloads record',
  { timeout: 120_000 },
  async () => {
    const deadline = Date.now() + 60_000;
    let d: { known: boolean; routeReady: boolean } | null = null;
    while (Date.now() < deadline && !(d = await call('downloads'))?.known)
      await page.waitForTimeout(250);
    log(`downloads: ${JSON.stringify(d)}`);
    assert.ok(d?.known, 'no known Downloads record');
    assert.equal(d.routeReady, true, 'the CPU route used above is not reported ready');
  },
);

test(
  'report-staging: with reports on, a finished job stages a report',
  { timeout: 300_000 },
  async () => {
    const r = await call<{ staged: number; reference: string; answered: boolean }>('reports');
    log(
      `reports: ${JSON.stringify(r)} external=${[...counts.keys()].filter((k) => k.startsWith('external:')).join(',')}`,
    );
    assert.equal(r.answered, true);
    assert.ok(r.staged > 0 || r.reference !== '', 'nothing staged or referenced');
    assert.deepEqual(pageErrors, [], 'uncaught page errors');
    pageErrors = [];
  },
);

// This is the operation boundary over the real facade/runtime, not a service double.
test(
  'operation-service: queued CPU faces and a morph complete with scoped lifecycle events',
  { timeout: 600_000 },
  async () => {
    try {
      const r = await call<
        {
          results: { status: string; output?: Out }[];
          wrongIdentity: { status: string; cause?: { message: string } };
          removal: { status: string; output?: Out }[];
          removeEvents: string[];
          events: { type: string; provider: string | null; attempt: string }[];
        } & Settled
      >('serviceJourney');
      assert.deepEqual(
        r.results.map((x) => x.status),
        ['completed', 'completed', 'completed'],
      );
      assert.ok(r.results[2]?.output?.videoUrl);
      assert.equal(r.wrongIdentity.status, 'failed');
      assert.match(r.wrongIdentity.cause?.message ?? '', /Model setup changed/);
      assert.deepEqual(
        r.removal.map((x) => x.status),
        ['cancelled', 'completed'],
      );
      assert.ok(r.removeEvents.includes('admitted'));
      assert.ok(r.removeEvents.includes('progress'));
      assert.ok(r.removeEvents.includes('cancelled'));
      assert.equal(r.removeEvents.includes('compute-ready'), false);
      assert.equal(r.removeEvents.includes('file-ready'), false);
      assert.ok(!r.removal[1]?.output?.faces.some((f) => f.id === 'service-remove'));
      const attempts = [...new Set(r.events.map((e) => e.attempt))];
      assert.equal(attempts.length, 3);
      for (const attempt of attempts) {
        const events = r.events.filter((e) => e.attempt === attempt);
        assert.equal(events[0]?.type, 'queued');
        assert.equal(events.at(-1)?.type, 'settled');
        assert.ok(events.some((e) => e.type === 'compute-ready'));
        assert.ok(events.some((e) => e.type === 'file-ready'));
        assert.ok(events.filter((e) => e.type === 'admitted').every((e) => e.provider === 'cpu'));
      }
      assert.ok(
        r.events.some((e) => e.type === 'admitted' && e.provider === 'cpu'),
        'no actual CPU admission observed',
      );
      free(r, 'operation-service');
    } catch (error) {
      await keep('operation-service');
      throw error;
    }
  },
);
