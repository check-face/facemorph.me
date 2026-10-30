// face.blend-view (fm-2kse): the blend view in the identified, composed application (build:next destination, real
// bridge and runtime bytes, Chromium on the CPU route). Every graded control is pressed by real pointer or touch at
// its visible position after elementFromPoint shows it there (support/operate.ts); sliders are dragged with the
// real mouse or real touch events. Store dispatches are setup only (slot counts, field values for layout checks).
// Screenshots per case are in test-results/blend/.
//
// Cases (BLEND_CASES=run,counts,layout selects some):
//   run     1280 mouse and 390 touch: open by Blend faces (More options) and by `#blend`, Back to morph and browser
//           Back; fill three slots (typed words, a picked name, a crop-confirmed photo encoded on CPU); Blend asks
//           the existing download question, then shows the result with Save. Drag a weight: no blend request
//           during the drag, exactly one per release, "Updating…" with Save off until the new file; two quick
//           keyboard steps: the newer supersedes. Reset 1/N, the sum line and operated Make it 1, Shuffle weights
//           (one regeneration). An injected failure offers Retry in the result's area. Reload restores slots and
//           weights; the footer Privacy link and Back with the names picker open keep the view; leaving cancels a
//           pending blend while a slot photo encode keeps running.
//   output  1280 mouse and 390 touch: blend two faces; Add to morph puts "Blend of 2 faces" at the end of the morph
//           row with no model request; Save as PNG writes the full 1024 x 1024 frame named blend-2-faces… with its
//           recipe (slot kinds, latent digests, weights; no typed words); Back to morph shows the new face; the saved
//           PNG opened on a face is recovered with no model request; Blend faces returns to the view intact.
//   counts  1, 2, 3, 8, 16, 40 and 100 slots at 1280 and 390: the slot panel scrolls inside itself, the result box
//           stays in the viewport after scrolling to the last slot, compact rows (thumbnail, field, weight), every
//           weight slider and Remove hit by elementFromPoint at their centres, no horizontal page scroll; at 100:
//           sum line, Reset and Make it 1 operated, and exactly one blend synthesis per release.
//   layout  3 and 16 slots at every sweep width: result on the right with 2-4 slot columns on desktop, pinned at
//           the top with one column on phones; no horizontal page scroll and no clipped control.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/blend.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { STORE_HOOK } from '../support/face-fixture.ts';
import { SWEEP_WIDTHS } from '../verify/harness.ts';
import { readRecovery } from 'stylegan-js';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/blend');
const CASES = new Set((process.env['BLEND_CASES'] ?? 'run,output,counts,layout').split(','));
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
const PHOTO = join(REPO, 'tests/crop/fixtures/non-square.jpg');
const COUNTS = [1, 2, 3, 8, 16, 40, 100] as const;

type Trace = { type: string; requestId?: string; kind?: string; outcome?: string }[];
type Slot = { input: { id: string; mode: string; value: string }; weight: number };
type BlendModel = {
  slots: Slot[];
  faces: { id: string }[];
  running: number | null;
  error: string;
  revision: number;
};
type W = Window & {
  __fmStore: {
    getState(): {
      Blend?: BlendModel;
      Inputs: { id: string; value: string }[];
      Busy: boolean;
      Browse: string | null;
    };
    dispatch(m: { type: string; args: unknown[] }): void;
  };
  __FACEMORPH_OPCTL_TRACE__: Trace;
};

const TRACE_HOOK = `window.__FACEMORPH_OPCTL_TRACE__ = [];`;

async function newPage(browser: Browser, width: number, touch: boolean) {
  const context: BrowserContext = await browser.newContext({
    ...(touch ? devices['iPhone 13'] : {}),
    viewport: { width, height: touch ? 844 : 900 },
    hasTouch: touch,
    isMobile: touch,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    // BLEND_SCHEME=dark repeats a case in the dark theme.
    colorScheme: process.env['BLEND_SCHEME'] === 'dark' ? 'dark' : 'light',
  });
  await context.addInitScript(STORE_HOOK);
  await context.addInitScript(TRACE_HOOK);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}
const operate = async (page: Page, control: Locator, touch: boolean) =>
  assert.ok((await press(page, control, { touch })).inside, `${control} press landed outside`);
async function dismissToasts(page: Page, touch: boolean) {
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
      await operate(page, control, touch);
}
/** Processing mode CPU, by name (setup). */
async function cpu(page: Page) {
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByLabel('Processing mode').selectOption('cpu');
  await page.getByRole('button', { name: 'More options' }).click();
}
const blendOf = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__fmStore.getState().Blend ?? null);
const trace = (page: Page) =>
  page.evaluate(() => [...(window as unknown as W).__FACEMORPH_OPCTL_TRACE__]);
const blendRequests = (events: Trace) =>
  events.filter((e) => e.type === 'request' && e.kind === 'blend').map((e) => e.requestId!);
