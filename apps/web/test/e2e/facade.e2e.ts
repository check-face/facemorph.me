// The typed facade against the real candidate bridge, runtime and worker (fm-pia9). The page (facade/page.ts) is
// bundled by Vite and served at the production origin; the model files are the acquired runtime under
// .cache/runtime (digest-checked against its manifest before serving), so inference stays local; golden replay may load real project-owned gallery previews. Playwright
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import base, { after, afterEach, before, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Worker,
  type Route,
} from 'playwright';
import { press } from '../support/operate.ts';
import { build } from 'vite';
import { controlRows, fixture, verifyControl } from '../controller/control.ts';
import { replayFirstVisit, replayRows, type Replayers } from '../controller/replay.ts';
import { fetchControl } from '../../../../scripts/import/fetch-control.mjs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  embedRecovery as embedSchema2,
  readMp4Project,
  readRecovery,
} from '@facemorph/stylegan-js';
import { generationIdentity } from '../../src/Next/browser/identity.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const RUNTIME = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(repo, '.cache/runtime');
const PHOTO = join(repo, 'tests/crop/fixtures/non-square.jpg');
const NO_FACE = join(repo, 'tests/crop/fixtures/no-face.jpg');
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
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
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

async function open(publicGallery = false): Promise<void> {
  context = await browser.newContext({ acceptDownloads: true });
  // Keep action/screenshot traces without copying the entire model download into each failure archive.
  await context.tracing.start({ screenshots: true, snapshots: false, sources: true });
  await context.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const file =
      path === '/preview/hello-1024.webp'
        ? join(app, 'src/public/preview/hello-1024.webp')
        : path === '/catalogue.json'
          ? join(app, 'hosting/next-static/catalogue.json')
          : path === '/photo.jpg'
            ? PHOTO
            : path === '/no-face.jpg'
              ? NO_FACE
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
      if (
        publicGallery &&
        new URL(route.request().url()).hostname === 'facemorph-seed-gallery.cdilga.workers.dev'
      )
        return route.continue();
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
  cropFace: string | null;
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

test(
  'crop-fix-after-ok: a confirmed crop the detector cannot read runs real e4e exactly once, with no detection',
  { timeout: 1_200_000 },
  async () => {
    const r = await call<
      {
        selection: string;
        proposalCropFace?: string | null;
        out?: Out;
        detections?: number;
        encodes?: number;
      } & Partial<Settled>
    >('confirmedCrop', 'q', `${ORIGIN}/no-face.jpg`);
    log(
      `crop-fix: selection=${r.selection} proposal cropFace=${r.proposalCropFace} detections=${r.detections} encodes=${r.encodes} ${r.out?.errorMessage ?? ''}`,
    );
    assert.equal(r.proposalCropFace, 'q', 'before OK the typed no-face outcome asks for a crop');
    assert.ok(r.out, 'no Output');
    assert.equal(r.detections, 0, 'no detection pass after OK');
    assert.equal(r.encodes, 1, 'exactly one e4e attempt');
    assert.equal(r.out.cropFace, null, 'the crop does not reopen');
    assert.equal(r.out.errorMessage, '', r.out.errorMessage);
    assert.ok(r.out.faces.some((f) => f.id === 'q'));
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
    // execute settles compute before the telemetry POST settles. Observe its real
    // delivery state rather than requiring a reference in that same microtask.
    await page.waitForFunction(
      () => {
        const harness = (
          window as unknown as {
            harness: { reportStatus(): { reference: string } };
          }
        ).harness;
        return harness.reportStatus().reference !== '';
      },
      null,
      { timeout: 10000 },
    );
    const delivered = await call<typeof r>('reportStatus');
    log(
      `reports: ${JSON.stringify(r)} external=${[...counts.keys()].filter((k) => k.startsWith('external:')).join(',')}`,
    );
    assert.equal(r.answered, true);
    assert.ok(delivered.staged > 0 || delivered.reference !== '', 'nothing staged or referenced');
    assert.deepEqual(pageErrors, [], 'uncaught page errors');
    pageErrors = [];
  },
);

// This is the operation boundary over the real facade/runtime, not a service double.
test(
  'controller-photo: real queued crops, CPU encode and recovery-bearing Save/reopen',
  { timeout: 900_000 },
  async () => {
    await context.close();
    await open();
    const result = await call<{
      rejectionMessage: string;
      rejectionClearedPreparing: boolean;
      beforeConfirmation: {
        gate: boolean;
        jobId: number;
        sourceModes: string[];
        preparing: number;
      };
      cancelledSourceMode: string;
      editorBlocksConfirmation: boolean;
      adjustmentCancelled: boolean;
      queued: string[];
      cancelledUrlReleased: boolean;
      nextShown: string;
      encoded: boolean;
      sourceMode: string;
      route: string;
      hasCrop: boolean;
      preparing: number;
    }>('controllerPhotoJourney');
    assert.equal(result.rejectionMessage, 'Choose a photo.');
    assert.equal(result.rejectionClearedPreparing, true);
    assert.deepEqual(result.beforeConfirmation, {
      gate: false,
      jobId: 0,
      sourceModes: ['text', 'text'],
      preparing: 0,
    });
    assert.equal(result.cancelledSourceMode, 'text');
    assert.equal(result.editorBlocksConfirmation, true);
    assert.equal(result.adjustmentCancelled, true);
    assert.deepEqual(result.queued, ['face-2']);
    assert.equal(result.cancelledUrlReleased, true);
    assert.equal(result.nextShown, 'face-2');
    assert.equal(result.encoded, true);
    assert.equal(result.sourceMode, 'photo');
    assert.equal(result.route, 'cpu');
    assert.equal(result.hasCrop, false);
    assert.equal(result.preparing, 0);
    const ready = page.waitForEvent('download', { timeout: 60_000 });
    await call('save', 'face-2');
    const download = await ready;
    const path = await download.path();
    assert.ok(path, 'real Save download missing');
    const recovered = await call<{
      id: string;
      mode: string;
      jobId: number;
      busy: boolean;
      hasFace: boolean;
      preparing: number;
    }>('controllerRecoveryJourney', Array.from(readFileSync(path)));
    assert.deepEqual(recovered, {
      id: 'face-1',
      mode: 'project',
      jobId: 0,
      busy: false,
      hasFace: true,
      preparing: 0,
    });
  },
);
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
/** The candidate's schema-1 PNG record (classic a42829b recovery-metadata.mjs decorateImage), seed as the bridge
 * held it: the seed field's text. */
function schema1Png(
  png: Uint8Array,
  r: { latent: Float32Array; seed: string } & Record<string, unknown>,
) {
  const raw = Buffer.from(r.latent.buffer, r.latent.byteOffset, r.latent.byteLength);
  const record = {
    schema: 1,
    kind: 'facemorph-image-v1',
    seed: r.seed,
    latent: { space: 'w-plus', shape: [18, 512], values: Array.from(r.latent) },
    provenance: r['provenance'],
    generationKind: r['generationKind'],
    generationSha256: r['generationSha256'],
    imageSha256: sha256(png),
    latentSha256: sha256(raw),
  };
  const data = Buffer.concat([Buffer.from('FaceMorph\0'), Buffer.from(JSON.stringify(record))]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const iend = png.length - 12;
  return new Uint8Array(Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]));
}

