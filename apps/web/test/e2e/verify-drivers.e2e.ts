// The drivers in real Chromium, Firefox and WebKit (fm-48bj): the Tab and Shift+Tab walks with :focus-visible and
// visual order, focus returning after a dialog, the width sweep with its screenshots, a continuous resize, and (in
// Chromium) a real storage quota.
//   node --test test/e2e/verify-drivers.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { serve, type Served } from '../support/serve.ts';
import {
  focusReturns,
  resizeThrough,
  sweep,
  tabWalk,
  withStorageQuota,
} from '../verify/drivers.ts';
import { builtBreakpoints, sweepPoints, visualOrderProblems } from '../verify/harness.ts';

const app = new URL('../../', import.meta.url);
const out = new URL('test-results/verify/', app).pathname;
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');

let site: Served;
before(async () => {
  site = await serve(new URL('test/fixtures', app).pathname);
});
after(async () => {
  await site?.close();
});

for (const [engine, type] of Object.entries(ENGINES)) {
  if (only && !only.includes(engine)) continue;
  test(`${engine}: keyboard walk, visual order and focus return`, async (t) => {
    const browser = await type.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`${site.origin}/verify/keyboard.html`);
    const forward = await tabWalk(page);
    // WebKit on macOS skips buttons by default; on Linux every engine tabs to them.
    assert.deepEqual(
      forward.map((s) => s.element.split('[')[0]),
      ['button#one', 'button#two', 'button#three', 'button#good-opener', 'button#bad-opener'],
    );
    assert.ok(
      forward.every((s) => s.focusVisible),
      'every keyboard stop shows :focus-visible',
    );
    assert.deepEqual(visualOrderProblems(forward), []);
    await page.goto(`${site.origin}/verify/keyboard.html`);
    const back = await tabWalk(page, { reverse: true });
    assert.deepEqual(
      back.map((s) => s.element),
      [...forward].reverse().map((s) => s.element),
      'Shift+Tab walks the same stops backwards',
    );
    await page.goto(`${site.origin}/verify/keyboard.html?order=bad`);
    assert.match(
      visualOrderProblems(await tabWalk(page)).join('\n'),
      /reached after button#bad-opener/,
    );
    await page.goto(`${site.origin}/verify/keyboard.html`);
    const open = (id: string) => () =>
      page.keyboard.press('Enter').then(() => page.locator(`#${id}`).waitFor());
    const close = () => page.locator('#close').click();
    assert.equal(await focusReturns(page, '#good-opener', open('close'), close), true);
    assert.equal(await focusReturns(page, '#bad-opener', open('close'), close), false);
  });

  test(`${engine}: width sweep with screenshots, and a continuous resize`, async (t) => {
    const browser = await type.launch();
    t.after(() => browser.close());
    const points = sweepPoints(599, builtBreakpoints(new URL('dist', app).pathname)).filter((p) =>
      [
        '320x900',
        '390x900',
        '599x900',
        '600x900',
        '1280x900',
        'zoom-200-1280',
        'text-200-390',
      ].includes(p.id),
    );
    assert.equal(points.length, 7, 'the built CSS has the 600 px breakpoint');
    const results = await sweep(
      browser,
      engine,
      {
        url: `${site.origin}/verify/keyboard.html`,
        points,
        out,
        caseId: 'verify.harness/sweep/sample',
      },
      async (page, p) => {
        const w = await page.evaluate(() => innerWidth);
        assert.equal(w, p.width, `${p.id}: the page lays out at ${p.width} CSS px`);
        if (p.textScale)
          assert.equal(
            await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
            '32px',
          );
        if (p.width === 320) throw new Error('planted failure at 320 px');
      },
    );
    const failed = results.filter((r) => !r.ok);
    assert.deepEqual(
      failed.map((r) => r.point),
      ['320x900'],
      'only the planted failure',
    );
    assert.ok(
      failed[0]!.screenshot && existsSync(failed[0]!.screenshot),
      'a failure has its screenshot',
    );
    for (const w of ['390x900', '1280x900'])
      assert.ok(
        existsSync(`${out}verify.harness_sweep_sample-${engine}-${w}.png`),
        `${w} screenshot`,
      );
    const page = await browser.newPage({ viewport: { width: 640, height: 600 } });
    await page.goto(`${site.origin}/verify/keyboard.html`);
    const seen: number[] = [];
    await resizeThrough(page, { from: 560, to: 640, step: 40 }, async (w) => {
      seen.push(await page.evaluate(() => innerWidth));
      assert.equal(seen.at(-1), w);
    });
    assert.deepEqual(seen, [560, 600, 640]);
  });
}

test('chromium: a real storage quota the browser enforces', async (t) => {
  if (only && !only.includes('chromium')) return t.skip('chromium not selected');
  // A 512 KiB cache write: stored without the quota, refused by the browser with a 64 KiB quota on the origin.
  const write = (page: Page) =>
    page.evaluate(async () => {
      try {
        await (await caches.open('quota')).put('/big', new Response(new Uint8Array(512 * 1024)));
        return 'stored';
      } catch (e) {
        return (e as Error).name;
      }
    });
  for (const quota of [null, 64 * 1024]) {
    const context = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'verify-quota-')),
    );
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(`${site.origin}/verify/keyboard.html`);
    if (quota) assert.equal(await withStorageQuota(page, 'chromium', site.origin, quota), 'set');
    assert.equal(await write(page), quota ? 'QuotaExceededError' : 'stored', `quota ${quota}`);
  }
});

test('the storage quota is untested outside Chromium', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  assert.equal(await withStorageQuota(page, 'webkit', site.origin, 1), 'untested');
});
