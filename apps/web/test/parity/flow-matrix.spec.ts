// The parity spec (fm-hn9e): one test per row of rows.ts, run against the verified control. Parity rows act with
// real pointer or touch input at each control's visible position (press(): elementFromPoint first), take a
// screenshot at phone and desktop width, and assert what the control does: that is the freeze. Changed and new
// rows are skipped with their owner and plan section (owner-graded, never asserted); rows the control cannot
// exercise are skipped with the reason. With RECORD=1 each parity row also writes its golden steps
// (test/goldens/control/<rowId>/<project>/...).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { press } from '../support/operate.ts';
import { ORIGIN, ORIGIN_HOST, PROJECT_HOSTS } from './control-server.ts';
import { INSTALL_HOOK, READ_MODEL } from './elmish-probe.ts';
import { Recorder, type Action } from './recorder.ts';
import { ROWS, type Row } from './rows.ts';

const RECORD = process.env['RECORD'] === '1';
const row = (id: string): Row => {
  const r = ROWS.find((x) => x.rowId === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};
const annotate = (info: TestInfo, r: Row) => {
  info.annotations.push(
    { type: 'tag', description: r.tag },
    { type: 'plan', description: r.plan },
    { type: 'variants', description: r.variants.join(', ') },
  );
  if (r.owner) info.annotations.push({ type: 'owner', description: r.owner });
  for (const d of r.defects ?? [])
    info.annotations.push({ type: 'defect', description: `defect:${d}` });
};

test.beforeEach(async ({ context }) => {
  // Only the control's origin and its own catalogue Workers resolve; analytics and anything else never leave.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === ORIGIN_HOST ||
      PROJECT_HOSTS.includes(url.hostname) ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
      ? route.continue()
      : route.abort();
  });
  await context.addInitScript(INSTALL_HOOK);
});

type Model = Record<string, unknown> & {
  Busy?: boolean;
  Route?: string;
  Status?: string;
  VideoUrl?: string;
};
const model = async (page: Page) => ((await page.evaluate(READ_MODEL)) as { model: Model }).model;
const touch = (info: TestInfo) => info.project.name === 'phone';
const tile = (page: Page, i: number) => page.locator('section.next-face').nth(i);

async function open(page: Page, path = '/') {
  await page.goto(`${ORIGIN}${path}`);
  await page.waitForFunction(
    'window.__elmish && window.__elmish.commits > 0 && document.querySelectorAll("section.next-face").length >= 1',
    null,
    { timeout: 60_000 },
  );
}

/** The first visit stacks the model toast and the 'Help us test?' toast, which can cover the morph controls (defect
 * 16, owned by ws-diag): a person answers them first, so this presses 'Not now' and 'Ask me later' where they are. */
async function dismissToasts(page: Page, info: TestInfo) {
  for (const answer of [
    page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
    page.locator('.next-consent-toast button[aria-label="Ask me later"]'),
  ]) {
    if (
      await answer.waitFor({ timeout: 10_000 }).then(
        () => true,
        () => false,
      )
    ) {
      // the model toast waits for the download inventory
      expect((await press(page, answer, { touch: touch(info) })).inside).toBe(true);
      await expect(answer).toBeHidden();
    }
  }
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

/** Clears a tile's field and types `text` into it like a person: press the field, select all, delete, type. */
async function typeInto(page: Page, info: TestInfo, i: number, text: string) {
  const at = await press(page, tile(page, i).locator('.next-field input'), { touch: touch(info) });
  expect(at.inside).toBe(true);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 15 });
  return at;
}

/** Accepts the download dialog if the control asks (a first run on a cold model does). */
async function acceptDownload(page: Page, info: TestInfo) {
  const accept = page.locator('.next-download-dialog .next-download-accept');
  if (
    await accept.waitFor({ timeout: 8000 }).then(
      () => true,
      () => false,
    )
  )
    expect((await press(page, accept, { touch: touch(info) })).inside).toBe(true);
}

async function idle(page: Page, timeout = 600_000) {
  await page.waitForFunction(
    'window.__elmish.model && window.__elmish.model.Busy === false',
    null,
    { timeout },
  );
}

/** Presses a tile's Generate, accepts a download if asked, and waits for its face. */
async function generate(page: Page, info: TestInfo, i: number) {
  expect(
    (await press(page, tile(page, i).locator('.next-face-generate'), { touch: touch(info) }))
      .inside,
  ).toBe(true);
  await acceptDownload(page, info);
  await expect(tile(page, i)).toHaveAttribute('data-next-state', 'filled', { timeout: 600_000 });
  await idle(page);
}

