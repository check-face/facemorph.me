// face.many (fm-id4c): the many-face layout, Remove, Undo and Start over in the identified, composed application
// (build:next destination, real bridge and runtime bytes, Chromium on the CPU route). Faces are set up by controller
// fixture (support/face-fixture.ts); every graded control is pressed by real pointer or touch tap at its visible
// position after elementFromPoint shows it there and trusted input lands inside (verify/operated.ts).
// Screenshots and identified per-session step/network receipts are in test-results/face-many/.
//
// Cases (FACE_MANY_CASES=matrix,frames,dark,many,style,keyboard,virtual,height,admission,generate,start-over-generated,one-face-encode,one-face-generate selects some):
//   matrix    counts GRID_COUNTS x every sweep width and built breakpoint +/-1 px (touch at or below 599 px):
//             no page-level sideways scroll, no hidden scrolling surface but the strip, a cue while a face is
//             outside the strip; every face reached by real wheel (desktop) or swipe (touch) with its image,
//             field and slot action hit at their centres; Remove inside its image, hit at its centre (and at the
//             four corners of a 44 x 44 box at touch widths), overlapped by no other control; every visible
//             insertion + hit; one face: no Remove, a reason, Add face adds a second; two or more: a middle
//             face's Remove removes exactly it, no reload, focus to a neighbour, Undo restores it in place.
//   dark      the same counts at 390 and 1,280 px in the dark scheme: screenshot and the overflow checks.
//   many      30, 64 and 150 faces at 390 and 1,280 px: twenty taps remove exactly twenty; Start over gives two
//             empty faces and Undo restores every face in order; Start over from 3.
//   style     the component library's rules injected after the app stylesheet leave Remove unchanged.
//   keyboard  Tab reaches each Remove in visual order; Enter and Space remove; focus to a neighbour; Undo is
//             reached and announced.
//   virtual   150 faces: DOM tile count, first and last face reached, Tab, Remove and Undo across the
//             virtualisation edge, frame time while scrolling.
//   height    390 px with 30 faces: page height in 844 px screens.
//   admission 64 and 150 faces: available entry paths admit a 65th/151st face; native paste fills an empty
//             target created by an operated Add face setup (not a paste insertion). Both byte budgets are
//             forced exactly one over for each path. Batch OK remains explicitly untested under fm-3peb.
//   generate  real CPU inference: removing a generating face cancels it, a sibling finishes; the Undo window
//             makes no invalidateFace call and Undo shows the same result digest with no inference; expiry or a
//             replacing action makes exactly one; one face left: Generate and Save work, Create morph says why.
//   one-face-encode removes down to one face, then operates Encode image, crop, explicit model decisions,
//             real CPU inference and Save at desktop/touch widths; validates the actual recoverable photo file.
//   one-face-encode 1280 mouse / 390 touch: operated Remove leaves one face; Encode image opens its chooser,
//             a real JPEG is crop-confirmed and encoded on CPU; Save exports a valid photo recovery image.
//   one-face-generate 1280 mouse / 390 touch: operated Remove, Numeric seed and native typing, then
//             explicit Generate, real CPU inference and Save; validates the actual recoverable seed file.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/face-many.e2e.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { operatedClick, operatedTap, StepLog } from '../verify/operated.ts';
import { artifactDigest, bindOrigins, DEFAULT_HOST_MAP } from '../verify/artifact.ts';
import { corners } from '../support/rendered-frame.ts';
import { STORE_HOOK, faceList, faceTrace, setFaces } from '../support/face-fixture.ts';
import { readStill } from '../../src/media/recovery-stills.ts';
import { typeMatchesBytes } from '../../src/media/export-policy.ts';
import { builtBreakpoints, visualOrderProblems, type FocusStop } from '../verify/harness.ts';
import {
  FACE_MANY_COUNTS,
  FACE_MANY_TOUCH_BREAKPOINT,
  faceManyWidths,
} from '../verify/face-many.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = resolve(
  process.env['FACE_MANY_RESULTS'] ?? join(REPO, 'apps/web/test-results/face-many'),
);
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
const CASES = new Set(
  (
    process.env['FACE_MANY_CASES'] ??
    'matrix,frames,dark,many,style,keyboard,virtual,height,admission,generate,start-over-generated,one-face-encode,one-face-generate'
  ).split(','),
);
const ONLY_WIDTHS = process.env['FACE_MANY_WIDTHS']?.split(',').map(Number);
const ONLY_COUNTS = process.env['FACE_MANY_COUNTS']?.split(',').map(Number);
const SESSION_LIMIT = 32 * 2 ** 20;
const PHOTO_LIMIT = 128 * 2 ** 20;
let runTag: Readonly<Record<string, string>> | undefined;
const operatedSessions = new Map<Page, { id: number; sequence: number; log: StepLog }>();
/** Use the shared verifier for every graded press while retaining native traversal below. */
async function press(page: Page, control: Locator, { touch = false } = {}) {
  const session = operatedSessions.get(page);
  assert.ok(session, 'the operated page belongs to an identified face.many session');
  const operate = touch ? operatedTap : operatedClick;
  const result = await operate(page, control, {
    log: session.log,
    step: `fm-id4c/session-${session.id}/press-${++session.sequence}`,
  });
  return { inside: result.ok, x: result.point?.x, y: result.point?.y };
}
const evidence: Record<string, unknown> = {};
const record = (key: string, value: unknown) => {
  evidence[key] = value;
  writeFileSync(join(results, 'evidence.json'), JSON.stringify(evidence, null, 1));
};

interface Session {
  context: BrowserContext;
  page: Page;
  touch: boolean;
  errors: string[];
  models: string[];
  navigations: number;
  cdp?: CDPSession;
}

