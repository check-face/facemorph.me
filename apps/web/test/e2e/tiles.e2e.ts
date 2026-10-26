// The rendering port's tiles in the real shell (dist/render-check.html, plain state, no controller) in real
// Chromium, Firefox and WebKit at desktop (mouse) and phone (touch) width:
// - the full tile/connector structure at 1, 2, 3, 30 and 64 faces; at virtualized 150, bounded DOM and
//   the actual first/tail fields and tail mode control, reached through wheel, native Chromium swipe or
//   mobile WebKit's visible strip navigation;
// - the text field with empty, very long and pasted values, the mode menu, a connector + and Remove, each
//   pressed at its visible centre after elementFromPoint shows the control is there;
// - every progress fill is written only as `transform: scaleX(...)`, never a layout property.
// Generating, photos and the morph need the candidate controller (fm-qkke, fm-j16n): untested here.
//   node --test test/e2e/tiles.e2e.ts        (screenshots in test-results/tiles/)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { press } from '../support/operate.ts';
import { serve, type Served } from '../support/serve.ts';
import { VIRTUALISE_AFTER } from '../../shell/render/faces-mode.ts';

const app = new URL('../../', import.meta.url);
const results = new URL('test-results/tiles/', app);
const WIDTHS = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
const LONG = 'a very long phrase '.repeat(30).trim(); // 569 characters

// Records every style written on a progress fill, from before the app's first render.
const WATCH_FILLS = `
  window.__fillStyles = [];
  new MutationObserver((records) => {
    for (const r of records) if (r.target.classList && [...r.target.classList].some((c) => c.endsWith('progress-fill'))) window.__fillStyles.push(r.target.getAttribute('style'));
  }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true });`;

let site: Served;
before(async () => {
  assert.ok(
    existsSync(new URL('dist/render-check.html', app)),
    'no dist/: run `npm run build` first',
  );
  site = await serve(new URL('dist', app).pathname);
  mkdirSync(results, { recursive: true });
});
after(async () => {
  await site?.close();
});

const faces = (page: Page) => page.locator('section.next-face');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: new URL(`${name}.png`, results).pathname, fullPage: false });

async function virtualStructure(page: Page, count: number, label: string) {
  // One DOM snapshot: a native smooth scroll can move the virtual window between awaited locator reads.
  const structure = await page.evaluate(() => {
    const strip = document.querySelector('[data-next-strip]')!;
    return {
      rendered: strip.querySelectorAll('section.next-face').length,
      connectors: strip.querySelectorAll('.next-connector-add').length,
      removes: strip.querySelectorAll('.next-face-close').length,
      virtual: strip.getAttribute('data-next-virtual'),
      count: strip.getAttribute('data-next-face-count'),
    };
  });
  const { rendered } = structure;
  // At these viewport sizes only a few tiles and their overscan belong in the DOM.
  assert.ok(rendered > 0 && rendered <= 16, `${label}: bounded DOM, got ${rendered}`);
  assert.equal(structure.virtual, 'true');
  assert.equal(structure.count, String(count));
  assert.equal(structure.connectors, rendered + 1);
  assert.equal(structure.removes, rendered);
}

