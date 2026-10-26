// fm-96if: the Browse names picker in the built application (deploy-next), operated as a person
// would. Typing sends no preview or name-list request; the grid is fullscreen, headerless and
// gapless with readable names over real gallery faces; Back/Escape/history close it once; the
// window of live images stays bounded while arrow keys cross windows; a catalogue answering 500
// shows its error inside a dismissible dialog. With an acquired runtime, a full journey checks
// every outside host against src/controller/outside-requests.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import { press } from '../support/operate.ts';
import { serve, type Served } from '../support/serve.ts';
import { OUTSIDE_REQUESTS, outsideRequest } from '../../src/controller/outside-requests.ts';

const REPO = new URL('../../../../', import.meta.url).pathname;
const SITE = join(REPO, 'deploy-next');
const results = join(REPO, 'apps/web/test-results/names');
const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const chromiumPath = process.env['FACEMORPH_E2E_CHROMIUM'];
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
const skipped = !!only && !only.includes('chromium');
const catalogue = existsSync(join(SITE, 'catalogue.json'))
  ? (JSON.parse(readFileSync(join(SITE, 'catalogue.json'), 'utf8')) as {
      origin: string;
      names: { name: string; value: string }[];
    })
  : null;
const GALLERY = catalogue ? new URL(catalogue.origin).hostname : '';
const NAME_HOST = 'facemorph-name-catalogue.cdilga.workers.dev';
const log = (line: string) => console.log(`# ${line}`);

let site: Served;
let failing: Served;
let browser: Browser;
before(async () => {
  if (skipped) return;
  assert.ok(catalogue, `no built site at ${SITE}: run npm run build:next first`);
  mkdirSync(results, { recursive: true });
  site = await serve(SITE);
  failing = await serve(SITE, {}, { '/catalogue.json': 500 });
  browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--disable-features=WebGPU'],
  });
});
after(async () => {
  await browser?.close();
  await site?.close();
  await failing?.close();
});

