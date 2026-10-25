// fm-fy2.13 cold-photo component: real pinned e4e shards, native OPFS, and actual
// browser ORT/WASM. This direct consumer has no shard-retention map. Managed live
// shard metrics count a local-reader result through its real ORT session release;
// they are not GC/RSS measurements or a claim about the app's desktop retention.
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
const PKG = new URL('..', import.meta.url).pathname;
const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ?? join(homedir(), '.cache/facemorph-runtime');
const MANIFEST_SHA = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
interface Unit {
  url: string;
  sha256: string;
  size: number;
}
interface Step extends Unit {
  id: number;
}
interface Config {
  steps: Step[];
  maxShardBytes: number;
  maxLiveBoundaryBytes: number;
  executor: Unit;
  runtime: { module: Unit; factory: Unit; wasm: Unit };
  canaries: { id: string; input: Unit; reference: Unit; threshold: number }[];
}
interface Snapshot {
  files: number;
  committedBytes: number;
  payloadBytes: number;
  usage: number | null;
  quota: number | null;
}
interface LocalCache {
  local: {
    read(asset: Unit): Promise<{ ok: boolean; value?: Uint8Array<ArrayBuffer>; error?: unknown }>;
  };
}
interface PageState {
  cache: LocalCache;
  config: Config;
  allowNetwork: boolean;
  blockedRequests: number;
  snapshot(inventory?: boolean): Promise<Snapshot>;
}
const helper = await import('../../../scripts/ci/intercept/playwright.ts');
const record = await import('../../../scripts/ci/intercept/record.ts');
const pathOf = (unit: Unit) =>
  join(RUNTIME, new URL(unit.url).pathname.split('/runtime/')[1] ?? '');

