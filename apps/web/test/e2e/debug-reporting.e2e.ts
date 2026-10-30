// fm-szbf: the debug-report disclosure, the report toast's labels and the privacy text, in real Chromium on the
// shipped destination (deploy-next from `npm run build:next`; CPU, WebGPU off). The diagnostics collector
// (https://next.facemorph.me/diagnostics/events) is intercepted at the browser and answered locally, so every
// request the page sends there is recorded with its body and nothing reaches a real collector.
//  1. Restore: a saved On, Off and No thanks each paint first as themselves (first-paint DOM record and a 100 ms
//     screenshot series), a throwing localStorage shows the tab-only line and reloads Off.
//  2. Operated footer "Privacy & reports" and FAQ links open the disclosure and focus its checkbox; Space and the
//     label toggle it; the privacy entry names every outside request class and what a saved file carries; no
//     debug control sits in a face, Morph options or the output controls; no "30 days" or deletion promise.
//  3. First visit with 1, 2, 3 and 8 faces: at most one prompt, and nothing covers Create morph or a face action.
//  4. A job journey: a failed attempt's "Send this report" uploads only its own records and leaves the stored
//     choice alone; withdrawal during a job aborts the pending send, discards the unsent batch, its session mirror
//     and the grouping ID, and the job completes; after Off nothing more is sent; "Turn on debug reporting" is
//     standing On and the footer link withdraws it; every host the journey contacts is in the privacy text.
// 390 px (touch) and 1,280 px (mouse), light and dark; screenshots in test-results/debug-reporting/.
//   FACEMORPH_REQUIRE_RUNTIME=1 node --test test/e2e/debug-reporting.e2e.ts
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  startControl,
  ORIGIN,
  ORIGIN_HOST,
  PORT,
  chromiumArgs,
  REPO,
} from '../parity/control-server.ts';
import { startCapture } from '../support/stats-capture.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { OUTSIDE_REQUESTS } from '../../src/controller/outside-requests.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/debug-reporting');
// The built artifact: deploy-next/ under FACEMORPH_DEPLOY_OUT, as the other built-app suites take it.
const built = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
mkdirSync(results, { recursive: true });
const CONSENT = 'facemorph-debug-consent-v1',
  DEVICE = 'facemorph-debug-device-v1',
  BATCH = 'checkface-diagnostics-pending-v1';
const COLLECTOR = `${ORIGIN}/diagnostics/events`;

interface Cell {
  readonly width: number;
  readonly height: number;
  readonly touch: boolean;
  readonly scheme: 'light' | 'dark';
}
const CELLS: readonly Cell[] = [
  { width: 1280, height: 800, touch: false, scheme: 'light' },
  { width: 1280, height: 800, touch: false, scheme: 'dark' },
  { width: 390, height: 844, touch: true, scheme: 'light' },
  { width: 390, height: 844, touch: true, scheme: 'dark' },
];
const label = (c: Cell) => `${c.width}-${c.scheme}`;

interface Upload {
  readonly at: number;
  readonly step: string;
  readonly body: {
    session: string;
    run: string;
    device?: string;
    consent: string;
    events: { event: string; run?: string; stage?: string }[];
  };
}

function runtimeOrSkip(t: { skip(reason: string): void }): boolean {
  if (existsSync(join(runtime, 'manifest.json'))) return true;
  const reason = `untested: no acquired runtime at ${runtime}; owner fm-szbf; run on the runtime lane`;
  if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
  t.skip(reason);
  return false;
}

async function withSite(fn: (browser: Browser) => Promise<void>) {
  const artifact = readIdentity(built);
  assert.deepEqual(artifact.findings, []);
  const site = await startControl({
    runtime,
    artifact: resolve(built, 'deploy-next'),
    source: artifact.identity.deploySource.buildId,
  });
  const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
  try {
    await fn(browser);
  } finally {
    await browser.close();
    await site.stop();
  }
}

/** A browser context for one cell, with the collector answered locally and every upload recorded. */
async function cell(browser: Browser, c: Cell, { holdMs = 0 } = {}) {
  const context = await browser.newContext({
    ...(c.touch ? devices['iPhone 13'] : {}),
    viewport: { width: c.width, height: c.height },
    hasTouch: c.touch,
    isMobile: c.touch,
    colorScheme: c.scheme,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(INSTALL_HOOK);
  const log = {
    step: 'start',
    holdMs,
    uploads: [] as Upload[],
    aborted: [] as { step: string; error: string }[],
    hosts: {} as Record<string, string[]>,
  };
  await context.route(COLLECTOR, async (route) => {
    const request = route.request();
    log.uploads.push({
      at: Date.now(),
      step: log.step,
      body: JSON.parse(request.postData() ?? '{}') as Upload['body'],
    });
    if (log.holdMs) await new Promise((r) => setTimeout(r, log.holdMs));
    await route
      .fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      .catch(() => {});
  });
  context.on('request', (request) => {
    if (!/^https?:/.test(request.url())) return;
    const host = new URL(request.url()).host;
    const seen = (log.hosts[log.step] ??= []);
    if (!seen.includes(host)) seen.push(host);
  });
  context.on('requestfailed', (request) => {
    if (request.url() === COLLECTOR)
      log.aborted.push({ step: log.step, error: request.failure()?.errorText ?? '' });
  });
  return { context, log };
}

const model = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __elmish: { model: Record<string, unknown> } }).__elmish.model,
  );
const disclosure = (page: Page) => page.locator('#debug-reporting');
const summary = (page: Page) => page.locator('#debug-reporting > summary');
const footerLink = (page: Page) =>
  page.locator('footer').getByRole('link', { name: 'Privacy & reports' });

