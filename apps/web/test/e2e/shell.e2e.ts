// The built shell (dist/, from `npm run build`) in real Chromium, Firefox and WebKit at desktop and phone width:
// - its rows match the control goldens (parity rows exactly; repair and declared rows are owner-graded);
// - every link and control in it is operated as a person would: the element at its visible centre must be the
//   control (elementFromPoint), a real mouse click or touch tap lands on it, and its target is the one shown;
// - every bundler-emitted worker loads.
// fetch-control runs first and the replay refuses goldens recorded from any other control.
//   node --test test/e2e/shell.e2e.ts        (screenshots in test-results/shell/)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright';
import { SHELL_ROWS, SNAPSHOT_IN_PAGE } from '../goldens/snapshot.ts';
import { serve, type Served } from '../support/serve.ts';

const app = new URL('../../', import.meta.url);
const repo = new URL('../../', app);
const results = new URL('test-results/shell/', app);
const goldens = JSON.parse(readFileSync(new URL('test/goldens/goldens.json', app), 'utf8'));
const WIDTHS = goldens.recorder.widths as Record<string, { width: number; height: number }>;
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
// FACEMORPH_E2E_ENGINES=chromium,... narrows the run; FACEMORPH_E2E_CHROMIUM=/usr/bin/chromium (with optional
// FACEMORPH_E2E_CHROMIUM_ARGS, e.g. --disable-features=WebGPU) runs the chromium case on that browser instead.
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
const chromiumPath = process.env['FACEMORPH_E2E_CHROMIUM'];
const chromiumArgs = process.env['FACEMORPH_E2E_CHROMIUM_ARGS']?.split(' ').filter(Boolean) ?? [];
const launch = (engine: string, type: BrowserType) => (engine === 'chromium' && chromiumPath
  ? type.launch({ executablePath: chromiumPath, args: chromiumArgs })
  : type.launch());

// Each operated case: what to press, where it must lead.
const CASES = [
  { id: 'strip-classic', selector: 'aside.next-preview-strip a[href="https://facemorph.me"]', href: /^https:\/\/facemorph\.me\/?$/ },
  { id: 'strip-retiring', selector: 'aside.next-preview-strip a[href="https://facemorph.me/retirement"]', href: /^https:\/\/facemorph\.me\/retirement$/ },
  { id: 'strip-issue', selector: 'aside.next-preview-strip a[target="_blank"]', href: /^https:\/\/github\.com\/check-face\/facemorph\.me\/issues\/new\?template=next-facemorph\.yml&/ },
  { id: 'header-home', selector: 'main.next-product > header a[href="/"]', href: /^http:\/\/127\.0\.0\.1:\d+\/$/ },
  { id: 'footer-contact', selector: 'footer.next-footer a[href^="mailto:"]', href: /^mailto:checkfaceml@gmail\.com$/ },
  { id: 'footer-source', selector: 'footer.next-footer a[href="https://github.com/check-face/facemorph.me"]', href: /^https:\/\/github\.com\/check-face\/facemorph\.me$/ },
  { id: 'footer-issue', selector: 'footer.next-footer a[target="_blank"]', href: /^https:\/\/github\.com\/check-face\/facemorph\.me\/issues\/new\?template=next-facemorph\.yml&/ },
] as const;

let site: Served;
before(async () => {
  const out = execFileSync(process.execPath, [new URL('scripts/import/fetch-control.mjs', repo).pathname], { encoding: 'utf8' });
  assert.ok(JSON.parse(out.trim().split('\n').at(-1) ?? '{}').summary?.ok, `fetch-control refused the control:\n${out}`);
  const record = JSON.parse(readFileSync(new URL('import/control-artifact.json', repo), 'utf8'));
  const lines = record.files.filter((f: { path: string }) => f.path.startsWith('deploy-next/')).map((f: { path: string; sha256: string }) => `${f.sha256}  ${f.path}\n`).join('');
  assert.equal(goldens.control.deploy_next_sha256, createHash('sha256').update(lines).digest('hex'), 'goldens were recorded from another control: record them again');
  assert.ok(existsSync(new URL('dist/index.html', app)), 'no dist/: run `npm run build` first');
  site = await serve(new URL('dist', app).pathname);
  mkdirSync(results, { recursive: true });
});
after(async () => { await site?.close(); });

// Records where a real pointer press lands and which link it would follow, without leaving the page.
function arm(selector: string) {
  const w = window as unknown as { __landed: unknown };
  w.__landed = null;
  const target = document.querySelector(selector);
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    e.preventDefault();
    w.__landed = { inside: !!target && target.contains(e.target as Node), href: a ? a.href : null };
  }, { capture: true, once: true });
}

async function operate(page: Page, selector: string, touch: boolean) {
  const link = page.locator(selector).first();
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} has no visible box`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const hit = await page.evaluate(([s, px, py]) => { const el = document.querySelector(s as string); const at = document.elementFromPoint(px as number, py as number); return !!el && !!at && (el === at || el.contains(at)); }, [selector, x, y]);
  assert.ok(hit, `${selector}: elementFromPoint at its centre is not the control`);
  await page.evaluate(arm, selector);
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.waitForFunction('window.__landed', null, { timeout: 5000 });
  return await page.evaluate('window.__landed') as { inside: boolean; href: string | null };
}

for (const [engine, type] of Object.entries(ENGINES).filter(([e]) => !only || only.includes(e))) {
  test(`${engine}${engine === 'chromium' && chromiumPath ? ` (${chromiumPath} ${chromiumArgs.join(' ')})` : ''}: shell rows match the control, every link is operable, every emitted worker loads`, async () => {
    const browser: Browser = await launch(engine, type);
    try {
      for (const [width, viewport] of Object.entries(WIDTHS)) {
        const touch = width === 'phone';
        const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && engine !== 'firefox' });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${site.origin}/`);
        await page.waitForSelector('footer.next-footer');
        const rows = await page.evaluate(`(${SNAPSHOT_IN_PAGE})(${JSON.stringify(SHELL_ROWS)})`) as Record<string, unknown>;
        for (const row of goldens.rows as { id: string; freeze: string }[]) {
          if (row.freeze !== 'parity') continue; // repair and declared rows are owner-graded, never asserted
          const golden = JSON.parse(readFileSync(new URL(`test/goldens/control/${row.id}/${width}.json`, app), 'utf8'));
          assert.deepEqual(rows[row.id], golden, `${engine} ${width}: ${row.id} differs from the control`);
        }
        await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'));
        await page.screenshot({ path: new URL(`${engine}-${width}-shell.png`, results).pathname, fullPage: true });
        for (const c of CASES) {
          const landed = await operate(page, c.selector, touch);
          assert.ok(landed.inside, `${engine} ${width} ${c.id}: the press landed outside the control`);
          assert.match(landed.href ?? '', c.href, `${engine} ${width} ${c.id}: leads to ${landed.href}`);
          await page.screenshot({ path: new URL(`${engine}-${width}-${c.id}.png`, results).pathname });
        }
        assert.deepEqual(errors, [], `${engine} ${width}: page errors`);
        await context.close();
      }
      const page = await browser.newPage();
      await page.goto(`${site.origin}/worker-check.html`);
      await page.waitForFunction('window.__workerCheck', null, { timeout: 30_000 });
      const workers = await page.evaluate('window.__workerCheck') as { worker: string; ok: boolean; error?: string }[];
      assert.deepEqual(workers.filter((w) => !w.ok), [], `${engine}: emitted workers that failed to load`);
      assert.equal(workers.length, 4);
    } finally {
      await browser.close();
    }
  });
}
