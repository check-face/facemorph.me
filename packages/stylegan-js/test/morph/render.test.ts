// renderMorph's orchestration (fm-suaa) on plain values: the real latent geometry and canonical order, with a frame
// source, writer and frame store kept in memory so each branch, the ordered drain, cancellation and writer failure
// are observable. Real pixels and the control comparison are the browser harness's job (render-browsers.test.ts).
import assert from 'node:assert/strict';
import test from 'node:test';
import { infillFrames } from '../../src/morph/infill.ts';
import { createLatentPath, type MorphPathSpec } from '../../src/morph/latent-path.ts';
import {
  renderMorph,
  selectBranch,
  type MorphFrame,
  type MorphFrameSource,
  type MorphFrameStore,
  type MorphImage,
  type MorphLatent,
  type MorphWriter,
} from '../../src/morph/render.ts';
import { FFHQ_1024_DESCRIPTOR } from '../../src/contracts/descriptor.ts';

const W = 18 * 512;
const latent = (k: number) => Float32Array.from({ length: W }, (_, i) => Math.sin(i * 0.001 + k));
function morph(faces = 2, framesPerSegment = 8): MorphPathSpec {
  return {
    algorithmVersion: 'latent-path-v1',
    kind: 'linear',
    closed: false,
    pinchCenter: false,
    width: 0,
    framesPerSegment,
    framesPerSecond: 16,
    controls: Array.from({ length: faces }, (_, i) => ({
      visitId: `face-${i}`,
      latent: { space: 'w-plus', shape: [18, 512], values: latent(i) },
    })),
  };
}
const image = (tag: string): MorphImage & { tag: string } => ({ size: 1, type: 'image/png', tag });

/** A source whose frames are tagged by the latent's first value, so order and identity are checkable. */
function source(o: { raw?: boolean; batch?: boolean; onSynth?: (n: number) => void } = {}) {
  let n = 0;
  const frame = (l: MorphLatent): MorphFrame => {
    n++;
    o.onSynth?.(n);
    return o.raw
      ? { rgba: new Float32Array([l.values[0]!]).buffer }
      : { blob: image(`v${l.values[0]}`) };
  };
  const s: MorphFrameSource & { count(): number } = {
    count: () => n,
    synthesize: async (l) => frame(l),
    ...(o.batch === false
      ? {}
      : {
          async synthesizeFrames(latents, options) {
            for (let at = 0; at < latents.length; at++) {
              if (options.signal.aborted) throw new DOMException('cancelled', 'AbortError');
              // A worker waits for the caller before reusing its buffer: the drain must not wait on it in turn.
              await options.onFrame(at, frame(latents[at]!));
            }
          },
        }),
  };
  return s;
}

/** An in-memory store with the morph-frames.mjs rule: get() answers only for a complete set. */
function store(total: number) {
  const frames = new Map<number, MorphImage>();
  const s: MorphFrameStore & { frames: typeof frames } = {
    frames,
    get: async () =>
      frames.size === total
        ? [...frames.keys()].sort((a, b) => a - b).map((i) => frames.get(i)!)
        : null,
    getOne: async (_key, index) => frames.get(index) ?? null,
  };
  return s;
}

function writer(
  o: {
    raw?: boolean;
    retain?: boolean;
    store?: ReturnType<typeof store>;
    failFinish?: boolean;
    onAdd?: (i: number) => void;
    finish?: () => Promise<void>;
  } = {},
) {
  const added: number[] = [];
  let disposed = 0;
  const keep = (index: number, blob: MorphImage) => {
    o.store?.frames.set(index, blob);
    return `display-${index}`;
  };
  const toImage = (f: MorphFrame) => f.blob ?? image(`raw${new Float32Array(f.rgba!)[0]}`);
  const w: MorphWriter<string> & { added: number[]; disposed(): number } = {
    added,
    disposed: () => disposed,
    add: async (_blob, index) => {
      added.push(index);
      o.onAdd?.(index);
    },
    ...(o.raw
      ? {
          addRaw: async (f: MorphFrame, index: number) => {
            added.push(index);
            o.onAdd?.(index);
            return keep(index, toImage(f));
          },
          retainRaw: async (f: MorphFrame, index: number) => keep(index, toImage(f)),
        }
      : {}),
    ...(o.retain || o.raw
      ? { retain: async (blob: MorphImage, index: number) => keep(index, blob) }
      : {}),
    finish: async () => {
      await o.finish?.();
      if (o.failFinish) throw Error('muxer refused');
      return image('video');
    },
    dispose: () => {
      disposed++;
    },
  };
  return w;
}