async function operate(page: Page, control: ReturnType<Page['locator']>, touch: boolean) {
  const landed = await press(page, control, { touch });
  assert.ok(landed.inside, `pressed ${control} at its visible position`);
}

/** Answers the first-visit prompts by operating them, so later steps see the page a returning visitor sees. */
async function settle(page: Page, touch: boolean) {
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
      await operate(page, control, touch);
}

/** The disclosure's state as a person sees it: summary text, open, the checkbox and where focus is. */
const view = (page: Page) =>
  page.evaluate(() => {
    const d = document.getElementById('debug-reporting') as HTMLDetailsElement | null;
    const box = d?.querySelector('input[type=checkbox]') as HTMLInputElement | null;
    return {
      summary: d?.querySelector('summary')?.textContent ?? '',
      open: !!d?.open,
      checked: !!box?.checked,
      focused: !!box && document.activeElement === box,
    };
  });

// ---- 1. restore ----------------------------------------------------------------------------------------------

/** Records every summary text the page renders from the first commit, and screenshots every 100 ms. */
const FIRST_PAINT = `(() => {
  window.__summaries = [];
  const note = () => {
    const s = document.querySelector('#debug-reporting > summary');
    const text = s ? s.textContent : null;
    if (text !== null && window.__summaries[window.__summaries.length - 1] !== text) window.__summaries.push(text);
    const b = document.querySelector('#debug-reporting input[type=checkbox]');
    if (b && window.__boxes?.[window.__boxes.length - 1] !== b.checked) (window.__boxes ??= []).push(b.checked);
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
})();`;

test(
  'a saved On, Off and No thanks each restore with no intermediate false state',
  { timeout: 300_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    await withSite(async (browser) => {
      const saved: [string, string | null, 'On' | 'Off'][] = [
        [
          'on',
          JSON.stringify({
            choice: 'on',
            basis: 'checkbox',
            at: '2026-10-20',
            policy: 'trial-2026-10',
          }),
          'On',
        ],
        [
          'off',
          JSON.stringify({
            choice: 'off',
            basis: 'checkbox',
            at: '2026-10-20',
            policy: 'trial-2026-10',
          }),
          'Off',
        ],
        [
          'no-thanks',
          JSON.stringify({
            choice: 'off',
            basis: 'toast',
            at: '2026-10-20',
            policy: 'trial-2026-10',
          }),
          'Off',
        ],
      ];
      for (const c of [CELLS[0]!, CELLS[3]!])
        for (const [name, value, expected] of saved) {
          const { context, log } = await cell(browser, c);
          await context.addInitScript(
            ([key, v]) => {
              if (!sessionStorage.getItem('__seeded')) {
                localStorage.setItem(key as string, v as string);
                sessionStorage.setItem('__seeded', '1');
              }
            },
            [CONSENT, value],
          );
          await context.addInitScript(FIRST_PAINT);
          const page = await context.newPage();
          const shots: Promise<unknown>[] = [];
          const nav = page.goto(ORIGIN, { waitUntil: 'commit' });
          await nav;
          for (let i = 0; i < 12; i++) {
            shots.push(
              page
                .screenshot({ path: join(results, `restore-${name}-${label(c)}-${i * 100}ms.png`) })
                .catch(() => null),
            );
            await page.waitForTimeout(100);
          }
          await Promise.all(shots);
          await page.locator('section.next-face').first().waitFor();
          await page.waitForTimeout(1500);
          const record = await page.evaluate(() => ({
            summaries: (window as unknown as { __summaries: string[] }).__summaries,
            boxes: (window as unknown as { __boxes?: boolean[] }).__boxes ?? [],
          }));
          assert.deepEqual(
            record.summaries,
            [`Debug reports: ${expected}`],
            `${name}: first paint onward`,
          );
          assert.deepEqual(
            record.boxes,
            [expected === 'On'],
            `${name}: the checkbox never shows the other state`,
          );
          assert.equal((await model(page))['Debug'], expected === 'On');
          // An answered visitor is not asked again; while On nothing offers opt-in.
          assert.equal(
            await page.locator('.next-consent-prompt').count(),
            0,
            `${name}: no reporting question`,
          );
          if (expected === 'Off')
            assert.deepEqual(log.uploads, [], `${name}: nothing sent while Off`);
          await page.reload();
          await page.locator('section.next-face').first().waitFor();
          await page.waitForTimeout(1000);
          const again = await page.evaluate(
            () => (window as unknown as { __summaries: string[] }).__summaries,
          );
          assert.deepEqual(again, [`Debug reports: ${expected}`], `${name}: after reload`);
          await context.close();
        }
    });
  },
);

test(
  'a localStorage that throws: the tab-only line, and a reload shows Off',
  { timeout: 300_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    await withSite(async (browser) => {
      for (const c of [CELLS[0]!, CELLS[2]!]) {
        const { context } = await cell(browser, c);
        await context.addInitScript(() => {
          const blocked = () => {
            throw new DOMException('blocked', 'SecurityError');
          };
          Storage.prototype.setItem = blocked;
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function (this: Storage, key: string) {
            if (this === window.localStorage) blocked();
            return get.call(this, key);
          };
        });
        const page = await context.newPage();
        await page.goto(ORIGIN);
        await settle(page, c.touch);
        await operate(page, footerLink(page), c.touch);
        assert.equal((await view(page)).focused, true);
        await page.keyboard.press('Space');
        await page.locator('.next-debug-unsaved').waitFor();
        assert.equal(
          (await page.locator('.next-debug-unsaved').innerText()).trim(),
          'Reporting is on for this tab; this choice could not be saved.',
        );
        assert.equal((await view(page)).summary, 'Debug reports: On');
        await disclosure(page).screenshot({ path: join(results, `unsaved-${label(c)}.png`) });
        await page.reload();
        await page.locator('section.next-face').first().waitFor();
        await page.waitForTimeout(1000);
        assert.equal((await view(page)).summary, 'Debug reports: Off');
        assert.equal((await model(page))['Debug'], false);
        await context.close();
      }
    });
  },
);