async function context(width: number, touch: boolean, height = 900): Promise<BrowserContext> {
  return browser.newContext({
    ...(touch ? devices['Pixel 7'] : {}),
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
  });
}
/** Opens the app and clears the first-visit offers, which are not under test. */
async function openApp(page: Page, origin: string): Promise<void> {
  await page.goto(origin);
  await page.locator('section.next-face').first().waitFor();
  for (const control of [
    page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
    page.getByRole('button', { name: 'Ask me later' }),
  ])
    if (
      await control.waitFor({ timeout: 3000 }).then(
        () => true,
        () => false,
      )
    )
      await control.click(); // setup
}
const tileOf = (page: Page, index: number) => page.locator('section.next-face').nth(index);
const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Browse names' });
async function operate(page: Page, control: Locator, touch: boolean): Promise<void> {
  assert.ok((await press(page, control, { touch })).inside, `${control} press landed outside`);
}
async function openNames(page: Page, touch: boolean, tile = 0): Promise<Locator> {
  await operate(page, tileOf(page, tile).getByRole('button', { name: 'Browse names' }), touch);
  const dialog = dialogOf(page);
  await dialog.waitFor();
  return dialog;
}
async function loadedTiles(dialog: Locator): Promise<void> {
  await dialog.locator('.next-name-choice').first().waitFor();
  await dialog.page().waitForFunction(
    () => {
      const images = [...document.querySelectorAll<HTMLImageElement>('.next-name-choice img')];
      const box = document.querySelector('.next-names-scroller')!.getBoundingClientRect();
      const visible = images.filter((img) => img.getBoundingClientRect().top < box.bottom);
      return visible.length > 0 && visible.every((img) => img.complete && img.naturalWidth > 0);
    },
    null,
    { timeout: 30_000 },
  );
}
/** WCAG relative luminance over a screenshot region: the brightest pixel and the mean. */
async function luminance(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<{ max: number; mean: number }> {
  const png = await page.screenshot({ clip, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const linear = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let max = 0,
      sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l =
        0.2126 * linear(data[i]!) + 0.7152 * linear(data[i + 1]!) + 0.0722 * linear(data[i + 2]!);
      max = Math.max(max, l);
      sum += l;
    }
    return { max, mean: sum / (data.length / 4) };
  }, png.toString('base64'));
}
interface Geometry {
  columns: number;
  scroller: { width: number; height: number; clientWidth: number };
  tiles: { index: number; x: number; y: number; right: number; bottom: number }[];
  images: { x: number; y: number; right: number; bottom: number }[];
  labels: { right: number; bottom: number; tileRight: number; tileBottom: number }[];
}
async function geometry(dialog: Locator): Promise<Geometry> {
  return dialog.evaluate((root) => {
    const scroller = root.querySelector<HTMLElement>('.next-names-scroller')!;
    const grid = root.querySelector<HTMLElement>('.next-name-grid')!;
    const tiles = [...root.querySelectorAll<HTMLElement>('.next-name-choice')];
    const box = (e: Element) => e.getBoundingClientRect();
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      scroller: {
        width: box(scroller).width,
        height: box(scroller).height,
        clientWidth: scroller.clientWidth,
      },
      tiles: tiles.map((t) => ({
        index: Number(t.dataset['nameIndex']),
        x: box(t).x,
        y: box(t).y,
        right: box(t).right,
        bottom: box(t).bottom,
      })),
      images: tiles.map((t) => {
        const b = box(t.querySelector('img')!);
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
      }),
      labels: tiles.map((t) => {
        const b = box(t.querySelector('span')!);
        return {
          right: b.right,
          bottom: b.bottom,
          tileRight: box(t).right,
          tileBottom: box(t).bottom,
        };
      }),
    };
  });
}
/** Columns in a captured reference: the most columns whose every boundary is a strong seam. */
async function referenceColumns(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const gray = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    };
    const seam: number[] = [0];
    for (let x = 1; x < width; x++) {
      let sum = 0;
      for (let y = 0; y < height; y += 2) sum += Math.abs(gray(x, y) - gray(x - 1, y));
      seam.push(sum);
    }
    const median = [...seam].sort((a, b) => a - b)[Math.floor(seam.length / 2)]!;
    let best = 1;
    for (let columns = 2; columns <= 12; columns++) {
      const strong = Array.from({ length: columns - 1 }, (_, k) => {
        const x = Math.round(((k + 1) * width) / columns);
        return Math.max(seam[x - 1] ?? 0, seam[x] ?? 0, seam[x + 1] ?? 0) / median;
      }).every((ratio) => ratio > 3);
      if (strong) best = columns;
    }
    return best;
  }, png.toString('base64'));
}
async function reference(name: string, width: number): Promise<Buffer | null> {
  const record = (
    JSON.parse(readFileSync(join(REPO, 'inventory/visual-references.json'), 'utf8')) as {
      captures: {
        name: string;
        viewport: { width: string };
        png: string;
        png_sha256: string;
        asset_url: string;
      }[];
    }
  ).captures.find((c) => c.name === name && Number(c.viewport.width) === width);
  assert.ok(record, `${name}-${width} is not in inventory/visual-references.json`);
  const local = join(REPO, record.png);
  let bytes: Buffer | null = existsSync(local) ? readFileSync(local) : null;
  if (!bytes) {
    const token = process.env['GITHUB_TOKEN'];
    const response = await fetch(record.asset_url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (response?.ok) bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!bytes) return null;
  // hash-assert: replacement=prepared-file-reuse; the reference PNG read locally or from its release asset is the
  // recorded inventory file byte-for-byte, not an encoder comparison (the grid is measured against its decoded pixels)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.png_sha256, record.png);
  return bytes;
}

test(
  'typing "389" and "banana" sends no preview or name-list request until Browse names opens',
  { skip: skipped },
  async () => {
    for (const [width, touch] of [
      [1280, false],
      [390, true],
    ] as const) {
      const ctx = await context(width, touch);
      const page = await ctx.newPage();
      const requests: { url: string; at: number }[] = [];
      page.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }));
      const previewOrList = (url: string) => {
        const u = new URL(url);
        return (
          u.pathname === '/catalogue.json' ||
          u.pathname.startsWith('/preview/') ||
          u.hostname === GALLERY ||
          u.hostname === NAME_HOST
        );
      };
      try {
        await openApp(page, site.origin);
        const tile = tileOf(page, 1);
        const field = tile.locator('.next-field input');
        // Words: clear the field (setup), then type each character as a person does.
        await operate(page, field, touch);
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        const typingStarted = Date.now();
        await page.keyboard.type('banana', { delay: 150 });
        assert.equal(await field.inputValue(), 'banana');
        // A seed: switching mode is an explicit act, but "banana" is no seed, so it asks nothing.
        await operate(page, tile.getByRole('button', { name: 'Change mode' }), touch);
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Numeric seed', exact: true }),
          touch,
        );
        await operate(page, field, touch);
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('389', { delay: 150 });
        assert.equal(await field.inputValue(), '389');
        // No debounced trigger either: a settled value still asks nothing.
        await page.waitForTimeout(2500);
        const typed = requests.filter((r) => r.at >= typingStarted && previewOrList(r.url));
        assert.deepEqual(
          typed.map((r) => r.url),
          [],
          'typing sent preview/name-list requests',
        );
        log(
          `${width}: ${requests.filter((r) => r.at >= typingStarted).length} requests while typing, none preview/name-list`,
        );
        // The documented trigger: opening the picker loads the name list.
        const opened = Date.now();
        const dialog = await openNames(page, touch, 0);
        await loadedTiles(dialog);
        const after = requests.filter((r) => r.at >= opened);
        assert.equal(
          after.filter((r) => new URL(r.url).pathname === '/catalogue.json').length,
          1,
          'the picker loads the name list once',
        );
        assert.ok(
          after.some((r) => new URL(r.url).hostname === GALLERY),
          'grid faces load',
        );
        await page.screenshot({ path: join(results, `typing-then-open-${width}.png`) });
      } finally {
        await ctx.close();
      }
    }
  },
);

