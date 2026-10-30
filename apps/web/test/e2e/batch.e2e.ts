// fm-q5b9 and fm-id4c item 12: the batch view in the identified build:next destination (deploy-next/) with the real
// bridge, runtime and CPU route, at 1,280 px (mouse) and 390 px (touch). Every graded control is pressed at its
// visible position after elementFromPoint shows it there (support/operate.ts); file choosing is setup.
//   1. Recovered R, group photo A (two faces), portrait B and a corrupt fourth file: the corrupt file is left out;
//      the view asks the photo-setup decision itself so faces are found on this device; R -> A2 -> B1 picked;
//      Cancel leaves the project unchanged; then the same picks and OK: the faces land R, A2, B1 at the originating
//      face and after it, R installed with zero model requests and no operation; A2 and B1 are cropped as accepted
//      with no crop prompt (fm-zigt).
//   2. A damaged still offers Use as photo only as its own explicit action; a still from another model is
//      selectable and lands held, with compute off for it.
//   3. Photo encoding genuinely refused (WebGPU off at launch, encoder assets absent from the server): photos say
//      why and offer nothing; the saved subset confirms; zero detector/model requests.
//   4. A single saved still dropped alone takes the direct recovery path: no batch view. Several pasted images open
//      the batch view.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/batch.e2e.ts
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { devices, type Locator, type Page } from 'playwright';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const built = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/batch');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
const DETECTOR = /^\/runtime\/photo\//;
const CASES = new Set((process.env['BATCH_CASES'] ?? 'mixed,held,refused,single').split(','));
const WIDTHS = [
  ['desktop', 1280, false],
  ['phone', 390, true],
] as const;
const fixture = (path: string) => join(REPO, path);
const FILES = {
  group: fixture('tests/crop/fixtures/multi-face.jpg'),
  portrait: fixture('tests/crop/fixtures/non-square.jpg'),
  corrupt: fixture('tests/crop/fixtures/malformed.jpg'),
  damaged: fixture('apps/web/test/fixtures/verify/stills/damaged-v1.png'),
  other: fixture('apps/web/test/fixtures/verify/stills/model-mismatch-v2.png'),
};

interface Batch {
  groups: {
    id: string;
    role: string;
    status: string;
    detection: string;
    faces: unknown[];
    candidates: string[];
  }[];
  order: string[];
}
interface Model {
  Inputs: { id: string; mode: string; value: string; file: Blob | null }[];
  Faces: { id: string }[];
  Held?: Map<string, { kind: string }>;
  Batch?: Batch;
  Crop: { faceId: string; view: { side: number } } | null;
  PhotoQueue: unknown[];
  PreparingFaces: Set<string>;
  Busy: boolean;
  Downloads: { known: boolean; photoReady: boolean; photoAvailable: boolean };
}
const read = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
    return {
      inputs: m.Inputs.map(({ id, mode, value, file }) => ({
        id,
        mode,
        value,
        bytes: file?.size ?? 0,
      })),
      faces: m.Faces.map((f) => f.id),
      held: [...(m.Held ?? new Map()).entries()].map(([id, h]) => ({ id, kind: h.kind })),
      batch: m.Batch
        ? {
            groups: m.Batch.groups.map((g) => ({
              id: g.id,
              role: g.role,
              status: g.status,
              detection: g.detection,
              boxes: g.faces.length,
              candidates: g.candidates,
            })),
            order: m.Batch.order,
          }
        : null,
      crop: m.Crop ? { faceId: m.Crop.faceId, side: m.Crop.view.side } : null,
      queue: m.PhotoQueue.length,
      preparing: m.PreparingFaces.size,
      busy: m.Busy,
      downloads: m.Downloads,
    };
  });
type Read = Awaited<ReturnType<typeof read>>;