// ---- 2. links, keyboard, privacy text, placement --------------------------------------------------------------

/** Every visible text the privacy entry renders, opened by operating its summary. */
async function privacyText(page: Page, touch: boolean): Promise<string> {
  const entry = page.locator('#privacy');
  if (!(await entry.evaluate((d) => (d as HTMLDetailsElement).open)))
    await operate(page, entry.locator('summary'), touch);
  return entry.innerText();
}

test(
  'footer and FAQ links open the disclosure and focus its checkbox; the privacy text is complete',
  { timeout: 600_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    await withSite(async (browser) => {
      for (const c of CELLS) {
        const { context, log } = await cell(browser, c);
        const page = await context.newPage();
        await page.goto(ORIGIN);
        await settle(page, c.touch);
        assert.deepEqual(await view(page), {
          summary: 'Debug reports: Off',
          open: false,
          checked: false,
          focused: false,
        });
        // Footer link: expands and focuses the checkbox.
        await operate(page, footerLink(page), c.touch);
        await page.waitForFunction(
          () => (document.getElementById('debug-reporting') as HTMLDetailsElement).open,
        );
        assert.deepEqual(await view(page), {
          summary: 'Debug reports: Off',
          open: true,
          checked: false,
          focused: true,
        });
        await page.screenshot({ path: join(results, `footer-link-${label(c)}.png`) });
        const text = await disclosure(page).innerText();
        assert.match(text, /Send debug reports until I turn this off\./);
        assert.match(
          text,
          /Timings, browser\/device details and safe error codes\. Never photos, typed words, seeds, faces or videos\./,
        );
        assert.match(text, /kept, with no deletion date/);
        // Space on the focused checkbox, then a press on its label text.
        await page.keyboard.press('Space');
        await page.waitForFunction(
          () =>
            document.querySelector('#debug-reporting summary')?.textContent === 'Debug reports: On',
        );
        assert.equal((await view(page)).checked, true);
        await operate(
          page,
          disclosure(page).getByText('Send debug reports until I turn this off.', { exact: true }),
          c.touch,
        );
        await page.waitForFunction(
          () =>
            document.querySelector('#debug-reporting summary')?.textContent ===
            'Debug reports: Off',
        );
        // Tab order follows the visual order: summary, then the checkbox, then the privacy link.
        await summary(page).focus();
        await page.keyboard.press('Tab');
        assert.equal((await view(page)).focused, true, 'Tab from the summary reaches the checkbox');
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute('href')),
          '#privacy',
        );
        // Collapse it, then the FAQ link does the same as the footer link.
        await operate(page, summary(page), c.touch);
        assert.equal((await view(page)).open, false);
        const privacy = await privacyText(page, c.touch);
        await page
          .locator('#privacy')
          .screenshot({ path: join(results, `privacy-${label(c)}.png`) });
        await operate(
          page,
          page
            .locator('#privacy')
            .getByRole('link', { name: 'Debug reports: turn them on or off' }),
          c.touch,
        );
        await page.waitForFunction(
          () => (document.getElementById('debug-reporting') as HTMLDetailsElement).open,
        );
        assert.equal((await view(page)).focused, true, 'the FAQ link focuses the checkbox');
        await page.screenshot({ path: join(results, `faq-link-${label(c)}.png`) });
        // The privacy link inside the disclosure leads back to the rendered privacy text.
        await operate(
          page,
          disclosure(page).getByRole('link', { name: 'Everything this page sends' }),
          c.touch,
        );
        // Privacy text: every outside host class, the same-origin requests, analytics kept distinct, file metadata.
        for (const r of OUTSIDE_REQUESTS.filter(
          (r) => !r.purpose.startsWith('Diagnostics collector'),
        ))
          assert.ok(privacy.includes(r.host), `privacy text names ${r.host}`);
        for (const phrase of [
          '/runtime/',
          '/catalogue.json',
          '/stats/v1',
          '/diagnostics/events',
          'Google Analytics',
          'exact latent',
          'model and provenance',
          'never contain your photos, the words you typed or file names',
          'Typing a word or seed sends nothing',
        ])
          assert.ok(privacy.includes(phrase), `privacy text: ${phrase}`);
        const all = await page.locator('body').innerText();
        assert.doesNotMatch(
          all,
          /30 days|deleted after|we delete|deletion after/i,
          'no deletion promise',
        );
        // No debug control in a face, Morph options or the output controls.
        const misplaced = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '.next-face, .next-morph, .next-video, .next-morph-options, [data-next-output]',
            ),
          ].flatMap((el) =>
            [...el.querySelectorAll('input, button, a, label')]
              .filter(
                (c) =>
                  /debug|report/i.test(c.textContent ?? '') ||
                  /debug|report/i.test(c.getAttribute('aria-label') ?? ''),
              )
              .map((c) => c.outerHTML.slice(0, 80)),
          ),
        );
        assert.deepEqual(misplaced, []);
        assert.deepEqual(
          log.uploads.filter((u) => u.body.consent !== 'checkbox'),
          [],
          'only the toggled-on moment sent anything',
        );
        await context.close();
      }
    });
  },
);

