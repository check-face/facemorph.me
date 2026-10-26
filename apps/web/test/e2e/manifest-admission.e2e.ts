// fm-fy2.14: the composed app must reject a candidate before replacing its active
// runtime. Pointer faults are controlled locally; this is not a deployed rollback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { chromiumArgs, ORIGIN, REPO, startControl } from '../parity/control-server.ts';

test(
  'app rejects incompatible model sets atomically, retries a valid pointer and pins it',
  { timeout: 240_000 },
  async (t) => {
    const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: acquired runtime absent at ${runtime}`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      return t.skip(reason);
    }
    const artifact = readIdentity(REPO);
    assert.deepEqual(artifact.findings, []);
    assert.equal(artifact.identity?.label, 'destination');
    const originalBytes = readFileSync(join(runtime, 'manifest.json'), 'utf8');
    const originalSha256 = createHash('sha256').update(originalBytes).digest('hex');
    const original = JSON.parse(originalBytes);
    const newer = { ...original, schemaVersion: 2 };
    const mixed = structuredClone(original);
    assert.ok(mixed.encoder && mixed.encoderStream);
    mixed.encoderStream.sourceEncoderSha256 = 'f'.repeat(64);
    assert.notEqual(mixed.encoder.sha256, mixed.encoderStream.sourceEncoderSha256);
    let pointer = newer;
    const site = await startControl({
      runtime,
      artifact: join(REPO, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    t.after(() => site.stop());
    const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
    t.after(() => browser.close());
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    t.after(() => context.close());
    const evidence = join(REPO, 'apps/web/test-results/manifest-admission');
    mkdirSync(evidence, { recursive: true });
    await context.tracing.start({ screenshots: true, snapshots: false });
    const page = await context.newPage();
    const requests: { path: string; phase: string }[] = [];
    let phase = 'newer-major';
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/runtime/')) requests.push({ path, phase });
    });
    await context.route('**/runtime/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: pointer === original ? originalBytes : JSON.stringify(pointer),
        headers: { 'cache-control': 'no-store' },
      }),
    );
    const modelRequests = () => requests.filter((row) => row.path !== '/runtime/manifest.json');
    const acceptDownloadIfOffered = async () => {
      const approve = page.locator('.next-download-accept');
      if (
        await approve.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await approve.click();
    };
    try {
      await page.goto(ORIGIN);
      const tile = page.locator('section.next-face').nth(1);
      await tile.waitFor();
      await page.getByRole('button', { name: 'More options' }).click();
      await page.getByText('Advanced', { exact: true }).click();
      await page.getByLabel('Processing mode').selectOption('cpu');
      await tile.getByRole('button', { name: 'Change mode' }).click();
      await page.getByRole('menuitem', { name: 'Numeric seed', exact: true }).click();
      await tile.locator('.next-field input').fill('17');
      await tile.locator('.next-face-generate').click();
      // An unreadable inventory still requires consent before admission can refuse it.
      await page.locator('.next-download-accept').click();
      const error = page.locator('.next-error[role=alert]');
      await error.waitFor();
      assert.match(await error.innerText(), /model.*(?:incompatible|changed|unsupported)|reload/i);
      assert.deepEqual(modelRequests(), []);
      assert.equal(workers.filter((url) => /ort-worker/.test(url)).length, 0);
      await page.screenshot({ path: join(evidence, 'newer-major.png') });

      phase = 'mixed-set';
      pointer = mixed;
      const mixedResponse = page.waitForResponse('**/runtime/manifest.json');
      await error.getByRole('button', { name: 'Try again' }).click();
      await acceptDownloadIfOffered();
      await mixedResponse;
      await page.waitForFunction(
        () =>
          !document.querySelector('.next-product[data-next-busy=true]') &&
          document.querySelector('.next-error')?.textContent?.includes('Reload'),
      );
      assert.deepEqual(modelRequests(), [], 'mixed model identity cannot acquire model bytes');
      assert.equal(workers.filter((url) => /ort-worker/.test(url)).length, 0);
      assert.ok(
        requests.some((row) => row.phase === phase),
        'retry refetches after refused candidate',
      );
      await page.screenshot({ path: join(evidence, 'mixed-set.png') });

      phase = 'valid';
      pointer = original;
      await error.getByRole('button', { name: 'Try again' }).click();
      await acceptDownloadIfOffered();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
          'filled',
        null,
        { timeout: 180_000 },
      );
      assert.ok(modelRequests().length > 0, 'valid retry executes the actual model');
      assert.match(await page.locator('.next-route-caption').innerText(), /CPU/);
      // waitForFunction does not await an async predicate, so the stored record is polled with evaluate.
      const readStored = (expectedSha: string) =>
        page.evaluate(async (expectedSha) => {
          const request = indexedDB.open('checkface-originals-v1');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const read = db.transaction('originals').objectStore('originals').getAll();
            const rows = await new Promise<any[]>((resolve, reject) => {
              read.onsuccess = () => resolve(read.result);
              read.onerror = () => reject(read.error);
            });
            const value = rows.find((row) => row.provenance?.manifestSha256 === expectedSha);
            return value
              ? {
                  provenance: value.provenance,
                  width: value.width,
                  height: value.height,
                  latentValues: value.values.length,
                }
              : false;
          } finally {
            db.close();
          }
        }, expectedSha);
      let completed: Awaited<ReturnType<typeof readStored>> = false;
      for (const until = Date.now() + 30_000; !completed && Date.now() < until;)
        completed = (await readStored(originalSha256)) || (await page.waitForTimeout(250), false);
      assert.ok(completed);
      assert.equal(completed.provenance.provider, 'wasm');
      assert.equal(completed.provenance.route, 'cpu');
      assert.equal(completed.provenance.manifestSha256, originalSha256);
      assert.deepEqual(
        [completed.width, completed.height, completed.latentValues],
        [1024, 1024, 9216],
      );

      assert.equal(await page.locator('.next-error').count(), 0);
      const pointerReads = requests.filter((row) => row.path === '/runtime/manifest.json').length;
      phase = 'pinned-old-tab';
      pointer = newer;
      await tile.locator('.next-field input').fill('18');
      // The shell marks a running job with data-next-busy: the new face's job starts, then finishes.
      await tile.locator('.next-face-generate').click();
      await page.waitForFunction(
        () => document.querySelector('[data-next-busy]')?.getAttribute('data-next-busy') === 'true',
        null,
        { timeout: 60_000 },
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[data-next-busy]')?.getAttribute('data-next-busy') === 'false',
        null,
        { timeout: 60_000 },
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll('section.next-face')[1]?.getAttribute('data-next-state') ===
          'filled',
        null,
        { timeout: 60_000 },
      );
      assert.equal(
        requests.filter((row) => row.path === '/runtime/manifest.json').length,
        pointerReads,
        'active app retains its admitted manifest when the mutable pointer changes',
      );
      assert.equal(await page.locator('.next-error').count(), 0);
      writeFileSync(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            artifact: artifact.identity,
            scope: 'local composed app with controlled pointer; no deployed rollback claim',
            requests,
            workers,
            completed,
            results: [
              'newer-major refused',
              'mixed encoder identity refused',
              'valid retry generated',
              'active manifest pinned',
            ],
          },
          null,
          2,
        ),
      );
      await context.tracing.stop();
    } catch (error) {
      await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
      await context.tracing.stop({ path: join(evidence, 'failure.zip') }).catch(() => {});
      writeFileSync(
        join(evidence, 'failure-network.json'),
        JSON.stringify({ requests, workers }, null, 2),
      );
      throw error;
    }
  },
);
