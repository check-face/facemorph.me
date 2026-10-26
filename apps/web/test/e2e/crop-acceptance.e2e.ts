// fm-d4mw: confirmed-crop and recovery-class acceptance in the identified build:next destination (deploy-next/),
// served at its production origin with the pinned runtime and real CPU e4e. Every case is operated at the visible
// position of its control (press(): elementFromPoint, then a real mouse click or touch tap); by-name clicks only
// arrange state. Each case logs the counters it asserts on one structured line:
//   [crop-acceptance] {"case":…,"cropOpen":…,"cropConfirmed":…,"detect":…,"e4e":…,"tensorDigests":[…],
//                      "requests":{"app":…,"model":…,"detector":…,"other":…},…}
// cropOpen counts crop dialogs appearing, cropConfirmed confirmed crops committed to a face (Use this crop / OK →
// Cropped), detect the detector/alignment/warp passes posted to the selection worker ('align'), e4e the encoder
// attempts posted to the engine ('encode-aligned', with the SHA-256 of the tensor it carried: the engine's own
// tensorDigest). Screenshots at 1,280 and 390 px for every case; the trace and a screenshot are kept on failure.
// Fixtures: tests/crop/fixtures (synthetic, digests in fixtures.json) and files generated here from them or from the
// e4e qualification input (support/crop-fixtures.ts); this run's digests go to test-results/crop-acceptance.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, devices, type BrowserContext, type Locator, type Page } from 'playwright';
import { readRecovery } from 'stylegan-js';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { futureSchemaPng } from '../support/recovery-stills.ts';
import {
  headerOnlyPng,
  largeNoisePhoto,
  png,
  qualificationPhoto,
  sha256,
  withOrientation,
} from '../support/crop-fixtures.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/crop-acceptance');
const cropFixtures = join(REPO, 'tests/crop/fixtures');
const stills = join(REPO, 'apps/web/test/fixtures/verify/stills');
/** Runs only the named cases (comma-separated) when set; CI runs them all. */
const only = process.env['FACEMORPH_CROP_CASES']?.split(',').filter(Boolean) ?? null;

const MiB = 1024 * 1024;
/** The e4e qualification case the manual-crop fixture reproduces exactly (packages/model-conv e4e-qualification). */
const SEED0_UNALIGNED_TENSOR = '51529b7a56d218a191b308a889db37fbff311a0bd4c2096e46b2334f7d835726';