function recorder(page: Page, info: TestInfo, rowId: string) {
  const r = new Recorder(page, `${rowId}/${info.project.name}`);
  return {
    step: (name: string, action: Action) => (RECORD ? r.record(name, action) : Promise.resolve()),
    done: () => {
      if (RECORD) r.write();
    },
  };
}

// ---------------------------------------------------------------- parity rows (independent)

test('first-visit', async ({ page, context }, info) => {
  annotate(info, row('first-visit'));
  const runtime: string[] = [];
  context.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    if (/^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(p)) runtime.push(p);
  });
  const rec = recorder(page, info, 'first-visit');
  await open(page);
  await rec.step('arrived', { kind: 'load', target: `${ORIGIN}/` });
  await expect(page.locator('section.next-face')).toHaveCount(2);
  await expect(tile(page, 0)).toHaveAttribute('data-next-state', 'preview');
  await expect(tile(page, 0).locator('.next-field input')).toHaveValue('hello');
  await expect(tile(page, 1).locator('.next-field input')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('.next-primary-action')).toBeEnabled();
  await page.waitForTimeout(3000); // anything an arrival would fetch has had time to start
  expect(runtime, 'no model bytes are fetched on arrival').toEqual([]);
  await shot(page, info, 'first-visit');
  rec.done();
});

test('words.generate-cpu', async ({ page }, info) => {
  annotate(info, row('words.generate-cpu'));
  const rec = recorder(page, info, 'words.generate-cpu');
  await open(page);
  await rec.step('arrived', { kind: 'load' });
  const at = await typeInto(page, info, 1, 'parity sample');
  await rec.step('typed', {
    kind: 'type',
    target: 'Morph to field',
    at: { x: at.x, y: at.y },
    text: 'parity sample',
  });
  await generate(page, info, 1);
  await rec.step('generated', { kind: 'wait', target: 'Morph to shows its face' });
  const m = await model(page);
  expect(m.Route).toBe('cpu');
  expect(m.Status).toBe('Face updated.');
  await expect(page.locator('.next-route-caption')).toHaveText('Ready · this device’s CPU.');
  await shot(page, info, 'words-generated');
  rec.done();
});

test('seed.generate', async ({ page }, info) => {
  annotate(info, row('seed.generate'));
  const rec = recorder(page, info, 'seed.generate');
  await open(page);
  const t = touch(info);
  expect(
    (await press(page, tile(page, 1).getByRole('button', { name: 'Change mode' }), { touch: t }))
      .inside,
  ).toBe(true);
  const seed = page.getByRole('menuitem', { name: 'Numeric seed' });
  await seed.waitFor();
  expect((await press(page, seed, { touch: t })).inside).toBe(true);
  await expect(page.getByRole('menu')).toBeHidden(); // the menu has finished closing, as a person sees it
  await expect(tile(page, 1).locator('input[type=number]')).toBeVisible();
  await rec.step('seed-mode', { kind: 'press', target: 'Numeric seed' });
  for (const value of ['0', '4294967295']) {
    await typeInto(page, info, 1, value);
    await rec.step(`typed-${value}`, { kind: 'type', target: 'Morph to seed', text: value });
    await generate(page, info, 1);
    await rec.step(`generated-${value}`, { kind: 'wait' });
    expect((await model(page)).Status).toBe('Face updated.');
  }
  await shot(page, info, 'seed-generated');
  rec.done();
});

test('retry-unchanged', async ({ page }, info) => {
  annotate(info, row('retry-unchanged'));
  const rec = recorder(page, info, 'retry-unchanged');
  await open(page);
  await typeInto(page, info, 1, 'parity sample');
  expect(
    (await press(page, tile(page, 1).locator('.next-face-generate'), { touch: touch(info) }))
      .inside,
  ).toBe(true);
  await acceptDownload(page, info);
  const cancel = tile(page, 1).locator('.next-tile-status').getByRole('button', { name: 'Cancel' });
  await cancel.waitFor({ timeout: 60_000 });
  await rec.step('running', { kind: 'press', target: 'Generate Morph to' });
  expect((await press(page, cancel, { touch: touch(info) })).inside).toBe(true);
  await idle(page);
  await rec.step('cancelled', { kind: 'press', target: 'Cancel' });
  await expect(tile(page, 1)).not.toHaveAttribute('data-next-state', 'filled');
  await expect(tile(page, 1).locator('.next-field input')).toHaveValue('parity sample');
  await generate(page, info, 1); // Retry: the same input, no further typing
  await rec.step('retried', { kind: 'press', target: 'Generate Morph to' });
  await shot(page, info, 'retried');
  rec.done();
});

