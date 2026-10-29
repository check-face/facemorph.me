// fm-5hww: typed words come back across a real reload of the same tab, a new tab gets only "Restored face", and the
// Help line's stored size and Clear work, in the built destination with real CPU synthesis. Words, seeds and file
// names must appear only in sessionStorage: every other store, exported file and outgoing payload is scanned.
// Controls are operated at their visible position (press: elementFromPoint, real pointer or touch); role/name clicks
// are used only for setup. Face counts default to 1, 2 and 3; FACEMORPH_WORDS_COUNTS=1,2,3,30,64 adds the many-face
// cases (64 is the app's own face limit; CPU synthesis makes them a long local run).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type BrowserContext, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/session-words');
// The built artifact: the directory holding deploy-next/ and its identity (FACEMORPH_DEPLOY_OUT), else the repository's.
const OUT = process.env['FACEMORPH_DEPLOY_OUT']
  ? resolve(process.env['FACEMORPH_DEPLOY_OUT'])
  : REPO;
const COUNTS = (process.env['FACEMORPH_WORDS_COUNTS'] ?? '1,2,3')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 64);
const WORDS_PREFIX = 'facemorph-words-v1:';

/** The words each face gets in a scenario: exact spacing and emoji, a pasted 512-byte name, a seed, plain names. */
function wordsFor(
  n: number,
  viewport: string,
): { mode: 'text' | 'seed'; value: string; paste?: boolean }[] {
  const out: { mode: 'text' | 'seed'; value: string; paste?: boolean }[] = [
    { mode: 'text', value: `  Zoë 🌙 and  spaces ${viewport} ${n}  ` },
    { mode: 'text', value: 'é'.repeat(250) + `${viewport}${n}`.slice(0, 12), paste: true },
    { mode: 'seed', value: String(4294967295 - n) },
  ];
  for (let i = out.length; i < n; i++)
    out.push({ mode: 'text', value: `face ${i} of ${n} ${viewport}` });
  return out.slice(0, n).map((w) =>
    // The pasted name stays within the 512-byte limit whatever the suffix.
    w.paste ? { ...w, value: w.value.slice(0, 256 - 6) } : w,
  );
}

type Model = {
  Inputs: { id: string; mode: string; value: string; file: unknown }[];
  Faces: { id: string }[];
  Status: string;
};
const model = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __elmish: { model: Model } }).__elmish.model,
  ) as Promise<Model>;

