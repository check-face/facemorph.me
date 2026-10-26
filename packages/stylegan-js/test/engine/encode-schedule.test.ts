// Max live sessions and teardown against the control (fm-qjcs): the candidate's own executeEncoderStream
// (apps/web/photo-runtime/encoder-stream/execute.mjs, imported unchanged from classic a42829b) and the package's
// streamed encoder each run the real 108 shards on the same onnxruntime-web WASM build, one thread, through a
// recording wrapper over that ORT. Every session create, run, tensor dispose and release is logged in order: both
// must produce the identical event sequence, hold at most one live session, and give bit-identical W+. A cancel after
// the fourth run must tear down identically too: the running session's tensors and session released, no fifth create.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as onnx from 'onnxruntime-web';
import type { EncodeRequest } from '../../src/contracts/operations.ts';
import {
  EncoderUnavailable,
  loadStreamedEncoder,
  type EncoderOrt,
  type EncoderStreamManifest,
} from '../../src/engine/encode.ts';
import { floats } from '../../src/engine/reader.ts';
import { acquiredManifest, pathOf, RUNTIME, runtimeReader, UNTESTED } from './support/runtime.ts';

const runtime = acquiredManifest();
const stream = runtime?.manifest['encoderStream'] as { url: string } | undefined;
const DIR = stream ? join(RUNTIME, stream.url.split('/runtime/')[1]!, '..') : '';
const SKIP = !runtime || !existsSync(join(DIR, 'manifest.json')) ? UNTESTED : false;
const manifest = (): EncoderStreamManifest =>
  JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

onnx.env.wasm.numThreads = 1;
const base = onnx as unknown as EncoderOrt;

type Step = EncoderStreamManifest['steps'][number];
const CONTROL = '../../../../apps/web/photo-runtime/encoder-stream/execute.mjs';
const control = (await import(CONTROL)) as {
  executeEncoderStream(o: {
    ort: unknown;
    manifest: EncoderStreamManifest;
    tensor: Float32Array;
    acquireBytes(step: Step): Promise<Uint8Array>;
    snapshotMemory(stage: string): { available: boolean; shared: boolean; currentBytes: number };
    onProgress?(event: { stage: string }): void;
    signal?: AbortSignal;
  }): Promise<{ values: Float32Array; encoderStats: { maxLiveSessions: number } }>;
};

/** The ORT surface both encoders see, logging each lifecycle event in order and the live-session count. */
function recording() {
  const events: string[] = [];
  let live = 0,
    max = 0,
    created = 0;
  const tracked = <T extends { dispose(): void }>(label: string, value: T): T => {
    const dispose = value.dispose.bind(value);
    value.dispose = () => {
      events.push(`dispose:${label}`);
      dispose();
    };
    return value;
  };
  const ort = {
    Tensor: class {
      constructor(type: string, data: never, dims: readonly number[]) {
        return tracked('feed', new base.Tensor(type, data, dims));
      }
    },
    InferenceSession: {
      async create(model: Uint8Array, options: object) {
        const session = await base.InferenceSession.create(model, options);
        const n = created++;
        live++;
        max = Math.max(max, live);
        events.push(`create:${n}:${JSON.stringify(options)}`);
        return {
          async run(feeds: Record<string, unknown>) {
            events.push(`run:${n}:${Object.keys(feeds).sort().join(',')}`);
            const out = await session.run(feeds);
            for (const value of Object.values(out)) if (value) tracked('output', value);
            return out;
          },
          async release() {
            events.push(`release:${n}`);
            live--;
            await session.release();
          },
        };
      },
    },
  } as unknown as EncoderOrt;
  return { ort, events, max: () => max, live: () => live };
}

const shard = (step: Step) => {
  const bytes = new Uint8Array(readFileSync(join(DIR, step.file)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), step.sha256);
  return bytes;
};
// The control demands a verified unshared heap figure; the run's own accounting is not what is compared here.
const heap = () => ({ available: true, shared: false, currentBytes: 64 * 1024 * 1024 });
function request(input: Float32Array): EncodeRequest {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return {
    ids: { requestId: 'schedule', inputRevision: 1, attemptId: 0 },
    input: {
      tensor: input,
      tensorDigest: createHash('sha256').update(bytes).digest('hex'),
      policyVersion: 'crop-preprocessing-v1',
    },
    confirmedCropId: 'c'.repeat(64),
  };
}
const input = (m: EncoderStreamManifest) =>
  new Float32Array(floats(readFileSync(pathOf(m.canaries[0]!.input, RUNTIME))).slice());

test(
  'max live sessions 1 and the create/run/dispose/release sequence equal the control, with bit-identical W+',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    const m = manifest();
    const a = recording();
    const reference = await control.executeEncoderStream({
      ort: a.ort,
      manifest: m,
      tensor: input(m),
      acquireBytes: async (step) => shard(step),
      snapshotMemory: heap,
    });
    const b = recording();
    const encoder = loadStreamedEncoder({
      manifest: m,
      reader: runtimeReader(RUNTIME),
      ort: b.ort,
    });
    const out = await encoder.encode(request(input(m)));
    t.diagnostic(`${a.events.length} control events, ${b.events.length} package events`);
    assert.equal(a.events.filter((e) => e.startsWith('create:')).length, 108);
    assert.deepEqual(b.events, a.events);
    assert.deepEqual([a.max(), b.max(), reference.encoderStats.maxLiveSessions], [1, 1, 1]);
    assert.deepEqual([a.live(), b.live()], [0, 0]);
    assert.deepEqual(Array.from(out.wPlus.values), Array.from(reference.values));
    await encoder.dispose();
  },
);

test(
  'a cancel after the fourth run tears down exactly as the control does',
  { skip: SKIP, timeout: 600_000 },
  async () => {
    const m = manifest();
    // Cancel both at the same point: the moment the fourth session's run is logged.
    const cancelAt = (rec: ReturnType<typeof recording>, cancel: () => void) => {
      const push = rec.events.push.bind(rec.events);
      rec.events.push = (...items: string[]) => {
        const n = push(...items);
        if (items.some((e) => e.startsWith('run:3:'))) cancel();
        return n;
      };
    };
    const c = recording();
    const stopC = new AbortController();
    cancelAt(c, () => stopC.abort());
    const cancelled = await control
      .executeEncoderStream({
        ort: c.ort,
        manifest: m,
        tensor: input(m),
        acquireBytes: async (step) => shard(step),
        snapshotMemory: heap,
        signal: stopC.signal,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    assert.ok(
      cancelled instanceof Error && /cancel|abort/i.test(String(cancelled)),
      String(cancelled),
    );
    const p = recording();
    const stopP = new AbortController();
    cancelAt(p, () => stopP.abort());
    const encoder = loadStreamedEncoder({
      manifest: m,
      reader: runtimeReader(RUNTIME),
      ort: p.ort,
    });
    const error = await encoder.encode(request(input(m)), stopP.signal).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof EncoderUnavailable && error.kind === 'cancelled', String(error));
    assert.deepEqual([...p.events], [...c.events]);
    assert.equal(c.events.filter((e) => e.startsWith('create:')).length, 4);
    assert.equal(c.events.at(-1), 'release:3');
    assert.deepEqual([c.live(), p.live(), c.max(), p.max()], [0, 0, 1, 1]);
    await encoder.dispose();
  },
);
