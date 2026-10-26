// fm-d760: the confirmed-crop encode queue's ordering, single live encoder, per-slot cancel/retry, reference
// counting and events. Crops and derivations are real (createConfirmedCrop, deriveEncoderInput over decoded
// RGBA); the encoder here is a scripted LoadedEncoderCapability whose completions the test releases, so async
// completion order, overlap and late results can be forced. The real e4e runs in encode-queue-e4e.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CROP_PREPROCESSING_POLICY_V1,
  createConfirmedCrop,
  deriveEncoderInput,
  type EncodeRequest,
  type EncodeResult,
  type LoadedEncoderCapability,
  type SourcePixels,
} from '@facemorph/stylegan-js';
import {
  afterReload,
  createEncodeQueue,
  E4E_SESSIONS,
  LOST_AFTER_RELOAD,
  MAX_LIVE_ENCODERS,
  type EncodeQueueOptions,
  type QueuedCrop,
  type SlotEvent,
  type SlotId,
} from './encode-queue.ts';
import { createGovernor } from './scheduler.ts';

const source = (seed: number, size = 48): SourcePixels => {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + seed * 97) & 255;
  return { width: size, height: size, data };
};
let revision = 0;
const cropOn = (pixels: SourcePixels, left = 0, width = 32): QueuedCrop => ({
  source: pixels,
  crop: createConfirmedCrop({
    sourceRevision: ++revision,
    sourceDigest: (revision % 16).toString(16).repeat(64),
    rect: { left, top: 0, width, height: width },
    rotationDegrees: 0,
    exifOrientation: 1,
    exifApplied: false,
    policyVersion: CROP_PREPROCESSING_POLICY_V1.version,
    policyParams: CROP_PREPROCESSING_POLICY_V1,
  }),
});
const crops = (n: number) => Array.from({ length: n }, (_, i) => cropOn(source(i)));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** An encoder whose encodes settle when the test says, honouring (or ignoring) the abort signal. */
function scripted(o: { ignoreAbort?: boolean; autoMs?: (n: number) => number } = {}) {
  const calls: { request: EncodeRequest; resolve(): void; reject(e: unknown): void }[] = [];
  let live = 0,
    maxLive = 0;
  const encoder: LoadedEncoderCapability = {
    encode(request, signal, onTiming) {
      live++;
      maxLive = Math.max(maxLive, live);
      return new Promise<EncodeResult>((resolve, reject) => {
        let open = true;
        const done = (fn: () => void) => () => {
          if (!open) return;
          open = false;
          live--;
          fn();
        };
        const call = {
          request,
          resolve: done(() => {
            for (let i = 0; i < E4E_SESSIONS; i++)
              onTiming?.({
                ids: request.ids,
                operation: 'encode',
                stage: 'encoder-run',
                route: 'cpu',
                startedAtMs: 0,
                completedAtMs: 1,
                boundary: 'inference-complete',
              });
            resolve({
              ids: request.ids,
              confirmedCropId: request.confirmedCropId,
              wPlus: { space: 'w-plus', shape: [18, 512], values: new Float32Array(18 * 512) },
              provider: 'cpu',
              timings: {
                verifiedReadMs: 0,
                sessionCreateMs: 0,
                runMs: 0,
                totalMs: 0,
                wasmHeapBytes: 0,
                maxLiveSessions: 1,
              },
            });
          }),
          reject: done(() =>
            reject(Object.assign(new Error('scripted failure'), { kind: 'schedule' })),
          ),
        };
        calls.push(call);
        if (!o.ignoreAbort)
          signal?.addEventListener(
            'abort',
            done(() => reject(Object.assign(new Error('cancelled'), { kind: 'cancelled' }))),
          );
        if (o.autoMs) setTimeout(call.resolve, o.autoMs(calls.length));
      });
    },
    abort() {},
    async dispose() {},
  };
  return { encoder, calls, maxLive: () => maxLive };
}

