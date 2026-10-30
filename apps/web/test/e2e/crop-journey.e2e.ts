// fm-k09b and fm-zigt: the confirmed-crop journey of PLAN.md#confirmed-crop-and-ordered-multi-selection-flow in the
// identified build:next destination (deploy-next/) with the real bridge, detector, runtime and CPU e4e, at 1,280 px
// (mouse) and 390 px (touch), light and dark. Graded controls are pressed or dragged at their visible positions
// (support/operate.ts, real mouse or CDP touch); choosing files and reading state are setup.
//   crop:   a portrait photo asks the photo-setup download first, then detection proposes the aligned face; ADJUST
//           CROP opens "Crop your image": the stencil is dragged, each of its eight handles resizes it, the rotate
//           button turns 90 degrees with its readout, the fine slider turns it; USE CROP returns with that crop; OK
//           encodes exactly it, once (the encoder's input file is compared with an independent rendering of the
//           chosen square), with no detection after OK. A no-face photo shows the failed-to-align screen and its OK
//           encodes once.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/crop-journey.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { devices, type BrowserContext, type Locator, type Page } from 'playwright';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { STORE_HOOK } from '../support/face-fixture.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const built = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/crop-journey');
const CASES = new Set((process.env['CROP_JOURNEY_CASES'] ?? 'crop').split(','));
const WIDTHS = (process.env['CROP_JOURNEY_WIDTHS'] ?? '1280,390').split(',').map(Number);
const FILES = {
  portrait: join(REPO, 'tests/crop/fixtures/non-square.jpg'),
  noFace: join(REPO, 'tests/crop/fixtures/no-face.jpg'),
  group: join(REPO, 'tests/crop/fixtures/multi-face.jpg'),
};

interface View {
  previewWidth: number;
  previewHeight: number;
  scale: number;
  cx: number;
  cy: number;
  side: number;
  rotation: number;
  quarter: number;
  fine: number;
}
interface Model {
  Inputs: { id: string; mode: string; file: Blob | null }[];
  Faces: { id: string }[];
  Crop: { faceId: string; detect?: string; view: View; previousView?: View } | null;
  Gate: unknown;
  Error: string | null;
  Busy: boolean;
  Downloads: { known: boolean; photoReady: boolean };
}
const model = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __fmStore: { getState(): Model } }).__fmStore.getState() as Model,
  );
const until = (page: Page, test: string, timeout = 900_000) =>
  page.waitForFunction(
    `(() => { const m = window.__fmStore.getState(); return ${test}; })()`,
    null,
    { timeout, polling: 250 },
  );

/** Counts what reaches the workers: detector passes ('align') and e4e attempts ('encode-aligned'). */
const PROBE = `(() => {
  const c = (window.__journey = { align: 0, e4e: 0 });
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === 'align') c.align++;
    if (m && m.type === 'encode-aligned') c.e4e++;
    return post.call(this, m, ...rest);
  };
})();`;
const counts = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __journey: { align: number; e4e: number } }).__journey,
  );

interface Session {
  name: string;
  touch: boolean;
  context: BrowserContext;
  page: Page;
  errors: string[];
  close(): Promise<void>;
  operate(control: Locator): Promise<void>;
  /** A real drag from (x, y) by (dx, dy): mouse down/move/up, or one finger through CDP touch events. */
  drag(x: number, y: number, dx: number, dy: number): Promise<void>;
  shot(name: string): Promise<void>;
}

