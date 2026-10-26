// fm-25um: old text/seed/guid links (?from_value= … ?to_guid=) open the ordinary empty page in the identified
// built application: the same requests as a plain arrival, no filled field, notice or error, and the keys and
// values never reach requests, storage, diagnostics links or an exported file (real CPU synthesis, then Save).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { chromium, devices, type Locator, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { press } from '../support/operate.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const results = join(REPO, 'apps/web/test-results/legacy-links');
const KEYS = ['from_value', 'to_value', 'from_seed', 'to_seed', 'from_guid', 'to_guid'];
const LEGACY = `/?${KEYS.map((k) => `${k}=legacy-${k.replace('_', '-')}`).join('&')}`;
const LEAK = /legacy-|from_value|to_value|from_seed|to_seed|from_guid|to_guid/;

test(
  'legacy link keys open the plain page with the same requests and never reach requests, storage, diagnostics or exports',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-25um; run on the runtime lane`;
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
        // One fresh context per arrival, so neither load inherits the other's storage or cache.
        const arrive = async (path: string) => {
          const context = await browser.newContext({
            ...(touch ? devices['iPhone 13'] : {}),
            viewport: { width, height: 900 },
            hasTouch: touch,
            isMobile: touch,
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
          });
          const page = await context.newPage();
          const requests: string[] = [];
          const errors: string[] = [];
          page.on('request', (r) => requests.push(r.url()));
          page.on('pageerror', (e) => errors.push(e.message));
          await page.goto(`${ORIGIN}${path}`);
          await page.locator('section.next-face').nth(1).waitFor();
          await page.waitForLoadState('networkidle');
          const view = await page.evaluate(() => ({
            fields: [
              ...document.querySelectorAll<HTMLInputElement>('section.next-face .next-field input'),
            ].map((i) => i.value),
            text: document.querySelector('.next-product')?.textContent ?? '',
            links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.href),
            storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
          }));
          await page.screenshot({
            path: join(results, `${name}-${path === '/' ? 'plain' : 'legacy'}.png`),
            fullPage: true,
          });
          return { context, page, requests, errors, view };
        };
        const paths = (urls: string[]) => [...new Set(urls.map((u) => new URL(u).pathname))].sort();

        const plain = await arrive('/');
        await plain.context.close();
        const legacy = await arrive(LEGACY);
        try {
          // The page really arrived with every key, and both arrivals made real requests to compare.
          for (const key of KEYS) assert.ok(new URL(legacy.page.url()).searchParams.has(key), key);
          assert.ok(paths(plain.requests).length > 5, `${name}: plain arrival requests`);
          assert.deepEqual(
            paths(legacy.requests),
            paths(plain.requests),
            `${name}: same requests as a plain arrival`,
          );
          assert.deepEqual(
            legacy.requests.filter(
              (u) =>
                LEAK.test(new URL(u).search + new URL(u).pathname) &&
                !u.startsWith(`${ORIGIN}${LEGACY}`),
            ),
            [],
          );
          assert.deepEqual(
            legacy.view.fields,
            plain.view.fields,
            `${name}: no field filled from the link`,
          );
          assert.equal(legacy.view.text, plain.view.text, `${name}: no notice or error`);
          assert.deepEqual(legacy.errors, []);
          assert.doesNotMatch(legacy.view.storage, LEAK);
          for (const href of legacy.view.links)
            assert.doesNotMatch(href, LEAK, `${name}: link ${href}`);
          if (name === 'desktop') await exportIsClean(legacy.page, touch);
        } finally {
          await legacy.context.close();
        }
      }
    } finally {
      await browser.close();
      await site.stop();
    }
  },
);

// Real CPU synthesis of face 2 on the legacy-link page, then Save: neither the file name nor its bytes carry the link.
async function exportIsClean(page: Page, touch: boolean): Promise<void> {
  const operate = async (control: Locator) =>
    assert.ok((await press(page, control, { touch })).inside);
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
  await operate(tile.locator('.next-input-row .next-face-generate'));
  const download = page.locator('.next-download-accept');
  if (
    await download.waitFor({ timeout: 8000 }).then(
      () => true,
      () => false,
    )
  )
    await operate(download);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
      'filled',
    null,
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.next-product[data-next-busy=true]'),
    null,
    {
      timeout: 180_000,
    },
  );
  const saved = page.waitForEvent('download');
  await operate(tile.getByRole('button', { name: 'Save image', exact: true }));
  const file = await saved;
  const path = join(results, `legacy-export-${file.suggestedFilename()}`);
  await file.saveAs(path);
  assert.doesNotMatch(file.suggestedFilename(), LEAK);
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 0);
  assert.doesNotMatch(
    bytes.toString('latin1'),
    LEAK,
    'exported bytes carry no legacy link key or value',
  );
}
