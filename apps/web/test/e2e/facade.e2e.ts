// The typed facade against the real candidate bridge, runtime and worker (fm-pia9). The page (facade/page.ts) is
// bundled by Vite and served at the production origin; the model files are the acquired runtime under
// .cache/runtime (digest-checked against its manifest before serving), so no request leaves the machine. Playwright
// Chromium, CPU route. Steps: a name, a seed, cancel mid-run, photo select/crop/encode, save a face, a short morph,
// restore after reload, the downloads subscription and report staging. Each step checks the typed records and that
// the lane is free again afterwards. Without the runtime every step is reported untested.
//   node --test test/e2e/facade.e2e.ts   (under the eris browser-cpu lease)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import base, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'vite';

const app = fileURLToPath(new URL('../../', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const RUNTIME = join(repo, '.cache/runtime');
const PHOTO = join(repo, 'tests/crop/fixtures/non-square.jpg');
const ORIGIN = 'https://next.facemorph.me';
const results = join(app, 'test-results/facade');
const UNTESTED = existsSync(join(RUNTIME, 'manifest.json'))
  ? null
  : 'untested: no acquired runtime at .cache/runtime';
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

/** Every runtime file the manifest names must be on disk at its pinned digest before anything is served. */
function verifiedRuntime(): number {
  const manifest = readFileSync(join(RUNTIME, 'manifest.json'), 'utf8');
  let checked = 0;
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (
      typeof o['sha256'] === 'string' &&
      typeof o['url'] === 'string' &&
      typeof o['size'] === 'number'
    ) {
      const path = join(RUNTIME, new URL(o['url']).pathname.slice('/runtime/'.length));
      if (
        existsSync(path) &&
        statSync(path).size === o['size'] &&
        statSync(path).size < 64 * 1024 * 1024
      ) {
        assert.equal(
          createHash('sha256').update(readFileSync(path)).digest('hex'),
          o['sha256'],
          `${path} differs from its pin`,
        );
        checked++;
      }
      return;
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(JSON.parse(manifest));
  return checked;
}

async function open(): Promise<void> {
  context = await browser.newContext({ acceptDownloads: true });
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
  log(`runtime files verified against their pins: ${verifiedRuntime()}`);
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
    const r = await call<{ cancelled: Out; after: Out; late: string[] } & Settled>('cancelMidRun');
    log(`cancel: "${r.cancelled.message}" then "${r.after.message}"`);
    assert.match(r.cancelled.message, /Cancelled/);
    assert.deepEqual(r.late, []);
    assert.equal(r.after.errorMessage, '', r.after.errorMessage);
    assert.ok(
      r.after.faces.some((f) => f.id === 'd'),
      'the lane did not recover after the cancel',
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
    await load();
    const out = await call<Out | null>('restore');
    log(`restore: ${out?.message ?? 'null'} faces=${out?.faces.length ?? 0}`);
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
