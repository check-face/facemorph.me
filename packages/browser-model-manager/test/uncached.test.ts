// Explicit one-asset acquisition (fm-fy2.13): the transport still enforces pins,
// grants, cancellation and aggregate chunk slots without consulting durable storage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { grantRemaining, GrantRefused } from '../src/acquisition/grants.ts';
import {
  acquireUncachedBytes,
  createModelCache,
  type AssetInput,
  type CacheEvent,
  type Fetcher,
} from '../src/cache/model-cache.ts';
import type { AcquisitionSlots } from '../src/acquisition/slots.ts';
import type { AcquisitionGrant } from '../src/contracts/grant.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const descriptor = (bytes: Uint8Array, name = 'asset'): AssetInput => ({
  sha256: sha(bytes),
  size: bytes.length,
  url: `https://model.example/${name}`,
});
const owner = 'face:uncached' as const;
const approval = (asset: AssetInput, bytes = asset.size): AcquisitionGrant => ({
  manifestSha256: 'manifest',
  route: 'cpu',
  purpose: 'generate',
  assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
  owners: [owner],
  remainingBytes: bytes,
});
const payload = Uint8Array.from({ length: 1234 }, (_, i) => i % 251);
const asset = descriptor(payload);

test('uncached acquisition refuses absent/out-of-scope/insufficient approval before requests', async () => {
  let requests = 0;
  const fetcher: Fetcher = async () => {
    requests++;
    return new Response(payload);
  };
  for (const grant of [
    undefined,
    approval({ ...asset, sha256: 'f'.repeat(64) }),
    approval(asset, 1),
  ]) {
    await assert.rejects(
      acquireUncachedBytes(asset, { grant: grant!, owner }, { fetcher, slots: null }),
      GrantRefused,
    );
  }
  assert.equal(requests, 0);
});

test('one verified asset is returned without consulting either persistent backend', async () => {
  const cachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
  const forbidden = () => {
    assert.fail('uncached acquisition consulted persistent storage');
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, get: forbidden });
  Object.defineProperty(navigator, 'storage', { configurable: true, get: forbidden });
  const grant = approval(asset);
  try {
    const out = await acquireUncachedBytes(
      asset,
      { grant, owner },
      {
        fetcher: async () => new Response(payload),
      },
    );
    assert.deepEqual(out, payload);
    assert.equal(grantRemaining(grant), 0);
  } finally {
    if (cachesDescriptor) Object.defineProperty(globalThis, 'caches', cachesDescriptor);
    else Reflect.deleteProperty(globalThis, 'caches');
    if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
    else Reflect.deleteProperty(navigator, 'storage');
  }
});

test('chunks are fetched sequentially under slots and both chunk and parent pins are enforced', async (t) => {
  const parts = [payload.slice(0, 600), payload.slice(600)];
  const digestSizes: number[] = [];
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(
    crypto.subtle,
    'digest',
    async (...[algorithm, input]: Parameters<typeof digest>) => {
      digestSizes.push(input.byteLength);
      return digest(algorithm, input);
    },
  );
  const chunks = parts.map((part, i) => descriptor(part, `part-${i}`));
  const input = { ...asset, chunks };
  let held = 0;
  let peak = 0;
  let releases = 0;
  const requests: string[] = [];
  const events: CacheEvent[] = [];
  const slots: AcquisitionSlots = {
    count: 1,
    async take() {
      assert.equal(held, 0);
      peak = Math.max(peak, ++held);
      return () => {
        held--;
        releases++;
      };
    },
  };
  const fetcher: Fetcher = async (url) => {
    assert.equal(held, 1);
    requests.push(url);
    return new Response(parts[chunks.findIndex((part) => part.url === url)]!);
  };
  const out = await acquireUncachedBytes(
    input,
    { grant: approval(input), owner },
    {
      fetcher,
      slots,
      report: (event) => events.push(event),
    },
  );
  assert.deepEqual(out, payload);
  assert.deepEqual(
    requests,
    chunks.map((part) => part.url),
  );
  assert.equal(peak, 1);
  assert.equal(held, 0);
  assert.equal(releases, 2);
  assert.ok(digestSizes.length > 0);
  assert.ok(
    digestSizes.every((size) => size <= Math.max(...parts.map((part) => part.length))),
    'platform hashing receives only a chunk, never the full parent buffer',
  );
  assert.deepEqual(
    events.filter((event) => event.status === 'progress').map((event) => event['loaded']),
    [600, 1234],
  );
  const wrongParent = { ...input, sha256: 'f'.repeat(64) };
  await assert.rejects(
    acquireUncachedBytes(
      wrongParent,
      { grant: approval(wrongParent), owner },
      {
        fetcher,
        slots,
      },
    ),
    /integrity mismatch/,
  );
  assert.equal(held, 0);
});