function harness(
  options: Partial<EncodeQueueOptions> & { encoder: EncodeQueueOptions['encoder'] },
) {
  let derivations = 0;
  const queue = createEncodeQueue({
    derive: (s, c) => (derivations++, deriveEncoderInput(s, c)),
    ...options,
  });
  const events: SlotEvent[] = [];
  queue.subscribe((e) => events.push(e));
  const of = (type: SlotEvent['type']) =>
    events.filter((e) => e.type === type).map((e) => e.slotId);
  return { queue, events, of, derivations: () => derivations };
}
const settled = (h: ReturnType<typeof harness>, ids: readonly SlotId[]) =>
  ids.every((id) => h.queue.slots().find((s) => s.slotId === id)?.state === 'succeeded');

test('slots keep click order through async completion, with one live encoder', async () => {
  const s = scripted({ autoMs: (n) => [30, 1, 15][n - 1] ?? 1 });
  const h = harness({ encoder: s.encoder });
  const ids = h.queue.enqueueConfirmedCrops(7, crops(3));
  assert.deepEqual(h.of('slot.queued'), ids);
  await h.queue.idle();
  assert.deepEqual(h.of('slot.started'), ids);
  assert.deepEqual(h.of('slot.succeeded'), ids);
  assert.deepEqual(
    h.queue.slots().map((x) => [x.slotId, x.state, x.batchRevision]),
    ids.map((id) => [id, 'succeeded', 7]),
  );
  assert.equal(s.maxLive(), MAX_LIVE_ENCODERS);
  assert.equal(h.queue.inspect().maxLiveEncoders, 1);
  // Requests carry the frozen crop and the attempt identity.
  assert.deepEqual(
    s.calls.map((c) => [
      c.request.ids.requestId,
      c.request.ids.inputRevision,
      c.request.ids.attemptId,
    ]),
    ids.map((id) => [`${id}.a1`, 7, 1]),
  );
  for (const e of h.events)
    assert.ok(e.attemptId.startsWith(`${e.slotId}.a`) && e.batchRevision === 7);
  const progress = h.events.filter((e) => e.type === 'slot.progress' && e.slotId === ids[1]);
  const phases = progress.map((e) => (e.type === 'slot.progress' ? e.progress : null));
  assert.deepEqual(phases[0], { phase: 'prepare', shared: true, reused: true });
  assert.deepEqual(phases.at(-1), {
    phase: 'encode',
    completed: E4E_SESSIONS,
    total: E4E_SESSIONS,
  });
});

test('the shared preparation runs once and is reported inside each slot', async () => {
  const s = scripted({ autoMs: () => 1 });
  let loads = 0;
  const h = harness({
    encoder: async () => {
      loads++;
      await tick();
      return s.encoder;
    },
  });
  const ids = h.queue.enqueueConfirmedCrops(1, crops(3));
  await h.queue.idle();
  assert.equal(loads, 1);
  const prepare = h.events.flatMap((e) =>
    e.type === 'slot.progress' && e.progress.phase === 'prepare'
      ? [[e.slotId, e.progress.reused]]
      : [],
  );
  assert.deepEqual(prepare, [
    [ids[0], false],
    [ids[1], true],
    [ids[2], true],
  ]);
});

test('cancel of one queued slot leaves its siblings running in order and keeps its pixels', async () => {
  const s = scripted();
  const h = harness({ encoder: s.encoder });
  const ids = h.queue.enqueueConfirmedCrops(1, crops(3));
  await tick();
  assert.equal(h.queue.cancelSlot(ids[1]!), true);
  assert.deepEqual(h.of('slot.cancelled'), [ids[1]]);
  assert.equal(h.queue.pixelRefs(ids[1]!), 1, 'the source stays for Retry');
  while (!settled(h, [ids[0]!, ids[2]!])) {
    s.calls.at(-1)?.resolve();
    await tick();
  }
  assert.deepEqual(h.of('slot.started'), [ids[0], ids[2]]);
  assert.deepEqual(h.of('slot.succeeded'), [ids[0], ids[2]]);
  assert.equal(h.queue.slots()[1]!.state, 'cancelled');
  assert.equal(s.calls.length, 2);
});