test(
  'fullscreen gapless grid with readable names, compared with the captured references',
  { skip: skipped },
  async () => {
    const contrast: Record<string, unknown>[] = [];
    for (const [width, touch] of [
      [320, true],
      [390, true],
      [768, false],
      [1280, false],
      [1920, false],
    ] as const) {
      const ctx = await context(width, touch, width === 1920 ? 1080 : 900);
      const page = await ctx.newPage();
      try {
        await openApp(page, site.origin);
        const dialog = await openNames(page, touch);
        await loadedTiles(dialog);
        // Headerless and searchless: no heading, textbox, Close, X or Show more.
        assert.equal(await dialog.getByRole('heading').count(), 0);
        assert.equal(await dialog.getByRole('textbox').count(), 0);
        for (const label of ['Close', 'Show more', 'X', '×'])
          assert.equal(await dialog.getByRole('button', { name: label, exact: true }).count(), 0);
        assert.equal(await dialog.getAttribute('aria-label'), 'Browse names');
        const g = await geometry(dialog);
        const viewport = page.viewportSize()!;
        // Fullscreen.
        assert.ok(Math.abs(g.scroller.width - viewport.width) < 0.5, 'dialog spans the viewport');
        assert.ok(Math.abs(g.scroller.height - viewport.height) < 0.5, 'dialog fills the height');
        const firstRow = g.tiles.filter((t) => t.index < g.columns);
        assert.ok(
          firstRow.every((t) => Math.abs(t.y) < 0.5),
          'first row touches the top',
        );
        assert.ok(Math.abs(firstRow[0]!.x) < 0.5, 'first column touches the left edge');
        assert.ok(
          Math.abs(firstRow.at(-1)!.right - g.scroller.clientWidth) < 0.5,
          'last column reaches the right edge',
        );
        // Gapless: every neighbour shares its edge exactly; every image fills its tile.
        const at = new Map(g.tiles.map((t) => [t.index, t]));
        let pairs = 0;
        for (const t of g.tiles) {
          const right = at.get(t.index + 1);
          if (right && (t.index + 1) % g.columns !== 0) {
            assert.ok(Math.abs(right.x - t.right) < 0.05, `horizontal gap after ${t.index}`);
            pairs++;
          }
          const below = at.get(t.index + g.columns);
          if (below) {
            assert.ok(Math.abs(below.y - t.bottom) < 0.05, `vertical gap below ${t.index}`);
            pairs++;
          }
        }
        g.images.forEach((image, i) => {
          const t = g.tiles[i]!;
          assert.ok(
            Math.abs(image.x - t.x) + Math.abs(image.right - t.right) < 0.1 &&
              Math.abs(image.y - t.y) + Math.abs(image.bottom - t.bottom) < 0.1,
            `image ${t.index} fills its tile`,
          );
        });
        // Names sit over the face at its bottom-right, as in the references.
        for (const label of g.labels)
          assert.ok(
            label.tileRight - label.right <= 14 && label.tileBottom - label.bottom <= 12,
            'name at the bottom-right of its face',
          );
        const tileSize = g.tiles[0]!.right - g.tiles[0]!.x;
        log(
          `${width}: ${g.columns} columns of ${tileSize.toFixed(1)}px, ${pairs} shared edges, 0 gaps, ${g.tiles.length} tiles rendered`,
        );
        if (touch) assert.ok(await dialog.getByRole('button', { name: 'Back' }).isVisible());
        else assert.equal(await dialog.getByRole('button', { name: 'Back' }).isVisible(), false);
        await page.screenshot({ path: join(results, `grid-${width}.png`) });

        if (width === 390 || width === 1280) {
          // Label contrast: white text against its scrimmed background, worst (brightest) pixel.
          await page.addStyleTag({
            content:
              '.measure-text span{color:transparent!important;text-shadow:none!important}.measure-raw::before{display:none!important}',
          });
          const box = await dialog.locator('.next-names-scroller').boundingBox();
          const sampled = g.tiles.filter((t) => t.bottom <= box!.y + box!.height);
          let light = 0,
            dark = 0;
          for (const t of sampled) {
            const button = dialog.locator(`[data-name-index="${t.index}"]`);
            const name = (await button.locator('span').textContent()) ?? '';
            const span = (await button.locator('span').boundingBox())!;
            const clip = {
              x: Math.max(t.x, span.x - 2),
              y: Math.max(t.y, span.y - 2),
              width: Math.min(t.right, span.x + span.width + 2) - Math.max(t.x, span.x - 2),
              height: Math.min(t.bottom, span.y + span.height + 2) - Math.max(t.y, span.y - 2),
            };
            await button.evaluate((e) => e.classList.add('measure-text'));
            const behind = await luminance(page, clip);
            await button.evaluate((e) => e.classList.add('measure-raw'));
            const face = await luminance(page, clip);
            await button.evaluate((e) => e.classList.remove('measure-text', 'measure-raw'));
            const ratio = 1.05 / (behind.max + 0.05);
            if (face.mean > 0.3) light++;
            if (face.mean < 0.08) dark++;
            contrast.push({
              width,
              name,
              faceMean: +face.mean.toFixed(3),
              worst: +ratio.toFixed(2),
            });
            assert.ok(ratio >= 4.5, `${name} at ${width}px: label contrast ${ratio.toFixed(2)}:1`);
          }
          assert.ok(light > 0 && dark > 0, `sampled light (${light}) and dark (${dark}) faces`);
          log(
            `${width}: ${sampled.length} labels >= 4.5:1 (min ${Math.min(
              ...contrast.filter((c) => c['width'] === width).map((c) => c['worst'] as number),
            ).toFixed(2)}:1) over ${light} light and ${dark} dark faces`,
          );
          // The captured legacy names grid at the same width: same column count and layout.
          const png = await reference('names-site', width);
          if (!png) log(`untested: names-site-${width} reference unavailable`);
          else {
            const columns = await referenceColumns(page, png);
            assert.equal(g.columns, columns, `columns at ${width}px match names-site-${width}.png`);
            writeFileSync(join(results, `reference-names-site-${width}.png`), png);
            log(`${width}: ${columns} columns, as in names-site-${width}.png`);
          }
        }
      } finally {
        await ctx.close();
      }
    }
    writeFileSync(join(results, 'contrast.json'), JSON.stringify(contrast, null, 1));
  },
);

