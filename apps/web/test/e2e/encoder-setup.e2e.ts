// fm-9kr8: real CPU setup requests before any file choice, then bounded cancellation.
// FACEMORPH_DEPLOY_OUT=<identified build:next root> node --test test/e2e/encoder-setup.e2e.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as requestHttps } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { devices, type Locator } from 'playwright';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { startControl, chromiumArgs, ORIGIN, PORT, REPO } from '../parity/control-server.ts';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';
import { artifactDigest, bindOrigins, DEFAULT_HOST_MAP } from '../verify/artifact.ts';
import { operatedClick, StepLog } from '../verify/operated.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const out = resolve(process.env['FACEMORPH_DEPLOY_OUT'] ?? REPO);
const results = join(REPO, 'apps/web/test-results/encoder-setup');
const MODEL = /^\/runtime\/(assets|chunks|encoder-stream|photo)\//;
// Declared before execution: live requests must abort within 5 s of the trusted Cancel setup
// operation, followed by another 5 s with no new encoder request or encoder body bytes.
const CANCEL_BOUND_MS = 5000;
const QUIET_WINDOW_MS = 5000;
const TRANSFER_BOUND_MS = 180_000;
type Asset = { url: string; chunks?: { url: string }[] };
interface Transfer {
  path: string;
  encoder: boolean;
  start: number;
  firstByte: number;
  bytes: number;
  expectedBytes: number;
  status: number;
  closed: number;
  closedEarly: boolean;
}

/** Forward the pinned HTTPS server unchanged; suspend only real encoder response bodies.
 * The prefix and periodic trickle are original upstream bytes, not a fixture or API substitute. */
