// fm-d760 with the real CPU e4e through the package: the streamed 108-shard encoder (loadStreamedEncoder) on
// onnxruntime-web's one-thread WASM backend, read through the verifying local reader over the acquired runtime.
// Sources are real decoded RGBA pixels: the qualification cases' 8-bit images (recovered exactly from their
// [-1, 1] input tensors) placed in larger photos, confirmed as crops and derived by deriveEncoderInput, so each
// W+ is checked against the native reference at its 0.0001 threshold. fetch throws for the whole test.
// Where the pinned runtime is not acquired (scripts/runtime/acquire.mjs), the test reports untested.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as onnx from 'onnxruntime-web';
import {
  CROP_PREPROCESSING_POLICY_V1,
  createConfirmedCrop,
  deriveEncoderInput,
  type SourcePixels,
} from '@facemorph/stylegan-js';
import {
  loadStreamedEncoder,
  maxWPlusError,
  type EncoderOrt,
  type EncoderStreamManifest,
} from '@facemorph/stylegan-js/engine';
import {
  acquiredManifest,
  RUNTIME,
  runtimeReader,
  UNTESTED,
} from '../../../../packages/stylegan-js/test/engine/support/runtime.ts';
import { createEncodeQueue, type QueuedCrop, type SlotEvent, type SlotId } from './encode-queue.ts';

const runtime = acquiredManifest();
const stream = runtime?.manifest['encoderStream'] as { url: string } | undefined;
const DIR = stream ? join(RUNTIME, stream.url.split('/runtime/')[1]!, '..') : '';
const SKIP = !runtime || !existsSync(join(DIR, 'manifest.json')) ? UNTESTED : false;
onnx.env.wasm.numThreads = 1;

