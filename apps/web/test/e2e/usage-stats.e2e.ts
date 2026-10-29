// fm-5yqq: the changeover statistics sink and its Usage statistics switch in real Chromium (CPU, WebGPU off).
//  1. Batching in a real browser with real time: the sink module itself on a page at the production origin,
//     its sendBeacon intercepted: 150 events, 60 s, page hide, a hidden page, a split body, a throwing beacon.
//  2. The shipped destination (deploy-next, from `npm run build:next`) under automation sends nothing at all,
//     and its switch says why.
//  3. A production-host test build (deploy-next rebuilt with FACEMORPH_STATS_ALLOW_AUTOMATION=1, the only way the
//     automation opt-out is cleared): one session (visit, faces, a morph, a Save, a reload) sends beacons that hold
//     only closed-vocabulary events with app "monorepo", only to same-origin /stats/v1, and contacts no new host.
//  4. The switch operated at 390 px (touch) and 1,280 px (mouse) at its visible position, by the checkbox, its label
//     and Space: Off stops every further beacon across a job and a page hide; reload keeps it; On resumes; with
//     Global Privacy Control it is Off and disabled with its reason; a throwing storage shows the tab-only line.
// The Worker drops automation by user agent, so beacons are asserted at the page's request interception and the
// Worker's own validation (services/stats/worker.mjs `increments`) is applied to every intercepted body here.
//   FACEMORPH_REQUIRE_RUNTIME=1 node --test test/e2e/usage-stats.e2e.ts   (logs in test-results/usage-stats/)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  startControl,
  PORT,
  ORIGIN,
  ORIGIN_HOST,
  PROJECT_HOSTS,
  REPO,
} from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';
import { startCapture, type Capture, type Captured } from '../support/stats-capture.ts';
import { VOCAB, increments } from '../../../../services/stats/worker.mjs';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/usage-stats');
const KEY = 'facemorph-usage-stats';
mkdirSync(results, { recursive: true });

type Beacon = Captured;

/**
 * Beacons as the local capture server received them (a page-hide beacon leaves after its document, where page
 * interception cannot see it), and every host each step contacted, seen at the page.
 */
function intercept(context: BrowserContext, capture: Capture) {
  capture.beacons.length = 0;
  capture.step = 'start';
  const hosts: Record<string, string[]> = {};
  context.on('request', (request) => {
    if (!/^https?:/.test(request.url())) return;
    const host = new URL(request.url()).host;
    const seen = (hosts[capture.step] ??= []);
    if (!seen.includes(host)) seen.push(host);
  });
  return {
    get step() {
      return capture.step;
    },
    set step(value: string) {
      capture.step = value;
    },
    beacons: capture.beacons,
    hosts,
  };
}

/** Each event uses only the Worker's closed vocabulary, and the Worker accepts the whole beacon. */
function assertClosed(beacon: Beacon) {
  assert.equal(beacon.path, '/stats/v1');
  assert.equal(beacon.origin, ORIGIN, 'sent from the page origin');
  assert.equal(beacon.fetchSite, 'same-origin');
  assert.equal(beacon.method, 'POST');
  assert.equal(beacon.body.v, 1);
  assert.equal(beacon.body.app, 'monorepo');
  assert.ok(beacon.bytes <= 3800, `beacon of ${beacon.bytes} bytes`);
  assert.deepEqual(Object.keys(beacon.body).sort(), ['app', 'events', 'v']);
  const fields: Record<string, readonly string[]> = VOCAB;
  const numbers = new Set(['ms', 'n', 'mb']);
  const kinds = [
    'visit',
    'job',
    'ttfr',
    'frames',
    'export',
    'model_mb',
    'job_warm',
    'compute',
    'model',
  ];
  for (const event of beacon.body.events) {
    assert.ok(kinds.includes(String(event['t'])), `kind ${String(event['t'])}`);
    for (const [key, value] of Object.entries(event)) {
      if (key === 't') continue;
      if (numbers.has(key)) {
        assert.ok(typeof value === 'number' && value >= 0 && value <= 3.6e6, `${key}=${value}`);
        continue;
      }
      assert.ok(
        fields[key]?.includes(String(value)),
        `${String(event['t'])}.${key}=${String(value)}`,
      );
    }
  }
  const counted = increments(beacon.body, 'next');
  assert.ok(counted && counted.size > 0, 'the Worker counts it');
  for (const key of counted.keys()) assert.match(key, /app="monorepo",host="next"/);
}

