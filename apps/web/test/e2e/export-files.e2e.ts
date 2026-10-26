// fm-eeki: Save and Share in the identified built application hand over one prepared file per result. Real CPU
// synthesis of a typed name, then Save, Save again and Share (Chromium has no system share, so Share saves):
// one filename from the export identity (`emma-<suffix>.webp`), the same WebP bytes each time, and no image
// encoder started for the repeats. A different name is a different export with a different filename.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { typeMatchesBytes } from '../../src/media/export-policy.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/export-files');
const SUFFIX = '[bcdfghjkmnpqrstvwxz2-9]{6}';

test(
  'repeat Save and Share reuse the prepared file and its identity filename; no second encode',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-eeki; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const encoders: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('worker', (w) => {
        if (/image-encoder/.test(w.url())) encoders.push(w.url());
      });
      const operate = async (control: Locator) => assert.ok((await press(page, control)).inside);
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
      await operate(page.getByRole('button', { name: 'More options' }));
      await page.getByLabel('Processing mode').selectOption('cpu');
      const tile = page.locator('section.next-face').nth(1);
      const generate = async (value: string) => {
        const field = tile.locator('.next-field input');
        await operate(field);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(value);
        await operate(tile.locator('.next-input-row .next-face-generate'));
        const accept = page.locator('.next-download-accept');
        if (
          await accept.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        )
          await operate(accept);
        await page.waitForFunction(
          () =>
            document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
            'filled',
          null,
          { timeout: 180_000 },
        );
        await idle(page);
      };
      const hand = async (button: 'Save image' | 'Share image', as: string) => {
        const saved = page.waitForEvent('download');
        await operate(tile.getByRole('button', { name: button, exact: true }));
        const file = await saved;
        const path = join(results, `${as}-${file.suggestedFilename()}`);
        await file.saveAs(path);
        return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
      };

      await generate('Emma');
      const first = await hand('Save image', 'first');
      const encodersAfterFirst = encoders.length;
      const second = await hand('Save image', 'second');
      const share = (await tile.getByRole('button', { name: 'Share image', exact: true }).count())
        ? await hand('Share image', 'share')
        : null;
      assert.match(first.name, new RegExp(`^emma-${SUFFIX}\\.webp$`), first.name);
      assert.ok(
        typeMatchesBytes(first.bytes, { mime: 'image/webp', filename: first.name }),
        'WebP bytes, .webp name',
      );
      assert.equal(second.name, first.name);
      assert.deepEqual(second.bytes, first.bytes, 'the same prepared bytes');
      if (share) {
        assert.equal(share.name, first.name);
        assert.deepEqual(share.bytes, first.bytes);
      }
      assert.equal(encoders.length, encodersAfterFirst, 'no image encoder started for a repeat');

      await generate('Noah');
      const noah = await hand('Save image', 'noah');
      assert.match(noah.name, new RegExp(`^noah-${SUFFIX}\\.webp$`), noah.name);
      assert.notDeepEqual(noah.bytes, first.bytes);
      assert.deepEqual(errors, []);
      t.diagnostic(
        `files: ${first.name}, ${second.name}, ${share?.name ?? 'no Share control'}, ${noah.name}`,
      );
      await context.close();
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);

function idle(page: Page) {
  return page.waitForFunction(
    () => !document.querySelector('.next-product[data-next-busy=true]'),
    null,
    {
      timeout: 180_000,
    },
  );
}