const computed = (events: Trace, id: string) =>
  events.some((e) => e.type === 'compute-ready' && e.requestId === id);
const settled = (events: Trace, id: string) =>
  events.find((e) => e.type === 'settled' && e.requestId === id);
async function waitBlend(page: Page, timeout = 600_000) {
  await page.waitForFunction(
    () => {
      const blend = (window as unknown as W).__fmStore.getState().Blend;
      return !!blend && blend.revision > 0 && blend.running === null;
    },
    null,
    { timeout },
  );
}
/** Setup: the view with exactly `n` slots holding distinct words. */
async function setSlots(page: Page, n: number) {
  await page.evaluate((n) => {
    const store = (window as unknown as W).__fmStore;
    const send = (type: string, ...args: unknown[]) => store.dispatch({ type, args });
    const slots = () => store.getState().Blend!.slots;
    while (slots().length < n) send('BlendAdd');
    while (slots().length > n) send('BlendRemove', slots().at(-1)!.input.id);
    slots().forEach((slot, i) => {
      if (slot.input.mode !== 'text') send('Mode', slot.input.id, 'text');
      send('Edit', slot.input.id, `blend words ${i + 1}`);
    });
  }, n);
  await page.waitForFunction((n) => document.querySelectorAll('.next-blend-slot').length === n, n);
}
/** Drags a range input from `from` to `to` (0-1) with the real mouse or real touch events, checking before the
 *  release that no blend was requested. Returns the blend requests made during the drag. */
async function drag(page: Page, slider: Locator, from: number, to: number, touch: boolean) {
  await slider.scrollIntoViewIfNeeded();
  // As a person would: bring the slider out from under the pinned result (phones) before touching it.
  await slider.evaluate((el) => {
    const pinned = document.querySelector('.next-blend-result')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (
      getComputedStyle(document.querySelector('.next-blend-result')!).position === 'sticky' &&
      r.top < pinned.bottom + 8 &&
      pinned.top <= 1
    )
      scrollBy(0, r.top - pinned.bottom - 24);
  });
  const box = (await slider.boundingBox())!;
  const at = (v: number) => ({ x: box.x + 8 + v * (box.width - 16), y: box.y + box.height / 2 });
  const start = at(from);
  const hit = await slider.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, start);
  assert.ok(hit, 'the slider is at its visible position');
  const before = blendRequests(await trace(page)).length;
  const steps = 6;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const point = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
    for (let i = 1; i <= steps; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(at(from + ((to - from) * i) / steps)),
      });
    await page.waitForTimeout(400);
    const during = blendRequests(await trace(page)).length - before;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return during;
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = at(from + ((to - from) * i) / steps);
    await page.mouse.move(p.x, p.y);
  }
  await page.waitForTimeout(400);
  const during = blendRequests(await trace(page)).length - before;
  await page.mouse.up();
  return during;
}

let site: Awaited<ReturnType<typeof startControl>> | null = null;
let browser: Browser | null = null;
async function setup(t: test.TestContext): Promise<Browser | null> {
  if (!existsSync(join(runtime, 'manifest.json'))) {
    const reason = `untested: no acquired runtime at ${runtime}; owner fm-2kse; run on the runtime lane`;
    if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
    t.skip(reason);
    return null;
  }
  if (browser) return browser;
  const artifact = readIdentity(out);
  assert.deepEqual(artifact.findings, []);
  site = await startControl({
    runtime,
    artifact: join(out, 'deploy-next'),
    source: artifact.identity.deploySource.buildId,
  });
  browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
  mkdirSync(results, { recursive: true });
  return browser;
}
test.after(async () => {
  await browser?.close();
  await site?.stop();
});