async function open(width: number): Promise<Session> {
  const touch = width < 600;
  const name = touch ? 'phone' : 'desktop';
  const profile = await launchFreshChromiumProfile({
    args: [...chromiumArgs, '--disable-features=WebGPU'],
    ...(touch ? devices['iPhone 13'] : {}),
    viewport: { width, height: touch ? 844 : 900 },
    hasTouch: touch,
    isMobile: touch,
    ignoreHTTPSErrors: true,
  });
  const context = profile.context;
  await context.addInitScript(`${INSTALL_HOOK}\n${STORE_HOOK}\n${PROBE}`);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = touch ? await context.newCDPSession(page) : null;
  const session: Session = {
    name,
    touch,
    context,
    page,
    errors,
    close: () => profile.close(),
    async operate(control) {
      const landed = await press(page, control, { touch });
      assert.ok(landed.inside, `${name}: ${control} ${JSON.stringify(landed)}`);
    },
    async drag(x, y, dx, dy) {
      if (!cdp) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
        await page.mouse.up();
        return;
      }
      // The finger comes to rest before it lifts, so no fling swallows the next tap.
      const t0 = Date.now() / 1000;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
        timestamp: t0,
      });
      for (let i = 1; i <= 6; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6 }],
          timestamp: t0 + 0.05 * i,
        });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy }],
        timestamp: t0 + 0.6,
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        timestamp: t0 + 0.6,
      });
    },
    async shot(caseName) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({ path: join(results, `${name}-${caseName}-${scheme}.png`) });
      }
      await page.emulateMedia({ colorScheme: 'light' });
    },
  };
  await page.goto(ORIGIN);
  await page.locator('section.next-face').nth(1).waitFor();
  for (const control of [
    page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
    page.getByRole('button', { name: 'Ask me later' }),
  ])
    if (
      await control.waitFor({ timeout: 5000 }).then(
        () => true,
        () => false,
      )
    )
      await session.operate(control);
  await page.getByLabel('Processing mode').selectOption('cpu'); // setup
  await until(page, 'm.Downloads.known', 60_000);
  return session;
}

const faceId = async (page: Page, index: number) =>
  (await page.locator('section.next-face').nth(index).getAttribute('data-next-face'))!;
/** Setup: a file through the face's own file input (the chooser's result). */
const choose = (page: Page, id: string, paths: readonly string[]) =>
  page.locator(`#photo-${id}`).setInputFiles([...paths]);

/** The chosen square of `source`, rendered independently of the app's crop code, against the encoder's input. */
async function compareCrop(page: Page, id: string, source: string, view: View) {
  const bytes = [...readFileSync(source)];
  return page.evaluate(
    async ({ id, bytes, view }) => {
      const m = (
        window as unknown as { __fmStore: { getState(): { Inputs: { id: string; file: Blob }[] } } }
      ).__fmStore.getState();
      const file = m.Inputs.find((i) => i.id === id)!.file;
      const decode = async (
        blob: Blob,
        size: number,
        draw?: (c: OffscreenCanvasRenderingContext2D, b: ImageBitmap) => void,
      ) => {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
        const canvas = new OffscreenCanvas(size, size);
        const c = canvas.getContext('2d', { willReadFrequently: true })!;
        if (draw) draw(c, bitmap);
        else c.drawImage(bitmap, 0, 0, size, size);
        return {
          data: c.getImageData(0, 0, size, size).data,
          width: bitmap.width,
          height: bitmap.height,
        };
      };
      const N = 128;
      const got = await decode(file, N);
      const source = new Blob([new Uint8Array(bytes)]);
      const want = await decode(source, N, (c, b) => {
        // Preview pixels -> source pixels, then the square about its centre, turned by the view's angle.
        const k = b.width / view.previewWidth;
        c.fillStyle = '#000';
        c.fillRect(0, 0, N, N);
        c.translate(N / 2, N / 2);
        c.rotate((view.rotation * Math.PI) / 180);
        c.scale(N / (view.side * k), N / (view.side * k));
        c.translate(-view.cx * k, -view.cy * k);
        c.imageSmoothingQuality = 'high';
        c.drawImage(b, 0, 0);
      });
      let sum = 0;
      for (let i = 0; i < got.data.length; i += 4)
        for (let ch = 0; ch < 3; ch++) sum += Math.abs(got.data[i + ch]! - want.data[i + ch]!);
      return { meanAbs: sum / ((got.data.length / 4) * 3), size: got.width };
    },
    { id, bytes, view },
  );
}