test('names.exact-text', async ({ page }, info) => {
  annotate(info, row('names.exact-text'));
  const rec = recorder(page, info, 'names.exact-text');
  await open(page);
  await typeInto(page, info, 1, 'hello');
  await rec.step('typed', { kind: 'type', text: 'hello' });
  await generate(page, info, 1);
  await rec.step('generated', { kind: 'wait' });
  expect((await model(page)).Status).toBe('Face updated.');
  await shot(page, info, 'name-generated');
  rec.done();
});

test('phone-cpu-route', async ({ page }, info) => {
  annotate(info, row('phone-cpu-route'));
  test.skip(
    info.project.name !== 'phone',
    'A phone row: it runs in the phone project (390 px, touch).',
  );
  await open(page);
  await typeInto(page, info, 1, 'parity sample');
  await generate(page, info, 1);
  await expect(page.locator('.next-route-caption')).toHaveText('Ready · this device’s CPU.');
  await shot(page, info, 'phone-cpu');
});

test('testing-bulk-generate', async ({ page }, info) => {
  annotate(info, row('testing-bulk-generate'));
  const rec = recorder(page, info, 'testing-bulk-generate');
  await open(page, '/?testing');
  const bulk = page.getByRole('button', { name: 'Generate faces' });
  await expect(bulk).toBeVisible();
  expect((await press(page, bulk, { touch: touch(info) })).inside).toBe(true);
  await acceptDownload(page, info);
  await expect(tile(page, 0)).toHaveAttribute('data-next-state', 'filled', { timeout: 600_000 });
  await expect(tile(page, 1)).toHaveAttribute('data-next-state', 'filled', { timeout: 600_000 });
  await idle(page);
  await rec.step('bulk-generated', { kind: 'press', target: 'Generate faces' });
  for (const link of [
    'footer.next-footer a[href^="mailto:"]',
    'footer.next-footer a[target="_blank"]',
  ]) {
    expect(
      (await press(page, page.locator(link).first(), { touch: touch(info), follow: false })).inside,
    ).toBe(true);
  }
  await shot(page, info, 'bulk');
  rec.done();
});

// ---------------------------------------------------------------- parity rows on one morph (serial, shared page)