// ---- 1. batching, real browser, real time ----------------------------------------------------------------------

test('batching in a real browser with real time', { timeout: 300_000 }, async (t) => {
  const src = join(REPO, 'apps/web/src');
  const modules: Record<string, string> = {
    '/__stats/usage-stats.js': stripTypeScriptTypes(
      readFileSync(join(src, 'analytics/usage-stats.ts'), 'utf8'),
    ).replace("'../Next/analytics.mjs'", "'/__stats/analytics.mjs'"),
    '/__stats/analytics.mjs': readFileSync(join(src, 'Next/analytics.mjs'), 'utf8'),
    '/__stats/': '<!doctype html><title>stats</title><p>stats harness</p>',
    '/__stats/other': '<!doctype html><title>other</title>',
  };
  const capture = await startCapture({
    host: ORIGIN_HOST,
    files: Object.fromEntries(
      Object.entries(modules).map(([path, body]) => [
        path,
        { type: /\.m?js$/.test(path) ? 'text/javascript' : 'text/html', body },
      ]),
    ),
  });
  const browser = await chromium.launch({ args: [...capture.args, '--disable-features=WebGPU'] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const log = intercept(context, capture);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const open = async () => {
      await page.goto(`${ORIGIN}/__stats/`);
      await page.evaluate(async () => {
        const m = await import('/__stats/usage-stats.js' as string);
        (window as unknown as { sink: unknown }).sink = m.createSink({ allowAutomation: true });
      });
    };
    const record = (n: number, kind = 'job') =>
      page.evaluate(
        ([count, k]) => {
          const sink = (window as unknown as { sink: { record(k: string, d: object): void } }).sink;
          for (let i = 0; i < (count as number); i++)
            sink.record(k as string, {
              action: 'face',
              route: 'cpu',
              outcome: 'completed',
              ms: 1000 + i,
              visit: 'first',
            });
        },
        [n, kind] as const,
      );
    const events = (step: string) =>
      log.beacons.filter((b) => b.step === step).reduce((n, b) => n + b.body.events.length, 0);

    await open();
    log.step = 'count';
    await record(149);
    await page.waitForTimeout(1000);
    assert.equal(events('count'), 0, 'nothing sent before 150 events');
    await record(1);
    await page.waitForTimeout(1000);
    assert.equal(events('count'), 150, 'the 150th event sends the batch');
    const parts = log.beacons.filter((b) => b.step === 'count');
    assert.ok(parts.length >= 2, `150 events split into ${parts.length} bodies`);
    for (const b of parts) assertClosed(b);

    // A fresh sink: the 150-event step's own 60 s timer must not flush this one early.
    await open();
    log.step = 'minute';
    const began = Date.now();
    await record(1);
    await page.waitForTimeout(50_000);
    assert.equal(events('minute'), 0, 'nothing sent before 60 s');
    while (events('minute') === 0 && Date.now() - began < 75_000) await page.waitForTimeout(250);
    assert.equal(events('minute'), 1, 'one event sent by the 60 s flush');
    const waited = log.beacons.find((b) => b.step === 'minute')!.at - began;
    assert.ok(waited >= 59_000 && waited < 70_000, `flushed after ${waited} ms`);

    log.step = 'pagehide';
    await record(2);
    await page.goto(`${ORIGIN}/__stats/other`);
    await page.waitForTimeout(1000);
    assert.equal(events('pagehide'), 2, 'page hide sends the queue');

    await open();
    log.step = 'hidden';
    await record(3, 'visit');
    // Headless Chromium never hides a page (another tab in front, a minimised window: both stay 'visible'), so
    // the hidden state is set on the document and the browser's own visibilitychange event is fired at it.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1000);
    assert.equal(events('hidden'), 3, 'a hidden page sends the queue');

    log.step = 'throwing';
    const outcome = await page.evaluate(() => {
      Object.defineProperty(navigator, 'sendBeacon', {
        value: () => {
          throw new Error('blocked by an extension');
        },
      });
      const sink = (
        window as unknown as { sink: { record(k: string, d: object): void; flush(): void } }
      ).sink;
      try {
        sink.record('visit', { visit: 'first' });
        sink.flush();
        return 'returned';
      } catch (e) {
        return `threw ${e}`;
      }
    });
    assert.equal(outcome, 'returned');
    assert.deepEqual(errors, []);
    writeFileSync(join(results, 'batching.json'), JSON.stringify(log, null, 1));
    t.diagnostic(
      `bodies at 150: ${parts.map((b) => b.bytes).join(', ')} bytes; 60 s flush after ${waited} ms`,
    );
    await context.close();
  } finally {
    await browser.close();
    await capture.stop();
  }
});

// ---- the built application -------------------------------------------------------------------------------------

function runtimeOrSkip(t: { skip(reason: string): void }): boolean {
  if (existsSync(join(runtime, 'manifest.json'))) return true;
  const reason = `untested: no acquired runtime at ${runtime}; owner fm-5yqq; run on the runtime lane`;
  if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
  t.skip(reason);
  return false;
}

/** deploy-next rebuilt with the automation opt-out cleared at build time, beside (never over) deploy-next. */
function testBuild(): string {
  const out = join(REPO, '.cache/usage-stats-test-build');
  rmSync(out, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: join(REPO, 'apps/web'),
    env: { ...process.env, FACEMORPH_STATS_ALLOW_AUTOMATION: '1' },
    stdio: 'inherit',
  });
  for (const name of ['catalogue.json', '_headers', '_redirects'])
    cpSync(join(REPO, 'deploy-next', name), join(out, name));
  return out;
}

