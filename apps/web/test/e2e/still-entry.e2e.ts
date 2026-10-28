// fm-4f5m: still-recovery classification through the face card's own file entry and drops, in the identified
// build:next destination with the real bridge and CPU synthesis. A face saved by the app reinstalls with no model
// or detector request; a still from another model, a damaged one and one of an unreadable version are held by
// the face as media (Save hands over the opened bytes; never computed with); a plain photo opens the confirmed
// crop and encodes nothing until OK; a mixed drop is classified before any face changes.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { futureSchemaPng } from '../support/recovery-stills.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
// The built artifact: deploy-next/ under FACEMORPH_DEPLOY_OUT, as the other built-app suites take it.
const built = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/still-entry');
const stills = join(REPO, 'apps/web/test/fixtures/verify/stills');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;

interface Model {
  Busy: boolean;
  Status: string;
  PreparingFaces: Set<string>;
  Faces: { id: string }[];
  Inputs: { id: string; mode: string; value: string }[];
  Held?: Map<
    string,
    { kind: string; reason: { reasonKey: string; text: string }; photoAction: boolean }
  >;
  Crop: unknown;
}
const model = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
    return {
      Busy: m.Busy,
      Status: m.Status,
      preparing: m.PreparingFaces.size,
      faces: m.Faces.map((f) => f.id),
      inputs: m.Inputs.map(({ id, mode, value }) => ({ id, mode, value })),
      held: [...(m.Held ?? new Map()).entries()].map(([id, h]) => ({
        id,
        kind: h.kind,
        reasonKey: h.reason.reasonKey,
        text: h.reason.text,
        photoAction: h.photoAction,
      })),
      crop: m.Crop !== null,
    };
  });
const settled = (page: Page) =>
  page.waitForFunction(
    () => {
      const m = (window as unknown as { __elmish: { model: Model } }).__elmish.model;
      return !m.Busy && m.PreparingFaces.size === 0;
    },
    null,
    { timeout: 120_000 },
  );

