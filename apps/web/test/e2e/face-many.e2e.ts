// face.many (fm-id4c): the many-face layout, Remove, Undo and Start over in the identified, composed application
// (build:next destination, real bridge and runtime bytes, Chromium on the CPU route). Faces are set up by controller
// fixture (support/face-fixture.ts); every graded control is pressed by real pointer or touch tap at its visible
// position after elementFromPoint shows it there (support/operate.ts). Screenshots in test-results/face-many/.
//
// Cases (FACE_MANY_CASES=matrix,dark,many,style,keyboard,virtual,height,admission,generate selects some):
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
//   admission 64 and 150 faces: insertion +, Add face, multi-file drop, drop on the page and paste onto a face
//             add a 65th/151st face (or replace, for paste); with the stored session or retained photo bytes
//             forced one over, each path shows the one message naming the limit, adds nothing, and is traced.
//   generate  real CPU inference: removing a generating face cancels it, a sibling finishes; the Undo window
//             makes no invalidateFace call and Undo shows the same result digest with no inference; expiry or a
//             replacing action makes exactly one; one face left: Generate and Save work, Create morph says why.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/face-many.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
import { press } from '../support/operate.ts';
import {
  STORE_HOOK,
  faceList,
  faceTrace,
  restoreFaces,
  setFaces,
} from '../support/face-fixture.ts';
import { builtBreakpoints, visualOrderProblems, type FocusStop } from '../verify/harness.ts';
import {
  FACE_MANY_COUNTS,
  FACE_MANY_TOUCH_BREAKPOINT,
  faceManyWidths,
} from '../verify/face-many.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/face-many');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
const CASES = new Set(
  (
    process.env['FACE_MANY_CASES'] ??
    'matrix,dark,many,style,keyboard,virtual,height,admission,generate'
  ).split(','),
);
const ONLY_WIDTHS = process.env['FACE_MANY_WIDTHS']?.split(',').map(Number);
const ONLY_COUNTS = process.env['FACE_MANY_COUNTS']?.split(',').map(Number);
const SESSION_LIMIT = 32 * 2 ** 20;
const PHOTO_LIMIT = 128 * 2 ** 20;
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
    return {
      scrollWidth: root.scrollWidth,
      innerWidth,
      height: root.scrollHeight,
      hidden: [...new Set(hidden)],
    };
  });

