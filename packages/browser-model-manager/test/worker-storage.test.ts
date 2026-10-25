// Real dedicated-worker OPFS cell (fm-fy2.13). No storage API is replaced: engines expose their
// native write methods, and Safari's sync-only path is exercised only when that is its real API.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const workerSource = String.raw`
import { createShardStore, openShardStore, SHARD_DIRECTORY, TRAILER_BYTES } from '/pkg/cache/shard-store.js';
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const probeDirectory = 'worker-sync-native-probe';
const nativeSyncRoundTrip = async handle => {
  const data = new Uint8Array([7, 19, 83, 201]);
  let access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    check(access.write(data, { at: 0 }) === data.length, 'native sync write was short');
    access.flush();
  } finally { access.close(); }
  // Exclusive re-acquisition proves close released the native worker handle.
  access = await handle.createSyncAccessHandle();
  try {
    const back = new Uint8Array(data.length);
    check(access.getSize() === data.length, 'native sync file size differs');
    check(access.read(back, { at: 0 }) === data.length, 'native sync read was short');
    check(back.every((value, i) => value === data[i]), 'native sync bytes differ');
  } finally { access.close(); }
};
const exercise = async (store, dir, data) => {
  const sha256 = await digest(data);
  check(await store.has(sha256, data.length) === false, 'fixture already present');
  await store.write(sha256, data);
  check(await store.has(sha256, data.length), 'package write not present');
  const back = await store.read(sha256, data.length);
  check(back && back.buffer.byteLength === data.length, 'package read did not return exact payload buffer');
  check(await digest(back) === sha256, 'package local bytes differ');
  const handle = await dir.getFileHandle(sha256);
  const raw = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  check(raw.length === data.length + TRAILER_BYTES, 'raw committed file size differs');
  check(await digest(raw.slice(0, data.length)) === sha256, 'raw payload digest differs');
  // A package write must release its access handle too. Do not change any bytes.
  const access = await handle.createSyncAccessHandle();
  try { check(access.getSize() === raw.length, 'reopened package sync size differs'); }
  finally { access.close(); }
  if (dir.name === SHARD_DIRECTORY) {
    const readOnly = await openShardStore({ readOnly: true });
    check(readOnly && await readOnly.has(sha256, data.length), 'readonly inventory cannot see worker commit');
    check(await digest(await readOnly.read(sha256, data.length)) === sha256, 'readonly bytes differ');
  }
  await store.remove(sha256);
  check(await store.has(sha256, data.length) === false, 'package removal left presence');
  check(await store.read(sha256, data.length) === undefined, 'package removal left readable bytes');
  await store.remove(sha256); // Native NotFound remains idempotent.
  return { sha256, size: data.length, trailer: Array.from(raw.slice(data.length)), removed: true };
};
self.onmessage = async () => {
  let root;
  let result;
  try {
    if (typeof navigator.storage?.getDirectory !== 'function') {
      result = { untested: 'dedicated worker has no native navigator.storage.getDirectory' };
      return;
    }
    root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(probeDirectory, { create: true });
    const native = await dir.getFileHandle('native-sync', { create: true });
    if (typeof native.createSyncAccessHandle !== 'function') {
      result = { untested: 'dedicated worker FileSystemFileHandle has no native createSyncAccessHandle' };
      return;
    }
    const writeMethod = typeof native.createWritable === 'function' ? 'createWritable' : 'createSyncAccessHandle';
    await nativeSyncRoundTrip(native);
    await dir.removeEntry('native-sync');
    const direct = await exercise(createShardStore(dir), dir, new Uint8Array(8193).map((_, i) => (i * 17 + 31) % 256));
    const opened = await openShardStore();
    check(opened !== null, 'openShardStore rejected real worker OPFS round trip');
    const packageDir = await root.getDirectoryHandle(SHARD_DIRECTORY);
    const openedResult = await exercise(opened, packageDir, new Uint8Array(4097).map((_, i) => (i * 23 + 11) % 256));
    result = { writeMethod, nativeSyncClosedAndReopened: true, direct, opened: openedResult };
  } catch (error) {
    result = { error: String(error) + '\n' + String(error?.stack ?? '') };
  } finally {
    if (root) {
      for (const name of [probeDirectory, SHARD_DIRECTORY]) {
        try { await root.removeEntry(name, { recursive: true }); }
        catch (error) { if (error.name !== 'NotFoundError') result = { error: 'worker OPFS cleanup: ' + String(error) }; }
      }
    }
    self.postMessage(result);
  }
};
self.postMessage({ ready: true });
`;

const { engine, browser, newContext, unavailable } = await componentBrowser();
const work = mkdtempSync(join(tmpdir(), 'manager-worker-storage-'));
const built = join(work, 'dist');
let server: ReturnType<typeof createServer> | undefined;
test.after(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(work, { recursive: true, force: true });
});

interface ShardResult {
  sha256: string;
  size: number;
  trailer: number[];
  removed: boolean;
}
interface WorkerResult {
  untested?: string;
  error?: string;
  writeMethod?: string;
  nativeSyncClosedAndReopened?: boolean;
  direct?: ShardResult;
  opened?: ShardResult;
}

test(
  `${engine}: dedicated worker native OPFS sync handles close/reopen; package stores commit/read/remove locally`,
  { skip: unavailable, timeout: 60_000 },
  async (t) => {
    execFileSync(process.execPath, [
      join(REPO, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(PKG, 'tsconfig.build.json'),
      '--outDir',
      built,
    ]);
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
    const serverRequests: string[] = [];
    server = createServer(
      { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
      (req, res) => {
        const path = normalize(new URL(req.url ?? '/', 'https://x').pathname);
        serverRequests.push(path);
        res.setHeader('cache-control', 'no-store');
        if (path === '/') {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end('<!doctype html><title>manager worker storage</title>');
        }
        if (path === '/worker.js') {
          res.writeHead(200, { 'content-type': 'text/javascript' });
          return res.end(workerSource);
        }
        if (path.startsWith('/pkg/')) {
          try {
            const body = readFileSync(join(built, path.slice(5)));
            res.writeHead(200, { 'content-type': 'text/javascript' });
            return res.end(body);
          } catch {
            /* 404 below */
          }
        }
        res.writeHead(404);
        res.end();
      },
    );
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const context = await newContext!({ ignoreHTTPSErrors: true });
    const network: { url: string; method: string; phase: string }[] = [];
    let phase = 'bootstrap';
    context.on('request', (request) =>
      network.push({ url: request.url(), method: request.method(), phase }),
    );
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    try {
      await page.goto(origin);
      await page.evaluate(async () => {
        const worker = new Worker('/worker.js', { type: 'module' });
        (window as unknown as { storageWorker: Worker }).storageWorker = worker;
        await new Promise<void>((resolve, reject) => {
          worker.onerror = (event) => reject(new Error(event.message));
          worker.onmessageerror = () =>
            reject(new Error('worker ready message could not be decoded'));
          worker.onmessage = (event) =>
            event.data.ready ? resolve() : reject(new Error('unexpected worker bootstrap message'));
        });
      });
      // The worker's complete static import graph is loaded before the local-only measurement.
      // Block later HTTP(S) requests as well as recording them: hidden repair must fail this cell.
      // WebKit emits blob: events for File.slice().arrayBuffer(); those are local OPFS reads.
      const before = serverRequests.length;
      phase = 'local-storage';
      await context.route(/^https?:\/\//, (route) => route.abort('blockedbyclient'));
      const result = await page.evaluate(async () => {
        const worker = (window as unknown as { storageWorker: Worker }).storageWorker;
        return await new Promise<WorkerResult>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('worker storage operation did not settle')),
            20_000,
          );
          worker.onerror = (event) => {
            clearTimeout(timer);
            reject(new Error(event.message));
          };
          worker.onmessageerror = () => {
            clearTimeout(timer);
            reject(new Error('worker result could not be decoded'));
          };
          worker.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data);
          };
          worker.postMessage({ run: true });
        });
      });
      assert.equal(result.error, undefined, result.error ?? 'worker storage failed');
      assert.deepEqual(
        network.filter(
          (request) => request.phase === 'local-storage' && /^https?:/.test(request.url),
        ),
        [],
        'worker local storage attempted hidden network I/O',
      );
      assert.equal(serverRequests.length, before, 'worker local storage reached HTTP server');
      if (result.untested) {
        t.skip(`untested: ${engine}: ${result.untested}`);
        return;
      }
      assert.equal(result.nativeSyncClosedAndReopened, true);
      for (const [name, size, multiplier, offset] of [
        ['direct', 8193, 17, 31],
        ['opened', 4097, 23, 11],
      ] as const) {
        const shard = result[name]!;
        const expected = Uint8Array.from(
          { length: size },
          (_, i) => (i * multiplier + offset) % 256,
        );
        const sha256 = createHash('sha256').update(expected).digest('hex');
        const trailer = Buffer.alloc(48);
        trailer.write('CFSHARD1');
        trailer.writeBigUInt64LE(BigInt(size), 8);
        Buffer.from(sha256, 'hex').copy(trailer, 16);
        assert.equal(shard.sha256, sha256, `${name}: real locally read bytes`);
        assert.equal(shard.size, size);
        assert.deepEqual(shard.trailer, [...trailer], `${name}: raw committed trailer`);
        assert.equal(shard.removed, true);
      }
      t.diagnostic(
        `native worker createSyncAccessHandle write/flush/read/close/reopen passed; package native write method: ${result.writeMethod}; local network requests/bytes: 0/0`,
      );
      await t.test(
        `${engine}: package writes through native sync-only worker OPFS API`,
        {
          skip:
            result.writeMethod === 'createSyncAccessHandle'
              ? false
              : 'untested: engine natively exposes createWritable, so package selects it; storage APIs were not patched',
        },
        () => assert.equal(result.writeMethod, 'createSyncAccessHandle'),
      );
    } catch (error) {
      const dir = join(REPO, 'test-results/manager-cache', engine);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'worker-sync-storage-network.json'),
        JSON.stringify({ network, serverRequests }, null, 2),
      );
      await Promise.allSettled([
        page.screenshot({ path: join(dir, 'worker-sync-storage.png') }),
        context.tracing.stop({ path: join(dir, 'worker-sync-storage.zip') }),
      ]);
      throw error;
    } finally {
      await page
        .evaluate(() =>
          (window as unknown as { storageWorker?: Worker }).storageWorker?.terminate(),
        )
        .catch(() => {});
      await context.close();
    }
  },
);
