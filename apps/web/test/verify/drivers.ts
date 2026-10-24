// Drivers for integrated verification (fm-48bj): the width sweep, the keyboard walk and the count driver. Each runs a
// verify case's check in real browsers; screenshots are taken at phone and desktop width per case and on every
// failure.
//
// - Width sweep: SWEEP_WIDTHS (touch emulation at or below the phone/tablet breakpoint), each breakpoint read from
//   the built CSS at -1, 0 and +1 px, portrait and landscape, a continuous resize through the transitions, window
//   height changes, browser zoom (a zoomed page lays out in viewport/zoom CSS px at zoom x device pixels, which is
//   what a context with that viewport and deviceScaleFactor is) and text enlargement (the browser's default font
//   size, applied as the root font size, which is what the preference changes). Touch virtual-keyboard occlusion
//   needs a real phone: it runs in the device lab's phone cells and is untested here.
// - Keyboard: Tab and Shift+Tab walks with a :focus-visible check at each stop, the stops' visual order against
//   their boxes, and focus returning to the opener after a dialog closes.
// - Counts: a repeating control at each count, and at a real resource budget where one exists (a real storage quota
//   the browser enforces, set through CDP in Chromium; other engines report it untested).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Page } from 'playwright';
import type { FocusStop, SweepPoint } from './harness.ts';

export interface SweepResult {
  readonly point: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly screenshot?: string;
}

const contextFor = (p: SweepPoint, engine: string): BrowserContextOptions => ({
  viewport: { width: p.width, height: p.height },
  hasTouch: p.hasTouch,
  // Firefox has no isMobile; its touch emulation is hasTouch alone.
  ...(engine === 'firefox' ? {} : { isMobile: p.isMobile }),
  ...(p.deviceScaleFactor ? { deviceScaleFactor: p.deviceScaleFactor } : {}),
});

/** Runs `check` at every point; screenshots at 390 and 1280 px and at every failure. Failures are collected, not
 * thrown, so one width does not hide another. */
export async function sweep(
  browser: Browser,
  engine: string,
  {
    url,
    points,
    out,
    caseId,
  }: { url: string; points: readonly SweepPoint[]; out: string; caseId: string },
  check: (page: Page, point: SweepPoint) => Promise<void>,
): Promise<SweepResult[]> {
  mkdirSync(out, { recursive: true });
  const results: SweepResult[] = [];
  for (const p of points) {
    const context = await browser.newContext(contextFor(p, engine));
    const page = await context.newPage();
    const shot = join(out, `${caseId.replaceAll('/', '_')}-${engine}-${p.id}.png`);
    try {
      await page.goto(url);
      if (p.textScale)
        await page.addStyleTag({
          content: `:root { font-size: ${p.textScale * 100}% !important; }`,
        });
      await check(page, p);
      if (p.width === 390 || p.width === 1280)
        await page.screenshot({ path: shot, fullPage: true });
      results.push({ point: p.id, ok: true });
    } catch (e) {
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      results.push({ point: p.id, ok: false, error: (e as Error).message, screenshot: shot });
    } finally {
      await context.close();
    }
  }
  return results;
}

/** Resizes one page continuously from `from` to `to` px wide in `step` px, running `check` after each frame. */
export async function resizeThrough(
  page: Page,
  {
    from,
    to,
    step = 8,
    height = 900,
  }: { from: number; to: number; step?: number; height?: number },
  check: (width: number) => Promise<void>,
): Promise<void> {
  const dir = to >= from ? 1 : -1;
  for (let w = from; dir > 0 ? w <= to : w >= to; w += dir * step) {
    await page.setViewportSize({ width: w, height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await check(w);
  }
}

/** Presses Tab (or Shift+Tab) until focus comes back to where it started, or `max` stops. */
export async function tabWalk(
  page: Page,
  { reverse = false, max = 200 } = {},
): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const id = el.id ? `#${el.id}` : '';
      const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40);
      return {
        element: `${el.tagName.toLowerCase()}${id}${label ? `[${label}]` : ''}`,
        box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
        focusVisible: el.matches(':focus-visible'),
      };
    });
    if (!stop) {
      if (stops.length) break; // focus left the page: the walk wrapped
      continue;
    }
    // Back at the first stop, or not moved (Firefox keeps activeElement when focus leaves for its chrome): wrapped.
    if (
      stops.length &&
      (stop.element === stops[0]!.element || stop.element === stops.at(-1)!.element)
    )
      break;
    stops.push(stop);
  }
  return stops;
}

/** Opens a dialog with `open`, closes it with `close`, and reports whether focus came back to `opener`. */
export async function focusReturns(
  page: Page,
  opener: string,
  open: () => Promise<void>,
  close: () => Promise<void>,
): Promise<boolean> {
  await page.focus(opener);
  await open();
  await close();
  return page.evaluate((sel) => document.activeElement === document.querySelector(sel), opener);
}

/** Runs `check` at each count of a repeating control; `setup` puts the page in that state for real. */
export async function forCounts(
  counts: readonly number[],
  setup: (n: number) => Promise<void>,
  check: (n: number) => Promise<void>,
): Promise<{ count: number; ok: boolean; error?: string }[]> {
  const out: { count: number; ok: boolean; error?: string }[] = [];
  for (const n of counts) {
    try {
      await setup(n);
      await check(n);
      out.push({ count: n, ok: true });
    } catch (e) {
      out.push({ count: n, ok: false, error: (e as Error).message });
    }
  }
  return out;
}

/** A real storage quota the browser enforces for `origin`, through CDP (Chromium only; elsewhere `untested`).
 * Chromium enforces it in a persistent profile (launchPersistentContext), as a visitor's browser has, and not in
 * an incognito context; navigator.storage.estimate() keeps reporting the profile's quota, so judge by a refused
 * write, not by the estimate. */
export async function withStorageQuota(
  page: Page,
  engine: string,
  origin: string,
  bytes: number,
): Promise<'set' | 'untested'> {
  if (engine !== 'chromium') return 'untested';
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: bytes });
  return 'set';
}
