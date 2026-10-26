// fm-vbj7: the scheduler-backed operation service drives real runtime work in the expected order with
// correct settlement. Real bridge, real runtime bytes and CPU inference in the identified build:next
// destination: a word face, a seed face cancelled mid-inference then retried (a new attempt), and a morph
// with one unfinished input, each through file preparation and the MP4. The recorded trace (requests,
// permit/reservation acquire and release, provider requested/actual, compute-ready, file-ready, cancelled,
// settled) is compared with test/harness/opctl-expected-trace.json; a mismatch names the first divergence.
// The bounded execution gate records each compute section's acquire/release; verified reads release
// compute and finished dependency reuse needs no lease. Keep every section in the strict expected trace.
// OPCTL_TRACE_UPDATE=1 rewrites the expected trace from this run (review the diff before committing).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { compareTraces, normalizeTrace, type TraceEvent } from '../harness/opctl-trace.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results =
  process.env['OPCTL_TRACE_RESULTS'] ?? join(REPO, 'apps/web/test-results/opctl-trace');
const expectedPath = join(REPO, 'apps/web/test/harness/opctl-expected-trace.json');

const stateOf = (page: Page, index: number) =>
  page.evaluate(
    (i) => document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state'),
    index,
  );
const actionOf = (page: Page, index: number) =>
  page.evaluate(
    (i) =>
      document
        .querySelectorAll('section.next-face')
        [i]?.querySelector('.next-input-row .next-face-generate')
        ?.textContent?.trim(),
    index,
  );

test(
  'the operation trace on CPU matches the committed expected trace',
  { timeout: 900_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-vbj7; run on the runtime lane`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    mkdirSync(results, { recursive: true });
    writeFileSync(
      join(results, 'artifact-identity.json'),
      JSON.stringify(artifact.identity, null, 2) + '\n',
    );
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript(INSTALL_HOOK);
    await context.addInitScript(() => {
      (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] }).__FACEMORPH_OPCTL_TRACE__ = [];
    });
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let ok = false;
    try {
      await page.goto(ORIGIN);
      const tiles = page.locator('section.next-face');
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
          await control.click(); // setup
      await page.getByRole('button', { name: 'More options' }).click(); // setup
      await page.getByLabel('Processing mode').selectOption('cpu');
      const slot = (index: number) =>
        tiles.nth(index).locator('.next-input-row .next-face-generate');
      const waitState = (index: number, state: string) =>
        page.waitForFunction(
          ([i, s]) =>
            document
              .querySelectorAll('section.next-face')
              [i as number]?.getAttribute('data-next-state') === s,
          [index, state] as const,
          { timeout: 300_000 },
        );
      const idle = () =>
        page.waitForFunction(
          () => !document.querySelector('.next-product[data-next-busy=true]'),
          null,
          {
            timeout: 300_000,
          },
        );

      // 1. A word face (the models are acquired on the way).
      await tiles.nth(0).locator('.next-field input').fill('trace word face');
      await slot(0).click();
      const consent = page.locator('.next-download-accept');
      if (
        await consent.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await consent.click();
      await waitState(0, 'filled');
      await idle();

      // 2. A seed face, cancelled mid-inference, then retried as a new attempt.
      await tiles.nth(1).getByRole('button', { name: 'Change mode' }).click(); // setup
      await page.getByRole('menuitem', { name: 'Numeric seed', exact: true }).click(); // setup
      await tiles.nth(1).locator('.next-field input').fill('424242');
      await slot(1).click();
      // The label precedes engine work. This warm seed maps in its first compute section,
      // then synthesizes in its second: cancel only while that actual inference lease is held.
      await page.waitForFunction(
        () => {
          const events =
            (
              globalThis as {
                __FACEMORPH_OPCTL_TRACE__?: { type: string; jobId?: string }[];
              }
            ).__FACEMORPH_OPCTL_TRACE__ ?? [];
          const job = events.filter((event) => event.type === 'provider-requested').at(-1)?.jobId;
          const acquired = events.filter(
            (event) => event.type === 'permit-acquire' && event.jobId === job,
          ).length;
          const released = events.filter(
            (event) => event.type === 'permit-release' && event.jobId === job,
          ).length;
          return (
            acquired === 2 &&
            released === 1 &&
            document
              .querySelectorAll('section.next-face')[1]
              ?.querySelector('.next-tile-status')
              ?.textContent?.trim() === 'Generating…'
          );
        },
        null,
        { timeout: 120_000 },
      );
      await slot(1).click(); // Cancel
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll('section.next-face')[1]
            ?.querySelector('.next-face-generate')
            ?.textContent?.trim() === 'Retry',
        null,
        { timeout: 120_000 },
      );
      assert.equal(await actionOf(page, 1), 'Retry');
      await slot(1).click(); // Retry
      await waitState(1, 'filled');
      await idle();

      // 3. A morph with one unfinished input.
      await page.getByRole('button', { name: 'Add face', exact: true }).click(); // setup
      await tiles.nth(2).waitFor();
      await tiles.nth(2).locator('.next-field input').fill('trace unfinished input');
      assert.notEqual(await stateOf(page, 2), 'filled');
      await page.locator('.next-primary-action').click();
      await page.waitForFunction(
        () => {
          const model = (
            window as unknown as { __elmish: { model: { VideoUrl: string; Busy: boolean } } }
          ).__elmish.model;
          return !!model.VideoUrl && !model.Busy;
        },
        null,
        { timeout: 600_000 },
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(results, 'trace-run.png'), fullPage: true });

      const trace = (await page.evaluate(
        () => (globalThis as { __FACEMORPH_OPCTL_TRACE__?: unknown[] }).__FACEMORPH_OPCTL_TRACE__,
      )) as TraceEvent[];
      writeFileSync(
        join(results, 'actual-trace.json'),
        JSON.stringify(normalizeTrace(trace), null, 2) + '\n',
      );
      if (process.env['OPCTL_TRACE_UPDATE'] === '1')
        writeFileSync(expectedPath, JSON.stringify(normalizeTrace(trace), null, 2) + '\n');
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as TraceEvent[];
      const result = compareTraces(expected, trace);
      assert.ok(result.ok, result.ok ? '' : result.message);
      assert.deepEqual(errors, []);
      ok = true;
    } finally {
      await context.tracing.stop(ok ? {} : { path: join(results, 'failure-trace.zip') });
      if (!ok)
        await page
          .screenshot({ path: join(results, 'failure.png'), fullPage: true })
          .catch(() => {});
      await context.close();
      await browser.close();
      await site.stop();
    }
  },
);