test(
  'file-entry: earlier saved stills (schema 1 PNG, schema 2 PNG and WebP) reopen without inference; Save keeps the exact latent and model',
  { timeout: 300_000 },
  async () => {
    await context.close();
    await open();
    const manifestBytes = readFileSync(join(RUNTIME, 'manifest.json'));
    const m = JSON.parse(manifestBytes.toString('utf8'));
    const identity = {
      provenance: {
        bundleVersion: m.bundleVersion,
        manifestSha256: sha256(manifestBytes),
        modelSha256: m.modelSourceSha256,
        noiseSha256: m.noiseSha256,
        route: 'cpu',
        truncationPsi: 0.7,
      },
      generationKind: 'seed' as const,
      generationSha256: sha256(JSON.stringify(generationIdentity(m, 'seed'))),
    };
    const fixture = (name: string) => {
      const r = readRecovery(
        new Uint8Array(readFileSync(join(app, 'test/fixtures/verify/stills', name))),
      );
      if (r.kind !== 'parsed') throw new Error(`fixture ${name}: ${r.kind}`);
      return r.recovered;
    };
    const png = fixture('recovery-v2.png'),
      webp = fixture('recovery-v2.webp');
    const latent = png.latent.values;
    const v2 = (base: typeof png) =>
      embedSchema2(base.baseImage, {
        ...identity,
        latent: { space: 'w-plus', shape: [18, 512], values: latent },
        seed: 42,
      });
    const files = [
      [
        'saved-v1.png',
        'image/png',
        schema1Png(png.baseImage, { ...identity, latent, seed: '42' }),
        1,
      ],
      ['saved-v2.png', 'image/png', v2(png), 2],
      ['saved-v2.webp', 'image/webp', v2(webp), 2],
    ] as const;
    let ortStarted = 0;
    page.on('worker', (w) => {
      if (/ort-worker/.test(w.url())) ortStarted++;
    });
    for (const [index, [name, type, bytes, schema]] of files.entries()) {
      assert.equal(
        (readRecovery(bytes) as { recovered: { schemaVersion: number } }).recovered.schemaVersion,
        schema,
      );
      const id = `saved-${index + 1}`;
      const out = await call<{
        kind?: string;
        error?: string;
        faces: { id: string; label: string; url: boolean }[];
        message: string;
        jobEvents: number;
        invalid: string[];
      }>('reopenSaved', id, Array.from(bytes), name, type);
      log(`reopen ${name}: ${JSON.stringify(out)}`);
      assert.equal(out.error, undefined, `${name}: ${out.error}`);
      assert.equal(out.kind, 'recovered', name);
      assert.equal(out.message, 'Saved face recovered without photo encoding.');
      assert.ok(
        out.faces.some((f) => f.id === id && f.url && f.label === 'Saved face'),
        name,
      );
      assert.equal(out.jobEvents, 0, `${name}: no job ran`);
      assert.deepEqual(out.invalid, []);
      const ready = page.waitForEvent('download', { timeout: 60_000 });
      await call('save', id);
      const path = await (await ready).path();
      const saved = readRecovery(new Uint8Array(readFileSync(path)));
      assert.equal(saved.kind, 'parsed', `${name}: Save after reopening carries recovery`);
      if (saved.kind !== 'parsed') return;
      const r = saved.recovered;
      log(`save after ${name}: schema ${r.schemaVersion} ${r.mime} ${r.width}x${r.height}`);
      assert.equal(r.schemaVersion, 3, `${name}: Save writes schema 3`);
      assert.deepEqual([r.width, r.height], [1024, 1024]);
      assert.ok(
        Buffer.from(r.latent.values.buffer).equals(
          Buffer.from(latent.buffer, latent.byteOffset, latent.byteLength),
        ),
        `${name}: exact latent`,
      );
      assert.equal(r.provenance.modelSha256, m.modelSourceSha256);
      assert.equal(r.provenance.noiseSha256, m.noiseSha256);
      assert.equal(r.model?.modelSha256, m.modelSourceSha256);
      assert.equal(r.model?.name, 'stylegan2-ffhq-config-f');
      assert.deepEqual(r.model?.latent, { space: 'w-plus', layers: 18, width: 512 });
      assert.equal(r.generationSha256, identity.generationSha256);
    }
    assert.equal(ortStarted, 0, 'reopening and saving started no inference worker');
    // A file from another checkpoint is refused at the entry, never installed.
    const other = readFileSync(join(app, 'test/fixtures/verify/stills/model-mismatch-v2.png'));
    const refused = await call<{ error?: string; jobEvents: number }>(
      'reopenSaved',
      'saved-other',
      Array.from(other),
      'other.png',
      'image/png',
    );
    assert.equal(refused.error, 'This saved face uses a different model.');
    assert.equal(refused.jobEvents, 0);
  },
);
test(
  'file-entry-mp4: a saved morph carries the schema-2 project with the writer route; it reopens as its project',
  { timeout: 1_200_000 },
  async () => {
    await context.close();
    await open();
    const r = await call<{ out: Out } & Settled>('morph', 'mp4-a', 'mp4-b');
    assert.equal(r.out.errorMessage, '', r.out.errorMessage);
    const ready = page.waitForEvent('download', { timeout: 120_000 });
    await call('save', 'video');
    const bytes = new Uint8Array(readFileSync((await (await ready).path())!));
    const saved = readMp4Project(bytes);
    assert.equal(saved.kind, 'parsed', JSON.stringify(saved));
    if (saved.kind !== 'parsed' || saved.project.schemaVersion !== 2)
      throw new Error('not schema 2');
    const p = saved.project;
    log(
      `saved mp4: ${bytes.length} bytes video=${JSON.stringify(p.video)} controls=${p.morph.controls.length}`,
    );
    assert.deepEqual([p.video.width, p.video.height], [saved.video.width, saved.video.height]);
    assert.equal(p.video.frameCount, saved.video.frameCount);
    assert.ok(['webcodecs', 'ffmpeg'].includes(p.video.route));
    assert.equal(p.morph.controls.length, 2);
    assert.deepEqual(
      p.morph.controls.map((c) => c.visitId),
      ['mp4-a', 'mp4-b'],
    );
    assert.equal(p.morph.framesPerSecond, 16);
    assert.equal(p.model.name, 'stylegan2-ffhq-config-f');
    // The bridge's file entry reads it back as the app's project file, with no job.
    const reopened = await call<{ kind?: string; error?: string; jobEvents: number }>(
      'reopenSaved',
      'mp4-entry',
      Array.from(bytes),
      'facemorph.mp4',
      'video/mp4',
    );
    assert.equal(reopened.error, undefined, String(reopened.error));
    assert.equal(reopened.kind, 'project');
    assert.equal(reopened.jobEvents, 0);
  },
);