/** The app server, the capture server in front of it at the production origin, and Chromium sent there. */
async function withSite<T>(
  artifact: string,
  source: string,
  fn: (browser: Browser, capture: Capture) => Promise<T>,
) {
  const site = await startControl({ runtime, artifact, source });
  const capture = await startCapture({ host: ORIGIN_HOST, upstream: PORT });
  const browser = await chromium.launch({ args: [...capture.args, '--disable-features=WebGPU'] });
  try {
    return await fn(browser, capture);
  } finally {
    await browser.close();
    await capture.stop();
    await site.stop();
  }
}

const switchBox = (page: Page) => page.getByRole('checkbox', { name: /^Usage statistics/ });
const switchArea = (page: Page) => page.locator('.next-usage-stats');

async function openApp(page: Page, touch: boolean) {
  await page.goto(ORIGIN);
  await settleToasts(page, touch);
}

/** A reload is a page hide; the first-visit prompts come back after it. */
async function reopen(page: Page, touch: boolean) {
  await page.reload();
  await settleToasts(page, touch);
}

async function settleToasts(page: Page, touch: boolean) {
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
      assert.ok((await press(page, control, { touch })).inside);
}

/** The switch sits in the debug-report area (#debug-reporting once fm-szbf lands; the For-testing box until then). */
async function assertPlacement(page: Page) {
  const inside = await switchArea(page).evaluate(
    (el) =>
      !!el.closest('#debug-reporting, .next-debug') &&
      !el.closest('.next-face, .next-morph, .next-video'),
  );
  assert.ok(inside, 'the switch is in the debug-report area only');
}

async function cpuMode(page: Page, touch: boolean) {
  assert.ok(
    (await press(page, page.getByRole('button', { name: 'More options' }), { touch })).inside,
  );
  await page.getByLabel('Processing mode').selectOption('cpu');
}

