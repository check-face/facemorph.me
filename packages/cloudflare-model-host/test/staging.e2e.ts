// Staging qualification, in the browser (fm-fy2.14): the manager, in real Chromium, loads a chunked model asset
// from the deployed test origin and verifies its bytes; then, with the primary forced to answer 500, the same asset
// comes from the deployed test mirror instead. The primary is reached through a local proxy with a fault switch in
// front of the real origin (a proxy, not a stand-in: it forwards every byte); the mirror is the real Worker.
// Requests are recorded by host class through the interception helper. Needs the deployed origins and a network:
//   STAGING_ORIGIN=https://<origin> STAGING_MIRROR=https://<mirror> npm run test:staging -w packages/cloudflare-model-host
// Without them, or where Chromium cannot start, the cases report untested.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import { assets } from '../src/manifest.ts';

const REPO = new URL('../../..', import.meta.url).pathname;
// The manager as built from its package (STAGING_MANAGER_DIR: another checkout of it, e.g. a committed revision).
const MANAGER = process.env['STAGING_MANAGER_DIR'] ?? join(REPO, 'packages/browser-model-manager');
const ORIGIN = process.env['STAGING_ORIGIN']?.replace(/\/$/, '');
const MIRROR = process.env['STAGING_MIRROR']?.replace(/\/$/, '');

