// Real mounted product and browser I/O. Fixture photos are inputs, never proof of detection/inference.
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Locator } from 'playwright';
import { serve } from '../support/serve.ts';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { bindOrigins } from '../verify/artifact.ts';
import { DEFAULT_HOST_MAP } from '../../../../scripts/ci/intercept/playwright.ts';
import { step, assertNoRequests } from '../../../../scripts/ci/intercept/record.ts';
import { StepLog } from '../verify/operated.ts';

const repo = new URL('../../../../', import.meta.url).pathname;
const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(repo, '.cache/runtime');
const results = join(repo, 'apps/web/test-results/encode');
const geometry = JSON.parse(
  readFileSync(join(repo, 'docs/design/legacy-encode-dialog-geometry.json'), 'utf8'),
).dialogs.confirmation as Record<string, { x: number; y: number; w: number; h: number }>;

test(
  'Encode source and confirmed crop: trusted chooser/paste, geometry, cancellation and focus',
  { timeout: 300_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-fy2.17.1; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const site = await serve(join(repo, 'apps/web/dist'), {
      '/runtime/': runtime,
      '/crop-inputs/': join(repo, 'tests/crop/fixtures'),
    });
    const browser = await chromium.launch({ args: ['--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      for (const width of [1280, 390])
        for (const colorScheme of ['light', 'dark'] as const) {
          const touch = width === 390;
          const context = await browser.newContext({
            viewport: { width, height: 900 },
            colorScheme,
            hasTouch: touch,
            permissions: ['clipboard-read', 'clipboard-write'],
          });
          await context.addInitScript(INSTALL_HOOK);
          const page = await context.newPage();
          const network = new StepLog({
            map: {
              version: DEFAULT_HOST_MAP.version,
              rules: [
                ...[
                  '/runtime/assets/',
                  '/runtime/chunks/',
                  '/runtime/encoder-stream/',
                  '/runtime/photo/',
                ].map((pathPrefix) => ({
                  host: new URL(site.origin).host,
                  pathPrefix,
                  class: 'model-host' as const,
                })),
                ...bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }).rules,
              ],
            },
          }).attach(page);
          step(network.rec, 'encode');
          const noModels = () =>
            assert.equal(assertNoRequests(network.rec, 'model-host', {}, () => {}).verdict, 'pass');
          await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
          try {
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            const hit = async (control: Locator) => {
              const landed = await press(page, control, { touch });
              if (!landed.inside)
                await page.screenshot({ path: join(results, `${width}-${colorScheme}-miss.png`) });
              assert.ok(landed.inside, `${control}: ${JSON.stringify(landed)}`);
            };
            const shot = (name: string) =>
              page.screenshot({ path: join(results, `${width}-${colorScheme}-${name}.png`) });
            const dialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
            const tiles = page.locator('[data-next-face]');
            const open = async (index = 0) => {
              const tile = tiles.nth(index);
              const id = await tile.getAttribute('data-next-face');
              await hit(tile.getByRole('button', { name: 'Change mode', exact: true }));
              const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
              await entry.evaluate(async (el) => {
                const panel = el.closest('.MuiPaper-root');
                await Promise.allSettled(
                  (panel?.getAnimations({ subtree: true }) ?? []).map(
                    (animation) => animation.finished,
                  ),
                );
              });
              await hit(entry);
              await dialog.waitFor();
              assert.equal(await page.getByRole('dialog').count(), 1);
              assert.equal(await page.locator('.next-model-toast').count(), 0);
              assert.equal(
                await page.evaluate(() => {
                  const model = (
                    window as unknown as { __elmish: { model: { Encode: { faceId: string } } } }
                  ).__elmish.model;
                  return model.Encode.faceId;
                }),
                id,
              );
              return tile.getByRole('button', { name: 'Change mode', exact: true });
            };
            await page.goto(`${site.origin}/?testing`);
            await tiles.first().waitFor();
            await page.getByRole('button', { name: 'Remove Morph to', exact: true }).click(); // setup
            const before = await tiles.first().getByRole('textbox').inputValue();
            for (const exit of ['cancel', 'escape', 'back', 'backdrop']) {
              const burger = await open();
              await shot(`source-${exit}`);
              const chooserEvent = page.waitForEvent('filechooser');
              await hit(dialog.getByRole('button', { name: 'Choose image', exact: true }));
              await (await chooserEvent).setFiles([]);
              await dialog.waitFor();
              const choose = dialog.getByRole('button', { name: 'Choose image', exact: true });
              await choose.focus();
              await page.keyboard.press('Shift+Tab');
              assert.ok(
                await dialog
                  .getByRole('button', { name: 'CANCEL', exact: true })
                  .evaluate((el) => el === document.activeElement),
              );
              await page.keyboard.press('Tab');
              assert.ok(await choose.evaluate((el) => el === document.activeElement));
              await page.keyboard.press('Tab');
              assert.ok(
                await dialog
                  .getByRole('textbox', { name: 'Or paste image here' })
                  .evaluate((el) => el === document.activeElement),
              );
              await page.keyboard.press('Tab');
              assert.ok(
                await dialog
                  .getByRole('button', { name: 'CANCEL', exact: true })
                  .evaluate((el) => el === document.activeElement),
              );
              assert.equal(
                await page
                  .locator('header')
                  .first()
                  .evaluate((el) => el.hasAttribute('inert') || !!el.closest('[inert]')),
                true,
              );
              if (exit === 'cancel')
                await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
              else if (exit === 'escape') await page.keyboard.press('Escape');
              else if (exit === 'back') await page.goBack();
              else await page.mouse.click(2, 2);
              await dialog.waitFor({ state: 'detached' });
              assert.ok(await burger.evaluate((el) => el === document.activeElement));
              assert.equal(await tiles.first().getByRole('textbox').inputValue(), before);
              noModels();
            }

            await open();
            const chooserModal = await dialog.elementHandle();
            for (const name of ['malformed.jpg', 'non-square.jpg']) {
              const fileChooser = page.waitForEvent('filechooser');
              await hit(dialog.getByRole('button', { name: 'Choose image', exact: true }));
              await (await fileChooser).setFiles(join(repo, 'tests/crop/fixtures', name));
              if (name === 'malformed.jpg') {
                await page.waitForFunction(() => {
                  const state = (
                    window as unknown as {
                      __elmish: {
                        model: { Encode: { error: string | null }; PreparingFaces: Set<string> };
                      };
                    }
                  ).__elmish.model;
                  return !!state.Encode?.error && state.PreparingFaces.size === 0;
                });
                assert.ok(await dialog.getByRole('status').textContent());
                assert.equal(await dialog.locator('.next-encode-preview').count(), 0);
                assert.equal(await tiles.first().getByRole('textbox').inputValue(), before);
                await shot('malformed-source');
              } else {
                await dialog.locator('.next-encode-preview img').waitFor();
                assert.ok(await chooserModal!.evaluate((el) => el.isConnected));
                await shot('chooser-confirmation');
              }
            }
            await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            noModels();
            await open();
            const paste = dialog.getByRole('textbox', { name: 'Or paste image here' });
            for (const text of ['not an image', 'x'.repeat(100_000), '']) {
              await page.evaluate((value) => navigator.clipboard.writeText(value), text);
              await hit(paste);
              await page.keyboard.press('ControlOrMeta+V');
              await dialog.getByRole('status').waitFor();
              assert.equal(await tiles.first().getByRole('textbox').inputValue(), before);
              assert.equal(await dialog.locator('.next-encode-preview').count(), 0);
            }
            // A real PNG on the system clipboard, prepared from a real JPEG input by the browser.
            await page.evaluate(async () => {
              const source = await createImageBitmap(
                await (await fetch('/crop-inputs/non-square.jpg')).blob(),
              );
              const canvas = document.createElement('canvas');
              canvas.width = source.width;
              canvas.height = source.height;
              canvas.getContext('2d')!.drawImage(source, 0, 0);
              source.close();
              const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (value) => (value ? resolve(value) : reject(Error('PNG encode failed'))),
                  'image/png',
                ),
              );
              await navigator.clipboard.write([
                new ClipboardItem({
                  'image/png': blob,
                  'text/plain': new Blob(['image wins'], { type: 'text/plain' }),
                }),
              ]);
            });
            const sameElement = await dialog.elementHandle();
            await hit(paste);
            await page.keyboard.press('ControlOrMeta+V');
            await dialog.locator('.next-encode-preview img').waitFor();
            assert.ok(await sameElement!.evaluate((el) => el.isConnected));
            assert.equal(await tiles.count(), 1);
            assert.equal(await tiles.first().getByRole('textbox').inputValue(), before);
            await shot('confirmation');
            const bounds = await dialog.locator('.next-encode-panel').boundingBox();
            const preview = await dialog.locator('.next-encode-preview').boundingBox();
            assert.ok(bounds && preview);
            for (const [selector, key] of [
              ['.next-encode-header h2', 'title'],
              ['.next-encode-header svg', 'logo'],
              ['.next-encode-preview', 'preview'],
              ['.next-encode-cancel', 'cancel'],
              ['.next-encode-ok', 'ok'],
            ]) {
              const box = await dialog.locator(selector!).boundingBox();
              assert.ok(box);
              const expected = geometry[key!]!;
              const actual: { x: number; y: number; w: number; h: number } = {
                x: (box.x - bounds.x) / bounds.width,
                y: (box.y - bounds.y) / bounds.width,
                w: box.width / bounds.width,
                h: box.height / bounds.width,
              };
              for (const axis of ['x', 'y', 'w', 'h'] as const)
                assert.ok(
                  Math.abs(actual[axis] - expected[axis]) <= 0.04,
                  `${width}/${colorScheme} ${key}.${axis}: ${actual[axis]} vs ${expected[axis]}`,
                );
            }
            assert.ok(Math.abs(preview.width - preview.height) <= 1);
            assert.ok(Math.abs((preview.x - bounds.x) / bounds.width - 0.0968) <= 0.04);
            assert.ok(Math.abs((preview.y - bounds.y) / bounds.width - 0.2258) <= 0.04);
            assert.equal(
              await dialog
                .locator('.next-encode-panel')
                .evaluate((el) => getComputedStyle(el).backgroundColor),
              'rgb(53, 53, 53)',
            );
            assert.equal(
              await dialog
                .locator('.next-encode-ok')
                .evaluate((el) => getComputedStyle(el).backgroundColor),
              'rgb(63, 81, 181)',
            );
            await hit(dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }));
            await dialog.getByRole('application', { name: 'Crop area' }).waitFor();
            const offset = () =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      __elmish: { model: { Crop: { view: { offsetX: number } } } };
                    }
                  ).__elmish.model.Crop.view.offsetX,
              );
            const previousOffset = await offset();
            await page.keyboard.press('ArrowLeft');
            await hit(dialog.getByRole('button', { name: 'Use Crop', exact: true }));
            await dialog.getByRole('button', { name: 'OK', exact: true }).waitFor();
            assert.notEqual(await offset(), previousOffset, 'Use Crop retains the edited proposal');
            assert.ok(await sameElement!.evaluate((el) => el.isConnected));
            for (const viewport of [
              { width: 320, height: 900 },
              { width: 390, height: 568 },
            ]) {
              await page.setViewportSize(viewport);
              const box = await dialog.locator('.next-encode-preview').boundingBox();
              assert.ok(
                box &&
                  box.x >= 0 &&
                  box.y >= 0 &&
                  box.x + box.width <= viewport.width &&
                  box.y + box.height <= viewport.height,
              );
              await shot(`corners-${viewport.width}x${viewport.height}`);
            }
            await page.setViewportSize({ width, height: 900 });
            await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            noModels();

            // Editor cancellation restores the exact proposal; the next Back must still
            // belong to confirmation after the editor consumed the history entry.
            for (const exit of ['escape', 'back', 'backdrop']) {
              const burger = await open();
              await hit(dialog.getByRole('textbox', { name: 'Or paste image here' }));
              await page.keyboard.press('ControlOrMeta+V');
              await dialog.locator('.next-encode-preview img').waitFor();
              const proposal = () =>
                page.evaluate(() =>
                  JSON.stringify(
                    (window as unknown as { __elmish: { model: { Crop: { view: unknown } } } })
                      .__elmish.model.Crop.view,
                  ),
                );
              const prior = await proposal();
              await hit(dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }));
              await dialog.getByRole('application', { name: 'Crop area' }).waitFor();
              await page.keyboard.press('ArrowLeft');
              await shot(`editor-${exit}`);
              if (exit === 'escape') await page.keyboard.press('Escape');
              else if (exit === 'back') await page.goBack();
              else await page.mouse.click(2, 2);
              await dialog.getByRole('button', { name: 'OK', exact: true }).waitFor();
              assert.equal(
                await proposal(),
                prior,
                'editor cancellation restores the exact prior proposal',
              );
              await page.goBack();
              await dialog.waitFor({ state: 'detached' });
              assert.ok(await burger.evaluate((el) => el === document.activeElement));
              assert.equal(await tiles.first().getByRole('textbox').inputValue(), before);
              noModels();
            }

            // Main-field paste (fm-25um), trusted Ctrl+V of the real system clipboard: the PNG with
            // coincident text still on it opens the same confirmation for this face, and the image wins
            // over the text; text alone is ordinary typing with no dialog.
            const field = tiles.first().getByRole('textbox');
            await hit(field);
            await page.keyboard.press('ControlOrMeta+V');
            await dialog.locator('.next-encode-preview img').waitFor();
            assert.equal(
              await page.evaluate(
                () =>
                  // The same photo dispatch as the chooser: crop confirmation owned by this face.
                  (window as unknown as { __elmish: { model: { Crop: { faceId: string } } } })
                    .__elmish.model.Crop.faceId,
              ),
              await tiles.first().getAttribute('data-next-face'),
            );
            assert.equal(await field.inputValue(), before, 'image wins: no text was inserted');
            await shot('main-field-paste-image');
            await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await field.inputValue(), before);
            await page.evaluate(() => navigator.clipboard.writeText(' pasted words'));
            await hit(field);
            await page.keyboard.press('End');
            await page.keyboard.press('ControlOrMeta+V');
            assert.equal(await field.inputValue(), `${before} pasted words`);
            assert.equal(await page.getByRole('dialog').count(), 0);
            await shot('main-field-paste-text');
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.insertText(before);
            assert.equal(await field.inputValue(), before);
            noModels();

            // Drop (fm-25um): a synthetic DataTransfer carrying a real JPEG, dispatched at a visible
            // point to whatever element is there. A tile binds itself; the background takes the first
            // empty face, else appends one.
            const dropAt = async (target: Locator) => {
              await target.scrollIntoViewIfNeeded();
              const box = await target.boundingBox();
              assert.ok(box);
              return page.evaluate(
                async ([x, y]: readonly [number, number]) => {
                  const bytes = await (await fetch('/crop-inputs/non-square.jpg')).blob();
                  const data = new DataTransfer();
                  data.items.add(new File([bytes], 'dropped.jpg', { type: 'image/jpeg' }));
                  const at = document.elementFromPoint(x, y)!;
                  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y };
                  at.dispatchEvent(new DragEvent('dragover', { ...init, dataTransfer: data }));
                  at.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: data }));
                  return at.closest('[data-next-face]')?.getAttribute('data-next-face') ?? null;
                },
                [box.x + box.width / 2, box.y + box.height / 2] as const,
              );
            };
            const cropOwner = async () => {
              await dialog.locator('.next-encode-preview img').waitFor();
              return page.evaluate(
                () =>
                  (window as unknown as { __elmish: { model: { Crop: { faceId: string } } } })
                    .__elmish.model.Crop.faceId,
              );
            };
            const dismiss = async (name: string) => {
              await shot(name);
              await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
              await dialog.waitFor({ state: 'detached' });
            };
            const firstId = await tiles.first().getAttribute('data-next-face');
            assert.equal(await dropAt(tiles.first().locator('.next-face-image')), firstId);
            assert.equal(await cropOwner(), firstId);
            assert.equal(await tiles.count(), 1);
            await dismiss('drop-on-tile');
            // Every face has words: a background drop appends one face and binds it.
            const background = page.getByRole('heading', { name: 'What is this?' });
            assert.equal(await dropAt(background), null);
            const appended = await cropOwner();
            assert.equal(await tiles.count(), 2);
            assert.equal(appended, await tiles.nth(1).getAttribute('data-next-face'));
            assert.equal(await field.inputValue(), before);
            await dismiss('drop-on-background-append');
            // That face is still empty, so the next background drop takes it instead of appending.
            assert.equal(await dropAt(background), null);
            assert.equal(await cropOwner(), appended);
            assert.equal(await tiles.count(), 2);
            await dismiss('drop-on-background-empty');
            await hit(tiles.nth(1).getByRole('button', { name: /^Remove/ }));
            await tiles.nth(1).waitFor({ state: 'detached' });
            noModels();

            // Source ownership at 2 of 3 and 64 of 64. By-name additions only arrange the input state.
            while ((await tiles.count()) < 3)
              await page.locator('.next-connector-add').last().click();
            await open(1);
            await shot('source-2-of-3');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            while ((await tiles.count()) < 64)
              await page.locator('.next-connector-add').last().click();
            await open(63);
            await shot('source-64-of-64');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await tiles.count(), 64);
            noModels();
            assert.deepEqual(errors, []);
            await network.settled();
            writeFileSync(
              join(results, `${width}-${colorScheme}-network.json`),
              JSON.stringify(network.rec),
            );
            await context.tracing.stop();
          } catch (error) {
            await page.screenshot({ path: join(results, `${width}-${colorScheme}-failure.png`) });
            await context.tracing.stop({
              path: join(results, `${width}-${colorScheme}-failure.zip`),
            });
            throw error;
          } finally {
            await context.close();
          }
        }
    } finally {
      await browser.close();
      await site.close();
    }
  },
);