const run = (m: ReturnType<typeof morph>, rest: Record<string, unknown>) => {
  const path = createLatentPath(m);
  return {
    path,
    go: () =>
      renderMorph({
        path,
        canonical: () => infillFrames(path, m),
        descriptor: FFHQ_1024_DESCRIPTOR,
        ...(rest as object),
      } as never),
  };
};
const inOrder = (n: number) => Array.from({ length: n }, (_, i) => i);

test('render-morph.complete-has-all-frames on every branch, in presentation order, endpoints reused', async () => {
  const m = morph(3, 8);
  const total = createLatentPath(m).totalFrames;
  const endpoint = (id: string) => ({ blob: image(`endpoint-${id}`) });
  const cases = [
    ['sequential', { source: source({ batch: false }), writer: writer() }],
    ['blob-stream', { source: source(), writer: writer() }],
    [
      'retained-then-encode',
      (() => {
        const s = store(total);
        return {
          source: source(),
          writer: writer({ retain: true, store: s }),
          store: s,
          framesKey: 'k',
        };
      })(),
    ],
    [
      'raw-sparse-anchors',
      (() => {
        const s = store(total);
        return {
          source: source({ raw: true }),
          writer: writer({ raw: true, store: s }),
          store: s,
          framesKey: 'k',
        };
      })(),
    ],
  ] as const;
  for (const [expected, deps] of cases) {
    const displays: number[] = [];
    const { go } = run(m, { ...deps, endpoint, onDisplay: (i: number) => displays.push(i) });
    const out = await go();
    assert.equal(out.status, 'complete', expected);
    assert.equal(out.branch, expected);
    assert.equal(out.status === 'complete' && out.frames, total);
    assert.deepEqual(
      (deps.writer as ReturnType<typeof writer>).added,
      inOrder(total),
      `${expected}: frame order`,
    );
    assert.equal((deps.writer as ReturnType<typeof writer>).disposed(), 1);
    // Endpoints are the caller's faces, not synthesis: three faces, two segments of 8 frames each,
    // so each of the 17 frames but the three endpoints is synthesized exactly once.
    assert.equal(total, 17);
    assert.equal((deps.source as ReturnType<typeof source>).count(), total - 3, expected);
    if (expected === 'raw-sparse-anchors') assert.equal(displays.slice(0, 4).length, 4);
  }
  // cached-result: a complete store from the run above is written as is, with no synthesis.
  const s = store(total);
  for (const i of inOrder(total)) s.frames.set(i, image(`c${i}`));
  const src = source();
  const w = writer();
  const out = await run(m, { source: src, writer: w, store: s, framesKey: 'k' }).go();
  assert.deepEqual([out.status, out.branch, src.count()], ['complete', 'cached-result', 0]);
  assert.deepEqual(w.added, inOrder(total));
});

test('sparse anchors cannot deadlock the ordered drain, and frames in flight stay within the window', async () => {
  // A window as small as the anchor set, with anchors falling inside it, and a source that awaits the drain.
  const m = morph(2, 32);
  const total = createLatentPath(m).totalFrames;
  const s = store(total);
  const w = writer({ raw: true, store: s });
  const out = await Promise.race([
    run(m, {
      source: source({ raw: true }),
      writer: w,
      store: s,
      framesKey: 'k',
      window: 4,
      anchors: 4,
    }).go(),
    new Promise((_, reject) => setTimeout(() => reject(Error('deadlocked')), 10_000)),
  ]);
  assert.equal((out as { status: string }).status, 'complete');
  assert.deepEqual(w.added, inOrder(total));
  assert.ok((out as { peakFramesInFlight: number }).peakFramesInFlight <= 4);
  const big = await run(morph(2, 32), { source: source(), writer: writer(), window: 16 }).go();
  assert.ok(big.status === 'complete' && big.peakFramesInFlight <= 16, 'bounded by FRAME_WINDOW');
});