test('cancel of the running slot waits for its encode to settle before the next starts', async () => {
  const s = scripted({ ignoreAbort: true });
  const h = harness({ encoder: s.encoder });
  const ids = h.queue.enqueueConfirmedCrops(1, crops(2));
  await tick();
  assert.equal(s.calls.length, 1);
  h.queue.cancelSlot(ids[0]!);
  await tick();
  assert.equal(s.calls.length, 1, 'no second encoder while the cancelled one is live');
  s.calls[0]!.resolve(); // late result
  await tick();
  assert.equal(s.calls.length, 2);
  s.calls[1]!.resolve();
  await h.queue.idle();
  assert.deepEqual(
    h.of('slot.succeeded'),
    [ids[1]],
    'the late result of the cancelled slot is discarded',
  );
  assert.equal(s.maxLive(), 1);
  assert.equal(h.queue.slots()[0]!.state, 'cancelled');
  assert.equal(h.queue.pixelRefs(ids[0]!), 1, 'derived input retained');
});

test('crop-queue.retry-reuses-derived-pixels: new attempt ID, same frozen crop, no second derivation or detector', async () => {
  const s = scripted();
  const h = harness({ encoder: s.encoder });
  const [a, b] = crops(2);
  const ids = h.queue.enqueueConfirmedCrops(3, [a!, b!]);
  await tick();
  s.calls[0]!.reject(null);
  await tick();
  const failed = h.events.find((e) => e.type === 'slot.failed');
  assert.ok(
    failed?.type === 'slot.failed' && failed.kind === 'schedule' && failed.slotId === ids[0],
  );
  assert.equal(h.queue.pixelRefs(ids[0]!), 1);
  const attempt = h.queue.retrySlot(ids[0]!);
  assert.equal(attempt, `${ids[0]}.a2`);
  s.calls[1]!.resolve();
  await tick();
  s.calls[2]!.resolve();
  await h.queue.idle();
  assert.deepEqual(
    s.calls.map((c) => c.request.ids.requestId),
    [`${ids[0]}.a1`, `${ids[1]}.a1`, `${ids[0]}.a2`],
    'the retry is appended after the pending sibling',
  );
  assert.equal(s.calls[2]!.request.confirmedCropId, a!.crop.confirmedCropId);
  assert.equal(s.calls[2]!.request.input, s.calls[0]!.request.input, 'the same derived tensor');
  assert.equal(h.derivations(), 2, 'one derivation per crop, none for the retry');
  assert.deepEqual(h.of('slot.succeeded'), [ids[1], ids[0]]);
  assert.equal(
    h.of('slot.succeeded').length,
    new Set(h.of('slot.succeeded')).size,
    'no duplicate results',
  );
  // Detector spy: the queue cannot reach a detector; it imports only the package contracts and the scheduler.
  const imports = [
    ...readFileSync(new URL('./encode-queue.ts', import.meta.url), 'utf8').matchAll(
      /from '([^']+)'/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(imports.sort(), [
    '../contracts/scheduler.ts',
    './scheduler.ts',
    '@facemorph/stylegan-js',
  ]);
});

test('crop-queue.no-pixels-no-retry: succeeded, underivable, removed, queued and running slots refuse Retry', async () => {
  const s = scripted();
  const h = harness({ encoder: s.encoder });
  const bad = cropOn(source(9), 40, 32); // outside the 48 px source
  const ids = h.queue.enqueueConfirmedCrops(1, [...crops(1), bad, ...crops(2)]);
  assert.equal(h.queue.retrySlot(ids[0]!), 'no-retained-pixels', 'queued');
  await tick();
  assert.equal(h.queue.retrySlot(ids[0]!), 'no-retained-pixels', 'running');
  s.calls[0]!.resolve();
  await tick();
  assert.equal(h.queue.slots()[0]!.state, 'succeeded');
  assert.equal(h.queue.pixelRefs(ids[0]!), 0, 'success releases retry inputs');
  assert.equal(h.queue.retrySlot(ids[0]!), 'no-retained-pixels', 'succeeded');
  const failed = h.events.find((e) => e.type === 'slot.failed');
  assert.ok(
    failed?.type === 'slot.failed' && failed.kind === 'derivation' && failed.slotId === ids[1],
  );
  assert.equal(h.queue.pixelRefs(ids[1]!), 0);
  assert.equal(h.queue.retrySlot(ids[1]!), 'no-retained-pixels', 'underivable');
  h.queue.cancelSlot(ids[3]!);
  h.queue.removeSlot(ids[3]!);
  assert.equal(h.queue.retrySlot(ids[3]!), 'no-retained-pixels', 'removed');
  s.calls[1]!.resolve();
  await h.queue.idle();
});