test(
  'blend run: open, fill a word, a name and a photo, blend, drag, reset, Make it 1, shuffle, reload, leave',
  { timeout: 3_600_000, skip: !CASES.has('run') },
  async (t) => {
    const b = await setup(t);
    if (!b) return;
    for (const [name, width, touch] of [
      ['desktop', 1280, false],
      ['phone', 390, true],
    ] as const) {
      const at = (step: string) => join(results, `run-${name}-${step}.png`);
      const { context, page, errors } = await newPage(b, width, touch);
      try {
        await page.goto(ORIGIN);
        await page.locator('section.next-face').nth(1).waitFor();
        await dismissToasts(page, touch);
        await cpu(page);
        const morphFaces = await page.evaluate(() =>
          (window as unknown as W).__fmStore.getState().Inputs.map((i) => i.value),
        );
        // Open via Blend faces in More options.
        const openBlend = async () => {
          const entry = page.getByRole('button', { name: 'Blend faces' });
          if (!(await entry.isVisible()))
            await operate(page, page.getByRole('button', { name: 'More options' }), touch);
          await operate(page, entry, touch);
        };
        await openBlend();
        await page.locator('.next-blend').waitFor();
        assert.equal(new URL(page.url()).hash, '#blend');
        const seeded = (await blendOf(page))!;
        assert.deepEqual(
          seeded.slots.map((s) => s.input.value),
          morphFaces,
          'seeded with copies of the morph faces',
        );
        await page.screenshot({ path: at('opened') });
        // Back to morph returns to the main page with the session intact.
        await operate(page, page.getByRole('button', { name: 'Back to morph' }), touch);
        await page.locator('section.next-face').nth(1).waitFor();
        assert.equal(new URL(page.url()).hash, '');
        // The deep link, loaded fresh, opens the view straight away; browser Back returns to the main page.
        await page.goto('about:blank');
        await page.goto(`${ORIGIN}/#blend`);
        await page.locator('.next-blend').waitFor();
        await page.goBack();
        await page.locator('section.next-face').nth(1).waitFor();
        assert.equal(new URL(page.url()).hash, '');
        assert.equal(new URL(page.url()).origin, ORIGIN, 'Back stayed on the site');
        await openBlend();
        await page.locator('.next-blend').waitFor();
        const slot = (i: number) => page.locator('.next-blend-slot').nth(i);
        const up = () => page.evaluate(() => scrollTo(0, 0));
        // Slot 1: typed words.
        const field = slot(0).locator('.next-field input');
        await operate(page, field, touch);
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('ada lovelace');
        // Slot 2: a picked name.
        await operate(page, slot(1).getByRole('button', { name: 'Change mode' }), touch);
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Browse names', exact: true }),
          touch,
        );
        const picker = page.getByRole('dialog', { name: 'Browse names' });
        await picker.locator('.next-name-choice').first().waitFor({ timeout: 30_000 });
        await operate(page, picker.locator('.next-name-choice').first(), touch);
        await picker.waitFor({ state: 'detached' });
        // A picked name asks to generate: the existing download question appears.
        const accept = page.locator('.next-download-accept');
        if (
          await accept.waitFor({ timeout: 10_000 }).then(
            () => true,
            () => false,
          )
        )
          await operate(page, accept, touch);
        // Slot 3: Add face, then a crop-confirmed photo.
        await operate(
          page,
          page.locator('.next-blend').getByRole('button', { name: 'Add face' }),
          touch,
        );
        await page.waitForFunction(
          () => document.querySelectorAll('.next-blend-slot').length === 3,
        );
        await operate(page, slot(2).getByRole('button', { name: 'Change mode' }), touch);
        const choosing = page.waitForEvent('filechooser');
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Encode image', exact: true }),
          touch,
        );
        await (await choosing).setFiles(PHOTO);
        const crop = page.getByRole('dialog', { name: 'Encode an image', exact: true });
        // Faces first (fm-k09b): answer the photo-setup decision until the crop's proposal is ready.
        for (const end = Date.now() + 900_000; ;) {
          assert.ok(Date.now() < end, 'the crop proposal was ready in time');
          const okButton = crop.getByRole('button', { name: 'OK', exact: true });
          if ((await okButton.isVisible()) && (await okButton.isEnabled())) break;
          const decision = page.locator('.next-download-accept');
          if (await decision.isVisible()) await operate(page, decision, touch);
          else await page.waitForTimeout(500);
        }
        await operate(page, crop.getByRole('button', { name: 'OK', exact: true }), touch);
        // Until the photo slot's face is encoded, answer the photo encoder's question whenever it is asked
        // (again once its schedule is discovered, or after the picked name's own generation).
        const encoded = (id: string) =>
          page.evaluate(
            (id) =>
              (window as unknown as W).__fmStore.getState().Blend!.faces.some((f) => f.id === id),
            id,
          );
        const photoId = (await blendOf(page))!.slots[2]!.input.id;
        for (const end = Date.now() + 900_000; !(await encoded(photoId));) {
          assert.ok(Date.now() < end, 'the photo slot was encoded in time');
          if (await accept.isVisible()) await operate(page, accept, touch);
          else await page.waitForTimeout(1000);
        }
        const slots = (await blendOf(page))!.slots;
        assert.deepEqual(
          slots.map((s) => s.input.mode),
          ['text', 'text', 'photo'],
        );
        assert.equal(slots[0]!.input.value, 'ada lovelace');
        // Blend, then the result with Save.
        await operate(page, page.locator('.next-blend-action'), touch);
        if (
          await accept.waitFor({ timeout: 5000 }).then(
            () => true,
            () => false,
          )
        )
          await operate(page, accept, touch);
        await waitBlend(page);
        const save = page
          .locator('.next-blend-actions')
          .getByRole('button', { name: 'Save image' });
        await save.waitFor();
        await page.waitForFunction(
          () => {
            const b = [...document.querySelectorAll('.next-blend-actions button')].find(
              (x) => x.textContent === 'Save image',
            ) as HTMLButtonElement | undefined;
            return !!b && !b.disabled;
          },
          null,
          { timeout: 120_000 },
        );
        const frame = await page
          .locator('.next-blend-image')
          .evaluate((el) =>
            el instanceof HTMLCanvasElement
              ? [el.width, el.height]
              : [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight],
          );
        assert.deepEqual(frame, [1024, 1024], 'the full model frame');
        assert.equal((await blendOf(page))!.error, '');
        await page.screenshot({ path: at('result') });
        // Drag a weight: nothing during the drag, exactly one blend per release, "Updating…" with Save off.
        const weight0 = slot(0).getByLabel('Weight for Blend face 1');
        const before = blendRequests(await trace(page)).length;
        const during = await drag(page, weight0, 0.3, 0.8, touch);
        assert.equal(during, 0, 'no blend request during the drag');
        await page.locator('.next-blend-updating').waitFor({ timeout: 5000 });
        assert.equal(await save.isDisabled(), true, 'Save is off while updating');
        await page.screenshot({ path: at('updating') });
        await waitBlend(page);
        await page.waitForFunction(() => !document.querySelector('.next-blend-updating'));
        const afterDrag = blendRequests(await trace(page));
        assert.equal(afterDrag.length - before, 1, 'exactly one blend per release');
        assert.ok(computed(await trace(page), afterDrag.at(-1)!), 'that blend synthesized');
        // Two quick keyboard steps: each committed step asks, the newer supersedes the pending one.
        await weight0.focus(); // setup: keyboard focus on the slider
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await waitBlend(page);
        const events = await trace(page);
        const keyed = blendRequests(events).slice(afterDrag.length);
        assert.equal(keyed.length, 2, 'one blend per committed keyboard step');
        assert.ok(computed(events, keyed[1]!), 'the newer blend finished');
        assert.ok(!computed(events, keyed[0]!), 'the older blend was superseded, never installed');
        // Reset: 1/N, the sum shown.
        await up(); // a person scrolls back up to the controls under the pinned result
        await operate(
          page,
          page.locator('.next-blend').getByRole('button', { name: 'Reset' }),
          touch,
        );
        await page.waitForFunction(() =>
          (window as unknown as W).__fmStore
            .getState()
            .Blend!.slots.every((s) => Math.abs(s.weight - 1 / 3) < 1e-9),
        );
        assert.equal(await page.locator('.next-blend-sum').innerText(), 'Sum 1.00');
        await waitBlend(page);
        // The sum line appears outside 0.8-1.2, and Make it 1 brings the sum to 1.
        await drag(page, weight0, 0.3, 1, touch);
        await page.locator('.next-blend-sum-line').waitFor();
        assert.match(
          await page.locator('.next-blend-sum-line').innerText(),
          /Weights add up to 1\.67\. Faces usually look most natural at 1\./,
        );
        await waitBlend(page);
        await up(); // a person scrolls back up to the controls under the pinned result
        await operate(page, page.getByRole('button', { name: 'Make it 1' }), touch);
        await page.locator('.next-blend-sum-line').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.next-blend-sum').innerText(), 'Sum 1.00');
        await waitBlend(page);
        // Shuffle weights: one regeneration; weights in 0-1 adding up to 1.
        const shuffleFrom = blendRequests(await trace(page)).length;
        await up(); // a person scrolls back up to the controls under the pinned result
        await operate(page, page.getByRole('button', { name: 'Shuffle weights' }), touch);
        await waitBlend(page);
        assert.equal(blendRequests(await trace(page)).length - shuffleFrom, 1);
        const shuffled = (await blendOf(page))!.slots.map((s) => s.weight);
        assert.ok(Math.abs(shuffled.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        assert.ok(shuffled.every((w) => w >= 0 && w <= 1));
        await page.screenshot({ path: at('shuffled') });
        // An injected failure (the next requested provider throws) offers Retry in the result's area.
        await page.evaluate(() => {
          const w = window as unknown as W;
          const trace = w.__FACEMORPH_OPCTL_TRACE__;
          const push = trace.push.bind(trace);
          let armed = true;
          trace.push = (...items) => {
            if (armed && items.some((e) => e.type === 'provider-requested')) {
              armed = false;
              push(...items);
              throw new Error('Injected blend failure.');
            }
            return push(...items);
          };
        });
        await operate(page, page.locator('.next-blend-action'), touch);
        const retry = page.locator('.next-blend-result').getByRole('button', { name: 'Retry' });
        await retry.waitFor({ timeout: 120_000 });
        await page.screenshot({ path: at('failure') });
        await operate(page, retry, touch);
        await waitBlend(page);
        assert.equal((await blendOf(page))!.error, '');
        // Reload in the view restores slots and weights.
        const kept = (await blendOf(page))!.slots.map((s) => [s.input.id, s.input.mode, s.weight]);
        await page.reload();
        await page.locator('.next-blend').waitFor();
        const restored = (await blendOf(page))!.slots.map((s) => [
          s.input.id,
          s.input.mode,
          s.weight,
        ]);
        assert.deepEqual(restored, kept, 'slots and weights restored');
        assert.equal(
          (await blendOf(page))!.slots[0]!.input.value,
          'ada lovelace',
          'typed words restored',
        );
        // The footer Privacy & reports link does not leave the view.
        await operate(page, page.locator('.next-footer-privacy'), touch);
        await page.waitForTimeout(300);
        assert.equal(new URL(page.url()).hash, '#blend');
        assert.ok(await page.locator('.next-blend').isVisible());
        // Back with the names picker open closes only the picker.
        await operate(page, slot(1).getByRole('button', { name: 'Change mode' }), touch);
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Browse names', exact: true }),
          touch,
        );
        await picker.waitFor();
        await page.goBack();
        await picker.waitFor({ state: 'detached' });
        assert.ok(await page.locator('.next-blend').isVisible(), 'the view stays');
        assert.equal(new URL(page.url()).hash, '#blend');
        // Leaving the view cancels a pending blend synthesis while a slot photo encode keeps running. A restored
        // photo slot asks for its photo again (its pixels stayed in the old tab's memory): choose it again.
        assert.match((await blendOf(page))!.slots[2]!.input.mode, /photo/);
        await operate(page, slot(2).getByRole('button', { name: 'Change mode' }), touch);
        const again = page.waitForEvent('filechooser');
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Encode image', exact: true }),
          touch,
        );
        await (await again).setFiles(PHOTO);
        await crop.waitFor();
        await operate(page, crop.getByRole('button', { name: 'OK', exact: true }), touch);
        const photoSlot = (await blendOf(page))!.slots[2]!.input.id;
        // The encode runs as the slot's own Generate (after this tab's encoder question, asked again after the
        // reload); the blend then waits on it as a dependency.
        const activeOn = (id: string) =>
          page.evaluate(
            (id) =>
              (
                (window as unknown as W).__fmStore.getState() as unknown as {
                  ActiveFace: string | null;
                }
              ).ActiveFace === id,
            id,
          );
        for (const end = Date.now() + 120_000; !(await activeOn(photoSlot));) {
          assert.ok(Date.now() < end, 'the photo slot encode started');
          if (await accept.isVisible()) await operate(page, accept, touch);
          else await page.waitForTimeout(250);
        }
        const pendingFrom = blendRequests(await trace(page)).length;
        await operate(page, page.locator('.next-blend-action'), touch);
        await page.waitForFunction(
          (n) =>
            (window as unknown as W).__FACEMORPH_OPCTL_TRACE__.filter(
              (e) => e.type === 'request' && e.kind === 'blend',
            ).length > n,
          pendingFrom,
        );
        await operate(page, page.getByRole('button', { name: 'Back to morph' }), touch);
        await page.locator('section.next-face').nth(1).waitFor();
        const pendingId = blendRequests(await trace(page))[pendingFrom]!;
        await page.waitForFunction(
          (id) =>
            (window as unknown as W).__FACEMORPH_OPCTL_TRACE__.some(
              (e) => e.type === 'settled' && e.requestId === id,
            ),
          pendingId,
          { timeout: 120_000 },
        );
        // The slot's photo encode finishes after the view closed.
        await page.waitForFunction(
          (id) =>
            (window as unknown as W).__fmStore.getState().Blend!.faces.some((f) => f.id === id),
          photoSlot,
          { timeout: 900_000 },
        );
        const final = await trace(page);
        assert.ok(!computed(final, pendingId), 'the pending blend never synthesized');
        assert.equal(settled(final, pendingId)?.outcome, 'cancelled');
        assert.deepEqual(
          await page.evaluate(() =>
            (window as unknown as W).__fmStore.getState().Inputs.map((i) => i.value),
          ),
          morphFaces,
          'the morph faces are as they were',
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.screenshot({ path: at('final') }).catch(() => {});
        await context.close();
      }
    }
  },
);