/** Every string the app left outside sessionStorage's word entries, with where it was found. */
async function storageStrings(page: Page): Promise<{ where: string; text: string }[]> {
  return page.evaluate(async (prefix) => {
    const out: { where: string; text: string }[] = [];
    const seen = new Set<unknown>();
    const walk = (where: string, v: unknown): void => {
      if (typeof v === 'string') out.push({ where, text: v });
      else if (
        v &&
        typeof v === 'object' &&
        !seen.has(v) &&
        !(v instanceof Blob) &&
        !ArrayBuffer.isView(v)
      ) {
        seen.add(v);
        for (const [k, x] of Object.entries(v)) {
          out.push({ where, text: k });
          walk(where, x);
        }
      }
    };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out.push({ where: 'localStorage', text: k + '=' + localStorage.getItem(k) });
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      if (!k.startsWith(prefix))
        out.push({ where: 'sessionStorage', text: k + '=' + sessionStorage.getItem(k) });
    }
    for (const info of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((r, j) => {
        const q = indexedDB.open(info.name!);
        q.onsuccess = () => r(q.result);
        q.onerror = () => j(q.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<{ key: IDBValidKey; value: unknown }[]>((r, j) => {
          const rows: { key: IDBValidKey; value: unknown }[] = [];
          const c = db.transaction(store).objectStore(store).openCursor();
          c.onsuccess = () => {
            if (!c.result) return r(rows);
            rows.push({ key: c.result.key, value: c.result.value });
            c.result.continue();
          };
          c.onerror = () => j(c.error);
        });
        for (const row of rows) {
          walk(`idb:${info.name}/${store}`, row.key);
          walk(`idb:${info.name}/${store}`, row.value);
          // Blob bytes too: a stored image must not carry words in its metadata.
          const blobs: Blob[] = [];
          const find = (v: unknown, s = new Set<unknown>()): void => {
            if (v instanceof Blob) blobs.push(v);
            else if (v && typeof v === 'object' && !s.has(v) && !ArrayBuffer.isView(v)) {
              s.add(v);
              Object.values(v).forEach((x) => find(x, s));
            }
          };
          find(row.value);
          for (const b of blobs)
            out.push({
              where: `idb-blob:${info.name}/${store}`,
              text: new TextDecoder('utf-8', { fatal: false }).decode(await b.arrayBuffer()),
            });
        }
      }
      db.close();
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        out.push({ where: `cache:${name}`, text: request.url });
    }
    try {
      const list = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
        for await (const [name, handle] of (
          dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
          out.push({ where: 'opfs', text: `${path}/${name}` });
          if (handle.kind === 'directory')
            await list(handle as FileSystemDirectoryHandle, `${path}/${name}`);
        }
      };
      await list(await navigator.storage.getDirectory(), '');
    } catch {
      /* no OPFS */
    }
    return out;
  }, WORDS_PREFIX);
}

const contains = (haystack: string, needle: string) =>
  haystack.includes(needle) ||
  haystack.includes(Buffer.from(needle, 'utf16le').toString('latin1')) ||
  haystack.includes(encodeURIComponent(needle));

test(
  'session words across reload, new tab, stored size and Clear in the built destination',
  { timeout: 3_600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-5hww; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(OUT);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: resolve(OUT, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    const evidence: Record<string, unknown>[] = [];
    try {
      for (const [viewport, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context: BrowserContext = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
          permissions: ['clipboard-read', 'clipboard-write'],
        });
        await context.addInitScript(INSTALL_HOOK);
        // Every outgoing payload (diagnostics collector, analytics) is captured for the words scan.
        const payloads: string[] = [];
        context.on('request', (request) => {
          payloads.push(request.url());
          const body = request.postData();
          if (body) payloads.push(body);
        });
        const errors: string[] = [];
        const open = async () => {
          const page = await context.newPage();
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(`${ORIGIN}/?testing`);
          await page.locator('section.next-face').first().waitFor();
          return page;
        };
        for (const n of COUNTS) {
          const label = `${viewport}-n${n}`;
          const page = await open();
          const operate = async (control: Locator) =>
            assert.ok((await press(page, control, { touch })).inside, `${label}: ${control}`);
          const shot = (name: string) =>
            page.screenshot({ path: join(results, `${label}-${name}.png`), fullPage: n <= 3 });
          const tiles = page.locator('section.next-face');
          const field = (i: number) => tiles.nth(i).locator('.next-field input');
          const toast = page.locator('.next-model-toast').getByRole('button', { name: 'Not now' });
          if (
            await toast.waitFor({ timeout: 4000 }).then(
              () => true,
              () => false,
            )
          )
            await toast.click(); // setup
          await page.getByRole('button', { name: 'More options' }).click(); // setup
          await page.getByLabel('Processing mode').selectOption('cpu'); // setup
          // Setup: the face count.
          if (n === 1)
            await tiles
              .nth(1)
              .getByRole('button', { name: /^Remove/ })
              .click();
          for (let i = 2; i < n; i++) {
            await page.locator('.next-connector-add').last().click();
            await page.waitForFunction(
              (k) => document.querySelectorAll('section.next-face').length === k,
              i + 1,
            );
          }
          assert.equal(await tiles.count(), n);
          const words = wordsFor(n, viewport);
          for (const [i, w] of words.entries()) {
            const f = field(i);
            if (w.mode === 'seed') {
              await tiles.nth(i).getByRole('button', { name: 'Change mode' }).click(); // setup
              await page.getByRole('menuitem', { name: 'Numeric seed', exact: true }).click(); // setup
            }
            await operate(f);
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.press('Backspace');
            if (w.paste) {
              await page.evaluate((v) => navigator.clipboard.writeText(v), w.value);
              await page.keyboard.press('ControlOrMeta+V');
            } else await page.keyboard.insertText(w.value);
            assert.equal(await f.inputValue(), w.value, `${label}: face ${i} typed exactly`);
          }
          await shot('typed');
          const started = Date.now();
          if (n === 1) await operate(tiles.nth(0).locator('.next-face-generate'));
          else await operate(page.getByRole('button', { name: 'Generate faces' }));
          const accept = page.locator('.next-download-accept');
          if (
            await accept.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(accept);
          await page.waitForFunction(
            (k) => {
              const m = (
                window as unknown as { __elmish: { model: { Faces: unknown[]; Busy: boolean } } }
              ).__elmish.model;
              return m.Faces.length === k && !m.Busy;
            },
            n,
            { timeout: 60_000 + n * 60_000, polling: 500 },
          );
          const generateMs = Date.now() - started;
          // The bridge writes the session record after the faces: wait for the record and this tab's words.
          await page.waitForFunction(
            async ([k, prefix]) => {
              const db = await new Promise<IDBDatabase>((r) => {
                const q = indexedDB.open('checkface-originals-v1');
                q.onsuccess = () => r(q.result);
              });
              const rec = await new Promise<{ faces?: unknown[] } | undefined>((r) => {
                const q = db
                  .transaction('originals')
                  .objectStore('originals')
                  .get('last-generated-session-v2');
                q.onsuccess = () => r(q.result);
              });
              db.close();
              const kept = Object.keys(sessionStorage).filter((x) =>
                x.startsWith(prefix as string),
              ).length;
              return rec?.faces?.length === k && kept === k;
            },
            [n, WORDS_PREFIX] as const,
            { timeout: 120_000, polling: 500 },
          );
          // An extra empty face added after generating: nothing to keep for it, and if the view keeps it, it comes
          // back as an empty field.
          const withEmpty = n <= 3;
          if (withEmpty) {
            await page.locator('.next-connector-add').last().click(); // setup
            await page.waitForFunction(
              (k) => document.querySelectorAll('section.next-face').length === k,
              n + 1,
            );
            await page.waitForTimeout(1000);
          }
          await shot('generated');

          // Storage scan: no word, seed or file name outside sessionStorage's word entries.
          const strings = await storageStrings(page);
          for (const w of words) {
            const hits = strings.filter((s) => contains(s.text, w.value.trim()));
            assert.deepEqual(
              hits.map((h) => h.where),
              [],
              `${label}: ${JSON.stringify(w.value)} stored outside sessionStorage`,
            );
          }
          // Exports: the first face's saved WebP carries none of its words (byte scan).
          const download = page.waitForEvent('download');
          await operate(tiles.nth(0).getByRole('button', { name: 'Save image', exact: true }));
          const file = await download;
          const saved = join(
            results,
            `${label}-face0.${(await file.suggestedFilename()).split('.').pop()}`,
          );
          await file.saveAs(saved);
          const bytes = readFileSync(saved).toString('latin1');
          assert.ok(bytes.length > 1000);
          assert.ok(
            !contains(bytes, words[0]!.value.trim()),
            `${label}: words in the exported image`,
          );

          // A real reload of the same tab: the words are back in the fields, exactly; nothing is generated again.
          const before = await model(page);
          await page.reload();
          await page.waitForFunction(
            (k) =>
              (window as unknown as { __elmish: { model: { Faces: unknown[] } } }).__elmish.model
                .Faces.length === k,
            n,
            { timeout: 120_000, polling: 250 },
          );
          const after = await model(page);
          for (const [i, w] of words.entries()) {
            const input = after.Inputs[i]!;
            assert.deepEqual(
              [input.mode, input.value],
              [w.mode, w.value],
              `${label}: face ${i} restored exactly`,
            );
            assert.equal(
              await field(i).inputValue(),
              w.value,
              `${label}: field ${i} shows the exact words`,
            );
            assert.equal(await field(i).isDisabled(), false, `${label}: field ${i} is editable`);
            assert.equal(await tiles.nth(i).getAttribute('data-next-state'), 'filled');
          }
          if (withEmpty && after.Inputs.length > n) {
            assert.deepEqual(
              [after.Inputs[n]!.mode, after.Inputs[n]!.value],
              ['text', ''],
              `${label}: the empty face comes back empty`,
            );
          }
          assert.deepEqual(
            after.Inputs.slice(0, n).map((x) => x.id),
            before.Inputs.slice(0, n).map((x) => x.id),
          );
          await page.waitForTimeout(1500);
          assert.equal(
            (await model(page)).Faces.length,
            n,
            `${label}: restored faces stay; nothing regenerates`,
          );
          await shot('reloaded');

          // A new tab: the same faces, the accepted "Restored face" label, no words.
          const other = await open();
          await other.waitForFunction(
            (k) =>
              (window as unknown as { __elmish: { model: { Faces: unknown[] } } }).__elmish.model
                .Faces.length === k,
            n,
            { timeout: 120_000, polling: 250 },
          );
          const fresh = await model(other);
          assert.ok(
            fresh.Inputs.slice(0, n).every(
              (x) => x.mode === 'project' && x.value === 'Restored face',
            ),
            `${label}: a new tab has no words`,
          );
          await other.screenshot({ path: join(results, `${label}-new-tab.png`), fullPage: n <= 3 });
          await other.close();

          // Help: stored size, then Clear at its visible position.
          const sizeLine = page.locator('.next-stored');
          await sizeLine.scrollIntoViewIfNeeded();
          await page.waitForFunction(() => {
            const v = document.querySelector('.next-stored')?.getAttribute('data-next-stored');
            return v !== null && v !== undefined && v !== '' && Number(v) > 0;
          });
          const storedBefore = Number(await sizeLine.getAttribute('data-next-stored'));
          const sizeText = await page.locator('.next-stored-size').innerText();
          await page.evaluate(() =>
            localStorage.setItem(
              'facemorph-slider-v1',
              JSON.stringify({ enabled: false, frame: 2 }),
            ),
          );
          const sliderBefore = await page.evaluate(() =>
            localStorage.getItem('facemorph-slider-v1'),
          );
          await sizeLine.screenshot({ path: join(results, `${label}-stored.png`) });
          await operate(page.locator('.next-stored-clear'));
          await page.locator('.next-stored-note').waitFor();
          await page.waitForFunction(
            () => document.querySelector('.next-stored')?.getAttribute('data-next-stored') === '0',
          );
          assert.equal(await page.locator('.next-stored-size').innerText(), 'nothing');
          const cleared = await page.evaluate(async (prefix) => {
            const db = await new Promise<IDBDatabase>((r) => {
              const q = indexedDB.open('checkface-originals-v1');
              q.onsuccess = () => r(q.result);
            });
            const count = await new Promise<number>((r) => {
              const q = db.transaction('originals').objectStore('originals').count();
              q.onsuccess = () => r(q.result);
            });
            db.close();
            return {
              records: count,
              words: Object.keys(sessionStorage).filter((x) => x.startsWith(prefix)).length,
              slider: localStorage.getItem('facemorph-slider-v1'),
              caches: (await caches.keys()).length,
            };
          }, WORDS_PREFIX);
          assert.deepEqual(
            [cleared.records, cleared.words, cleared.slider],
            [0, 0, sliderBefore],
            `${label}: Clear removes faces, session and words; keeps the slider setting`,
          );
          await sizeLine.screenshot({ path: join(results, `${label}-cleared.png`) });
          await page.screenshot({ path: join(results, `${label}-cleared-page.png`) });
          await page.reload();
          await page.locator('section.next-face').first().waitFor();
          await page.waitForTimeout(3000);
          const reset = await model(page);
          assert.equal(reset.Faces.length, 0, `${label}: after Clear a reload restores nothing`);
          await shot('after-clear-reload');
          evidence.push({
            label,
            faces: n,
            generateMs,
            storedBytes: storedBefore,
            sizeText,
            modelCaches: cleared.caches,
          });
          await page.close();
        }
        // Outgoing payloads (diagnostics and statistics) carry none of the words.
        for (const n of COUNTS)
          for (const w of wordsFor(n, viewport))
            assert.ok(
              !payloads.some((p) => contains(p, w.value.trim())),
              `${viewport}: ${JSON.stringify(w.value)} in an outgoing request`,
            );
        assert.deepEqual(errors, [], `${viewport}: page errors`);
        await context.close();
      }
    } finally {
      writeFileSync(join(results, 'evidence.json'), JSON.stringify(evidence, null, 2));
      await browser.close();
      await site.stop();
    }
  },
);

/** Shared per-test setup: the identified artifact served for the production origin, CPU Chromium. */
async function site(t: { skip: (reason: string) => void }) {
  if (!existsSync(join(runtime, 'manifest.json'))) {
    const reason = `untested: no acquired runtime at ${runtime}; owner fm-5hww; run on the runtime lane`;
    if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
    t.skip(reason);
    return null;
  }
  const artifact = readIdentity(OUT);
  assert.deepEqual(artifact.findings, []);
  assert.equal(artifact.identity?.label, 'destination');
  const control = await startControl({
    runtime,
    artifact: resolve(OUT, 'deploy-next'),
    source: artifact.identity.deploySource.buildId,
  });
  const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
  mkdirSync(results, { recursive: true });
  return { control, browser };
}

/** One viewport's context, with every outgoing request URL and body captured. */
async function cell(browser: import('playwright').Browser, width: number, touch: boolean) {
  const context = await browser.newContext({
    ...(touch ? devices['iPhone 13'] : {}),
    viewport: { width, height: 900 },
    hasTouch: touch,
    isMobile: touch,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  await context.addInitScript(INSTALL_HOOK);
  const payloads: { url: string; body: string }[] = [];
  context.on('request', (request) =>
    payloads.push({ url: request.url(), body: request.postData() ?? '' }),
  );
  const errors: string[] = [];
  const open = async () => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${ORIGIN}/?testing`);
    await page.locator('section.next-face').first().waitFor();
    return page;
  };
  return { context, payloads, errors, open };
}

async function cpuSetup(page: Page) {
  const toast = page.locator('.next-model-toast').getByRole('button', { name: 'Not now' });
  if (
    await toast.waitFor({ timeout: 4000 }).then(
      () => true,
      () => false,
    )
  )
    await toast.click(); // setup
  await page.getByRole('button', { name: 'More options' }).click(); // setup
  await page.getByLabel('Processing mode').selectOption('cpu'); // setup
}

/** Setup: the shortest real morph, Custom with 2 frames per face. */
async function shortestMorph(page: Page) {
  await page.getByLabel('Morph length', { exact: true }).selectOption('custom'); // setup
  await page.getByRole('textbox', { name: 'Frames per face', exact: true }).fill('2'); // setup
}

const facesReady = (page: Page, k: number, timeout: number) =>
  page.waitForFunction(
    (k) => {
      const m = (window as unknown as { __elmish: { model: { Faces: unknown[]; Busy: boolean } } })
        .__elmish.model;
      return m.Faces.length === k && !m.Busy;
    },
    k,
    { timeout, polling: 500 },
  );

/** Every Blob in IndexedDB is a generated face (its own imageSha256 and a latent), the session's frames/video, or a
 * synthesized morph frame in the frame cache: never a source photo. */
async function storedBlobs(page: Page) {
  return page.evaluate(async () => {
    const hex = async (b: Blob) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())),
        (x) => x.toString(16).padStart(2, '0'),
      ).join('');
    const out: { where: string; kind: string; type: string; size: number; sha: string }[] = [];
    for (const info of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((r) => {
        const q = indexedDB.open(info.name!);
        q.onsuccess = () => r(q.result);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<{ key: IDBValidKey; value: unknown }[]>((r) => {
          const rows: { key: IDBValidKey; value: unknown }[] = [];
          const c = db.transaction(store).objectStore(store).openCursor();
          c.onsuccess = () => {
            if (!c.result) return r(rows);
            rows.push({ key: c.result.key, value: c.result.value });
            c.result.continue();
          };
        });
        const visit = async (where: string, v: unknown, parent: unknown, field: string) => {
          if (v instanceof Blob) {
            const sha = await hex(v);
            const p = parent as { imageSha256?: string; latentSha256?: string } | null;
            const kind =
              field === 'blob' && p?.imageSha256 === sha && typeof p?.latentSha256 === 'string'
                ? 'generated-face'
                : field === 'video' || field === 'frames'
                  ? 'session-' + field
                  : where.startsWith('checkface-morph-frames-v1/')
                    ? 'synthesized-morph-frame'
                    : 'other';
            out.push({ where, kind, type: v.type, size: v.size, sha });
          } else if (v && typeof v === 'object' && !ArrayBuffer.isView(v))
            for (const [k, x] of Object.entries(v))
              await visit(where, x, Array.isArray(v) ? parent : v, Array.isArray(v) ? field : k);
        };
        for (const row of rows)
          await visit(`${info.name}/${store}/${String(row.key)}`, row.value, null, '');
      }
      db.close();
    }
    let session = 0;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      session += k.length + (sessionStorage.getItem(k)?.length ?? 0);
    }
    return { blobs: out, sessionChars: session };
  });
}

test(
  'photo faces keep only their file name; an unfinished photo points to Encode image; MP4 and diagnostics carry no words',
  { timeout: 600_000 }, // 112 s on eris (both widths, a 2-frame-per-face morph each)
  async (t) => {
    const s = await site(t);
    if (!s) return;
    const fixture = join(REPO, 'tests/crop/fixtures/non-square.jpg');
    const fixtureSha = createHash('sha256').update(readFileSync(fixture)).digest('hex');
    try {
      for (const [viewport, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const label = `${viewport}-photo`;
        const c = await cell(s.browser, width, touch);
        const page = await c.open();
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${label}: ${control}`);
        const shot = (name: string) =>
          page.screenshot({ path: join(results, `${label}-${name}.png`), fullPage: true });
        const tiles = page.locator('section.next-face');
        const field = (i: number) => tiles.nth(i).locator('.next-field input');
        await cpuSetup(page);
        // Debug reports on, at the control's visible position.
        await operate(page.locator('#debug-reporting > summary'));
        await operate(page.getByText('Send debug reports until I turn this off.', { exact: true }));
        await page.waitForFunction(
          () =>
            (window as unknown as { __elmish: { model: { Debug: boolean } } }).__elmish.model.Debug,
        );
        const words = `  Photo pair 🌙 words ${viewport}  `;
        await operate(field(0));
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(words);
        // Face 2: the card's own chooser with a real JPEG, its crop confirmed, encoded on the CPU.
        await operate(tiles.nth(1).getByRole('button', { name: 'Change mode', exact: true }));
        const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
        await entry.evaluate(async (el) => {
          const panel = el.closest('.MuiPaper-root');
          await Promise.allSettled(
            (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
          );
        });
        const chooser = page.waitForEvent('filechooser');
        await operate(entry);
        await (await chooser).setFiles([fixture]);
        const dialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
        await operate(dialog.getByRole('button', { name: 'OK', exact: true }));
        await dialog.waitFor({ state: 'detached' });
        const acceptDownloads = async () => {
          const accept = page.locator('.next-download-accept');
          while (
            await accept.waitFor({ timeout: 6000 }).then(
              () => true,
              () => false,
            )
          ) {
            await operate(accept);
            await accept.waitFor({ state: 'detached' });
          }
        };
        await acceptDownloads();
        // The confirmed photo encodes on its own; then Generate faces makes the typed face.
        await page.waitForFunction(
          () => {
            const m = (
              window as unknown as {
                __elmish: {
                  model: { Busy: boolean; PreparingFaces: Set<string>; Faces: unknown[] };
                };
              }
            ).__elmish.model;
            return !m.Busy && m.PreparingFaces.size === 0;
          },
          null,
          { timeout: 900_000, polling: 1000 },
        );
        if ((await model(page)).Faces.length < 2) {
          await operate(page.getByRole('button', { name: 'Generate faces' }));
          await acceptDownloads();
        }
        await facesReady(page, 2, 900_000);
        const photoName = String(
          await page.evaluate(() => {
            const m = (
              window as unknown as {
                __elmish: { model: { Inputs: { mode: string; file: File | null }[] } };
              }
            ).__elmish.model;
            return m.Inputs[1]?.file?.name ?? '';
          }),
        );
        assert.ok(photoName, `${label}: the photo input has a file name`);
        // Face 3: a photo chosen and left at its crop confirmation: unfinished.
        await page.locator('.next-connector-add').last().click(); // setup
        await page.waitForFunction(
          () => document.querySelectorAll('section.next-face').length === 3,
        );
        const card = tiles.nth(2).locator('.next-face-image').getByRole('button', {
          name: 'Encode image',
          exact: true,
        });
        const cardChooser = page.waitForEvent('filechooser');
        await operate(card);
        await (await cardChooser).setFiles([fixture]);
        await dialog.locator('.next-encode-preview img').waitFor();
        await shot('unfinished-photo');
        await page.keyboard.press('Escape'); // the confirmation stays unanswered: close it, keep the input
        await dialog.waitFor({ state: 'detached' });
        // A morph of the two faces, then its MP4 saved and scanned. The scan is of the file's bytes, so the shortest
        // real morph (Custom, 2 frames per face) serves as well as a long one.
        await shortestMorph(page);
        if ((await tiles.count()) === 3)
          await tiles
            .nth(2)
            .getByRole('button', { name: /^Remove/ })
            .click(); // setup: a morph needs every face; the unfinished photo is re-added below
        await operate(page.getByRole('button', { name: 'Create morph' }));
        // The video, or an error; a download question on the way (the video codec) is answered as a person does.
        for (;;) {
          await page.waitForFunction(
            () => {
              const m = (
                window as unknown as {
                  __elmish: { model: { VideoUrl: string; Error: string | null } };
                }
              ).__elmish.model;
              return (
                !!m.VideoUrl ||
                m.Error !== null ||
                !!document.querySelector('.next-download-accept')
              );
            },
            null,
            { timeout: 600_000, polling: 1000 },
          );
          const accept = page.locator('.next-download-accept');
          if (!(await accept.isVisible())) break;
          await operate(accept);
          await accept.waitFor({ state: 'detached' });
        }
        const morphed = await page.evaluate(() => {
          const m = (
            window as unknown as { __elmish: { model: { VideoUrl: string; Error: string | null } } }
          ).__elmish.model;
          return { VideoUrl: m.VideoUrl, Error: m.Error };
        });
        if (!morphed.VideoUrl) await shot('morph-failed');
        assert.equal(morphed.Error, null, `${label}: the morph`);
        assert.ok(morphed.VideoUrl, `${label}: the morph made a video`);
        await facesReady(page, 2, 60_000);
        const videoDownload = page.waitForEvent('download');
        await operate(page.getByRole('button', { name: 'Save video', exact: true }));
        const mp4 = join(results, `${label}.mp4`);
        await (await videoDownload).saveAs(mp4);
        const mp4Bytes = readFileSync(mp4).toString('latin1');
        assert.ok(mp4Bytes.slice(4, 8) === 'ftyp', `${label}: a real MP4`);
        for (const needle of [words.trim(), photoName])
          assert.ok(!contains(mp4Bytes, needle), `${label}: ${needle} in the saved MP4`);
        const stillDownload = page.waitForEvent('download');
        await operate(tiles.nth(1).getByRole('button', { name: 'Save image', exact: true }));
        const still = join(results, `${label}-photo-face.webp`);
        await (await stillDownload).saveAs(still);
        const stillBytes = readFileSync(still).toString('latin1');
        for (const needle of [words.trim(), photoName])
          assert.ok(!contains(stillBytes, needle), `${label}: ${needle} in the saved image`);
        // The unfinished photo again, on a third face, then the session settles.
        await page.locator('.next-connector-add').last().click(); // setup
        await page.waitForFunction(
          () => document.querySelectorAll('section.next-face').length === 3,
        );
        const again = page.waitForEvent('filechooser');
        await operate(
          tiles
            .nth(2)
            .locator('.next-face-image')
            .getByRole('button', { name: 'Encode image', exact: true }),
        );
        await (await again).setFiles([fixture]);
        await dialog.locator('.next-encode-preview img').waitFor();
        await page.waitForFunction(
          async ([prefix]) => {
            const db = await new Promise<IDBDatabase>((r) => {
              const q = indexedDB.open('checkface-originals-v1');
              q.onsuccess = () => r(q.result);
            });
            const rec = await new Promise<{ faces?: unknown[]; ids?: unknown[] } | undefined>(
              (r) => {
                const q = db
                  .transaction('originals')
                  .objectStore('originals')
                  .get('last-generated-session-v2');
                q.onsuccess = () => r(q.result);
              },
            );
            db.close();
            const kept = Object.keys(sessionStorage).filter((x) =>
              x.startsWith(prefix as string),
            ).length;
            return rec?.faces?.length === 2 && rec?.ids?.length === 3 && kept === 2;
          },
          [WORDS_PREFIX] as const,
          { timeout: 120_000, polling: 500 },
        );
        // Storage: no words or file name outside the word entries; every stored Blob is a generated face or the
        // session's own frames/video, never the source photo.
        const strings = await storageStrings(page);
        for (const needle of [words.trim(), photoName])
          assert.deepEqual(
            strings.filter((x) => contains(x.text, needle)).map((x) => x.where),
            [],
            `${label}: ${needle} stored outside sessionStorage`,
          );
        const stored = await storedBlobs(page);
        assert.deepEqual(
          stored.blobs.filter((b) => b.kind === 'other' || b.sha === fixtureSha),
          [],
          `${label}: no photo pixels stored`,
        );
        assert.ok(stored.sessionChars < 64 * 1024, `${label}: sessionStorage holds text only`);
        const wordsEntries = await page.evaluate((prefix) => {
          const out: string[] = [];
          for (const k of Object.keys(sessionStorage))
            if (k.startsWith(prefix)) out.push(sessionStorage.getItem(k)!);
          return out;
        }, WORDS_PREFIX);
        assert.deepEqual(
          wordsEntries.map((x) => JSON.parse(x)).sort((a, b) => (a.mode < b.mode ? -1 : 1)),
          [
            { mode: 'photo', value: photoName },
            { mode: 'text', value: words },
          ],
          `${label}: the tab keeps the exact words and only the photo's file name`,
        );
        await shot('before-reload');
        // A real reload: the photo face shows only its file name; the unfinished photo points to Encode image.
        await page.reload();
        await facesReady(page, 2, 120_000);
        const after = await model(page);
        assert.deepEqual(
          after.Inputs.slice(0, 2).map((x) => [x.mode, x.value]),
          [
            ['text', words],
            ['project', photoName],
          ],
          `${label}: words exact; the photo face is labelled with its file name only`,
        );
        assert.equal(await field(1).inputValue(), photoName);
        assert.equal(
          await field(1).isDisabled(),
          true,
          'the restored photo face is not editable text',
        );
        assert.equal(
          await tiles.count(),
          3,
          `${label}: the unfinished photo's face is still there`,
        );
        assert.equal(await tiles.nth(2).getAttribute('data-next-state'), 'empty');
        assert.equal(
          await tiles
            .nth(2)
            .locator('.next-face-image')
            .getByRole('button', { name: 'Encode image', exact: true })
            .count(),
          1,
          `${label}: the lost unfinished photo points to Encode image`,
        );
        assert.equal(
          await page.getByRole('button', { name: 'Retry' }).count(),
          0,
          `${label}: never Retry`,
        );
        await shot('reloaded');
        // Diagnostics with reporting on: at least one report was sent, and no payload carries the words or name.
        const reports = c.payloads.filter((p) => p.url.includes('/diagnostics/'));
        assert.ok(reports.length > 0, `${label}: debug reports were sent`);
        for (const needle of [words.trim(), photoName])
          assert.deepEqual(
            c.payloads
              .filter((p) => contains(p.url, needle) || contains(p.body, needle))
              .map((p) => p.url),
            [],
            `${label}: ${needle} in an outgoing payload`,
          );
        writeFileSync(
          join(results, `${label}-diagnostics.json`),
          JSON.stringify(
            reports.map((r) => ({ url: r.url, body: r.body.slice(0, 4000) })),
            null,
            2,
          ),
        );
        assert.deepEqual(c.errors, [], `${label}: page errors`);
        await c.context.close();
      }
    } finally {
      await s.browser.close();
      await s.control.stop();
    }
  },
);

test(
  'many faces through a real project import, then the stored-session byte bound (no face count) on reload',
  { timeout: 300_000 }, // 44 s on eris
  async (t) => {
    const s = await site(t);
    if (!s) return;
    const evidence: Record<string, unknown> = {};
    try {
      const c = await cell(s.browser, 1280, false);
      const page = await c.open();
      const operate = async (control: Locator) =>
        assert.ok((await press(page, control)).inside, `${control}`);
      const tiles = page.locator('section.next-face');
      const shots = async (name: string) => {
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(300);
          await tiles
            .first()
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.screenshot({ path: join(results, `many-${width}-${name}.png`) });
        }
        await page.setViewportSize({ width: 1280, height: 900 });
      };
      await cpuSetup(page);
      // A real saved MP4 from this app: two faces and the shortest real morph.
      await shortestMorph(page);
      await operate(page.getByRole('button', { name: 'Create morph' }));
      const accept = page.locator('.next-download-accept');
      if (
        await accept.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await operate(accept);
      await page.waitForFunction(
        () =>
          !!(window as unknown as { __elmish: { model: { VideoUrl: string } } }).__elmish.model
            .VideoUrl,
        null,
        { timeout: 600_000, polling: 1000 },
      );
      await facesReady(page, 2, 60_000);
      const saved = page.waitForEvent('download');
      await operate(page.getByRole('button', { name: 'Save video', exact: true }));
      const source = join(results, 'many-source.mp4');
      await (await saved).saveAs(source);
      // The project file: the app's own MP4 project, rewritten by the app's own writer with the schema's most
      // controls (64, the project codec's MAX_CONTROLS and the app's face limit), alternating its two real latents.
      const { readProjectMp4, writeProjectMp4 } = await import('../../src/media/recovery-files.ts');
      const bytes = new Uint8Array(readFileSync(source));
      const project = JSON.parse(readProjectMp4(bytes)!.text);
      const pair = project.morph.controls;
      project.morph.controls = Array.from({ length: 64 }, (_, i) => ({
        visitId: `face-${i}`,
        latent: pair[i % 2].latent,
      }));
      const many = join(results, 'many-64.mp4');
      writeFileSync(many, writeProjectMp4(bytes, project));
      // Opened through the card's own chooser, as a person opens a saved video.
      await operate(tiles.nth(0).getByRole('button', { name: 'Change mode', exact: true }));
      const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
      await entry.evaluate(async (el) => {
        const panel = el.closest('.MuiPaper-root');
        await Promise.allSettled(
          (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
        );
      });
      const chooser = page.waitForEvent('filechooser');
      await operate(entry);
      const started = Date.now();
      await (await chooser).setFiles([many]);
      await facesReady(page, 64, 3_000_000);
      evidence['import64Ms'] = Date.now() - started;
      const settled = (k: number) =>
        page.waitForFunction(
          async (k) => {
            const db = await new Promise<IDBDatabase>((r) => {
              const q = indexedDB.open('checkface-originals-v1');
              q.onsuccess = () => r(q.result);
            });
            const rec = await new Promise<{ faces?: unknown[] } | undefined>((r) => {
              const q = db
                .transaction('originals')
                .objectStore('originals')
                .get('last-generated-session-v2');
              q.onsuccess = () => r(q.result);
            });
            db.close();
            return rec?.faces?.length === k;
          },
          k,
          { timeout: 600_000, polling: 1000 },
        );
      await settled(64);
      await shots('imported-64');
      await page.reload();
      await facesReady(page, 64, 300_000);
      const restored64 = await model(page);
      assert.equal(restored64.Inputs.length, 64);
      assert.ok(
        restored64.Inputs.every((x) => x.mode === 'project' && x.value === 'Restored face'),
        'imported faces have no words: the accepted Restored face label',
      );
      await shots('reloaded-64');

      // Beyond the app's own 64: session records made of this app's real stored faces, repeated. Restore is
      // bounded by bytes, not by count: 150 faces and the most faces that fit MAX_SESSION_BYTES restore in full;
      // one face more than fits is refused whole, never partly.
      const plant = (n: number | 'fit') =>
        page.evaluate(async (n) => {
          const db = await new Promise<IDBDatabase>((r) => {
            const q = indexedDB.open('checkface-originals-v1');
            q.onsuccess = () => r(q.result);
          });
          const store = () => db.transaction('originals', 'readwrite').objectStore('originals');
          const record = await new Promise<{
            faces: { id: string; result: { blob: Blob } }[];
            ids: string[];
          }>((r) => {
            const q = store().get('last-generated-session-v2');
            q.onsuccess = () => r(q.result);
          });
          const bound = 32 * 1024 * 1024;
          const faces: { id: string; result: { blob: Blob } }[] = [];
          let bytes = 0;
          for (let i = 0; n === 'fit' ? true : i < n; i++) {
            const face = record.faces[i % record.faces.length]!;
            if (n === 'fit' && bytes + face.result.blob.size > bound) break;
            bytes += face.result.blob.size;
            faces.push({ ...face, id: `face-${i}` });
          }
          await new Promise<void>((r) => {
            const q = store().put(
              {
                ...record,
                ids: faces.map((f) => f.id),
                faces,
                project: null,
                frames: [],
                frameHashes: [],
                video: null,
                videoSha256: null,
              },
              'last-generated-session-v2',
            );
            q.onsuccess = () => r();
          });
          db.close();
          return { faces: faces.length, bytes, bound };
        }, n);
      const hundredFifty = await plant(150);
      assert.ok(hundredFifty.bytes <= hundredFifty.bound, '150 of these faces fit the byte bound');
      evidence['hundredFifty'] = hundredFifty;
      await page.reload();
      await facesReady(page, 150, 600_000);
      const restored150 = await model(page);
      assert.equal(restored150.Inputs.length, 150, '150 faces restore: no face count check');
      // Past its threshold the strip renders only the tiles near the view (fm-id4c); the model holds all 150.
      assert.equal(
        await page.locator('[data-next-virtual="true"]').count(),
        1,
        'a virtualised strip',
      );
      assert.ok((await tiles.count()) > 0, 'the tiles near the view are rendered');
      await shots('restored-150');
      const fit = await plant('fit');
      assert.ok(fit.faces > 64, `more than 64 faces fit the byte bound: ${fit.faces}`);
      evidence['atBound'] = fit;
      await page.reload();
      await facesReady(page, fit.faces, 600_000);
      assert.equal(
        (await model(page)).Inputs.length,
        fit.faces,
        'every face under the bound restores',
      );
      await shots(`at-bound-${fit.faces}`);
      // One more face than fits: over the bound by one face, refused whole.
      const over = await plant(fit.faces + 1);
      assert.ok(over.bytes > over.bound);
      evidence['overBound'] = over;
      await page.reload();
      await page.waitForTimeout(8000);
      const afterOver = await model(page);
      assert.equal(afterOver.Faces.length, 0, 'one face over the bound: refused whole');
      assert.equal(
        afterOver.Inputs[0]?.value,
        'hello',
        'the page starts fresh, no partial restore',
      );
      await shots('over-bound');
      // Clear at its visible position empties the store.
      const sizeLine = page.locator('.next-stored');
      await sizeLine.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => Number(document.querySelector('.next-stored')?.getAttribute('data-next-stored')) > 0,
      );
      evidence['storedBeforeClear'] = Number(await sizeLine.getAttribute('data-next-stored'));
      await operate(page.locator('.next-stored-clear'));
      await page.waitForFunction(
        () => document.querySelector('.next-stored')?.getAttribute('data-next-stored') === '0',
      );
      await shots('cleared');
      assert.deepEqual(c.errors, [], 'page errors');
      await c.context.close();
    } finally {
      writeFileSync(join(results, 'many-evidence.json'), JSON.stringify(evidence, null, 2));
      await s.browser.close();
      await s.control.stop();
    }
  },
);
