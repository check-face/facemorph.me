// renderMorph (fm-suaa): the bridge's morph orchestration (classic a42829b product-bridge.mjs morph action, the
// morph-frame-pipeline-v1 branches) behind one call over caller-supplied capabilities: a frame source (the engine's
// synthesize / synthesizeFrames), a video writer (media.mjs videoWriter), the morph frame store (morph-frames.mjs)
// and the endpoint faces the caller already holds. It never imports a worker, WebCodecs, FFmpeg or IndexedDB.
//
// Branches (MEDIA_BRANCHES), chosen from what the capabilities offer unless the caller names one it can run:
// - cached-result: every frame is in the store under this morph's key; they go to the writer in order.
// - raw-sparse-anchors: up to `anchors` frames in canonical (infill) order are retained first for display, then
//   every frame streams to the writer in presentation order; an anchor is read back from the store, so the
//   ordered drain never waits on a frame still being produced (no deadlock on a full sparse window).
// - blob-stream: windows go to synthesizeFrames; each frame reaches the writer in order.
// - sequential: one synthesize per frame, strictly in order.
// - retained-then-encode: frames are retained in canonical order, then encoded from the store in order.
// Endpoint faces the caller holds are reused in place of synthesis on every producing branch.
//
// Settles 'complete' only with every frame written and the writer finished; cancellation at any frame or during
// finalize settles 'cancelled' with no video; a writer failure is 'export-failed'; anything else 'failed'.

import type { CancellationSignal } from '../contracts/capability.ts';
import type { ModelDescriptor } from '../contracts/descriptor.ts';
import { FFHQ_1024_DESCRIPTOR } from '../contracts/descriptor.ts';
import type { MediaBranch } from '../contracts/operations.ts';
import { MAX_MORPH_FRAMES } from '../contracts/operations.ts';

/** An encoded image as the writer and frame store pass it (a Blob in browsers); only its presence is checked. */
export interface MorphImage {
  readonly size: number;
  readonly type: string;
}

/** One produced frame: raw RGBA from the direct path, or an encoded image. */
export interface MorphFrame {
  readonly rgba?: ArrayBuffer;
  readonly blob?: MorphImage;
}

/** One frame of the path, as createLatentPath().frames() and infillFrames() yield it. */
export interface PathFrame {
  readonly index: number;
  readonly visitId: string | null;
  readonly values: ArrayLike<number>;
}

export interface MorphPath {
  readonly totalFrames: number;
  frames(): Iterable<PathFrame>;
}

export interface MorphLatent {
  readonly space: 'w-plus';
  readonly shape: readonly [1, number, number];
  readonly values: Float32Array;
}

export interface MorphFrameSource {
  synthesize(
    latent: MorphLatent,
    options: { readonly signal: CancellationSignal; readonly raw: boolean },
  ): Promise<MorphFrame>;
  /** Windows of frames in one request; `onFrame` may return a promise the source awaits before going on. */
  synthesizeFrames?(
    latents: readonly MorphLatent[],
    options: {
      readonly signal: CancellationSignal;
      readonly raw: boolean;
      readonly onFrame: (at: number, frame: MorphFrame) => unknown;
    },
  ): Promise<void>;
}

/** The video writer (media.mjs videoWriter): `D` is whatever display derivative retain/addRaw return. */
export interface MorphWriter<D = unknown> {
  add(blob: MorphImage, index: number): Promise<void>;
  addRaw?(frame: MorphFrame, index: number): Promise<D>;
  retain?(blob: MorphImage, index: number): Promise<D>;
  retainRaw?(frame: MorphFrame, index: number): Promise<D>;
  finish(): Promise<MorphImage>;
  dispose(): void;
}

export interface MorphFrameStore {
  /** Every frame of a key, or null; a partial set is never a cached result. */
  get(key: string): Promise<readonly MorphImage[] | null>;
  getOne(key: string, index: number): Promise<MorphImage | null>;
}