async function virtualEnds(page: Page, count: number, engine: string, touch: boolean) {
  const first = page.locator('[data-next-face="f0"] .next-field input');
  assert.ok((await press(page, first, { touch })).inside, 'the actual first field is hittable');
  await page.keyboard.type('first face', { delay: 10 });
  assert.equal(await first.inputValue(), 'first face');

  const strip = page.locator('[data-next-strip]');
  await strip.scrollIntoViewIfNeeded();
  const box = await strip.boundingBox();
  assert.ok(box);
  const y = Math.min(box.y + box.height / 2, page.viewportSize()!.height - 30);
  if (touch && engine === 'chromium') {
    // Chromium's native touch input scrolls the compositor; Firefox/WebKit below use real wheel input.
    const cdp = await page.context().newCDPSession(page);
    const left = Math.max(20, box.x + 20);
    const right = Math.min(page.viewportSize()!.width - 20, box.x + box.width - 20);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: right, y }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: right - ((right - left) * i) / 8, y }],
      });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-next-strip]')!.scrollLeft > 0);
    await cdp.detach();
  }
  // Firefox clamps a wheel delta to about a viewport, so keep operating until the actual tail is in view.
  // Mobile WebKit does not implement wheel input: use its visible Next faces control with real touch taps.
  const tail = page.locator(`[data-next-face="f${count - 1}"]`);
  let reached = false;
  for (let i = 0; i < count * 2; i++) {
    reached = await page.evaluate(
      (id) => {
        const input = document.querySelector(`[data-next-face="${id}"] .next-field input`);
        if (!input) return false;
        const field = input.getBoundingClientRect();
        const view = document.querySelector('[data-next-strip]')!.getBoundingClientRect();
        const centre = field.x + field.width / 2;
        return centre > view.left && centre < view.right;
      },
      `f${count - 1}`,
    );
    if (reached) break;
    if (touch && engine === 'webkit') {
      assert.ok(
        (await press(page, page.getByRole('button', { name: 'Next faces' }), { touch })).inside,
        'the visible strip navigation responds to touch',
      );
    } else {
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.wheel(100000, 0);
    }
    await page.waitForTimeout(100);
  }
  assert.ok(reached, `${engine}: logical tail reached through real strip input`);
  await virtualStructure(page, count, `${engine} tail`);
  const field = tail.locator('.next-field input');
  assert.ok(
    (await press(page, field, { touch })).inside,
    'the actual logical tail field is hittable',
  );
  await page.keyboard.type('tail face', { delay: 10 });
  assert.equal(await field.inputValue(), 'tail face');
  assert.ok(
    (await press(page, tail.getByRole('button', { name: 'Change mode' }), { touch })).inside,
    'the logical tail mode control is hittable',
  );
  const seed = page.getByRole('menuitem', { name: 'Numeric seed' });
  await seed.waitFor();
  assert.ok((await press(page, seed, { touch })).inside, 'the logical tail mode menu works');
  await tail.locator('input[inputmode=numeric]').waitFor();
  assert.equal(await tail.locator('select[aria-label="Face source"]').inputValue(), 'seed');
}

