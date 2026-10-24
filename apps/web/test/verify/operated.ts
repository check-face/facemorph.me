// Operated input for integrated verification (fm-48bj): drive a control the way a person does. operatedClick and
// operatedTap scroll the control into view, take the centre of its box, check that the point is inside the viewport
// and inside the declared region (for example the image's top-right quadrant for Remove), check that
// document.elementFromPoint there is the control or a descendant, and only then send a real mouse click or touch tap.
// Defect 1 passed the candidate's CI because its checks clicked by accessible name: Remove sat under the mode-menu
// button, and a real click there opened "Change mode". By-name and by-role locators are for setup only.
//
// Every step goes to a StepLog: step ID, control, point, element actually hit, target size (under 44 px reported)
// and the requests seen during the step, counted and summed per host class. Requests are only observed, never
// stubbed. The host classes come from the request-interception helper (build.ci-site); until it lands a step
// counts by origin.
import { AssertionError } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Locator, Page, Request } from 'playwright';
import { TOUCH_TARGET_PX } from './harness.ts';

export type Part = 'whole' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Where the press must land: inside `part` of `within`'s box. */
export interface Region {
  readonly within: Locator;
  readonly part?: Part;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StepRequests {
  readonly count: number;
  readonly bytes: number;
}

export interface StepRecord {
  readonly step: string;
  readonly control: string;
  readonly input: 'mouse' | 'touch';
  readonly point: { readonly x: number; readonly y: number } | null;
  readonly hit: string | null;
  readonly ok: boolean;
  readonly problem?: string;
  readonly target: { readonly width: number; readonly height: number } | null;
  /** Width or height under the comfortable touch size: reported, never silently passed. */
  readonly smallTarget: boolean;
  readonly requests: Readonly<Record<string, StepRequests>>;
}

/** Maps a request URL to its host class; the default groups by origin until the interception helper lands. */
export type Classify = (url: string) => string;
const byOrigin: Classify = (url) => {
  const u = new URL(url);
  return u.protocol === 'data:' || u.protocol === 'blob:' ? 'local' : u.origin;
};

export class StepLog {
  readonly entries: StepRecord[] = [];
  readonly classify: Classify;
  constructor(classify: Classify = byOrigin) {
    this.classify = classify;
  }
  add(r: StepRecord) {
    this.entries.push(r);
  }
  text(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }
  /** Written as a CI artifact; printed in full when a step fails. */
  write(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${this.text()}\n`);
  }
}

/** The part of a box a press must land in. */
export function partOf(box: Box, part: Part = 'whole'): Box {
  const w = box.width / 2,
    h = box.height / 2;
  switch (part) {
    case 'whole':
      return box;
    case 'top-left':
      return { x: box.x, y: box.y, width: w, height: h };
    case 'top-right':
      return { x: box.x + w, y: box.y, width: w, height: h };
    case 'bottom-left':
      return { x: box.x, y: box.y + h, width: w, height: h };
    case 'bottom-right':
      return { x: box.x + w, y: box.y + h, width: w, height: h };
  }
}

export const inside = (p: { x: number; y: number }, b: Box) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Counts and sums the requests the page and its workers make while `run` is in progress. */
async function watchRequests<T>(
  page: Page,
  classify: Classify,
  run: () => Promise<T>,
): Promise<{ value: T; requests: Record<string, StepRequests> }> {
  const seen: Request[] = [];
  const on = (r: Request) => seen.push(r);
  page.context().on('request', on);
  try {
    const value = await run();
    const requests: Record<string, { count: number; bytes: number }> = {};
    for (const r of seen) {
      const cls = classify(r.url());
      const sizes = await r.sizes().catch(() => null); // a failed or aborted request has no sizes
      const entry = (requests[cls] ??= { count: 0, bytes: 0 });
      entry.count += 1;
      entry.bytes += sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
    }
    return { value, requests };
  } finally {
    page.context().off('request', on);
  }
}

export interface OperateOptions {
  readonly step: string;
  readonly log: StepLog;
  readonly region?: Region;
  readonly touch?: boolean;
  /** What the press should do; awaited inside the step so its requests count to it. */
  readonly effect?: () => Promise<unknown>;
  /** A covering overlay that is fading (a closing menu, a toast) gets this long to clear, as a person waits. */
  readonly settleMs?: number;
}

/** Scrolls as a person can: the page and any user-scrollable container (overflow auto or scroll), never an
 * overflow-hidden one, so a control clipped by its container stays clipped. */
function scrollAsPerson(el: Element) {
  const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    const sx = /auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth;
    const sy = /auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight;
    if (!sx && !sy) continue;
    const c = centre(el.getBoundingClientRect()),
      box = a.getBoundingClientRect();
    if (sx) a.scrollLeft += c.x - (box.left + a.clientWidth / 2);
    if (sy) a.scrollTop += c.y - (box.top + a.clientHeight / 2);
  }
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
    const c = centre(r);
    scrollBy(c.x - innerWidth / 2, c.y - innerHeight / 2);
  }
}

async function locate(page: Page, control: Locator, region: Region | undefined) {
  await control.evaluate(scrollAsPerson); // a fixed off-screen control stays off screen and fails on the viewport
  const box = await control.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) return { problem: 'has no visible box' as const };
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const vp = page.viewportSize();
  if (vp && !inside(point, { x: 0, y: 0, width: vp.width, height: vp.height }))
    return {
      box,
      point,
      problem: `its centre (${Math.round(point.x)}, ${Math.round(point.y)}) is outside the viewport`,
    };
  if (region) {
    const within = await region.within.boundingBox();
    const part = within ? partOf(within, region.part) : null;
    if (!part || !inside(point, part))
      return {
        box,
        point,
        problem: `its centre is outside the ${region.part ?? 'whole'} of ${region.within}`,
      };
  }
  const hit = await control.evaluate(
    (el, [px, py]) => {
      const at = document.elementFromPoint(px as number, py as number);
      const describe = (e: Element) => e.outerHTML.slice(0, 160);
      return { ok: !!at && (el === at || el.contains(at)), at: at ? describe(at) : null };
    },
    [point.x, point.y],
  );
  return { box, point, hit };
}

/** Presses `control` at its visible centre with the real mouse (or a touch tap), after the checks above. */
export async function operatedClick(
  page: Page,
  control: Locator,
  { step, log, region, touch = false, effect, settleMs = 3000 }: OperateOptions,
): Promise<StepRecord> {
  const { value: record, requests } = await watchRequests(page, log.classify, async () => {
    const ok = (f: Awaited<ReturnType<typeof locate>>) => 'hit' in f && !!f.hit?.ok;
    let found = await locate(page, control, region);
    for (const end = Date.now() + settleMs; !ok(found) && Date.now() < end;) {
      await page.waitForTimeout(150);
      found = await locate(page, control, region); // measured again: a control that moves is pressed where it is
    }
    const box = 'box' in found ? found.box : undefined;
    const target = box ? { width: Math.round(box.width), height: Math.round(box.height) } : null;
    const base = {
      step,
      control: String(control),
      input: touch ? ('touch' as const) : ('mouse' as const),
      point:
        'point' in found && found.point
          ? { x: Math.round(found.point.x), y: Math.round(found.point.y) }
          : null,
      target,
      smallTarget: !!target && (target.width < TOUCH_TARGET_PX || target.height < TOUCH_TARGET_PX),
    };
    if ('problem' in found)
      return { ...base, hit: null, ok: false, problem: `${base.control} ${found.problem}` };
    if (!found.hit.ok)
      return {
        ...base,
        hit: found.hit.at,
        ok: false,
        problem: `${base.control}: elementFromPoint at its centre is not the control but ${found.hit.at}`,
      };
    if (touch) await page.touchscreen.tap(found.point.x, found.point.y);
    else await page.mouse.click(found.point.x, found.point.y);
    if (effect) await effect();
    return { ...base, hit: found.hit.at, ok: true };
  });
  const full: StepRecord = { ...record, requests };
  log.add(full);
  if (!full.ok)
    throw new AssertionError({
      message: `${step}: ${full.problem}\nstep log:\n${log.text()}`,
    });
  return full;
}

export const operatedTap = (page: Page, control: Locator, options: Omit<OperateOptions, 'touch'>) =>
  operatedClick(page, control, { ...options, touch: true });