// ---- 3. first visit: one prompt, nothing covered ---------------------------------------------------------------

/**
 * Every action whose centre is in the viewport is the element there; then each is scrolled to and checked again.
 * Returns what a prompt covers, and separately any other overlap (a tile's own layout, not a prompt).
 */
async function uncovered(
  page: Page,
): Promise<{ prompt: string[]; other: string[]; checked: number }> {
  return page.evaluate(async () => {
    // The actions a person can see: every face action and Create morph (a hidden file input or a closed menu's
    // items are not on screen).
    const actions = [
      ...document.querySelectorAll(
        'section.next-face button, section.next-face input:not([type=file]), .next-morph button',
      ),
    ].filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    const covered: string[] = [],
      other: string[] = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const check = (el: Element, when: string, inViewOnly: boolean) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      if (inViewOnly && (y < 0 || y > innerHeight || x < 0 || x > innerWidth)) return;
      // A disabled button (an empty face's Generate) has pointer-events: none, which elementFromPoint skips by
      // design; it is measured with hit-testing restored, so what is asked is only whether something covers it.
      const disabled = el.matches(':disabled, .Mui-disabled');
      const prior = (el as HTMLElement).style.pointerEvents;
      if (disabled) (el as HTMLElement).style.pointerEvents = 'auto';
      const at = document.elementFromPoint(x, y);
      if (disabled) (el as HTMLElement).style.pointerEvents = prior;
      if (!at || !(el === at || el.contains(at)))
        (at?.closest('.next-consent-toast, .MuiSnackbar-root, .next-invite')
          ? covered
          : other
        ).push(
          `${when}: ${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim()} under ${at ? at.outerHTML.slice(0, 140) : null}`,
        );
    };
    // Where the page opens: a prompt must not cover an action already on screen.
    for (const el of actions) check(el, 'initial', true);
    // Then each action brought to the centre of the viewport, as a person scrolls to it.
    for (const el of actions) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await frame();
      await frame();
      check(el, 'centred', false);
    }
    scrollTo(0, 0);
    return {
      prompt: covered,
      other: other.filter((o) => o.startsWith('centred')),
      checked: actions.length,
    };
  });
}

const prompts = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('.next-consent-toast, .next-invite, .MuiSnackbar-root')].filter(
        (el) =>
          (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed',
      ).length,
  );

test(
  'first visit with 1, 2, 3 and 8 faces: at most one prompt, and no prompt covers an action',
  { timeout: 600_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    const overlaps: string[] = [];
    await withSite(async (browser) => {
      for (const c of [CELLS[0]!, CELLS[2]!]) {
        for (const n of [1, 2, 3, 8]) {
          const { context } = await cell(browser, c);
          const page = await context.newPage();
          await page.goto(ORIGIN);
          await page.locator('section.next-face').nth(1).waitFor();
          await page.waitForTimeout(2000);
          // Setup by name: the face count.
          if (n === 1)
            await page
              .locator('section.next-face')
              .nth(1)
              .getByRole('button', { name: /^Remove/ })
              .click();
          for (let k = 2; k < n; k++)
            await page.getByRole('button', { name: 'Add face', exact: true }).click();
          await page.waitForFunction(
            (n) => document.querySelectorAll('section.next-face').length === n,
            n,
          );
          await page.evaluate(() => scrollTo(0, 0));
          assert.ok((await prompts(page)) <= 1, `${n} faces: at most one prompt`);
          await page.screenshot({ path: join(results, `first-visit-${n}-${label(c)}.png`) });
          const first = await uncovered(page);
          assert.deepEqual(
            first.prompt,
            [],
            `${label(c)} ${n} faces: no action covered by a prompt`,
          );
          overlaps.push(...first.other.map((o) => `${label(c)} ${n} faces: ${o}`));
          // The model offer answered, the reporting question is the one prompt, and it still covers nothing.
          const notNow = page.locator('.next-model-toast').getByRole('button', { name: 'Not now' });
          if (await notNow.count()) await operate(page, notNow, c.touch);
          await page.locator('.next-consent-prompt').waitFor();
          assert.ok((await prompts(page)) <= 1);
          const second = await uncovered(page);
          assert.deepEqual(second.prompt, [], `${label(c)} ${n} faces with the reporting question`);
          await page
            .locator('.next-consent-prompt')
            .screenshot({ path: join(results, `consent-prompt-${n}-${label(c)}.png`) });
          await context.close();
        }
      }
    });
    // Overlaps that are not a prompt (tile layout) are recorded for their owning bead, not hidden.
    writeFileSync(
      join(results, 'non-prompt-overlaps.json'),
      JSON.stringify([...new Set(overlaps)], null, 1),
    );
    t.diagnostic(
      `non-prompt overlaps: ${overlaps.length ? [...new Set(overlaps)].join('; ') : 'none'}`,
    );
    assert.deepEqual(
      [...new Set(overlaps)],
      [],
      'every face action and Create morph is itself at its centre',
    );
  },
);

// ---- 4. the job journey ------------------------------------------------------------------------------------------

async function cpuMode(page: Page) {
  await page.getByRole('button', { name: 'More options' }).click(); // setup
  await page.getByLabel('Processing mode').selectOption('cpu'); // setup
}

const tile = (page: Page, i: number) => page.locator('section.next-face').nth(i);