/** A cold persistent profile per journey: real model downloads need normal browser storage (support/browser-profile.ts). */
async function open(width: number, touch: boolean, name: string) {
  const profile = await launchFreshChromiumProfile({
    args: [...chromiumArgs, '--disable-features=WebGPU'],
    ...(touch ? devices['iPhone 13'] : {}),
    viewport: { width, height: 900 },
    hasTouch: touch,
    isMobile: touch,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  const context = profile.context;
  await context.addInitScript(INSTALL_HOOK);
  await context.addInitScript(() => {
    (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] }).__FACEMORPH_OPCTL_TRACE__ = [];
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (MODEL.test(path)) requests.push(path);
  });
  const operate = async (control: Locator) =>
    assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
  const shot = (caseName: string) =>
    page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: false });
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
      await operate(control);
  await page.getByLabel('Processing mode').selectOption('cpu'); // setup
  await page.waitForFunction(
    () => (window as unknown as { __elmish: { model: Model } }).__elmish.model.Downloads.known,
  );
  return { context: profile, page, errors, requests, operate, shot };
}

/** Faces first (fm-zigt): a fresh profile is asked the photo-setup download decision; Cancel declines it. */
async function declineSetup(page: Page, operate: (control: Locator) => Promise<void>) {
  const dialog = page.locator('.next-download-dialog');
  await dialog.waitFor({ timeout: 30_000 });
  await operate(dialog.getByRole('button', { name: 'Cancel', exact: true }));
  await dialog.waitFor({ state: 'detached' });
}
/** Setup: several files through a face's own file input (the chooser's result), in this order. */
const choose = (page: Page, face: string, paths: readonly string[]) =>
  page.locator(`#photo-${face}`).setInputFiles([...paths]);
/** Setup: a drop of real files on the page background (like a person dropping them there). */
const dropOnPage = (page: Page, paths: readonly string[]) =>
  page.evaluate(
    (list) => {
      const data = new DataTransfer();
      for (const [n, type, bytes] of list)
        data.items.add(new File([new Uint8Array(bytes)], n, { type }));
      const target = document.querySelector('main.next-product')!;
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
      );
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      );
    },
    paths.map(
      (p, i) =>
        [
          `file-${i}${p.slice(p.lastIndexOf('.'))}`,
          p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
          [...readFileSync(p)],
        ] as const,
    ),
  );
/** Every file of the open view shows its faces (decoded, detection settled). */
const viewSettled = (page: Page) =>
  page.waitForFunction(
    () =>
      (window as unknown as { __elmish: { model: Model } }).__elmish.model.Batch?.groups.every(
        (g) => g.status !== 'loading' && g.detection !== 'running',
      ),
    null,
    { timeout: 600_000, polling: 250 },
  );
const operations = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __FACEMORPH_OPCTL_TRACE__: Record<string, unknown>[] }
    ).__FACEMORPH_OPCTL_TRACE__.filter((e) => e['type'] === 'request'),
  );
/** What Cancel must leave exactly as it was. */
const project = (r: Read) => JSON.stringify([r.inputs, r.faces, r.held, r.queue]);