async function open(
  browser: Browser,
  width: number,
  touch: boolean,
  { dark = false, init }: { dark?: boolean; init?: () => void } = {},
): Promise<Session> {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: touch,
    isMobile: touch,
    colorScheme: dark ? 'dark' : 'light',
    ignoreHTTPSErrors: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(STORE_HOOK);
  await context.addInitScript(() => {
    (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] }).__FACEMORPH_OPCTL_TRACE__ = [];
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const s: Session = { context, page, touch, errors: [], models: [], navigations: 0 };
  assert.ok(runTag, 'the operated session has a validated artifact identity');
  const log = new StepLog({
    map: bindOrigins(DEFAULT_HOST_MAP, { app: [ORIGIN] }),
    run: runTag,
  });
  log.attach(page);
  operatedSessions.set(page, { id: operatedSessions.size + 1, sequence: 0, log });
  page.on('pageerror', (error) => s.errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (MODEL.test(path)) s.models.push(path);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) s.navigations++;
  });
  await page.goto(ORIGIN);
  await page.locator('section.next-face').first().waitFor();
  for (const control of [
    page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
    page.getByRole('button', { name: 'Ask me later' }),
  ])
    if (
      await control.waitFor({ timeout: 4000 }).then(
        () => true,
        () => false,
      )
    )
      await press(page, control, { touch });
  await page.getByLabel('Processing mode').selectOption('cpu'); // setup
  return s;
}

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = '';
        let same = 0;
        const tick = () => {
          const strip = document.querySelector('[data-next-strip]');
          const now = `${scrollX},${scrollY},${strip?.scrollLeft ?? 0}`;
          same = now === last ? same + 1 : 0;
          last = now;
          if (same >= 3) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** Page-level checks for a cell: no sideways page scroll; no hidden scrolling surface but the declared strip. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement!;
    const hidden: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.next-product *')) {
      if (el.closest('[data-next-strip]') && !el.matches('[data-next-strip]')) {
        // Inside the strip only the strip scrolls; tiles are checked like any element.
      }
      if (el.matches('[data-next-strip], input, textarea, select')) continue;
      const style = getComputedStyle(el);
      const clips = ['hidden', 'clip'].includes(style.overflowX);
      if (clips && el.scrollWidth > el.clientWidth + 1 && el.getClientRects().length)
        hidden.push(
          `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} ${el.scrollWidth}>${el.clientWidth}`,
        );
    }
    // Diagnostics only: what reaches past the page's width when it scrolls sideways.
    const wide =
      root.scrollWidth > innerWidth
        ? [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((el) => !el.closest('[data-next-strip]'))
            .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5)
            .slice(0, 8)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} ${Math.round(r.left)}..${Math.round(r.right)} ${(el.textContent ?? '').slice(0, 40)}`;
            })
        : [];
    return {
      scrollWidth: root.scrollWidth,
      innerWidth,
      height: root.scrollHeight,
      hidden: [...new Set(hidden)],
      ...(wide.length ? { wide } : {}),
    };
  });

interface FaceBoxes {
  id: string;
  index: number;
  inView: boolean;
  hits: { image: boolean; field: boolean; action: boolean; remove: boolean | null };
  misses: unknown[];
  remove: { inside: boolean; corners: boolean; overlaps: string[] } | null;
}

/** Faces whose image, field and slot action lie inside the viewport (and the strip): each checked at its centre. */
const visibleFaces = (page: Page, touch: boolean) =>
  page.evaluate((touchWidth) => {
    const vw = innerWidth,
      vh = innerHeight;
    const strip = document.querySelector<HTMLElement>('[data-next-strip]');
    const clip = strip?.getBoundingClientRect();
    const inside = (r: DOMRect) =>
      r.width > 0 &&
      r.left >= -0.5 &&
      r.top >= -0.5 &&
      r.right <= vw + 0.5 &&
      r.bottom <= vh + 0.5 &&
      (!clip || (r.left >= clip.left - 0.5 && r.right <= clip.right + 0.5));
    const hit = (el: Element | null, x: number, y: number) => {
      const at = document.elementFromPoint(x, y);
      return !!el && !!at && (el === at || el.contains(at));
    };
    const centre = (el: Element | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return hit(el, r.left + r.width / 2, r.top + r.height / 2);
    };
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'button, input:not([type=hidden]):not([hidden]), a[href], select:not(.next-sr), [role=button], textarea',
      ),
    ];
    const out: FaceBoxes[] = [];
    const ids = (
      window as unknown as { __fmStore: { getState(): { Inputs: { id: string }[] } } }
    ).__fmStore
      .getState()
      .Inputs.map((i) => i.id);
    for (const tile of document.querySelectorAll<HTMLElement>('section.next-face')) {
      const id = tile.dataset['nextFace']!;
      const image = tile.querySelector('.next-face-image');
      const field = tile.querySelector('.next-field input');
      const action = tile.querySelector('.next-face-operation');
      const close = tile.querySelector<HTMLElement>('.next-face-close');
      const parts = [image, field, action, close].filter(Boolean) as Element[];
      const inView = parts.every((p) => inside(p.getBoundingClientRect()));
      const face: FaceBoxes = {
        id,
        index: ids.indexOf(id),
        inView,
        hits: { image: false, field: false, action: false, remove: close ? false : null },
        misses: [],
        remove: null,
      };
      if (inView) {
        const checkedHit = (el: Element, x: number, y: number, part: string) => {
          const ok = hit(el, x, y);
          if (!ok)
            face.misses.push({
              part,
              x,
              y,
              rect: el.getBoundingClientRect().toJSON(),
              stack: document
                .elementsFromPoint(x, y)
                .slice(0, 5)
                .map((n) => n.outerHTML.slice(0, 240)),
              strip: clip?.toJSON(),
              scroll: { x: scrollX, y: scrollY, left: strip?.scrollLeft, top: strip?.scrollTop },
              viewport: { left: visualViewport?.offsetLeft, top: visualViewport?.offsetTop },
              focused: document.activeElement?.outerHTML.slice(0, 240),
              tooltips: [...document.querySelectorAll('[role=tooltip]')].map((n) => ({
                text: n.textContent,
                rect: n.getBoundingClientRect().toJSON(),
              })),
            });
          return ok;
        };
        const checkedCentre = (el: Element | null, part: string) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return checkedHit(el, r.left + r.width / 2, r.top + r.height / 2, part);
        };
        // The image's centre may be the empty-face prompt or the hint inside it: any element of the image box.
        face.hits = {
          image: checkedCentre(image, 'image'),
          field: checkedCentre(field, 'field'),
          action: action ? checkedCentre(action, 'action') : true,
          remove: close ? checkedCentre(close, 'remove') : null,
        };
        if (close) {
          const r = close.getBoundingClientRect();
          const box = image!.getBoundingClientRect();
          const cx = r.left + r.width / 2,
            cy = r.top + r.height / 2;
          const corners = [
            [cx - 21.5, cy - 21.5],
            [cx + 21.5, cy - 21.5],
            [cx - 21.5, cy + 21.5],
            [cx + 21.5, cy + 21.5],
          ];
          face.remove = {
            inside:
              r.left >= box.left - 0.5 &&
              r.top >= box.top - 0.5 &&
              r.right <= box.right + 0.5 &&
              r.bottom <= box.bottom + 0.5 &&
              r.width >= 44 &&
              r.height >= 44,
            corners: touchWidth
              ? corners
                  .map(([x, y], i) => checkedHit(close, x!, y!, `remove-corner-${i}`))
                  .every(Boolean)
              : true,
            overlaps: controls
              .filter((c) => c !== close && !close.contains(c) && !c.contains(close))
              .filter((c) => {
                const o = c.getBoundingClientRect();
                return (
                  o.width > 0 &&
                  o.left < r.right - 0.5 &&
                  o.right > r.left + 0.5 &&
                  o.top < r.bottom - 0.5 &&
                  o.bottom > r.top + 0.5
                );
              })
              .map((c) => c.outerHTML.slice(0, 80)),
          };
        }
      }
      out.push(face);
    }
    const connectors = [...document.querySelectorAll<HTMLElement>('.next-connector-add')]
      .filter((c) => inside(c.getBoundingClientRect()))
      .map((c) => ({ label: c.getAttribute('aria-label'), hit: centre(c) }));
    const cue = document.querySelector<HTMLElement>('[data-next-scroll-cue]');
    const cueBox = cue?.getBoundingClientRect();
    return {
      faces: out,
      connectors,
      cueVisible: !!cueBox && cueBox.height > 0 && cueBox.bottom > 0 && cueBox.top < vh,
      strip: strip
        ? { left: strip.scrollLeft, width: strip.clientWidth, scroll: strip.scrollWidth }
        : null,
    };
  }, touch);

/** Brings the strip (or a face, without a strip) into the vertical view with a real wheel or swipe. */
async function pageTo(s: Session, top: () => Promise<number>, target = 70) {
  for (let i = 0; i < 12; i++) {
    const delta = (await top()) - target;
    if (Math.abs(delta) < 4) return;
    await scroll(s, 0, delta, { x: 8, y: 450 });
    await settle(s.page);
  }
}

/** A real scroll: mouse wheel on desktop, a touch swipe (CDP synthesized gesture) at touch widths. */
async function scroll(s: Session, dx: number, dy: number, at: { x: number; y: number }) {
  if (!s.touch) {
    await s.page.mouse.move(at.x, at.y);
    await s.page.mouse.wheel(dx, dy);
    return;
  }
  // A finger stays on the screen: a long swipe is several strokes, each starting where it has room to travel.
  const view = s.page.viewportSize()!;
  const cdp = (s.cdp ??= await s.context.newCDPSession(s.page));
  let restX = dx,
    restY = dy;
  // Each stroke is centred on `at` (inside the strip for sideways swipes) and stays on the screen.
  const cx = Math.min(Math.max(at.x, 30), view.width - 30);
  const cy = Math.min(Math.max(at.y, 30), view.height - 30);
  // The finger starts and ends 40 px inside the screen (and so inside a full-width strip).
  const roomX = 2 * (Math.min(cx, view.width - cx) - 40);
  const roomY = 2 * (Math.min(cy, view.height - cy) - 40);
  while (Math.abs(restX) >= 1 || Math.abs(restY) >= 1) {
    const stepX = Math.sign(restX) * Math.min(Math.abs(restX), Math.max(1, roomX - 32));
    const stepY = Math.sign(restY) * Math.min(Math.abs(restY), Math.max(1, roomY - 32));
    // Scrolling right/down moves the finger left/up.
    // Cross the initial touch slop before moving the requested scroll distance.
    const strokeX = stepX ? stepX + Math.sign(stepX) * 32 : 0;
    const strokeY = stepY ? stepY + Math.sign(stepY) * 32 : 0;
    const x = cx + strokeX / 2;
    const y = cy + strokeY / 2;
    // touchStart, moves, a short hold (so no fling), touchEnd: the compositor scrolls as for a finger.
    const steps = 8;
    const point = (k: number) => [{ x: x - (strokeX * k) / steps, y: y - (strokeY * k) / steps }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
    for (let k = 1; k <= steps; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(k) });
      await s.page.waitForTimeout(16);
    }
    await s.page.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    restX -= stepX;
    restY -= stepY;
    // A remainder under the touch slop would not scroll at all: stop there.
    if (Math.abs(restX) < 40 && Math.abs(restY) < 40) break;
  }
}

const stripTop = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector('.next-strip-head')?.getBoundingClientRect().top ??
      document.querySelector('section.next-face')!.getBoundingClientRect().top,
  );

interface Visit {
  verified: number;
  steps: number;
  problems: string[];
  connectorsHit: number;
}

/** Every face reached by real wheel/swipe: its parts hit at their centres, Remove's geometry and the cue. */
async function visitAll(s: Session, count: number, label: string): Promise<Visit> {
  const { page } = s;
  const problems: string[] = [];
  const seen = new Set<string>();
  let connectorsHit = 0;
  const hasStrip = (await page.locator('[data-next-strip]').count()) > 0;
  const check = async () => {
    const v = await visibleFaces(page, s.touch);
    for (const c of v.connectors) {
      if (!c.hit) problems.push(`${label}: + "${c.label}" not hit at its centre`);
      else connectorsHit++;
    }
    for (const f of v.faces.filter((x) => x.inView && !seen.has(x.id))) {
      const before = problems.length;
      seen.add(f.id);
      const at = `${label} face ${f.index + 1}`;
      if (!f.hits.image) problems.push(`${at}: image not hit`);
      if (!f.hits.field) problems.push(`${at}: field not hit`);
      if (!f.hits.action) problems.push(`${at}: slot action not hit`);
      if (count >= 2) {
        if (f.hits.remove !== true) problems.push(`${at}: Remove not hit at its centre`);
        if (!f.remove?.inside) problems.push(`${at}: Remove not a 44x44 box inside its image`);
        if (!f.remove?.corners) problems.push(`${at}: a 44x44 corner is not Remove`);
        if (f.remove?.overlaps.length) problems.push(`${at}: overlapped by ${f.remove.overlaps}`);
      } else if (f.hits.remove !== null) problems.push(`${at}: the only face offers Remove`);
      if (problems.length > before) {
        const rows = (evidence['hitFailures'] ?? []) as unknown[];
        rows.push({ label, face: f });
        record('hitFailures', rows);
        await page.screenshot({
          path: join(results, `hit-${count}-${page.viewportSize()!.width}-${f.index + 1}.png`),
        });
      }
    }
    const outside = v.strip && v.faces.some((f) => !f.inView);
    if (v.strip && (outside || count > v.faces.length) && !v.cueVisible)
      problems.push(`${label}: faces outside the strip with no visible cue`);
    return v;
  };
  let steps = 0;
  if (hasStrip) {
    await page.evaluate(() => {
      document.querySelector('[data-next-strip]')!.scrollLeft = 0; // reset between cells (setup)
    });
    await pageTo(s, () => stripTop(page));
    await settle(page);
    for (; steps < count * 3 + 10; steps++) {
      const v = await check();
      if (seen.size >= count) break;
      const box = await page.locator('[data-next-strip]').boundingBox();
      const before = v.strip!.left;
      // Visit the next unseen face rather than stepping a fixed pitch: insertion connectors are
      // snap points too, and a fixed stroke can alias them while skipping every whole tile.
      const next = v.faces.find((f) => !seen.has(f.id));
      if (next) await reach(s, next.index);
      else await scroll(s, v.strip!.width, 0, { x: box!.x + box!.width / 2, y: box!.y + 40 });
      await settle(page);
      const after = await page.evaluate(
        () => document.querySelector('[data-next-strip]')!.scrollLeft,
      );
      if (Math.abs(after - before) < 1 && v.strip!.left + v.strip!.width >= v.strip!.scroll - 1) {
        await check();
        break;
      }
    }
  } else {
    await page.evaluate(() => scrollTo(0, 0)); // reset between cells (setup)
    const tiles = await page.locator('section.next-face').count();
    for (let i = 0; i < tiles; i++) {
      await pageTo(s, () =>
        page.evaluate(
          (n) => document.querySelectorAll('section.next-face')[n]!.getBoundingClientRect().top,
          i,
        ),
      );
      await check();
      steps++;
    }
  }
  if (seen.size < count) problems.push(`${label}: reached ${seen.size} of ${count} faces`);
  return { verified: seen.size, steps, problems, connectorsHit };
}

/** The visible Remove of the face at `index`, brought into view by real wheel/swipe on the strip. */
async function reach(s: Session, index: number): Promise<Locator> {
  const { page } = s;
  const id = (await faceList(page))[index]!.id;
  const tile = page.locator(`section.next-face[data-next-face="${id}"]`);
  if ((await page.locator('[data-next-strip]').count()) > 0) {
    await pageTo(s, () => stripTop(page));
    let best = Infinity;
    let stalled = 0;
    for (let i = 0; i < 400; i++) {
      const where = await page.evaluate((faceId) => {
        const strip = document.querySelector<HTMLElement>('[data-next-strip]')!;
        const t = document.querySelector(`section.next-face[data-next-face="${faceId}"]`);
        const s = strip.getBoundingClientRect();
        const f = document.querySelector('[data-next-strip] > .next-face')!.getBoundingClientRect();
        const pitch = f.width + 48;
        const ids = (
          window as unknown as { __fmStore: { getState(): { Inputs: { id: string }[] } } }
        ).__fmStore
          .getState()
          .Inputs.map((x) => x.id);
        const r = t?.getBoundingClientRect();
        if (r && r.left >= s.left - 0.5 && r.right <= s.right + 0.5) return 0;
        const centre = ids.indexOf(faceId) * pitch + 48 + f.width / 2 - strip.clientWidth / 2;
        return centre - strip.scrollLeft;
      }, id);
      if (where === 0) break;
      stalled = Math.abs(where) >= best - 1 ? stalled + 1 : 0;
      best = Math.min(best, Math.abs(where));
      assert.ok(stalled < 3, `Touch/wheel could not reach face ${index + 1}; remaining ${where}px`);

      const box = (await page.locator('[data-next-strip]').boundingBox())!;
      await scroll(s, Math.sign(where) * Math.min(Math.abs(where), box.width * 3), 0, {
        x: box.x + box.width / 2,
        y: box.y + 40,
      });
      await settle(page);
    }
  } else await pageTo(s, async () => (await tile.boundingBox())!.y, 120);
  return tile.locator('.next-face-close');
}

const focusedFace = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.closest('[data-next-face]')?.getAttribute('data-next-face') ?? null,
  );

/** A middle face's Remove, then Undo, both operated. */
async function removeAndUndo(s: Session, label: string) {
  const { page } = s;
  const before = await faceList(page);
  const middle = Math.floor(before.length / 2);
  const removed = before[middle]!;
  const navigations = s.navigations;
  const landed = await press(page, await reach(s, middle), { touch: s.touch });
  assert.ok(landed.inside, `${label}: Remove pressed inside`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-next-undo-notice] .next-undo').length === n,
    1,
  );
  const after = await faceList(page);
  assert.deepEqual(
    after.map((f) => f.id),
    before.filter((f) => f.id !== removed.id).map((f) => f.id),
    `${label}: exactly the pressed face went`,
  );
  assert.equal(s.navigations, navigations, `${label}: no reload`);
  const focused = await focusedFace(page);
  const neighbours = [after[middle]?.id, after[middle - 1]?.id].filter(Boolean);
  assert.ok(focused && neighbours.includes(focused), `${label}: focus on a neighbour (${focused})`);
  const undo = page.locator('[data-next-undo-notice] .next-undo');
  assert.ok((await press(page, undo, { touch: s.touch })).inside, `${label}: Undo pressed inside`);
  await page.waitForFunction(() => !document.querySelector('[data-next-undo-notice] .next-undo'));
  assert.deepEqual(
    await faceList(page),
    before,
    `${label}: Undo restores it in place with its content`,
  );
  assert.equal(s.navigations, navigations, `${label}: no reload`);
}

test(
  'face.many: layout, Remove, Undo and Start over operated at every count and width',
  { timeout: 6 * 3600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-id4c; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    runTag = {
      artifactDigest: artifactDigest(artifact.identity.files),
      source: artifact.identity.deploySource.buildId,
      label: artifact.identity.label,
      requestByteTotals:
        'Known lengths only; null bytes in the raw session network receipt remain unknown.',
    };
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    const breakpoints = builtBreakpoints(join(out, 'deploy-next'));
    const widths = faceManyWidths(breakpoints).filter(
      (w) => !ONLY_WIDTHS || ONLY_WIDTHS.includes(w),
    );
    const counts = FACE_MANY_COUNTS.filter((c) => !ONLY_COUNTS || ONLY_COUNTS.includes(c));
    record('build', {
      buildId: artifact.identity.deploySource.buildId,
      breakpoints,
      widths,
      counts,
    });
    const failures: string[] = [];
    try {
      if (CASES.has('matrix'))
        await t.test('matrix', async () => {
          const cells: Record<string, unknown>[] = [];
          for (const touch of [true, false]) {
            const group = widths.filter((w) => w <= FACE_MANY_TOUCH_BREAKPOINT === touch);
            if (!group.length) continue;
            const s = await open(browser, group[0]!, touch);
            for (const count of counts) {
              await setFaces(s.page, count);
              for (const width of group) {
                const label = `${count} faces @ ${width}${touch ? ' touch' : ''}`;
                await s.page.setViewportSize({ width, height: 900 });
                await settle(s.page);
                const cell: Record<string, unknown> = { count, width, touch };
                try {
                  const o = await overflow(s.page);
                  cell['overflow'] = o;
                  if (o.scrollWidth > o.innerWidth)
                    failures.push(
                      `${label}: page scrolls sideways (${o.scrollWidth} > ${o.innerWidth})`,
                    );
                  if (o.hidden.length)
                    failures.push(`${label}: hidden scrolling surfaces ${o.hidden.join('; ')}`);
                  if (touch && count > 2) {
                    // One face per view (fm-vd4i): the image spans the tile's width at every count.
                    const whole = await s.page.locator('section.next-face').evaluateAll((faces) =>
                      faces.map((face) => {
                        const image = face
                          .querySelector('.next-face-image')!
                          .getBoundingClientRect();
                        const card = face.getBoundingClientRect();
                        return image.width >= card.width * 0.9;
                      }),
                    );
                    assert.ok(
                      whole.length > 0 && whole.every(Boolean),
                      `${label}: full-width images`,
                    );
                    cell['fullWidth'] = true;
                  }
                  const v = await visitAll(s, count, label);
                  cell['visit'] = {
                    verified: v.verified,
                    steps: v.steps,
                    connectorsHit: v.connectorsHit,
                  };
                  failures.push(...v.problems);
                  await s.page.screenshot({ path: join(results, `matrix-${count}-${width}.png`) });
                  if (count === 1) {
                    assert.equal(
                      await s.page.locator('.next-face-close').count(),
                      0,
                      `${label}: no Remove`,
                    );
                    assert.ok(
                      await s.page.locator('.next-last-face-note').isVisible(),
                      `${label}: the reason`,
                    );
                    const addFace = s.page.getByRole('button', { name: 'Add face', exact: true });
                    assert.ok(await addFace.isEnabled(), `${label}: Add face enabled`);
                    assert.ok(
                      (await press(s.page, addFace, { touch })).inside,
                      `${label}: Add face`,
                    );
                    await s.page.waitForFunction(
                      () => document.querySelectorAll('section.next-face').length === 2,
                    );
                    await setFaces(s.page, 1);
                  } else await removeAndUndo(s, label);
                  cell['ok'] = true;
                } catch (error) {
                  failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
                  await s.page.screenshot({
                    path: join(results, `matrix-${count}-${width}-FAILED.png`),
                  });
                  await setFaces(s.page, count);
                }
                cells.push(cell);
                record('matrix', cells);
              }
            }
            assert.deepEqual(s.errors, [], 'no page errors');
            await s.context.close();
          }
        });

      if (CASES.has('frames'))
        await t.test('full preview frames in compact and desktop tiles', async () => {
          const rows: unknown[] = [];
          for (const [width, touch] of [
            [390, true],
            [1280, false],
          ] as const) {
            const s = await open(browser, width, touch);
            const faces = await setFaces(s.page, 8);
            // Controller fixture only: each card renders the shipped decoded 1024px hello preview.
            await s.page.evaluate(
              (ids) => {
                const store = (window as unknown as { __fmStore: { dispatch(m: unknown): void } })
                  .__fmStore;
                for (const id of ids) {
                  store.dispatch({ type: 'Edit', args: [id, 'hello'] });
                  store.dispatch({ type: 'Mode', args: [id, 'text'] });
                }
              },
              faces.map((f) => f.id),
            );
            await s.page.waitForFunction(() => {
              const images = [
                ...document.querySelectorAll<HTMLImageElement>('section.next-face img'),
              ];
              return (
                images.length === 8 &&
                images.every(
                  (img) => img.complete && img.naturalWidth === 1024 && img.naturalHeight === 1024,
                )
              );
            });
            for (let i = 0; i < faces.length; i++) {
              await reach(s, i);
              const media = s.page.locator(`[data-next-face="${faces[i]!.id}"] img`);
              const points = await corners(s.page, media);
              assert.equal(points.length, 4);
              rows.push({ width, face: i + 1, corners: points });
              record('frames', rows);
            }
            assert.deepEqual(s.models, [], 'preview frames need no model transfer');
            await s.page.screenshot({ path: join(results, `frames-${width}.png`) });
            await s.context.close();
          }
        });

      if (CASES.has('dark'))
        await t.test('dark scheme at 390 and 1,280 px', async () => {
          for (const [width, touch] of [
            [390, true],
            [1280, false],
          ] as const) {
            const s = await open(browser, width, touch, { dark: true });
            for (const count of counts) {
              await setFaces(s.page, count);
              await settle(s.page);
              const o = await overflow(s.page);
              if (o.scrollWidth > o.innerWidth)
                failures.push(`dark ${count}@${width}: page scrolls sideways`);
              await pageTo(s, () => stripTop(s.page));
              await s.page.screenshot({ path: join(results, `dark-${count}-${width}.png`) });
            }
            await s.context.close();
          }
        });

      if (CASES.has('many'))
        await t.test('twenty taps, Start over and Undo at 30, 64 and 150 faces', async () => {
          const rows: unknown[] = [];
          for (const [width, touch] of [
            [390, true],
            [1280, false],
          ] as const) {
            const s = await open(browser, width, touch);
            for (const count of [30, 64, 150, 3].filter(
              (c) => !ONLY_COUNTS || ONLY_COUNTS.includes(c),
            )) {
              const label = `${count}@${width}`;
              const before = await setFaces(s.page, count);
              const pressed: string[] = [];
              if (count > 3)
                for (let i = 0; i < 20; i++) {
                  const index = (i * 7) % (count - pressed.length);
                  const id = (await faceList(s.page))[index]!.id;
                  const landed = await press(s.page, await reach(s, index), { touch });
                  assert.ok(landed.inside, `${label}: tap ${i + 1}`);
                  await s.page.waitForFunction(
                    (gone) => !document.querySelector(`[data-next-face="${gone}"]`),
                    id,
                  );
                  pressed.push(id);
                }
              const left = await faceList(s.page);
              if (count > 3) {
                assert.equal(left.length, count - 20, `${label}: twenty taps remove twenty`);
                assert.deepEqual(
                  left.map((f) => f.id),
                  before.map((f) => f.id).filter((id) => !pressed.includes(id)),
                  `${label}: exactly the pressed faces`,
                );
              }
              const more = s.page.getByRole('button', { name: 'More options' });
              if ((await more.getAttribute('aria-expanded')) !== 'true')
                assert.ok((await press(s.page, more, { touch })).inside);
              const startOver = s.page.getByRole('button', { name: 'Start over' });
              assert.ok((await press(s.page, startOver, { touch })).inside, `${label}: Start over`);
              await s.page.waitForFunction(
                () => document.querySelectorAll('section.next-face').length === 2,
              );
              const fresh = await faceList(s.page);
              assert.deepEqual(
                fresh.map((f) => [f.mode, f.value]),
                [
                  ['text', ''],
                  ['text', ''],
                ],
                `${label}: two empty faces`,
              );
              await s.page.screenshot({ path: join(results, `start-over-${count}-${width}.png`) });
              const undo = s.page.locator('[data-next-undo-notice] .next-undo');
              assert.ok((await press(s.page, undo, { touch })).inside, `${label}: Undo`);
              await s.page.waitForFunction(
                (n) =>
                  (
                    window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
                  ).__fmStore.getState().Inputs.length === n,
                left.length,
              );
              assert.deepEqual(
                await faceList(s.page),
                left,
                `${label}: every face back in order with content`,
              );
              rows.push({
                count,
                width,
                removedByTaps: pressed.length,
                afterTaps: left.length,
                startOver: 2,
                undone: left.length,
              });
              record('many', rows);
            }
            await s.context.close();
          }
        });

      if (CASES.has('style'))
        await t.test(
          'style independence: the component library after the app stylesheet',
          async () => {
            const rows: unknown[] = [];
            for (const [width, touch] of [
              [390, true],
              [1280, false],
            ] as const) {
              const s = await open(browser, width, touch);
              await setFaces(s.page, 3);
              await settle(s.page);
              const measure = () =>
                s.page.evaluate(() => {
                  const c = document.querySelector<HTMLElement>('.next-face-close')!;
                  const r = c.getBoundingClientRect();
                  const st = getComputedStyle(c);
                  const disc = getComputedStyle(c, '::before');
                  return {
                    box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10),
                    color: st.color,
                    background: st.backgroundColor,
                    padding: st.padding,
                    disc: [disc.backgroundColor, disc.top, disc.width],
                  };
                });
              const before = await measure();
              const injected = await s.page.evaluate(() => {
                // The component library's rules (MUI's emotion sheets), appended after every app stylesheet.
                const rules: string[] = [];
                for (const sheet of document.styleSheets) {
                  const owner = sheet.ownerNode as Element | null;
                  if (!owner?.hasAttribute('data-emotion')) continue;
                  for (const rule of sheet.cssRules) rules.push(rule.cssText);
                }
                const style = document.createElement('style');
                style.textContent = rules.join('\n');
                document.head.append(style);
                return rules.length;
              });
              await settle(s.page);
              const after = await measure();
              assert.ok(injected > 10, 'component library rules found');
              assert.deepEqual(after, before, `${width}: Remove geometry and colour unchanged`);
              rows.push({ width, injectedRules: injected, before, after });
              record('style', rows);
              await s.context.close();
            }
          },
        );

      if (CASES.has('keyboard'))
        await t.test('keyboard: Tab order, Enter and Space, focus and Undo', async () => {
          const rows: unknown[] = [];
          for (const [width, touch] of [
            [1280, false],
            [390, true],
          ] as const) {
            const s = await open(browser, width, touch);
            const { page } = s;
            const faces = await setFaces(page, 5);
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.locator('section.next-face').first().locator('.next-field input').focus(); // start point (setup)
            const stops: (FocusStop & { face: string | null; remove: boolean })[] = [];
            for (let i = 0; i < 80; i++) {
              const stop = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement;
                const r = el.getBoundingClientRect();
                return {
                  element: `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20)}]`,
                  box: {
                    x: r.x + (document.querySelector('[data-next-strip]')?.scrollLeft ?? 0),
                    y: r.y + scrollY,
                    width: r.width,
                    height: r.height,
                  },
                  focusVisible: el.matches(':focus-visible'),
                  face: el.closest('[data-next-face]')?.getAttribute('data-next-face') ?? null,
                  remove: el.classList.contains('next-face-close'),
                };
              });
              stops.push(stop);
              if (stop.element.startsWith('button[Add a face after')) break;
              await page.keyboard.press('Tab');
            }
            const removes = stops.filter((x) => x.remove).map((x) => x.face);
            assert.deepEqual(
              removes,
              faces.map((f) => f.id).slice(1),
              `${width}: each Remove (after the first face's, where Tab started) in order`,
            );
            // The Removes sit on one row along the strip (or pair), so visual order is left to right along it.
            const order = visualOrderProblems(stops.filter((x) => x.remove));
            assert.deepEqual(order, [], `${width}: Removes in visual order`);
            rows.push({
              width,
              stops: stops.length,
              removes: removes.length,
              orderProblems: order,
            });
            // Enter on face 3's Remove, Space on the next; focus to a neighbour each time; Undo reached and announced.
            for (const key of ['Enter', ' '] as const) {
              const list = await faceList(page);
              const target = list[2]!;
              await page.locator(`[data-next-face="${target.id}"] .next-face-close`).focus();
              await page.keyboard.press(key);
              await page.waitForFunction(
                (id) => !document.querySelector(`[data-next-face="${id}"]`),
                target.id,
              );
              const focused = await focusedFace(page);
              assert.ok(
                focused === list[3]?.id || focused === list[1]?.id,
                `${width} ${key}: focus to a neighbour`,
              );
              const announced = await page.locator('[data-next-undo-notice]').evaluate((n) => ({
                live: n.getAttribute('aria-live'),
                role: n.getAttribute('role'),
                text: n.textContent,
              }));
              assert.equal(announced.live, 'polite');
              assert.match(announced.text ?? '', /Removed Face 3\./);
              let reached = false;
              for (let i = 0; i < 20 && !reached; i++) {
                await page.keyboard.press('Shift+Tab');
                reached = await page.evaluate(
                  () => document.activeElement?.classList.contains('next-undo') ?? false,
                );
              }
              assert.ok(reached, `${width} ${key}: Undo reached by keyboard`);
              await page.keyboard.press('Enter');
              await page.waitForFunction(
                (id) => !!document.querySelector(`[data-next-face="${id}"]`),
                target.id,
              );
              assert.deepEqual(await faceList(page), list, `${width} ${key}: Undo restored it`);
              rows.push({ width, key, focusedAfterRemove: focused, announced });
            }
            record('keyboard', rows);
            await s.context.close();
          }
        });

      if (CASES.has('virtual'))
        await t.test('virtualised strip at 150 faces', async () => {
          const rows: unknown[] = [];
          for (const [width, touch] of [
            [1280, false],
            [390, true],
          ] as const) {
            const s = await open(browser, width, touch);
            const { page } = s;
            const faces = await setFaces(page, 150);
            await settle(page);
            const rendered = await page.locator('section.next-face').count();
            assert.ok(
              rendered < 20,
              `${width}: only tiles near the view are in the DOM (${rendered})`,
            );
            // Frame time while scrolling with real wheel/swipe across the strip.
            await page.evaluate(() => {
              const w = window as unknown as { __frames: number[] };
              w.__frames = [];
              let last = performance.now();
              const tick = (now: number) => {
                w.__frames.push(now - last);
                last = now;
                if (w.__frames.length < 100_000) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            await pageTo(s, () => stripTop(page));
            const box = (await page.locator('[data-next-strip]').boundingBox())!;
            for (let i = 0; i < 30; i++)
              await scroll(s, box.width * 2, 0, { x: box.x + box.width / 2, y: box.y + 40 });
            await settle(page);
            const frames = await page.evaluate(() => {
              const f = (window as unknown as { __frames: number[] }).__frames
                .slice(1)
                .sort((a, b) => a - b);
              return {
                n: f.length,
                p50: f[Math.floor(f.length / 2)],
                p95: f[Math.floor(f.length * 0.95)],
                max: f.at(-1),
              };
            });
            // The last face is reached; then the first.
            const lastRemove = await reach(s, 149);
            assert.ok(await lastRemove.isVisible(), `${width}: the last face is reached`);
            const renderedAtEnd = await page.locator('section.next-face').count();
            const firstRemove = await reach(s, 0);
            assert.ok(await firstRemove.isVisible(), `${width}: the first face is reached`);
            // Tab across the virtualisation edge: from the last rendered tile's Remove onwards, every face in order.
            const startAt = 40;
            await reach(s, startAt);
            await page.locator(`[data-next-face="${faces[startAt]!.id}"] .next-face-close`).focus(); // start point (setup)
            const reachedFaces: string[] = [faces[startAt]!.id];
            for (let i = 0; i < 120 && reachedFaces.length < 25; i++) {
              await page.keyboard.press('Tab');
              const f = await page.evaluate(() =>
                document.activeElement?.classList.contains('next-face-close')
                  ? document.activeElement
                      .closest('[data-next-face]')!
                      .getAttribute('data-next-face')
                  : null,
              );
              if (f) reachedFaces.push(f);
            }
            assert.deepEqual(
              reachedFaces,
              faces.slice(startAt, startAt + 25).map((f) => f.id),
              `${width}: Tab reaches each Remove past the rendered edge`,
            );
            // Remove and Undo deep in the strip, beyond the first rendered window.
            const deep = 120;
            const before = await faceList(page);
            assert.ok((await press(page, await reach(s, deep), { touch })).inside);
            await page.waitForFunction(
              (id) => !document.querySelector(`[data-next-face="${id}"]`),
              before[deep]!.id,
            );
            assert.equal((await faceList(page)).length, 149);
            assert.ok(
              (await press(page, page.locator('[data-next-undo-notice] .next-undo'), { touch }))
                .inside,
            );
            await page.waitForFunction(
              (n) =>
                (
                  window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
                ).__fmStore.getState().Inputs.length === n,
              150,
            );
            assert.deepEqual(
              await faceList(page),
              before,
              `${width}: Undo across the virtualisation edge`,
            );
            rows.push({ width, rendered, renderedAtEnd, frames, tabbed: reachedFaces.length });
            record('virtual', rows);
            await s.context.close();
          }
        });

      if (CASES.has('height'))
        await t.test('390 px with 30 faces: page height in phone screens', async () => {
          const s = await open(browser, 390, true);
          await setFaces(s.page, 30);
          await settle(s.page);
          const height = await s.page.evaluate(() => document.scrollingElement!.scrollHeight);
          const one = await (async () => {
            await setFaces(s.page, 2);
            await settle(s.page);
            return s.page.evaluate(() => document.scrollingElement!.scrollHeight);
          })();
          record('height', {
            faces30: height,
            screens30: Math.round((height / 844) * 100) / 100,
            faces2: one,
            screens2: Math.round((one / 844) * 100) / 100,
          });
          assert.ok(height / 844 < 8, `30 faces take ${height / 844} screens`);
          await s.context.close();
        });

      if (CASES.has('admission'))
        await t.test('every admission path at 64 and 150 faces, batch OK included', async () => {
          const rows: Record<string, unknown>[] = [];
          const paths = [
            'insertion +',
            'Add face',
            'multi-file drop',
            'background drop',
            'batch OK',
            'paste into new face',
          ] as const;
          type Entry = (typeof paths)[number];
          type AdmissionWindow = Window & {
            __fmStore: import('../../src/controller/store.ts').Store;
            __admissionPhoto: Blob;
            __admissionBase: import('../../src/controller/state.ts').Input[];
            __admissionPasteBytes?: number;
          };
          record('admissionScope', {
            status: 'every entry path below',
            batch:
              'Several files open the batch view: the multi-file drop and a two-file pick through the face chooser are confirmed by operated picks and an operated OK; OK is the one admission check for every pick (a refused OK keeps the view and adds nothing).',
            paste:
              'An operated Add face first creates the empty 65th/151st target. Native paste fills that target; paste is not claimed to insert a face.',
            drops:
              'Real decodable image Files enter a DataTransfer drop event on the visible face/background; graded buttons use real pointer/touch.',
          });
          const snapshot = (page: Page) =>
            page.evaluate(() => {
              const s = (window as unknown as AdmissionWindow).__fmStore.getState();
              return {
                ids: s.Inputs.map((i) => i.id),
                inputs: s.Inputs.map((i) => ({
                  id: i.id,
                  mode: i.mode,
                  value: i.value,
                  bytes: i.file?.size ?? 0,
                })),
                checks: s.StillChecks?.size ?? 0,
              };
            });
          const preparePhoto = async (page: Page) =>
            page.evaluate(async () => {
              const response = await fetch('/preview/hello-1024.webp');
              if (!response.ok) throw Error('Usable photo fixture was not served');
              const bitmap = await createImageBitmap(await response.blob());
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
              bitmap.close();
              const photo = await canvas.convertToBlob({ type: 'image/png' });
              const decoded = await createImageBitmap(photo);
              if (decoded.width !== 1024 || decoded.height !== 1024)
                throw Error('Photo fixture did not decode');
              decoded.close();
              const w = window as unknown as AdmissionWindow;
              w.__admissionPhoto = photo;
              w.__admissionBase = [...w.__fmStore.getState().Inputs];
              document.addEventListener(
                'paste',
                (event) => {
                  w.__admissionPasteBytes = [...event.clipboardData!.items]
                    .filter((i) => i.kind === 'file')
                    .reduce((n, i) => n + (i.getAsFile()?.size ?? 0), 0);
                },
                { capture: true },
              );
              return { bytes: photo.size, width: canvas.width, height: canvas.height };
            });
          const add = async (s: Session) => {
            const before = (await faceList(s.page)).length;
            assert.ok(
              (
                await press(s.page, s.page.getByRole('button', { name: 'Add face', exact: true }), {
                  touch: s.touch,
                })
              ).inside,
            );
            await s.page.waitForFunction(
              (n) =>
                (window as unknown as AdmissionWindow).__fmStore.getState().Inputs.length === n,
              before + 1,
            );
          };
          const seed = async (
            s: Session,
            count: number,
            paste: boolean,
            sessionBudget: boolean,
          ) => {
            const { page } = s;
            await setFaces(page, count);
            const original = await faceList(page);
            if (paste) await add(s); // Explicit operated setup; the paste itself must not insert another face.
            const saved = await page.evaluate(() =>
              (window as unknown as AdmissionWindow).__fmStore
                .getState()
                .Inputs.map(({ id, mode, value }) => ({ id, mode, value, file: null })),
            );
            if (sessionBudget) {
              // Store a Blob directly: valueBytes counts precisely its size, without object-key overhead.
              await page.evaluate(
                (bytes) =>
                  new Promise<void>((resolve, reject) => {
                    const request = indexedDB.open('checkface-originals-v1', 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('originals');
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                      const db = request.result;
                      const tx = db.transaction('originals', 'readwrite');
                      tx.objectStore('originals').put(
                        new Blob([new Uint8Array(bytes)]),
                        'last-generated-session-v2',
                      );
                      tx.oncomplete = () => {
                        db.close();
                        resolve();
                      };
                      tx.onerror = () => {
                        db.close();
                        reject(tx.error);
                      };
                    };
                  }),
                SESSION_LIMIT + 1,
              );
              await page.reload();
              await page.waitForFunction(() => !!(window as unknown as AdmissionWindow).__fmStore);
              await page.waitForTimeout(1500); // Existing runner measures the actual IndexedDB record at startup.
              // Restore the exact controlled setup after reload, including the ID created by the operated Add.
              await page.evaluate((inputs) => {
                (window as unknown as AdmissionWindow).__fmStore.update((state) => ({
                  state: { ...state, Inputs: inputs },
                  effects: [],
                }));
              }, saved);
            }
            const fixture = await preparePhoto(page);
            return {
              original,
              fixture,
              target: paste ? saved.at(-1)!.id : saved[0]!.id,
              baseline: saved.length,
            };
          };
          const clipboard = async (page: Page) =>
            page.evaluate(async () => {
              const photo = (window as unknown as AdmissionWindow).__admissionPhoto;
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': photo })]);
              const item = (await navigator.clipboard.read())[0]!;
              return (await item.getType('image/png')).size;
            });
          const act = async (
            s: Session,
            path: Entry,
            count: number,
            target: string,
            refused = false,
          ) => {
            const { page } = s;
            if (path === 'insertion +') {
              await reach(s, count - 1);
              assert.ok(
                (
                  await press(
                    page,
                    page.getByRole('button', {
                      name: `Add a face after Face ${count}`,
                      exact: true,
                    }),
                    { touch: s.touch },
                  )
                ).inside,
              );
            } else if (path === 'Add face') {
              assert.ok(
                (
                  await press(page, page.getByRole('button', { name: 'Add face', exact: true }), {
                    touch: s.touch,
                  })
                ).inside,
              );
            } else if (path === 'paste into new face') {
              await reach(s, count);
              const field = page.locator(
                `section.next-face[data-next-face="${target}"] .next-field input`,
              );
              assert.ok((await press(page, field, { touch: s.touch })).inside);
              await page.keyboard.press('Control+V'); // Native clipboard input; no synthetic paste dispatch.
            } else if (path === 'batch OK') {
              // Over the stored-session budget the view cannot open: the two-file pick itself is refused.
              if (refused && sessionOver) await openBatch(s, target, false);
              else await confirmBatch(s);
            } else {
              const dt = await page.evaluateHandle(
                (n) => {
                  const transfer = new DataTransfer();
                  const photo = (window as unknown as AdmissionWindow).__admissionPhoto;
                  for (let i = 0; i < n; i++)
                    transfer.items.add(
                      new File([photo], `admission-${i}.png`, { type: 'image/png' }),
                    );
                  return transfer;
                },
                path === 'multi-file drop' ? 2 : 1,
              );
              try {
                const target =
                  path === 'multi-file drop'
                    ? await reach(s, 0).then(() => page.locator('section.next-face').first())
                    : page.locator('.next-tagline');
                await target.scrollIntoViewIfNeeded();
                await target.dispatchEvent('drop', { dataTransfer: dt });
              } finally {
                await dt.dispose();
              }
              // An admitted drop opens the batch view; a refused one opens nothing.
              if (path === 'multi-file drop' && !refused) await confirmBatch(s);
            }
          };
          /** Two files through the target face's own chooser open the batch view (setup: the file input). */
          let sessionOver = false;
          const openBatch = async (s: Session, target: string, view = true) => {
            const files = await s.page.evaluate(async () => {
              const photo = (window as unknown as AdmissionWindow).__admissionPhoto;
              return [...new Uint8Array(await photo.arrayBuffer())];
            });
            const buffer = Buffer.from(files);
            await s.page.locator(`#photo-${target}`).setInputFiles([
              { name: 'batch-0.png', mimeType: 'image/png', buffer },
              { name: 'batch-1.png', mimeType: 'image/png', buffer },
            ]);
            if (view) await s.page.locator('.next-batch [data-next-candidate="f1#0"]').waitFor();
          };
          /** Operated picks of both files in the batch view, then its operated OK. */
          const confirmBatch = async (s: Session) => {
            const { page } = s;
            for (const candidate of ['f0#0', 'f1#0']) {
              const control = page.locator(`.next-batch [data-next-candidate="${candidate}"]`);
              await control.waitFor();
              assert.ok((await press(page, control, { touch: s.touch })).inside, candidate);
            }
            assert.ok(
              (await press(page, page.locator('.next-batch-ok'), { touch: s.touch })).inside,
              'batch OK',
            );
          };
          const forcePhoto = async (page: Page, bytes: number, excluded: string | null) =>
            page.evaluate(
              async ({ bytes, excluded }) => {
                const w = window as unknown as AdmissionWindow;
                const eligible = w.__admissionBase.filter((i) => i.id !== excluded).slice(-7);
                const files = eligible.map((input, index) => {
                  const size =
                    Math.floor(bytes / eligible.length) +
                    (index === eligible.length - 1 ? bytes % eligible.length : 0);
                  return [
                    input.id,
                    new File(
                      [w.__admissionPhoto, new Uint8Array(size - w.__admissionPhoto.size)],
                      `retained-${index}.png`,
                      { type: 'image/png' },
                    ),
                  ] as const;
                });
                const decoded = await createImageBitmap(files[0]![1]);
                decoded.close();
                const byId = new Map(files);
                w.__fmStore.update((state) => ({
                  state: {
                    ...state,
                    Inputs: w.__admissionBase.map((input) =>
                      byId.has(input.id)
                        ? {
                            ...input,
                            mode: 'photo',
                            file: byId.get(input.id)!,
                            value: byId.get(input.id)!.name,
                          }
                        : input,
                    ),
                    RunInputs: [],
                    RunSettings: '',
                  },
                  effects: [],
                }));
                return files.reduce((sum, [, file]) => sum + file.size, 0);
              },
              { bytes, excluded },
            );
          for (const [width, touch] of (
            [
              [1280, false],
              [390, true],
            ] as const
          ).filter(([w]) => !ONLY_WIDTHS || ONLY_WIDTHS.includes(w))) {
            for (const count of [64, 150].filter((c) => !ONLY_COUNTS || ONLY_COUNTS.includes(c))) {
              for (const path of paths) {
                const s = await open(browser, width, touch);
                try {
                  const setup = await seed(s, count, path === 'paste into new face', false);
                  if (path === 'paste into new face') await clipboard(s.page);
                  if (path === 'batch OK') await openBatch(s, setup.target);
                  await act(s, path, count, setup.target);
                  await s.page.waitForFunction(
                    (n) =>
                      (window as unknown as AdmissionWindow).__fmStore.getState().Inputs.length ===
                      n,
                    count + 1,
                  );
                  if (path === 'paste into new face') {
                    await s.page.locator('.next-encode-ok').waitFor();
                    assert.ok(
                      (await press(s.page, s.page.locator('.next-encode-ok'), { touch })).inside,
                    );
                    await s.page.waitForFunction(
                      (id) =>
                        (window as unknown as AdmissionWindow).__fmStore
                          .getState()
                          .Inputs.some((i) => i.id === id && i.mode === 'photo' && !!i.file),
                      setup.target,
                    );
                  } else if (path.includes('drop') || path === 'batch OK')
                    await s.page.locator('.next-encode-dialog').waitFor();
                  const after = await faceList(s.page);
                  const batched = path === 'multi-file drop' || path === 'batch OK';
                  assert.deepEqual(
                    after
                      .map((i) => i.id)
                      .filter((id) => setup.original.some((old) => old.id === id)),
                    setup.original.map((i) => i.id),
                    'original face order is preserved',
                  );
                  if (batched)
                    assert.equal(
                      after.findIndex((i) => i.id === setup.target) + 1,
                      after.findIndex((i) => !setup.original.some((old) => old.id === i.id)),
                      'the second pick lands right after the originating face',
                    );
                  else
                    assert.deepEqual(
                      after.slice(0, count).map((i) => i.id),
                      setup.original.map((i) => i.id),
                      'the new face is added after the originals',
                    );
                  assert.equal(after.length, count + 1);
                  assert.equal(new Set(after.map((i) => i.id)).size, after.length);
                  assert.deepEqual(
                    (await faceTrace(s.page)).filter((e) => e.type === 'admissionRefused'),
                    [],
                  );
                  assert.deepEqual(s.errors, []);
                  rows.push({
                    width,
                    count,
                    path,
                    outcome: 'admitted',
                    before: count,
                    after: after.length,
                    originalIds: setup.original.map((i) => i.id),
                    newIds: after
                      .filter((i) => !setup.original.some((old) => old.id === i.id))
                      .map((i) => i.id),
                    fixture: setup.fixture,
                    pasteSetup:
                      path === 'paste into new face'
                        ? 'operated Add face created the target before native paste; paste inserted zero additional faces'
                        : undefined,
                  });
                  await s.page.screenshot({
                    path: join(
                      results,
                      `admission-ok-${count}-${width}-${paths.indexOf(path)}.png`,
                    ),
                  });
                  record('admission', rows);
                } finally {
                  await s.context.close();
                }
              }
              for (const budget of [
                'BATCH_RETAINED_INPUT_BYTES',
                'STORED_SESSION_BYTES',
              ] as const) {
                // Share a refusal context only where no modal/new target changes the baseline.
                for (const group of [
                  paths.filter((p) => p !== 'batch OK' && p !== 'paste into new face'),
                  ['batch OK'] as const,
                  ['paste into new face'] as const,
                ]) {
                  const s = await open(browser, width, touch);
                  try {
                    const paste = group[0] === 'paste into new face';
                    const setup = await seed(s, count, paste, budget === 'STORED_SESSION_BYTES');
                    const pasteBytes = paste ? await clipboard(s.page) : 0;
                    for (const path of group) {
                      // The view opens within the photo budget, which is then forced one over for OK itself.
                      sessionOver = budget === 'STORED_SESSION_BYTES';
                      if (path === 'batch OK' && !sessionOver) await openBatch(s, setup.target);
                      const incoming =
                        path === 'multi-file drop' || path === 'batch OK'
                          ? setup.fixture.bytes * 2
                          : path === 'background drop'
                            ? setup.fixture.bytes
                            : path === 'paste into new face'
                              ? pasteBytes
                              : 0;
                      const retained =
                        budget === 'BATCH_RETAINED_INPUT_BYTES'
                          ? await forcePhoto(
                              s.page,
                              PHOTO_LIMIT + 1 - incoming,
                              path === 'multi-file drop' || path === 'batch OK' || paste
                                ? setup.target
                                : null,
                            )
                          : 0;
                      const before = await snapshot(s.page);
                      const traced = (await faceTrace(s.page)).filter(
                        (e) => e.type === 'admissionRefused',
                      ).length;
                      await act(s, path, count, setup.target, true);
                      await s.page.waitForFunction(
                        (n) =>
                          (
                            window as unknown as { __FACEMORPH_FACE_TRACE__: { type: string }[] }
                          ).__FACEMORPH_FACE_TRACE__.filter((e) => e.type === 'admissionRefused')
                            .length > n,
                        traced,
                      );
                      const refusals = (await faceTrace(s.page))
                        .filter((e) => e.type === 'admissionRefused')
                        .slice(traced);
                      assert.deepEqual(
                        refusals.map((e) => e.id),
                        [budget],
                        'exactly one named refusal, before any partial insertion',
                      );
                      assert.deepEqual(
                        await snapshot(s.page),
                        before,
                        'all face IDs/content/retained files and pending classifications unchanged',
                      );
                      const message = (
                        path === 'batch OK' && !sessionOver
                          ? await s.page.locator('.next-batch-refused').innerText()
                          : await s.page.locator('.next-morph-slot .next-status').innerText()
                      ).trim();
                      const expected =
                        budget === 'BATCH_RETAINED_INPUT_BYTES'
                          ? 'Not added: photos for your faces can use at most 128 MB, and this would go over it. Choose fewer or smaller photos, or remove a photo face.'
                          : 'Not added: a saved session can hold at most 32 MB, and this would go over it. Remove some faces first.';
                      assert.equal(message, expected);
                      const actualPaste = paste
                        ? await s.page.evaluate(
                            () => (window as unknown as AdmissionWindow).__admissionPasteBytes,
                          )
                        : 0;
                      if (paste)
                        assert.equal(
                          actualPaste,
                          pasteBytes,
                          'native paste delivered the normalized real PNG bytes',
                        );
                      if (budget === 'BATCH_RETAINED_INPUT_BYTES')
                        assert.equal(retained + incoming, PHOTO_LIMIT + 1);
                      rows.push({
                        width,
                        count,
                        path,
                        outcome: 'refused',
                        refusedAt:
                          path === 'batch OK'
                            ? sessionOver
                              ? 'the two-file pick: the view cannot open over the session budget'
                              : 'the operated batch OK'
                            : undefined,
                        budget,
                        baselineFaces: setup.baseline,
                        after: before.ids.length,
                        requestedBytes:
                          budget === 'BATCH_RETAINED_INPUT_BYTES'
                            ? retained + incoming
                            : SESSION_LIMIT + 1,
                        retainedBytes: retained,
                        incomingBytes: incoming,
                        message,
                        trace: refusals,
                        pasteSetup: paste
                          ? 'operated Add face created empty target before the budget was forced; native paste added/changed nothing'
                          : undefined,
                      });
                      await s.page.screenshot({
                        path: join(
                          results,
                          `admission-no-${budget}-${count}-${width}-${paths.indexOf(path)}.png`,
                        ),
                      });
                      record('admission', rows);
                    }
                    assert.deepEqual(s.models, [], 'no model asset request for a refused entry');
                    assert.deepEqual(s.errors, []);
                  } finally {
                    await s.context.close();
                  }
                }
              }
            }
          }
          t.diagnostic(
            'Every entry path graded with real image/clipboard bytes and operated controls, the batch view OK included.',
          );
        });

      if (CASES.has('start-over-generated'))
        await t.test(
          'Start over and Undo preserve real generated pixels without inference',
          async () => {
            const s = await open(browser, 1280, false);
            const { page } = s;
            try {
              await setFaces(page, 3);
              const initial = await faceList(page);
              // Setup only: leave the third face empty; both other results below are real inference.
              await page.evaluate((id) => {
                const store = (window as unknown as { __fmStore: { dispatch(m: unknown): void } })
                  .__fmStore;
                store.dispatch({ type: 'Mode', args: [id, 'text'] });
                store.dispatch({ type: 'Edit', args: [id, ''] });
              }, initial[2]!.id);
              const before = await faceList(page);
              const pixels = async (id: string) => {
                await page.waitForFunction(
                  (faceId) => {
                    const canvas = document.querySelector(
                      `[data-next-face="${faceId}"] canvas.next-face-img`,
                    );
                    return (
                      canvas instanceof HTMLCanvasElement && canvas.dataset.faceDrawn === 'true'
                    );
                  },
                  id,
                  { timeout: 600_000 },
                );
                return page.evaluate(async (faceId) => {
                  const canvas = document.querySelector(
                    `[data-next-face="${faceId}"] canvas.next-face-img`,
                  ) as HTMLCanvasElement;
                  const rgba = canvas
                    .getContext('2d')!
                    .getImageData(0, 0, canvas.width, canvas.height).data;
                  const digest = await crypto.subtle.digest('SHA-256', rgba);
                  return {
                    width: canvas.width,
                    height: canvas.height,
                    sha256: Array.from(new Uint8Array(digest), (byte) =>
                      byte.toString(16).padStart(2, '0'),
                    ).join(''),
                  };
                }, id);
              };
              const operations = () =>
                page.evaluate(() =>
                  (
                    globalThis as unknown as { __FACEMORPH_OPCTL_TRACE__: { type: string }[] }
                  ).__FACEMORPH_OPCTL_TRACE__.filter(
                    (event) => event.type === 'request' || event.type === 'started',
                  ),
                );
              const originals = [];
              for (const face of before.slice(0, 2)) {
                const tile = page.locator(`[data-next-face="${face.id}"]`);
                assert.ok((await press(page, tile.locator('.next-face-operation'))).inside);
                const accept = page.locator('.next-download-accept');
                if (
                  await accept.waitFor({ timeout: 8000 }).then(
                    () => true,
                    () => false,
                  )
                )
                  assert.ok((await press(page, accept)).inside);
                const painted = await pixels(face.id);
                assert.equal(painted.width, 1024);
                assert.equal(painted.height, 1024);
                await page.waitForFunction(
                  () => {
                    const trace = (
                      globalThis as unknown as {
                        __FACEMORPH_OPCTL_TRACE__: { type: string; requestId?: string }[];
                      }
                    ).__FACEMORPH_OPCTL_TRACE__;
                    const latest = trace.filter((event) => event.type === 'request').at(-1);
                    return (
                      latest &&
                      trace.some(
                        (event) => event.type === 'settled' && event.requestId === latest.requestId,
                      )
                    );
                  },
                  null,
                  { timeout: 600_000 },
                );
                originals.push({ id: face.id, ...painted });
              }
              const opsBefore = await operations(),
                modelRequestsBefore = s.models.length;
              const traceBefore = (await faceTrace(page)).length;
              const more = page.getByRole('button', { name: 'More options' });
              if ((await more.getAttribute('aria-expanded')) !== 'true')
                assert.ok((await press(page, more)).inside);
              assert.ok(
                (await press(page, page.getByRole('button', { name: 'Start over', exact: true })))
                  .inside,
              );
              await page.waitForFunction(
                () => document.querySelectorAll('section.next-face').length === 2,
              );
              const cleared = await faceList(page);
              assert.deepEqual(
                cleared.map(({ mode, value }) => [mode, value]),
                [
                  ['text', ''],
                  ['text', ''],
                ],
              );
              assert.ok(cleared.every((face) => !before.some((old) => old.id === face.id)));
              assert.ok(
                (await press(page, page.locator('[data-next-undo-notice] .next-undo'))).inside,
              );
              await page.waitForFunction(
                () => document.querySelectorAll('section.next-face').length === 3,
              );
              assert.deepEqual(
                await faceList(page),
                before,
                'every original input returns in its original order',
              );
              const restored = [];
              for (const face of originals)
                restored.push({ id: face.id, ...(await pixels(face.id)) });
              record('start-over-generated', {
                before,
                cleared,
                originals,
                restored,
                opsBefore,
                opsAfter: await operations(),
                modelRequestsBefore,
                modelRequestsAfter: s.models.length,
              });
              assert.deepEqual(
                restored,
                originals,
                'Start over -> Undo preserves exact generated RGBA pixels',
              );
              assert.deepEqual(
                await operations(),
                opsBefore,
                'Start over -> Undo performs no inference',
              );
              assert.equal(s.models.length, modelRequestsBefore, 'Undo acquires no model bytes');
              assert.deepEqual(
                (await faceTrace(page))
                  .slice(traceBefore)
                  .filter((event) => event.type === 'invalidateFace'),
                [],
                'Undo does not invalidate any hidden face',
              );
              assert.deepEqual(s.errors, []);
              await page.screenshot({ path: join(results, 'start-over-generated.png') });
            } finally {
              await s.context.close();
            }
          },
        );

      if (CASES.has('one-face-generate'))
        await t.test('one remaining face: operated numeric Generate and Save on CPU', async () => {
          type SeedWindow = Window & {
            __fmStore: import('../../src/controller/store.ts').Store;
            __FACEMORPH_OPCTL_TRACE__: {
              type: string;
              kind?: string;
              provider?: string;
              outcome?: string;
              requestId?: string;
              inputs?: { slot: string; mode: string }[];
            }[];
          };
          const rows: Record<string, unknown>[] = [];
          for (const [width, touch] of (
            [
              [1280, false],
              [390, true],
            ] as const
          ).filter(([w]) => !ONLY_WIDTHS || ONLY_WIDTHS.includes(w))) {
            const s = await open(browser, width, touch);
            const { page } = s;
            const operated: Record<string, unknown>[] = [];
            const hit = async (label: string, control: Locator) => {
              const landed = await press(page, control, { touch });
              assert.ok(landed.inside, label);
              operated.push({ control: label, ...landed });
              record('one-face-generate-progress', { width, touch, operated });
            };
            await s.context.tracing.start({ screenshots: true, snapshots: false, sources: false });
            try {
              const before = await setFaces(page, 2); // Input setup only; all graded actions below use real input.
              const id = before[0]!.id;
              const tile = page.locator(`section.next-face[data-next-face="${id}"]`);
              const timeOrigin = await page.evaluate(() => performance.timeOrigin);
              await hit(
                'Remove second face',
                page.locator(`[data-next-face="${before[1]!.id}"] .next-face-close`),
              );
              await page.waitForFunction(
                () => document.querySelectorAll('section.next-face').length === 1,
              );
              const checkOne = async () => {
                assert.deepEqual(
                  (await faceList(page)).map((face) => face.id),
                  [id],
                );
                assert.equal(await page.locator('.next-face-close').count(), 0);
                assert.match(await page.locator('.next-last-face-note').innerText(), /only face/);
                assert.ok(await page.locator('.next-primary-action').isDisabled());
                assert.match(await page.locator('.next-morph-reason').innerText(), /second face/);
              };
              await checkOne();
              await hit(
                'Change mode',
                tile.getByRole('button', { name: 'Change mode', exact: true }),
              );
              await hit(
                'Numeric seed',
                page.getByRole('menuitem', { name: 'Numeric seed', exact: true }),
              );
              const field = tile.locator('.next-field input[inputmode=numeric]');
              await field.waitFor();
              await hit('Focus numeric seed', field);
              await page.keyboard.press('ControlOrMeta+A');
              await page.keyboard.type('7003'); // Native key events; no controller edit or fill replacement.
              assert.equal(await field.inputValue(), '7003');
              assert.deepEqual(await faceList(page), [{ id, mode: 'seed', value: '7003' }]);
              assert.deepEqual(s.models, [], 'typing a seed acquires no model');
              await page.screenshot({
                path: join(results, `one-face-generate-${width}-before.png`),
              });
              const generate = tile.locator('.next-face-operation');
              assert.equal((await generate.textContent())?.trim(), 'Generate');
              await hit('Generate', generate);
              const accept = page.locator('.next-download-accept');
              await accept.waitFor({ timeout: 15_000 });
              assert.deepEqual(s.models, [], 'cold CPU models wait for actual consent');
              const disclosure = await page.locator('.next-download-dialog').innerText();
              await hit('Approve CPU model download', accept);
              await page.waitForFunction(
                () => {
                  const w = window as unknown as SeedWindow;
                  return (
                    !!w.__fmStore.getState().Error ||
                    w.__FACEMORPH_OPCTL_TRACE__.some((event) => event.type === 'settled')
                  );
                },
                null,
                { timeout: 600_000 },
              );
              await page.waitForFunction(
                () => !(window as unknown as SeedWindow).__fmStore.getState().Busy,
              );
              const generated = await page.evaluate(() => {
                const w = window as unknown as SeedWindow;
                const state = w.__fmStore.getState();
                return {
                  error: state.Error,
                  faces: state.Faces.map((face) => face.id),
                  trace: w.__FACEMORPH_OPCTL_TRACE__,
                };
              });
              record('one-face-generate-operation', { width, ...generated });
              assert.equal(generated.error, null);
              assert.deepEqual(generated.faces, [id]);
              const requests = generated.trace.filter((event) => event.type === 'request');
              assert.equal(requests.length, 1, 'one explicit Generate runs once');
              assert.equal(requests[0]!.kind, 'face');
              assert.deepEqual(
                requests[0]!.inputs?.map(({ slot, mode }) => ({ slot, mode })),
                [{ slot: id, mode: 'seed' }],
              );
              assert.deepEqual(
                generated.trace
                  .filter((event) => event.type === 'settled')
                  .map((event) => event.outcome),
                ['completed'],
              );
              assert.equal(
                generated.trace.filter((event) => event.type === 'compute-ready').length,
                1,
              );
              assert.equal(
                generated.trace.filter((event) => event.type === 'file-ready').length,
                1,
              );
              assert.ok(
                generated.trace.some(
                  (event) => event.type === 'provider-actual' && event.provider === 'cpu',
                ),
              );
              await page.waitForFunction((id) => {
                const image = document.querySelector(`[data-next-face="${id}"] .next-face-img`);
                return image instanceof HTMLCanvasElement
                  ? image.dataset.faceDrawn === 'true'
                  : image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
              }, id);
              await checkOne();
              const save = tile.getByRole('button', { name: 'Save image', exact: true });
              await page.waitForFunction(
                (id) =>
                  [...document.querySelectorAll(`[data-next-face="${id}"] button`)].some(
                    (button) =>
                      button instanceof HTMLButtonElement &&
                      button.textContent?.trim() === 'Save image' &&
                      !button.disabled,
                  ),
                id,
              );
              const downloading = page.waitForEvent('download', { timeout: 60_000 });
              await hit('Save generated image', save);
              const download = await downloading;
              assert.equal(await download.failure(), null);
              const saved = join(
                results,
                `one-face-generate-${width}-${download.suggestedFilename()}`,
              );
              await download.saveAs(saved);
              const bytes = new Uint8Array(readFileSync(saved));
              const recovered = readStill(bytes);
              assert.ok(recovered, 'the actual exported file has verified recovery');
              assert.equal(recovered.schemaVersion, 3);
              assert.equal(recovered.generationKind, 'seed');
              assert.equal(recovered.seed, 7003, 'export preserves the natively typed seed');
              assert.deepEqual(recovered.latent.shape, [18, 512]);
              assert.ok(recovered.latent.values.every(Number.isFinite));
              assert.ok(recovered.latent.values.some((value) => value !== 0));
              assert.equal(recovered.provenance.route, 'cpu');
              assert.equal(recovered.provenance.provider, 'wasm');
              assert.ok(
                typeMatchesBytes(bytes, {
                  mime: recovered.mime,
                  filename: download.suggestedFilename(),
                }),
              );
              const decoded = await page.evaluate(async (bytes) => {
                const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
                const size = { width: bitmap.width, height: bitmap.height };
                bitmap.close();
                return size;
              }, Array.from(bytes));
              assert.deepEqual(decoded, { width: 1024, height: 1024 });
              await checkOne();
              assert.equal(
                await page.evaluate(() => performance.timeOrigin),
                timeOrigin,
                'Generate/Save preserves the actual document',
              );
              assert.deepEqual(s.errors, []);
              rows.push({
                width,
                touch,
                artifact: runTag,
                before,
                after: await faceList(page),
                disclosure,
                operated,
                generated,
                modelRequests: s.models,
                documentTimeOrigin: timeOrigin,
                saved: {
                  path: saved,
                  bytes: bytes.length,
                  sha256: createHash('sha256').update(bytes).digest('hex'),
                  ...decoded,
                  schemaVersion: recovered.schemaVersion,
                  generationKind: recovered.generationKind,
                  seed: recovered.seed,
                  imageSha256: recovered.imageSha256,
                  latentSha256: recovered.latentSha256,
                  provenance: recovered.provenance,
                },
                errors: s.errors,
              });
              record('one-face-generate', rows);
              await page.screenshot({
                path: join(results, `one-face-generate-${width}-saved.png`),
              });
            } catch (error) {
              record('one-face-generate-failure', {
                width,
                message: String(error),
                errors: s.errors,
              });
              await page
                .screenshot({ path: join(results, `one-face-generate-${width}-failure.png`) })
                .catch(() => {});
              throw error;
            } finally {
              try {
                await s.context.tracing.stop({
                  path: join(results, `one-face-generate-${width}.zip`),
                });
              } finally {
                await s.context.close();
              }
            }
          }
        });

      if (CASES.has('one-face-encode'))
        await t.test(
          'one remaining face: operated Encode image, real CPU inference and Save',
          async () => {
            type OperationEvent = {
              type: string;
              requestId?: string;
              attemptId?: string;
              kind?: string;
              outcome?: string;
              provider?: string;
              inputs?: { slot: string; mode: string }[];
            };
            type PhotoWindow = Window & {
              __fmStore: import('../../src/controller/store.ts').Store;
              __FACEMORPH_OPCTL_TRACE__: OperationEvent[];
            };
            const fixture = join(REPO, 'tests/crop/fixtures/non-square.jpg');
            const source = readFileSync(fixture);
            const rows: Record<string, unknown>[] = [];
            record('one-face-encode-source', {
              artifact: out,
              deploySource: artifact.identity.deploySource,
              fixture,
              bytes: source.length,
              sha256: createHash('sha256').update(source).digest('hex'),
              note: 'Existing JPEG fixture derived from the shipped generated hello face; no personal photo.',
            });
            for (const [width, touch] of (
              [
                [1280, false],
                [390, true],
              ] as const
            ).filter(([w]) => !ONLY_WIDTHS || ONLY_WIDTHS.includes(w))) {
              const s = await open(browser, width, touch);
              const { page } = s;
              const operated: Record<string, unknown>[] = [];
              const diagnostics: Record<string, unknown>[] = [];
              page.on('console', (message) => {
                if (['error', 'warning'].includes(message.type()))
                  diagnostics.push({ type: message.type(), text: message.text() });
              });
              page.on('response', (response) => {
                if (response.status() >= 400)
                  diagnostics.push({ status: response.status(), url: response.url() });
              });
              page.on('requestfailed', (request) =>
                diagnostics.push({ url: request.url(), failure: request.failure() }),
              );
              const hit = async (label: string, control: Locator) => {
                const landed = await press(page, control, { touch });
                assert.ok(landed.inside, label);
                operated.push({ control: label, ...landed });
                record('one-face-encode-progress', { width, touch, operated });
              };
              await s.context.tracing.start({
                screenshots: true,
                snapshots: false,
                sources: false,
              });
              try {
                const before = await setFaces(page, 2); // Input fixture only; removal and encoding below are operated.
                const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
                await hit(
                  'Remove second face',
                  page.locator(`[data-next-face="${before[1]!.id}"] .next-face-close`),
                );
                await page.waitForFunction(
                  () => document.querySelectorAll('section.next-face').length === 1,
                );
                const only = before[0]!;
                const tile = page.locator(`section.next-face[data-next-face="${only.id}"]`);
                const oneFace = async () => {
                  assert.deepEqual(
                    (await faceList(page)).map(({ id }) => id),
                    [only.id],
                  );
                  assert.equal(
                    await page.locator('.next-face-close').count(),
                    0,
                    'last face has no Remove',
                  );
                  assert.match(await page.locator('.next-last-face-note').innerText(), /only face/);
                  assert.ok(
                    await page.locator('.next-primary-action').isDisabled(),
                    'one face: Create morph disabled',
                  );
                  assert.match(await page.locator('.next-morph-reason').innerText(), /second face/);
                };
                await oneFace();
                await page.screenshot({
                  path: join(results, `one-face-encode-${width}-before.png`),
                });
                await hit(
                  'Change mode',
                  tile.getByRole('button', { name: 'Change mode', exact: true }),
                );
                const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
                await entry.evaluate(async (element) => {
                  const panel = element.closest('.MuiPaper-root');
                  await Promise.allSettled(
                    (panel?.getAnimations({ subtree: true }) ?? []).map(
                      (animation) => animation.finished,
                    ),
                  );
                });
                const choosing = page.waitForEvent('filechooser');
                await hit('Encode image', entry);
                const chooser = await choosing;
                assert.equal(
                  await page.getByRole('dialog').count(),
                  0,
                  'Encode image opens its chooser directly',
                );
                assert.equal(
                  await chooser
                    .element()
                    .evaluate((element) =>
                      (element as Element)
                        .closest('[data-next-face]')
                        ?.getAttribute('data-next-face'),
                    ),
                  only.id,
                  'the chooser belongs to the remaining face',
                );
                await chooser.setFiles(fixture); // Real chooser input, not a controller/bridge replacement.
                const dialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
                await dialog.waitFor();
                await page.waitForFunction(() => {
                  const image = document.querySelector('.next-encode-preview img');
                  return (
                    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
                  );
                });
                const proposal = await page.evaluate(() => {
                  const w = window as unknown as PhotoWindow;
                  const image = document.querySelector(
                    '.next-encode-preview img',
                  ) as HTMLImageElement;
                  return {
                    owner: w.__fmStore.getState().Crop?.faceId,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  };
                });
                assert.equal(proposal.owner, only.id);
                assert.deepEqual(s.models, [], 'no model acquisition before crop confirmation');
                await page.screenshot({ path: join(results, `one-face-encode-${width}-crop.png`) });
                await hit(
                  'Confirm crop OK',
                  dialog.getByRole('button', { name: 'OK', exact: true }),
                );
                const accept = page.locator('.next-download-accept');
                await accept.waitFor({ timeout: 15_000 });
                assert.deepEqual(s.models, [], 'cold model acquisition waits for actual consent');
                const disclosure = await page.locator('.next-download-dialog').innerText();
                await hit('Approve model download', accept);
                const waitForSettlement = async (minimumRequests: number) => {
                  await page.waitForFunction(
                    ({ id, minimumRequests }) => {
                      const w = window as unknown as PhotoWindow;
                      const state = w.__fmStore.getState();
                      const requests = w.__FACEMORPH_OPCTL_TRACE__.filter(
                        (event) =>
                          event.type === 'request' &&
                          event.kind === 'face' &&
                          event.inputs?.some(
                            (input) => input.slot === id && input.mode === 'photo',
                          ),
                      );
                      const request =
                        requests.length >= minimumRequests ? requests.at(-1) : undefined;
                      return (
                        !!state.Error ||
                        (!!request &&
                          w.__FACEMORPH_OPCTL_TRACE__.some(
                            (event) =>
                              event.type === 'settled' && event.requestId === request.requestId,
                          ))
                      );
                    },
                    { id: only.id, minimumRequests },
                    { timeout: 600_000 },
                  );
                  await page.waitForFunction(
                    () => !(window as unknown as PhotoWindow).__fmStore.getState().Busy,
                    null,
                    { timeout: 30_000 },
                  );
                };
                await waitForSettlement(1);
                const revisedDisclosures: string[] = [];
                if (await accept.isVisible()) {
                  const discovered = [...s.models];
                  assert.equal(
                    discovered.length,
                    1,
                    'the initial failed attempt fetched only the descriptor',
                  );
                  assert.match(discovered[0]!, /\/encoder-stream\/.+\/manifest\.json$/);
                  revisedDisclosures.push(await page.locator('.next-download-dialog').innerText());
                  record('one-face-encode-revised-consent', {
                    width,
                    discovered,
                    revisedDisclosures,
                  });
                  await hit('Approve discovered encoder schedule', accept);
                  await waitForSettlement(2);
                  assert.equal(
                    await accept.isVisible(),
                    false,
                    'one revised decision covers the discovered schedule',
                  );
                }
                const encoded = await page.evaluate(() => {
                  const w = window as unknown as PhotoWindow;
                  const state = w.__fmStore.getState();
                  return {
                    error: state.Error,
                    status: state.Status,
                    gate: state.Gate,
                    stage: state.Stage,
                    inputs: state.Inputs.map(({ id, mode, value, file }) => ({
                      id,
                      mode,
                      value,
                      bytes: file?.size ?? 0,
                    })),
                    faces: state.Faces.map(({ id }) => id),
                    trace: w.__FACEMORPH_OPCTL_TRACE__,
                  };
                });
                record('one-face-encode-operation', {
                  width,
                  ...encoded,
                  modelRequests: s.models,
                  diagnostics,
                });
                assert.equal(encoded.error, null, 'real photo encode has no product error');
                assert.deepEqual(
                  encoded.inputs.map(({ id }) => id),
                  [only.id],
                );
                assert.equal(encoded.inputs[0]!.mode, 'photo');
                assert.ok(encoded.inputs[0]!.bytes > 0, 'confirmed photo remains installed');
                assert.deepEqual(
                  encoded.faces,
                  [only.id],
                  'CPU inference installed exactly the remaining face',
                );
                const requests = encoded.trace.filter((event) => event.type === 'request');
                assert.equal(
                  requests.length,
                  1 + revisedDisclosures.length,
                  'descriptor discovery plus one real face operation',
                );
                assert.equal(requests[0]!.inputs?.[0]?.mode, 'photo');
                assert.deepEqual(
                  encoded.trace
                    .filter((event) => event.type === 'settled')
                    .map((event) => event.outcome),
                  [...revisedDisclosures.map(() => 'failed'), 'completed'],
                );
                assert.equal(
                  encoded.trace.filter((event) => event.type === 'compute-ready').length,
                  1,
                );
                assert.equal(
                  encoded.trace.filter((event) => event.type === 'file-ready').length,
                  1,
                );
                assert.ok(
                  encoded.trace.some(
                    (event) => event.type === 'provider-actual' && event.provider === 'cpu',
                  ),
                  'actual CPU route, not a provider override',
                );
                await page.waitForFunction((id) => {
                  const image = document.querySelector(`[data-next-face="${id}"] .next-face-img`);
                  return image instanceof HTMLCanvasElement
                    ? image.dataset.faceDrawn === 'true'
                    : image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
                }, only.id);
                await oneFace();
                const save = tile.getByRole('button', { name: 'Save image', exact: true });
                await page.waitForFunction(
                  (id) =>
                    [...document.querySelectorAll(`[data-next-face="${id}"] button`)].some(
                      (button) =>
                        button instanceof HTMLButtonElement &&
                        button.textContent?.trim() === 'Save image' &&
                        !button.disabled,
                    ),
                  only.id,
                );
                const downloading = page.waitForEvent('download', { timeout: 60_000 });
                await hit('Save encoded image', save);
                const download = await downloading;
                assert.equal(await download.failure(), null);
                const saved = join(
                  results,
                  `one-face-encode-${width}-${download.suggestedFilename()}`,
                );
                await download.saveAs(saved);
                const bytes = new Uint8Array(readFileSync(saved));
                const recovered = readStill(bytes);
                assert.ok(recovered, 'saved file has verified recovery metadata');
                assert.equal(recovered.schemaVersion, 3);
                assert.equal(
                  recovered.generationKind,
                  'photo',
                  'export is the encoded photo result',
                );
                assert.deepEqual(recovered.latent.shape, [18, 512]);
                assert.ok(recovered.latent.values.every(Number.isFinite));
                assert.ok(recovered.latent.values.some((value) => value !== 0));
                assert.ok(
                  typeMatchesBytes(bytes, {
                    mime: recovered.mime,
                    filename: download.suggestedFilename(),
                  }),
                );
                const decoded = await page.evaluate(async (bytes) => {
                  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
                  const size = { width: bitmap.width, height: bitmap.height };
                  bitmap.close();
                  return size;
                }, Array.from(bytes));
                assert.deepEqual(decoded, { width: 1024, height: 1024 });
                await oneFace();
                assert.equal(
                  await page.evaluate(() => performance.timeOrigin),
                  documentTimeOrigin,
                  'the same document survives Remove/Encode/Save, including same-document history updates',
                );
                assert.deepEqual(s.errors, []);
                rows.push({
                  width,
                  touch,
                  before: before.map(({ id }) => id),
                  after: [only.id],
                  proposal,
                  disclosure,
                  revisedDisclosures,
                  operated,
                  encoded,
                  modelRequests: s.models,
                  saved: {
                    path: saved,
                    name: download.suggestedFilename(),
                    bytes: bytes.length,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                    ...decoded,
                    schemaVersion: recovered.schemaVersion,
                    generationKind: recovered.generationKind,
                    imageSha256: recovered.imageSha256,
                    latentSha256: recovered.latentSha256,
                  },
                  errors: s.errors,
                });
                record('one-face-encode', rows);
                await page.screenshot({
                  path: join(results, `one-face-encode-${width}-saved.png`),
                });
              } catch (error) {
                record('one-face-encode-failure', {
                  width,
                  message: String(error),
                  errors: s.errors,
                });
                await page
                  .screenshot({ path: join(results, `one-face-encode-${width}-failure.png`) })
                  .catch(() => {});
                throw error;
              } finally {
                await s.context.tracing.stop({
                  path: join(results, `one-face-encode-${width}.zip`),
                });
                await s.context.close();
              }
            }
          },
        );

      if (CASES.has('generate'))
        await t.test(
          'real inference: removing a generating face, the Undo window and one face left',
          async () => {
            const s = await open(browser, 1280, false);
            const { page } = s;
            const opctl = () =>
              page.evaluate(
                () =>
                  (globalThis as unknown as { __FACEMORPH_OPCTL_TRACE__: { type: string }[] })
                    .__FACEMORPH_OPCTL_TRACE__.length,
              );
            await setFaces(page, 3);
            const faces = await faceList(page);
            const tile = (id: string) => page.locator(`section.next-face[data-next-face="${id}"]`);
            const accept = async () => {
              const dialog = page.locator('.next-download-accept');
              if (
                await dialog.waitFor({ timeout: 8000 }).then(
                  () => true,
                  () => false,
                )
              )
                await press(page, dialog);
            };
            // Face 1 generates to completion (its result is what Undo must show again).
            await press(page, tile(faces[0]!.id).locator('.next-face-operation'));
            await accept();
            await page.waitForFunction(
              (id) =>
                document
                  .querySelector(`[data-next-face="${id}"]`)
                  ?.getAttribute('data-next-state') === 'filled',
              faces[0]!.id,
              { timeout: 600_000 },
            );
            const digest = async (id: string) => {
              // Filled is controller state; a restored canvas still awaits the retained file's decode.
              // Hash the painted result, never the newly mounted transparent canvas.
              await page.waitForFunction((faceId) => {
                const el = document.querySelector(`[data-next-face="${faceId}"] .next-face-img`);
                return el instanceof HTMLCanvasElement
                  ? el.dataset.faceDrawn === 'true'
                  : el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;
              }, id);
              return page.evaluate(async (faceId) => {
                const el = document.querySelector(`[data-next-face="${faceId}"] .next-face-img`) as
                  | HTMLImageElement
                  | HTMLCanvasElement
                  | null;
                if (!el) return null;
                const blob =
                  el instanceof HTMLCanvasElement
                    ? await new Promise<Blob>((r) => el.toBlob((b) => r(b!)))
                    : await (await fetch(el.src)).blob();
                const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                return [...new Uint8Array(hash)]
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('');
              }, id);
            };
            const resultDigest = await digest(faces[0]!.id);
            assert.ok(resultDigest);
            // Face 2 generating, face 3 queued behind it; Remove face 2 while it runs.
            await press(page, tile(faces[1]!.id).locator('.next-face-operation'));
            await press(page, tile(faces[2]!.id).locator('.next-face-operation'));
            await page.waitForFunction(
              (id) => !!document.querySelector(`[data-next-face="${id}"] .next-face-progress`),
              faces[1]!.id,
              { timeout: 120_000 },
            );
            const trace0 = (await faceTrace(page)).length;
            await press(page, tile(faces[1]!.id).locator('.next-face-close'));
            await page.waitForFunction(
              () => !!document.querySelector('[data-next-undo-notice] .next-undo'),
            );
            const during = (await faceTrace(page)).slice(trace0);
            assert.ok(
              during.some((e) => e.type === 'cancelSlot' && e.id === faces[1]!.id),
              'its owned work is cancelled',
            );
            assert.ok(
              !during.some((e) => e.type === 'invalidateFace'),
              'no invalidateFace while Undo is offered',
            );
            // The sibling continues and finishes; the removed face gets no late result.
            await page.waitForFunction(
              (id) =>
                document
                  .querySelector(`[data-next-face="${id}"]`)
                  ?.getAttribute('data-next-state') === 'filled',
              faces[2]!.id,
              { timeout: 600_000 },
            );
            // A filled face is compute-ready; the real file-ready/settled events can still follow.
            // End the sibling's operation before measuring whether Undo starts any new work.
            await page.waitForFunction(() => {
              const trace = (
                globalThis as unknown as {
                  __FACEMORPH_OPCTL_TRACE__: { type: string; requestId?: string }[];
                }
              ).__FACEMORPH_OPCTL_TRACE__;
              const latest = trace.filter((event) => event.type === 'request').at(-1);
              return (
                latest &&
                trace.some(
                  (event) => event.type === 'settled' && event.requestId === latest.requestId,
                )
              );
            });
            const opctlAt = await opctl();
            const modelsAt = s.models.length;
            // Undo is still open only if the sibling finished inside the window; otherwise the expiry is checked here.
            const stillOpen = await page.locator('[data-next-undo-notice] .next-undo').count();
            const traceNow = (await faceTrace(page)).slice(trace0);
            const lateInstalled = await page.evaluate(
              (id) =>
                (
                  window as unknown as { __fmStore: { getState(): { Faces: { id: string }[] } } }
                ).__fmStore
                  .getState()
                  .Faces.some((f) => f.id === id),
              faces[1]!.id,
            );
            assert.equal(lateInstalled, false, 'no late result installed for the removed face');
            record('generate-cancel', { stillOpen, trace: traceNow, siblingFinished: true });
            if (!stillOpen)
              assert.equal(
                traceNow.filter((e) => e.type === 'invalidateFace' && e.id === faces[1]!.id).length,
                1,
                'expiry: exactly one invalidateFace',
              );
            // The Undo window on a finished face: Remove face 1, Undo shows the same digest with zero inference.
            assert.equal(
              await digest(faces[0]!.id),
              resultDigest,
              'removing its sibling preserves the displayed pixels across the layout boundary',
            );
            const siblingDigest = await digest(faces[2]!.id);
            const t1 = (await faceTrace(page)).length;
            await press(page, tile(faces[0]!.id).locator('.next-face-close'));
            await page.waitForFunction(
              () => !!document.querySelector('[data-next-undo-notice] .next-undo'),
            );
            await press(page, page.locator('[data-next-undo-notice] .next-undo'));
            await page.waitForFunction(
              (id) =>
                document
                  .querySelector(`[data-next-face="${id}"]`)
                  ?.getAttribute('data-next-state') === 'filled',
              faces[0]!.id,
            );
            assert.equal(await digest(faces[0]!.id), resultDigest, 'Undo shows the same result');
            assert.equal(await digest(faces[2]!.id), siblingDigest, 'Undo preserves its sibling');
            assert.deepEqual(
              (await faceTrace(page)).slice(t1).filter((e) => e.type === 'invalidateFace'),
              [],
              'Undo: no invalidateFace',
            );
            assert.equal(s.models.length, modelsAt, 'Undo: no model request');
            const opctlAfterUndo = await opctl();
            assert.equal(opctlAfterUndo, opctlAt, 'Undo: no inference or operation dispatch');
            // Removed again; the next action (an edit of face 3) ends the notice with exactly one invalidateFace.
            const t2 = (await faceTrace(page)).length;
            await press(page, tile(faces[0]!.id).locator('.next-face-close'));
            await page.waitForFunction(
              () => !!document.querySelector('[data-next-undo-notice] .next-undo'),
            );
            const remainingField = tile(faces[2]!.id).locator('.next-field input');
            await press(page, remainingField);
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.insertText(faces[2]!.mode === 'seed' ? '7003' : 'replacing action');
            await page.waitForFunction(
              () => !document.querySelector('[data-next-undo-notice] .next-undo'),
            );
            assert.deepEqual(
              (await faceTrace(page))
                .slice(t2)
                .filter((e) => e.type === 'invalidateFace' && e.id === faces[0]!.id).length,
              1,
              'replacing action: exactly one invalidateFace',
            );
            record('generate-undo', {
              resultDigest,
              opctlAt,
              opctlAfterUndo,
              noInferenceOnUndo: opctlAfterUndo === opctlAt,
            });
            await page.screenshot({ path: join(results, 'generate-undo.png') });
            // Down to one face: no Remove and the reason; Create morph disabled with the second-face reason; Generate
            // and Save work.
            const left = await faceList(page);
            for (const f of left.slice(1)) {
              await press(page, tile(f.id).locator('.next-face-close'));
              await page.waitForFunction(
                (id) => !document.querySelector(`[data-next-face="${id}"]`),
                f.id,
              );
            }
            assert.equal(await page.locator('.next-face-close').count(), 0, 'one face: no Remove');
            assert.match(await page.locator('.next-last-face-note').innerText(), /only face/);
            assert.ok(
              await page.locator('.next-primary-action').isDisabled(),
              'Create morph disabled',
            );
            assert.match(await page.locator('.next-morph-reason').innerText(), /second face/);
            const only = (await faceList(page))[0]!;
            const operation = tile(only.id).locator('.next-face-operation');
            if (await operation.count()) {
              await press(page, operation);
              await accept();
              await page.waitForFunction(
                (id) =>
                  document
                    .querySelector(`[data-next-face="${id}"]`)
                    ?.getAttribute('data-next-state') === 'filled',
                only.id,
                { timeout: 600_000 },
              );
            }
            const download = page.waitForEvent('download', { timeout: 60_000 }).then(
              (d) => d.suggestedFilename(),
              () => null,
            );
            const save = tile(only.id).getByRole('button', { name: /^Save/ }).first();
            await page.waitForFunction((id) => {
              const buttons = document.querySelectorAll(`[data-next-face="${id}"] button`);
              return [...buttons].some(
                (button) =>
                  (button.textContent?.trim() ?? '').startsWith('Save') &&
                  button instanceof HTMLButtonElement &&
                  !button.disabled,
              );
            }, only.id);
            assert.ok((await press(page, save)).inside, 'Save pressed');
            const saved = await download;
            record('one-face', {
              generated: true,
              saved,
              encodeImage: await tile(only.id)
                .getByLabel(/Encode image|Open saved image/)
                .count(),
            });
            assert.ok(saved, 'Save produced a file');
            await page.screenshot({ path: join(results, 'one-face.png') });
            assert.deepEqual(s.errors, []);
            await s.context.close();
          },
        );
    } finally {
      record('failures', failures);
      for (const [page, session] of operatedSessions) {
        session.log.write(join(results, `operated-session-${session.id}.jsonl`));
        // Preserve unknown byte/status fields as null in the raw request receipt.
        // A bounded observation wait must never turn incomplete traffic into a zero-byte claim.
        writeFileSync(
          join(results, `operated-session-${session.id}-network.json`),
          JSON.stringify(session.log.record(page), null, 2),
        );
      }
      await browser.close();
      await site.stop();
    }
    assert.deepEqual(
      failures,
      [],
      `${failures.length} cell failures (test-results/face-many/evidence.json)`,
    );
  },
);
