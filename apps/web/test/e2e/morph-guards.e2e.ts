// fm-fy2.9 (morph.guards): Morph acceptance refusals and disclosures in the identified, composed application
// (deploy-next, real bridge and runtime bytes, Chromium with WebGPU disabled). Each control is pressed at its
// visible centre after elementFromPoint shows it is there (support/operate.ts); by-name clicks are setup only.
// Cases, at 1280 px (mouse) and 390 px (touch):
//   - identical neighbours: A,B,A (closing pair) and the same word twice refuse in Morph status with zero
//     model requests; changing face 3 clears the refusal and Morph proceeds (then is cancelled);
//   - word inputs that feed the rule: empty and very long words keep their own messages; pasted duplicates
//     refuse like typed ones;
//   - faces at 8, 64 and 150 with a repeat refuse naming the faces;
//   - over the frame budget: 129 faces at Length long (4,128 frames) refuse naming the limit and the estimate;
//   - no MP4 route: WebCodecs removed and the runtime manifest served without its FFmpeg codec explains in
//     Morph status before any synthesis;
//   - size disclosure (fm-36ag): with WebCodecs answering only up to 768, Full quality says the MP4 will be
//     768 × 768 before frames start, and the Standard default (512 × 512) says nothing.
//   FACEMORPH_DEPLOY_OUT=<dir with deploy-next/> node --test test/e2e/morph-guards.e2e.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/morph-guards');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;

const NO_WEBCODECS = () => {
  delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
};
const AT_MOST_768 = () => {
  const encoder = (
    globalThis as unknown as {
      VideoEncoder?: {
        isConfigSupported: (c: { width: number }) => Promise<{ supported: boolean }>;
      };
    }
  ).VideoEncoder;
  if (!encoder) return;
  const original = encoder.isConfigSupported.bind(encoder);
  encoder.isConfigSupported = async (config) =>
    config.width > 768 ? { supported: false } : original(config);
};