type HostClass = 'app' | 'model' | 'detector' | 'other';
const hostClass = (url: string): HostClass => {
  const u = new URL(url);
  if (u.protocol === 'data:' || u.protocol === 'blob:') return 'app';
  if (u.origin !== ORIGIN) return 'other';
  if (u.pathname.startsWith('/runtime/photo/')) return 'detector';
  if (/^\/runtime\/(assets|chunks|encoder-stream)\//.test(u.pathname)) return 'model';
  return 'app';
};

/** Counters kept in the page (installed after INSTALL_HOOK, before the app loads). */
const PROBE = `(() => {
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const c = (window.__crop = { align: 0, e4e: 0, digests: [], hashing: 0, opens: 0, confirmed: 0 });
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) {
    const t = m && m.type;
    if (t === 'align') c.align++;
    if (t === 'encode-aligned') {
      c.e4e++;
      // Copied before the post: the engine takes the tensor's buffer.
      const a = m.tensor, copy = new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
      c.hashing++;
      crypto.subtle.digest('SHA-256', copy).then((h) => { c.digests.push(hex(h)); c.hashing--; });
    }
    return post.call(this, m, ...rest);
  };
  let lastCrop = null;
  const seen = new WeakSet();
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const commit = hook.onCommitFiberRoot.bind(hook);
  hook.onCommitFiberRoot = (...args) => {
    commit(...args);
    // A crop opens when a new choice takes the dialog (queued crops reuse the mounted dialog; Adjust Crop does not
    // make a new choice).
    const crop = window.__elmish.model?.Crop;
    if (crop && crop.url !== lastCrop) c.opens++;
    lastCrop = crop ? crop.url : null;
    for (const i of window.__elmish.model?.Inputs ?? [])
      if (i.mode === 'photo' && i.file && i.file.name === 'cropped.png' && !seen.has(i.file)) { seen.add(i.file); c.confirmed++; }
  };
})();`;

interface Counters {
  align: number;
  e4e: number;
  digests: string[];
  opens: number;
  confirmed: number;
}
interface ModelView {
  Busy: boolean;
  Error: string | null;
  Status: string;
  preparing: number;
  crop: boolean;
  cropQueue: number;
  photoQueue: number;
  gate: boolean;
  faces: string[];
  inputs: { id: string; mode: string; value: string }[];
  held: { id: string; kind: string; reasonKey: string; photoAction: boolean }[];
}
const readModel = (page: Page) =>
  page.evaluate((): ModelView => {
    const m = (window as unknown as { __elmish: { model: Record<string, never> } }).__elmish
      .model as unknown as {
      Busy: boolean;
      Error: string | null;
      Status: string;
      PreparingFaces: Set<string>;
      Crop: unknown;
      CropQueue: unknown[];
      PhotoQueue: unknown[];
      Gate: unknown;
      Faces: { id: string }[];
      Inputs: { id: string; mode: string; value: string }[];
      Held?: Map<string, { kind: string; reason: { reasonKey: string }; photoAction: boolean }>;
    };
    return {
      Busy: m.Busy,
      Error: m.Error,
      Status: m.Status,
      preparing: m.PreparingFaces.size,
      crop: m.Crop !== null,
      cropQueue: m.CropQueue.length,
      photoQueue: m.PhotoQueue.length,
      gate: m.Gate !== null,
      faces: m.Faces.map((f) => f.id),
      inputs: m.Inputs.map(({ id, mode, value }) => ({ id, mode, value })),
      held: [...(m.Held ?? new Map()).entries()].map(([id, h]) => ({
        id,
        kind: h.kind,
        reasonKey: h.reason.reasonKey,
        photoAction: h.photoAction,
      })),
    };
  });

/** One browser context driven as a person would, with its counters, request log and case log. */
class Session {
  readonly requests: { cls: HostClass; path: string; bytes: number }[] = [];
  readonly errors: string[] = [];
  readonly stillLines: Record<string, unknown>[] = [];
  readonly lines: Record<string, unknown>[] = [];
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly touch: boolean;
  constructor(name: string, context: BrowserContext, page: Page, touch: boolean) {
    this.name = name;
    this.context = context;
    this.page = page;
    this.touch = touch;
    page.on('pageerror', (error) => this.errors.push(error.message));
    page.on('console', (m) => {
      if (m.text().startsWith('[still-entry]'))
        this.stillLines.push(JSON.parse(m.text().slice('[still-entry] '.length)));
    });
    page.on('requestfinished', async (request) => {
      const entry = {
        cls: hostClass(request.url()),
        path: new URL(request.url()).pathname,
        bytes: 0,
      };
      this.requests.push(entry);
      entry.bytes = Math.max(0, (await request.sizes().catch(() => null))?.responseBodySize ?? 0);
    });
  }
  static async open(
    browser: import('playwright').Browser,
    name: string,
    width: 1280 | 390,
  ): Promise<Session> {
    const touch = width === 390;
    const context = await browser.newContext({
      ...(touch ? devices['iPhone 13'] : {}),
      viewport: { width, height: 900 },
      hasTouch: touch,
      isMobile: touch,
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    });
    await context.addInitScript(INSTALL_HOOK);
    await context.addInitScript(PROBE);
    await context.tracing.start({
      screenshots: true,
      snapshots: false,
      sources: false,
    });
    const page = await context.newPage();
    const session = new Session(name, context, page, touch);
    await page.goto(ORIGIN);
    await session.tiles.nth(1).waitFor();
    for (const control of [
      page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
      page.getByRole('button', { name: 'Ask me later' }),
    ])
      if (
        await control.waitFor({ timeout: 5000 }).then(
          () => true,
          () => false,
        )
      )
        await control.click(); // setup
    await page.getByRole('button', { name: 'More options' }).click(); // setup
    await page.getByText('Advanced', { exact: true }).click(); // setup
    await page.getByLabel('Processing mode').selectOption('cpu'); // setup: the CPU journey
    return session;
  }
  get tiles() {
    return this.page.locator('section.next-face');
  }
  get dialog() {
    return this.page.getByRole('dialog', {
      name: 'Encode an image',
      exact: true,
    });
  }
  async operate(control: Locator) {
    const landed = await press(this.page, control, { touch: this.touch });
    assert.ok(landed.inside, `${this.name}: ${control} ${JSON.stringify(landed)}`);
  }
  counters(): Promise<Counters> {
    return this.page.evaluate(() => {
      const c = (window as unknown as { __crop: Counters }).__crop;
      return {
        align: c.align,
        e4e: c.e4e,
        digests: [...c.digests],
        opens: c.opens,
        confirmed: c.confirmed,
      };
    });
  }
  /** Counters and requests since `mark`. */
  async since(mark: { counters: Counters; requests: number }) {
    await this.page.waitForFunction(
      () => (window as unknown as { __crop: { hashing: number } }).__crop.hashing === 0,
    );
    const now = await this.counters();
    const requests: Record<HostClass, number> = {
      app: 0,
      model: 0,
      detector: 0,
      other: 0,
    };
    const bytes: Record<HostClass, number> = {
      app: 0,
      model: 0,
      detector: 0,
      other: 0,
    };
    for (const r of this.requests.slice(mark.requests)) {
      requests[r.cls]++;
      bytes[r.cls] += r.bytes;
    }
    return {
      cropOpen: now.opens - mark.counters.opens,
      cropConfirmed: now.confirmed - mark.counters.confirmed,
      detect: now.align - mark.counters.align,
      e4e: now.e4e - mark.counters.e4e,
      tensorDigests: now.digests.slice(mark.counters.digests.length),
      requests,
      requestBytes: bytes,
    };
  }
  async mark() {
    return { counters: await this.counters(), requests: this.requests.length };
  }
  log(entry: Record<string, unknown>) {
    const line = { session: this.name, ...entry };
    this.lines.push(line);
    console.log(`[crop-acceptance] ${JSON.stringify(line)}`);
  }
  /** The page at 1,280 and 390 px, back to this session's own width after. */
  async shots(caseName: string) {
    const own = this.page.viewportSize()!;
    for (const width of [1280, 390]) {
      if (width !== own.width) await this.page.setViewportSize({ width, height: own.height });
      await this.page.screenshot({
        path: join(results, `${this.name}-${caseName}-${width}.png`),
      });
    }
    await this.page.setViewportSize(own);
  }
  /** The face card's own chooser: its empty-image Encode image button or the Change mode menu. */
  async choose(index: number, paths: string[]) {
    const tile = this.tiles.nth(index);
    const empty = tile
      .locator('.next-face-image')
      .getByRole('button', { name: 'Encode image', exact: true });
    const chooser = this.page.waitForEvent('filechooser');
    if (await empty.count()) await this.operate(empty);
    else {
      await this.operate(tile.getByRole('button', { name: 'Change mode', exact: true }));
      const entry = this.page.getByRole('menuitem', {
        name: 'Encode image',
        exact: true,
      });
      await entry.evaluate(async (el) => {
        const panel = el.closest('.MuiPaper-root');
        await Promise.allSettled(
          (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
        );
      });
      await this.operate(entry);
    }
    await (await chooser).setFiles(paths);
  }
  /** Words again on face `index` (the stale-revision edit, and a reset between cases). */
  async words(index: number, text: string) {
    const tile = this.tiles.nth(index);
    await this.operate(tile.getByRole('button', { name: 'Change mode', exact: true }));
    const entry = this.page.getByRole('menuitem', {
      name: 'Name or words',
      exact: true,
    });
    await entry.evaluate(async (el) => {
      const panel = el.closest('.MuiPaper-root');
      await Promise.allSettled(
        (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
      );
    });
    await this.operate(entry);
    const field = tile.getByRole('textbox');
    await this.operate(field);
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.insertText(text);
  }
  /** The current crop choice's preview URL (null when no crop is open). */
  cropUrl(): Promise<string | null> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __elmish: { model: { Crop: { url: string } | null } } }).__elmish
          .model.Crop?.url ?? null,
    );
  }
  /** Waits until the crop `url` was closed or replaced by the next queued one. */
  async cropGone(url: string | null) {
    await this.page.waitForFunction(
      (u) =>
        (window as unknown as { __elmish: { model: { Crop: { url: string } | null } } }).__elmish
          .model.Crop?.url !== u,
      url,
    );
  }
  async confirmation() {
    await this.dialog.locator('.next-encode-preview img').waitFor({ timeout: 120_000 });
  }
  /** The photo download consent, when it shows, accepted at its visible position. */
  async consent() {
    const accept = this.page.locator('.next-download-accept');
    while (
      await accept.waitFor({ timeout: 4000 }).then(
        () => true,
        () => false,
      )
    ) {
      await this.operate(accept);
      await accept.waitFor({ state: 'detached' });
    }
  }
  async settled(timeout = 900_000) {
    await this.page.waitForFunction(
      () => {
        const m = (
          window as unknown as {
            __elmish: {
              model: {
                Busy: boolean;
                PreparingFaces: Set<string>;
                Crop: unknown;
                Gate: unknown;
                PendingJobs: unknown[];
                StillChecks?: Map<string, number>;
                PhotoQueue: unknown[];
                CropQueue: unknown[];
              };
            };
          }
        ).__elmish.model;
        // A page drop holds no face while its files are classified: the pending check is the signal.
        return (
          !m.Busy &&
          m.PreparingFaces.size === 0 &&
          !m.Crop &&
          !m.Gate &&
          !m.PendingJobs?.length &&
          !m.StillChecks?.size &&
          !m.PhotoQueue.length &&
          !m.CropQueue.length
        );
      },
      null,
      { timeout, polling: 500 },
    );
  }
  async waitE4e(before: number, timeout = 300_000) {
    await this.page.waitForFunction(
      (n) => (window as unknown as { __crop: { e4e: number } }).__crop.e4e > n,
      before,
      { timeout, polling: 100 },
    );
  }
  /** Drops `files` (name, type, base64) at the visible centre of `target`, onto whatever element is there. */
  async drop(target: Locator, files: { name: string; type: string; base64: string }[]) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    assert.ok(box);
    return this.page.evaluate(
      ([x, y, list]) => {
        const data = new DataTransfer();
        for (const f of list as {
          name: string;
          type: string;
          base64: string;
        }[])
          data.items.add(
            new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, {
              type: f.type,
            }),
          );
        const at = document.elementFromPoint(x as number, y as number)!;
        const init = {
          bubbles: true,
          cancelable: true,
          clientX: x as number,
          clientY: y as number,
        };
        at.dispatchEvent(new DragEvent('dragover', { ...init, dataTransfer: data }));
        at.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: data }));
        return at.closest('[data-next-face]')?.getAttribute('data-next-face') ?? null;
      },
      [box.x + box.width / 2, box.y + box.height / 2, files] as const,
    );
  }
  async save(index: number) {
    const download = this.page.waitForEvent('download');
    await this.operate(
      this.tiles.nth(index).getByRole('button', { name: 'Save image', exact: true }),
    );
    return readFileSync((await (await download).path())!);
  }
  async close() {
    await this.context.tracing.stop().catch(() => {});
    await this.context.close().catch(() => {});
  }
}

