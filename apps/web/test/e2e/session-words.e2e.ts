// fm-5hww: typed words come back across a real reload of the same tab, a new tab gets only "Restored face", and the
// Help line's stored size and Clear work, in the built destination with real CPU synthesis. Words, seeds and file
// names must appear only in sessionStorage: every other store, exported file and outgoing payload is scanned.
// Controls are operated at their visible position (press: elementFromPoint, real pointer or touch); role/name clicks
// are used only for setup. Face counts default to 1, 2 and 3; FACEMORPH_WORDS_COUNTS=1,2,3,30,64 adds the many-face
// cases (64 is the app's own face limit; CPU synthesis makes them a long local run).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type BrowserContext, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/session-words');
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
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
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
          await page.getByText('Advanced', { exact: true }).click(); // setup
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