test.describe.serial('one morph', () => {
  let page: Page;
  test.beforeAll(async ({ browser }, info) => {
    const use = info.project.use;
    const context = await browser.newContext({
      viewport: use.viewport ?? null,
      isMobile: use.isMobile === true,
      hasTouch: use.hasTouch === true,
      ignoreHTTPSErrors: true,
    });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.hostname === ORIGIN_HOST ||
        PROJECT_HOSTS.includes(url.hostname) ||
        ['data:', 'blob:'].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript(INSTALL_HOOK);
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test('morph.settings-start-cancel', async ({}, info) => {
    annotate(info, row('morph.settings-start-cancel'));
    const t = touch(info);
    const rec = recorder(page, info, 'morph.settings-start-cancel');
    await open(page);
    await dismissToasts(page, info);
    expect(
      (await press(page, page.getByRole('button', { name: 'More options' }), { touch: t })).inside,
    ).toBe(true);
    const length = page.getByLabel('Morph length');
    expect((await press(page, length, { touch: t })).inside).toBe(true);
    await page.keyboard.press('Escape');
    await length.selectOption('8');
    await rec.step('settings', { kind: 'press', target: 'Morph length: short' });
    expect((await press(page, page.locator('.next-primary-action'), { touch: t })).inside).toBe(
      true,
    );
    await acceptDownload(page, info);
    await page.waitForFunction('window.__elmish.model.Busy === true', null, { timeout: 60_000 });
    await rec.step('started', { kind: 'press', target: 'Create morph' });
    const cancel = page
      .locator('.next-morph-slot .next-generate')
      .getByRole('button', { name: 'Cancel' });
    expect((await press(page, cancel, { touch: t })).inside).toBe(true);
    await idle(page);
    await rec.step('cancelled', { kind: 'press', target: 'Cancel' });
    expect((await model(page)).VideoUrl).toBe('');
    expect((await press(page, page.locator('.next-primary-action'), { touch: t })).inside).toBe(
      true,
    );
    await acceptDownload(page, info);
    await page.locator('video.next-video').waitFor({ timeout: 900_000 });
    await idle(page);
    await rec.step('morphed', { kind: 'press', target: 'Create morph' });
    await shot(page, info, 'morphed');
    rec.done();
  });

  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test('morph.play-slider', async ({}, info) => {
    annotate(info, row('morph.play-slider'));
    const t = touch(info);
    const rec = recorder(page, info, 'morph.play-slider');
    const video = page.locator('video.next-video');
    await expect(video).toBeVisible();
    expect(await video.evaluate((v: HTMLVideoElement) => v.loop && v.controls)).toBe(true);
    expect((await press(page, page.getByLabel('Use Slider'), { touch: t })).inside).toBe(true);
    await expect(page.locator('.next-slider canvas')).toBeVisible();
    await expect(video).toHaveCount(0);
    await rec.step('slider', { kind: 'press', target: 'Use Slider' });
    const rail = page.locator('.next-slider-control');
    await rail.scrollIntoViewIfNeeded();
    const box = await rail.boundingBox();
    if (!box) throw new Error('no slider');
    if (t) await page.touchscreen.tap(box.x + box.width - 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    const thumb = rail.getByRole('slider'); // MUI 4 keeps its value on a hidden input; the role carries the ARIA values
    const max = await thumb.getAttribute('aria-valuemax');
    expect(Number(max)).toBeGreaterThan(1);
    await expect(thumb).toHaveAttribute('aria-valuenow', max ?? '');
    await rec.step('scrubbed-to-end', { kind: t ? 'touch' : 'press', target: 'slider end' });
    await shot(page, info, 'slider-end');
    expect((await press(page, page.getByLabel('Use Slider'), { touch: t })).inside).toBe(true);
    await expect(page.locator('video.next-video')).toBeVisible();
    rec.done();
  });

  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test('save.face-mp4', async ({}, info) => {
    annotate(info, row('save.face-mp4'));
    const t = touch(info);
    const face = page.waitForEvent('download');
    expect(
      (await press(page, tile(page, 0).getByRole('button', { name: 'Save image' }), { touch: t }))
        .inside,
    ).toBe(true);
    expect((await face).suggestedFilename()).toMatch(/\.(webp|png)$/);
    const video = page.waitForEvent('download');
    expect(
      (
        await press(
          page,
          page.locator('.next-video-slot').getByRole('button', { name: 'Save video' }),
          { touch: t },
        )
      ).inside,
    ).toBe(true);
    expect((await video).suggestedFilename()).toMatch(/\.mp4$/);
  });

  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test('share.cancel-unsupported', async ({}, info) => {
    annotate(info, row('share.cancel-unsupported'));
    const canShare = await page.evaluate(() => typeof navigator.share === 'function');
    info.annotations.push({
      type: 'share',
      description: canShare
        ? 'navigator.share present'
        : 'no file sharing on this host: Save stays the obvious action',
    });
    await expect(
      page.locator('.next-video-slot').getByRole('button', { name: 'Save video' }),
    ).toBeVisible();
    await expect(
      page.locator('.next-video-slot').getByRole('button', { name: 'Share morph' }),
    ).toBeVisible();
    await shot(page, info, 'share');
  });

  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test('return-retained', async ({}, info) => {
    annotate(info, row('return-retained'));
    await page.reload();
    await page.waitForFunction('window.__elmish && window.__elmish.commits > 0', null, {
      timeout: 60_000,
    });
    await expect(page.locator('video.next-video')).toBeVisible({ timeout: 60_000 });
    await expect(tile(page, 0)).not.toHaveAttribute('data-next-state', 'empty');
    await shot(page, info, 'returned');
  });
});

// ---------------------------------------------------------------- changed and new rows

for (const r of ROWS.filter((x) => x.tag !== 'parity')) {
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test(r.rowId, async ({}, info) => {
    annotate(info, r);
    // disabled-test: reason=changed and new rows are owner-graded and never asserted against the control; owner=fm-fy2.5; until=each row's owning bead asserts it against the new app
    test.skip(
      true,
      r.unexercisable
        ? `Not exercisable against the control: ${r.unexercisable}`
        : `${r.tag} row: owner-graded by ${r.owner} against ${r.plan}${r.defects?.length ? ` (defect ${r.defects.join(', ')})` : ''}; never asserted against the control.`,
    );
  });
}