async function setupServer(encoder: Set<string>) {
  const directory = mkdtempSync(join(tmpdir(), 'facemorph-encoder-setup-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=next.facemorph.me',
      '-keyout',
      join(directory, 'key'),
      '-out',
      join(directory, 'cert'),
    ],
    { stdio: 'ignore' },
  );
  const transfers: Transfer[] = [];
  const pending = new Set<ReturnType<typeof requestHttps>>();
  const server = createServer(
    { key: readFileSync(join(directory, 'key')), cert: readFileSync(join(directory, 'cert')) },
    (request, response) => {
      const path = new URL(request.url!, ORIGIN).pathname;
      const entry: Transfer = {
        path,
        encoder: encoder.has(path),
        start: performance.now(),
        firstByte: 0,
        bytes: 0,
        expectedBytes: 0,
        status: 0,
        closed: 0,
        closedEarly: false,
      };
      transfers.push(entry);
      let closed!: () => void;
      const disconnected = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const upstream = requestHttps(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: 'next.facemorph.me' },
          rejectUnauthorized: false,
        },
        (source) => {
          entry.status = source.statusCode!;
          entry.expectedBytes = Number(source.headers['content-length'] ?? 0);
          response.writeHead(source.statusCode!, source.headers);
          void (async () => {
            try {
              const write = async (body: Buffer) => {
                if (response.destroyed) return;
                entry.firstByte ||= performance.now();
                entry.bytes += body.length;
                if (!response.write(body)) await once(response, 'drain');
              };
              for await (const chunk of source) {
                if (response.destroyed) return;
                const body = chunk as Buffer;
                if (!entry.encoder) {
                  await write(body);
                  continue;
                }
                let at = 0;
                while (at < body.length && !response.destroyed) {
                  const end = Math.min(body.length, at + (entry.bytes ? 32 : 1024));
                  await write(body.subarray(at, end));
                  at = end;
                  let timer: ReturnType<typeof setTimeout> | undefined;
                  await Promise.race([
                    disconnected,
                    new Promise<void>((resolve) => {
                      timer = setTimeout(resolve, 1000);
                    }),
                  ]);
                  clearTimeout(timer);
                }
              }
              response.end();
            } catch (error) {
              if (!response.destroyed) response.destroy(error as Error);
            }
          })();
        },
      );
      pending.add(upstream);
      upstream.on('close', () => pending.delete(upstream));
      upstream.on('error', (error) => {
        if (!response.destroyed) response.destroy(error);
      });
      response.on('close', () => {
        entry.closed = performance.now();
        entry.closedEarly = !response.writableFinished;
        closed();
        upstream.destroy();
      });
      request.pipe(upstream);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    transfers,
    port: (server.address() as AddressInfo).port,
    async close() {
      for (const request of pending) request.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test(
  'Prepare encoder transfers real bytes before a file choice; Cancel setup aborts within the declared bound',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: no acquired runtime at ${runtime}; owner fm-9kr8`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(out);
    assert.deepEqual(artifact.findings, []);
    const digest = artifactDigest(artifact.identity.files);
    const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')) as {
      encoderStream: Asset;
    };
    const descriptorPath = new URL(manifest.encoderStream.url).pathname;
    const descriptor = JSON.parse(
      readFileSync(join(runtime, descriptorPath.slice('/runtime/'.length)), 'utf8'),
    ) as { steps: Asset[] };
    const encoder = new Set(
      descriptor.steps.flatMap((asset) =>
        [asset.url, ...(asset.chunks ?? []).map((chunk) => chunk.url)].map(
          (url) => new URL(url, ORIGIN).pathname,
        ),
      ),
    );
    assert.ok(encoder.size > 0, 'the acquired descriptor names actual encoder assets');
    const site = await startControl({
      runtime,
      artifact: join(out, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    mkdirSync(results, { recursive: true });
    try {
      for (const [width, touch] of [
        [1280, false],
        [390, true],
      ] as const) {
        const proxy = await setupServer(encoder);
        const profile = await launchFreshChromiumProfile({
          ...(touch ? devices['Pixel 7'] : {}),
          viewport: { width, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          ignoreHTTPSErrors: true,
          args: [
            ...chromiumArgs.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
            `--host-resolver-rules=MAP next.facemorph.me:443 127.0.0.1:${proxy.port}`,
            '--enable-automation',
            '--disable-features=WebGPU',
          ],
        });
        const context = profile.context;
        const page = await context.newPage();
        const steps = new StepLog({
          map: bindOrigins(DEFAULT_HOST_MAP, { app: [ORIGIN] }),
          run: { digest, source: artifact.identity.deploySource.buildId },
        });
        steps.attach(page);
        const errors: string[] = [];
        const network: {
          url: string;
          path: string;
          encoder: boolean;
          start: number;
          failed?: string;
          failedAt?: number;
          finishedAt?: number;
        }[] = [];
        const requests = new Map<object, (typeof network)[number]>();
        context.on('request', (request) => {
          const path = new URL(request.url()).pathname;
          if (!MODEL.test(path)) return;
          const row = {
            url: request.url(),
            path,
            encoder: encoder.has(path),
            start: performance.now(),
          };
          network.push(row);
          requests.set(request, row);
        });
        context.on('requestfailed', (request) => {
          const row = requests.get(request);
          if (row)
            Object.assign(row, {
              failed: request.failure()?.errorText,
              failedAt: performance.now(),
            });
        });
        context.on('requestfinished', (request) => {
          const row = requests.get(request);
          if (row) row.finishedAt = performance.now();
        });
        page.on('pageerror', (error) => errors.push(error.message));
        let completed = false;
        const observed: Record<string, unknown> = {};
        const times: Record<string, number> = {};
        const operate = (step: string, control: Locator, region: Locator) =>
          operatedClick(page, control, { step, log: steps, touch, region: { within: region } });
        const encoderTransfers = () => proxy.transfers.filter((row) => row.encoder);
        const bytes = () => encoderTransfers().reduce((total, row) => total + row.bytes, 0);
        const chosenFiles = () =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLInputElement>('input[type=file]')].reduce(
              (total, input) => total + (input.files?.length ?? 0),
              0,
            ),
          );
        try {
          await context.tracing.start({ screenshots: true, snapshots: false });
          await page.goto(ORIGIN);
          const provider = page.locator('.next-provider-row');
          const prepare = provider.getByRole('button', { name: 'Prepare encoder', exact: true });
          await prepare.waitFor();
          const later = page.getByRole('button', { name: 'Ask me later', exact: true });
          if (await later.isVisible())
            await operate(
              'dismiss-arrival-report-choice',
              later,
              page.locator('.next-consent-toast'),
            );
          await page.getByLabel('Processing mode').selectOption('cpu'); // setup, no authorization
          assert.equal(await page.getByLabel('Processing mode').inputValue(), 'cpu');
          await page.waitForTimeout(2000);
          assert.equal(network.length, 0, 'cold arrival and CPU selection request no model assets');
          assert.equal(await chosenFiles(), 0);
          const field = page.locator('section.next-face').first().locator('.next-field input');
          await field.fill('Retained text while cancelling page setup'); // independent local work
          const retainedText = await field.inputValue();
          await operate('top-prepare-encoder', prepare, provider);
          const dialog = page.locator('.next-download-dialog');
          await dialog.waitFor();
          observed['initialDecision'] = await dialog.innerText();
          assert.equal(network.length, 0, 'Prepare alone authorizes no model request');
          await page.screenshot({ path: join(results, `${width}-asked.png`), fullPage: true });
          times['initialApproval'] = performance.now();
          await operate(
            'approve-page-encoder-setup',
            dialog.getByRole('button', { name: 'Download and continue', exact: true }),
            dialog,
          );
          await dialog.waitFor({ state: 'detached' });
          const transferDeadline = times['initialApproval'] + TRANSFER_BOUND_MS;
          let revised = 0;
          while (!encoderTransfers().some((row) => row.bytes > 0 && !row.closed)) {
            assert.ok(
              performance.now() < transferDeadline,
              'real encoder transfer starts within the declared bound',
            );
            if (await dialog.isVisible()) {
              assert.equal(++revised, 1, 'at most one explicit revised descriptor decision');
              observed['revisedDecision'] = await dialog.innerText();
              times['revisedApproval'] = performance.now();
              await operate(
                'approve-revised-encoder-schedule',
                dialog.getByRole('button', { name: 'Download and continue', exact: true }),
                dialog,
              );
              await dialog.waitFor({ state: 'detached' });
            }
            await page.waitForTimeout(100);
          }
          observed['revisedApprovals'] = revised;
          times['encoderBytesBeforeFileChoice'] = performance.now();
          observed['encoderBytesBeforeFileChoice'] = bytes();
          assert.equal(
            await chosenFiles(),
            0,
            'real encoder bytes arrive before choosing any photo',
          );
          const cancel = provider.getByRole('button', { name: 'Cancel setup', exact: true });
          await cancel.waitFor();
          await page.screenshot({
            path: join(results, `${width}-transferring.png`),
            fullPage: true,
          });
          const active = encoderTransfers().filter((row) => !row.closed);
          assert.ok(
            active.length > 0 && bytes() > 0,
            'cancellation begins during an actual partial encoder transfer',
          );
          assert.ok(
            active.some(
              (row) => row.status === 200 && row.bytes > 0 && row.bytes < row.expectedBytes,
            ),
            'a real successful encoder response has sent only a prefix of its declared body',
          );
          times['cancelStarted'] = performance.now();
          await operate('cancel-page-encoder-setup', cancel, provider);
          const abortDeadline = times['cancelStarted'] + CANCEL_BOUND_MS;
          while (active.some((row) => !row.closed) && performance.now() < abortDeadline)
            await page.waitForTimeout(50);
          assert.ok(
            active.every((row) => row.closedEarly && row.closed <= abortDeadline),
            'every in-flight encoder response aborts within 5 seconds of Cancel setup',
          );
          times['allEncoderResponsesAborted'] = Math.max(...active.map((row) => row.closed));
          await page.waitForTimeout(Math.max(0, abortDeadline - performance.now()));
          const settledBytes = bytes();
          const settledRequests = network.filter((row) => row.encoder).length;
          times['quietWindowStarted'] = performance.now();
          await page.waitForTimeout(QUIET_WINDOW_MS);
          times['quietWindowEnded'] = performance.now();
          assert.equal(
            network.filter((row) => row.encoder).length,
            settledRequests,
            'no new encoder request after the declared cancellation bound',
          );
          assert.equal(
            bytes(),
            settledBytes,
            'no encoder body bytes after the declared cancellation bound',
          );
          assert.ok(
            !network.some((row) => row.encoder && row.start >= abortDeadline),
            'negative request evidence covers the entire post-bound window',
          );
          // Response-body cancellation need not emit Playwright requestfailed. The live HTTPS
          // response's early close above directly proves that its incomplete body was aborted.
          assert.equal(
            await field.inputValue(),
            retainedText,
            'independent local text survives setup cancellation',
          );
          assert.equal(await chosenFiles(), 0);
          assert.equal(await cancel.count(), 0);
          await prepare.waitFor();
          assert.equal(
            await dialog.count(),
            0,
            'cancelled setup never silently revives its decision',
          );
          assert.deepEqual(errors, []);
          await page.screenshot({ path: join(results, `${width}-cancelled.png`), fullPage: true });
          completed = true;
        } catch (error) {
          observed['failure'] =
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error);
          throw error;
        } finally {
          if (!completed)
            await page
              .screenshot({ path: join(results, `${width}-FAILED.png`), fullPage: true })
              .catch(() => {});
          writeFileSync(
            join(results, `${width}-${completed ? 'pass' : 'failure'}.json`),
            JSON.stringify(
              {
                artifact: artifact.identity.deploySource,
                digest,
                width,
                touch,
                route: 'cpu',
                freshPersistentProfile: true,
                bounds: { CANCEL_BOUND_MS, QUIET_WINDOW_MS, TRANSFER_BOUND_MS },
                completed,
                times,
                observed,
                errors,
                network,
                transfers: proxy.transfers,
                steps: steps.entries,
              },
              null,
              2,
            ) + '\n',
          );
          await context.tracing
            .stop({ path: join(results, `${width}-${completed ? 'pass' : 'failure'}-trace.zip`) })
            .catch(() => {});
          await profile.close();
          await proxy.close();
        }
      }
    } finally {
      await site.stop();
    }
  },
);