test(
  'blend output: Add to morph, Save a PNG with its recipe, reopen it on the main page, return to the view',
  { timeout: 3_600_000, skip: !CASES.has('output') },
  async (t) => {
    const b = await setup(t);
    if (!b) return;
    for (const [name, width, touch] of [
      ['desktop', 1280, false],
      ['phone', 390, true],
    ] as const) {
      const at = (step: string) =>
        join(
          results,
          `output-${name}${process.env['BLEND_SCHEME'] === 'dark' ? '-dark' : ''}-${step}.png`,
        );
      const { context, page, errors } = await newPage(b, width, touch);
      const modelRequests: string[] = [];
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (MODEL.test(path)) modelRequests.push(path);
      });
      const inputs = () =>
        page.evaluate(() =>
          (window as unknown as W).__fmStore.getState().Inputs.map((i) => ({
            id: i.id,
            value: i.value,
            mode: (i as { mode?: string }).mode,
          })),
        );
      try {
        await page.goto(ORIGIN);
        await page.locator('section.next-face').nth(1).waitFor();
        await dismissToasts(page, touch);
        await cpu(page);
        const morphBefore = await inputs();
        await page.goto(`${ORIGIN}/#blend`);
        await page.locator('.next-blend').waitFor();
        await setSlots(page, 2);
        const accept = page.locator('.next-download-accept');
        await operate(page, page.locator('.next-blend-action'), touch);
        for (const end = Date.now() + 600_000; ;) {
          const blend = await blendOf(page);
          if (blend && blend.revision > 0 && blend.running === null) break;
          assert.ok(Date.now() < end, 'the blend finished in time');
          if (await accept.isVisible()) await operate(page, accept, touch);
          else await page.waitForTimeout(500);
        }
        assert.equal((await blendOf(page))!.error, '');
        const ready = page.locator('.next-blend-actions [data-next-result-status="ready"]');
        await ready.waitFor({ timeout: 120_000 });

        // Add to morph: the blend joins the end of the morph row with no model request and no blend run.
        const requestsBefore = modelRequests.length;
        const blendsBefore = blendRequests(await trace(page)).length;
        const add = page.getByRole('button', { name: 'Add to morph' });
        await operate(page, add, touch);
        await page.locator('.next-blend-added').waitFor();
        assert.equal(
          await page.locator('.next-blend-added').innerText(),
          `Blend of 2 faces added to the morph as face ${morphBefore.length + 1}.`,
        );
        const afterAdd = await inputs();
        assert.equal(afterAdd.length, morphBefore.length + 1);
        assert.deepEqual(afterAdd.slice(0, -1), morphBefore, 'the row before it is unchanged');
        assert.deepEqual(
          [afterAdd.at(-1)!.value, afterAdd.at(-1)!.mode],
          ['Blend of 2 faces', 'project'],
        );
        assert.deepEqual(modelRequests.slice(requestsBefore), [], 'Add to morph requests no model');
        assert.equal(blendRequests(await trace(page)).length, blendsBefore, 'no new blend');
        await page.screenshot({ path: at('added') });

        // Save as PNG: the full frame, named for the blend, carrying its recipe and no typed words.
        await operate(page, page.locator('.next-blend-actions .next-result-format'), touch);
        await operate(page, page.getByRole('menuitem', { name: /PNG/ }), touch);
        await page
          .locator('.next-blend-actions .next-result-format', {
            hasText: 'PNG',
          })
          .waitFor();
        await ready.waitFor({ timeout: 120_000 });
        const download = page.waitForEvent('download');
        await operate(
          page,
          page.locator('.next-blend-actions').getByRole('button', { name: 'Save image' }),
          touch,
        );
        const saved = await download;
        const bytes = new Uint8Array(readFileSync((await saved.path())!));
        const file = join(results, `output-${name}-saved.png`);
        writeFileSync(file, bytes);
        assert.match(saved.suggestedFilename(), /^blend-2-faces.*\.png$/);
        assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47], 'a PNG');
        const view = new DataView(bytes.buffer, bytes.byteOffset);
        assert.deepEqual([view.getUint32(16), view.getUint32(20)], [1024, 1024], 'the full frame');
        const read = readRecovery(bytes) as unknown as {
          recovered: {
            generationKind: string;
            blend: {
              slots: { kind: string; latentSha256: string; weight: number }[];
            };
          };
        };
        assert.equal(read.recovered.generationKind, 'blend');
        assert.deepEqual(
          read.recovered.blend.slots.map((s) => [s.kind, s.weight]),
          [
            ['word', 0.5],
            ['word', 0.5],
          ],
        );
        assert.ok(
          !new TextDecoder('latin1').decode(bytes).includes('blend words'),
          'no typed words',
        );

        // Back to morph: the new face is at the end of the row and drawn.
        await operate(page, page.getByRole('button', { name: 'Back to morph' }), touch);
        const tiles = page.locator('section.next-face');
        await tiles.nth(1).waitFor();
        const added = tiles.nth(afterAdd.length - 1);
        await added.scrollIntoViewIfNeeded();
        await added.locator('canvas[data-face-drawn="true"], img.next-face-img').first().waitFor();
        await page.screenshot({ path: at('morph-row') });

        // The saved PNG opened on face 1 is recovered with no model request.
        const before = modelRequests.length;
        await tiles.nth(0).scrollIntoViewIfNeeded();
        await operate(
          page,
          tiles.nth(0).getByRole('button', { name: 'Change mode', exact: true }),
          touch,
        );
        const chooser = page.waitForEvent('filechooser');
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Encode image', exact: true }),
          touch,
        );
        await (await chooser).setFiles(file);
        await page.waitForFunction(
          () => {
            const s = (window as unknown as W).__fmStore.getState() as unknown as {
              Inputs: { id: string; mode: string }[];
              Faces: { id: string }[];
            };
            const first = s.Inputs[0]!;
            return first.mode === 'project' && s.Faces.some((f) => f.id === first.id);
          },
          null,
          { timeout: 60_000 },
        );
        assert.deepEqual(
          modelRequests.slice(before),
          [],
          'reopening the saved blend requests no model',
        );
        await page.screenshot({ path: at('reopened') });

        // Blend faces returns to the view with its slots and result intact.
        const kept = (await blendOf(page))!;
        const entry = page.getByRole('button', { name: 'Blend faces' });
        if (!(await entry.isVisible()))
          await operate(page, page.getByRole('button', { name: 'More options' }), touch);
        await operate(page, entry, touch);
        await page.locator('.next-blend').waitFor();
        const back = (await blendOf(page))!;
        assert.deepEqual(back.slots, kept.slots, 'slots and weights intact');
        assert.ok(
          back.faces.some((f) => f.id === 'blend-result'),
          'the result is still shown',
        );
        await page.locator('.next-blend-image').waitFor();
        assert.deepEqual(errors, []);
      } finally {
        await page.screenshot({ path: at('final') }).catch(() => {});
        await context.close();
      }
    }
  },
);

