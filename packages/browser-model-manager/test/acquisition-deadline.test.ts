// The silence bound belongs to pending network I/O. Local verification, slot admission and native
// durable commits can all take longer without making an otherwise healthy download time out.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const payload = Uint8Array.from({ length: 4096 }, (_, i) => i % 251);
const asset = {
  sha256: createHash('sha256').update(payload).digest('hex'),
  size: payload.length,
  url: 'https://models.example/asset',
};
const owner = 'face:deadline';
// Match the other component files: browser launch is suite setup; the case's bound covers its operations.
const { browser, newContext, unavailable, engine } = await componentBrowser();
test.after(async () => {
  await browser?.close();
});

test(
  `${engine}: real HTTPS bytes survive native CacheStorage and OPFS completion delayed beyond timeoutMs`,
  { timeout: 45000 },
  async (t) => {
    if (!browser) {
      t.skip(String(unavailable));
      return;
    }
    const work = mkdtempSync(join(tmpdir(), 'manager-deadline-'));
    let context: Awaited<ReturnType<typeof newContext>> | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    let phase = 'TLS and package setup';
    const abort = () => {
      t.diagnostic(`deadline case cancelled during ${phase}`);
      void context?.close().catch(() => {});
    };
    t.signal.addEventListener('abort', abort, { once: true });
    try {
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
      const built = join(work, 'dist');
      execFileSync(process.execPath, [
        new URL('../../../node_modules/typescript/bin/tsc', import.meta.url).pathname,
        '-p',
        new URL('../tsconfig.build.json', import.meta.url).pathname,
        '--outDir',
        built,
      ]);
      let requests = 0;
      const faults: { path: string; closed: boolean }[] = [];
      server = createServer(
        { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
        (req, res) => {
          const path = new URL(req.url!, 'https://local').pathname;
          res.setHeader('cache-control', 'no-store');
          if (path === '/observed') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(faults));
            return;
          }
          if (path.startsWith('/silent/')) {
            const entry = { path, closed: false };
            faults.push(entry);
            res.on('close', () => {
              entry.closed = true;
            });
            if (path.includes('/body/')) {
              res.writeHead(200, { 'content-length': String(payload.length) });
              res.write(payload.subarray(0, 1));
            }
            return; // The real socket remains silent until acquisition cancels it.
          }
          if (path === '/asset') {
            requests++;
            res.end(payload);
            return;
          }
          if (path.startsWith('/pkg/') && !path.includes('..')) {
            try {
              res.setHeader('content-type', 'text/javascript');
              res.end(readFileSync(join(built, path.slice(5))));
              return;
            } catch {
              /* 404 below */
            }
          }
          if (path === '/') {
            res.setHeader('content-type', 'text/html');
            res.end('<!doctype html><title>deadline</title>');
            return;
          }
          res.writeHead(404);
          res.end();
        },
      );
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
      phase = 'native context setup';
      context = await newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.text().startsWith('deadline phase:')) {
          phase = message.text();
          t.diagnostic(phase);
        }
      });
      await page.goto(origin);
      phase = 'module imports and native storage setup';
      const result = await page.evaluate(
        async ({ input, owner }) => {
          const load = (path: string) => import(path);
          const { createModelCache, acquireUncachedBytes } = await load(
            '/pkg/cache/model-cache.js',
          );
          const { createAcquisitionSlots } = await load('/pkg/acquisition/slots.js');
          const { grantRemaining } = await load('/pkg/acquisition/grants.js');
          const { openShardStore } = await load('/pkg/cache/shard-store.js');
          const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
          const nativeCache = await caches.open('deadline-native');
          const key = (hash: string) => `${location.origin}/local/${hash}`;
          const nativeShards = await openShardStore();
          if (!nativeShards) throw new Error('native OPFS unavailable');
          const rows = [];
          try {
            for (const kind of ['cache-plain', 'cache-chunk', 'opfs']) {
              console.info(`deadline phase: ${kind}`);
              const grant = {
                manifestSha256: 'deadline',
                route: 'cpu',
                purpose: 'generate',
                assets: [
                  { sha256: input.sha256, bytes: input.size, priority: 'foreground-required' },
                ],
                owners: [owner],
                remainingBytes: input.size,
              };
              let commits = 0;
              const cache = createModelCache({
                store: {
                  get: async (hash: string) => nativeCache.match(key(hash)),
                  remove: async (hash: string) => nativeCache.delete(key(hash)),
                  put: async (hash: string, response: Response) => {
                    await nativeCache.put(key(hash), response);
                    commits++;
                    await delay(1500);
                  },
                },
                shards:
                  kind === 'opfs'
                    ? {
                        ...nativeShards,
                        write: async (hash: string, bytes: Uint8Array<ArrayBuffer>) => {
                          await nativeShards.write(hash, bytes);
                          commits++;
                          await delay(1500);
                        },
                      }
                    : null,
                timeoutMs: 1000,
                stallMs: 1000,
                readAhead: 1,
              });
              const handle = await cache.acquire(
                kind === 'cache-plain' ? input : { ...input, chunks: [input] },
                { grant, owner },
              );
              const bytes = await handle.bytes();
              const digest = Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
                (byte) => byte.toString(16).padStart(2, '0'),
              ).join('');
              if (digest !== input.sha256 || commits !== 1)
                throw new Error(`${kind}: native bytes/commit differ`);
              rows.push({ kind, commits, bytes: bytes.length, digest });
              await nativeCache.delete(key(input.sha256));
              await nativeShards.remove(input.sha256);
            }
            const approval = () => ({
              manifestSha256: 'deadline',
              route: 'cpu',
              purpose: 'generate',
              assets: [
                { sha256: input.sha256, bytes: input.size, priority: 'foreground-required' },
              ],
              owners: [owner],
              remainingBytes: input.size,
            });
            const store = {
              get: async (hash: string) => nativeCache.match(key(hash)),
              put: async (hash: string, response: Response) => nativeCache.put(key(hash), response),
              remove: async (hash: string) => nativeCache.delete(key(hash)),
            };
            // Actual aggregate slot acquisition waits on a real, already-held Web Lock.
            for (const cached of [false, true]) {
              console.info(`deadline phase: native-slot-${cached}`);
              const name = `deadline-native-${cached}`;
              let unlock!: () => void;
              let acquired!: () => void;
              const held = new Promise<void>((resolve) => {
                acquired = resolve;
              });
              const holder = navigator.locks.request(`${name}:slot-0`, async () => {
                acquired();
                await new Promise<void>((resolve) => {
                  unlock = resolve;
                });
              });
              await held;
              const slots = createAcquisitionSlots({ locks: navigator.locks, count: 1, name });
              const grant = approval();
              const settings = { slots, timeoutMs: 1000, stallMs: 1000 };
              const started = performance.now();
              const acquisition = cached
                ? createModelCache({ ...settings, store }).acquire(input, { grant, owner })
                : acquireUncachedBytes(input, { grant, owner }, settings);
              const timer = setTimeout(unlock, 1500);
              try {
                await acquisition;
                if (performance.now() - started < 1400 || grantRemaining(grant) !== 0)
                  throw new Error('native slot wait/grant evidence differs');
                rows.push({ kind: `native-slot-${cached}`, waited: true });
              } finally {
                clearTimeout(timer);
                unlock();
                await holder;
                await nativeCache.delete(key(input.sha256));
              }
            }
            for (const cached of [false, true]) {
              for (const phase of ['headers', 'body']) {
                console.info(`deadline phase: silent-${phase}-${cached}`);
                const grant = approval();
                const path = `/silent/${phase}/${cached}`;
                const silent = { ...input, url: `${location.origin}${path}` };
                const settings = { timeoutMs: 1000, stallMs: 3000, retryDelaysMs: [], slots: null };
                const started = performance.now();
                let caught: unknown;
                try {
                  if (cached)
                    await createModelCache({ ...settings, store }).acquire(silent, {
                      grant,
                      owner,
                    });
                  else await acquireUncachedBytes(silent, { grant, owner }, settings);
                } catch (error) {
                  caught = error;
                }
                if (!(caught instanceof DOMException) || caught.name !== 'TimeoutError')
                  throw new Error(`${path}: expected TimeoutError, received ${caught}`);
                const elapsed = performance.now() - started;
                if (
                  elapsed > 3500 ||
                  grantRemaining(grant) !== input.size - (phase === 'body' ? 1 : 0)
                )
                  throw new Error(`${path}: timeout/grant evidence differs`);
                rows.push({ kind: path, elapsed });
              }
            }
            for (const cached of [false, true]) {
              console.info(`deadline phase: caller-cancel-${cached}`);
              const controller = new AbortController();
              const reason = new DOMException('caller stopped', 'AbortError');
              const path = `/silent/body/caller-${cached}`;
              const silent = { ...input, url: `${location.origin}${path}` };
              const grant = approval();
              const settings = { timeoutMs: 5000, stallMs: 5000, slots: null };
              const options = { grant, owner, signal: controller.signal };
              const acquisition = cached
                ? createModelCache({ ...settings, store }).acquire(silent, options)
                : acquireUncachedBytes(silent, options, settings);
              // Attach the handler before observing the real server; rejection cannot be unhandled.
              const outcome = acquisition.then(
                () => undefined,
                (error: unknown) => error,
              );
              try {
                let seen = false;
                for (let i = 0; i < 100; i++) {
                  const observed = await (await fetch('/observed', { cache: 'no-store' })).json();
                  if (observed.some((entry: { path: string }) => entry.path === path)) {
                    seen = true;
                    break;
                  }
                  await delay(10);
                }
                if (!seen) throw new Error(`${path}: real request did not start`);
                controller.abort(reason);
                if ((await outcome) !== reason)
                  throw new Error(`${path}: cancellation reason differs`);
                rows.push({ kind: path, cancelled: true });
              } finally {
                controller.abort(reason);
              }
            }
            // Wait for close events on the actual HTTPS sockets, not mocked cancellation callbacks.
            for (let i = 0; i < 100; i++) {
              const observed = await (await fetch('/observed', { cache: 'no-store' })).json();
              if (
                observed.length === 6 &&
                observed.every((entry: { closed: boolean }) => entry.closed)
              )
                return rows;
              await delay(10);
            }
            throw new Error('silent HTTPS sockets were not closed by cancellation');
          } finally {
            await caches.delete('deadline-native');
            await nativeShards.remove(input.sha256);
          }
        },
        { input: { ...asset, url: `${origin}/asset` }, owner },
      );
      assert.equal(result.length, 11);
      assert.equal(requests, 5);
      assert.equal(faults.length, 6);
      assert.ok(faults.every((entry) => entry.closed));
      t.diagnostic(`${engine}: ${JSON.stringify(result)}`);
    } finally {
      t.signal.removeEventListener('abort', abort);
      await context?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      rmSync(work, { recursive: true, force: true });
    }
  },
);