interface Timed {
  ms: number;
  message: string;
  stats: { encodes: number; known: number; webpEncodes: boolean };
  progressEvents: number;
  urls: string[];
}
test(
  'save-matrix: WebP default, PNG pixel-exact, MP4 with its resolution; repeat Save reuses name and bytes; a format switch prepares only that format',
  { timeout: 1_200_000 },
  async () => {
    await context.close();
    await open();
    pageErrors = [];
    let ortStarted = 0;
    const made = await call<{ out: Out } & Settled>('face', 'sm-a', 'seed', '831');
    assert.equal(made.out.errorMessage, '', made.out.errorMessage);
    page.on('worker', (w) => {
      if (/ort-worker/.test(w.url())) ortStarted++;
    });
    const rows: Record<string, unknown>[] = [];
    const urls: string[] = [];
    const save = async (id: string, format?: 'webp' | 'png') => {
      const ready = page.waitForEvent('download', { timeout: 120_000 });
      const timed = await call<Timed>('saveTimed', id, format);
      const download = await ready;
      const bytes = new Uint8Array(readFileSync((await download.path())!));
      urls.push(...timed.urls);
      return { ...timed, bytes, name: download.suggestedFilename(), sha: sha256(bytes) };
    };
    const progressAfterFace = made.progressEvents;
    const webp1 = await save('sm-a');
    const webp2 = await save('sm-a');
    const png1 = await save('sm-a', 'png');
    const png2 = await save('sm-a', 'png');
    const webp3 = await save('sm-a', 'webp');
    for (const [label, r] of [
      ['webp first', webp1],
      ['webp repeat', webp2],
      ['png first', png1],
      ['png repeat', png2],
      ['webp after png', webp3],
    ] as const)
      rows.push({
        format: label,
        bytes: r.bytes.length,
        ms: Math.round(r.ms),
        encodes: r.stats.encodes,
        name: r.name,
      });
    // WebP default: 1024 x 1024 with exact recovery.
    const w = readRecovery(webp1.bytes);
    assert.equal(w.kind, 'parsed');
    if (w.kind !== 'parsed') return;
    assert.equal(w.recovered.mime, 'image/webp');
    assert.deepEqual([w.recovered.width, w.recovered.height], [1024, 1024]);
    assert.equal(w.recovered.schemaVersion, 3);
    assert.match(webp1.name, /\.webp$/);
    // Repeat Save: same name and bytes, no encode.
    assert.equal(webp2.name, webp1.name);
    assert.equal(webp2.sha, webp1.sha);
    assert.equal(webp2.stats.encodes, webp1.stats.encodes, 'repeat WebP Save encodes nothing');
    // A format switch prepares only PNG, with no inference.
    assert.equal(png1.stats.encodes, webp1.stats.encodes + 1, 'PNG prepares one file');
    assert.match(png1.name, /\.png$/);
    assert.equal(png2.sha, png1.sha);
    assert.equal(png2.name, png1.name);
    assert.equal(png2.stats.encodes, png1.stats.encodes);
    assert.equal(webp3.sha, webp1.sha, 'switching back hands over the prepared WebP');
    assert.equal(webp3.name, webp1.name);
    assert.equal(webp3.stats.encodes, png1.stats.encodes, 'switching back encodes nothing');
    for (const r of [webp1, webp2, png1, png2, webp3])
      assert.equal(r.progressEvents, progressAfterFace, 'no job progress: no inference');
    assert.equal(ortStarted, 0, 'no inference worker started by Save');
    // PNG: pixel-exact to the prepared pixels, and the same recovery as the WebP.
    const p = readRecovery(png1.bytes);
    assert.equal(p.kind, 'parsed');
    if (p.kind !== 'parsed') return;
    assert.equal(p.recovered.mime, 'image/png');
    assert.ok(
      Buffer.from(p.recovered.latent.values.buffer).equals(
        Buffer.from(w.recovered.latent.values.buffer),
      ),
    );
    assert.equal(p.recovered.generationSha256, w.recovered.generationSha256);
    const exact = await call<{ length: number; differing: number; maxDiff: number }>(
      'stillMatchesFace',
      'sm-a',
      Array.from(png1.bytes),
      'image/png',
    );
    log(`png vs prepared pixels: ${JSON.stringify(exact)}`);
    assert.deepEqual(exact, { length: 1024 * 1024 * 4, differing: 0, maxDiff: 0 });
    // Exact recovery: the saved WebP reopens through the file entry with the same latent (no inference).
    const reopened = await call<{ kind?: string; jobEvents: number; error?: string }>(
      'reopenSaved',
      'sm-reopened',
      Array.from(webp1.bytes),
      webp1.name,
      'image/webp',
    );
    assert.equal(reopened.kind, 'recovered', String(reopened.error));
    assert.equal(reopened.jobEvents, 0);
    const again = await save('sm-reopened', 'png');
    const a = readRecovery(again.bytes);
    assert.equal(a.kind, 'parsed');
    if (a.kind !== 'parsed') return;
    assert.ok(
      Buffer.from(a.recovered.latent.values.buffer).equals(
        Buffer.from(w.recovered.latent.values.buffer),
      ),
      'reopened WebP keeps the exact latent',
    );
    // MP4: unchanged policy settings, resolution reported in the project; repeat Save reuses the file.
    const morph = await call<{ out: Out } & Settled>('morph', 'sm-a', 'sm-b');
    assert.equal(morph.out.errorMessage, '', morph.out.errorMessage);
    const mp41 = await save('video');
    const mp42 = await save('video');
    const v = readMp4Project(mp41.bytes);
    assert.equal(v.kind, 'parsed');
    if (v.kind !== 'parsed' || v.project.schemaVersion !== 2)
      throw new Error('MP4 project is not schema 2');
    assert.equal(v.video.codec, 'avc1');
    assert.deepEqual(
      [v.project.video.width, v.project.video.height],
      [v.video.width, v.video.height],
    );
    assert.ok([1024, 512].includes(v.video.width));
    assert.equal(v.project.morph.framesPerSecond, 16);
    assert.equal(mp42.sha, mp41.sha);
    assert.equal(mp42.name, mp41.name);
    assert.equal(mp42.stats.encodes, mp41.stats.encodes, 'repeat MP4 Save encodes nothing');
    rows.push(
      {
        format: 'mp4 first',
        bytes: mp41.bytes.length,
        ms: Math.round(mp41.ms),
        encodes: mp41.stats.encodes,
        name: mp41.name,
        video: v.project.video,
      },
      {
        format: 'mp4 repeat',
        bytes: mp42.bytes.length,
        ms: Math.round(mp42.ms),
        encodes: mp42.stats.encodes,
        name: mp42.name,
      },
    );
    // Cleanup: every Save's object URL is revoked (media.mjs revokes 60 s after the click); no rejection left over.
    await page.waitForTimeout(61_000);
    const facts = await call<{ revoked: number; total: number; unhandled: number }>(
      'urlFacts',
      urls,
    );
    log(`object urls: ${JSON.stringify(facts)}`);
    assert.equal(facts.total, 8, 'each of the 8 Saves made one object URL');
    assert.equal(facts.revoked, facts.total, 'every Save object URL was revoked');
    assert.equal(facts.unhandled, 0, 'no unhandled promise rejection');
    assert.deepEqual(pageErrors, []);
    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, 'save-matrix.json'), JSON.stringify(rows, null, 2) + '\n');
    for (const row of rows) log(`save-matrix ${JSON.stringify(row)}`);
  },
);