test(
  'Morph status refusals and disclosures at visible positions, before any model request',
  { timeout: 1_200_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-fy2.9; run on the runtime lane`;
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
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const open = async (init?: () => void, manifestWithoutCodec = false) => {
          const context = await browser.newContext({
            ...(touch ? devices['iPhone 13'] : {}),
            viewport: { width, height: 900 },
            hasTouch: touch,
            isMobile: touch,
            ignoreHTTPSErrors: true,
            permissions: ['clipboard-read', 'clipboard-write'],
          });
          await context.addInitScript(INSTALL_HOOK);
          if (init) await context.addInitScript(init);
          if (manifestWithoutCodec)
            await context.route('**/runtime/manifest.json', async (route) => {
              const response = await route.fetch();
              const manifest = (await response.json()) as Record<string, unknown>;
              delete manifest['codec'];
              await route.fulfill({ response, json: manifest });
            });
          const page = await context.newPage();
          const errors: string[] = [];
          const models: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (MODEL.test(path)) models.push(path);
          });
          await page.goto(ORIGIN);
          await page.locator('section.next-face').nth(1).waitFor();
          const operate = async (control: Locator) =>
            assert.ok((await press(page, control, { touch })).inside, `${name}: ${control}`);
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
          await page.getByRole('button', { name: 'More options' }).click(); // setup
          await page.getByLabel('Processing mode').selectOption('cpu'); // setup
          await page.getByRole('button', { name: 'More options' }).click(); // setup: close
          return { context, page, errors, models, operate };
        };
        type Session = Awaited<ReturnType<typeof open>>;
        const tiles = (s: Session) => s.page.locator('section.next-face');
        const field = (s: Session, i: number) => tiles(s).nth(i).locator('.next-field input');
        const type = async (s: Session, i: number, value: string) => {
          await s.operate(field(s, i));
          await s.page.keyboard.press('Control+A');
          await s.page.keyboard.press('Backspace');
          if (value) await s.page.keyboard.insertText(value);
          assert.equal(await field(s, i).inputValue(), value);
        };
        const paste = async (s: Session, i: number, value: string) => {
          await s.page.evaluate((v) => navigator.clipboard.writeText(v), value);
          await s.operate(field(s, i));
          await s.page.keyboard.press('Control+A');
          await s.page.keyboard.press('Backspace');
          await s.page.keyboard.press('Control+V');
          assert.equal(await field(s, i).inputValue(), value);
        };
        const faces = async (s: Session, values: readonly string[]) => {
          while ((await tiles(s).count()) < values.length)
            await s.operate(s.page.getByRole('button', { name: 'Add face' }));
          for (const [i, value] of values.entries()) await type(s, i, value);
        };
        const status = (s: Session) => s.page.locator('.next-morph-slot .next-status');
        const morph = (s: Session) => s.operate(s.page.locator('.next-primary-action'));
        const shot = (s: Session, caseName: string) =>
          s.page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: true });
        // Morph passes acceptance: the download question (first use) or the job itself follows.
        const proceed = async (s: Session) => {
          await morph(s);
          await s.page.waitForFunction(
            () =>
              !!document.querySelector('.next-product[data-next-busy=true], .next-download-accept'),
            null,
            { timeout: 30_000 },
          );
          const accept = s.page.locator('.next-download-accept');
          if (await accept.isVisible()) await s.operate(accept);
          await s.page.waitForFunction(
            () => !!document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 30_000 },
          );
        };
        // An invalid word still meets the existing download question first (gate before input checks);
        // it is answered Cancel, which acquires nothing.
        const dismissQuestion = async (s: Session) => {
          const dialog = s.page.locator('.next-download-dialog');
          if (await dialog.isVisible())
            await s.operate(dialog.getByRole('button', { name: 'Cancel' }));
        };
        const refusal = async (s: Session, caseName: string, expected: RegExp) => {
          await morph(s);
          await s.page
            .waitForFunction(
              (pattern) =>
                new RegExp(pattern).test(
                  document.querySelector('.next-morph-slot .next-status')?.textContent ?? '',
                ),
              expected.source,
              { timeout: 30_000 },
            )
            .catch(async (error: unknown) => {
              await shot(s, `${caseName}-FAILED`);
              const seen = await status(s)
                .innerText()
                .catch(() => '?');
              throw Error(
                `${name} ${caseName}: Morph status was ${JSON.stringify(seen)}; models ${s.models.length}; errors ${s.errors.join(' | ')}`,
                { cause: error },
              );
            });
          await shot(s, caseName);
          assert.deepEqual(s.models, [], `${name} ${caseName}: zero model requests`);
          assert.equal(
            await s.page.locator('.next-product[data-next-busy=true]').count(),
            0,
            `${name} ${caseName}: not busy`,
          );
        };

        // Identical neighbours: A,B,A, the closing pair.
        {
          const s = await open();
          await faces(s, ['alpha words', 'beta words', 'alpha words']);
          await refusal(
            s,
            'aba',
            /^Faces 3 and 1 are the same, and the loop goes from face 3 back to face 1\. Change one of them or add a different face between them\.$/,
          );
          // Changing face 3 clears the refusal, and Morph proceeds (then is cancelled).
          await type(s, 2, 'gamma words');
          await s.page.waitForFunction(
            () => document.querySelector('.next-morph-slot .next-status')?.textContent === '',
            null,
            { timeout: 10_000 },
          );
          await shot(s, 'aba-cleared');
          await proceed(s);
          await shot(s, 'aba-cleared-proceeds');
          await s.operate(
            s.page.locator('.next-morph-slot').getByRole('button', { name: 'Cancel' }),
          );
          await s.page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 300_000 },
          );
          assert.deepEqual(s.errors, []);
          await s.context.close();
        }
        // The same word twice, typed and pasted; empty and very long words keep their own messages.
        {
          const s = await open();
          await faces(s, ['same word', 'same word']);
          await refusal(
            s,
            'same-word-twice',
            /^Faces 1 and 2 are the same, and they are next to each other in the loop\./,
          );
          await paste(s, 1, 'pasted word');
          await paste(s, 0, 'pasted word');
          await refusal(s, 'pasted-twice', /^Faces 1 and 2 are the same/);
          await type(s, 1, '');
          await shot(s, 'empty-word');
          assert.equal(
            await s.page
              .locator('.next-primary-action')
              .isDisabled()
              .catch(() => false),
            false,
          );
          await morph(s);
          await s.page.waitForTimeout(1000);
          await dismissQuestion(s);
          assert.doesNotMatch(await status(s).innerText(), /are the same/, 'empty is not a repeat');
          assert.deepEqual(s.models, [], 'empty refused before any model request');
          const long = 'x'.repeat(600);
          await type(s, 0, long);
          await type(s, 1, long);
          await shot(s, 'very-long-words');
          await morph(s);
          await s.page.waitForTimeout(1000);
          await dismissQuestion(s);
          assert.doesNotMatch(
            await status(s).innerText(),
            /are the same/,
            'too long is refused as too long',
          );
          assert.deepEqual(s.models, []);
          await s.context.close();
        }
        // Many faces (8) with a repeat in the middle.
        {
          const s = await open();
          const eight = ['one', 'two', 'three', 'four', 'four', 'six', 'seven', 'eight'].map(
            (w) => `${w} face`,
          );
          await faces(s, eight);
          await refusal(s, 'eight-faces', /^Faces 4 and 5 are the same/);
          await s.context.close();
        }
        // 64 and 150 faces (no fixed face count, fm-id4c) with the last two the same.
        for (const count of [64, 150]) {
          const s = await open();
          const many = Array.from({ length: count }, (_, i) => `face number ${i + 1}`);
          many[count - 1] = many[count - 2]!;
          await faces(s, many);
          await refusal(
            s,
            `faces-${count}`,
            new RegExp(`^Faces ${count - 1} and ${count} are the same`),
          );
          await s.context.close();
        }
        // Over the frame budget: 129 faces at Length long are 4,128 frames; the reason names both, with the way out.
        {
          const s = await open();
          await faces(
            s,
            Array.from({ length: 129 }, (_, i) => `budget face ${i + 1}`),
          );
          await s.page.getByRole('button', { name: 'More options' }).click(); // setup
          await s.page.getByLabel('Morph length').selectOption('32'); // setup
          await s.page.getByRole('button', { name: 'More options' }).click(); // setup: close
          await refusal(
            s,
            'over-budget',
            /^This morph would need 4,128 frames, over the 4,096-frame limit for one morph\. Choose a shorter Length under More options to reduce it\. Your selected faces are kept\.$/,
          );
          assert.equal(await tiles(s).count(), 129, `${name}: the selected faces are kept`);
          await s.context.close();
        }
        // No MP4 route: no WebCodecs and no FFmpeg codec in the manifest.
        {
          const s = await open(NO_WEBCODECS, true);
          await faces(s, ['alpha words', 'beta words']);
          await refusal(
            s,
            'no-mp4-route',
            /cannot make the MP4 video for a morph.*ready faces can still be saved/,
          );
          assert.doesNotMatch(await s.page.locator('.next-product').innerText(), /video is ready/i);
          await s.context.close();
        }
        // Size disclosure before frames start (fm-36ag): Standard says nothing; Full quality held to 768 says so.
        for (const quality of ['standard', 'full'] as const) {
          const s = await open(AT_MOST_768);
          await faces(s, ['alpha words', 'beta words']);
          if (quality === 'full') {
            await s.page.getByRole('button', { name: 'More options' }).click(); // setup
            await s.page.getByLabel('Video size').selectOption('full'); // setup
            await s.page.getByRole('button', { name: 'More options' }).click(); // setup: close
          }
          await proceed(s);
          if (quality === 'full')
            await s.page
              .waitForFunction(
                () =>
                  /can make up to 768 × 768, so this morph’s MP4 will be 768 × 768/.test(
                    document.querySelector('.next-morph-slot .next-status')?.textContent ?? '',
                  ),
                null,
                { timeout: 30_000 },
              )
              .catch(async (error: unknown) => {
                await shot(s, 'disclosure-full-FAILED');
                throw Error(
                  `${name} full: Morph status was ${JSON.stringify(await status(s).innerText())}`,
                  { cause: error },
                );
              });
          else {
            await s.page.waitForTimeout(3000);
            assert.doesNotMatch(await status(s).innerText(), /can make up to|smaller video/);
          }
          await shot(s, `disclosure-${quality}`);
          await s.operate(
            s.page.locator('.next-morph-slot').getByRole('button', { name: 'Cancel' }),
          );
          await s.page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 300_000 },
          );
          await s.context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);