test(
  'floating Back, Escape and history Back close once; Forward does not reopen; focus returns',
  { skip: skipped },
  async () => {
    for (const [width, touch] of [
      [390, true],
      [1280, false],
    ] as const) {
      const ctx = await context(width, touch);
      const page = await ctx.newPage();
      try {
        await openApp(page, site.origin);
        const url = page.url();
        const opener = tileOf(page, 0).getByRole('button', { name: 'Browse names' });
        const focusedOpener = () => opener.evaluate((e) => e === document.activeElement);
        const closed = async () => {
          await dialogOf(page).waitFor({ state: 'detached' });
          await page.waitForFunction(() => !document.querySelector('.next-names'));
          await page.waitForTimeout(300);
          assert.equal(page.url(), url, 'no page navigation');
          assert.equal(await dialogOf(page).count(), 0);
          await page.waitForFunction(
            () => document.activeElement?.getAttribute('aria-label') === 'Browse names',
          );
          assert.ok(await focusedOpener(), 'focus returns to the opener');
        };
        if (touch) {
          const dialog = await openNames(page, touch);
          assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
          const back = dialog.getByRole('button', { name: 'Back' });
          const box = (await back.boundingBox())!;
          assert.ok(box.width < 120 && box.height <= 48, 'Back is small');
          await operate(page, back, touch);
          await closed();
          log(
            `${width}: floating Back (${box.width.toFixed(0)}x${box.height.toFixed(0)}) closed it`,
          );
        }
        await openNames(page, touch);
        await page.keyboard.press('Escape');
        await closed();
        await openNames(page, touch);
        await page.goBack();
        await closed();
        await page.goForward();
        await page.waitForTimeout(700);
        assert.equal(await dialogOf(page).count(), 0, 'Forward does not reopen the picker');
        assert.equal(page.url(), url);
        // Still usable afterwards: it opens and closes normally.
        await openNames(page, touch);
        await page.keyboard.press('Escape');
        await closed();
        log(`${width}: Escape, history Back and Forward behave once each`);
      } finally {
        await ctx.close();
      }
    }
  },
);