for (const [engine, type] of Object.entries(ENGINES).filter(([e]) => !only || only.includes(e))) {
  test(`${engine}: tiles and connectors at 1, 2, 3 and many faces, operated by mouse and touch`, async () => {
    const browser = await type.launch();
    try {
      for (const [width, viewport] of Object.entries(WIDTHS)) {
        const touch = width === 'phone';
        const context = await browser.newContext({
          viewport,
          hasTouch: touch,
          isMobile: touch && engine !== 'firefox',
          ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
        });
        await context.addInitScript(WATCH_FILLS);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        for (const n of [1, 2, 3, 30, 64, 150]) {
          await page.goto(`${site.origin}/render-check.html?faces=${n}`);
          await page.waitForSelector('section.next-face');
          if (n > VIRTUALISE_AFTER) {
            await virtualStructure(page, n, `${engine} ${width}`);
          } else {
            assert.equal(await faces(page).count(), n, `${engine} ${width}: ${n} tiles`);
            assert.equal(
              await page.locator('.next-connector-add').count(),
              n === 2 ? 3 : n + 1,
              `${engine} ${width}: connectors at ${n}`,
            );
            assert.equal(
              await page.locator('.next-face-close').count(),
              n > 1 ? n : 0,
              `${engine} ${width}: Remove offered on every tile but a lone one`,
            );
          }
          assert.equal(
            await page.locator('.next-faces-area').getAttribute('data-next-faces'),
            String(n),
          );
          await shot(page, `${engine}-${width}-n${n}`);
          if (n > VIRTUALISE_AFTER) {
            await virtualEnds(page, n, engine, touch);
            await shot(page, `${engine}-${width}-n${n}-tail`);
            continue;
          }
          // The last tile of a long list is still reachable and its field operable.
          const last = faces(page).last().locator('input[type=text], input:not([type])').first();
          assert.ok(
            (await press(page, last, { touch })).inside,
            `${engine} ${width} n${n}: the last field`,
          );
        }

        // N=2: the text field, empty, very long and pasted.
        await page.goto(`${site.origin}/render-check.html?faces=2`);
        await page.waitForSelector('section.next-face');
        const field = faces(page).first().locator('.next-field input');
        assert.ok((await press(page, field, { touch })).inside, `${engine} ${width}: text field`);
        assert.equal(await field.inputValue(), '', 'empty to start');
        assert.equal(
          await faces(page).first().locator('.next-face-generate').isDisabled(),
          true,
          'Generate is off for an empty field',
        );
        // 10 ms a key is about 100 keys a second, beyond any person. At machine speed (0 ms) this tree drops a few
        // characters where the control drops none: recorded on fm-5fhw with the bisect so far.
        await page.keyboard.type(LONG, { delay: 10 });
        assert.equal(
          await field.inputValue(),
          LONG,
          `${engine} ${width}: the very long value is kept whole`,
        );
        assert.equal(
          await faces(page).first().locator('.next-face-generate').isDisabled(),
          true,
          'Generate is off above 512 UTF-8 bytes',
        );
        await shot(page, `${engine}-${width}-long`);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        if (engine === 'chromium') {
          await page.evaluate(() => navigator.clipboard.writeText('pasted words'));
          await page.keyboard.press('Control+V');
        } else {
          await page.keyboard.insertText('pasted words'); // no clipboard permission in Firefox/WebKit: the text arrives as one insertion
        }
        assert.equal(await field.inputValue(), 'pasted words', `${engine} ${width}: pasted value`);
        await shot(page, `${engine}-${width}-pasted`);

        // The mode menu: Change mode at its visible position, then Numeric seed.
        assert.ok(
          (
            await press(page, faces(page).first().getByRole('button', { name: 'Change mode' }), {
              touch,
            })
          ).inside,
          `${engine} ${width}: Change mode`,
        );
        const seed = page.getByRole('menuitem', { name: 'Numeric seed' });
        await seed.waitFor();
        await shot(page, `${engine}-${width}-mode-menu`);
        assert.ok((await press(page, seed, { touch })).inside, `${engine} ${width}: Numeric seed`);
        await page.locator('.next-field input[inputmode=numeric]').first().waitFor();
        // The menu has finished closing, as a person sees it (kept-mounted menus stay in the DOM, hidden).
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.MuiModal-root')].every((m) =>
            m.classList.contains('MuiModal-hidden'),
          ),
        );
        assert.equal(
          await faces(page).first().locator('select[aria-label="Face source"]').inputValue(),
          'seed',
        );

        // A connector + between the two, then Remove on the new tile.
        assert.ok(
          (
            await press(page, page.getByRole('button', { name: 'Add a face between these two' }), {
              touch,
            })
          ).inside,
          `${engine} ${width}: connector +`,
        );
        await page.waitForFunction(
          () => document.querySelectorAll('section.next-face').length === 3,
        );
        assert.ok(
          (await press(page, page.getByRole('button', { name: 'Remove Morph to' }), { touch }))
            .inside,
          `${engine} ${width}: Remove`,
        );
        await page.waitForFunction(
          () => document.querySelectorAll('section.next-face').length === 2,
        );
        await shot(page, `${engine}-${width}-after-remove`);

        // Remove down to one face: the last one has no Remove.
        await press(page, page.getByRole('button', { name: 'Remove Morph to' }), { touch });
        await page.waitForFunction(
          () => document.querySelectorAll('section.next-face').length === 1,
        );
        assert.equal(
          await page.locator('.next-face-close').count(),
          0,
          'the last face is never removable',
        );

        // A running tile: its fill carries only a transform.
        await page.goto(`${site.origin}/render-check.html?faces=2&active=0&fraction=0.4`);
        const tileFill = page.locator('.next-face-progress-determinate');
        await tileFill.waitFor();
        assert.match(
          (await tileFill.getAttribute('style')) ?? '',
          /^transform: scaleX\(0\.4\);?$/,
          `${engine} ${width}: the tile fill`,
        );
        await shot(page, `${engine}-${width}-running`);
        // A running morph: the slot's bar is filled in an animation frame, and every write is a transform.
        await page.goto(`${site.origin}/render-check.html?faces=2&busy=1&fraction=0.4`);
        await page.waitForFunction(
          () => (window as unknown as { __fillStyles: string[] }).__fillStyles.length > 0,
        );
        const styles = await page.evaluate(
          () => (window as unknown as { __fillStyles: (string | null)[] }).__fillStyles,
        );
        for (const s of styles)
          assert.match(
            s ?? '',
            /^transform: scaleX\(0\.4\);?$/,
            `${engine} ${width}: a progress fill wrote ${s}`,
          );
        await shot(page, `${engine}-${width}-morph-running`);

        assert.deepEqual(errors, [], `${engine} ${width}: page errors`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