/** Runs one case as a subtest: skipped unless selected; on failure a screenshot and that case's trace. */
function caseRunner(t: TestContext, session: Session) {
  return async (name: string, body: () => Promise<void>) => {
    if (only && !only.includes(name)) return;
    await t.test(`${session.name}: ${name}`, async () => {
      // One trace chunk per case, written only when the case fails.
      await session.context.tracing.startChunk();
      try {
        await body();
        await session.context.tracing.stopChunk();
      } catch (error) {
        await session.context.tracing
          .stopChunk({ path: join(results, `${session.name}-${name}-trace.zip`) })
          .catch(() => {});
        await session.page
          .screenshot({
            path: join(results, `${session.name}-${name}-failure.png`),
            fullPage: true,
          })
          .catch(() => {});
        session.log({
          case: name,
          outcome: 'failed',
          error: String(error).slice(0, 400),
        });
        // Leave the page usable for the next case.
        await session.page.keyboard.press('Escape').catch(() => {});
        throw error;
      }
    });
  };
}

const zero = { app: 0, model: 0, detector: 0, other: 0 };
const b64 = (path: string) => readFileSync(path).toString('base64');

test(
  'confirmed crop and still recovery through the built UI (fm-d4mw)',
  { timeout: 5_400_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-d4mw; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    mkdirSync(results, { recursive: true });
    // Fixtures generated for this run in a temporary directory removed at the end (never committed); the files of
    // tens of MiB exist one at a time, only for their case. Every generated file's digest is recorded.
    const generated = mkdtempSync(join(tmpdir(), 'crop-acceptance-'));
    const fx = {
      noFace: join(cropFixtures, 'no-face.jpg'),
      multiFace: join(cropFixtures, 'multi-face.jpg'),
      nonSquare: join(cropFixtures, 'non-square.jpg'),
      malformed: join(cropFixtures, 'malformed.jpg'),
      redetection: join(cropFixtures, 'redetection-fails-on-confirmed-crop.jpg'),
      qualification: join(generated, 'qualification-seed-0-1024.png'),
      pixelsOver: join(generated, 'header-pixels-over.png'),
      pixelsAt: join(generated, 'pixels-at-limit.png'),
      edgeOver: join(generated, 'edge-20001.png'),
      edgeAt: join(generated, 'edge-20000.png'),
      oriented: [1, 2, 3, 4, 5, 6, 7, 8].map((o) => join(generated, `oriented-${o}.jpg`)),
      mismatch: join(stills, 'model-mismatch-v2.png'),
      flipped: join(stills, 'damaged-v1.png'),
      truncated: join(generated, 'truncated-v2.png'),
      future: join(generated, 'future-schema-9.png'),
      saved: join(generated, 'saved-encoded.webp'),
    };
    const write = (path: string, bytes: Uint8Array) => {
      writeFileSync(path, bytes);
      const record = {
        file: path.slice(generated.length + 1),
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
      digests.push(record);
      return record;
    };
    const digests: { file: string; bytes: number; sha256: string }[] = [];
    const small = (y: number, row: Uint8Array) => {
      for (let i = 0; i < row.length; i++) row[i] = (i * 7 + y * 3) & 0xff;
    };
    /** A large file made for one case and deleted after it. */
    const large = async (
      name: string,
      make: () => Uint8Array,
      run: (path: string) => Promise<void>,
    ) => {
      const path = join(generated, name);
      write(path, make());
      try {
        await run(path);
      } finally {
        rmSync(path, { force: true });
      }
    };
    const largeFiles: Record<string, () => Uint8Array> = {
      'large-30mb.png': () => largeNoisePhoto(30 * 1000 * 1000).file,
      'bytes-64mib-plus-1.png': () => png(64, 64, 3, small, { padTo: 64 * MiB + 1 }),
      'bytes-64mib.png': () => png(64, 64, 3, small, { padTo: 64 * MiB }),
    };
    const smallFiles = [
      write(fx.qualification, qualificationPhoto().file),
      // 12,288 x 10,241 declares 125,841,408 px, over 120 x 1024²; 12,288 x 10,240 is exactly 120 x 1024².
      write(fx.pixelsOver, headerOnlyPng(12288, 10241)),
      write(
        fx.pixelsAt,
        png(12288, 10240, 1, (y, row) => row.fill(96 + (y >> 9)), { level: 9 }),
      ),
      write(fx.edgeOver, png(20001, 16, 1, small)),
      write(fx.edgeAt, png(20000, 16, 1, small)),
      ...fx.oriented.map((path, i) =>
        write(path, withOrientation(readFileSync(join(cropFixtures, 'oriented.jpg')), i + 1)),
      ),
      write(fx.truncated, readFileSync(join(stills, 'recovery-v2.png')).subarray(0, 1200)),
      write(fx.future, futureSchemaPng(9)),
    ];
    assert.equal(smallFiles.length, 15, 'every small fixture written and recorded');

    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({
      args: [...chromiumArgs, '--disable-features=WebGPU'],
    });
    const sessions: Session[] = [];
    try {
      // ---- Desktop, real mouse: the confirmed-crop cases. ----
      const d = await Session.open(browser, 'desktop', 1280);
      sessions.push(d);
      const run = caseRunner(t, d);
      const first = () => d.tiles.nth(0);
      const firstId = async () => (await first().getAttribute('data-next-face'))!;
      const okButton = () => d.dialog.getByRole('button', { name: 'OK', exact: true });
      const cancelButton = () => d.dialog.getByRole('button', { name: 'CANCEL', exact: true });
      const adjustButton = () => d.dialog.getByRole('button', { name: 'ADJUST CROP', exact: true });
      const useCrop = () => d.dialog.getByRole('button', { name: 'Use Crop', exact: true });
      const faceDone = (id: string, timeout = 900_000) =>
        d.page.waitForFunction(
          (face) => {
            const m = (
              window as unknown as {
                __elmish: {
                  model: {
                    Faces: { id: string }[];
                    Error: string | null;
                    Busy: boolean;
                  };
                };
              }
            ).__elmish.model;
            return (m.Faces.some((f) => f.id === face) || m.Error) && !m.Busy;
          },
          id,
          { timeout, polling: 500 },
        );
      /** A confirmed crop: counters asserted as the locked requirement states them. */
      const confirmedOnce = (
        c: Awaited<ReturnType<Session['since']>>,
        m: ModelView,
        id: string,
        { complete = true } = {},
      ) => {
        assert.equal(c.cropConfirmed, 1, 'one confirmed crop');
        assert.equal(c.detect, 0, 'no detection, alignment or warp after confirmation');
        assert.equal(c.cropOpen, 0, 'the crop does not reopen after confirmation');
        assert.equal(c.requests.detector, 0, 'no detector asset is requested');
        if (complete) {
          assert.equal(c.e4e, 1, 'exactly one e4e attempt');
          assert.equal(m.Error, null, `no terminal error: ${m.Error}`);
          assert.ok(m.faces.includes(id), 'the confirmed crop became the face');
        } else assert.ok(c.e4e === 1 || m.Error, 'one e4e attempt or one terminal error');
      };

      // Malformed input: one actionable message, no crop, nothing computed.
      await run('malformed', async () => {
        const mark = await d.mark();
        await d.choose(0, [fx.malformed]);
        const failure = d.page.locator('.next-error > p').first();
        await failure.waitFor();
        const text = (await failure.innerText()).trim();
        assert.match(text, /could not be read|Choose|Try/i, 'an actionable message');
        await d.shots('malformed');
        const c = await d.since(mark);
        d.log({ case: 'malformed', ...c, message: text });
        assert.deepEqual(
          [c.cropOpen, c.cropConfirmed, c.detect, c.e4e, c.requests.model, c.requests.detector],
          [0, 0, 0, 0, 0, 0],
        );
        await d.operate(d.page.locator('.next-error').getByRole('button', { name: 'Dismiss' }));
      });

      // Cancel before OK: nothing confirmed, nothing encoded, nothing requested.
      await run('cancel-before-ok', async () => {
        const mark = await d.mark();
        const before = (await readModel(d.page)).inputs[0];
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        await d.shots('cancel-before-ok');
        await d.operate(cancelButton());
        await d.dialog.waitFor({ state: 'detached' });
        await d.page.waitForTimeout(1000);
        const c = await d.since(mark);
        d.log({ case: 'cancel-before-ok', ...c });
        assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 0, 0, 0]);
        assert.deepEqual(c.requests, { ...zero, app: c.requests.app });
        assert.deepEqual((await readModel(d.page)).inputs[0], before, 'the face is unchanged');
      });

      // Over the limits, through the real file entry: one actionable message, zero e4e, zero new faces.
      for (const [name, path, message] of [
        ['over-bytes-64mib-plus-1', 'bytes-64mib-plus-1.png', /smaller than 64 MB/],
        ['over-header-pixels', fx.pixelsOver, /too large to open/],
        ['over-edge-20001', fx.edgeOver, /too large to open/],
      ] as const)
        await run(name, async () => {
          const mark = await d.mark();
          const tiles = await d.tiles.count();
          const failure = d.page.locator('.next-error > p').first();
          // A chosen file is read from disk lazily: the generated copy stays until the refusal shows.
          const refused = async (p: string) => {
            await d.choose(0, [p]);
            await failure.waitFor({ timeout: 60_000 });
          };
          if (path in largeFiles) await large(path, largeFiles[path]!, refused);
          else await refused(path);
          const text = (await failure.innerText()).trim();
          assert.match(text, message);
          assert.match(text, /resize|smaller|choose/i, 'the message says what to do');
          await d.shots(name);
          const c = await d.since(mark);
          d.log({ case: name, ...c, message: text });
          assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [0, 0, 0, 0]);
          assert.equal(c.requests.model + c.requests.detector, 0);
          assert.equal(await d.tiles.count(), tiles, 'no new face');
          await d.operate(d.page.locator('.next-error').getByRole('button', { name: 'Dismiss' }));
        });

      // Exactly at each limit: the photo proceeds to the crop confirmation (cancelled here; nothing computed).
      for (const [name, path] of [
        ['at-bytes-64mib', 'bytes-64mib.png'],
        ['at-pixels-120x1024sq', fx.pixelsAt],
        ['at-edge-20000', fx.edgeAt],
      ] as const)
        await run(name, async () => {
          const mark = await d.mark();
          // A chosen file is read from disk lazily: the generated copy stays until the dialog is closed.
          const proceeds = async (p: string) => {
            await d.choose(0, [p]);
            await d.confirmation();
            assert.equal(await d.page.locator('.next-error > p').count(), 0, 'no refusal');
            await d.shots(name);
            await d.operate(cancelButton());
            await d.dialog.waitFor({ state: 'detached' });
          };
          if (path in largeFiles) await large(path, largeFiles[path]!, proceeds);
          else await proceeds(path);
          const c = await d.since(mark);
          d.log({ case: name, ...c });
          assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 0, 0, 0]);
        });

      // The locked requirement (crop.repro ui-no-face, flipped): a photo with no face, confirmed whole with OK, goes
      // straight to one real e4e attempt; the crop does not reopen. The first encode accepts the photo download.
      const okCase = (name: string, path: string, edit?: () => Promise<void>) =>
        run(name, async () => {
          const id = await firstId();
          const mark = await d.mark();
          await d.choose(0, [path]);
          await d.confirmation();
          if (edit) await edit();
          await d.shots(`${name}-confirmation`);
          await d.operate(okButton());
          await d.consent();
          await faceDone(id);
          await d.settled();
          const c = await d.since(mark);
          const m = await readModel(d.page);
          await d.shots(`${name}-result`);
          d.log({
            case: name,
            ...c,
            error: m.Error,
            face: m.faces.includes(id),
          });
          // The confirmation opened once; nothing after OK reopened it.
          assert.equal(c.cropOpen, 1);
          confirmedOnce({ ...c, cropOpen: c.cropOpen - 1 }, m, id);
        });
      await okCase('no-face-ok', fx.noFace);
      // crop.repro ui-redetection-fails, flipped: the person crops the middle half (zoom 2) of a photo whose only
      // face is in a corner; the confirmed crop holds no face and still reaches one e4e attempt.
      await okCase('redetection-fails-zoom-2', fx.redetection, async () => {
        await d.operate(adjustButton());
        const area = d.dialog.getByRole('application', { name: 'Crop area' });
        await area.waitFor();
        for (let i = 0; i < 4; i++) await d.page.keyboard.press('+');
        const zoom = await d.page.evaluate(
          () =>
            (
              window as unknown as {
                __elmish: { model: { Crop: { view: { zoom: number } } } };
              }
            ).__elmish.model.Crop.view.zoom,
        );
        assert.equal(zoom, 2);
        await d.shots('redetection-fails-zoom-2-editor');
        await d.operate(useCrop());
        await okButton().waitFor();
      });
      await okCase('multi-face-ok', fx.multiFace);

      // Manual crop, numerically: the whole of a photo whose derivation is exactly the qualification case
      // seed-0-unaligned. Adjust Crop, zoom out fully, Use Crop, OK; the engine receives that tensor, and the face's
      // W+ (read from its saved file) is within 0.0001 of the native reference, whatever the time it took.
      await run('manual-crop-wplus', async () => {
        const id = await firstId();
        const mark = await d.mark();
        await d.choose(0, [fx.qualification]);
        await d.confirmation();
        await d.operate(adjustButton());
        await d.dialog.getByRole('application', { name: 'Crop area' }).waitFor();
        for (let i = 0; i < 32; i++) await d.page.keyboard.press('-');
        await d.shots('manual-crop-wplus-editor');
        await d.operate(useCrop());
        await d.operate(okButton());
        await d.consent();
        const began = Date.now();
        await faceDone(id);
        await d.settled();
        const ms = Date.now() - began;
        const c = await d.since(mark);
        const m = await readModel(d.page);
        confirmedOnce({ ...c, cropOpen: c.cropOpen - 1 }, m, id);
        assert.deepEqual(
          c.tensorDigests,
          [SEED0_UNALIGNED_TENSOR],
          'the engine received the qualification tensor',
        );
        const saved = await d.save(0);
        writeFileSync(fx.saved, saved);
        const recovered = readRecovery(new Uint8Array(saved));
        assert.equal(recovered.kind, 'parsed', JSON.stringify(recovered).slice(0, 200));
        const values = Array.from(
          (
            recovered as {
              recovered: { latent: { values: ArrayLike<number> } };
            }
          ).recovered.latent.values,
        );
        const stream = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'))
          .encoderStream.url as string;
        const reference = readFileSync(
          join(runtime, stream.split('/runtime/')[1]!, '..', 'seed-0-unaligned.w.f32'),
        );
        const ref = new Float32Array(
          reference.buffer,
          reference.byteOffset,
          reference.byteLength / 4,
        );
        assert.equal(values.length, ref.length);
        const maxError = values.reduce((max, v, i) => Math.max(max, Math.abs(v - ref[i]!)), 0);
        await d.shots('manual-crop-wplus-result');
        d.log({
          case: 'manual-crop-wplus',
          ...c,
          wPlusMaxAbsError: maxError,
          threshold: 1e-4,
          encodeMs: ms,
        });
        assert.ok(maxError <= 1e-4, `max |W+ error| ${maxError}`);
      });

      /** OK, then wait for the e4e attempt to start and cancel the run at the face's visible Cancel. */
      const attemptThenCancel = async () => {
        const id = await firstId();
        const before = (await d.counters()).e4e;
        await d.operate(okButton());
        await d.consent();
        await d.waitE4e(before);
        await d.operate(first().getByRole('button', { name: /^Cancel/ }));
        await d.settled();
        return id;
      };

      // The guide overlay never reaches the pixels (orchestrator ruling, 27 Oct). The ported editor draws no guide
      // yet (fm-z0et owns the oval), so the case lays one over the crop area itself: an opaque oval-and-eyes overlay
      // shown in one confirmation and hidden by CSS in the next, on the same unchanged rectangle (Adjust Crop, Use
      // Crop). Both, and the plain confirmation preview, must give one tensorDigest.
      await run('guide-visible-hidden', async () => {
        const mark = await d.mark();
        const guide = (visible: boolean) =>
          d.page.evaluate((show) => {
            const area = document.querySelector('.next-crop-view')!;
            let g = area.querySelector<HTMLElement>('.test-crop-guide');
            if (!g) {
              g = document.createElement('div');
              g.className = 'test-crop-guide';
              g.setAttribute('aria-hidden', 'true');
              g.style.cssText =
                'position:absolute;inset:12%;border:6px solid #fff;border-radius:50%;pointer-events:none;' +
                'box-shadow:0 0 0 999px rgba(0,0,0,.6);background:radial-gradient(circle at 35% 40%,#f0f 0 6%,transparent 7%),radial-gradient(circle at 65% 40%,#f0f 0 6%,transparent 7%)';
              area.appendChild(g);
            }
            g.style.display = show ? 'block' : 'none';
            return getComputedStyle(g).display;
          }, visible);
        // 1. The plain confirmation preview.
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        await d.shots('guide-none');
        await attemptThenCancel();
        // 2. The editor with the guide overlay visible over the same rectangle.
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        await d.operate(adjustButton());
        await d.dialog.getByRole('application', { name: 'Crop area' }).waitFor();
        assert.equal(await guide(true), 'block');
        await d.shots('guide-visible');
        await d.operate(useCrop());
        await attemptThenCancel();
        // 3. The same, with the overlay hidden by CSS.
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        await d.operate(adjustButton());
        await d.dialog.getByRole('application', { name: 'Crop area' }).waitFor();
        assert.equal(await guide(false), 'none');
        await d.shots('guide-hidden');
        await d.operate(useCrop());
        await attemptThenCancel();
        const c = await d.since(mark);
        d.log({
          case: 'guide-visible-hidden',
          method: 'test overlay in .next-crop-view, shown then display:none',
          ...c,
        });
        assert.equal(c.e4e, 3);
        assert.equal(c.detect, 0);
        assert.equal(c.tensorDigests.length, 3);
        assert.equal(
          new Set(c.tensorDigests).size,
          1,
          'guide shown, hidden or absent: one tensorDigest',
        );
      });

      // All eight EXIF orientations of the same stored pixels: each confirms once and reaches one e4e attempt; the
      // policy ignores EXIF (legacy-ignore-exif), so all eight tensors are the same.
      await run('oriented-exif-1-8', async () => {
        const mark = await d.mark();
        for (const [i, path] of fx.oriented.entries()) {
          const step = await d.mark();
          await d.choose(0, [path]);
          await d.confirmation();
          if (i === 0 || i === 5) await d.shots(`oriented-${i + 1}`);
          await attemptThenCancel();
          const c = await d.since(step);
          d.log({ case: `oriented-${i + 1}`, ...c });
          assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 1, 0, 1]);
        }
        const c = await d.since(mark);
        d.log({ case: 'oriented-exif-1-8', ...c });
        assert.equal(
          new Set(c.tensorDigests).size,
          1,
          'EXIF orientation does not change the tensor',
        );
      });

      // Cancel after OK: one terminal outcome, the face keeps no result, no crop reopens, nothing more is computed.
      await run('cancel-after-ok', async () => {
        const mark = await d.mark();
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        const id = await attemptThenCancel();
        await d.page.waitForTimeout(2000);
        const c = await d.since(mark);
        const m = await readModel(d.page);
        await d.shots('cancel-after-ok');
        d.log({
          case: 'cancel-after-ok',
          ...c,
          error: m.Error,
          status: m.Status,
        });
        assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 1, 0, 1]);
        assert.ok(!m.faces.includes(id), 'the cancelled encode installed nothing');
      });

      // Stale revision: the face is edited (back to words) while its confirmed crop encodes. The edit wins: the
      // late result is not installed over it, and no crop reopens.
      await run('stale-revision', async () => {
        const id = await firstId();
        const mark = await d.mark();
        await d.choose(0, [fx.nonSquare]);
        await d.confirmation();
        const before = (await d.counters()).e4e;
        await d.operate(okButton());
        await d.consent();
        await d.waitE4e(before);
        await d.words(0, 'stale revision check');
        await d.settled();
        await d.page.waitForTimeout(2000);
        const c = await d.since(mark);
        const m = await readModel(d.page);
        await d.shots('stale-revision');
        const input = m.inputs.find((i) => i.id === id)!;
        d.log({ case: 'stale-revision', ...c, input, error: m.Error });
        assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect], [1, 1, 0]);
        assert.ok(c.e4e <= 1);
        assert.deepEqual([input.mode, input.value], ['text', 'stale revision check']);
        assert.ok(
          !m.faces.includes(id),
          'the stale photo result is not installed on the edited face',
        );
      });

      // A 30 MB photo: no detector runs (no worker pass, no detector asset); a manual crop confirms and reaches one
      // e4e attempt.
      await run('large-30mb-manual', async () => {
        const id = await firstId();
        const mark = await d.mark();
        // The generated copy stays until the encode settles: the crop is read from it at OK.
        await large('large-30mb.png', largeFiles['large-30mb.png']!, async (p) => {
          await d.choose(0, [p]);
          await d.confirmation();
          const c0 = await d.since(mark);
          assert.equal(c0.detect, 0, 'the detector was not run');
          await d.operate(adjustButton());
          await d.dialog.getByRole('application', { name: 'Crop area' }).waitFor();
          await d.page.keyboard.press('+');
          await d.shots('large-30mb-editor');
          await d.operate(useCrop());
          await d.operate(okButton());
          await d.consent();
          await faceDone(id);
          await d.settled();
        });
        const c = await d.since(mark);
        const m = await readModel(d.page);
        await d.shots('large-30mb-result');
        d.log({
          case: 'large-30mb-manual',
          ...c,
          error: m.Error,
          fileBytes: 30_000_000,
        });
        confirmedOnce({ ...c, cropOpen: c.cropOpen - 1 }, m, id);
      });

      // Confirmed crops at 2, 3 and many in sequence (1 is every case above): a drop of N photos on the page opens
      // N confirmations one after another; each OK confirms once and runs one e4e attempt, with no detection.
      for (const n of [2, 3, 5])
        await run(`sequence-${n}`, async () => {
          const mark = await d.mark();
          const before = await readModel(d.page);
          // Five different photos, so every confirmed crop has its own tensor.
          const photos = [fx.nonSquare, fx.noFace, fx.multiFace, fx.redetection, fx.qualification];
          await d.drop(
            d.page.getByRole('heading', { name: 'What is this?' }),
            photos.slice(0, n).map((p, i) => ({
              name: `photo-${i}${p.slice(p.lastIndexOf('.'))}`,
              type: p.endsWith('.png') ? 'image/png' : 'image/jpeg',
              base64: b64(p),
            })),
          );
          for (let i = 0; i < n; i++) {
            await d.confirmation();
            if (i === 0) await d.shots(`sequence-${n}-first`);
            const owner = await d.page.evaluate(
              () =>
                (
                  window as unknown as {
                    __elmish: { model: { Crop: { faceId: string } } };
                  }
                ).__elmish.model.Crop.faceId,
            );
            await d.operate(okButton());
            await d.consent();
            await d.page.waitForFunction((face) => {
              const m = (
                window as unknown as {
                  __elmish: { model: { Crop: { faceId: string } | null } };
                }
              ).__elmish.model;
              return m.Crop?.faceId !== face;
            }, owner);
          }
          await d.settled();
          const c = await d.since(mark);
          const m = await readModel(d.page);
          const added = m.inputs.slice(before.inputs.length).map((i) => i.id);
          const targets = m.inputs
            .filter(
              (i) =>
                !before.inputs.some(
                  (b) => b.id === i.id && b.mode === i.mode && b.value === i.value,
                ),
            )
            .map((i) => i.id);
          await d.shots(`sequence-${n}-result`);
          d.log({
            case: `sequence-${n}`,
            ...c,
            added: added.length,
            error: m.Error,
          });
          assert.equal(c.cropOpen, n, 'one confirmation per photo, in sequence');
          assert.equal(c.cropConfirmed, n);
          assert.equal(c.detect, 0);
          assert.equal(c.e4e, n, 'one e4e attempt per confirmed crop');
          assert.equal(m.Error, null);
          assert.ok(targets.length >= n && targets.slice(-n).every((id) => m.faces.includes(id)));
          assert.equal(
            new Set(c.tensorDigests).size,
            c.tensorDigests.length,
            'each crop its own tensor',
          );
        });
      assert.deepEqual(d.errors, [], 'no page errors');

      // ---- Phone, touch taps at 390 px: Cancel, Adjust Crop, Use Crop and OK where a thumb meets them. ----
      if (!only || only.some((n) => n.startsWith('phone-'))) {
        const p = await Session.open(browser, 'phone', 390);
        sessions.push(p);
        const prun = caseRunner(t, p);
        await prun('phone-cancel-before-ok', async () => {
          const mark = await p.mark();
          await p.choose(0, [fx.nonSquare]);
          await p.confirmation();
          await p.shots('phone-cancel-before-ok');
          await p.operate(p.dialog.getByRole('button', { name: 'CANCEL', exact: true }));
          await p.dialog.waitFor({ state: 'detached' });
          const c = await p.since(mark);
          p.log({ case: 'phone-cancel-before-ok', ...c });
          assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 0, 0, 0]);
        });
        await prun('phone-adjust-use-ok', async () => {
          const id = (await p.tiles.nth(0).getAttribute('data-next-face'))!;
          const mark = await p.mark();
          await p.choose(0, [fx.redetection]);
          await p.confirmation();
          await p.operate(p.dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }));
          const area = p.dialog.getByRole('application', { name: 'Crop area' });
          await area.waitFor();
          // A touch drag on the crop square pans it. The drag comes to rest before the finger lifts (the event
          // timestamps hold the end point for 300 ms): a release at speed starts a fling, and Chrome takes the next
          // tap as "stop the fling" with no click, so Use Crop's tap was lost on a fast host.
          const box = (await area.boundingBox())!;
          const cdp = await p.context.newCDPSession(p.page);
          const at = (x: number, y: number) => [{ x, y }];
          const t0 = Date.now() / 1000;
          const end = at(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30);
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: at(box.x + box.width / 2, box.y + box.height / 2),
            timestamp: t0,
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: end,
            timestamp: t0 + 0.2,
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: end,
            timestamp: t0 + 0.5,
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
            timestamp: t0 + 0.5,
          });
          await p.shots('phone-adjust');
          await p.operate(p.dialog.getByRole('button', { name: 'Use Crop', exact: true }));
          await p.operate(p.dialog.getByRole('button', { name: 'OK', exact: true }));
          await p.consent();
          await p.page.waitForFunction(
            (face) => {
              const m = (
                window as unknown as {
                  __elmish: {
                    model: {
                      Faces: { id: string }[];
                      Error: string | null;
                      Busy: boolean;
                    };
                  };
                }
              ).__elmish.model;
              return (m.Faces.some((f) => f.id === face) || m.Error) && !m.Busy;
            },
            id,
            { timeout: 900_000, polling: 500 },
          );
          await p.settled();
          const c = await p.since(mark);
          const m = await readModel(p.page);
          await p.shots('phone-adjust-use-ok-result');
          p.log({ case: 'phone-adjust-use-ok', ...c, error: m.Error });
          assert.deepEqual([c.cropOpen, c.cropConfirmed, c.detect, c.e4e], [1, 1, 0, 1]);
          assert.equal(m.Error, null);
          assert.ok(m.faces.includes(id));
        });
        assert.deepEqual(p.errors, [], 'no page errors');
      }

      // ---- Recovery classes through the drop targets, in fresh contexts: nothing downloaded, so a still that
      // needed a model or the detector would have to request it. ----
      for (const width of [1280, 390] as const) {
        const tag = width === 1280 ? 'drops-desktop' : 'drops-phone';
        if (only && !only.some((n) => n.startsWith(tag))) continue;
        assert.ok(
          existsSync(fx.saved),
          'the encoded face saved by manual-crop-wplus (a matching still)',
        );
        const r = await Session.open(browser, tag, width);
        sessions.push(r);
        const rrun = caseRunner(t, r);
        const pool = [
          { kind: 'matching', path: fx.saved, type: 'image/webp' },
          { kind: 'unknown-model', path: fx.mismatch, type: 'image/png' },
          { kind: 'incompatible-schema', path: fx.future, type: 'image/png' },
          { kind: 'damaged', path: fx.flipped, type: 'image/png' },
          { kind: 'missing', path: fx.nonSquare, type: 'image/jpeg' },
          { kind: 'damaged', path: fx.truncated, type: 'image/png' },
          { kind: 'missing', path: fx.noFace, type: 'image/jpeg' },
        ];
        // Each kind dropped alone on a face's own image: its class, with byte equality where stated.
        await rrun(`${tag}-tile-kinds`, async () => {
          for (const item of pool) {
            const mark = await r.mark();
            const tile = r.tiles.nth(1);
            const id = (await tile.getAttribute('data-next-face'))!;
            const kept = (await readModel(r.page)).inputs.find((i) => i.id === id);
            assert.equal(
              await r.drop(tile.locator('.next-face-image'), [
                {
                  name: `tile.${item.type.split('/')[1]}`,
                  type: item.type,
                  base64: b64(item.path),
                },
              ]),
              id,
              'the drop landed on this face',
            );
            if (item.kind === 'missing') {
              await r.confirmation();
              await r.page.waitForTimeout(1000);
              await r.shots(`${tag}-tile-missing`);
              await r.operate(r.dialog.getByRole('button', { name: 'CANCEL', exact: true }));
              await r.dialog.waitFor({ state: 'detached' });
            } else if (item.kind === 'matching') {
              await tile.locator('img.next-face-img').waitFor({ timeout: 60_000 });
              await r.settled();
              const m = await readModel(r.page);
              assert.equal(m.inputs.find((i) => i.id === id)?.mode, 'project');
              assert.ok(m.faces.includes(id), 'the saved face is installed');
            } else {
              await tile.locator(`[data-next-held="${item.kind}"]`).first().waitFor();
              await r.settled();
              const m = await readModel(r.page);
              const held = m.held.find((h) => h.id === id)!;
              assert.equal(held.kind, item.kind);
              assert.ok(
                !m.faces.includes(id) || item.kind === 'damaged',
                'a held still is never computed with',
              );
              if (item.kind === 'damaged') {
                assert.deepEqual(
                  m.inputs.find((i) => i.id === id),
                  kept,
                  'a damaged still keeps the face identity',
                );
                const decodes = await r.page.evaluate(
                  (b) =>
                    createImageBitmap(
                      new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))]),
                    ).then(
                      (x) => (x.close(), true),
                      () => false,
                    ),
                  b64(item.path),
                );
                assert.equal(
                  (await tile.getByRole('button', { name: 'Use as photo' }).count()) === 1,
                  decodes,
                  'Use as photo only when the pixels decode',
                );
              } else {
                assert.deepEqual(
                  await r.save(1),
                  readFileSync(item.path),
                  'Save returns the opened bytes',
                );
                if (item.kind === 'incompatible-schema')
                  assert.match(await tile.locator('.next-face-held').innerText(), /version 9/);
              }
            }
            await r.shots(`${tag}-tile-${item.kind}`);
            const c = await r.since(mark);
            const line = r.stillLines.at(-1);
            r.log({
              case: `${tag}-tile-${item.kind}`,
              ...c,
              classification: line?.['kind'],
            });
            assert.equal(line?.['kind'], item.kind);
            assert.deepEqual([c.cropConfirmed, c.detect, c.e4e], [0, 0, 0]);
            assert.equal(c.requests.model + c.requests.detector, 0, 'no model or detector request');
            assert.equal(c.cropOpen, item.kind === 'missing' ? 1 : 0);
          }
        });
        // A model mismatch in a morph: the face is left out, with its reason.
        await rrun(`${tag}-mismatch-morph`, async () => {
          const mark = await r.mark();
          const tile = r.tiles.nth(1);
          await r.drop(tile.locator('.next-face-image'), [
            { name: 'other.png', type: 'image/png', base64: b64(fx.mismatch) },
          ]);
          await tile.locator('[data-next-held="unknown-model"]').first().waitFor();
          await r.operate(r.page.getByRole('button', { name: 'Create morph' }));
          await r.page.waitForTimeout(800);
          const m = await readModel(r.page);
          await r.shots(`${tag}-mismatch-morph`);
          const c = await r.since(mark);
          r.log({ case: `${tag}-mismatch-morph`, ...c, status: m.Status });
          assert.match(m.Status, /left out of morphs/);
          assert.equal(c.e4e + c.detect + c.requests.model + c.requests.detector, 0);
        });
        // Mixed drops of 1, 2, 3, 8 and 30 files on the page: every file classified (in drop order) before any face
        // changes; held kinds held, the saved face restored, each photo's confirmation in turn (cancelled here).
        for (const n of width === 1280 ? [1, 2, 3, 8, 30] : [1, 3, 8])
          await rrun(`${tag}-drop-${n}`, async () => {
            const mark = await r.mark();
            const lines = r.stillLines.length;
            const before = await readModel(r.page);
            const files = Array.from({ length: n }, (_, i) => pool[i % pool.length]!);
            const photos = files.filter((f) => f.kind === 'missing').length;
            await r.drop(
              r.page.getByRole('heading', { name: 'What is this?' }),
              files.map((f, i) => ({
                name: `drop-${i}.${f.type.split('/')[1]}`,
                type: f.type,
                base64: b64(f.path),
              })),
            );
            for (let i = 0; i < photos; i++) {
              await r.confirmation();
              if (i === 0) await r.shots(`${tag}-drop-${n}-confirmation`);
              const url = await r.cropUrl();
              await r.operate(r.dialog.getByRole('button', { name: 'CANCEL', exact: true }));
              await r.cropGone(url);
            }
            await r.settled();
            const m = await readModel(r.page);
            await r.page.evaluate(() => window.scrollTo(0, 0));
            await r.shots(`${tag}-drop-${n}`);
            const kinds = r.stillLines.slice(lines).map((l) => l['kind']);
            const c = await r.since(mark);
            r.log({
              case: `${tag}-drop-${n}`,
              ...c,
              kinds,
              classified: r.stillLines.slice(lines),
              inputs: m.inputs.length,
              error: m.Error,
            });
            assert.deepEqual(
              kinds,
              files.map((f) => f.kind),
              'classified in drop order',
            );
            assert.equal(c.cropOpen, photos, 'one confirmation per photo, in turn');
            assert.deepEqual([c.cropConfirmed, c.detect, c.e4e], [0, 0, 0]);
            assert.equal(c.requests.model + c.requests.detector, 0, 'no model or detector request');
            const reused = before.inputs.some(
              (i) => i.mode !== 'photo' && i.mode !== 'project' && !i.value.trim(),
            );
            assert.equal(m.inputs.length, before.inputs.length + n - (reused ? 1 : 0));
            const matching = files.filter((f) => f.kind === 'matching').length;
            assert.equal(
              m.inputs.filter((i) => i.mode === 'project').length -
                before.inputs.filter((i) => i.mode === 'project').length,
              matching +
                files.filter((f) => f.kind === 'unknown-model' || f.kind === 'incompatible-schema')
                  .length,
            );
          });
        assert.deepEqual(r.errors, [], 'no page errors');
      }
    } finally {
      const lines = sessions.flatMap((s) => s.lines);
      writeFileSync(
        join(results, 'evidence.json'),
        JSON.stringify({ fixtures: digests, lines }, null, 1),
      );
      for (const s of sessions) await s.close();
      await browser.close();
      await site.stop();
      rmSync(generated, { recursive: true, force: true });
    }
  },
);
