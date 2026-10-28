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
import { assertNoCardPreparation } from '../support/card-setup.ts';

const repo = new URL('../../../../', import.meta.url).pathname;
const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(repo, '.cache/runtime');
const results = join(repo, 'apps/web/test-results/encode');
const geometry = JSON.parse(
  readFileSync(join(repo, 'docs/design/legacy-encode-dialog-geometry.json'), 'utf8'),
).dialogs.confirmation as Record<string, { x: number; y: number; w: number; h: number }>;

test(
  'Card photo entry and confirmed crop: trusted chooser/paste, geometry, cancellation and focus',
  // Several real CPU encodes in one journey: 252 s on a quiet eris, past 300 s under load (main run 40290030872).
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-fy2.17.1; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    // The built artifact: deploy-next/ under FACEMORPH_DEPLOY_OUT, else this build's dist/.
    const built = process.env['FACEMORPH_DEPLOY_OUT'];
    const site = await serve(built ? join(built, 'deploy-next') : join(repo, 'apps/web/dist'), {
      '/runtime/': runtime,
      '/crop-inputs/': join(repo, 'tests/crop/fixtures'),
    });
    const browser = await chromium.launch({ args: ['--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      // A real recovery-bearing WebP from this runtime: a seed face generated on the CPU and saved,
      // in its own context so its model requests stay outside the cells' recordings.
      const saved = join(results, 'recovery-source.webp');
      {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        await page.goto(`${site.origin}/?testing`);
        const second = page.locator('[data-next-face]').nth(1);
        await second.waitFor();
        await page.getByRole('button', { name: 'More options' }).click(); // setup
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
            document.querySelectorAll('[data-next-face]')[1]?.getAttribute('data-next-state') ===
            'filled',
          null,
          { timeout: 180_000 },
        );
        const download = page.waitForEvent('download');
        await second.getByRole('button', { name: 'Save image', exact: true }).click(); // setup
        await (await download).saveAs(saved);
        await context.close();
      }
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
            // Encode image opens the face card's own file chooser: there is no empty source modal.
            const choose = async (files: string[], index = 0) => {
              const tile = tiles.nth(index);
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
              const chooser = page.waitForEvent('filechooser');
              await hit(entry);
              const event = await chooser;
              assert.equal(await page.getByRole('dialog').count(), 0, 'no source modal');
              assert.equal(
                await event
                  .element()
                  .evaluate((el) =>
                    (el as Element).closest('[data-next-face]')?.getAttribute('data-next-face'),
                  ),
                await tile.getAttribute('data-next-face'),
                'the chooser belongs to this card',
              );
              await event.setFiles(files);
              return tile.getByRole('button', { name: 'Change mode', exact: true });
            };
            const fixture = (name: string) => join(repo, 'tests/crop/fixtures', name);
            const cropOwner = async () => {
              await dialog.locator('.next-encode-preview img').waitFor();
              return page.evaluate(
                () =>
                  (window as unknown as { __elmish: { model: { Crop: { faceId: string } } } })
                    .__elmish.model.Crop.faceId,
              );
            };
            await page.goto(`${site.origin}/?testing`);
            await tiles.first().waitFor();
            await page.getByRole('button', { name: 'Remove Morph to', exact: true }).click(); // setup
            const toast = page
              .locator('.next-model-toast')
              .getByRole('button', { name: 'Not now' });
            if (
              await toast.waitFor({ timeout: 5000 }).then(
                () => true,
                () => false,
              )
            )
              await toast.click(); // setup: the download offer is not under test here
            const field = tiles.first().getByRole('textbox');
            const before = await field.inputValue();

            // A cancelled chooser, from the menu or from an empty card, changes nothing.
            await choose([]);
            await page.waitForTimeout(300);
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(await field.inputValue(), before);
            assert.ok(
              await tiles.first().evaluate((el) => el.contains(document.activeElement)),
              `focus stays on the invoking card: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`,
            );
            await page.locator('.next-connector-add').last().click(); // setup: one empty face
            const card = tiles.nth(1).locator('.next-face-image').getByRole('button', {
              name: 'Encode image',
              exact: true,
            });
            const cardChooser = page.waitForEvent('filechooser');
            await hit(card);
            await assertNoCardPreparation(page, 'cold: no model, detector or encoder cached');
            await shot('card-entry');
            const cardEvent = await cardChooser;
            assert.equal(
              await cardEvent
                .element()
                .evaluate((el) =>
                  (el as Element).closest('[data-next-face]')?.getAttribute('data-next-face'),
                ),
              await tiles.nth(1).getAttribute('data-next-face'),
              'the empty card opens its own chooser',
            );
            await cardEvent.setFiles([]);
            await page.waitForTimeout(300);
            assert.equal(await page.getByRole('dialog').count(), 0);
            await hit(tiles.nth(1).getByRole('button', { name: /^Remove/ }));
            await tiles.nth(1).waitFor({ state: 'detached' });
            noModels();

            // An unreadable file reports one message in the error area and opens no crop.
            await choose([fixture('malformed.jpg')]);
            const failure = page.locator('.next-error > p').first();
            await failure.waitFor();
            assert.ok((await failure.textContent())?.trim());
            assert.equal(await dialog.count(), 0);
            assert.equal(await field.inputValue(), before);
            await shot('malformed-source');
            await hit(page.locator('.next-error').getByRole('button', { name: 'Dismiss' }));

            // A fresh photo goes straight to confirmation. Every exit abandons it, returns focus to
            // the burger and changes no face; Tab stays inside the one modal.
            const firstId = await tiles.first().getAttribute('data-next-face');
            for (const exit of ['cancel', 'escape', 'back', 'backdrop']) {
              const burger = await choose([fixture('non-square.jpg')]);
              assert.equal(await cropOwner(), firstId);
              assert.equal(await page.getByRole('dialog').count(), 1);
              await shot(`confirmation-${exit}`);
              // Tab order is the visual order (rows top to bottom, then left to right) and wraps
              // inside the modal: two full cycles visit exactly that sequence.
              const visual = await dialog.evaluate((root) =>
                [
                  ...root.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),a[href],input:not([type=hidden]),[tabindex]:not([tabindex="-1"])',
                  ),
                ]
                  .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0)
                  .map((el) => {
                    const r = el.getBoundingClientRect();
                    return {
                      top: r.top,
                      left: r.left,
                      key: el.getAttribute('aria-label') || el.textContent!.trim(),
                    };
                  })
                  .sort((a, b) => (Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left))
                  .map((item) => item.key),
              );
              assert.ok(visual.length >= 3, `focusable controls: ${visual.join(' | ')}`);
              const visited: string[] = [];
              for (let step = 0; step < visual.length * 2; step += 1) {
                await page.keyboard.press('Tab');
                assert.ok(
                  await dialog.evaluate((el) => el.contains(document.activeElement)),
                  'Tab never leaves the modal',
                );
                visited.push(
                  await page.evaluate(() => {
                    const el = document.activeElement as HTMLElement;
                    return el.getAttribute('aria-label') || el.textContent!.trim();
                  }),
                );
              }
              const start = visual.indexOf(visited[0]!);
              assert.ok(start >= 0, `focus began on a listed control: ${visited[0]}`);
              assert.deepEqual(
                visited,
                [...visual, ...visual, ...visual].slice(start, start + visual.length * 2),
                'Tab follows visual order',
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
              assert.equal(await field.inputValue(), before);
              assert.equal(await tiles.count(), 1, 'no new keypoint');
              noModels();
            }

            // A real PNG on the system clipboard, prepared from a real JPEG input by the browser,
            // with coincident text: pasted into the card's field, the image wins.
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
            await hit(field);
            await page.keyboard.press('ControlOrMeta+V');
            assert.equal(await cropOwner(), firstId);
            const sameElement = await dialog.elementHandle();
            assert.equal(await tiles.count(), 1);
            assert.equal(await field.inputValue(), before);
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
            assert.equal(
              await dialog
                .locator('.next-encode-cancel')
                .evaluate((el) => getComputedStyle(el).backgroundColor),
              'rgb(224, 224, 224)',
            );
            // WCAG contrast of every text element against its painted background.
            const contrast = await dialog.evaluate((root) => {
              const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
              const luminance = ([r, g, b]: number[]) =>
                [r!, g!, b!]
                  .map((c) => c / 255)
                  .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
                  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
              const background = (el: Element | null): number[] => {
                for (; el; el = el.parentElement) {
                  const c = rgb(getComputedStyle(el).backgroundColor);
                  if (c.length < 4 || c[3]! > 0) return c;
                }
                return [255, 255, 255];
              };
              return Object.fromEntries(
                [
                  '.next-encode-header h2',
                  '.next-encode-adjust',
                  '.next-encode-explanation',
                  '.next-encode-cancel',
                  '.next-encode-ok',
                ].map((selector) => {
                  const el = root.querySelector(selector)!;
                  const [a, b] = [
                    luminance(rgb(getComputedStyle(el).color)),
                    luminance(background(el)),
                  ];
                  return [selector, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)];
                }),
              );
            });
            for (const [selector, ratio] of Object.entries(contrast))
              assert.ok(
                ratio >= 4.5,
                `${width}/${colorScheme} ${selector} contrast ${ratio.toFixed(2)}`,
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
              const burger = tiles
                .first()
                .getByRole('button', { name: 'Change mode', exact: true });
              await hit(field);
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

            // Detector and encoder assets absent (this profile has downloaded nothing) and the consent
            // declined: ADJUST CROP still reaches OK, and choosing, adjusting, OK and declining make no
            // network request of any kind.
            {
              const network: string[] = [];
              const record = (request: { url(): string }) => {
                if (/^https?:/.test(request.url())) network.push(request.url());
              };
              await choose([fixture('non-square.jpg')]);
              await cropOwner();
              page.on('request', record);
              await hit(dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }));
              await dialog.getByRole('application', { name: 'Crop area' }).waitFor();
              await page.keyboard.press('ArrowLeft');
              await hit(dialog.getByRole('button', { name: 'Use Crop', exact: true }));
              const ok = dialog.getByRole('button', { name: 'OK', exact: true });
              await ok.waitFor();
              assert.equal(await ok.isEnabled(), true, 'the manual crop reaches an enabled OK');
              await hit(ok);
              const gate = page.locator('.next-download-dialog');
              const asked = await gate.waitFor({ timeout: 10_000 }).then(
                () => true,
                () => false,
              );
              await shot('assets-absent-consent');
              await assertNoCardPreparation(page, 'cold: encoder and detector absent at consent');
              if (asked) {
                await hit(gate.getByRole('button', { name: 'Cancel', exact: true }));
                await gate.waitFor({ state: 'detached' });
              }
              await page.waitForTimeout(1000);
              page.off('request', record);
              assert.ok(asked, 'with the encoder absent, OK asks for the download first');
              assert.deepEqual(network, [], 'no network request before or after declining');
              // OK committed the confirmed crop to the tile; nothing was encoded or queued.
              assert.equal(await field.inputValue(), 'cropped.png');
              assert.notEqual(await tiles.first().getAttribute('data-next-state'), 'filled');
              await page.waitForFunction(
                () => !document.querySelector('.next-product[data-next-busy=true]'),
              );
              noModels();
              // Back to words for the cases that follow.
              await hit(tiles.first().getByRole('button', { name: 'Change mode', exact: true }));
              await hit(page.getByRole('menuitem', { name: 'Name or words', exact: true }));
              await hit(field);
              await page.keyboard.insertText(before);
              assert.equal(await field.inputValue(), before);
            }

            // Main-field paste (fm-25um), trusted Ctrl+V of the real system clipboard: the PNG with
            // coincident text still on it opens the same confirmation for this face, and the image wins
            // over the text; text alone is ordinary typing with no dialog.
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

            // Clipboard content no browser lets a test put on the system clipboard (two images, a non-PNG
            // image, a WebP file): a paste event carrying a real DataTransfer of real files, dispatched to
            // the element at the field's visible centre. The same message, the text untouched, no model;
            // the app's own saved WebP restores its face with no model and no dialog.
            const pasteFiles = async (files: { name: string; type: string; base64: string }[]) => {
              await field.scrollIntoViewIfNeeded();
              const box = await field.boundingBox();
              assert.ok(box);
              return page.evaluate(
                ([x, y, list]) => {
                  const data = new DataTransfer();
                  for (const f of list as { name: string; type: string; base64: string }[])
                    data.items.add(
                      new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, {
                        type: f.type,
                      }),
                    );
                  const at = document.elementFromPoint(x as number, y as number)!;
                  at.dispatchEvent(
                    new ClipboardEvent('paste', {
                      clipboardData: data,
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                  return at.tagName;
                },
                [box.x + box.width / 2, box.y + box.height / 2, files] as const,
              );
            };
            const png = readFileSync(
              join(repo, 'apps/web/test/fixtures/verify/stills/recovery-v2.png'),
            ).toString('base64');
            const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            const refusal = 'Paste one PNG, JPEG or WebP image. Your text is unchanged.';
            for (const [caseName, files] of [
              [
                'two-images',
                [
                  { name: 'a.png', type: 'image/png', base64: png },
                  { name: 'b.png', type: 'image/png', base64: png },
                ],
              ],
              ['unsupported-gif', [{ name: 'a.gif', type: 'image/gif', base64: gif }]],
            ] as const) {
              assert.equal(await pasteFiles([...files]), 'INPUT');
              await page.locator('.next-error > p').first().waitFor();
              assert.equal(
                (await page.locator('.next-error > p').first().innerText()).trim(),
                refusal,
                caseName,
              );
              assert.equal(
                await page.locator('.next-model-toast, .MuiSnackbar-root').count(),
                0,
                `${caseName}: one message, no toast`,
              );
              assert.equal(await field.inputValue(), before, `${caseName}: text unchanged`);
              assert.equal(await page.getByRole('dialog').count(), 0);
              await shot(`main-field-paste-${caseName}`);
              await hit(page.locator('.next-error').getByRole('button', { name: 'Dismiss' }));
              noModels();
            }
            assert.equal(
              await pasteFiles([
                {
                  name: 'saved.webp',
                  type: 'image/webp',
                  base64: readFileSync(saved).toString('base64'),
                },
              ]),
              'INPUT',
            );
            await page.waitForFunction(
              () =>
                document.querySelector('[data-next-face]')?.getAttribute('data-next-state') ===
                'project',
            );
            assert.equal(
              await page.getByRole('dialog').count(),
              0,
              'a recovery-bearing WebP opens no dialog',
            );
            await shot('main-field-paste-recovered-webp');
            noModels();
            // Back to words for the cases that follow.
            await hit(tiles.first().getByRole('button', { name: 'Change mode', exact: true }));
            await hit(page.getByRole('menuitem', { name: 'Name or words', exact: true }));
            await hit(field);
            await page.keyboard.insertText(before);
            assert.equal(await field.inputValue(), before);

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
            const dismiss = async (name: string) => {
              await shot(name);
              await hit(dialog.getByRole('button', { name: 'CANCEL', exact: true }));
              await dialog.waitFor({ state: 'detached' });
            };
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

            // A recovery-bearing WebP chosen from the card installs the saved face with no model and
            // no crop or source dialog.
            await choose([saved]);
            await page.waitForFunction(
              () =>
                document.querySelector('[data-next-face]')?.getAttribute('data-next-state') ===
                'project',
            );
            await tiles.first().locator('.next-face-img').waitFor();
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(await tiles.count(), 1);
            await shot('recovered-webp');
            noModels();

            // Source ownership at 2 of 3 and 64 of 64. By-name additions only arrange the input state.
            while ((await tiles.count()) < 3)
              await page.locator('.next-connector-add').last().click();
            await choose([fixture('non-square.jpg')], 1);
            assert.equal(await cropOwner(), await tiles.nth(1).getAttribute('data-next-face'));
            await shot('source-2-of-3');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            while ((await tiles.count()) < 64)
              await page.locator('.next-connector-add').last().click();
            await choose([fixture('non-square.jpg')], 63);
            assert.equal(await cropOwner(), await tiles.nth(63).getAttribute('data-next-face'));
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