test(
  'confirmed crop journey: faces first, the stencil editor, failed to align (fm-k09b)',
  { timeout: 7_200_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-k09b; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(built);
    assert.deepEqual(artifact.findings, []);
    mkdirSync(results, { recursive: true });
    const evidence: Record<string, unknown> = { build: artifact.identity?.deploySource };
    const record = (key: string, value: unknown) => {
      evidence[key] = value;
      writeFileSync(join(results, 'evidence.json'), JSON.stringify(evidence, null, 1));
    };
    const site = await startControl({
      runtime,
      artifact: resolve(built, 'deploy-next'),
      source: artifact.identity!.deploySource.buildId,
    });
    try {
      for (const width of WIDTHS) {
        if (!CASES.has('crop')) break;
        await t.test(
          `${width} px: photo -> setup decision -> aligned proposal -> adjust -> OK; no face -> guidance -> OK`,
          async () => {
            const s = await open(width);
            try {
              const page = s.page;
              const dialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
              const first = await faceId(page, 0);
              await choose(page, first, [FILES.portrait]);
              // The detector's files are missing on a fresh profile: the photo-setup decision comes first.
              const accept = page.locator('.next-download-accept');
              await accept.waitFor({ timeout: 60_000 });
              await s.shot('setup-decision');
              await s.operate(accept);
              // A decision whose exact size was discovered after it asks once more (the existing revised decision).
              while (
                await accept.waitFor({ timeout: 8000 }).then(
                  () => true,
                  () => false,
                )
              ) {
                await s.operate(accept);
                await accept.waitFor({ state: 'detached' }).catch(() => {});
              }
              // The confirmation opens with the photo while faces are found, then shows the aligned proposal.
              await until(
                page,
                "m.Crop && m.Crop.detect !== 'waiting' && m.Crop.detect !== 'running'",
              );
              let m = await model(page);
              assert.equal(m.Crop?.detect, 'one', 'one face: the aligned proposal');
              const proposal = m.Crop!.view;
              assert.ok(
                proposal.side < Math.min(proposal.previewWidth, proposal.previewHeight),
                'the face, not the whole photo',
              );
              await dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }).waitFor();
              await s.shot('confirm-aligned');

              await s.operate(dialog.getByRole('button', { name: 'ADJUST CROP', exact: true }));
              const area = dialog.getByRole('application', { name: 'Crop area' });
              await area.waitFor();
              await dialog
                .getByText(
                  'Cropping is generally not necessary, as faces are usually auto detected.',
                )
                .waitFor();
              await dialog
                .getByText('Try to leave a bit above the top of the head and below the chin.')
                .waitFor();
              await dialog.getByText('Lining up the eyes is most important.').waitFor();
              await s.shot('editor-opened');
              const scrolled = await page.evaluate(() => scrollY);
              const stencil = dialog.locator('[data-next-crop-stencil]');
              const box = async () => (await stencil.boundingBox())!;
              // Shrink from the bottom-right so the square has room to move, then drag its body.
              let b = await box();
              await s.drag(b.x + b.width, b.y + b.height, -b.width * 0.25, -b.height * 0.25);
              b = await box();
              const before = (await model(page)).Crop!.view;
              await s.drag(b.x + b.width / 2, b.y + b.height / 2, 14, 10);
              const moved = (await model(page)).Crop!.view;
              assert.ok(moved.cx !== before.cx || moved.cy !== before.cy, 'the stencil moved');
              // Each handle: inward then outward; the square stays square and changes size.
              const handles: Record<string, [number, number]> = {
                nw: [0, 0],
                n: [0.5, 0],
                ne: [1, 0],
                e: [1, 0.5],
                se: [1, 1],
                s: [0.5, 1],
                sw: [0, 1],
                w: [0, 0.5],
              };
              const resized: Record<string, number> = {};
              for (const [handle, [fx, fy]] of Object.entries(handles)) {
                b = await box();
                const was = (await model(page)).Crop!.view.side;
                const inward = [
                  fx === 0 ? 12 : fx === 1 ? -12 : 0,
                  fy === 0 ? 12 : fy === 1 ? -12 : 0,
                ] as const;
                await s.drag(b.x + b.width * fx, b.y + b.height * fy, inward[0], inward[1]);
                const now = (await model(page)).Crop!.view.side;
                resized[handle] = now - was;
                assert.ok(
                  now < was,
                  `${handle}: dragging inward shrinks the square (${was} -> ${now})`,
                );
                b = await box();
                assert.ok(Math.abs(b.width - b.height) < 1.5, `${handle}: still square`);
              }
              record(`${s.name}-handles`, resized);
              // Rotate 90 degrees: the readout says so; the fine slider turns it further.
              await s.operate(dialog.getByRole('button', { name: 'Rotate 90 degrees' }));
              await dialog.locator('.next-crop-degrees', { hasText: '-90°' }).waitFor();
              await s.operate(dialog.getByRole('button', { name: 'Rotate 90 degrees' }));
              await s.operate(dialog.getByRole('button', { name: 'Rotate 90 degrees' }));
              await s.operate(dialog.getByRole('button', { name: 'Rotate 90 degrees' }));
              await dialog.locator('.next-crop-degrees', { hasText: /^0°$/ }).waitFor();
              const slider = dialog.getByRole('slider', { name: 'Fine rotation' });
              const track = (await slider.boundingBox())!;
              // A press at 60% of the track: about +9 degrees.
              if (s.touch)
                await page.touchscreen.tap(track.x + track.width * 0.6, track.y + track.height / 2);
              else await page.mouse.click(track.x + track.width * 0.6, track.y + track.height / 2);
              m = await model(page);
              assert.ok(
                m.Crop!.view.fine > 3 && m.Crop!.view.fine < 15,
                `fine rotation ${m.Crop!.view.fine}`,
              );
              await dialog
                .locator('.next-crop-degrees', { hasText: `${Math.round(m.Crop!.view.rotation)}°` })
                .waitFor();
              await s.shot('editor-adjusted');
              // The page itself did not scroll while dragging.
              assert.equal(await page.evaluate(() => scrollY), scrolled);
              const chosen = (await model(page)).Crop!.view;
              await s.operate(dialog.getByRole('button', { name: 'USE CROP', exact: true }));
              m = await model(page);
              assert.equal(m.Crop?.previousView, undefined, 'back at the confirmation');
              assert.deepEqual(m.Crop?.view, chosen, 'with the adjusted crop');
              await s.shot('confirm-adjusted');
              const mark = await counts(page);
              await s.operate(dialog.getByRole('button', { name: 'OK', exact: true }));
              await until(
                page,
                `m.Faces.some((f) => f.id === ${JSON.stringify(first)}) || !!m.Error`,
              );
              m = await model(page);
              assert.equal(m.Error, null);
              assert.equal(m.Crop, null, 'no second crop prompt');
              const after = await counts(page);
              assert.deepEqual(
                [after.align - mark.align, after.e4e - mark.e4e],
                [0, 1],
                'one e4e, no detection after OK',
              );
              const compared = await compareCrop(page, first, FILES.portrait, chosen);
              record(`${s.name}-encoded-input`, { chosen, ...compared });
              assert.ok(
                compared.meanAbs < 6,
                `the encoder's input is the chosen square (mean abs ${compared.meanAbs})`,
              );
              await s.shot('encoded');

              // No face: the failed-to-align screen; OK encodes the centred square once.
              const second = await faceId(page, 1);
              await choose(page, second, [FILES.noFace]);
              await until(page, "m.Crop && m.Crop.detect === 'none'", 300_000);
              await dialog.getByText('Unable to auto align face.').waitFor();
              await dialog
                .getByText("When the face isn't aligned you may get strange results.", {
                  exact: false,
                })
                .waitFor();
              await s.shot('failed-to-align');
              const noFaceMark = await counts(page);
              await s.operate(dialog.getByRole('button', { name: 'OK', exact: true }));
              await until(
                page,
                `m.Faces.some((f) => f.id === ${JSON.stringify(second)}) || !!m.Error`,
              );
              m = await model(page);
              assert.equal(m.Error, null);
              assert.equal(m.Crop, null);
              const noFaceAfter = await counts(page);
              assert.deepEqual(
                [noFaceAfter.align - noFaceMark.align, noFaceAfter.e4e - noFaceMark.e4e],
                [0, 1],
                'the no-face OK: one e4e, no detection',
              );
              record(`${s.name}-errors`, s.errors);
              assert.deepEqual(s.errors, []);
            } catch (error) {
              await s.page
                .screenshot({ path: join(results, `${s.name}-failure.png`) })
                .catch(() => {});
              throw error;
            } finally {
              await s.close();
            }
          },
        );
      }
    } finally {
      await site.stop();
    }
  },
);