/** Geometry of the view: page scroll, result box, slot panel and every slot's controls. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
    };
    const slots = [...document.querySelectorAll('.next-blend-slot')];
    return {
      vw: document.documentElement.clientWidth,
      vh: innerHeight,
      pageScrollX: document.scrollingElement!.scrollWidth - document.documentElement.clientWidth,
      result: rect(document.querySelector('.next-blend-result')),
      panel: rect(document.querySelector('.next-blend-slots')),
      columns: new Set(slots.map((s) => Math.round(s.getBoundingClientRect().x))).size,
      thumbs: slots.map((s) => rect(s.querySelector('.next-face-image'))!.w),
      fields: slots.every((s) => !!s.querySelector('.next-field input')),
      weights: slots.every((s) => !!s.querySelector('input[type=range]')),
    };
  });
}
/** Every button and input inside the view that is clipped by the viewport or by a scroll container. */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      '.next-blend button, .next-blend input:not([type=file]):not([hidden]), .next-blend select:not(.next-sr)',
    )) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5)
        out.push(`${el.outerHTML.slice(0, 80)} outside the viewport`);
      const box = el.closest('.next-blend-slots')?.getBoundingClientRect();
      if (box && (r.left < box.left - 0.5 || r.right > box.right + 0.5))
        out.push(`${el.outerHTML.slice(0, 80)} clipped sideways by the slot panel`);
    }
    return out;
  });
}