test(
  'controller: recorded job journeys replay with actual CPU execution',
  { timeout: 600_000 },
  async () => {
    verifyControl();
    const replayed: Record<string, Replayers[string]> = { 'first-visit': replayFirstVisit };
    for (const row of [
      'retry-unchanged',
      'morph.settings-start-cancel',
      'testing-bulk-generate',
      'morph.play-slider',
    ] as const) {
      // Control rows were recorded in separate contexts. Preserve that isolation so retained
      // bridge faces from an earlier row cannot change this row's insertion order or restore.
      await context.close();
      await open(true);
      const actual = await call<{
        slider: Record<string, unknown>[];
        cancelled: Record<string, unknown> | null;
        completed: Record<string, unknown>;
        faces: Record<string, unknown>[];
        video: boolean;
      }>('controllerGoldenJourney', row);
      if (row === 'morph.play-slider') {
        for (const device of ['desktop', 'phone']) {
          for (const [i, observed] of actual.slider.entries()) {
            const expected: Record<string, unknown> = fixture(
              `${row}/${device}/${i === 0 ? '01-slider' : '02-scrubbed-to-end'}.json`,
            ).model;
            for (const [key, value] of Object.entries(observed))
              assert.deepEqual(
                value,
                key === 'frameCount' ? (expected.SliderFrames as unknown[]).length : expected[key],
                `${row}/${device}: ${key}`,
              );
          }
        }
        replayed[row] = () => {};
        continue;
      }
      const files =
        row === 'retry-unchanged'
          ? ['02-cancelled', '03-retried']
          : row === 'morph.settings-start-cancel'
            ? ['03-cancelled', '04-morphed']
            : [null, '01-bulk-generated'];
      for (const device of ['desktop', 'phone']) {
        for (const [i, observed] of [actual.cancelled, actual.completed].entries()) {
          const file = files[i];
          if (!file || !observed) continue;
          const expected: Record<string, unknown> = fixture(`${row}/${device}/${file}.json`).model;
          for (const [key, value] of Object.entries(observed))
            assert.deepEqual(value, expected[key], `${row}/${device}/${file}: ${key}`);
        }
        const expected: Record<string, unknown> = fixture(
          `${row}/${device}/${files[1]}.json`,
        ).model;
        assert.deepEqual(
          actual.faces,
          (expected.Faces as Record<string, unknown>[]).map(
            ({ id, raw, label, sourceMode, sourceFile }) => ({
              id,
              raw,
              label,
              sourceMode,
              sourceFile,
            }),
          ),
          `${row}/${device}: real face records`,
        );
        assert.equal(actual.video, Boolean(expected.VideoUrl), `${row}/${device}: video`);
      }
      log(
        JSON.stringify({
          row,
          status: 'passed',
          evidence:
            'real controller/operation-service CPU execution; exact recorded job fields, face metadata and video availability on both fixture variants',
        }),
      );
      replayed[row] = () => {};
    }
    for (const row of ['words.generate-cpu', 'seed.generate', 'names.exact-text']) {
      await context.close();
      await open(true);
      const observations = await call<{ file: string; model: Record<string, unknown> }[]>(
        'controllerFoundationJourney',
        row,
      );
      for (const device of ['desktop', 'phone']) {
        for (const observation of observations) {
          const expected: Record<string, unknown> = fixture(
            `${row}/${device}/${observation.file}.json`,
          ).model;
          for (const [key, value] of Object.entries(observation.model)) {
            let recorded =
              key === 'Faces'
                ? (expected.Faces as Record<string, unknown>[]).map(
                    ({ id, raw, label, sourceMode, sourceFile }) => ({
                      id,
                      raw,
                      label,
                      sourceMode,
                      sourceFile,
                    }),
                  )
                : key === 'VideoUrl'
                  ? Boolean(expected.VideoUrl)
                  : expected[key];
            if (
              row === 'seed.generate' &&
              observation.file === '01-seed-mode' &&
              key === 'Inputs'
            ) {
              // fm-25um explicitly retires digit stripping. Only this declared
              // transition differs; every other recorded field/step stays exact.
              const inputs = recorded as { id: string; mode: string; value: string }[];
              const seed = inputs.find((input) => input.id === 'face-2');
              assert.equal(seed?.mode, 'seed');
              assert.equal(seed.value, '20261024');
              recorded = inputs.map((input) =>
                input === seed ? { ...input, value: '2026-10-24' } : input,
              );
            }
            if (
              key === 'Previews' &&
              ((row === 'seed.generate' && observation.file === '03-generated-0') ||
                (row === 'names.exact-text' &&
                  ['01-typed', '02-generated'].includes(observation.file)))
            ) {
              // fm-25um removes per-keystroke preview requests. Name just the
              // three old records affected; retain every other preview check.
              const previews = recorded as {
                id: string;
                mode: string;
                value: string;
                url: string;
              }[];
              const old = previews.find((preview) => preview.id === 'face-2');
              assert.deepEqual(old, {
                id: 'face-2',
                mode: row === 'seed.generate' ? 'seed' : 'text',
                value: row === 'seed.generate' ? '0' : 'hello',
                url:
                  row === 'seed.generate'
                    ? 'https://facemorph-seed-gallery.cdilga.workers.dev/outputImages/s0/0/s0_1024.webp'
                    : '/preview/hello-1024.webp',
              });
              recorded = previews.filter((preview) => preview !== old);
            }
            assert.deepEqual(value, recorded, `${row}/${device}/${observation.file}: ${key}`);
          }
        }
      }
      replayed[row] = () => {};
    }
    const verdicts = replayRows(replayed);
    for (const verdict of verdicts) log(JSON.stringify(verdict));
    for (const row of controlRows().filter(
      (row) => row.freeze === 'parity' && Object.keys(row.files ?? {}).length > 0,
    ))
      assert.equal(
        verdicts.find((verdict) => verdict.row === row.id)?.status,
        'passed',
        `${row.id}: recorded parity row must execute`,
      );
  },
);
test(
  'controller: every effect reaches its real facade function once',
  { timeout: 300_000 },
  async () => {
    const session = await context.newCDPSession(page);
    const counts = new Map<string, number>();
    const names = new Map<string, string>();
    const errors: unknown[] = [];
    await session.send('Debugger.enable');
    session.on('Debugger.paused', async (event) => {
      for (const id of event.hitBreakpoints ?? []) {
        const name = names.get(id);
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      try {
        await session.send('Debugger.resume');
      } catch (error) {
        errors.push(error);
      }
    });
    try {
      const targets = [
        'restoreLastResult',
        'subscribe',
        'subscribeDownloads',
        'invalidateArrivalRestore',
        'invalidateFace',
        'invalidateMorph',
        'invalidatePhotoSelections',
        'focusCropArea',
        'cancelPhotoRun',
        'revokeUrl',
        'selectPhoto',
        'previewPhoto',
        'cropPhoto',
        'chooseDetectedFace',
        'openNamesFocus',
        'closeNamesFocus',
        'loadNames',
        'publicPreview',
        'sliderFrames',
        'setDebug',
        'sendReportOnce',
        'rememberSlider',
        'rememberView',
        'checkCachedFace',
        'consentToDownload',
        'downloadModels',
        'queueFace',
        'cancelQueuedFace',
        'requestNext',
        'saveMedia',
        'shareMedia',
        'exportProject',
        'execute',
        'cancel',
        'importProject',
      ];
      for (const name of targets) {
        const object = await session.send('Runtime.evaluate', {
          expression: `window.harness.controllerTarget(${JSON.stringify(name)})`,
        });
        assert.ok(object.result.objectId, `${name}: actual function missing`);
        const breakpoint = await session.send('Debugger.setBreakpointOnFunctionCall', {
          objectId: object.result.objectId,
        });
        names.set(breakpoint.breakpointId, name);
      }
      await call('startControllerRouting');
      for (const name of ['restoreLastResult', 'subscribe', 'subscribeDownloads'])
        assert.equal(counts.get(name), 1, name);
      for (const name of targets.filter(
        (name) => !['restoreLastResult', 'subscribe', 'subscribeDownloads'].includes(name),
      )) {
        const before = counts.get(name) ?? 0;
        await call('controllerRoutingStep', name === 'cancel' ? 'cancelWork' : name);
        assert.equal((counts.get(name) ?? 0) - before, 1, `${name}: calls for one effect`);
      }
      assert.equal(
        await call('controllerRoutingStep', 'dispatch'),
        'effect dispatch reached the queue',
      );
      assert.deepEqual(errors, []);
    } finally {
      await call('stopControllerRouting');
      await session.detach();
    }
  },
);
test(
  'controller: CPU faces and a short morph complete through reducers and effects',
  { timeout: 600_000 },
  async () => {
    try {
      const result = await call<{
        first: boolean;
        second: boolean;
        video: boolean;
        faces: number;
        route: string;
        unchangedAfterDispose: boolean;
        bulkCompleted: boolean;
        saveRejected: boolean;
        shareRejected: boolean;
        exportRejected: boolean;
        importRejected: boolean;
        reportObserved: boolean;
        downloadObserved: boolean;
        subscriptionsDetached: boolean;
      }>('controllerJourney');
      assert.equal(result.first, true);
      assert.equal(result.second, true);
      assert.equal(result.video, true);
      assert.equal(result.faces, 2);
      assert.equal(result.route, 'cpu');
      assert.equal(result.unchangedAfterDispose, true);
      for (const key of [
        'bulkCompleted',
        'saveRejected',
        'shareRejected',
        'exportRejected',
        'importRejected',
        'reportObserved',
        'downloadObserved',
        'subscriptionsDetached',
      ] as const)
        assert.equal(result[key], true, key);
    } catch (error) {
      await keep('controller');
      throw error;
    }
  },
);

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

for (const cancelParent of [false, true]) {
  test(
    `operation-service: Morph ${cancelParent ? 'cancellation preserves' : 'joins'} its independently requested CPU face`,
    { timeout: 600_000 },
    async () => {
      try {
        const r = await call<
          {
            statuses: string[];
            video: boolean;
            ids: { parent: string; shared: string; other: string };
            trace: { type: string; id: string; stage?: string; job?: number }[];
          } & Settled
        >('serviceParentJourney', cancelParent);
        const detail = JSON.stringify(r.trace);
        assert.deepEqual(
          r.statuses,
          [cancelParent ? 'cancelled' : 'completed', 'completed', 'completed'],
          detail,
        );
        const parent = r.trace.filter((e) => e.id === r.ids.parent);
        assert.equal(parent.filter((e) => e.type === 'settled').length, 1, detail);
        assert.equal(
          parent.filter((e) => e.type === 'compute-ready').length,
          cancelParent ? 0 : 1,
          detail,
        );
        const sharedJobs = new Set(
          r.trace.filter((e) => e.id === r.ids.shared && e.job !== undefined).map((e) => e.job),
        );
        assert.equal(sharedJobs.size, 1, `shared face executed more than once: ${detail}`);
        if (!cancelParent) {
          assert.ok(r.video, 'Morph produced no video');
          const frame = r.trace.findIndex((e) => e.id === r.ids.parent && e.stage === 'morph');
          const other = r.trace.findIndex((e) => e.id === r.ids.other && e.type === 'admitted');
          assert.ok(other >= 0 && frame > other, `waiting parent held the compute lane: ${detail}`);
        }
        assert.ok([...counts.keys()].some((path) => path.startsWith('/runtime/chunks/')));
        free(r, 'service-parent');
      } catch (error) {
        await keep('service-parent');
        throw error;
      }
    },
  );
}

test(
  'operation-service: file cancellation leaves the next CPU jobs running',
  { timeout: 600_000 },
  async () => {
    try {
      const r = await call<
        {
          statuses: string[];
          first: string;
          trace: { type: string; id: string }[];
        } & Settled
      >('serviceFileCancelJourney');
      const detail = JSON.stringify(r.trace);
      assert.deepEqual(r.statuses, ['cancelled', 'completed', 'completed'], detail);
      const first = r.trace.filter((e) => e.id === r.first);
      assert.equal(first.filter((e) => e.type === 'settled').length, 1, detail);
      assert.ok(
        first.some((e) => e.type === 'compute-ready'),
        detail,
      );
      assert.equal(
        first.some((e) => e.type === 'file-ready'),
        false,
        detail,
      );
      free(r, 'service-file-cancel');
    } catch (error) {
      await keep('service-file-cancel');
      throw error;
    }
  },
);

// A real control-written IndexedDB session is read on the same origin by the typed retention and bridge.
test(
  'control-written retention restores through the port on the same origin',
  { timeout: 600000 },
  async (t) => {
    // Earlier journeys retain photo inputs whose classic field is disabled.
    // Start the control writer with fresh storage, then retain that same origin
    // and storage for the port reader below.
    await context.close();
    await open();
    const scratch = mkdtempSync(join(tmpdir(), 'facade-retention-control-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const cached = join(repo, '.cache/control/tree');
    const { dir: controlDir } = await fetchControl(
      existsSync(cached) ? { store: cached } : { dest: scratch },
    );
    const control = async (route: Route) => {
      const path = new URL(route.request().url()).pathname;
      const file = join(controlDir, 'deploy-next', path === '/' ? 'index.html' : path);
      if (path.startsWith('/runtime/') || !existsSync(file) || !statSync(file).isFile())
        return route.fallback();
      return route.fulfill({
        status: 200,
        body: readFileSync(file),
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
        },
      });
    };
    await context.route(`${ORIGIN}/**`, control);
    try {
      await page.goto(`${ORIGIN}/?testing`);
      await page.locator('section.next-face').first().waitFor();
      // Answer the nonblocking questions before operating controls under them.
      for (const control of [
        page.locator('.next-model-toast').getByRole('button', { name: 'Not now', exact: true }),
        page.locator('.next-invite').getByRole('button', { name: 'Not now', exact: true }),
      ]) {
        if (
          await control.waitFor({ timeout: 10000 }).then(
            () => true,
            () => false,
          )
        )
          assert.ok((await press(page, control)).inside);
      }
      assert.ok(
        (await press(page, page.getByRole('button', { name: 'More options', exact: true }))).inside,
      );
      assert.ok(
        (await press(page, page.locator('summary').filter({ hasText: /^Advanced$/ }))).inside,
      );
      await page.getByLabel('Processing mode').selectOption('cpu');
      const face = page.locator('section.next-face').first();
      const field = face.locator('.next-field input');
      assert.ok((await press(page, field)).inside);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('control retention compatibility', { delay: 10 });
      assert.ok((await press(page, face.locator('.next-face-generate'))).inside);
      const gate = page.locator('.next-download-accept');
      if (
        await gate.waitFor({ timeout: 10000 }).then(
          () => true,
          () => false,
        )
      )
        assert.ok((await press(page, gate)).inside);
      await page.waitForFunction(
        () =>
          document.querySelector('section.next-face')?.getAttribute('data-next-state') ===
            'filled' &&
          document.querySelector('.next-product')?.getAttribute('data-next-busy') === 'false',
        null,
        { timeout: 300000 },
      );
      assert.match((await page.locator('.next-route-caption').textContent()) ?? '', /CPU/);
      // waitForFunction treats an async predicate's Promise as truthy before
      // its IndexedDB result is known. Poll awaited evaluations so a false
      // durable-storage check cannot finish the wait.
      const retained = () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const q = indexedDB.open('checkface-originals-v1');
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => reject(q.error);
          });
          try {
            return await new Promise<boolean>((resolve, reject) => {
              const q = db
                .transaction('originals')
                .objectStore('originals')
                .get('last-generated-session-v2');
              q.onsuccess = () => resolve(q.result?.faces?.length > 0);
              q.onerror = () => reject(q.error);
            });
          } finally {
            db.close();
          }
        });
      const deadline = Date.now() + 30_000;
      let stored = await retained();
      while (!stored && Date.now() < deadline) {
        await page.waitForTimeout(100);
        stored = await retained();
      }
      assert.equal(stored, true, 'classic did not finish its durable session write');
      await page.screenshot({ path: join(results, 'control-written-session.png') });
    } finally {
      await context.unroute(`${ORIGIN}/**`, control);
    }
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction('window.harnessReady');
    const facts = await call<{
      checks: {
        id: string;
        modelMatches: boolean;
        noiseMatches: boolean;
        generation: string;
        expected: string;
      }[];
      storage: { rawFaces: number };
    }>('retentionFacts');
    const restored = await call<Out | null>('restore');
    assert.ok(restored, `control session was not restored: ${JSON.stringify(facts)}`);
    assert.equal(restored.restored, true);
    assert.equal(restored.faces.length, 1);
    assert.equal(restored.faces[0]?.id, 'face-1');
    assert.equal(restored.errorMessage, '');
    assert.equal(facts.storage.rawFaces, 1);
    assert.ok(
      facts.checks.every((f) => f.modelMatches && f.noiseMatches && f.generation === f.expected),
    );
    log(`control-written session restored by port: ${JSON.stringify(facts)}`);
  },
);