export type MorphSettlement =
  | {
      readonly status: 'complete';
      readonly branch: MediaBranch;
      readonly video: MorphImage;
      readonly frames: number;
      readonly peakFramesInFlight: number;
    }
  | { readonly status: 'cancelled'; readonly branch: MediaBranch | null; readonly frames: number }
  | {
      readonly status: 'failed' | 'export-failed';
      readonly branch: MediaBranch | null;
      readonly frames: number;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface RenderMorphOptions<D> {
  readonly path: MorphPath;
  /** Canonical frame order (infillFrames(path, morph)): endpoints first, then breadth-first midpoints. */
  readonly canonical: () => Iterable<PathFrame>;
  readonly source: MorphFrameSource;
  readonly writer: MorphWriter<D>;
  readonly store?: MorphFrameStore;
  /** The morph's frame-store key; without one no frame is retained or reused. */
  readonly framesKey?: string | null;
  /** An endpoint face the caller already holds for a control visit, reused instead of synthesis. */
  readonly endpoint?: (visitId: string) => Promise<MorphFrame | null> | MorphFrame | null;
  readonly descriptor?: ModelDescriptor;
  readonly signal?: CancellationSignal;
  /** Forces a branch; refused when the capabilities cannot run it. */
  readonly branch?: MediaBranch;
  /** A frame is displayable: its retained or raw-encoded derivative. */
  readonly onDisplay?: (index: number, display: D) => void;
  readonly onProgress?: (event: {
    readonly stage: 'morph' | 'export';
    readonly done: number;
    readonly total: number;
  }) => void;
  /** Frames per synthesizeFrames window (the bridge's FRAME_WINDOW). */
  readonly window?: number;
  /** Sparse display anchors before the ordered stream (two endpoints plus two midpoints). */
  readonly anchors?: number;
}

export const FRAME_WINDOW = 16;
export const SPARSE_ANCHORS = 4;

class Cancelled extends Error {
  constructor() {
    super('Morph cancelled');
    this.name = 'AbortError';
  }
}
class ExportFailed extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ExportFailed';
    this.cause = cause;
  }
}

/** The branch the bridge would take for these capabilities, or the forced one if it can run. */
export function selectBranch(o: {
  readonly cached: boolean;
  readonly writer: MorphWriter<unknown>;
  readonly source: MorphFrameSource;
  readonly framesKey: boolean;
  readonly forced?: MediaBranch;
}): MediaBranch {
  const can: Record<MediaBranch, boolean> = {
    'cached-result': o.cached,
    'raw-sparse-anchors':
      o.framesKey && !!o.writer.addRaw && !!o.writer.retainRaw && !!o.source.synthesizeFrames,
    'blob-stream': !!o.source.synthesizeFrames && !o.writer.retain,
    sequential: !o.writer.retain,
    'retained-then-encode': o.framesKey && !!o.writer.retain,
    'endpoint-reuse': false,
  };
  if (o.forced) {
    if (!can[o.forced]) throw new RangeError(`Morph branch ${o.forced} is not available here`);
    return o.forced;
  }
  if (can['cached-result']) return 'cached-result';
  if (can['raw-sparse-anchors']) return 'raw-sparse-anchors';
  if (can['retained-then-encode']) return 'retained-then-encode';
  return can['blob-stream'] ? 'blob-stream' : 'sequential';
}