async function generate(page: Page, index: number, value: string, touch: boolean) {
  const tile = page.locator('section.next-face').nth(index);
  const field = tile.locator('.next-field input');
  assert.ok((await press(page, field, { touch })).inside);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
  assert.ok(
    (await press(page, tile.locator('.next-input-row .next-face-generate'), { touch })).inside,
  );
  const accept = page.locator('.next-download-accept');
  if (
    await accept.waitFor({ timeout: 8000 }).then(
      () => true,
      () => false,
    )
  )
    assert.ok((await press(page, accept, { touch })).inside);
  await page.waitForFunction(
    (i) =>
      document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state') ===
      'filled',
    index,
    { timeout: 240_000 },
  );
  await idle(page);
}

function idle(page: Page) {
  return page.waitForFunction(
    () => !document.querySelector('.next-product[data-next-busy=true]'),
    null,
    {
      timeout: 600_000,
    },
  );
}

test(
  'the shipped destination sends nothing under automation, and its switch says why',
  { timeout: 600_000 },
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    await withSite(
      resolve(REPO, 'deploy-next'),
      artifact.identity.deploySource.buildId,
      async (browser, capture) => {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          ignoreHTTPSErrors: true,
        });
        const log = intercept(context, capture);
        const page = await context.newPage();
        await openApp(page, false);
        await cpuMode(page, false);
        log.step = 'face';
        await generate(page, 1, 'Emma', false);
        log.step = 'hide';
        await reopen(page, false);
        await page.waitForTimeout(1000);
        assert.deepEqual(
          log.beacons,
          [],
          'no /stats/v1 request from the shipped build under automation',
        );
        await assertPlacement(page);
        assert.equal(await switchBox(page).isChecked(), false);
        assert.equal(await switchBox(page).isDisabled(), true);
        assert.match(await switchArea(page).innerText(), /Off in automated browsers/);
        writeFileSync(join(results, 'destination.json'), JSON.stringify(log, null, 1));
        await page.screenshot({
          path: join(results, 'destination-switch-1280.png'),
          fullPage: true,
        });
        await context.close();
      },
    );
  },
);

test(
  'a production-host test build: one session sends only closed-vocabulary monorepo beacons to /stats/v1',
  { timeout: 600_000 }, // 114 s on eris, including its Vite build (158 s with an 8-frame-per-face morph)
  async (t) => {
    if (!runtimeOrSkip(t)) return;
    const build = testBuild();
    await withSite(build, 'usage-stats-test-build', async (browser, capture) => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
      });
      const log = intercept(context, capture);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      log.step = 'visit';
      await openApp(page, false);
      assert.equal(await switchBox(page).isChecked(), true, 'On by default on the production host');
      await cpuMode(page, false);
      log.step = 'faces';
      await generate(page, 0, 'Olivia', false);
      await generate(page, 1, 'Emma', false);
      log.step = 'save';
      const saved = page.waitForEvent('download');
      const tile = page.locator('section.next-face').nth(1);
      assert.ok(
        (await press(page, tile.getByRole('button', { name: 'Save image', exact: true }))).inside,
      );
      await saved;
      log.step = 'morph';
      // The shortest real morph (Custom, 2 frames per face): the beacons need a completed morph, not a long one.
      await page.getByLabel('Morph length', { exact: true }).selectOption('custom'); // setup
      await page.getByRole('textbox', { name: 'Frames per face', exact: true }).fill('2'); // setup
      assert.ok((await press(page, page.locator('.next-primary-action'))).inside);
      await page
        .getByRole('button', { name: /Save video/ })
        .first()
        .waitFor({ timeout: 300_000 });
      await idle(page);
      // A reload is a page hide: everything queued goes. The model is then restored from the cache, and a second
      // face on the loaded model is a warm job, so one beacon carries model, compute and job_warm.
      log.step = 'reload';
      await reopen(page, false);
      await cpuMode(page, false);
      log.step = 'warm';
      await generate(page, 1, 'Noah', false);
      await generate(page, 1, 'Liam', false);
      log.step = 'hide';
      await page.goto('about:blank');
      await new Promise((r) => setTimeout(r, 1500));
      writeFileSync(join(results, 'session.json'), JSON.stringify(log, null, 1));

      assert.ok(log.beacons.length > 0, 'beacons were sent');
      for (const b of log.beacons) assertClosed(b);
      const all = log.beacons.flatMap((b) => b.body.events);
      const kinds = new Set(all.map((e) => e['t']));
      for (const kind of [
        'visit',
        'job',
        'ttfr',
        'frames',
        'export',
        'job_warm',
        'compute',
        'model',
      ])
        assert.ok(kinds.has(kind), `a ${kind} event was sent`);
      assert.ok(
        all.some(
          (e) => e['t'] === 'job' && e['action'] === 'morph' && e['outcome'] === 'completed',
        ),
        'the morph job',
      );
      assert.ok(
        all.some((e) => e['t'] === 'export' && e['kind'] === 'image' && e['method'] === 'save'),
      );
      assert.ok(
        log.beacons.some((b) =>
          ['job_warm', 'compute', 'model'].every((k) => b.body.events.some((e) => e['t'] === k)),
        ),
        'one beacon carries job_warm, compute and model',
      );
      const text = JSON.stringify(log.beacons.map((b) => b.body));
      for (const word of ['Olivia', 'Emma', 'Noah', 'Liam', 'HeadlessChrome', ORIGIN_HOST])
        assert.ok(!text.includes(word), `no ${word} in any beacon`);
      const allowedHosts = new Set([ORIGIN_HOST, ...PROJECT_HOSTS]);
      for (const [step, hosts] of Object.entries(log.hosts))
        for (const host of hosts) assert.ok(allowedHosts.has(host), `${step}: contacted ${host}`);
      assert.deepEqual(errors, []);
      const steps = [...new Set([...Object.keys(log.hosts), ...log.beacons.map((b) => b.step)])];
      for (const step of steps) {
        const sent = log.beacons.filter((b) => b.step === step);
        t.diagnostic(
          `${step}: hosts ${(log.hosts[step] ?? []).join(' ') || 'none'}; ${sent.length} beacon(s): ${sent.map((b) => b.body.events.map((e) => e['t']).join('+')).join(' | ')}`,
        );
      }
      await context.close();
    });
  },
);