interface FaceBoxes {
  id: string;
  index: number;
  inView: boolean;
  hits: { image: boolean; field: boolean; action: boolean; remove: boolean | null };
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
        remove: null,
      };
      if (inView) {
        // The image's centre may be the empty-face prompt or the hint inside it: any element of the image box.
        face.hits = {
          image: centre(image),
          field: centre(field),
          action: action ? centre(action) : true,
          remove: close ? centre(close) : null,
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
            corners: touchWidth ? corners.every(([x, y]) => hit(close, x!, y!)) : true,
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
        await t.test('admission at 64 and 150 faces from every entry path', async () => {
          const rows: unknown[] = [];
          // `files` real PNG-headed files, together `bytes` long, as a drag-and-drop payload.
          const photoFiles = (page: Page, bytes: number, files: number) =>
            page.evaluateHandle(
              ([total, n]) => {
                const dt = new DataTransfer();
                const head = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
                for (let i = 0; i < n; i++) {
                  const size = Math.floor(total / n) + (i === n - 1 ? total % n : 0);
                  const body = new Uint8Array(Math.max(0, size - head.length));
                  dt.items.add(new File([head, body], `big-${i}.png`, { type: 'image/png' }));
                }
                return dt;
              },
              [bytes, files] as const,
            );
          for (const [width, touch] of [
            [1280, false],
            [390, true],
          ] as const)
            for (const count of [64, 150].filter((c) => !ONLY_COUNTS || ONLY_COUNTS.includes(c))) {
              // Admitted: each path adds the next face.
              {
                const s = await open(browser, width, touch);
                const { page } = s;
                await setFaces(page, count);
                const n = async () => (await faceList(page)).length;
                const plus = page.getByRole('button', { name: `Add a face after Face ${count}` });
                await reach(s, count - 1);
                assert.ok((await press(page, plus, { touch })).inside);
                await page.waitForFunction(
                  (k) =>
                    (
                      window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
                    ).__fmStore.getState().Inputs.length === k,
                  count + 1,
                );
                assert.ok(
                  (
                    await press(page, page.getByRole('button', { name: 'Add face', exact: true }), {
                      touch,
                    })
                  ).inside,
                );
                await page.waitForFunction(
                  (k) =>
                    (
                      window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
                    ).__fmStore.getState().Inputs.length === k,
                  count + 2,
                );
                rows.push({ width, count, plus: count + 1, addFace: count + 2, total: await n() });
                await s.context.close();
              }
              // Forced one over: the stored session holds 32 MB + 1 byte before the page starts.
              {
                const s = await open(browser, width, touch);
                const { page } = s;
                await page.evaluate(
                  (bytes) =>
                    new Promise<void>((done, fail) => {
                      const req = indexedDB.open('checkface-originals-v1', 1);
                      req.onupgradeneeded = () => req.result.createObjectStore('originals');
                      req.onsuccess = () => {
                        const tx = req.result.transaction('originals', 'readwrite');
                        tx.objectStore('originals').put(
                          { padding: new Blob([new Uint8Array(bytes)]) },
                          'last-generated-session-v2',
                        );
                        tx.oncomplete = () => done();
                        tx.onerror = () => fail(tx.error);
                      };
                    }),
                  SESSION_LIMIT + 1,
                );
                await page.reload();
                await page.locator('section.next-face').first().waitFor();
                await page.waitForTimeout(1500); // the runner measures the stored session at start
                // The budget is over, so no face can be added: they arrive by the arrival restore (setup).
                await restoreFaces(page, count);
                const status = page.locator('.next-morph-slot .next-status');
                const sessionMessage =
                  /^Not added: a saved session can hold at most 32 MB, and this would go over it\. Remove some faces first\.$/;
                const refusedBy = async (what: string, act: () => Promise<void>) => {
                  const traced = (await faceTrace(page)).filter(
                    (e) => e.type === 'admissionRefused',
                  ).length;
                  await act();
                  await page.waitForFunction(
                    (k) =>
                      (
                        window as unknown as { __FACEMORPH_FACE_TRACE__: { type: string }[] }
                      ).__FACEMORPH_FACE_TRACE__.filter((e) => e.type === 'admissionRefused')
                        .length > k,
                    traced,
                  );
                  assert.equal(
                    (await faceList(page)).length,
                    count,
                    `${width} ${count} ${what}: nothing added`,
                  );
                  assert.match(
                    (await status.innerText()).trim(),
                    sessionMessage,
                    `${width} ${count} ${what}: the message names the limit`,
                  );
                  rows.push({
                    width,
                    count,
                    forced: 'STORED_SESSION_BYTES',
                    path: what,
                    refused: true,
                  });
                };
                await reach(s, count - 1);
                await refusedBy('insertion +', async () => {
                  await press(
                    page,
                    page.getByRole('button', { name: `Add a face after Face ${count}` }),
                    { touch },
                  );
                });
                await refusedBy('Add face', async () => {
                  await press(page, page.getByRole('button', { name: 'Add face', exact: true }), {
                    touch,
                  });
                });
                const two = await photoFiles(page, 4000, 2);
                await refusedBy('multi-file drop onto a face', async () => {
                  await page
                    .locator('section.next-face')
                    .first()
                    .dispatchEvent('drop', { dataTransfer: two });
                });
                await refusedBy('drop on the page', async () => {
                  await page.locator('.next-product').dispatchEvent('drop', { dataTransfer: two });
                });
                const one = await photoFiles(page, 2000, 1);
                await refusedBy('one photo dropped onto a face (pick/paste path)', async () => {
                  await page
                    .locator('section.next-face')
                    .first()
                    .dispatchEvent('drop', { dataTransfer: one });
                });
                await page.screenshot({
                  path: join(results, `admission-session-${count}-${width}.png`),
                });
                await s.context.close();
              }
              // Forced one over: retained photo-input bytes, 128 MB + 1 byte in one drop.
              {
                const s = await open(browser, width, touch);
                const { page } = s;
                await setFaces(page, count);
                const dt = await photoFiles(page, PHOTO_LIMIT + 1, 2);
                const photoMessage =
                  /^Not added: photos for your faces can use at most 128 MB, and this would go over it\. Choose fewer or smaller photos, or remove a photo face\.$/;
                for (const [what, target] of [
                  ['drop on the page', '.next-product'],
                  ['multi-file drop onto a face', 'section.next-face >> nth=0'],
                ] as const) {
                  await page.locator(target).dispatchEvent('drop', { dataTransfer: dt });
                  await page.waitForFunction(() =>
                    /Not added: photos/.test(
                      document.querySelector('.next-morph-slot .next-status')?.textContent ?? '',
                    ),
                  );
                  assert.equal((await faceList(page)).length, count, `${what}: nothing added`);
                  assert.match(
                    (await page.locator('.next-morph-slot .next-status').innerText()).trim(),
                    photoMessage,
                  );
                  rows.push({
                    width,
                    count,
                    forced: 'BATCH_RETAINED_INPUT_BYTES',
                    path: what,
                    refused: true,
                  });
                }
                assert.ok(
                  (await faceTrace(page)).some(
                    (e) => e.type === 'admissionRefused' && e.id === 'BATCH_RETAINED_INPUT_BYTES',
                  ),
                  'refusal traced',
                );
                assert.deepEqual(s.models, [], 'no model request for a refused drop');
                await s.context.close();
              }
              record('admission', rows);
            }
        });

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
            const digest = (id: string) =>
              page.evaluate(async (faceId) => {
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
            assert.deepEqual(
              (await faceTrace(page)).slice(t1).filter((e) => e.type === 'invalidateFace'),
              [],
              'Undo: no invalidateFace',
            );
            assert.equal(s.models.length, modelsAt, 'Undo: no model request');
            const opctlAfterUndo = await opctl();
            // Removed again; the next action (an edit of face 3) ends the notice with exactly one invalidateFace.
            const t2 = (await faceTrace(page)).length;
            await press(page, tile(faces[0]!.id).locator('.next-face-close'));
            await page.waitForFunction(
              () => !!document.querySelector('[data-next-undo-notice] .next-undo'),
            );
            await page.evaluate(
              (id) =>
                (
                  window as unknown as { __fmStore: { dispatch(m: unknown): void } }
                ).__fmStore.dispatch({ type: 'Edit', args: [id, 'replacing action'] }),
              faces[2]!.id,
            );
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