test(
  'scrolling the whole list keeps live images bounded; arrow keys cross windows',
  { skip: skipped },
  async () => {
    const ctx = await context(1280, false);
    const page = await ctx.newPage();
    try {
      await openApp(page, site.origin);
      const dialog = await openNames(page, false);
      await loadedTiles(dialog);
      const g = await geometry(dialog);
      const tile = g.tiles[0]!.right - g.tiles[0]!.x;
      const scroller = dialog.locator('.next-names-scroller');
      const overscan = Number(await scroller.getAttribute('data-overscan-rows'));
      assert.ok(overscan >= 0 && overscan <= 4, 'a small overscan');
      const bound = (Math.ceil(g.scroller.height / tile) + 1 + 2 * overscan) * g.columns;
      const center = (await scroller.boundingBox())!;
      await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
      let most = 0,
        steps = 0;
      for (;;) {
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(30);
        const { live, top, max } = await scroller.evaluate((e) => ({
          live: e.querySelectorAll('img').length,
          top: e.scrollTop,
          max: e.scrollHeight - e.clientHeight,
        }));
        most = Math.max(most, live);
        steps++;
        if (top >= max - 1) break;
        assert.ok(steps < 2000, 'scrolling ends');
      }
      const lastName = catalogue!.names.at(-1)!.name;
      await dialog.getByRole('button', { name: lastName, exact: true }).waitFor();
      assert.ok(most <= bound, `live images ${most} exceed the bound ${bound}`);
      log(
        `scrolled ${catalogue!.names.length} names in ${steps} wheel steps: at most ${most} live images (bound ${bound})`,
      );
      // Keyboard: Home, then arrows far past the rendered window, then End.
      await scroller.evaluate((e) => e.focus());
      await page.keyboard.press('Home');
      const focused = () =>
        page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          const box = e.getBoundingClientRect();
          return {
            index: Number(e.dataset['nameIndex']),
            name: e.querySelector('span')?.textContent ?? '',
            visible: box.top >= -0.5 && box.bottom <= innerHeight + 0.5,
          };
        });
      assert.deepEqual(await focused(), {
        index: 0,
        name: catalogue!.names[0]!.name,
        visible: true,
      });
      for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowRight');
      const down = 40 * g.columns + 1;
      assert.deepEqual(await focused(), {
        index: down,
        name: catalogue!.names[down]!.name,
        visible: true,
      });
      await page.keyboard.press('ArrowUp');
      assert.equal((await focused()).index, down - g.columns);
      await page.keyboard.press('End');
      const last = catalogue!.names.length - 1;
      assert.deepEqual(await focused(), { index: last, name: lastName, visible: true });
      const live = await scroller.evaluate((e) => e.querySelectorAll('img').length);
      assert.ok(live <= bound);
      await page.screenshot({ path: join(results, 'windowed-end-1280.png') });
      log(`arrow keys reached index ${down} and End reached ${last}; ${live} live images`);
    } finally {
      await ctx.close();
    }
  },
);