interface Recorded {
  steps: { name: string }[];
  requests: { step: number; url: string; hostClass: string; status?: number | null }[];
}
const helper = (await import(join(REPO, 'scripts/ci/intercept/playwright.ts'))) as {
  attachPlaywright(target: unknown, map: unknown): { rec: Recorded; settled(): Promise<void> };
};
const record = (await import(join(REPO, 'scripts/ci/intercept/record.ts'))) as {
  step(rec: Recorded, name: string): void;
};
type Page = {
  goto(u: string): Promise<unknown>;
  evaluate<T, A>(fn: (a: A) => Promise<T>, arg: A): Promise<T>;
};
type Browser = {
  newContext(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
};
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as {
  chromium: { launch(o: object): Promise<Browser> };
};

const untested =
  !ORIGIN || !MIRROR ? 'untested: STAGING_ORIGIN and STAGING_MIRROR are not set' : false;
const browser = untested ? null : await chromium.launch({}).catch(() => null);
const skip = untested || (browser ? false : 'untested: Chromium does not start here');

const work = mkdtempSync(join(tmpdir(), 'staging-e2e-'));
let app: Server | undefined;
let proxy: Server | undefined;
const fault = { primary500: false };
test.after(async () => {
  await browser?.close();
  app?.close();
  proxy?.close();
});

test(
  'the manager loads a chunked asset from the test origin, and from the test mirror when the primary answers 500',
  { skip },
  async () => {
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
        '/CN=127.0.0.1',
        '-keyout',
        join(work, 'key.pem'),
        '-out',
        join(work, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    const tls = {
      key: readFileSync(join(work, 'key.pem')),
      cert: readFileSync(join(work, 'cert.pem')),
    };
    const built = join(work, 'dist');
    execFileSync(process.execPath, [
      join(REPO, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(MANAGER, 'tsconfig.build.json'),
      '--outDir',
      built,
    ]);
    const listen = (s: Server) =>
      new Promise<number>((r) =>
        s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)),
      );
    app = createServer(tls, (req, res) => {
      const p = new URL(req.url ?? '/', 'https://x').pathname;
      if (p === '/')
        return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>s</title>');
      try {
        const body = readFileSync(join(built, p.slice(5)));
        res
          .writeHead(200, {
            'content-type': extname(p) === '.js' ? 'text/javascript' : 'application/octet-stream',
          })
          .end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    // The primary: every request forwarded to the real origin, or 500 while the switch is on.
    proxy = createServer(tls, async (req, res) => {
      if (fault.primary500) return res.writeHead(500, { 'access-control-allow-origin': '*' }).end();
      const upstream = await fetch(`${ORIGIN}${req.url}`);
      const body = Buffer.from(await upstream.arrayBuffer());
      res
        .writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          'content-length': String(body.byteLength),
          'access-control-allow-origin': '*',
        })
        .end(body);
    });
    const appPort = await listen(app);
    const proxyPort = await listen(proxy);
    const PRIMARY = `https://127.0.0.1:${proxyPort}`;
    const hostMap = {
      version: 1,
      rules: [
        { host: `127.0.0.1:${appPort}`, class: 'app' },
        { host: `127.0.0.1:${proxyPort}`, class: 'model-host' },
        { host: new URL(MIRROR!).host, class: 'model-host' },
      ],
    };
    // The smallest chunked asset the origin's manifest names, addressed through the primary.
    const manifest = await (await fetch(`${ORIGIN}/runtime/manifest.json`)).json();
    const chunked = assets(manifest)
      .map((a) => a.asset)
      .filter((a) => a.chunks)
      .sort((a, b) => a.size - b.size)[0]!;
    const viaPrimary = (url: string) => url.replace(ORIGIN!, PRIMARY);
    const input = {
      sha256: chunked.sha256,
      size: chunked.size,
      url: viaPrimary(chunked['url'] as string),
      chunks: chunked.chunks!.map((c) => ({
        sha256: c.sha256,
        size: c.size,
        url: viaPrimary(c.url!),
      })),
    };

    const context = await browser!.newContext({ ignoreHTTPSErrors: true });
    const att = helper.attachPlaywright(context, hostMap);
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${appPort}/`);
    const acquire = (fresh: boolean) =>
      page.evaluate(
        async ({ input, mirror, fresh }) => {
          const m = await import(String('/pkg/index.js'));
          if (fresh) for (const name of await caches.keys()) await caches.delete(name);
          if (fresh)
            await (
              await navigator.storage.getDirectory()
            )
              .removeEntry('checkface-model-shards-v1', { recursive: true })
              .catch(() => {});
          const cache = await m.createBrowserModelCache({
            retryDelaysMs: [0, 0, 0],
            alternateOrigins: [mirror],
          });
          const grant = {
            manifestSha256: 'staging-qualification',
            route: 'cpu',
            purpose: 'generate',
            assets: [{ sha256: input.sha256, bytes: input.size, priority: 'foreground-required' }],
            remainingBytes: input.size * 8,
            owners: ['face:staging'],
          };
          const handle = await cache.acquire(input, { grant, owner: 'face:staging' });
          const b = await handle.bytes();
          return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) =>
            x.toString(16).padStart(2, '0'),
          ).join('');
        },
        { input, mirror: MIRROR!, fresh },
      );
    try {
      record.step(att.rec, 'primary');
      assert.equal(await acquire(true), chunked.sha256, 'loaded and verified from the test origin');
      fault.primary500 = true;
      record.step(att.rec, 'primary-500');
      assert.equal(await acquire(true), chunked.sha256, 'loaded and verified from the test mirror');
      await att.settled();
      // Both origins are model hosts; the URL's host tells the primary from the mirror.
      const inStep = (name: string, host: string) =>
        att.rec.requests.filter(
          (r) =>
            att.rec.steps[r.step]?.name === name &&
            r.hostClass === 'model-host' &&
            new URL(r.url).host === host,
        );
      const primaryHost = new URL(PRIMARY).host;
      const mirrorHost = new URL(MIRROR!).host;
      assert.equal(
        att.rec.requests.filter((r) => r.hostClass === 'third-party').length,
        0,
        'no third-party request',
      );
      assert.equal(
        inStep('primary', mirrorHost).length,
        0,
        'the mirror is not asked while the primary works',
      );
      assert.equal(inStep('primary', primaryHost).length, chunked.chunks!.length);
      assert.ok(inStep('primary-500', primaryHost).every((r) => r.status === 500));
      assert.equal(
        new Set(
          inStep('primary-500', mirrorHost)
            .filter((r) => r.status === 200)
            .map((r) => r.url),
        ).size,
        chunked.chunks!.length,
        'every chunk came from the mirror',
      );
    } finally {
      fault.primary500 = false;
      await context.close();
    }
  },
);