test(
  'cold-photo OPFS: real 108-shard acquisition, bounded managed inputs, local-only real CPU encode',
  { timeout: 300_000 },
  async (t) => {
    const manifestPath = join(RUNTIME, 'manifest.json');
    if (!existsSync(manifestPath)) {
      const reason = `untested: pinned runtime not acquired at ${RUNTIME}`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw new Error(reason);
      return t.skip(reason);
    }
    const manifestBytes = readFileSync(manifestPath);
    assert.equal(sha(manifestBytes), MANIFEST_SHA, 'the qualified runtime is pinned');
    const manifest = JSON.parse(manifestBytes.toString()) as { encoderStream: Unit };
    const descriptor = manifest.encoderStream;
    const descriptorBytes = readFileSync(pathOf(descriptor));
    assert.equal(sha(descriptorBytes), descriptor.sha256);
    assert.equal(descriptorBytes.byteLength, descriptor.size);
    const config = JSON.parse(descriptorBytes.toString()) as Config;
    assert.equal(config.steps.length, 108);
    const executorBytes = readFileSync(pathOf(config.executor));
    assert.equal(sha(executorBytes), config.executor.sha256, 'the executed source is pinned');
    assert.equal(executorBytes.byteLength, config.executor.size);
    assert.match(
      executorBytes.toString(),
      /modelBytes=null;row\.createMs/,
      'pinned executor drops its model buffer after real session creation',
    );
    assert.match(
      executorBytes.toString(),
      /await session\.release\(\)/,
      'pinned executor awaits session disposal before the next shard',
    );
    const canary = config.canaries.find((c) => c.id === 'seed-0-aligned')!;
    assert.ok(canary);
    const units = [
      ...new Map(
        [
          descriptor,
          config.executor,
          config.runtime.module,
          config.runtime.factory,
          config.runtime.wasm,
          canary.input,
          canary.reference,
          ...config.steps,
        ].map((unit) => [unit.sha256, unit]),
      ).values(),
    ];
    for (const unit of units) assert.ok(existsSync(pathOf(unit)), `real input exists: ${unit.url}`);

    const { engine, browser, newContext, unavailable } = await componentBrowser();
    if (unavailable) return t.skip(unavailable);
    if (engine !== 'chromium') {
      await browser!.close();
      return t.skip('untested: this first cold-photo native OPFS CPU cell is Chromium only');
    }
    const work = mkdtempSync(join(tmpdir(), 'manager-cold-photo-'));
    const evidence = join(REPO, 'test-results/manager-cache', engine, 'cold-photo');
    let server: Server | undefined;
    let context: Awaited<ReturnType<NonNullable<typeof newContext>>> | undefined;
    t.after(async () => {
      await context?.close();
      await browser!.close();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
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
    const built = join(work, 'dist');
    execFileSync(process.execPath, [
      join(REPO, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(PKG, 'tsconfig.build.json'),
      '--outDir',
      built,
    ]);
    const served: { path: string; bytes: number; finished: boolean; aborted: boolean }[] = [];
    server = createServer(
      { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
      (req, res) => {
        const path = new URL(req.url ?? '/', 'https://x').pathname;
        if (path === '/')
          return void res
            .writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
            .end('<title>Cold photo manager component</title>');
        const root = path.startsWith('/runtime/') ? RUNTIME : built;
        const relative = path.startsWith('/runtime/')
          ? path.slice(9)
          : path.startsWith('/pkg/')
            ? path.slice(5)
            : '';
        const file = resolve(root, relative);
        if (!relative || !file.startsWith(`${resolve(root)}/`) || !existsSync(file))
          return void res.writeHead(404).end();
        if (path.startsWith('/runtime/')) {
          const entry = { path, bytes: 0, finished: false, aborted: false };
          served.push(entry);
          res.once('finish', () => {
            entry.finished = true;
          });
          res.once('close', () => {
            entry.aborted = !res.writableFinished;
          });
          const stream = createReadStream(file);
          stream.on('data', (piece) => {
            entry.bytes += piece.length;
          });
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          res.writeHead(200, {
            'content-type':
              extname(file) === '.mjs' ? 'text/javascript' : 'application/octet-stream',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          });
          stream.pipe(res);
        } else
          res
            .writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
            .end(readFileSync(file));
      },
    );
    const port = await new Promise<number>((resolve) =>
      server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)),
    );
    const origin = `https://127.0.0.1:${port}`;
    context = await newContext!({ ignoreHTTPSErrors: true });
    // The network ledger below is sufficient; DOM snapshots also retain gigabytes
    // of model-response bodies in Playwright's trace and perturb this measurement.
    await context.tracing.start({ screenshots: true, snapshots: false });
    const att = helper.attachPlaywright(
      context as unknown as Parameters<typeof helper.attachPlaywright>[0],
      {
        version: 1,
        rules: [
          { host: `127.0.0.1:${port}`, pathPrefix: '/runtime/', class: 'model-host' },
          { host: `127.0.0.1:${port}`, class: 'app' },
        ],
      },
    );
    const page = await context.newPage();
    try {
      await page.goto(origin);
      await page.evaluate(() => import(String('/pkg/index.js')));
      record.step(att.rec, 'cold-acquire');
      const acquisition = await page.evaluate(
        async ({ units, descriptor, origin, manifestSha }) => {
          const m = await import(String('/pkg/index.js'));
          const root = await navigator.storage.getDirectory();
          assertEmpty: {
            for await (const _entry of root.values())
              throw new Error('cold context unexpectedly has OPFS files');
            break assertEmpty;
          }
          if ((await caches.keys()).length)
            throw new Error('cold context unexpectedly has Cache Storage entries');
          const native = await m.openShardStore();
          if (!native)
            throw new Error('native OPFS unavailable; fallback does not qualify this cell');
          const samples: Snapshot[] = [];
          const committedSizes = new Map<string, number>();
          const snapshots = async (inventory = true): Promise<Snapshot> => {
            const directory = await root.getDirectoryHandle('checkface-model-shards-v1');
            // Measure completed native files, not another concurrent writer's
            // pending directory entry. A single final full inventory detects loss.
            if (inventory) {
              const actual = new Map<string, number>();
              for await (const handle of directory.values())
                if (handle.kind === 'file')
                  actual.set(handle.name, (await (handle as FileSystemFileHandle).getFile()).size);
              if (
                actual.size !== committedSizes.size ||
                [...committedSizes].some(([name, size]) => actual.get(name) !== size)
              )
                throw new Error('native OPFS inventory differs from measured successful commits');
            }
            const files = committedSizes.size;
            const committedBytes = [...committedSizes.values()].reduce((n, size) => n + size, 0);
            const estimate = await navigator.storage.estimate();
            return {
              files,
              committedBytes,
              payloadBytes: committedBytes - files * m.TRAILER_BYTES,
              usage: estimate.usage ?? null,
              quota: estimate.quota ?? null,
            };
          };
          const state: PageState = {
            allowNetwork: true,
            blockedRequests: 0,
            cache: undefined as unknown as LocalCache,
            config: undefined as unknown as Config,
            snapshot: snapshots,
          };
          const shardStore = {
            ...native,
            async write(hash: string, bytes: Uint8Array) {
              await native.write(hash, bytes);
              const directory = await root.getDirectoryHandle('checkface-model-shards-v1');
              const file = await (await directory.getFileHandle(hash)).getFile();
              if (file.size !== bytes.byteLength + m.TRAILER_BYTES)
                throw new Error('native committed OPFS file has the wrong length');
              committedSizes.set(hash, file.size);
              samples.push(await snapshots(false));
            },
          };
          const cache = await m.createBrowserModelCache({
            shards: shardStore,
            retryDelaysMs: [],
            fetcher: (url: string, options: RequestInit) => {
              if (!state.allowNetwork) {
                state.blockedRequests++;
                throw new Error('local encoder execution attempted network repair');
              }
              return fetch(`${origin}${new URL(url).pathname}`, options);
            },
          });
          state.cache = cache;
          const grant = {
            manifestSha256: manifestSha,
            route: 'cpu',
            purpose: 'cold-photo-component',
            owners: ['face:cold-photo'],
            remainingBytes: units.reduce((n, unit) => n + unit.size, 0),
            assets: units.map((unit) => ({
              sha256: unit.sha256,
              bytes: unit.size,
              priority: 'foreground-required',
            })),
          };
          await Promise.all(
            units.map((unit) => cache.acquire(unit, { grant, owner: 'face:cold-photo' })),
          );
          const parsed = await cache.local.read(descriptor);
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
          state.config = JSON.parse(new TextDecoder().decode(parsed.value));
          state.allowNetwork = false;
          Object.assign(window, { coldPhoto: state });
          const final = await snapshots();
          return {
            samples,
            final,
            peakCommittedBytes: Math.max(...samples.map((s) => s.committedBytes)),
            peakPayloadBytes: Math.max(...samples.map((s) => s.payloadBytes)),
            nativeUsagePeak: Math.max(...samples.map((s) => s.usage ?? 0)),
            grantRemaining: m.grantRemaining(grant),
          };
        },
        { units, descriptor, origin, manifestSha: MANIFEST_SHA },
      );
      await att.settled();
      const payloadBytes = units.reduce((n, unit) => n + unit.size, 0);
      assert.equal(acquisition.grantRemaining, 0);
      assert.equal(acquisition.final.files, units.length);
      assert.equal(acquisition.final.payloadBytes, payloadBytes);
      assert.equal(acquisition.final.committedBytes, payloadBytes + 48 * units.length);
      assert.equal(acquisition.peakCommittedBytes, acquisition.final.committedBytes);
      assert.equal(acquisition.peakPayloadBytes, payloadBytes);
      assert.equal(acquisition.samples.length, units.length);
      assert.ok(
        acquisition.samples.every((sample) => sample.quota !== null && sample.usage !== null),
      );
      assert.deepEqual(
        served.map((r) => r.path).sort(),
        units.map((unit) => new URL(unit.url).pathname).sort(),
      );
      assert.ok(served.every((r) => r.finished && !r.aborted));
      assert.equal(
        served.reduce((n, row) => n + row.bytes, 0),
        payloadBytes,
      );

      console.info(
        `# cold-photo acquisition: ${units.length} files; committed ${acquisition.final.committedBytes} bytes; starting real ORT encode`,
      );
      record.step(att.rec, 'local-encode');
      const execution = await page.evaluate(async () => {
        const state = (window as unknown as { coldPhoto: PageState }).coldPhoto;
        const { cache, config } = state;
        const urls: string[] = [];
        const read = async (asset: Unit) => {
          const result = await cache.local.read(asset);
          if (!result.ok || !result.value) throw new Error(JSON.stringify(result.error));
          return result.value;
        };
        const blob = async (asset: Unit, type: string) => {
          const url = URL.createObjectURL(new Blob([await read(asset)], { type }));
          urls.push(url);
          return url;
        };
        const stepReads: string[] = [];
        const lifetime = {
          liveShards: 0,
          peakLiveShards: 0,
          liveShardBytes: 0,
          peakLiveShardBytes: 0,
          creates: 0,
          releases: 0,
          liveSessions: 0,
          peakLiveSessions: 0,
        };
        let result;
        try {
          const moduleUrl = await blob(config.runtime.module, 'text/javascript');
          const factoryUrl = await blob(config.runtime.factory, 'text/javascript');
          const wasmUrl = await blob(config.runtime.wasm, 'application/wasm');
          const observerUrl = URL.createObjectURL(
            new Blob(
              [
                `import factory from ${JSON.stringify(factoryUrl)};let ref;export default async function(config){const m=await factory(config);ref=new WeakRef(m);return m;}export function snapshot(){const buffer=ref?.deref()?.HEAPU8?.buffer;return {available:Boolean(buffer),shared:Object.prototype.toString.call(buffer)==='[object SharedArrayBuffer]',currentBytes:buffer?.byteLength};}`,
              ],
              { type: 'text/javascript' },
            ),
          );
          urls.push(observerUrl);
          const ort = await import(/* @vite-ignore */ moduleUrl);
          const observer = await import(/* @vite-ignore */ observerUrl);
          const executor = await import(
            /* @vite-ignore */ await blob(config.executor, 'text/javascript')
          );
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.wasmPaths = { mjs: observerUrl, wasm: wasmUrl };
          const observedOrt = {
            ...ort,
            InferenceSession: {
              async create(model: Uint8Array, options: unknown) {
                if (lifetime.liveShards !== 1 || model.byteLength !== lifetime.liveShardBytes)
                  throw new Error('model input lifetime mismatch');
                const size = model.byteLength;
                const native = await ort.InferenceSession.create(model, options);
                lifetime.creates++;
                lifetime.liveSessions++;
                lifetime.peakLiveSessions = Math.max(
                  lifetime.peakLiveSessions,
                  lifetime.liveSessions,
                );
                let released = false;
                return {
                  run: (feeds: unknown) => native.run(feeds),
                  async release() {
                    if (released) throw new Error('duplicate real session release');
                    await native.release();
                    released = true;
                    lifetime.releases++;
                    lifetime.liveSessions--;
                    lifetime.liveShards--;
                    lifetime.liveShardBytes -= size;
                  },
                };
              },
            },
          };
          const canary = config.canaries.find((c) => c.id === 'seed-0-aligned')!;
          const input = await read(canary.input),
            reference = await read(canary.reference);
          const tensor = new Float32Array(input.buffer, input.byteOffset, input.byteLength / 4);
          const expected = new Float32Array(
            reference.buffer,
            reference.byteOffset,
            reference.byteLength / 4,
          );
          result = await executor.executeEncoderStream({
            ort: observedOrt,
            manifest: config,
            tensor,
            snapshotMemory: observer.snapshot,
            acquireBytes: async (step: Step) => {
              if (lifetime.liveShards || lifetime.liveSessions)
                throw new Error('previous model/session retained when reading the next shard');
              const bytes = await read(step);
              stepReads.push(step.sha256);
              lifetime.liveShards++;
              lifetime.liveShardBytes += bytes.byteLength;
              lifetime.peakLiveShards = Math.max(lifetime.peakLiveShards, lifetime.liveShards);
              lifetime.peakLiveShardBytes = Math.max(
                lifetime.peakLiveShardBytes,
                lifetime.liveShardBytes,
              );
              return bytes;
            },
          });
          let maxWError = 0;
          for (let i = 0; i < expected.length; i++)
            maxWError = Math.max(maxWError, Math.abs(result.values[i] - expected[i]!));
          return {
            lifetime,
            stepReads,
            maxWError,
            stats: result.encoderStats,
            blockedRequests: state.blockedRequests,
            finalStorage: await state.snapshot(),
          };
        } finally {
          for (const url of urls) URL.revokeObjectURL(url);
        }
      });
      await att.settled();
      const localRequests = att.rec.requests.filter(
        (r) => att.rec.steps[r.step]?.name === 'local-encode' && /^https?:/.test(r.url),
      );
      assert.deepEqual(
        localRequests,
        [],
        'verified local runtime/shard execution issues zero network requests',
      );
      assert.equal(execution.blockedRequests, 0, 'no hidden repair was attempted');
      assert.deepEqual(
        execution.stepReads,
        config.steps.map((step) => step.sha256),
      );
      assert.equal(execution.lifetime.creates, 108);
      assert.equal(execution.lifetime.releases, 108);
      assert.equal(execution.lifetime.peakLiveShards, 1);
      assert.equal(execution.lifetime.peakLiveSessions, 1);
      assert.equal(execution.lifetime.liveShards, 0);
      assert.equal(execution.lifetime.liveShardBytes, 0);
      assert.equal(execution.lifetime.liveSessions, 0);
      assert.ok(execution.lifetime.peakLiveShardBytes <= config.maxShardBytes);
      assert.ok(execution.maxWError <= 0.0001, `real aligned canary error ${execution.maxWError}`);
      assert.equal(execution.stats.completed, true);
      assert.equal(execution.stats.maxLiveSessions, 1);
      assert.equal(execution.stats.liveSessions, 0);
      assert.ok(execution.stats.wasmPeakBytes > 0 && execution.stats.wasmPeakBytes <= 268435456);
      assert.ok(execution.stats.jsBoundaryPeakBytes <= config.maxLiveBoundaryBytes);
      assert.equal(
        execution.stats.receivedShardBytes,
        config.steps.reduce((n, step) => n + step.size, 0),
      );
      assert.equal(execution.finalStorage.committedBytes, acquisition.final.committedBytes);
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            scope:
              'Direct manager component, native OPFS, actual single-thread browser WASM, no product shard retention; managed live model-input/session lifetime, not GC or process RSS. Stored peak is committed OPFS file lengths including 48-byte trailers; native usage samples include origin metadata and are sampled, not an exact physical storage peak.',
            browser: browser!.version(),
            manifestSha256: MANIFEST_SHA,
            descriptorSha256: descriptor.sha256,
            executorSha256: config.executor.sha256,
            acquisition,
            execution,
            network: att.rec,
            served,
          },
          null,
          2,
        ),
      );
      await context.tracing.stop();
      t.diagnostic(
        `stored payload ${payloadBytes}, committed peak ${acquisition.peakCommittedBytes}, sampled origin usage peak ${acquisition.nativeUsagePeak}; live managed shards ${execution.lifetime.peakLiveShards}/${execution.lifetime.peakLiveShardBytes} bytes; WASM ${execution.stats.wasmPeakBytes}; max W+ error ${execution.maxWError}`,
      );
    } catch (error) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        join(evidence, 'failure-network.json'),
        JSON.stringify({ network: att.rec, served }, null, 2),
      );
      await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
      await context.tracing.stop({ path: join(evidence, 'failure.zip') }).catch(() => {});
      throw error;
    }
  },
);
