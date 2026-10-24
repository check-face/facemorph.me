// Operating a control as a person would: scroll it into view, check that the element at its visible centre is
// the control (elementFromPoint), then press there with the real mouse or a touch tap, and report whether the
// press landed inside it. With `follow: false` a link's navigation is stopped after the press is recorded.
import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright';

export interface Landed { inside: boolean; href: string | null; x: number; y: number }

function arm({ follow }: { follow: boolean }) {
  const w = window as unknown as { __landed: Omit<Landed, 'x' | 'y'> | null; __target: Element | null };
  w.__landed = null;
  document.addEventListener('click', (e) => {
    const target = w.__target, hit = e.target as Element, a = hit.closest('a');
    if (!follow) e.preventDefault();
    w.__landed = { inside: !!target && (target === hit || target.contains(hit)), href: a ? a.href : null };
  }, { capture: true, once: true });
}

export async function press(page: Page, control: Locator, { touch = false, follow = true } = {}): Promise<Landed> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${control} has no visible box`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const there = await control.evaluate((el, [px, py]) => {
    (window as unknown as { __target: Element }).__target = el;
    const at = document.elementFromPoint(px as number, py as number);
    return { ok: !!at && (el === at || el.contains(at)), at: at ? at.outerHTML.slice(0, 160) : null };
  }, [x, y]);
  assert.ok(there.ok, `${control}: elementFromPoint at its centre is not the control but ${there.at}`);
  await page.evaluate(arm, { follow });
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.waitForFunction('window.__landed', null, { timeout: 5000 });
  return { ...(await page.evaluate('window.__landed') as Omit<Landed, 'x' | 'y'>), x: Math.round(x), y: Math.round(y) };
}