/** Generate face `i` by operating its button, accepting the download gate when it asks. */
async function generate(page: Page, i: number, touch: boolean) {
  await operate(page, tile(page, i).locator('.next-input-row .next-face-generate'), touch);
  const accept = page.locator('.next-download-accept');
  if (
    await accept.waitFor({ timeout: 5000 }).then(
      () => true,
      () => false,
    )
  )
    await operate(page, accept, touch);
}

async function setWord(page: Page, i: number, value: string, touch: boolean) {
  await operate(page, tile(page, i).locator('.next-field input'), touch);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value, { delay: 60 });
}

const idle = (page: Page) =>
  page.waitForFunction(() => !document.querySelector('.next-product[data-next-busy=true]'), null, {
    timeout: 600_000,
  });

const filled = (page: Page, i: number) =>
  page.waitForFunction(
    (i) =>
      document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state') ===
      'filled',
    i,
    { timeout: 300_000 },
  );

/** A real failed attempt: the network is off and the model is not on the device, so the job fails. */
async function failedAttempt(page: Page, context: BrowserContext, i: number, touch: boolean) {
  await context.setOffline(true);
  await generate(page, i, touch);
  await page
    .locator('.next-error')
    .waitFor({ timeout: 240_000 })
    .catch(async (e) => {
      await page.screenshot({ path: join(results, 'failed-attempt-debug.png'), fullPage: true });
      writeFileSync(
        join(results, 'failed-attempt-model.json'),
        JSON.stringify(await model(page), null, 1),
      );
      throw e;
    });
  await idle(page);
  await context.setOffline(false);
}

const stored = (page: Page) =>
  page.evaluate(
    ([c, d, b]) => ({
      consent: localStorage.getItem(c!),
      device: localStorage.getItem(d!),
      batch: sessionStorage.getItem(b!),
    }),
    [CONSENT, DEVICE, BATCH],
  );