test(
  'a name list answering 500 shows its error inside a dismissible dialog',
  { skip: skipped },
  async () => {
    for (const [width, touch] of [
      [1280, false],
      [390, true],
    ] as const) {
      const ctx = await context(width, touch);
      const page = await ctx.newPage();
      const statuses: number[] = [];
      page.on('response', (r) => {
        if (new URL(r.url()).pathname === '/catalogue.json') statuses.push(r.status());
      });
      try {
        await openApp(page, failing.origin);
        let dialog = await openNames(page, touch);
        const alert = dialog.getByRole('alert');
        await alert.waitFor();
        assert.deepEqual(statuses, [500], 'the local catalogue server answered 500');
        assert.match((await alert.textContent()) ?? '', /could not be loaded/);
        // Visible on top, inside the dialog: the element at its centre is the alert.
        const box = (await alert.boundingBox())!;
        assert.ok(
          await page.evaluate(
            ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[role="alert"]'),
            [box.x + box.width / 2, box.y + 10],
          ),
        );
        await page.screenshot({ path: join(results, `names-failed-${width}.png`) });
        await operate(page, alert.getByRole('button', { name: 'Close' }), touch);
        await dialogOf(page).waitFor({ state: 'detached' });
        dialog = await openNames(page, touch);
        await dialog.getByRole('alert').waitFor();
        await page.keyboard.press('Escape');
        await dialogOf(page).waitFor({ state: 'detached' });
        assert.deepEqual(statuses, [500, 500], 'reopening retried the name list');
        log(`${width}: catalogue 500 shown inside the dialog; Close and Escape dismiss it`);
      } finally {
        await ctx.close();
      }
    }
  },
);

test(
  'a full journey contacts only outside hosts listed in outside-requests.ts',
  { skip: skipped, timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-96if; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const { startControl, chromiumArgs, ORIGIN } = await import('../parity/control-server.ts');
    const { readIdentity } = await import('../../../../scripts/import/build-next.mjs');
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    const control = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const journey = await chromium.launch({
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: [...chromiumArgs, '--disable-features=WebGPU'],
    });
    try {
      const ctx = await journey.newContext({
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
      });
      const page = await ctx.newPage();
      const urls: string[] = [];
      ctx.on('request', (r) => urls.push(r.url()));
      await openApp(page, ORIGIN);
      await operate(page, page.getByRole('button', { name: 'More options' }), false);
      await page.getByLabel('Processing mode').selectOption('cpu'); // setup
      const dialog = await openNames(page, false, 1);
      await loadedTiles(dialog);
      const first = catalogue!.names[0]!;
      await operate(page, dialog.getByRole('button', { name: first.name, exact: true }), false);
      await dialogOf(page).waitFor({ state: 'detached' });
      const download = page.locator('.next-download-accept');
      if (
        await download.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await operate(page, download, false);
      await page.waitForFunction(
        () =>
          document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
          'filled',
        null,
        { timeout: 300_000 },
      );
      await page.screenshot({ path: join(results, 'journey-1280.png') });
      const hosts = new Map<string, string>();
      for (const url of urls) {
        const entry = outsideRequest(url, ORIGIN);
        if (entry === null) continue;
        assert.ok(entry, `unlisted outside request ${url}`);
        hosts.set(new URL(url).hostname, entry.host);
      }
      assert.ok(hosts.has(GALLERY), 'the journey loaded gallery faces');
      assert.ok(hosts.has(NAME_HOST), 'the journey fetched the picked name latent');
      log(
        `journey: ${urls.length} requests; outside hosts ${[...hosts.keys()].join(', ')}; all listed among ${OUTSIDE_REQUESTS.length} entries`,
      );
      await ctx.close();
    } finally {
      await journey.close();
      await control.stop();
    }
  },
);
