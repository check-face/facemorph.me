// Isolated fm-fy2.13 loaded-handle component: real pinned CPU model + browser ORT/WASM,
// native OPFS and Web Locks. Keep this out of the fast acquisition timing suite.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const REPO = new URL('../../..', import.meta.url).pathname;
const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ??
  [
    join(homedir(), '.cache/facemorph-device-lab/runtime-public'),
    join(homedir(), '.cache/facemorph-runtime'),
  ].find((root) => existsSync(join(root, 'manifest.json'))) ??
  '';
const MANIFEST_SHA = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
interface Evidence {
  threads: number;
  warm: {
    milliseconds: number;
    rgbaBytes: number;
    digest: string;
    canary: { passed: boolean; maxRgb: number; maxFloat: number };
  };
  rows: {
    cause: string;
    settledMs: number;
    after: { generator: { liveSessions: number }; leases: string[] };
    nativeLocksReleased: boolean;
  }[];
}

test(
  'loaded CPU browser handles: release and actual leased-file loss/corruption settle pending operations and release native resources',
  { timeout: 300_000 },
  async (t) => {
    const manifestPath = join(RUNTIME, 'manifest.json');
    if (!RUNTIME || !existsSync(manifestPath)) {
      const reason =
        'untested: acquire the pinned CPU runtime with FACEMORPH_RUNTIME_CACHE or the device lab';
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw new Error(reason);
      return t.skip(reason);
    }
    const bytes = readFileSync(manifestPath);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), MANIFEST_SHA);
    const { engine, browser, newContext, unavailable } = await componentBrowser();
    if (!browser) return t.skip(String(unavailable));
    const work = mkdtempSync(join(tmpdir(), 'manager-loaded-browser-'));
    const evidencePath = join(REPO, 'test-results/manager-cache', engine, 'loaded-browser.json');
    let context: Awaited<ReturnType<typeof newContext>> | undefined;
    let server: Server | undefined;
    t.after(async () => {
      await context?.close();
      await browser.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((done) => server!.close(() => done()));
      }
      rmSync(work, { recursive: true, force: true });
    });
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
    const roots = {
      '/stylegan/': join(work, 'stylegan'),
      '/manager/': join(work, 'manager'),
      '/runtime/': RUNTIME,
    };
    for (const [pkg, output] of [
      ['stylegan-js', roots['/stylegan/']],
      ['browser-model-manager', roots['/manager/']],
    ]) {
      execFileSync(process.execPath, [
        join(REPO, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(REPO, 'packages', pkg!, 'tsconfig.build.json'),
        '--outDir',
        output!,
      ]);
    }
    let allowRuntime = true;
    const served: { path: string; bytes: number; finished: boolean; allowed: boolean }[] = [];
    server = createServer(
      { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
      (req, res) => {
        const path = new URL(req.url ?? '/', 'https://local').pathname;
        const headers = {
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cross-origin-resource-policy': 'same-origin',
          'cache-control': 'no-store',
        };
        if (path === '/')
          return void res
            .writeHead(200, { ...headers, 'content-type': 'text/html' })
            .end('<!doctype html><title>Loaded browser component</title>');
        if (path === '/case.js')
          return void res
            .writeHead(200, { ...headers, 'content-type': 'text/javascript' })
            .end(readFileSync(new URL('./support/loaded-runtime-browser.mjs', import.meta.url)));
        const prefix = Object.keys(roots).find((candidate) => path.startsWith(candidate)) as
          | keyof typeof roots
          | undefined;
        if (!prefix) return void res.writeHead(404, headers).end();
        const file = resolve(roots[prefix], path.slice(prefix.length));
        if (!file.startsWith(`${resolve(roots[prefix])}/`) || !existsSync(file))
          return void res.writeHead(404, headers).end();
        let entry: (typeof served)[number] | undefined;
        if (prefix === '/runtime/') {
          entry = { path, bytes: 0, finished: false, allowed: allowRuntime };
          served.push(entry);
          if (!allowRuntime) return void res.writeHead(410, headers).end();
          res.once('finish', () => {
            entry!.finished = true;
          });
        }
        const stream = createReadStream(file);
        if (entry)
          stream.on('data', (piece) => {
            entry!.bytes += piece.length;
          });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        res.writeHead(200, {
          ...headers,
          'content-type':
            extname(file) === '.js' || extname(file) === '.mjs'
              ? 'text/javascript'
              : extname(file) === '.wasm'
                ? 'application/wasm'
                : 'application/octet-stream',
        });
        stream.pipe(res);
      },
    );
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const manifest = JSON.parse(
      bytes.toString().replaceAll('https://next.facemorph.me/runtime/', `${origin}/runtime/`),
    );
    context = await newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    let phase = 'setup';
    const requests: { url: string; phase: string }[] = [];
    context.on('request', (request) => {
      requests.push({ url: request.url(), phase });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') t.diagnostic(`browser: ${message.text()}`);
    });
    // With snapshots disabled Playwright omits DOM/network payload snapshots, including model bodies.
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    try {
      await page.goto(origin);
      const setup = await page.evaluate(
        async ({ manifest, digest }) => {
          const load = (path: string) => import(path);
          const driver = await load('/case.js');
          (globalThis as unknown as { loadedDriver: typeof driver }).loadedDriver = driver;
          return driver.acquire(manifest, digest) as Promise<{
            assets: number;
            bytes: number;
            remainingBytes: number;
          }>;
        },
        { manifest, digest: MANIFEST_SHA },
      );
      assert.equal(setup.remainingBytes, 0);
      assert.ok(served.length > 0 && served.every((entry) => entry.finished && entry.allowed));
      t.diagnostic(
        `${engine}: acquired ${setup.assets} pinned assets / ${setup.bytes} bytes; starting loaded-handle CPU component`,
      );
      phase = 'loaded';
      allowRuntime = false;
      const result = await page.evaluate(async () => {
        const driver = (globalThis as unknown as { loadedDriver: { run(): Promise<Evidence> } })
          .loadedDriver;
        return driver.run();
      });
      assert.deepEqual(
        result.rows.map((row) => row.cause),
        ['release', 'browser-eviction', 'corruption'],
      );
      assert.equal(result.warm.rgbaBytes, 1024 * 1024 * 4);
      assert.ok(
        result.warm.canary.passed &&
          result.warm.canary.maxRgb <= 1 &&
          result.warm.canary.maxFloat <= 0.002,
      );
      for (const row of result.rows) {
        assert.equal(row.after.generator.liveSessions, 0);
        assert.deepEqual(row.after.leases, []);
        assert.equal(row.nativeLocksReleased, true);
      }
      const loadedRequests = requests.filter(
        (request) => request.phase === 'loaded' && /^https?:/.test(request.url),
      );
      assert.deepEqual(
        loadedRequests,
        [],
        'loaded model operations must make zero HTTP requests of every host class',
      );
      assert.ok(
        served.every((entry) => entry.allowed),
        'no hidden network repair',
      );
      mkdirSync(join(REPO, 'test-results/manager-cache', engine), { recursive: true });
      writeFileSync(
        evidencePath,
        JSON.stringify(
          { engine, browserVersion: browser.version(), setup, result, loadedRequests, served },
          null,
          2,
        ),
      );
      await page.screenshot({ path: evidencePath.replace('.json', '.png'), timeout: 3000 });
      await context.tracing.stop();
      t.diagnostic(`${engine}: ${JSON.stringify(result)}; evidence ${evidencePath}`);
    } catch (error) {
      mkdirSync(join(REPO, 'test-results/manager-cache', engine), { recursive: true });
      writeFileSync(
        evidencePath.replace('.json', '-failure.json'),
        JSON.stringify(
          {
            engine,
            browserVersion: browser.version(),
            error: String(error),
            phase,
            requests,
            served,
          },
          null,
          2,
        ),
      );
      await page
        .screenshot({ path: evidencePath.replace('.json', '-failure.png'), timeout: 3000 })
        .catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          context.tracing
            .stop({ path: evidencePath.replace('.json', '-failure.zip') })
            .catch(() => {}),
          new Promise<void>((done) => {
            timer = setTimeout(done, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      throw error;
    }
  },
);