async function toggleByFooter(page: Page, touch: boolean, expected: 'On' | 'Off') {
  await operate(page, footerLink(page), touch);
  await page.waitForFunction(() => {
    const d = document.getElementById('debug-reporting') as HTMLDetailsElement;
    return d.open && document.activeElement === d.querySelector('input[type=checkbox]');
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(
    (e) =>
      document.querySelector('#debug-reporting summary')?.textContent === `Debug reports: ${e}`,
    expected,
  );
}

test(
  'one-shot, withdrawal during a job, nothing after Off, Turn on debug reporting, and every contacted host disclosed',
  { timeout: 1_800_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    await withSite(async (browser) => {
      for (const c of [CELLS[0]!, CELLS[3]!]) {
        const name = label(c);
        const { context, log } = await cell(browser, c);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        log.step = 'arrival';
        await page.goto(ORIGIN);
        await page.locator('section.next-face').nth(1).waitFor();
        const notNow = page.locator('.next-model-toast').getByRole('button', { name: 'Not now' });
        if (
          await notNow.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        )
          await operate(page, notNow, c.touch);
        // A stored refusal: "No thanks" on the reporting question.
        await operate(
          page,
          page.locator('.next-consent-prompt').getByRole('button', { name: 'No thanks' }),
          c.touch,
        );
        const refusal = (await stored(page)).consent;
        assert.match(refusal ?? '', /"choice":"off","basis":"toast"/);
        await cpuMode(page);
        // The morph below only has to outlast the withdrawal: the short length (8 frames per face) is enough.
        await page.getByLabel('Morph length', { exact: true }).selectOption('8'); // setup

        log.step = 'typing';
        await setWord(page, 0, '389', c.touch);
        await operate(page, tile(page, 0).getByRole('button', { name: 'Change mode' }), c.touch);
        await page.keyboard.press('Escape');
        await setWord(page, 1, 'banana', c.touch);
        await page.waitForTimeout(1500);

        log.step = 'names';
        await operate(page, tile(page, 0).getByRole('button', { name: 'Change mode' }), c.touch);
        await operate(
          page,
          page.getByRole('menuitem', { name: 'Browse names', exact: true }),
          c.touch,
        );
        const dialog = page.getByRole('dialog', { name: 'Browse names' });
        await dialog.locator('.next-name-choice').first().waitFor({ timeout: 60_000 });
        await operate(page, dialog.locator('.next-name-choice').first(), c.touch);
        await dialog.waitFor({ state: 'detached' });
        // Picking a name asks to download the model; not yet, so the attempts below fail before any model is held.
        const gate = page.getByRole('dialog', { name: 'Download the face model?' });
        if (
          await gate.waitFor({ timeout: 4000 }).then(
            () => true,
            () => false,
          )
        ) {
          await operate(page, gate.getByRole('button', { name: 'Cancel', exact: true }), c.touch);
          await gate.waitFor({ state: 'detached' });
        }

        // Two failed attempts while Off: the first is dismissed, the second is sent once from its toast.
        log.step = 'fail-1';
        await failedAttempt(page, context, 1, c.touch);
        const toast = page.locator('.next-failure-toast');
        await toast.waitFor();
        assert.equal(
          await page
            .locator('.next-error')
            .getByRole('button', { name: 'Send this report' })
            .count(),
          0,
          'one prompt: the error box waits for the toast',
        );
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(results, `failure-toast-${name}.png`) });
        await operate(page, toast.getByRole('button', { name: 'Not now' }), c.touch);
        const inline = page
          .locator('.next-error')
          .getByRole('button', { name: 'Send this report' });
        await inline.waitFor();
        await operate(
          page,
          page.locator('.next-error').getByRole('button', { name: 'Dismiss' }),
          c.touch,
        );
        log.step = 'fail-2';
        await failedAttempt(page, context, 1, c.touch);
        await toast.waitFor();
        assert.equal(log.uploads.length, 0, 'nothing sent while Off before the one-shot');
        await operate(page, toast.getByRole('button', { name: 'Send this report' }), c.touch);
        await page
          .waitForFunction(() =>
            /Report saved/.test(
              document.querySelector('#debug-reporting [role=status]')?.textContent ?? '',
            ),
          )
          .catch(async (e) => {
            writeFileSync(
              join(results, `once-debug-${name}.json`),
              JSON.stringify(
                {
                  log,
                  model: await model(page),
                  status: await page.locator('#debug-reporting [role=status]').textContent(),
                },
                null,
                1,
              ),
            );
            throw e;
          });
        assert.equal(log.uploads.length, 1, 'one upload');
        const once = log.uploads[0]!.body;
        assert.equal(once.consent, 'once');
        assert.equal(once.device, undefined);
        assert.ok(
          once.events.every((e) => (e.run ?? once.run) === once.run),
          'one run only',
        );
        assert.equal(
          once.events.filter((e) => e.event === 'start').length,
          1,
          'the owning attempt alone',
        );
        assert.equal(once.events.filter((e) => e.event === 'failed').length, 1);
        assert.equal((await stored(page)).consent, refusal, 'the stored refusal is unchanged');
        assert.equal((await model(page))['Debug'], false);
        assert.equal((await view(page)).summary, 'Debug reports: Off');
        await operate(
          page,
          page.locator('.next-error').getByRole('button', { name: 'Dismiss' }),
          c.touch,
        );

        log.step = 'generate';
        await generate(page, 1, c.touch);
        await filled(page, 1);
        await idle(page);
        await setWord(page, 0, 'withdrawal', c.touch);
        await generate(page, 0, c.touch);
        await filled(page, 0);
        await idle(page);

        // Withdrawal during an active job, with a send pending.
        log.step = 'withdraw';
        log.holdMs = 6000;
        await toggleByFooter(page, c.touch, 'On');
        const onAt = Date.now();
        // The active job: a morph between the two faces.
        await operate(
          page,
          page.getByRole('button', { name: 'Create morph', exact: true }),
          c.touch,
        );
        await page
          .waitForFunction(
            () => document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 10_000 },
          )
          .catch(async (e) => {
            await page.screenshot({
              path: join(results, `withdraw-debug-${name}.png`),
              fullPage: true,
            });
            writeFileSync(
              join(results, `withdraw-debug-${name}.json`),
              JSON.stringify(await model(page), null, 1),
            );
            throw e;
          });
        await page.waitForFunction((k) => !!sessionStorage.getItem(k), BATCH, { timeout: 60_000 });
        const before = await stored(page);
        assert.ok(before.device, 'a grouping ID while On');
        assert.ok(
          log.uploads.some((u) => u.at >= onAt),
          'the staged records were sent on consent (held pending)',
        );
        await toggleByFooter(page, c.touch, 'Off');
        const offAt = Date.now();
        assert.equal((await model(page))['Busy'], true, 'withdrawn while the morph runs');
        const after = await stored(page);
        assert.equal(after.batch, null, 'the session mirror is discarded');
        assert.equal(after.device, null, 'the grouping ID is cleared');
        assert.match(after.consent ?? '', /"choice":"off"/);
        await page.waitForTimeout(500);
        assert.ok(
          log.aborted.some((a) => a.step === 'withdraw'),
          `the pending send was aborted: ${JSON.stringify(log.aborted)}`,
        );
        await idle(page);
        const morphed = await model(page);
        assert.equal(morphed['Error'], null, 'the morph completed after withdrawal');
        assert.ok(morphed['VideoUrl'], 'its video is there');
        log.holdMs = 0;

        log.step = 'save';
        const download = page.waitForEvent('download');
        await operate(
          page,
          tile(page, 0).getByRole('button', { name: 'Save image', exact: true }),
          c.touch,
        );
        await download;

        // Share: headless Chromium has no navigator.share, so no Share control is offered (fm-qh1s, fm-7u7z);
        // Save above is how the file leaves this browser.
        log.step = 'share';
        assert.equal(await page.evaluate(() => typeof navigator.share), 'undefined');
        assert.equal(
          await tile(page, 0)
            .getByRole('button', { name: /^Share/ })
            .count(),
          0,
          'no Share control without Web Share',
        );

        // A real photo encode on the CPU: face 2's Encode image chooser, the crop confirmed with OK, the photo
        // encoder download accepted.
        log.step = 'photo';
        await operate(
          page,
          tile(page, 1).getByRole('button', { name: 'Change mode', exact: true }),
          c.touch,
        );
        const entry = page.getByRole('menuitem', { name: 'Encode image', exact: true });
        await entry.waitFor();
        await entry.evaluate(async (el) => {
          const panel = el.closest('.MuiPaper-root');
          await Promise.allSettled(
            (panel?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished),
          );
        });
        const chooser = page.waitForEvent('filechooser');
        await operate(page, entry, c.touch);
        await (await chooser).setFiles([join(REPO, 'tests/crop/fixtures/non-square.jpg')]);
        const crop = page.getByRole('dialog', { name: 'Encode an image', exact: true });
        // Faces first (fm-k09b): answer the photo-setup decision until the crop's proposal is ready.
        for (const end = Date.now() + 900_000; ;) {
          assert.ok(Date.now() < end, 'the crop proposal was ready in time');
          const okButton = crop.getByRole('button', { name: 'OK', exact: true });
          if ((await okButton.isVisible()) && (await okButton.isEnabled())) break;
          const decision = page.locator('.next-download-accept');
          if (await decision.isVisible()) await operate(page, decision, c.touch);
          else await page.waitForTimeout(500);
        }
        await operate(page, crop.getByRole('button', { name: 'OK', exact: true }), c.touch);
        await crop.waitFor({ state: 'detached' });
        const accept = page.locator('.next-download-accept');
        while (
          await accept.waitFor({ timeout: 6000 }).then(
            () => true,
            () => false,
          )
        ) {
          await operate(page, accept, c.touch);
          await accept.waitFor({ state: 'detached' });
        }
        await page.waitForFunction(
          () => {
            const m = (
              window as unknown as {
                __elmish: {
                  model: {
                    Busy: boolean;
                    PreparingFaces: Set<string>;
                    Faces: { id: string }[];
                    Inputs: { id: string; mode: string }[];
                  };
                };
              }
            ).__elmish.model;
            const photo = m.Inputs.find((i) => i.mode === 'photo');
            return (
              !m.Busy &&
              m.PreparingFaces.size === 0 &&
              !!photo &&
              m.Faces.some((f) => f.id === photo.id)
            );
          },
          null,
          { timeout: 900_000, polling: 1000 },
        );
        assert.equal((await model(page))['Error'], null, 'the photo encoded');
        await page.screenshot({ path: join(results, `photo-encoded-${name}.png`) });
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForTimeout(2000);
        assert.deepEqual(
          log.uploads.filter((u) => u.at > offAt),
          [],
          'zero collector requests after Off',
        );
        writeFileSync(join(results, `journey-${name}.json`), JSON.stringify(log, null, 1));

        // Every host contacted is this site or a disclosed outside host, named in the rendered privacy text.
        const privacy = await privacyText(page, c.touch);
        const hosts = new Set(Object.values(log.hosts).flat());
        assert.ok(
          ![...hosts].some((h) => /googletagmanager|google-analytics/.test(h)),
          'the default build loads no analytics under automation',
        );
        for (const host of hosts) {
          if (host === new URL(ORIGIN).host) continue;
          const entry = OUTSIDE_REQUESTS.find((r) =>
            r.host.startsWith('*.') ? host.endsWith(r.host.slice(1)) : r.host === host,
          );
          assert.ok(entry, `${host} is a listed outside request`);
          assert.ok(privacy.includes(entry.host), `${host} is in the privacy text`);
        }
        t.diagnostic(
          `${name}: hosts ${[...hosts].join(', ')}; uploads ${log.uploads.length}; aborted ${log.aborted.length}`,
        );
        assert.deepEqual(errors, []);
        await context.close();

        // "Turn on debug reporting" is standing consent; while On nothing offers opt-in; the footer link withdraws it.
        const fresh = await cell(browser, c);
        const second = await fresh.context.newPage();
        fresh.log.step = 'turn-on';
        await second.goto(ORIGIN);
        await second.locator('section.next-face').nth(1).waitFor();
        // As at arrival: the model offer may or may not be shown before the reporting question.
        const offer = second.locator('.next-model-toast').getByRole('button', { name: 'Not now' });
        if (
          await offer.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        )
          await operate(second, offer, c.touch);
        const ask = second.locator('.next-consent-prompt');
        await ask.waitFor();
        assert.match(await ask.innerText(), /from now on, until you turn it off/);
        await operate(
          second,
          ask.getByRole('button', { name: 'Turn on debug reporting' }),
          c.touch,
        );
        await second.waitForFunction(
          () =>
            document.querySelector('#debug-reporting summary')?.textContent === 'Debug reports: On',
        );
        assert.match((await stored(second)).consent ?? '', /"choice":"on","basis":"toast"/);
        await cpuMode(second);
        fresh.log.step = 'fail-on';
        await failedAttempt(second, fresh.context, 1, c.touch);
        await second.waitForTimeout(1000);
        assert.equal(
          await second.locator('.next-failure-toast, .next-consent-prompt').count(),
          0,
          'no opt-in offer while On',
        );
        assert.equal(
          await second
            .locator('.next-error')
            .getByRole('button', { name: 'Send this report' })
            .count(),
          0,
        );
        await second.screenshot({ path: join(results, `on-failure-${name}.png`) });
        await toggleByFooter(second, c.touch, 'Off');
        const off2 = Date.now();
        fresh.log.step = 'after-off';
        await second.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await second.waitForTimeout(1500);
        assert.deepEqual(
          fresh.log.uploads.filter((u) => u.at > off2),
          [],
          'nothing after the footer withdrawal',
        );
        assert.ok(fresh.log.uploads.length > 0, 'standing reporting did send while On');
        assert.match((await stored(second)).consent ?? '', /"choice":"off"/);
        await fresh.context.close();
      }
    });
  },
);

