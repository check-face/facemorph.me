// fm-gbdt: Help, refusal-reason Help links and the licence links, operated in the identified built application
// (deploy-next/) with the acquired runtime, at phone and desktop width, in real Chromium without WebGPU.
// Every case presses the control where a person sees it (press(): elementFromPoint at its visible centre, then a
// real mouse click or touch tap) and checks the anchor or page it opens; one screenshot per case. By-name clicks
// are setup only. The refusal is real: forcing the WebGPU route in a browser without WebGPU is refused by route
// admission (webgpu-absent), and the shown sentence must be that reason's copy, never an exception's text.
// The licence page is served from hosting/next/notices/, the copy hosting/next-static/stage.py publishes at
// /runtime/notices/ over the runtime mirror's. fm-qoc3: the FAQ entry on the models presses each model licence link
// and reads the served text, and the face-model download consent shows a Model licences link a keyboard reaches.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { reason, type ReasonKey } from '../../src/admission/route-admission.ts';
import { FORMATS_HREF, NOTICES_HREF, helpTopics } from '../../shell/render/help.ts';
import { MODEL_LICENCES } from '../../shell/render/model-licences.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/help');
const NOTICES = join(REPO, 'hosting/next/notices');
const RAW = /\b(Type|Range|Reference|Syntax)?Error\b|\n\s+at \S+:\d+|AdmissionRefused|undefined/;

/** The required Help topics, as a person reads them on the built page. */
const TOPICS: [string, RegExp][] = [
  ['phone-session transfer', /no way to hand a phone session over to a computer/i],
  [
    'moving PNG/WebP to a computer',
    /Save the faces you want as PNG or WebP, move the files across/,
  ],
  ['interruption', /Switching to another app can pause work/],
  ['reload loses unfinished photo retries', /reloading the page loses unfinished photo retries/],
  ['best-effort cache', /as a convenience, not a promise/],
  ['keep an original PNG/WebP', /Keep the original file to reopen or edit a still later/],
  ['PNG/WebP recovery', /the face comes back exactly, without encoding the photo again/],
  ['MP4 512 px fallback', /saves at 512 px instead/],
  ['deferred MP4 reopening', /Reopening a morph project from its MP4 is not available yet/],
  [
    'social apps stripping metadata',
    /Social and messaging apps often recompress shared images and strip that data/,
  ],
  [
    'retired GUID/native/API links',
    /old face ID \(GUID\)[\s\S]*desktop apps are retired[\s\S]*API server is retired/,
  ],
  ['device check guarantees', /does not guarantee the model fits[\s\S]*nor that work keeps going/],
];

/** Whether `el` is in the viewport a person is looking at. */
const inView = (el: Locator) =>
  el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });

test(
  'Help, refusal Help and licence links at their visible positions, phone and desktop',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-gbdt; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const site = await startControl({
      runtime,
      artifact: resolve(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    try {
      for (const [name, width, touch] of [
        ['desktop', 1280, false],
        ['phone', 390, true],
      ] as const) {
        const context = await browser.newContext({
          ...(touch ? devices['iPhone 13'] : {}),
          viewport: { width, height: touch ? 844 : 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
        });
        await context.route(`${ORIGIN}/runtime/notices/**`, async (route) => {
          const file = join(NOTICES, new URL(route.request().url()).pathname.split('/').pop()!);
          if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
          await route.fulfill({
            status: 200,
            body: readFileSync(file),
            contentType: file.endsWith('.html')
              ? 'text/html; charset=utf-8'
              : 'text/plain; charset=utf-8',
          });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const operate = async (control: Locator, follow = true) => {
          const landed = await press(page, control, { touch, follow });
          assert.ok(landed.inside, `${control} was not under the press`);
          return landed;
        };
        const shot = async (caseName: string, full = false) =>
          page.screenshot({ path: join(results, `${name}-${caseName}.png`), fullPage: full });
        const dismissToasts = async () => {
          // The model notice and consent prompt arrive shortly after load, one after the other; dismiss each
          // as a person would until none is left (setup, by name).
          await page
            .locator('.next-consent-toast')
            .first()
            .waitFor({ timeout: 5000 })
            .catch(() => {});
          for (const end = Date.now() + 15_000; Date.now() < end;) {
            const control = page
              .locator('.next-model-toast, .next-failure-toast')
              .getByRole('button', { name: 'Not now' })
              .or(page.getByRole('button', { name: 'Ask me later' }))
              .first();
            if (!(await control.isVisible().catch(() => false))) {
              await page.waitForTimeout(700);
              if (!(await control.isVisible().catch(() => false))) break;
            }
            await control.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(400);
          }
        };
        const ready = async (page: Page) => {
          await page.goto(ORIGIN);
          await page.locator('section.next-face').nth(1).waitFor();
          await page.waitForTimeout(500);
          await dismissToasts();
        };
        const licencePage = async (caseName: string) => {
          await page.waitForURL(`${ORIGIN}${NOTICES_HREF}`);
          const text = await page.locator('body').innerText();
          assert.match(text, /from this site's own runtime files/, caseName);
          assert.match(text, /not fetched from the publisher's CDN/, caseName);
          assert.doesNotMatch(text, /directly from its publisher's CDN/, caseName);
          await shot(caseName);
          await page.goBack();
          await page.locator('section.next-face').nth(1).waitFor();
          await dismissToasts();
        };
        try {
          await ready(page);
          // Presence on the built page: every topic, by its anchor, with the required copy.
          const help = page.locator('.next-help');
          for (const topic of helpTopics())
            assert.equal(
              await page.locator(`details.next-help-topic#${topic.id} > summary`).innerText(),
              topic.title,
            );
          const helpText = await help.evaluate((el) => el.textContent ?? '');
          for (const [topic, pattern] of TOPICS) assert.match(helpText, pattern, topic);
          assert.doesNotMatch(
            await page.locator('.next-product').innerText(),
            /download (the|our) (desktop |native )?app|install (the|our) (desktop|native) app/i,
          );

          // The saved-file format reference (fm-fy2.7): open Keep your originals, press its link.
          const originals = page.locator('details#help-keep-originals');
          await operate(originals.locator('summary'));
          const formats = originals.getByRole('link', { name: 'saved file formats' });
          await formats.scrollIntoViewIfNeeded();
          await shot('help-formats-link');
          const fromFormats = await operate(formats, false);
          assert.equal(fromFormats.href, FORMATS_HREF);

          // The Help licence link: open its topic (a person taps the summary), press the link.
          const licences = page.locator('details#help-licences');
          await operate(licences.locator('summary'));
          assert.equal(await licences.evaluate((d) => (d as HTMLDetailsElement).open), true);
          const helpLink = licences.getByRole('link', { name: 'Read the licences and notices' });
          await shot('help-licence-link');
          // The press is recorded with its navigation stopped (a new document would lose the record),
          // then the page goes where the pressed link points.
          const fromHelp = await operate(helpLink, false);
          assert.equal(fromHelp.href, `${ORIGIN}${NOTICES_HREF}`);
          await page.goto(fromHelp.href!);
          await licencePage('help-licence-page');

          // The footer licence link.
          const footerLink = page.locator('footer.next-footer').getByRole('link', {
            name: 'Licences and notices',
          });
          await footerLink.scrollIntoViewIfNeeded();
          await shot('footer-licence-link');
          const fromFooter = await operate(footerLink, false);
          assert.equal(fromFooter.href, `${ORIGIN}${NOTICES_HREF}`);
          await page.goto(fromFooter.href!);
          await licencePage('footer-licence-page');

          // fm-qoc3: the FAQ entry on the models links each model licence text served beside the weights.
          const models = page.locator('details#models');
          await operate(models.locator('summary'));
          assert.equal(await models.evaluate((d) => (d as HTMLDetailsElement).open), true);
          assert.match(
            await models.innerText(),
            /StyleGAN2[\s\S]*NVIDIA[\s\S]*FFHQ[\s\S]*e4e[\s\S]*non-commercial use under their own licences/,
          );
          await models.scrollIntoViewIfNeeded();
          await shot('faq-models');
          for (const licence of MODEL_LICENCES) {
            if (!(await models.evaluate((d) => (d as HTMLDetailsElement).open)))
              await operate(models.locator('summary'));
            const link = models.getByRole('link', { name: licence.title, exact: true });
            const landed = await operate(link, false);
            assert.equal(landed.href, `${ORIGIN}${licence.href}`);
            const response = await page.goto(landed.href!);
            assert.equal(response?.status(), 200, licence.href);
            const file = licence.href.slice('/runtime/notices/'.length).split('#')[0]!;
            assert.ok((await response!.body()).equals(readFileSync(join(NOTICES, file))), file);
            await shot(`faq-licence-${licence.href.replace(/\W+/g, '-')}`);
            await page.goBack();
            await page.locator('section.next-face').nth(1).waitFor();
            await dismissToasts();
          }

          // A real refusal: force WebGPU where the browser has none, then generate a face.
          await dismissToasts();
          await operate(page.getByRole('button', { name: 'More options' }));
          await operate(page.getByText('Advanced', { exact: true }));
          await page.getByLabel('Processing mode').selectOption('webgpu'); // setup
          await page.keyboard.press('Escape');
          const tile = page.locator('section.next-face').nth(1);
          await operate(tile.locator('.next-field input'));
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText('help');
          await operate(tile.locator('.next-input-row .next-face-generate'));
          // First use asks before the face model downloads; the refusal comes from route admission after it.
          const gate = page.getByRole('button', { name: 'Download and continue' });
          await gate.waitFor({ timeout: 10_000 });
          // fm-qoc3: the consent dialog names the model licences: a link in the dialog's accessibility tree that
          // Tab reaches and Enter opens (in a new tab, so the dialog stays), and that a press lands on.
          const consent = page.getByRole('dialog', { name: 'Download the face model?' });
          const modelLicences = consent.getByRole('link', { name: 'Model licences', exact: true });
          assert.equal(await modelLicences.getAttribute('href'), NOTICES_HREF);
          let reached = false;
          for (let i = 0; i < 8 && !reached; i++) {
            await page.keyboard.press('Tab');
            reached = await modelLicences.evaluate((e) => e === document.activeElement);
          }
          assert.ok(reached, 'Tab reaches the Model licences link in the consent dialog');
          await shot('consent-model-licences');
          const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.keyboard.press('Enter'),
          ]);
          await popup.waitForLoadState();
          assert.equal(popup.url(), `${ORIGIN}${NOTICES_HREF}`);
          assert.match(
            await popup.locator('body').innerText(),
            /Model terms[\s\S]*FFHQ dataset terms/,
          );
          await popup.close();
          assert.ok(await gate.isVisible(), 'the consent dialog stays open');
          const fromConsent = await operate(modelLicences, false);
          assert.equal(fromConsent.href, `${ORIGIN}${NOTICES_HREF}`);
          await operate(gate);
          const box = page.locator('.next-error');
          await box.waitFor({ timeout: 180_000 });
          await dismissToasts();
          // Which WebGPU refusal depends on the browser build (no navigator.gpu, or no adapter); both are
          // the WebGPU route's reasons, and the shown sentence must be exactly that reason's copy.
          const why = box.getByRole('link', { name: 'Why, and what to try' });
          const key = (await why.getAttribute('data-next-reason')) as ReasonKey;
          assert.ok(['webgpu-absent', 'webgpu-no-adapter'].includes(key), key);
          const refusal = reason(key);
          console.log(`# ${name}: refused with ${key}`);
          assert.equal(await box.locator('p').first().innerText(), refusal.text);
          assert.doesNotMatch(await page.locator('.next-product').innerText(), RAW);
          // The link sits in the error panel a person is reading, under the sentence it explains.
          const [sentence, link] = await Promise.all([
            box.locator('p').first().boundingBox(),
            why.boundingBox(),
          ]);
          assert.ok(sentence && link && link.y >= sentence.y + sentence.height - 1);
          await why.scrollIntoViewIfNeeded();
          await shot('refusal-help-link');
          const landed = await operate(why);
          assert.equal(landed.href, `${ORIGIN}/${refusal.helpAnchor}`);
          await page.waitForFunction((h) => location.hash === h, refusal.helpAnchor);
          const target = page.locator(refusal.helpAnchor);
          assert.equal(await target.evaluate((d) => (d as HTMLDetailsElement).open), true);
          await page.waitForTimeout(300);
          assert.ok(await inView(target.locator('summary')), 'the opened topic is on screen');
          assert.match(
            await target.innerText(),
            /set Processing mode[\s\S]*back to Automatic or CPU/,
          );
          assert.equal(refusal.helpAnchor, '#help-webgpu-route');
          await shot('refusal-help-topic');

          // Optional selector Help links (#computer-requirements, #supported-browsers) belong to the
          // face selector (face.selector-names). Press each one the built page renders.
          for (const id of ['computer-requirements', 'supported-browsers']) {
            const links = page.locator(`a[href="#${id}"]:visible`);
            const count = await links.count();
            if (count === 0) {
              console.log(
                `# untested: no rendered selector link to #${id} in this build (face.selector-names)`,
              );
              continue;
            }
            for (let i = 0; i < count; i++) {
              await operate(links.nth(i));
              await page.waitForFunction((h) => location.hash === h, `#${id}`);
              assert.equal(
                await page.locator(`#${id}`).evaluate((d) => (d as HTMLDetailsElement).open),
                true,
              );
              await shot(`selector-${id}-${i}`);
            }
          }
          assert.deepEqual(errors, []);
        } catch (error) {
          await shot('failure', true).catch(() => {});
          throw error;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);