for (const { width, height, touch } of [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 900, touch: false },
]) {
  test(
    `the switch at ${width} px: Off stops beacons across a job and a page hide; reload keeps it; On resumes; GPC; storage`,
    { timeout: 1_200_000 },
    async (t) => {
      if (!runtimeOrSkip(t)) return;
      const build = existsSync(join(REPO, '.cache/usage-stats-test-build/index.html'))
        ? join(REPO, '.cache/usage-stats-test-build')
        : testBuild();
      await withSite(build, 'usage-stats-test-build', async (browser, capture) => {
        const make = (init?: () => void) =>
          browser
            .newContext({
              viewport: { width, height },
              hasTouch: touch,
              isMobile: touch,
              ignoreHTTPSErrors: true,
            })
            .then(async (c) => {
              if (init) await c.addInitScript(init);
              return c;
            });
        const context = await make();
        const log = intercept(context, capture);
        const page = await context.newPage();
        await openApp(page, touch);
        await assertPlacement(page);
        // The FAQ entry and the privacy text, rendered at this width.
        const faq = page.locator('#usage-statistics');
        assert.ok((await press(page, faq.locator('summary'), { touch })).inside);
        const said = await faq.innerText();
        for (const fact of [
          /visits by device class/,
          /first or returning/,
          /processing mode/,
          /time to the first result/,
          /morph frames/,
          /saved or shared files/,
          /model megabytes/,
          /only running totals/,
          /No cookie or identifier/,
          /Global Privacy Control/,
          /Do Not Track/,
          /save data/,
          /automated/,
          /Usage statistics switch/,
        ])
          assert.match(said, fact);
        const privacy = page.locator('details.next-faq', {
          hasText: 'Does anything leave my device?',
        });
        assert.ok((await press(page, privacy.locator('summary'), { touch })).inside);
        assert.match(await privacy.innerText(), /\/stats\/v1, as a same-origin request/);
        await faq.screenshot({ path: join(results, `faq-${width}.png`) });
        await privacy.screenshot({ path: join(results, `privacy-${width}.png`) });
        const box = switchBox(page);
        assert.equal(await box.isChecked(), true);
        // Off by a real press at the checkbox's visible centre (touch at 390 px).
        log.step = 'off';
        assert.ok((await press(page, box, { touch })).inside);
        assert.equal(await box.isChecked(), false);
        assert.match(await switchArea(page).innerText(), /Usage statistics: Off/);
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), 'off');
        await page.screenshot({ path: join(results, `switch-off-${width}.png`) });
        await cpuMode(page, touch);
        await generate(page, 1, 'Emma', touch);
        await reopen(page, touch);
        await page.waitForTimeout(1000);
        assert.equal(
          log.beacons.length,
          0,
          'Off: no /stats/v1 request across a job and a page hide',
        );
        // Reload keeps the choice.
        assert.equal(await switchBox(page).isChecked(), false, 'reload keeps Off');
        // On by pressing the label text; Off and On again by Space on the focused checkbox.
        log.step = 'on';
        assert.ok(
          (await press(page, switchArea(page).getByText(/^Usage statistics:/), { touch })).inside,
        );
        assert.equal(await switchBox(page).isChecked(), true, 'the label turns it On');
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
        await switchBox(page).focus();
        await page.keyboard.press('Space');
        assert.equal(await switchBox(page).isChecked(), false, 'Space turns it Off');
        await page.keyboard.press('Space');
        assert.equal(await switchBox(page).isChecked(), true, 'Space turns it On');
        await cpuMode(page, touch);
        await generate(page, 1, 'Noah', touch);
        await page.goto('about:blank');
        await new Promise((r) => setTimeout(r, 1500));
        assert.ok(log.beacons.length >= 1, 'On: beacons resume');
        const resumed = log.beacons.length;
        writeFileSync(join(results, `switch-${width}.json`), JSON.stringify(log, null, 1));
        for (const b of log.beacons) assertClosed(b);
        assert.ok(log.beacons.some((b) => b.body.events.some((e) => e['t'] === 'job')));
        await context.close();

        // Global Privacy Control: Off, disabled, with the reason.
        const gpc = await make(() =>
          Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }),
        );
        const gpcLog = intercept(gpc, capture);
        const gpcPage = await gpc.newPage();
        await openApp(gpcPage, touch);
        assert.equal(await switchBox(gpcPage).isChecked(), false);
        assert.equal(await switchBox(gpcPage).isDisabled(), true);
        assert.match(await switchArea(gpcPage).innerText(), /Global Privacy Control/);
        await gpcPage.screenshot({ path: join(results, `switch-gpc-${width}.png`) });
        await gpcPage.goto('about:blank');
        assert.equal(gpcLog.beacons.length, 0, 'GPC: nothing sent');
        await gpc.close();

        // Storage that refuses the choice: the switch works for the tab and says it was not saved.
        const refusing = await make(() => {
          const set = Storage.prototype.setItem,
            remove = Storage.prototype.removeItem;
          Storage.prototype.setItem = function (k: string, v: string) {
            if (k === 'facemorph-usage-stats')
              throw new DOMException('denied', 'QuotaExceededError');
            return set.call(this, k, v);
          };
          Storage.prototype.removeItem = function (k: string) {
            if (k === 'facemorph-usage-stats') throw new DOMException('denied', 'SecurityError');
            return remove.call(this, k);
          };
        });
        const refusedLog = intercept(refusing, capture);
        const refusedPage = await refusing.newPage();
        await openApp(refusedPage, touch);
        assert.ok((await press(refusedPage, switchBox(refusedPage), { touch })).inside);
        assert.equal(await switchBox(refusedPage).isChecked(), false);
        assert.match(
          await switchArea(refusedPage).innerText(),
          /Usage statistics are off for this tab; this choice could not be saved\./,
        );
        await refusedPage.screenshot({ path: join(results, `switch-unsaved-${width}.png`) });
        await refusedPage.goto('about:blank');
        assert.equal(refusedLog.beacons.length, 0, 'tab-only Off: nothing sent');
        await refusing.close();
        t.diagnostic(
          `${width}: ${resumed} beacon(s) after On; none while Off, under GPC or tab-only Off`,
        );
      });
    },
  );
}