test('crop-queue.reload-drops-unfinished: only pixel-free snapshots survive, unfinished slots are lost', async () => {
  const s = scripted();
  const h = harness({ encoder: s.encoder });
  const ids = h.queue.enqueueConfirmedCrops(2, crops(4));
  await tick();
  s.calls[0]!.resolve();
  await tick();
  s.calls[1]!.reject(null);
  await tick();
  h.queue.cancelSlot(ids[3]!);
  // ids[2] is running, ids[3] cancelled, ids[1] failed, ids[0] succeeded.
  const stored = JSON.stringify(h.queue.slots());
  assert.ok(
    stored.length < 2000 && !/values|tensor|data/.test(stored),
    'no pixels or latents in the snapshot',
  );
  const reloaded = afterReload(JSON.parse(stored));
  assert.deepEqual(
    reloaded.map((r) => [r.slotId, r.state, r.retry, 'message' in r ? r.message : null]),
    [
      [ids[0], 'succeeded', false, null],
      [ids[1], 'lost', false, LOST_AFTER_RELOAD],
      [ids[2], 'lost', false, LOST_AFTER_RELOAD],
      [ids[3], 'lost', false, LOST_AFTER_RELOAD],
    ],
  );
  const fresh = createEncodeQueue({ encoder: s.encoder });
  for (const id of ids) assert.equal(fresh.retrySlot(id), 'no-retained-pixels');
  s.calls[2]!.resolve();
  await h.queue.idle();
});

test('crop-queue.no-persistence: a full lifecycle touches no OPFS, IndexedDB, sessionStorage or localStorage', async () => {
  const touched: string[] = [];
  const spy = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, key) => (touched.push(`${name}.${String(key)}`), () => undefined),
        set: (_, key) => (touched.push(`${name}.${String(key)}=`), true),
      },
    );
  const g = globalThis as Record<string, unknown>;
  const saved = ['localStorage', 'sessionStorage', 'indexedDB'].map(
    (k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const,
  );
  const nav = Object.getOwnPropertyDescriptor(g, 'navigator');
  for (const [k] of saved) Object.defineProperty(g, k, { value: spy(k), configurable: true });
  Object.defineProperty(g, 'navigator', {
    value: { storage: spy('navigator.storage') },
    configurable: true,
  });
  try {
    const s = scripted({ autoMs: () => 1 });
    const h = harness({ encoder: s.encoder });
    const ids = h.queue.enqueueConfirmedCrops(1, crops(4));
    h.queue.cancelSlot(ids[1]!);
    h.queue.retrySlot(ids[1]!);
    h.queue.replaceSlot(ids[2]!, cropOn(source(5)));
    await h.queue.idle();
    h.queue.removeSlot(ids[0]!);
    h.queue.disposeBatch(1);
    afterReload(h.queue.slots());
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
    if (nav) Object.defineProperty(g, 'navigator', nav);
  }
  assert.deepEqual(touched, []);
  const text = readFileSync(new URL('./encode-queue.ts', import.meta.url), 'utf8').replace(
    /\/\/.*$/gm,
    '',
  );
  assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|getDirectory|navigator/);
});