test(
  'blend counts: 1 to 100 slots at 1280 and 390 px scroll inside the panel with every control hit',
  { timeout: 3_600_000, skip: !CASES.has('counts') },
  async (t) => {
    const b = await setup(t);
    if (!b) return;
    for (const [name, width, touch] of [
      ['desktop', 1280, false],
      ['phone', 390, true],
    ] as const) {
      const { context, page, errors } = await newPage(b, width, touch);
      try {
        await page.goto(ORIGIN);
        await page.locator('section.next-face').nth(1).waitFor();
        await dismissToasts(page, touch);
        await cpu(page);
        await page.goto(`${ORIGIN}/#blend`);
        await page.locator('.next-blend').waitFor();
        for (const count of COUNTS) {
          const at = `${name}-${count}`;
          await setSlots(page, count);
          const g = await geometry(page);
          assert.ok(g.pageScrollX <= 0, `${at}: no horizontal page scroll (${g.pageScrollX})`);
          assert.ok(g.fields && g.weights, `${at}: compact rows hold field and weight`);
          assert.ok(
            g.thumbs.every((w) => w > 0 && w <= 120),
            `${at}: compact thumbnails (${Math.max(...g.thumbs)} px)`,
          );
          assert.deepEqual(await clipped(page), [], `${at}: no clipped control`);
          // Every slot's weight slider and Remove at their centres, after scrolling the panel to it.
          const slots = page.locator('.next-blend-slot');
          for (let i = 0; i < count; i++) {
            const slot = slots.nth(i);
            await slot.scrollIntoViewIfNeeded();
            for (const control of [
              slot.locator('input[type=range]'),
              ...(count > 1 ? [slot.locator('.next-face-close')] : []),
            ]) {
              const box = (await control.boundingBox())!;
              const hit = await control.evaluate(
                (el, p) => {
                  const at = document.elementFromPoint(p.x, p.y);
                  return !!at && (at === el || el.contains(at));
                },
                { x: box.x + box.width / 2, y: box.y + box.height / 2 },
              );
              assert.ok(hit, `${at}: slot ${i + 1} ${await control.getAttribute('class')} hit`);
            }
          }
          if (count === 1)
            assert.equal(await page.locator('.next-face-close').count(), 0, 'one slot: no Remove');
          // After scrolling to the last slot the result box is still inside the viewport.
          const after = await geometry(page);
          assert.ok(
            after.result!.y >= -0.5 && after.result!.y < after.vh && after.result!.b > 0,
            `${at}: result in view after the last slot (${after.result!.y})`,
          );
          if (count > 8) {
            const panel = await page
              .locator('.next-blend-slots')
              .evaluate((el) => el.scrollHeight > el.clientHeight);
            assert.ok(panel, `${at}: the slot panel scrolls inside itself`);
          }
          await page.screenshot({ path: join(results, `counts-${at}.png`) });
        }
        // At 100 slots: the sum line, Reset and Make it 1 work.
        // A person scrolls the page back up to the controls under the pinned result.
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => {
          const store = (window as unknown as W).__fmStore;
          store.dispatch({
            type: 'BlendWeights',
            args: [store.getState().Blend!.slots.map(() => 0.05)],
          }); // setup
        });
        await page.locator('.next-blend-sum-line').waitFor();
        assert.match(await page.locator('.next-blend-sum-line').innerText(), /add up to 5\.00/);
        await operate(page, page.getByRole('button', { name: 'Make it 1' }), touch);
        await page.locator('.next-blend-sum-line').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.next-blend-sum').innerText(), 'Sum 1.00');
        await page.evaluate(() => {
          const store = (window as unknown as W).__fmStore;
          store.dispatch({
            type: 'BlendWeights',
            args: [store.getState().Blend!.slots.map((_, i) => (i ? 0 : 1))],
          }); // setup
        });
        await operate(
          page,
          page.locator('.next-blend').getByRole('button', { name: 'Reset' }),
          touch,
        );
        await page.waitForFunction(() =>
          (window as unknown as W).__fmStore
            .getState()
            .Blend!.slots.every((s) => Math.abs(s.weight - 0.01) < 1e-9),
        );
        assert.equal(await page.locator('.next-blend-sum').innerText(), 'Sum 1.00');
        // One blend synthesis per release at 100 slots (desktop: the slot faces generate as its dependencies).
        if (!touch && process.env['BLEND_SKIP_100_SYNTHESIS'] !== '1') {
          await operate(page, page.locator('.next-blend-action'), touch);
          const accept = page.locator('.next-download-accept');
          if (
            await accept.waitFor({ timeout: 10_000 }).then(
              () => true,
              () => false,
            )
          )
            await operate(page, accept, touch);
          await waitBlend(page, 3_000_000);
          assert.equal((await blendOf(page))!.error, '');
          const from = blendRequests(await trace(page)).length;
          const last = page.locator('.next-blend-slot').last().locator('input[type=range]');
          assert.equal(await drag(page, last, 0.2, 0.6, touch), 0, 'no blend during the drag');
          await waitBlend(page);
          const after = blendRequests(await trace(page));
          assert.equal(after.length - from, 1, '100 slots: exactly one blend per release');
          assert.ok(computed(await trace(page), after.at(-1)!));
          await page.screenshot({ path: join(results, `counts-${name}-100-blended.png`) });
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  },
);

test(
  'blend layout: result right with 2-4 columns on desktop, pinned on top with one column on phones',
  { timeout: 1_800_000, skip: !CASES.has('layout') },
  async (t) => {
    const b = await setup(t);
    if (!b) return;
    for (const width of SWEEP_WIDTHS) {
      const touch = width <= 599;
      const { context, page, errors } = await newPage(b, width, touch);
      try {
        await page.goto(`${ORIGIN}/#blend`);
        await page.locator('.next-blend').waitFor();
        for (const count of [3, 16]) {
          const at = `${width}-${count}`;
          await setSlots(page, count);
          const g = await geometry(page);
          assert.ok(g.pageScrollX <= 0, `${at}: no horizontal page scroll`);
          assert.deepEqual(await clipped(page), [], `${at}: no clipped control`);
          if (width >= 900) {
            assert.ok(g.result!.x >= g.panel!.r - 0.5, `${at}: the result is on the right`);
            assert.ok(
              g.columns >= Math.min(2, count) && g.columns <= 4,
              `${at}: ${g.columns} slot columns`,
            );
          } else {
            assert.ok(g.result!.b <= g.panel!.y + 0.5, `${at}: the result is above the slots`);
            assert.equal(g.columns, 1, `${at}: one column`);
            // Pinned: after scrolling the page to the last slot the result is still at the top.
            await page.locator('.next-blend-slot').last().scrollIntoViewIfNeeded();
            const after = await geometry(page);
            // It never leaves the viewport: at the top once the page has scrolled past it, else where it was.
            assert.ok(
              after.result!.y >= -0.5 && after.result!.y <= Math.max(1, g.result!.y + 0.5),
              `${at}: result pinned at the top (${after.result!.y})`,
            );
            assert.equal(
              await page
                .locator('.next-blend-result')
                .evaluate((el) => getComputedStyle(el).position),
              'sticky',
            );
          }
          await page.screenshot({ path: join(results, `layout-${at}.png`) });
          await page.evaluate(() => scrollTo(0, 0));
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  },
);
