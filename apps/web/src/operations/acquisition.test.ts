import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createModelCache,
  acquireUncachedBytes,
  type Fetcher,
} from '../../../../packages/browser-model-manager/src/cache/model-cache.ts';
import { createExecutionGate } from '../Next/browser/execution-gate.mjs';
import { createOperationService } from './bridge-service.ts';
import { createGovernor } from './scheduler.ts';
import { face, fakeBridge, flush, output } from './fake-bridge.ts';

const waitFor = async (accept: () => boolean) => {
  const end = performance.now() + 5000;
  while (!accept()) {
    if (performance.now() > end)
      throw Error('Real acquisition did not reach its expected boundary');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
async function fixture() {
  const work = mkdtempSync(join(tmpdir(), 'qrfz-compute-'));
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
  const payload = (path: string) =>
    Uint8Array.from({ length: 32768 }, (_, i) => (i + path.length) % 251);
  const log: { path: string; start: number; end: number; closedEarly: boolean }[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(
    { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) },
    (request, response) => {
      const data = payload(request.url!);
      const entry = { path: request.url!, start: performance.now(), end: 0, closedEarly: false };
      log.push(entry);
      response.writeHead(200, { 'content-length': data.length });
      response.on('close', () => {
        entry.end ||= performance.now();
        entry.closedEarly = !response.writableFinished;
      });
      let at = 0;
      const next = () => {
        if (response.destroyed) return;
        const part = data.subarray(at, (at += 4096));
        if (at >= data.length) {
          entry.end = performance.now();
          response.end(part);
          return;
        }
        response.write(part);
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            next();
          },
          request.url === '/encoder' ? 140 : 30,
        );
        timers.add(timer);
      };
      next();
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const asset = (path: string) => ({
    url: origin + path,
    size: payload(path).length,
    sha256: createHash('sha256').update(payload(path)).digest('hex'),
  });
  const fetcher: Fetcher = (url, options) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        { rejectUnauthorized: false, signal: options.signal ?? undefined },
        (response) =>
          resolve(
            new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
              status: response.statusCode ?? 500,
            }),
          ),
      );
      req.on('error', reject);
      req.end();
    });
  const cache = () => {
    const entries = new Map<string, Uint8Array>();
    return createModelCache({
      fetcher,
      store: {
        get: async (hash) => {
          const held = entries.get(hash);
          return held ? new Response(held.slice()) : undefined;
        },
        put: async (hash, response) => {
          entries.set(hash, new Uint8Array(await response.arrayBuffer()));
        },
        remove: async (hash) => {
          entries.delete(hash);
        },
      },
      retryDelaysMs: [],
      slots: null,
    });
  };
  const grant = (item: ReturnType<typeof asset>) => ({
    manifestSha256: '0'.repeat(64),
    route: 'cpu' as const,
    purpose: 'generate' as const,
    assets: [
      { sha256: item.sha256, bytes: item.size, priority: 'synthesis-prerequisite' as const },
    ],
    owners: ['face:test' as const],
    remainingBytes: item.size,
  });
  return {
    log,
    asset,
    cache,
    grant,
    fetcher,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(work, { recursive: true, force: true });
    },
  };
}

for (const durable of [true, false])
  test(`real server ${durable ? 'durable' : 'uncached'} acquisition holds no compute permit; synthesis starts after verification while independent encoder transfer continues`, async (t) => {
    const f = await fixture(),
      fake = fakeBridge();
    const governor = createGovernor({
      policy: { memory: 'ample' },
      hooks: { releaseWarm() {}, terminateWorkers() {} },
    });
    const generator = f.asset('/generator'),
      encoder = f.asset('/encoder');
    let computeAt = 0;
    const service = createOperationService({
      governor,
      bridge: {
        ...fake.bridge,
        async execute(_request, admission) {
          const gate = createExecutionGate(admission);
          try {
            const bytes = await gate.read(async () =>
              durable
                ? (
                    await f
                      .cache()
                      .acquire(generator, { grant: f.grant(generator), owner: 'face:test' })
                  ).bytes()
                : acquireUncachedBytes(
                    generator,
                    { grant: f.grant(generator), owner: 'face:test' },
                    { fetcher: f.fetcher, slots: null, retryDelaysMs: [] },
                  ),
            );
            assert.equal(bytes.byteLength, generator.size);
            return await gate.compute(async () => {
              computeAt = performance.now();
              assert.equal(governor.snapshot().permits.length, 1);
              assert.ok(f.log.some((row) => row.path === '/encoder' && row.end === 0));
              return output(['a']);
            });
          } finally {
            gate.close();
          }
        },
      },
    });
    try {
      const downloading = f
        .cache()
        .acquire(encoder, { grant: f.grant(encoder), owner: 'face:test' });
      await waitFor(() => f.log.some((row) => row.path === '/encoder'));
      const handle = service.requestFace(face('a'));
      await waitFor(() => f.log.some((row) => row.path === '/generator'));
      assert.deepEqual(
        governor.snapshot().permits,
        [],
        'the delayed network body holds no heavyweight permit',
      );
      await waitFor(() => fake.files.length === 1);
      fake.files[0]!.resolve(output(['a']));
      assert.equal((await handle.done).status, 'completed');
      await downloading;
      await waitFor(() => f.log.every((row) => row.end > 0));
      const g = f.log.find((row) => row.path === '/generator')!,
        e = f.log.find((row) => row.path === '/encoder')!;
      assert.ok(computeAt >= g.end && computeAt < e.end);
      assert.equal(f.log.length, 2);
      assert.ok(f.log.every((row) => !row.closedEarly));
      assert.deepEqual(governor.snapshot().permits, []);
      t.diagnostic(
        `real server: generator ${Math.round(g.end - g.start)}ms; synthesis at ${Math.round(computeAt - e.start)}ms; encoder ${Math.round(e.end - e.start)}ms`,
      );
    } finally {
      await service.dispose();
      await f.close();
    }
  });

test('cancelling a real cold transfer closes its socket without taking a permit or starting late compute', async () => {
  const f = await fixture(),
    fake = fakeBridge(),
    abort = new AbortController();
  const governor = createGovernor({
    policy: { memory: 'ample' },
    hooks: { releaseWarm() {}, terminateWorkers() {} },
  });
  const item = f.asset('/encoder');
  let computed = false;
  const service = createOperationService({
    governor,
    bridge: {
      ...fake.bridge,
      cancel: () => abort.abort(new DOMException('cancelled', 'AbortError')),
      async execute(_request, admission) {
        const gate = createExecutionGate(admission);
        try {
          await gate.read(() =>
            f
              .cache()
              .acquire(item, { grant: f.grant(item), owner: 'face:test', signal: abort.signal }),
          );
          return await gate.compute(async () => {
            computed = true;
            return output(['a']);
          });
        } finally {
          gate.close();
        }
      },
    },
  });
  try {
    const handle = service.requestFace(face('a'));
    await waitFor(() => f.log.length === 1);
    assert.deepEqual(governor.snapshot().permits, []);
    service.cancel({ slot: 'a' });
    assert.equal((await handle.done).status, 'cancelled');
    await waitFor(() => f.log[0]!.end > 0);
    assert.equal(f.log[0]!.closedEarly, true);
    assert.equal(computed, false);
    await flush();
    assert.deepEqual(governor.snapshot().permits, []);
  } finally {
    await service.dispose();
    await f.close();
  }
});