test('remove, replace and disposeBatch release pixels and discard late results by revision', async () => {
  const s = scripted({ ignoreAbort: true });
  const h = harness({ encoder: s.encoder });
  const shared = source(1);
  const ids = h.queue.enqueueConfirmedCrops(4, [
    cropOn(shared, 0),
    cropOn(shared, 16),
    ...crops(2),
  ]);
  assert.equal(h.queue.sourceRefs(shared), 2, 'two crops of one file share its decoded pixels');
  await tick();
  assert.equal(
    h.queue.sourceRefs(shared),
    1,
    'the running slot derived its input and dropped the source',
  );
  // Replace the running slot: same slot and position, new crop, old result discarded.
  const replacement = cropOn(source(3));
  assert.equal(h.queue.replaceSlot(ids[0]!, replacement), `${ids[0]}.a2`);
  assert.equal(h.queue.pixelRefs(ids[0]!), 1);
  // Remove a queued slot: its share of the source is released.
  h.queue.removeSlot(ids[1]!);
  assert.equal(h.queue.pixelRefs(ids[1]!), 0);
  assert.equal(h.queue.sourceRefs(shared), 0);
  s.calls[0]!.resolve();
  await tick();
  assert.equal(h.of('slot.succeeded').length, 0);
  while (s.calls.length < 4 || h.queue.inspect().running) {
    s.calls.at(-1)!.resolve();
    await tick();
  }
  await h.queue.idle();
  assert.deepEqual(
    s.calls.map((c) => c.request.ids.requestId),
    [`${ids[0]}.a1`, `${ids[2]}.a1`, `${ids[3]}.a1`, `${ids[0]}.a2`],
  );
  assert.equal(h.queue.result(ids[0]!)!.confirmedCropId, replacement.crop.confirmedCropId);
  assert.deepEqual(
    h.queue.slots().map((x) => x.slotId),
    [ids[0], ids[2], ids[3]],
    'position kept',
  );
  assert.equal(h.queue.disposeBatch(4), 3);
  assert.deepEqual(h.queue.slots(), []);
  assert.equal(h.queue.inspect().sources, 0);
  assert.equal(s.maxLive(), 1);
});

test('a governor permit is held for each attempt and released after it', async () => {
  const s = scripted({ autoMs: () => 2 });
  const governor = createGovernor({
    policy: { memory: 'constrained' },
    hooks: { releaseWarm() {}, terminateWorkers() {} },
  });
  const permits: number[] = [];
  const h = harness({ encoder: s.encoder, governor, residentBytes: 1 });
  h.queue.subscribe((e) => {
    if (e.type === 'slot.progress' && e.progress.phase === 'encode')
      permits.push(governor.snapshot().permits.length);
  });
  const ids = h.queue.enqueueConfirmedCrops(1, crops(3));
  await tick();
  h.queue.cancelSlot(ids[1]!);
  await h.queue.idle();
  await tick();
  assert.ok(permits.length > 0 && permits.every((n) => n === 1));
  assert.deepEqual(h.of('slot.succeeded'), [ids[0], ids[2]]);
  assert.equal(governor.snapshot().permits.length, 0);
});

for (const n of [1, 2, 3, 8, 30])
  test(`queue at ${n} crop(s): order, a single live encoder and every pixel released`, async () => {
    const s = scripted({ autoMs: (i) => (i * 7) % 5 });
    const h = harness({ encoder: s.encoder });
    const ids = h.queue.enqueueConfirmedCrops(n, crops(n));
    assert.equal(h.queue.inspect().sources, n);
    await h.queue.idle();
    assert.deepEqual(h.of('slot.started'), ids);
    assert.deepEqual(h.of('slot.succeeded'), ids);
    assert.equal(s.maxLive(), 1);
    assert.equal(h.queue.inspect().maxLiveEncoders, 1);
    assert.equal(h.derivations(), n);
    for (const id of ids) assert.equal(h.queue.pixelRefs(id), 0);
    assert.equal(h.queue.inspect().sources, 0);
    const released = h.events.filter((e) => e.type === 'slot.released');
    assert.equal(released.length, 2 * n, 'source then derived input, once each');
  });
