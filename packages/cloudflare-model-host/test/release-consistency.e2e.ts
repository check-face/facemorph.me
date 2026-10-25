// fm-fy2.14: real deployed model bytes through a controlled fault proxy, not a deployed app rollout.
// The proxy forwards the staging manifest/assets unchanged except for explicitly named faults.
// A pinned consumer survives an incompatible mutable pointer, a removed old path gives bounded
// reload recovery, and an interrupted real body resumes only the unverified bytes. Parser checks
// do not establish app-level atomic catalogue replacement; a previous-app rollback needs its own
// deployed app fixture and manifest. Those remaining acceptance cells are explicitly untested.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import type { Browser, Page } from 'playwright';
import { assets, type AssetNode } from '../src/manifest.ts';

const REPO = new URL('../../..', import.meta.url).pathname;
const MANAGER = process.env['STAGING_MANAGER_DIR'] ?? join(REPO, 'packages/browser-model-manager');
const ORIGIN = process.env['STAGING_ORIGIN']?.replace(/\/$/, '');
const MIRROR = process.env['STAGING_MIRROR']?.replace(/\/$/, '');
const skip = !ORIGIN || !MIRROR ? 'untested: STAGING_ORIGIN and STAGING_MIRROR are not set' : false;
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))(
  'playwright',
) as typeof import('playwright');
const helper = await import('../../../scripts/ci/intercept/playwright.ts');
const record = await import('../../../scripts/ci/intercept/record.ts');
const work = mkdtempSync(join(tmpdir(), 'staging-release-'));
const evidence = join(
  process.env['STAGING_OUT'] ?? join(REPO, 'test-results/model-staging'),
  'release-consistency',
);
const timeoutMs = 240_000;
let browser: Browser | undefined;
let app: Server | undefined;
let proxy: Server | undefined;
let appUrl = '';
let primary = '';
let manifest: Record<string, unknown>;
let chunked: AssetNode;
let plain: AssetNode;
const fault = { incompatiblePointer: false, missing: '', cut: '' };
const sent: { path: string; bytes: number; status: number; finished: boolean; aborted: boolean }[] =
  [];
const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
const pathOf = (url: string) => new URL(url).pathname;