test(
  'still entry classifies every file before a face changes (desktop and phone)',
  { timeout: 1_200_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-4f5m; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(built);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: resolve(built, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    // Files: real fixtures, a damaged pair (bit-flipped metadata, truncated pixels), a future-schema PNG, a camera
    // JPEG, and below a face this app saves itself.
    const v2 = readFileSync(join(stills, 'recovery-v2.png'));
    const files = {
      mismatch: join(stills, 'model-mismatch-v2.png'),
      flipped: join(stills, 'damaged-v1.png'),
      truncated: join(results, 'truncated-v2.png'),
      header: join(results, 'header-only-v2.png'),
      future: join(results, 'future-schema-9.png'),
      photo: join(REPO, 'tests/crop/fixtures/non-square.jpg'),
      saved: join(results, 'saved-hello.webp'),
    };
    writeFileSync(files.truncated, v2.subarray(0, Math.floor(v2.length / 2)));
    writeFileSync(files.header, v2.subarray(0, 200));
    writeFileSync(files.future, futureSchemaPng(9));
    const evidence: Record<string, unknown> = {};
    try {
      // Setup in its own context: the app makes face 1 ("hello") on the CPU and saves it. The measured contexts
      // below are fresh, so a reinstall that needed a model would have to request it.
      {
        const context = await browser.newContext({
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
        });
        await context.addInitScript(INSTALL_HOOK);
        const page = await context.newPage();
        await page.goto(ORIGIN);
        const tile = page.locator('section.next-face').nth(0);
        await tile.waitFor();
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
            await control.click(); // setup
        await page.getByRole('button', { name: 'More options' }).click(); // setup
        await page.getByLabel('Processing mode').selectOption('cpu');
        await tile.getByRole('button', { name: /^Generate/ }).click(); // setup
        const accept = page.locator('.next-download-accept');
        while (
          await accept.waitFor({ timeout: 6000 }).then(
            () => true,
            () => false,
          )
        ) {
          await accept.click(); // setup
          await accept.waitFor({ state: 'detached' });
        }
        await page.waitForFunction(
          () =>
            (window as unknown as { __elmish: { model: Model } }).__elmish.model.Faces.some(
              (f) => f.id === 'face-1',
            ),
          null,
          { timeout: 900_000, polling: 1000 },
        );
        await settled(page);
        const download = page.waitForEvent('download');
        await tile.getByRole('button', { name: 'Save image', exact: true }).click(); // setup
        writeFileSync(files.saved, readFileSync((await (await download).path())!));
        await context.close();
      }
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          acceptDownloads: true,
        });
        await context.addInitScript(INSTALL_HOOK);
        const page = await context.newPage();
        const errors: string[] = [];
        const modelRequests: string[] = [];
        const logs: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (m) => {
          if (m.text().startsWith('[still-entry]')) logs.push(m.text());
        });
        page.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (MODEL.test(path)) modelRequests.push(path);
        });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
        const shot = (caseName: string) =>
          page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: true });
        const tiles = page.locator('section.next-face');
        /** The card's own chooser (its empty-image Encode image button or the Change mode menu). */
        const choose = async (tile: Locator, paths: string[]) => {
          const empty = tile
            .locator('.next-face-image')
            .getByRole('button', { name: 'Encode image', exact: true });
          const chooser = page.waitForEvent('filechooser');
          if (await empty.count()) await operate(empty);
          else {
            await operate(tile.getByRole('button', { name: 'Change mode', exact: true }));
            const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
            await entry.evaluate(async (el) => {
              const panel = el.closest('.MuiPaper-root');
              await Promise.allSettled(
                (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
              );
            });
            await operate(entry);
          }
          await (await chooser).setFiles(paths);
          await settled(page);
        };
        const save = async (tile: Locator) => {
          const download = page.waitForEvent('download');
          await operate(tile.getByRole('button', { name: 'Save image', exact: true }));
          return readFileSync((await (await download).path())!);
        };
        const decodes = (path: string) =>
          page.evaluate(
            async (bytes) =>
              createImageBitmap(new Blob([new Uint8Array(bytes)])).then(
                (b) => (b.close(), true),
                () => false,
              ),
            [...readFileSync(path)],
          );
        try {
          await page.goto(ORIGIN);
          await tiles.nth(1).waitFor();
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
          await operate(page.getByRole('button', { name: 'More options' }));
          await page.getByLabel('Processing mode').selectOption('cpu');

          // 1. matching: the app's own saved face reinstalls with no model or detector request.
          let before = modelRequests.length;
          await choose(tiles.nth(1), [files.saved]);
          await tiles.nth(1).locator('img.next-face-img').waitFor();
          let m = await model(page);
          assert.equal(m.inputs[1]?.mode, 'project', `${name}: the saved face is restored`);
          assert.ok(m.faces.includes('face-2'));
          assert.deepEqual(
            modelRequests.slice(before),
            [],
            `${name}: a recovered still requests no model`,
          );
          assert.equal(
            await page.locator('.next-download-dialog').count(),
            0,
            `${name}: a recovered still on a cold profile asks no download question (fm-9kr8)`,
          );
          await shot('01-matching');

          // 2. other model: shown, Save is the opened bytes, Morph leaves it out, nothing is requested.
          before = modelRequests.length;
          await choose(tiles.nth(1), [files.mismatch]);
          const heldImage = tiles.nth(1).locator('img[data-next-held="unknown-model"]');
          await heldImage.waitFor();
          m = await model(page);
          assert.equal(m.held[0]?.kind, 'unknown-model');
          assert.equal(m.held[0]?.reasonKey, 'still-model-unknown');
          assert.ok(!m.faces.includes('face-2'), `${name}: the held still is not a computed face`);
          const reason = tiles.nth(1).locator('.next-face-held');
          assert.match(await reason.innerText(), /model this version does not know/);
          assert.deepEqual(
            await save(tiles.nth(1)),
            readFileSync(files.mismatch),
            `${name}: Save hands over the opened bytes`,
          );
          await operate(page.getByRole('button', { name: 'Create morph' }));
          await page.waitForTimeout(500);
          m = await model(page);
          assert.equal(m.Busy, false, `${name}: no morph runs with the held face`);
          assert.match(m.Status, /Add another face to morph\..*left out of morphs/);
          assert.deepEqual(
            modelRequests.slice(before),
            [],
            `${name}: zero requests caused by the file`,
          );
          await shot('02-model-mismatch');

          // 3. unreadable version: viewable and saveable, the version named.
          before = modelRequests.length;
          await choose(tiles.nth(1), [files.future]);
          await tiles.nth(1).locator('img[data-next-held="incompatible-schema"]').waitFor();
          assert.match(await reason.innerText(), /version 9/);
          assert.deepEqual(await save(tiles.nth(1)), readFileSync(files.future));
          assert.deepEqual(modelRequests.slice(before), []);
          await shot('03-incompatible-schema');

          // 4. damaged: face 1 keeps its identity; Use as photo only when the pixels decode.
          for (const [kind, path] of [
            ['flipped', files.flipped],
            ['truncated', files.truncated],
            ['header', files.header],
          ] as const) {
            before = modelRequests.length;
            const kept = (await model(page)).inputs[0];
            await choose(tiles.nth(0), [path]);
            await tiles.nth(0).locator('.next-face-held[data-next-held="damaged"]').waitFor();
            m = await model(page);
            assert.deepEqual(m.inputs[0], kept, `${name}/${kind}: identity unchanged`);
            assert.match(m.held.find((h) => h.id === 'face-1')!.reasonKey, /^still-damaged-/);
            const offered = await tiles
              .nth(0)
              .getByRole('button', { name: 'Use as photo' })
              .count();
            assert.equal(
              offered === 1,
              await decodes(path),
              `${name}/${kind}: Use as photo iff the pixels decode`,
            );
            assert.equal(m.crop, false, 'never silently a photo');
            assert.deepEqual(modelRequests.slice(before), []);
            evidence[`${name}/${kind}`] = {
              reasonKey: m.held.find((h) => h.id === 'face-1')!.reasonKey,
              useAsPhoto: offered === 1,
            };
            await shot(`04-damaged-${kind}`);
          }

          assert.equal(
            (evidence[`${name}/header`] as { useAsPhoto: boolean }).useAsPhoto,
            false,
            `${name}: a still whose pixels do not decode offers no Use as photo`,
          );

          // 5. missing: a camera JPEG opens the confirmed crop and encodes nothing until OK.
          before = modelRequests.length;
          await choose(tiles.nth(1), [files.photo]);
          const dialog = page.getByRole('dialog', { name: 'Encode an image', exact: true });
          await dialog.locator('.next-encode-preview img').waitFor();
          await page.waitForTimeout(1000);
          assert.deepEqual(
            modelRequests.slice(before),
            [],
            `${name}: no encoder or detector before OK`,
          );
          await shot('05-missing-crop');
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });

          // 6. a mixed drop on the page: every file classified before any face changes, in drop order; several
          // files open the batch view (fm-id4c, fm-q5b9), where the damaged still offers only an explicit Use as photo.
          before = modelRequests.length;
          const facesBefore = await tiles.count();
          const inputsBefore = (await model(page)).inputs;
          const dropFiles = [files.mismatch, files.future, files.flipped];
          await page.evaluate(
            async (list) => {
              const dt = new DataTransfer();
              for (const [n, bytes] of list)
                dt.items.add(new File([new Uint8Array(bytes)], n, { type: 'image/png' }));
              const target = document.querySelector('main.next-product')!;
              target.dispatchEvent(
                new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
              );
              target.dispatchEvent(
                new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }),
              );
            },
            dropFiles.map((p, i) => [`drop-${i}.png`, [...readFileSync(p)]] as const),
          );
          const batch = page.locator('.next-batch');
          await batch.waitFor();
          assert.deepEqual(
            await batch
              .locator('[data-next-batch-file]')
              .evaluateAll((groups) => groups.map((g) => g.getAttribute('data-next-batch-role'))),
            ['held', 'held', 'damaged'],
            'classified in drop order',
          );
          const damaged = batch.locator('[data-next-batch-file="f2"]');
          assert.equal(await damaged.locator('[data-next-candidate]').count(), 0);
          assert.equal(
            await damaged.getByRole('button', { name: 'Use as photo' }).count(),
            1,
            'the damaged still offers Use as photo only as its own explicit action',
          );
          assert.equal((await model(page)).inputs.length, inputsBefore.length, 'no face changes');
          await shot('06-mixed-drop-batch');
          for (const candidate of ['f0#0', 'f1#0'])
            await operate(batch.locator(`[data-next-candidate="${candidate}"]`));
          await operate(batch.getByRole('button', { name: 'Add 2 faces' }));
          await batch.waitFor({ state: 'detached' });
          await settled(page);
          m = await model(page);
          const empty = inputsBefore.find(
            (i) => i.mode !== 'photo' && i.mode !== 'project' && !i.value.trim(),
          );
          const added = m.inputs
            .map((i) => i.id)
            .filter((id) => id === empty?.id || !inputsBefore.some((old) => old.id === id));
          assert.equal(m.inputs.length, facesBefore + (empty ? 1 : 2));
          assert.deepEqual(
            added.map((id) => m.held.find((h) => h.id === id)?.kind),
            ['unknown-model', 'incompatible-schema'],
            'held in pick order; the damaged still was not added',
          );
          assert.deepEqual(modelRequests.slice(before), []);
          await shot('06-mixed-drop');
          const lines = logs.map((l) => JSON.parse(l.slice('[still-entry] '.length)));
          assert.ok(
            lines.every(
              (l) => Object.keys(l).join() === 'index,bytes,kind,reasonKey,target,revision,applied',
            ),
          );
          assert.ok(!logs.some((l) => /\.png|\.webp|\.jpg/.test(l)), 'no file names in the log');
          evidence[name] = { classifications: lines.length, modelRequests: modelRequests.length };
          assert.deepEqual(errors, []);
        } catch (error) {
          await shot('failure').catch(() => {});
          throw error;
        } finally {
          await context.close().catch(() => {});
        }
      }
    } finally {
      await browser.close();
      await site.stop();
      writeFileSync(join(results, 'evidence.json'), JSON.stringify(evidence, null, 1));
    }
  },
);