test('corrupt or short responses reject; received bytes remain spent', async () => {
  for (const response of [new Uint8Array(payload.length), payload.slice(1)]) {
    const grant = approval(asset);
    await assert.rejects(
      acquireUncachedBytes(
        asset,
        { grant, owner },
        {
          slots: null,
          fetcher: async () => new Response(response),
        },
      ),
      /integrity mismatch/,
    );
    assert.equal(grantRemaining(grant), payload.length - response.length);
  }
});

test('cancellation stops body I/O and releases the occupied slot', async () => {
  const stop = new AbortController();
  const reason = new DOMException('visitor cancelled', 'AbortError');
  let released = 0;
  let attemptSignal: AbortSignal | undefined;
  let fetched!: () => void;
  const started = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const operation = acquireUncachedBytes(
    asset,
    { grant: approval(asset), owner, signal: stop.signal },
    {
      slots: {
        count: 1,
        take: async () => () => {
          released++;
        },
      },
      fetcher: async (_url, options) => {
        attemptSignal = options.signal!;
        fetched();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              options.signal!.addEventListener(
                'abort',
                () => controller.error(options.signal!.reason),
                { once: true },
              );
            },
          }),
        );
      },
    },
  );
  await started;
  stop.abort(reason);
  await assert.rejects(operation, (error) => error === reason);
  assert.equal(released, 1);
  assert.equal(attemptSignal?.aborted, true);
  assert.equal(attemptSignal?.reason, reason);
});

test('native Web Locks denial uses a shared one-slot realm budget', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async () => {
        throw new DOMException('opaque origin', 'SecurityError');
      },
    },
  });
  let active = 0;
  let peak = 0;
  try {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        acquireUncachedBytes(
          asset,
          { grant: approval(asset), owner },
          {
            fetcher: async () => {
              peak = Math.max(peak, ++active);
              await new Promise((resolve) => setTimeout(resolve, 5));
              active--;
              return new Response(payload);
            },
          },
        ),
      ),
    );
    assert.equal(peak, 1);
    for (const result of results) assert.deepEqual(result, payload);
  } finally {
    if (original) Object.defineProperty(navigator, 'locks', original);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});

test('transient primary failures alternate to the mirror and preserve grant accounting', async () => {
  const requests: string[] = [];
  const grant = approval(asset);
  const out = await acquireUncachedBytes(
    asset,
    { grant, owner },
    {
      slots: null,
      retryDelaysMs: [0],
      alternateOrigins: ['https://mirror.example'],
      fetcher: async (url) => {
        requests.push(url);
        return url.startsWith('https://mirror.example')
          ? new Response(payload)
          : new Response(null, { status: 500 });
      },
    },
  );
  assert.deepEqual(out, payload);
  assert.deepEqual(requests, [asset.url, 'https://mirror.example/asset']);
  assert.equal(grantRemaining(grant), 0);
});

test('a genuinely silent body settles at the stall bound and releases its slot', async () => {
  let released = 0;
  let cancelled = false;
  await assert.rejects(
    acquireUncachedBytes(
      asset,
      { grant: approval(asset), owner },
      {
        slots: {
          count: 1,
          take: async () => () => {
            released++;
          },
        },
        stallMs: 15,
        retryDelaysMs: [],
        fetcher: async (_url, options) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                options.signal!.addEventListener(
                  'abort',
                  () => {
                    cancelled = true;
                    controller.error(options.signal!.reason);
                  },
                  { once: true },
                );
              },
            }),
          ),
      },
    ),
    (error) => (error as { stalled?: boolean }).stalled === true,
  );
  assert.equal(released, 1);
  assert.equal(cancelled, true);
});

test('a failed persistent write never replenishes the grant for an uncached retry', async () => {
  const grant = approval(asset);
  let requests = 0;
  const fetcher: Fetcher = async () => {
    requests++;
    return new Response(payload);
  };
  const cache = createModelCache({
    fetcher,
    store: {
      get: async () => undefined,
      remove: async () => {},
      put: async (_hash, response) => {
        await response.arrayBuffer();
        throw new DOMException('native quota exhausted', 'QuotaExceededError');
      },
    },
  });
  await assert.rejects(cache.acquire(asset, { grant, owner }), { name: 'QuotaExceededError' });
  assert.equal(grantRemaining(grant), 0);
  await assert.rejects(
    acquireUncachedBytes(asset, { grant, owner }, { fetcher, slots: null }),
    GrantRefused,
  );
  assert.equal(requests, 1);
});