test.before(async () => {
  if (skip) return;
  browser = await chromium.launch(
    process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {},
  );
  console.info(
    `# staging release browser Chromium ${browser.version()}; origin ${ORIGIN}; mirror ${MIRROR}`,
  );
  const response = await fetch(`${ORIGIN}/runtime/manifest.json`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  manifest = (await response.json()) as Record<string, unknown>;
  const descriptors = assets(manifest).map((a) => a.asset);
  chunked = descriptors
    .filter((a) => a.chunks && a.chunks.length >= 2)
    .sort((a, b) => a.size - b.size)[0]!;
  plain = descriptors.filter((a) => !a.chunks).sort((a, b) => a.size - b.size)[0]!;
  assert.ok(chunked && plain, 'deployed manifest supplies real chunked and plain fixtures');
  for (const descriptor of descriptors)
    for (const unit of descriptor.chunks ?? [descriptor])
      assert.equal(
        new URL(unit.url!).origin,
        ORIGIN,
        'fixture URLs use the configured real origin',
      );
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
  app = createServer(tls, (req, res) => {
    const path = pathOf(`https://x${req.url}`);
    if (path === '/')
      return void res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Model release component consumer</title>');
    if (path.startsWith('/pkg/')) {
      try {
        return void res
          .writeHead(200, {
            'content-type':
              extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream',
          })
          .end(readFileSync(join(built, path.slice(5))));
      } catch {
        /* 404 below */
      }
    }
    res.writeHead(404).end();
  });
  proxy = createServer(tls, async (req, res) => {
    const path = pathOf(`https://x${req.url}`);
    const entry = { path, bytes: 0, status: 0, finished: false, aborted: false };
    sent.push(entry);
    res.once('finish', () => {
      entry.finished = true;
    });
    res.once('close', () => {
      entry.aborted = !res.writableFinished;
    });
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (path === fault.missing) {
      entry.status = 404;
      return void res.writeHead(404, headers).end();
    }
    try {
      const upstream = await fetch(`${ORIGIN}${path}`, { signal: AbortSignal.timeout(60_000) });
      let body = Buffer.from(await upstream.arrayBuffer());
      if (path === '/runtime/manifest.json' && fault.incompatiblePointer)
        body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString()), schemaVersion: 999 }));
      entry.status = upstream.status;
      res.writeHead(upstream.status, {
        ...headers,
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      if (path === fault.cut) {
        fault.cut = '';
        entry.bytes = body.byteLength >> 1;
        res.write(body.subarray(0, entry.bytes));
        setTimeout(() => res.destroy(), 25);
      } else {
        entry.bytes = body.byteLength;
        res.end(body);
      }
    } catch (error) {
      entry.status = 502;
      if (!res.headersSent) res.writeHead(502, headers);
      res.end(String(error));
    }
  });
  appUrl = `https://127.0.0.1:${await listen(app)}`;
  primary = `https://127.0.0.1:${await listen(proxy)}`;
});
test.after(async () => {
  await browser?.close();
  await Promise.all(
    [app, proxy]
      .filter((server): server is Server => !!server)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  rmSync(work, { recursive: true, force: true });
});

const viaPrimary = (descriptor: AssetNode) => ({
  sha256: descriptor.sha256,
  size: descriptor.size,
  url: `${primary}${pathOf(descriptor.url!)}`,
  ...(descriptor.chunks
    ? {
        chunks: descriptor.chunks.map((unit) => ({
          ...unit,
          url: `${primary}${pathOf(unit.url!)}`,
        })),
      }
    : {}),
});
async function session(
  name: string,
  run: (page: Page, att: ReturnType<typeof helper.attachPlaywright>) => Promise<void>,
) {
  const fromSent = sent.length;
  const context = await browser!.newContext({ ignoreHTTPSErrors: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const att = helper.attachPlaywright(
    context as unknown as Parameters<typeof helper.attachPlaywright>[0],
    {
      version: 1,
      rules: [
        { host: new URL(appUrl).host, class: 'app' },
        { host: new URL(primary).host, class: 'model-host' },
        { host: new URL(MIRROR!).host, class: 'model-host' },
      ],
    },
  );
  const page = await context.newPage();
  try {
    await page.goto(appUrl);
    await page.evaluate(() => import(String('/pkg/index.js')));
    await run(page, att);
    await att.settled();
    assert.equal(
      att.rec.requests.filter((r) => r.hostClass === 'third-party').length,
      0,
      'no unconfigured origin',
    );
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, `${name}.json`),
      JSON.stringify(
        {
          origin: ORIGIN,
          mirror: MIRROR,
          browser: browser!.version(),
          requests: att.rec,
          forwarded: sent.slice(fromSent),
        },
        null,
        2,
      ),
    );
    await context.tracing.stop();
  } catch (error) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, `${name}.json`),
      JSON.stringify({ requests: att.rec, forwarded: sent.slice(fromSent) }, null, 2),
    );
    await page.screenshot({ path: join(evidence, `${name}.png`) }).catch(() => {});
    await context.tracing.stop({ path: join(evidence, `${name}.zip`) }).catch(() => {});
    throw error;
  } finally {
    fault.incompatiblePointer = false;
    fault.missing = '';
    fault.cut = '';
    await context.close();
  }
}
const acquire = (
  page: Page,
  descriptor: ReturnType<typeof viaPrimary>,
  retryDelaysMs: number[] = [],
  pinned = false,
) =>
  page.evaluate(
    async ({ descriptor, retryDelaysMs, pinned }) => {
      const m = await import(String('/pkg/index.js'));
      if (pinned)
        descriptor = (window as unknown as { pinnedReleaseAsset: typeof descriptor })
          .pinnedReleaseAsset;
      const cache = await m.createBrowserModelCache({ retryDelaysMs, readAhead: 1 });
      try {
        const grant = {
          manifestSha256: 'deployed-release-component',
          route: 'cpu',
          purpose: 'generate',
          assets: [
            { sha256: descriptor.sha256, bytes: descriptor.size, priority: 'foreground-required' },
          ],
          remainingBytes: descriptor.size * 8,
          owners: ['face:release'],
        };
        const handle = await cache.acquire(descriptor, { grant, owner: 'face:release' });
        const bytes = await handle.bytes();
        return {
          ok: true,
          size: bytes.byteLength,
          sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
            x.toString(16).padStart(2, '0'),
          ).join(''),
        };
      } catch (error) {
        const e = error as Error & { reload?: boolean; status?: number };
        return { ok: false, message: e.message, reload: e.reload, status: e.status };
      }
    },
    { descriptor, retryDelaysMs, pinned },
  );
const modelRequests = (att: ReturnType<typeof helper.attachPlaywright>, step: string) =>
  att.rec.requests.filter(
    (r) => att.rec.steps[r.step]?.name === step && r.hostClass === 'model-host',
  );