// ---- 5. the usage-statistics beacon and the analytics script -----------------------------------------------------
// The shipped build sends neither under automation (navigator.webdriver; the journey above asserts no Google host).
// Each has a build-time, test-build-only opt-in: FACEMORPH_STATS_ALLOW_AUTOMATION=1 (fm-5yqq) and
// FACEMORPH_ANALYTICS_ALLOW_AUTOMATION=1 (fm-szbf); a test build beside deploy-next sets both. The gtag script is
// Google's real one, so its *.google-analytics.com measurement requests are really made, and every one of them is
// answered locally: no measurement reaches Google.

test(
  'the statistics beacon and both analytics host classes are intercepted and named in the privacy text',
  { timeout: 1_200_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    const out = join(REPO, '.cache/debug-reporting-stats-build');
    rmSync(out, { recursive: true, force: true });
    execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: join(REPO, 'apps/web'),
      env: {
        ...process.env,
        FACEMORPH_STATS_ALLOW_AUTOMATION: '1',
        FACEMORPH_ANALYTICS_ALLOW_AUTOMATION: '1',
      },
      stdio: 'inherit',
    });
    for (const file of ['catalogue.json', '_headers', '_redirects'])
      cpSync(join(REPO, 'deploy-next', file), join(out, file));
    const site = await startControl({
      runtime,
      artifact: out,
      source: 'debug-reporting-stats-build',
    });
    const capture = await startCapture({ host: ORIGIN_HOST, upstream: PORT });
    const browser = await chromium.launch({ args: [...capture.args, '--disable-features=WebGPU'] });
    const analyticsHosts = OUTSIDE_REQUESTS.filter((r) => /Google Analytics/.test(r.purpose));
    const covers = (pattern: string, host: string) =>
      pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;
    try {
      for (const c of [CELLS[0]!, CELLS[3]!]) {
        capture.beacons.length = 0;
        const context = await browser.newContext({
          ...(c.touch ? devices['iPhone 13'] : {}),
          viewport: { width: c.width, height: c.height },
          hasTouch: c.touch,
          isMobile: c.touch,
          colorScheme: c.scheme,
          ignoreHTTPSErrors: true,
        });
        await context.addInitScript(INSTALL_HOOK);
        const hosts = new Set<string>();
        context.on('request', (r) => {
          if (/^https?:/.test(r.url())) hosts.add(new URL(r.url()).host);
        });
        // The tag script is Google's real one (the product's own GET, which carries no page data), so its
        // measurement requests are really made; every *.google-analytics.com request is answered here with a 204,
        // so no measurement reaches Google.
        const google: string[] = [];
        await context.route(
          /^https:\/\/([a-z0-9-]+\.)*(googletagmanager|google-analytics)\.com\//,
          async (route) => {
            google.push(route.request().url());
            if (!/\/gtag\/js/.test(route.request().url()))
              return route.fulfill({ status: 204, body: '' });
            const response = await route.fetch();
            const body = `${await response.text()}\n;window.__gtagLoaded = true;`;
            return route.fulfill({ response, body });
          },
        );
        const page = await context.newPage();
        capture.step = 'visit';
        await page.goto(ORIGIN);
        await settle(page, c.touch);
        // Analytics loads once the page is idle: the gtag script request, with the product's measurement queued.
        await page.waitForFunction(
          () => (window as unknown as { __gtagLoaded?: boolean }).__gtagLoaded === true,
          null,
          { timeout: 30_000 },
        );
        // gtag.js also pushes its own event objects; the product's calls are the arguments lists.
        const queued = await page.evaluate(() =>
          ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])
            .filter(
              (a): a is ArrayLike<unknown> => typeof (a as ArrayLike<unknown>)?.length === 'number',
            )
            .map((a) => Array.from(a).slice(0, 2).map(String)),
        );
        assert.ok(
          queued.some(([kind, id]) => kind === 'config' && (id ?? '').startsWith('G-')),
          'the product queued its analytics config',
        );
        assert.ok(
          google.some((u) => u.startsWith('https://www.googletagmanager.com/gtag/js?id=G-')),
          'the analytics script request is in the intercepted set',
        );
        await cpuMode(page);
        capture.step = 'face';
        await generate(page, 1, c.touch);
        await filled(page, 1);
        await idle(page);
        capture.step = 'hide';
        await page.reload();
        await page.locator('section.next-face').first().waitFor();
        await page.waitForTimeout(1500);
        assert.ok(capture.beacons.length > 0, 'the statistics beacon was sent');
        for (const b of capture.beacons) {
          assert.equal(b.path, '/stats/v1');
          assert.equal(b.origin, ORIGIN);
          assert.equal(b.fetchSite, 'same-origin');
        }
        const privacy = await privacyText(page, c.touch);
        assert.ok(privacy.includes('/stats/v1'), 'the privacy text names the statistics beacon');
        for (const host of hosts) {
          if (host === ORIGIN_HOST) continue;
          const entry = OUTSIDE_REQUESTS.find((r) => covers(r.host, host));
          assert.ok(entry && privacy.includes(entry.host), `${host} is in the privacy text`);
        }
        const intercepted = [...new Set(google.map((u) => new URL(u).host))];
        const seen = analyticsHosts.filter((r) => intercepted.some((h) => covers(r.host, h)));
        assert.deepEqual(
          seen.map((r) => r.host),
          analyticsHosts.map((r) => r.host),
          `every analytics host class is intercepted (saw ${intercepted.join(', ')})`,
        );
        for (const r of analyticsHosts) assert.ok(privacy.includes(r.host), `${r.host} is named`);
        t.diagnostic(
          `${label(c)}: ${capture.beacons.length} /stats/v1 beacons; Google requests answered locally: ${google.length} (${intercepted.join(', ')}); analytics classes observed: ${seen.map((r) => r.host).join(', ')}; hosts ${[...hosts].join(', ')}`,
        );
        writeFileSync(
          join(results, `stats-${label(c)}.json`),
          JSON.stringify({ beacons: capture.beacons, hosts: [...hosts], google, queued }, null, 1),
        );
        await context.close();
      }
    } finally {
      await browser.close();
      await capture.stop();
      await site.stop();
    }
  },
);