test(
  'the batch view: recovered stills beside crop candidates, Cancel, OK in click order',
  { timeout: 3_600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-q5b9; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(built);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    mkdirSync(results, { recursive: true });
    const evidence: Record<string, unknown> = { build: artifact.identity.deploySource };
    const record = (key: string, value: unknown) => {
      evidence[key] = value;
      writeFileSync(join(results, 'evidence.json'), JSON.stringify(evidence, null, 1));
    };
    const saved = join(results, 'saved-hello.webp');
    const site = await startControl({
      runtime,
      artifact: resolve(built, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    try {
      // Setup: a face this app saves itself (face 1 "hello", generated on the CPU) is the recovered still R.
      {
        const s = await open(1280, false, 'setup');
        const tile = s.page.locator('section.next-face').nth(0);
        await tile.locator('.next-input-row .next-face-generate').click(); // setup
        const accept = s.page.locator('.next-download-accept');
        while (
          await accept.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        ) {
          await accept.click(); // setup
          await accept.waitFor({ state: 'detached' });
        }
        await s.page.waitForFunction(
          () =>
            (window as unknown as { __elmish: { model: Model } }).__elmish.model.Faces.length > 0,
          null,
          { timeout: 900_000, polling: 1000 },
        );
        const download = s.page.waitForEvent('download');
        await tile.getByRole('button', { name: 'Save image', exact: true }).click(); // setup
        writeFileSync(saved, readFileSync((await (await download).path())!));
        await s.context.close();
      }

      if (CASES.has('mixed'))
        await t.test(
          'R -> A2 -> B1, corrupt fourth omitted: Cancel unchanged, then OK in click order',
          async () => {
            const rows: unknown[] = [];
            for (const [name, width, touch] of WIDTHS) {
              const s = await open(width, touch, name);
              try {
                const { page, operate, shot } = s;
                const batch = page.locator('.next-batch');
                const target = (await read(page)).inputs[1]!.id;
                const files = [FILES.group, FILES.portrait, saved, FILES.corrupt];
                // Faces first (fm-zigt): the view asks the existing photo-setup download decision on its own.
                await choose(page, target, files);
                // The existing download decision, and its revised decision once the exact encoder scope is known.
                const accept = page.locator('.next-download-accept');
                await accept.waitFor();
                while (
                  await accept.waitFor({ timeout: 30_000 }).then(
                    () => true,
                    () => false,
                  )
                ) {
                  await operate(accept);
                  await accept.waitFor({ state: 'detached' });
                }
                await page.waitForFunction(
                  () => {
                    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
                    return m.Downloads.photoReady && m.Batch?.groups[0]?.detection === 'done';
                  },
                  null,
                  { timeout: 1_800_000, polling: 1000 },
                );
                await viewSettled(page);
                let view = await read(page);
                assert.deepEqual(
                  view.batch!.groups.map((g) => [g.role, g.status]),
                  [
                    ['photo', 'ready'],
                    ['photo', 'ready'],
                    ['recovered', 'ready'],
                    ['photo', 'unreadable'],
                  ],
                  `${name}: every file side by side, the corrupt one left out`,
                );
                assert.equal(
                  view.batch!.groups[0]!.boxes,
                  2,
                  `${name}: two faces found in the group photo`,
                );
                assert.deepEqual(view.batch!.groups[3]!.candidates, []);
                // Each detected face's button lies on the picture, where that face is drawn.
                const placed = await batch
                  .locator('[data-next-batch-file="f0"]')
                  .evaluate((group) => {
                    const image = group
                      .querySelector('.next-batch-image img')!
                      .getBoundingClientRect();
                    return [...group.querySelectorAll('.next-batch-box')].map((box) => {
                      const r = box.getBoundingClientRect();
                      return (
                        r.left >= image.left - 1 &&
                        r.right <= image.right + 1 &&
                        r.top >= image.top - 1 &&
                        r.bottom <= image.bottom + 1
                      );
                    });
                  });
                assert.deepEqual(placed, [true, true], `${name}: face buttons on the picture`);
                assert.match(
                  await batch.locator('[data-next-batch-file="f3"]').innerText(),
                  /could not be read, so it is left out/,
                );
                const ok = batch.locator('.next-batch-ok');
                assert.equal(await ok.isDisabled(), true, `${name}: OK is off with nothing picked`);
                assert.equal(
                  await page.locator(`#${await ok.getAttribute('aria-describedby')}`).innerText(),
                  'Pick at least one face to add.',
                  `${name}: the reason is exposed to screen readers`,
                );
                const pickInOrder = async () => {
                  for (const candidate of ['f2#0', 'f0#1', 'f1#0'])
                    await operate(batch.locator(`[data-next-candidate="${candidate}"]`));
                  assert.deepEqual((await read(page)).batch!.order, ['f2#0', 'f0#1', 'f1#0']);
                };
                const before = await read(page);
                await pickInOrder();
                await shot('mixed-picked');
                const beforeOps = (await operations(page)).length;
                // Cancel before OK: the project is exactly as it was.
                await operate(batch.getByRole('button', { name: 'CANCEL', exact: true }));
                await batch.waitFor({ state: 'detached' });
                const cancelled = await read(page);
                assert.equal(
                  project(cancelled),
                  project(before),
                  `${name}: Cancel changes nothing`,
                );
                assert.equal(cancelled.crop, null);
                assert.equal(
                  (await operations(page)).length,
                  beforeOps,
                  `${name}: no operation from Cancel`,
                );
                await shot('mixed-cancelled');

                // Again, then OK.
                await choose(page, target, files);
                await batch.waitFor();
                await viewSettled(page);
                await pickInOrder();
                const requestsAtOk = s.requests.length;
                const opsAtOk = (await operations(page)).length;
                await operate(batch.getByRole('button', { name: 'Add 3 faces' }));
                await batch.waitFor({ state: 'detached' });
                // R recovers with no model request and no operation of its own; A2 and B1 are cropped as accepted
                // in the view (the tray was the confirmation) and encode in pick order: no crop prompt follows.
                await page.waitForFunction(
                  (id) => {
                    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
                    return m.Faces.some((f) => f.id === id);
                  },
                  target,
                  { timeout: 120_000 },
                );
                const atR = await read(page);
                const rRequests = s.requests.slice(requestsAtOk);
                const at = atR.inputs.findIndex((i) => i.id === target);
                const [r, a2, b1] = atR.inputs.slice(at, at + 3);
                const rOps = (await operations(page))
                  .slice(opsAtOk)
                  .filter((op) => JSON.stringify(op).includes(r!.id));
                assert.deepEqual(rRequests, [], `${name}: zero model requests for R`);
                assert.deepEqual(rOps, [], `${name}: zero operations (no inference) for R`);
                assert.equal(
                  r!.mode,
                  'project',
                  `${name}: R is the saved face, at the originating face`,
                );
                assert.ok(atR.faces.includes(r!.id));
                assert.equal(atR.inputs.length, before.inputs.length + 2);
                assert.deepEqual(
                  atR.inputs
                    .filter((i) => !atR.inputs.slice(at, at + 3).includes(i))
                    .map((i) => i.id),
                  before.inputs.filter((i) => i.id !== target).map((i) => i.id),
                  `${name}: other faces keep their places`,
                );
                await page.waitForFunction(
                  (ids) => {
                    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
                    return ids.every((id) =>
                      m.Inputs.some((i) => i.id === id && i.mode === 'photo' && i.file),
                    );
                  },
                  [a2!.id, b1!.id],
                  { timeout: 120_000 },
                );
                const after = await read(page);
                assert.equal(after.crop, null, `${name}: no crop prompt after OK`);
                assert.deepEqual(
                  after.inputs.slice(at, at + 3).map((i) => [i.id, i.mode]),
                  [
                    [r!.id, 'project'],
                    [a2!.id, 'photo'],
                    [b1!.id, 'photo'],
                  ],
                  `${name}: exactly R, A2, B1`,
                );
                await shot('mixed-confirmed');
                assert.deepEqual(s.errors, [], `${name}: no page errors`);
                rows.push({
                  name,
                  target,
                  order: after.inputs.slice(at, at + 3),
                  rRequests,
                  rOperations: rOps,
                });
                record('mixed', rows);
              } finally {
                await s.context.close();
              }
            }
          },
        );

      if (CASES.has('held'))
        await t.test(
          'damaged: Use as photo only explicitly; another model: selectable, held, compute off',
          async () => {
            const rows: unknown[] = [];
            for (const [name, width, touch] of WIDTHS) {
              const s = await open(width, touch, name);
              try {
                const { page, operate, shot } = s;
                const batch = page.locator('.next-batch');
                const target = (await read(page)).inputs[1]!.id;
                const requests = s.requests.length;
                await choose(page, target, [FILES.damaged, FILES.other]);
                await batch.waitFor();
                await viewSettled(page);
                const view = await read(page);
                assert.deepEqual(
                  view.batch!.groups.map((g) => [g.role, g.candidates]),
                  [
                    ['damaged', []],
                    ['held', ['f1#0']],
                  ],
                );
                const damaged = batch.locator('[data-next-batch-file="f0"]');
                assert.equal(
                  await damaged.locator('[data-next-candidate]').count(),
                  0,
                  `${name}: nothing to pick`,
                );
                await shot('held-view');
                // The explicit action makes it a photo candidate; it is still not picked by itself.
                await operate(damaged.getByRole('button', { name: 'Use as photo' }));
                // Now a photo is in the view: faces first asks the photo-setup decision; declined, it stays whole.
                await declineSetup(page, operate);
                await damaged.locator('[data-next-candidate="f0#0"]').waitFor();
                assert.deepEqual((await read(page)).batch!.order, []);
                await operate(batch.locator('[data-next-candidate="f1#0"]'));
                await operate(batch.locator('.next-batch-ok'));
                await batch.waitFor({ state: 'detached' });
                const after = await read(page);
                assert.deepEqual(after.held.find((h) => h.id === target)?.kind, 'unknown-model');
                assert.equal(after.inputs.find((i) => i.id === target)!.mode, 'project');
                const tile = page.locator(`section.next-face[data-next-face="${target}"]`);
                const generate = tile.locator('.next-face-generate');
                if (await generate.count())
                  assert.equal(await generate.isDisabled(), true, `${name}: compute is off for it`);
                assert.deepEqual(s.requests.slice(requests), [], `${name}: no model request`);
                await shot('held-confirmed');
                assert.deepEqual(s.errors, []);
                rows.push({ name, held: after.held, view: view.batch });
                record('held', rows);
              } finally {
                await s.context.close();
              }
            }
          },
        );

      if (CASES.has('single'))
        await t.test(
          'one saved still alone: the direct recovery path; several pasted images: the view',
          async () => {
            const rows: unknown[] = [];
            for (const [name, width, touch] of WIDTHS) {
              const s = await open(width, touch, name);
              try {
                const { page, shot } = s;
                const requests = s.requests.length;
                const opened = page.evaluate(
                  () =>
                    new Promise<boolean>((done) => {
                      const seen = new MutationObserver(() => {
                        if (document.querySelector('.next-batch')) {
                          seen.disconnect();
                          done(true);
                        }
                      });
                      seen.observe(document.body, { childList: true, subtree: true });
                      setTimeout(() => {
                        seen.disconnect();
                        done(false);
                      }, 8000);
                    }),
                );
                const before = await read(page);
                await dropOnPage(page, [saved]);
                assert.equal(await opened, false, `${name}: no batch view for one still`);
                await page.waitForFunction(
                  (n) =>
                    (window as unknown as { __elmish: { model: Model } }).__elmish.model.Faces
                      .length > n,
                  before.faces.length,
                  { timeout: 60_000 },
                );
                assert.deepEqual(s.requests.slice(requests), [], `${name}: no model request`);
                await shot('single-direct');
                // Several pasted images open the same view.
                const field = page.locator('section.next-face').nth(1).locator('.next-field input');
                await field.focus(); // setup
                await page.evaluate(
                  (list) => {
                    const data = new DataTransfer();
                    for (const [n, bytes] of list)
                      data.items.add(new File([new Uint8Array(bytes)], n, { type: 'image/jpeg' }));
                    document.activeElement!.dispatchEvent(
                      new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: data,
                      }),
                    );
                  },
                  [FILES.portrait, FILES.group].map(
                    (p, i) => [`paste-${i}.jpg`, [...readFileSync(p)]] as const,
                  ),
                );
                // Photos in the view: faces first asks the photo-setup decision; declined, they stay whole.
                await declineSetup(page, s.operate);
                await page.locator('.next-batch').waitFor();
                await shot('paste-view');
                assert.deepEqual(s.errors, []);
                rows.push({ name, direct: true, pasteOpensView: true });
                record('single', rows);
              } finally {
                await s.context.close();
              }
            }
          },
        );
    } finally {
      await site.stop();
    }

    if (CASES.has('refused'))
      await t.test(
        'photo encoding refused: photos say why, the saved subset confirms, no detector or model request',
        async () => {
          // The same verified runtime with the encoder not delivered (as face-controls.e2e.ts builds it): its manifest
          // names no encoder and the encoder files are absent, so admission refuses photo encoding.
          const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'));
          const encoderDir = String(manifest.encoder?.url ?? '')
            .split('/')
            .at(-2);
          delete manifest.encoder;
          delete manifest.encoderStream;
          const refused = mkdtempSync(join(tmpdir(), 'fm-batch-refused-'));
          for (const entry of readdirSync(runtime))
            if (!['manifest.json', 'assets', 'encoder-stream'].includes(entry))
              symlinkSync(join(runtime, entry), join(refused, entry));
          mkdirSync(join(refused, 'assets'));
          for (const entry of readdirSync(join(runtime, 'assets')))
            if (entry !== encoderDir)
              symlinkSync(join(runtime, 'assets', entry), join(refused, 'assets', entry));
          writeFileSync(join(refused, 'manifest.json'), JSON.stringify(manifest));
          const off = await startControl({
            runtime: refused,
            artifact: resolve(built, 'deploy-next'),
            source: artifact.identity.deploySource.buildId,
          });
          const rows: unknown[] = [];
          try {
            for (const [name, width, touch] of WIDTHS) {
              const s = await open(width, touch, name);
              try {
                const { page, operate, shot } = s;
                await page.waitForFunction(() => {
                  const d = (window as unknown as { __elmish: { model: Model } }).__elmish.model
                    .Downloads;
                  return d.known && !d.photoAvailable;
                });
                const batch = page.locator('.next-batch');
                const target = (await read(page)).inputs[1]!.id;
                const requests = s.requests.length;
                await choose(page, target, [FILES.group, saved, FILES.portrait]);
                await batch.waitFor();
                await viewSettled(page);
                const view = await read(page);
                assert.deepEqual(
                  view.batch!.groups.map((g) => [g.role, g.status, g.candidates.length]),
                  [
                    ['photo', 'unavailable', 0],
                    ['recovered', 'ready', 1],
                    ['photo', 'unavailable', 0],
                  ],
                );
                for (const id of ['f0', 'f2'])
                  assert.match(
                    await batch.locator(`[data-next-batch-file="${id}"]`).innerText(),
                    /Photo encoding is not available in this browser/,
                    `${name}: the photo says why`,
                  );
                await shot('refused-view');
                await operate(batch.locator('[data-next-candidate="f1#0"]'));
                await operate(batch.locator('.next-batch-ok'));
                await batch.waitFor({ state: 'detached' });
                await page.waitForFunction(
                  (id) =>
                    (window as unknown as { __elmish: { model: Model } }).__elmish.model.Faces.some(
                      (f) => f.id === id,
                    ),
                  target,
                  { timeout: 60_000 },
                );
                const after = await read(page);
                assert.equal(after.inputs.find((i) => i.id === target)!.mode, 'project');
                const made = s.requests.slice(requests);
                assert.deepEqual(
                  made.filter((p) => DETECTOR.test(p)),
                  [],
                  `${name}: no detector request`,
                );
                assert.deepEqual(made, [], `${name}: no model request`);
                await shot('refused-confirmed');
                assert.deepEqual(s.errors, []);
                rows.push({ name, view: view.batch, requests: made });
                record('refused', rows);
              } finally {
                await s.context.close();
              }
            }
          } finally {
            await off.stop();
          }
        },
      );
  },
);
