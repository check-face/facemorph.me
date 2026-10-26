// fm-25um: operated controls in the identified, composed application, with real CPU synthesis.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { generationIdentity } from '../../src/Next/browser/identity.mjs';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/face-controls');

test(
  'composed tile validation, exact values, Enter, Cancel and Retry at visible positions',
  // Many real CPU faces in one journey: 470 s on a quiet eris, past 600 s at load ~44 (main run 40325727795).
  { timeout: 1_200_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-25um; run on the runtime lane`;
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
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          permissions: ['clipboard-read', 'clipboard-write'],
        });
        // Omit DOM snapshots and source files: runtime model responses can otherwise make traces enormous.
        await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
        await context.addInitScript(INSTALL_HOOK);
        const page = await context.newPage();
        const errors: string[] = [];
        const modelRequests: string[] = [];
        const requests: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          requests.push(request.url());
          const path = new URL(request.url()).pathname;
          if (/^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(path))
            modelRequests.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside);
        const shot = async (caseName: string) =>
          page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: true });
        const replace = async (field: Locator, value: string) => {
          await operate(field);
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText(value);
          assert.equal(await field.inputValue(), value);
        };
        const idle = async () =>
          page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 180_000 },
          );
        try {
          await page.goto(ORIGIN);
          await page.locator('section.next-face').nth(1).waitFor();
          for (const control of [
            page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
            page.getByRole('button', { name: 'Ask me later' }),
          ]) {
            if (
              await control.waitFor({ timeout: 5000 }).then(
                () => true,
                () => false,
              )
            )
              await operate(control);
          }
          await operate(page.getByRole('button', { name: 'More options' }));
          await operate(page.getByText('Advanced', { exact: true }));
          await page.getByLabel('Processing mode').selectOption('cpu');
          const tile = page.locator('section.next-face').nth(1);
          const field = tile.locator('.next-field input');
          const completedInput = async (value: string) => {
            // Saving awaits the real file encoder and cache commit. Its cache key
            // contains the generator's exact UTF-8 input identity, not a UI label.
            const saved = page.waitForEvent('download');
            await operate(tile.getByRole('button', { name: 'Save image', exact: true }));
            const file = await saved;
            await file.saveAs(join(results, `${name}-${value}.webp`));
            const sha = (text: string) => createHash('sha256').update(text).digest('hex');
            const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'));
            const generationSha256 = sha(JSON.stringify(generationIdentity(manifest, 'seed')));
            const key = sha(
              JSON.stringify({ generationSha256, kind: 'seed', identity: { sha256: sha(value) } }),
            );
            const record = await page.evaluate(async (key) => {
              const open = indexedDB.open('checkface-originals-v1');
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                open.onsuccess = () => resolve(open.result);
                open.onerror = () => reject(open.error);
              });
              try {
                const get = db.transaction('originals').objectStore('originals').get(key);
                const result = await new Promise<{
                  blob: Blob;
                  generationSha256: string;
                  latentSha256: string;
                }>((resolve, reject) => {
                  get.onsuccess = () => resolve(get.result);
                  get.onerror = () => reject(get.error);
                });
                return result
                  ? {
                      bytes: result.blob.size,
                      generationSha256: result.generationSha256,
                      latentSha256: result.latentSha256,
                    }
                  : null;
              } finally {
                db.close();
              }
            }, key);
            assert.equal(record?.generationSha256, generationSha256);
            assert.ok(
              (record?.bytes ?? 0) > 0,
              `${value}: exact input has a real completed cache record`,
            );
            return record!;
          };
          for (const [attribute, value] of [
            ['autocapitalize', 'off'],
            ['autocorrect', 'off'],
            ['spellcheck', 'false'],
          ])
            assert.equal(await field.getAttribute(attribute!), value);
          // Copy snapshot: exactly one plain message per refused input, and no glued sentences,
          // "1 seconds" or raw exception text anywhere in the product.
          const refused = async (caseName: string, expected: string | null) => {
            assert.deepEqual(
              await tile.locator('.MuiFormHelperText-root').allInnerTexts(),
              expected === null ? [] : [expected],
              caseName,
            );
            const text = await page.locator('.next-product').innerText();
            assert.doesNotMatch(text, /\b1 seconds\b/, caseName);
            assert.doesNotMatch(text, /[a-z][.!?][A-Z]/, `${caseName}: missing space`);
            assert.doesNotMatch(
              text,
              /\b(Type|Range|Reference|Syntax)?Error\b|\n\s+at \S+:\d+/,
              caseName,
            );
          };
          const mode = async (label: string) => {
            await operate(tile.getByRole('button', { name: 'Change mode' }));
            await operate(page.getByRole('menuitem', { name: label, exact: true }));
          };
          await mode('Numeric seed');
          for (const value of ['0', '4294967295', '-1', '1.5', '4294967296', '', ' 42 ']) {
            await replace(field, value);
            assert.equal(
              await tile.locator('.next-face-generate').isDisabled(),
              !['0', '4294967295'].includes(value),
              value,
            );
            await refused(
              `seed ${JSON.stringify(value)}`,
              ['0', '4294967295'].includes(value)
                ? null
                : 'Use a whole number from 0 to 4294967295.',
            );
            await shot(`seed-${value.replace(/\W/g, '_') || 'empty'}`);
          }
          await mode('Name or words');
          for (const [caseName, value, valid] of [
            ['empty', '', false],
            ['whitespace', '   ', false],
            ['512-bytes', 'é'.repeat(256), true],
            ['513-bytes', 'é'.repeat(256) + 'a', false],
            ['long-pasted', 'x'.repeat(10_000), false],
            ['lowercase', 'hello', true],
          ] as const) {
            await replace(field, value);
            assert.equal(await tile.locator('.next-face-generate').isDisabled(), !valid, caseName);
            await refused(
              caseName,
              valid
                ? null
                : value.trim() === ''
                  ? 'Type some words to make a face.'
                  : 'Use at most 512 bytes of text.',
            );
            await shot(caseName);
          }
          // Drive native IME composition, then a real Enter key. Composition must
          // not start generation or acquisition; no event/browser API is replaced.
          await replace(field, '');
          const cdp = await context.newCDPSession(page);
          const beforeComposition = await page.evaluate('window.__elmish.model.JobId');
          await cdp.send('Input.imeSetComposition', {
            text: 'hello',
            selectionStart: 5,
            selectionEnd: 5,
          });
          await page.keyboard.press('Enter');
          await cdp.send('Input.insertText', { text: 'hello' });
          assert.equal(await field.inputValue(), 'hello');
          assert.equal(await page.evaluate('window.__elmish.model.JobId'), beforeComposition);
          assert.equal(await page.locator('.next-download-dialog').count(), 0);
          await shot('ime-composition');
          await cdp.detach();
          assert.deepEqual(modelRequests, [], 'typing and invalid Generate acquire no model');
          await operate(field);
          await page.keyboard.press('Enter');
          const download = page.locator('.next-download-accept');
          if (
            await download.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(download);
          await page.waitForFunction(() =>
            document.querySelector('.next-product[data-next-busy=true]'),
          );
          const firstJob = await page.evaluate('window.__elmish.model.JobId');
          for (let repeat = 0; repeat < 3; repeat++) await page.keyboard.press('Enter');
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 180_000 },
          );
          await idle();
          assert.equal(
            await page.evaluate('window.__elmish.model.JobId'),
            firstJob,
            'Enter cannot duplicate an active job',
          );
          assert.match(await page.locator('.next-route-caption').innerText(), /CPU/);
          assert.equal(
            await tile.locator('.next-face-generate').count(),
            0,
            'verified result has no Generate',
          );
          assert.equal(await page.locator('.next-compare, .next-file').count(), 0);
          await shot('generated');
          const lowercase = await completedInput('hello');
          await replace(field, 'Hello');
          await operate(tile.locator('.next-input-row .next-face-generate'));
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 180_000 },
          );
          await idle();
          const uppercase = await completedInput('Hello');
          assert.notEqual(
            lowercase.latentSha256,
            uppercase.latentSha256,
            'Hello and hello produce different actual identities',
          );
          await shot('uppercase-identity');
          const beforeEdit = modelRequests.length;
          const requestsBeforeEdit = requests.length;
          await operate(field);
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText('c');
          assert.notEqual(await tile.getAttribute('data-next-state'), 'filled');
          assert.equal(await tile.locator('.next-input-row .next-face-generate').count(), 1);
          {
            // Inline beside the textbox: to its right, on the same line.
            const fieldBox = await tile.locator('.next-field .MuiOutlinedInput-root').boundingBox();
            const actionBox = await tile
              .locator('.next-input-row .next-face-generate')
              .boundingBox();
            assert.ok(fieldBox && actionBox);
            assert.ok(
              actionBox.x >= fieldBox.x + fieldBox.width - 1,
              'Generate sits right of the field',
            );
            assert.ok(
              actionBox.y < fieldBox.y + fieldBox.height &&
                actionBox.y + actionBox.height > fieldBox.y,
              'Generate shares the field line',
            );
          }
          await page.keyboard.insertText('ancel this exact input');
          assert.equal(await field.inputValue(), 'cancel this exact input');
          assert.equal(modelRequests.length, beforeEdit, 'editing makes no model requests');
          assert.deepEqual(requests.slice(requestsBeforeEdit), [], 'keystrokes make no requests');
          await shot('edited-result');
          assert.notEqual(
            await tile.getAttribute('data-next-state'),
            'filled',
            'edit clears the old result',
          );
          const action = tile.locator('.next-input-row .next-face-generate');
          await operate(action);
          await page.waitForFunction(
            () =>
              document
                .querySelectorAll('section.next-face')[1]
                ?.querySelector('.next-tile-status')
                ?.textContent?.trim() === 'Generating…',
            null,
            { timeout: 180_000 },
          );
          await operate(action);
          const stopping = (await action.textContent())?.trim();
          if (stopping === 'Cancelling') assert.equal(await action.isDisabled(), true);
          else {
            // CPU worker termination can settle before the pointer action returns.
            // An enabled Retry is truthful only after the real operation has settled.
            assert.equal(stopping, 'Retry');
            assert.equal(await page.evaluate('window.__elmish.model.Busy'), false);
          }
          await page.waitForFunction(
            () =>
              document
                .querySelectorAll('section.next-face')[1]
                ?.querySelector('.next-face-generate')
                ?.textContent?.trim() === 'Retry',
            null,
            { timeout: 180_000 },
          );
          assert.equal(await field.inputValue(), 'cancel this exact input');
          await shot('retry');
          await operate(action);
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
              'filled',
            null,
            { timeout: 180_000 },
          );
          await idle();
          await shot('retried');

          // Replacement commit points: a cancelled chooser and a damaged saved image keep the result
          // and every other face; an import still pending when the field is edited is never installed.
          const snapshot = () =>
            page.evaluate(() => {
              const model = (
                window as unknown as {
                  __elmish: {
                    model: {
                      Faces: { id: string; url: string; label: string; sourceMode: string }[];
                      Inputs: { id: string; mode: string; value: string }[];
                    };
                  };
                }
              ).__elmish.model;
              return JSON.stringify({
                faces: model.Faces.map(({ id, url, label, sourceMode }) => ({
                  id,
                  url,
                  label,
                  sourceMode,
                })),
                inputs: model.Inputs.map(({ id, mode, value }) => ({ id, mode, value })),
              });
            });
          const kept = await snapshot();
          const encodeDialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
          // Encode image opens this card's own file chooser directly: no empty source modal.
          const choose = async (files: string[]) => {
            const chooser = page.waitForEvent('filechooser');
            await mode('Encode image');
            await (await chooser).setFiles(files);
            assert.equal(await encodeDialog.count(), 0, 'no source modal before a photo');
          };
          await choose([]);
          assert.equal(await snapshot(), kept, 'a cancelled chooser keeps the result');
          assert.equal(await tile.getAttribute('data-next-state'), 'filled');
          const saved = readFileSync(join(results, `${name}-hello.webp`));
          const damaged = join(results, `${name}-damaged.webp`);
          writeFileSync(damaged, saved.subarray(0, Math.floor(saved.length / 2)));
          await choose([damaged]);
          await page.waitForFunction(
            () =>
              (window as unknown as { __elmish: { model: { PreparingFaces: Set<string> } } })
                .__elmish.model.PreparingFaces.size === 0,
          );
          await shot('damaged-saved-image');
          // fm-4f5m: the face holds the damaged file with one plain reason tied to it, not the parser error.
          const held = tile.locator('.next-face-held[data-next-held="damaged"]');
          assert.match(
            (await held.getAttribute('data-reason-key')) ?? '',
            /^still-damaged-/,
            'a damage class names the reason',
          );
          assert.match(await held.innerText(), /saved face data/);
          assert.equal(await encodeDialog.count(), 0, 'a damaged file opens no crop');
          assert.equal(await snapshot(), kept, 'a damaged saved image keeps the result');
          assert.equal(await tile.getAttribute('data-next-state'), 'filled');
          // A real PNG on the clipboard, pasted into the field while the CPU is throttled so the import
          // is still preparing when the words change; it must never be installed.
          await page.evaluate(
            async (bytes) => {
              const source = await createImageBitmap(
                new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
              );
              const canvas = document.createElement('canvas');
              canvas.width = source.width;
              canvas.height = source.height;
              canvas.getContext('2d')!.drawImage(source, 0, 0);
              const png = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (b) => (b ? resolve(b) : reject(Error('PNG encode failed'))),
                  'image/png',
                ),
              );
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
            },
            [...readFileSync(join(REPO, 'tests/crop/fixtures/non-square.jpg'))],
          );
          const throttle = await context.newCDPSession(page);
          await throttle.send('Emulation.setCPUThrottlingRate', { rate: 20 });
          const faceId = await tile.getAttribute('data-next-face');
          await operate(field);
          await page.keyboard.press('ControlOrMeta+V');
          // Measured before the edit (an edit itself ends that face's preparation).
          const pendingAtEdit = await page.evaluate(
            (id) =>
              (
                window as unknown as { __elmish: { model: { PreparingFaces: Set<string> } } }
              ).__elmish.model.PreparingFaces.has(id!) &&
              !document.querySelector('.next-encode-preview img'),
            faceId,
          );
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.insertText('edited while importing');
          await throttle.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          await throttle.detach();
          assert.ok(pendingAtEdit, 'the paste import was still preparing when the words changed');
          await page.waitForFunction(
            () =>
              (window as unknown as { __elmish: { model: { PreparingFaces: Set<string> } } })
                .__elmish.model.PreparingFaces.size === 0,
          );
          await page.waitForTimeout(1000);
          assert.equal(await encodeDialog.count(), 0, 'the late import opens no confirmation');
          assert.equal(await field.inputValue(), 'edited while importing');
          const after = JSON.parse(await snapshot()) as {
            faces: unknown[];
            inputs: { id: string }[];
          };
          const before = JSON.parse(kept) as { faces: { id: string }[]; inputs: { id: string }[] };
          assert.deepEqual(
            after.inputs.filter((i) => i.id !== faceId),
            before.inputs.filter((i) => i.id !== faceId),
            'other faces unchanged',
          );
          assert.deepEqual(
            after.faces,
            before.faces.filter((f) => f.id !== faceId),
            'the late import installs no face; only the edited face lost its result',
          );
          await shot('late-import-not-installed');

          // Typing in face 2 of 3 while it generates cancels only face 2; faces 1 and 3 still
          // generate and face 2's late result for the old words is never installed.
          await operate(page.getByRole('button', { name: 'Add face', exact: true }));
          const tiles = page.locator('section.next-face');
          await tiles.nth(2).waitFor();
          assert.equal(await tiles.count(), 3);
          const ids = await tiles.evaluateAll((all) =>
            all.map((element) => element.getAttribute('data-next-face')!),
          );
          await replace(tiles.nth(0).locator('.next-field input'), 'first of three');
          await replace(tiles.nth(2).locator('.next-field input'), 'third of three');
          await replace(field, 'second of three');
          await page.evaluate((ids) => {
            const seen: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
            (window as unknown as { __slots: typeof seen }).__slots = seen;
            const record = () => {
              for (const id of ids) {
                const text = document
                  .querySelector(`section.next-face[data-next-face="${id}"] .next-face-generate`)
                  ?.textContent?.trim();
                const list = seen[id]!;
                if (text && list.at(-1) !== text) list.push(text);
              }
            };
            new MutationObserver(record).observe(document.body, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
            });
            record();
          }, ids);
          const slot = (index: number) =>
            tiles.nth(index).locator('.next-input-row .next-face-generate');
          const slow = await context.newCDPSession(page);
          await slow.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await operate(slot(1));
          await operate(slot(0));
          await operate(slot(2));
          const activeAtEdit = await page.evaluate(
            () =>
              (window as unknown as { __elmish: { model: { Busy: boolean; ActiveFace: string } } })
                .__elmish.model,
          );
          await operate(field);
          await page.keyboard.press('End');
          await page.keyboard.insertText(' edited');
          await slow.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          await slow.detach();
          assert.ok(
            activeAtEdit.Busy && activeAtEdit.ActiveFace === ids[1],
            'face 2 was generating when its words changed',
          );
          await page.waitForFunction(
            (ids) =>
              [ids[0], ids[2]].every(
                (id) =>
                  document
                    .querySelector(`section.next-face[data-next-face="${id}"]`)
                    ?.getAttribute('data-next-state') === 'filled',
              ),
            ids,
            { timeout: 180_000 },
          );
          await idle();
          await page.waitForTimeout(1000);
          await shot('edit-face-2-of-3');
          const slots = await page.evaluate(
            () => (window as unknown as { __slots: Record<string, string[]> }).__slots,
          );
          const finalModel = JSON.parse(await snapshot()) as {
            faces: { id: string }[];
            inputs: { id: string; value: string }[];
          };
          assert.equal(await field.inputValue(), 'second of three edited');
          assert.notEqual(await tiles.nth(1).getAttribute('data-next-state'), 'filled');
          assert.equal(
            (await slot(1).textContent())?.trim(),
            'Generate',
            'new revision offers Generate',
          );
          assert.ok(
            !finalModel.faces.some((face) => face.id === ids[1]),
            'the old revision result is rejected',
          );
          assert.deepEqual(
            finalModel.faces.map((face) => face.id).sort(),
            [ids[0], ids[2]].sort(),
            'faces 1 and 3 completed',
          );
          // Cancelling is shown unless the CPU worker settled before the next frame.
          const second = slots[ids[1]!]!;
          assert.equal(second.at(-1), 'Generate');
          assert.ok(second.includes('Cancel'), `face 2 was cancellable: ${second.join(' > ')}`);
          for (const id of [ids[0]!, ids[2]!])
            assert.ok(
              !slots[id]!.includes('Cancelling'),
              `only face 2 cancels: ${slots[id]!.join(' > ')}`,
            );
          console.log(`fm-25um ${name} face slots`, JSON.stringify(slots));
          assert.deepEqual(errors, []);
        } catch (error) {
          await shot('failure').catch(() => {});
          throw error;
        } finally {
          await context.tracing.stop({ path: join(results, `${name}-trace.zip`) });
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);

test(
  'photo encoding genuinely refused: every photo entry reads Open saved image and a saved image opens and saves',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-25um; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    // The same verified runtime with the encoder not delivered: its manifest names no encoder and the
    // encoder files are absent from the server, so admission refuses photo encoding (encoder-not-delivered).
    const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'));
    const encoderDir = String(manifest.encoder?.url ?? '')
      .split('/')
      .at(-2);
    delete manifest.encoder;
    delete manifest.encoderStream;
    const refused = mkdtempSync(join(tmpdir(), 'fm-refused-encoder-'));
    for (const entry of readdirSync(runtime))
      if (!['manifest.json', 'assets', 'encoder-stream'].includes(entry))
        symlinkSync(join(runtime, entry), join(refused, entry));
    mkdirSync(join(refused, 'assets'));
    for (const entry of readdirSync(join(runtime, 'assets')))
      if (entry !== encoderDir)
        symlinkSync(join(runtime, 'assets', entry), join(refused, 'assets', entry));
    writeFileSync(join(refused, 'manifest.json'), JSON.stringify(manifest));
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    // A real saved image first, generated on the CPU with the full runtime this artifact is pinned to.
    const saved = join(results, 'refused-source.webp');
    const full = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
      const page = await context.newPage();
      await page.goto(ORIGIN);
      const second = page.locator('section.next-face').nth(1);
      await second.waitFor();
      await page.getByRole('button', { name: 'More options' }).click(); // setup
      await page.getByText('Advanced', { exact: true }).click(); // setup
      await page.getByLabel('Processing mode').selectOption('cpu');
      await second.locator('.next-input-row .next-face-generate').click(); // setup
      const consent = page.locator('.next-download-accept');
      if (
        await consent.waitFor({ timeout: 10_000 }).then(
          () => true,
          () => false,
        )
      )
        await consent.click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
          'filled',
        null,
        { timeout: 180_000 },
      );
      const download = page.waitForEvent('download');
      await second.getByRole('button', { name: 'Save image', exact: true }).click(); // setup
      await (await download).saveAs(saved);
      await context.close();
    } finally {
      await full.stop();
    }
    const site = await startControl({
      runtime: refused,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
        });
        await context.addInitScript(INSTALL_HOOK);
        const page = await context.newPage();
        const errors: string[] = [];
        const modelRequests: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (/^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(path))
            modelRequests.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside);
        const shot = (caseName: string) =>
          page.screenshot({
            path: join(results, `${name}-refused-${caseName}.png`),
            fullPage: true,
          });
        try {
          await page.goto(ORIGIN);
          const tiles = page.locator('section.next-face');
          await tiles.nth(1).waitFor();
          await page.waitForFunction(() => {
            const downloads = (
              window as unknown as {
                __elmish: { model: { Downloads: { known: boolean; photoAvailable: boolean } } };
              }
            ).__elmish.model.Downloads;
            return downloads.known && !downloads.photoAvailable;
          });
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
              await operate(control);
          // Every photo entry: each face's menu and an empty card.
          await operate(page.getByRole('button', { name: 'Add face', exact: true }));
          await tiles.nth(2).waitFor();
          const empty = tiles.nth(2).locator('.next-face-image .next-face-empty');
          assert.equal((await empty.innerText()).trim(), 'Open saved image');
          assert.equal(await empty.getAttribute('aria-label'), 'Open saved image');
          for (let index = 0; index < 3; index += 1) {
            await operate(tiles.nth(index).getByRole('button', { name: 'Change mode' }));
            assert.equal(
              await page.getByRole('menuitem', { name: 'Open saved image', exact: true }).count(),
              1,
            );
            assert.equal(await page.getByRole('menuitem', { name: 'Encode image' }).count(), 0);
            await page.keyboard.press('Escape');
            await page.getByRole('menu').waitFor({ state: 'hidden' });
          }
          assert.equal(
            await page.getByText('Encode image', { exact: true }).filter({ visible: true }).count(),
            0,
            'no visible Encode image entry anywhere',
          );
          await shot('entries');
          // The saved image opens through the empty card's chooser and installs without any model.
          const before = modelRequests.length;
          const chooser = page.waitForEvent('filechooser');
          await operate(empty);
          await (await chooser).setFiles(saved);
          await page.waitForFunction(
            () =>
              document.querySelectorAll('section.next-face')[2]?.getAttribute('data-next-state') ===
              'project',
          );
          await page.locator('section.next-face').nth(2).locator('.next-face-img').waitFor();
          assert.equal(
            await page.getByRole('dialog').count(),
            0,
            'a recovered still opens no crop',
          );
          assert.deepEqual(modelRequests.slice(before), [], 'recovery fetches no model');
          await shot('opened');
          const download = page.waitForEvent('download');
          await operate(tiles.nth(2).getByRole('button', { name: 'Save image', exact: true }));
          const file = await download;
          const out = join(
            results,
            `${name}-refused-saved.${file.suggestedFilename().split('.').at(-1)}`,
          );
          await file.saveAs(out);
          assert.ok(readFileSync(out).length > 10_000, 'the reopened face saves a real image file');
          assert.deepEqual(errors, []);
        } catch (error) {
          await shot('failure').catch(() => {});
          throw error;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
      rmSync(refused, { recursive: true, force: true });
    }
  },
);