export async function renderMorph<D>(o: RenderMorphOptions<D>): Promise<MorphSettlement> {
  const { path, source, writer } = o;
  const total = path.totalFrames;
  const window = o.window ?? FRAME_WINDOW;
  const descriptor = o.descriptor ?? FFHQ_1024_DESCRIPTOR;
  const { layers, width } = descriptor.latent;
  const never: CancellationSignal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const signal = o.signal ?? never;
  const key = o.framesKey ?? null;
  let branch: MediaBranch | null = null;
  let written = 0,
    inFlight = 0,
    peak = 0;
  const check = () => {
    if (signal.aborted) throw new Cancelled();
  };
  const latent = (frame: PathFrame): MorphLatent => {
    const values = Float32Array.from(frame.values as ArrayLike<number>);
    if (values.length !== layers * width)
      throw new RangeError(
        `Morph frame ${frame.index} has ${values.length} values, not ${layers}x${width}`,
      );
    return { space: 'w-plus', shape: [1, layers, width], values };
  };
  const progress = (stage: 'morph' | 'export', done: number) => {
    try {
      o.onProgress?.({ stage, done, total });
    } catch {}
  };
  const display = (index: number, d: D) => {
    try {
      o.onDisplay?.(index, d);
    } catch {}
  };
  const reuse = async (frame: PathFrame) =>
    frame.visitId && o.endpoint ? ((await o.endpoint(frame.visitId)) ?? null) : null;
  const blobOf = (frame: MorphFrame, index: number) => {
    if (!frame.blob) throw new RangeError(`Morph frame ${index} has no image`);
    return frame.blob;
  };
  const write = async (blob: MorphImage, index: number) => {
    check();
    await writer.add(blob, index);
    written++;
    progress('morph', written);
  };

  /** Windows in presentation order; `ready` holds produced frames until the ordered drain takes them. */
  async function stream(
    produce: (frame: PathFrame) => boolean,
    deliver: (frame: PathFrame, out: MorphFrame) => Promise<void>,
    preset: (frame: PathFrame) => Promise<MorphFrame | null>,
    raw: boolean,
    order: Iterable<PathFrame> = path.frames(),
  ) {
    const iterator = order[Symbol.iterator]();
    for (;;) {
      const batch: PathFrame[] = [];
      for (let item; batch.length < window && !(item = iterator.next()).done;)
        batch.push(item.value);
      if (!batch.length) return;
      check();
      const ready = new Map<number, MorphFrame>();
      for (const frame of batch) {
        const given = await preset(frame);
        if (given) ready.set(frame.index, given);
      }
      const todo = batch.filter((frame) => !ready.has(frame.index) && produce(frame));
      let cursor = 0,
        chain: Promise<void> = Promise.resolve();
      const drain = async () => {
        for (; cursor < batch.length; cursor++) {
          check();
          const frame = batch[cursor]!;
          const out = ready.get(frame.index);
          if (!out) return;
          ready.delete(frame.index);
          inFlight = ready.size;
          await deliver(frame, out);
        }
      };
      if (todo.length) {
        if (!source.synthesizeFrames) throw new RangeError('This branch needs synthesizeFrames');
        await source.synthesizeFrames(todo.map(latent), {
          signal,
          raw,
          onFrame: (at, out) => {
            ready.set(todo[at]!.index, out);
            inFlight = ready.size;
            peak = Math.max(peak, inFlight);
            chain = chain.then(drain);
            return chain;
          },
        });
      }
      await (chain = chain.then(drain));
      if (cursor < batch.length) throw Error('Some morph frames were not produced.');
    }
  }

  try {
    if (!Number.isInteger(total) || total < 1 || total > MAX_MORPH_FRAMES)
      throw new RangeError(`A morph has 1 to ${MAX_MORPH_FRAMES} frames`);
    check();
    const stored = key && o.store ? await o.store.get(key).catch(() => null) : null;
    branch = selectBranch({
      cached: !!stored && stored.length === total,
      writer: writer as MorphWriter<unknown>,
      source,
      framesKey: !!key && !!o.store,
      ...(o.branch ? { forced: o.branch } : {}),
    });
    progress('morph', 0);

    if (branch === 'cached-result') {
      for (const frame of path.frames()) await write(stored![frame.index]!, frame.index);
    } else if (branch === 'raw-sparse-anchors') {
      const anchors = new Set<number>();
      for (const frame of o.canonical()) {
        if (anchors.size >= (o.anchors ?? SPARSE_ANCHORS)) break;
        check();
        const out =
          (await reuse(frame)) ?? (await source.synthesize(latent(frame), { signal, raw: true }));
        check();
        const d = out.rgba
          ? await writer.retainRaw!(out, frame.index)
          : await writer.retain!(blobOf(out, frame.index), frame.index);
        anchors.add(frame.index);
        display(frame.index, d);
      }
      await stream(
        (frame) => !anchors.has(frame.index),
        async (frame, out) => {
          if (out.rgba) display(frame.index, await writer.addRaw!(out, frame.index));
          else await writer.add(blobOf(out, frame.index), frame.index);
          written++;
          progress('morph', written);
        },
        async (frame) => {
          if (!anchors.has(frame.index)) return null;
          const blob = await o.store!.getOne(key!, frame.index);
          if (!blob) throw Error('A preview frame is unavailable.');
          return { blob };
        },
        true,
      );
    } else if (branch === 'retained-then-encode') {
      const retain = async (frame: PathFrame, out: MorphFrame) => {
        check();
        display(frame.index, await writer.retain!(blobOf(out, frame.index), frame.index));
      };
      if (source.synthesizeFrames) await stream(() => true, retain, reuse, false, o.canonical());
      else
        for (const frame of o.canonical()) {
          check();
          await retain(
            frame,
            (await reuse(frame)) ??
              (await source.synthesize(latent(frame), { signal, raw: false })),
          );
        }
      progress('export', 0);
      for (let index = 0; index < total; index++) {
        check();
        const blob = await o.store!.getOne(key!, index);
        if (!blob) throw Error('A morph frame is unavailable.');
        await write(blob, index);
      }
    } else if (branch === 'blob-stream') {
      await stream(
        () => true,
        (frame, out) => write(blobOf(out, frame.index), frame.index),
        reuse,
        false,
      );
    } else {
      for (const frame of path.frames()) {
        check();
        const out =
          (await reuse(frame)) ?? (await source.synthesize(latent(frame), { signal, raw: false }));
        await write(blobOf(out, frame.index), frame.index);
      }
    }

    if (written !== total) throw Error(`Only ${written} of ${total} morph frames were written.`);
    progress('export', total);
    check();
    let video: MorphImage;
    try {
      video = await writer.finish();
    } catch (error) {
      if (signal.aborted) throw new Cancelled();
      throw new ExportFailed(error);
    }
    // A cancel that lands while the writer finishes still yields no video.
    check();
    return { status: 'complete', branch, video, frames: written, peakFramesInFlight: peak };
  } catch (error) {
    if (error instanceof Cancelled || signal.aborted || (error as Error)?.name === 'AbortError')
      return { status: 'cancelled', branch, frames: written };
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ExportFailed)
      return {
        status: 'export-failed',
        branch,
        frames: written,
        error: { code: 'encoder-failed', message },
      };
    return {
      status: 'failed',
      branch,
      frames: written,
      error: { code: error instanceof RangeError ? 'invalid-request' : 'internal', message },
    };
  } finally {
    writer.dispose();
  }
}