test(
  'deployed staging: a pinned consumer keeps its old digests; a missing old path gives bounded reload and recovery',
  { skip, timeout: timeoutMs },
  async () => {
    await session('pinned-recovery', async (page, att) => {
      const loaded = await page.evaluate(
        async ({ url, sha256, primary }) => {
          const m = await import(String('/pkg/index.js'));
          const parsed = m.parseModelManifest(await (await fetch(url)).json());
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
          const find = (value: unknown): Record<string, unknown> | undefined => {
            if (!value || typeof value !== 'object') return;
            const row = value as Record<string, unknown>;
            if (row.sha256 === sha256 && row.size !== undefined) return row;
            for (const child of Object.values(row)) {
              const found = find(child);
              if (found) return found;
            }
          };
          const asset = find(parsed.value);
          if (!asset) throw new Error('pinned asset absent from the served manifest');
          const input = {
            ...asset,
            url: `${primary}${new URL(asset.url as string).pathname}`,
            chunks: (asset.chunks as { url: string }[]).map((c) => ({
              ...c,
              url: `${primary}${new URL(c.url).pathname}`,
            })),
          };
          (window as unknown as { pinnedReleaseAsset: unknown }).pinnedReleaseAsset = input;
          return parsed.value.bundleVersion;
        },
        { url: `${primary}/runtime/manifest.json`, sha256: chunked.sha256, primary },
      );
      assert.equal(loaded, manifest['bundleVersion']);
      // A controlled bad mutable pointer never replaces the consumer's already pinned descriptor.
      fault.incompatiblePointer = true;
      record.step(att.rec, 'changed-pointer');
      const incompatible = await page.evaluate(async (url) => {
        const m = await import(String('/pkg/index.js'));
        const result = m.parseModelManifest(await (await fetch(url)).json());
        return result.ok ? null : result.error.code;
      }, `${primary}/runtime/manifest.json`);
      assert.equal(incompatible, 'newer-major', 'the controlled mutable pointer actually changed');
      record.step(att.rec, 'old-tab');
      const from = sent.length;
      assert.deepEqual(await acquire(page, viaPrimary(chunked), [], true), {
        ok: true,
        size: chunked.size,
        sha256: chunked.sha256,
      });
      await att.settled();
      assert.deepEqual(
        modelRequests(att, 'old-tab')
          .map((r) => pathOf(r.url))
          .sort(),
        chunked.chunks!.map((c) => pathOf(c.url!)).sort(),
      );
      assert.ok(sent.slice(from).every((r) => r.finished && !r.aborted && r.status === 200));
      assert.equal(
        sent.slice(from).reduce((n, r) => n + r.bytes, 0),
        chunked.size,
      );
      fault.missing = pathOf(plain.url!);
      const fromGone = sent.length;
      record.step(att.rec, 'gone');
      const gone = await acquire(page, viaPrimary(plain), [0, 0, 0]);
      assert.equal(gone.ok, false);
      assert.equal(gone.reload, true);
      assert.equal(gone.status, 404);
      assert.match(gone.message ?? '', /Reload the page/);
      await att.settled();
      assert.deepEqual(
        modelRequests(att, 'gone').map((r) => pathOf(r.url)),
        [pathOf(record.template(plain.url!))],
      );
      assert.deepEqual(
        sent.slice(fromGone).map((r) => ({ path: r.path, bytes: r.bytes, status: r.status })),
        [{ path: pathOf(plain.url!), bytes: 0, status: 404 }],
      );
      fault.missing = '';
      const fromRecovery = sent.length;
      record.step(att.rec, 'recovery');
      assert.deepEqual(await acquire(page, viaPrimary(plain)), {
        ok: true,
        size: plain.size,
        sha256: plain.sha256,
      });
      await att.settled();
      assert.deepEqual(
        modelRequests(att, 'recovery').map((r) => pathOf(r.url)),
        [pathOf(record.template(plain.url!))],
      );
      assert.deepEqual(
        sent.slice(fromRecovery).map((r) => ({ path: r.path, bytes: r.bytes, status: r.status })),
        [{ path: pathOf(plain.url!), bytes: plain.size, status: 200 }],
      );
    });
  },
);