test('render-morph.cancel-at-frame-k-no-video: first, middle, last frame and during finalize', async () => {
  const m = morph(2, 16);
  const total = createLatentPath(m).totalFrames;
  for (const [label, at] of [
    ['first', 0],
    ['middle', Math.floor(total / 2)],
    ['last', total - 1],
  ] as const)
    for (const branch of [
      'sequential',
      'blob-stream',
      'retained-then-encode',
      'raw-sparse-anchors',
    ] as const) {
      const controller = new AbortController();
      const s = store(total);
      const raw = branch === 'raw-sparse-anchors';
      const w = writer({
        raw,
        retain: branch === 'retained-then-encode',
        store: s,
        onAdd: (i) => i === at && controller.abort(),
      });
      const deps = {
        source: source({ raw, batch: branch !== 'sequential' }),
        writer: w,
        store: s,
        framesKey: 'k',
      };
      const out = await run(m, { ...deps, signal: controller.signal, branch }).go();
      assert.equal(out.status, 'cancelled', `${branch} at ${label}`);
      assert.ok(!('video' in out), `${branch} at ${label}: no video`);
      assert.equal(w.disposed(), 1);
    }
  const controller = new AbortController();
  const w = writer({ finish: async () => controller.abort() });
  const out = await run(m, { source: source(), writer: w, signal: controller.signal }).go();
  assert.equal(out.status, 'cancelled', 'cancel while finishing returns no video');
});

test('render-morph.writer-failure-export-failed', async () => {
  const out = await run(morph(), { source: source(), writer: writer({ failFinish: true }) }).go();
  assert.equal(out.status, 'export-failed');
  assert.equal(out.status === 'export-failed' && out.error.code, 'encoder-failed');
  const synthFails = await run(morph(), {
    source: {
      synthesize: async () => {
        throw Error('device lost');
      },
    },
    writer: writer(),
  }).go();
  assert.equal(synthFails.status, 'failed');
});

test('render-morph.retention-skips-partial: a cancelled retention is never reused as a cached result', async () => {
  const m = morph(2, 16);
  const total = createLatentPath(m).totalFrames;
  const s = store(total);
  const controller = new AbortController();
  let retained = 0;
  const w = writer({ retain: true, store: s });
  const retain = w.retain!;
  w.retain = async (blob, index) => {
    if (++retained === 5) controller.abort();
    return retain(blob, index);
  };
  const first = await run(m, {
    source: source(),
    writer: w,
    store: s,
    framesKey: 'k',
    signal: controller.signal,
  }).go();
  assert.equal(first.status, 'cancelled');
  assert.ok(s.frames.size > 0 && s.frames.size < total, 'a partial set is on disk');
  const src = source();
  const again = await run(m, {
    source: src,
    writer: writer({ retain: true, store: s }),
    store: s,
    framesKey: 'k',
  }).go();
  assert.deepEqual([again.status, again.branch], ['complete', 'retained-then-encode']);
  assert.ok(src.count() > 0, 'frames were produced again, not taken from the partial set');
});

test('a forced branch the capabilities cannot run, or a latent of the wrong shape, is refused', async () => {
  assert.throws(
    () =>
      selectBranch({
        cached: false,
        writer: writer(),
        source: source(),
        framesKey: false,
        forced: 'raw-sparse-anchors',
      }),
    RangeError,
  );
  const m = morph();
  const path = createLatentPath(m);
  const out = await renderMorph({
    path: {
      totalFrames: path.totalFrames,
      frames: () =>
        [...path.frames()].map((f) => ({ ...f, visitId: null, values: f.values.slice(0, 10) })),
    },
    canonical: () => infillFrames(path, m),
    source: source({ batch: false }),
    writer: writer(),
  });
  assert.deepEqual(
    [out.status, out.status === 'failed' && out.error.code],
    ['failed', 'invalid-request'],
  );
});