const N = 256;
const f32 = (name: string) => {
  const b = readFileSync(join(DIR, name));
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
/** A photo holding qualification images at the given offsets, everything else mid-grey. */
function photo(
  width: number,
  height: number,
  cases: readonly [id: string, left: number, top: number][],
): SourcePixels {
  const data = new Uint8Array(width * height * 4).fill(128);
  for (const [id, left, top] of cases) {
    const t = f32(`${id}.input.f32`);
    for (let i = 0; i < N * N; i++) {
      const at = ((top + Math.floor(i / N)) * width + left + (i % N)) * 4;
      for (let c = 0; c < 3; c++) data[at + c] = Math.round((t[c * N * N + i]! * 0.5 + 0.5) * 255);
      data[at + 3] = 255;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}
let revision = 0;
const crop = (source: SourcePixels, id: string, left: number, top: number) => ({
  id,
  queued: {
    source,
    crop: createConfirmedCrop({
      sourceRevision: ++revision,
      sourceDigest: revision.toString(16).padStart(64, '0'),
      rect: { left, top, width: N, height: N },
      rotationDegrees: 0,
      exifOrientation: 1,
      exifApplied: false,
      policyVersion: CROP_PREPROCESSING_POLICY_V1.version,
      policyParams: CROP_PREPROCESSING_POLICY_V1,
    }),
  } satisfies QueuedCrop,
});

function setup() {
  const manifest = JSON.parse(
    readFileSync(join(DIR, 'manifest.json'), 'utf8'),
  ) as EncoderStreamManifest;
  const encoder = loadStreamedEncoder({
    manifest,
    reader: runtimeReader(RUNTIME),
    ort: onnx as unknown as EncoderOrt,
  });
  let derivations = 0;
  const queue = createEncodeQueue({
    encoder,
    derive: (s, c) => (derivations++, deriveEncoderInput(s, c)),
  });
  const events: SlotEvent[] = [];
  queue.subscribe((e) => events.push(e));
  const of = (type: SlotEvent['type']) =>
    events.filter((e) => e.type === type).map((e) => e.attemptId);
  const error = (slot: SlotId, id: string) =>
    maxWPlusError(queue.result(slot)!.wPlus.values, readFileSync(join(DIR, `${id}.w.f32`)));
  return { encoder, queue, events, of, error, derivations: () => derivations };
}
async function offline<T>(fn: () => Promise<T>): Promise<{ value: T; fetches: number }> {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => (
    fetches++,
    Promise.reject(Error('the queue must not fetch'))
  )) as typeof fetch;
  try {
    return { value: await fn(), fetches };
  } finally {
    globalThis.fetch = original;
  }
}

test(
  'real e4e: A1, B2, A2 keep click order, run serially (one live encoder) and meet W+ <= 0.0001',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    const a = photo(532, 276, [
      ['seed-0-aligned', 10, 10],
      ['seed-1-aligned', 266, 10],
    ]);
    const b = photo(300, 300, [['no-face-aligned', 30, 20]]);
    const list = [
      crop(a, 'seed-0-aligned', 10, 10),
      crop(b, 'no-face-aligned', 30, 20),
      crop(a, 'seed-1-aligned', 266, 10),
    ];
    const h = setup();
    const { fetches, value: ids } = await offline(async () => {
      const ids = h.queue.enqueueConfirmedCrops(
        1,
        list.map((c) => c.queued),
      );
      assert.equal(h.queue.sourceRefs(a), 2);
      await h.queue.idle();
      return ids;
    });
    assert.equal(fetches, 0);
    assert.deepEqual(
      h.of('slot.started'),
      ids.map((id) => `${id}.a1`),
    );
    assert.deepEqual(
      h.of('slot.succeeded'),
      ids.map((id) => `${id}.a1`),
    );
    // Serial: each slot started only after the previous one succeeded.
    const seq = h.events
      .filter((e) => e.type === 'slot.started' || e.type === 'slot.succeeded')
      .map((e) => `${e.type}:${e.slotId}`);
    assert.deepEqual(
      seq,
      ids.flatMap((id) => [`slot.started:${id}`, `slot.succeeded:${id}`]),
    );
    assert.equal(h.queue.inspect().maxLiveEncoders, 1);
    assert.deepEqual(
      [h.encoder.inspect().maxLiveSessions, h.encoder.inspect().liveSessions],
      [1, 0],
    );
    list.forEach((c, i) => {
      const error = h.error(ids[i]!, c.id);
      t.diagnostic(`${ids[i]} ${c.id}: max |W+ error| ${error.toExponential(2)}`);
      assert.ok(error <= 0.0001, `${c.id}: ${error}`);
      assert.equal(h.queue.result(ids[i]!)!.confirmedCropId, c.queued.crop.confirmedCropId);
      assert.equal(h.queue.pixelRefs(ids[i]!), 0);
    });
    assert.equal(h.queue.inspect().sources, 0);
    await h.encoder.dispose();
  },
);

test(
  'real e4e: cancel running and queued slots, siblings continue in order, retry reuses the frozen crop, remove releases',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    const p = photo(532, 532, [
      ['seed-0-unaligned', 0, 0],
      ['seed-1-unaligned', 276, 0],
      ['seed-0-aligned', 0, 276],
      ['no-face-aligned', 276, 276],
    ]);
    const list = [
      crop(p, 'seed-0-unaligned', 0, 0),
      crop(p, 'seed-1-unaligned', 276, 0),
      crop(p, 'seed-0-aligned', 0, 276),
      crop(p, 'no-face-aligned', 276, 276),
    ];
    const h = setup();
    const { fetches } = await offline(async () => {
      const [x, y, z, w] = h.queue.enqueueConfirmedCrops(
        2,
        list.map((c) => c.queued),
      );
      // On X's fourth session: cancel X (running) and Y (queued); remove W (queued).
      const stop = h.queue.subscribe((e) => {
        if (
          e.type !== 'slot.progress' ||
          e.slotId !== x ||
          e.progress.phase !== 'encode' ||
          e.progress.completed !== 4
        )
          return;
        stop();
        assert.equal(h.queue.cancelSlot(x!), true);
        assert.equal(h.queue.cancelSlot(y!), true);
        assert.equal(h.queue.pixelRefs(w!), 1);
        h.queue.removeSlot(w!);
        assert.equal(h.queue.pixelRefs(w!), 0);
      });
      await h.queue.idle();
      assert.deepEqual(
        h.of('slot.started'),
        [`${x}.a1`, `${z}.a1`],
        'Z ran after the cancelled X, in order',
      );
      assert.deepEqual(h.of('slot.succeeded'), [`${z}.a1`]);
      assert.deepEqual(h.of('slot.cancelled'), [`${x}.a1`, `${y}.a1`]);
      assert.equal(h.encoder.inspect().liveSessions, 0);
      assert.equal(h.derivations(), 2, 'X and Z derived; Y never started');
      assert.equal(h.queue.pixelRefs(x!), 1, 'X keeps its derived input');
      assert.equal(h.queue.pixelRefs(y!), 1, 'Y keeps its source');
      assert.equal(h.queue.retrySlot(x!), `${x}.a2`);
      assert.equal(h.queue.retrySlot(y!), `${y}.a2`);
      assert.equal(h.queue.retrySlot(w!), 'no-retained-pixels');
      await h.queue.idle();
      assert.equal(h.derivations(), 3, "X's retry reused its derived input; Y derived once");
      assert.deepEqual(h.of('slot.succeeded'), [`${z}.a1`, `${x}.a2`, `${y}.a2`]);
      for (const [slot, c] of [
        [x, list[0]!],
        [y, list[1]!],
        [z, list[2]!],
      ] as const) {
        const error = h.error(slot!, c.id);
        t.diagnostic(`${slot} ${c.id}: max |W+ error| ${error.toExponential(2)}`);
        assert.ok(error <= 0.0001, `${c.id}: ${error}`);
        assert.equal(
          h.queue.result(slot!)!.confirmedCropId,
          c.queued.crop.confirmedCropId,
          'same frozen crop',
        );
        assert.equal(h.queue.pixelRefs(slot!), 0);
      }
      assert.deepEqual(
        h.queue.slots().map((s) => s.slotId),
        [x, y, z],
        'click order kept; no duplicates',
      );
      assert.equal(h.queue.inspect().sources, 0);
    });
    assert.equal(fetches, 0);
    assert.deepEqual(
      [h.queue.inspect().maxLiveEncoders, h.encoder.inspect().maxLiveSessions],
      [1, 1],
    );
    await h.encoder.dispose();
  },
);