test(
  'deployed staging: an interrupted acquisition resumes exactly the remaining verified-chunk bytes',
  { skip, timeout: timeoutMs },
  async (t) => {
    await session('resume', async (page, att) => {
      const descriptor = viaPrimary(chunked);
      fault.cut = pathOf(chunked.chunks![1]!.url!);
      const cutPath = fault.cut;
      const fromCut = sent.length;
      record.step(att.rec, 'cut');
      const first = await acquire(page, descriptor);
      assert.equal(first.ok, false, 'real half-body connection reset rejects without retry');
      await att.settled();
      assert.deepEqual(
        sent.slice(fromCut).filter((r) => r.path === cutPath),
        [
          {
            path: cutPath,
            bytes: chunked.chunks![1]!.size >> 1,
            status: 200,
            finished: false,
            aborted: true,
          },
        ],
      );
      record.step(att.rec, 'inspect-kept');
      const kept = await page.evaluate(async (units) => {
        const m = await import(String('/pkg/index.js'));
        const store = await m.openShardStore({ readOnly: true });
        const hashes: string[] = [];
        for (const unit of units)
          if (await store.has(unit.sha256, unit.size)) hashes.push(unit.sha256);
        return hashes;
      }, descriptor.chunks!);
      assert.ok(kept.length > 0 && kept.length < descriptor.chunks!.length);
      assert.ok(!kept.includes(descriptor.chunks![1]!.sha256), 'partial chunk is never committed');
      await att.settled();
      assert.equal(
        att.rec.requests.filter((r) => att.rec.steps[r.step]?.name === 'inspect-kept').length,
        0,
        'inspection never repairs over the network',
      );
      const remaining = descriptor.chunks!.filter((unit) => !kept.includes(unit.sha256));
      const from = sent.length;
      record.step(att.rec, 'resume');
      assert.deepEqual(await acquire(page, descriptor), {
        ok: true,
        size: descriptor.size,
        sha256: descriptor.sha256,
      });
      await att.settled();
      assert.deepEqual(
        modelRequests(att, 'resume')
          .map((r) => pathOf(r.url))
          .sort(),
        remaining.map((unit) => pathOf(unit.url!)).sort(),
      );
      const resumed = sent.slice(from);
      assert.deepEqual(
        resumed.map((r) => r.path).sort(),
        remaining.map((unit) => pathOf(unit.url!)).sort(),
      );
      assert.ok(resumed.every((r) => r.finished && !r.aborted && r.status === 200));
      assert.equal(
        resumed.reduce((n, r) => n + r.bytes, 0),
        remaining.reduce((n, unit) => n + unit.size, 0),
      );
      t.diagnostic(
        `kept ${kept.length}/${descriptor.chunks!.length}; resumed ${remaining.reduce((n, unit) => n + unit.size, 0)} bytes`,
      );
    });
  },
);

test(
  'deployed staging manifest: incompatible major and mixed chunk sizes receive typed parser refusal without I/O',
  { skip, timeout: timeoutMs },
  async () => {
    await session('manifest-refusal', async (page, att) => {
      record.step(att.rec, 'refuse');
      const errors = await page.evaluate(async (original) => {
        const m = await import(String('/pkg/index.js'));
        const mixed = structuredClone(original) as unknown as {
          synthesis: { chunks: { size: number }[] };
        };
        mixed.synthesis.chunks[0]!.size += 1;
        return [{ ...original, schemaVersion: 999 }, mixed].map((value) => {
          const result = m.parseModelManifest(value);
          return result.ok ? null : result.error;
        });
      }, manifest);
      assert.equal(errors[0]?.code, 'newer-major');
      assert.equal(errors[0]?.path, '$.schemaVersion');
      assert.equal(errors[1]?.code, 'invalid-asset');
      assert.equal(errors[1]?.path, '$.synthesis.chunks');
      await att.settled();
      assert.equal(
        att.rec.requests.filter((r) => att.rec.steps[r.step]?.name === 'refuse').length,
        0,
      );
    });
  },
);

test(
  'deployed staging manifest: every declared immutable asset/chunk path is HEAD-200 on the real test mirror',
  { skip, timeout: timeoutMs },
  async (t) => {
    const paths = [
      ...new Set(
        assets(manifest).flatMap(({ asset }) =>
          (asset.chunks ?? [asset]).map((unit) => pathOf(unit.url!)),
        ),
      ),
    ].sort();
    const results: { path: string; status: number }[] = [];
    const queue = [...paths];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let path = queue.shift(); path; path = queue.shift()) {
          const response = await fetch(`${MIRROR}${path}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(30_000),
          });
          results.push({ path, status: response.status });
        }
      }),
    );
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, 'mirror-head.json'),
      JSON.stringify(
        {
          origin: ORIGIN,
          mirror: MIRROR,
          results: results.sort((a, b) => a.path.localeCompare(b.path)),
        },
        null,
        2,
      ),
    );
    assert.deepEqual(
      results.filter((r) => r.status !== 200),
      [],
    );
    assert.equal(results.length, paths.length);
    t.diagnostic(
      `${paths.length} manifest asset/chunk paths held; this manifest has not been identified as a previous app release`,
    );
  },
);

test(
  'atomic replacement of an incompatible catalogue in the deployed app',
  {
    skip: 'untested: manager parser has no active app catalogue transaction; needs the actual app admission journey',
  },
  () => {},
);
test(
  'rollback runs the previous deployed app using its own manifest and retained paths',
  {
    skip: 'untested: no previous deployed app artifact and bound manifest fixture configured; staging hosts model bytes only',
  },
  () => {},
);
