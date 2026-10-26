// The bounded streamed e4e photo encoder (fm-qjcs): the candidate's executeEncoderStream (classic a42829b,
// runtime/encoder-stream/<digest>/execute.mjs) and ort-worker.mjs encodeStream() as a typed
// LoadedEncoderCapability over the manager's verified local reads.
//
// - The schedule is the manifest's: 108 unchanged FP32 ONNX shards, created, run and released one at a time,
//   so at most one session is ever live (MEMORY_BOUNDS.maxLiveEncoderSessions). Each shard is read lazily
//   from verified local storage at its step; a miss or a corrupt shard is a typed invalidation, never a fetch.
// - Boundary tensors are checked against the manifest's names, dtypes and shapes on the way in and out, and
//   the live boundary bytes must equal the schedule's figure before each release.
// - Cancellation is checked before every read, create and run and after every await; whatever was live is
//   released in `finally` before the encode settles, so a cancel lands within one session step.
// - The ORT runtime is the encoder's own unshared single-threaded build with a 256 MiB WASM maximum; where
//   the caller can observe its heap (`snapshotMemory`), a shared or larger heap stops the encode.
// - Tolerance: the W+ from each qualification case must be within its threshold (0.0001) of the native
//   reference; nothing is converted to fp16 or widened.

import { MEMORY_BOUNDS, type LoadedEncoderCapability } from '../contracts/capability.ts';
import type { EncodeRequest, EncodeResult, OperationIds } from '../contracts/operations.ts';
import type { E4eTimings, StageTimingHook } from '../contracts/timing.ts';
import { validateWorkerRequest } from '../contracts/worker-messages.ts';
import type { ModuleHost } from './adapters/ort.ts';
import { floats, readLocal, type EngineAsset, type LocalAssetReader } from './reader.ts';

export const ENCODER_STREAM_KIND = 'e4e-onnx-sequential-shards-v1';
/** The FFHQ e4e encoder the shards were cut from (manifest.encoder.sha256). */
export const E4E_SOURCE_SHA256 = 'd525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1';
const MAX_SHARD_BYTES = 17 * 1024 * 1024;
const MAX_LIVE_BOUNDARY_BYTES = 16 * 1024 * 1024;

type Dtype = 'FLOAT' | 'INT64' | 'INT32' | 'BOOL';
type Storage = Float32Array | BigInt64Array | Int32Array | Uint8Array;
const TYPES: { readonly [D in Dtype]: readonly [string, new (data: Storage) => Storage] } = {
  FLOAT: ['float32', Float32Array as never],
  INT64: ['int64', BigInt64Array as never],
  INT32: ['int32', Int32Array as never],
  BOOL: ['bool', Uint8Array as never],
};

export interface EncoderBoundary {
  readonly name: string;
  readonly dtype: Dtype;
  readonly shape: readonly number[];
}

export interface EncoderStep extends EngineAsset {
  readonly id: number;
  readonly file: string;
  readonly inputs: readonly EncoderBoundary[];
  readonly outputs: readonly EncoderBoundary[];
  readonly liveBoundaryBytesBeforeRelease: number;
  readonly releaseAfter: readonly string[];
}

export interface EncoderCanary {
  readonly id: string;
  readonly input: EngineAsset;
  readonly reference: EngineAsset;
  readonly threshold: number;
}

/** The streamed encoder descriptor (encoder-stream/<digest>/manifest.json), as admitted. */
export interface EncoderStreamManifest {
  readonly kind: typeof ENCODER_STREAM_KIND;
  readonly sourceEncoderSha256: string;
  readonly preprocessingSha256: string;
  readonly maxShardBytes: number;
  readonly maxLiveBoundaryBytes: number;
  readonly steps: readonly EncoderStep[];
  readonly runtime: {
    readonly version: string;
    readonly unshared: true;
    readonly maxWasmBytes: number;
    readonly module: EngineAsset;
    readonly factory: EngineAsset;
    readonly wasm: EngineAsset;
  };
  readonly canaries: readonly EncoderCanary[];
}

/** The descriptor is not one this encoder runs; `field` names what was refused. */
export class EncoderUnsupported extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`Unsupported streamed encoder: ${field}: ${message}`);
    this.name = 'EncoderUnsupported';
    this.field = field;
  }
}

/** Admits the descriptor exactly as the candidate's executor and worker did, or throws EncoderUnsupported. */
export function admitEncoderManifest(value: unknown): EncoderStreamManifest {
  const m = value as Partial<EncoderStreamManifest> | null;
  const refuse = (field: string, message: string): never => {
    throw new EncoderUnsupported(field, message);
  };
  if (!m || typeof m !== 'object') return refuse('manifest', 'not an object');
  if (m.kind !== ENCODER_STREAM_KIND) refuse('kind', String(m.kind));
  if (m.sourceEncoderSha256 !== E4E_SOURCE_SHA256)
    refuse('sourceEncoderSha256', 'not the qualified e4e');
  if (!Number.isSafeInteger(m.maxShardBytes) || m.maxShardBytes! > MAX_SHARD_BYTES)
    refuse('maxShardBytes', `above ${MAX_SHARD_BYTES}`);
  if (
    !Number.isSafeInteger(m.maxLiveBoundaryBytes) ||
    m.maxLiveBoundaryBytes! > MAX_LIVE_BOUNDARY_BYTES
  )
    refuse('maxLiveBoundaryBytes', `above ${MAX_LIVE_BOUNDARY_BYTES}`);
  if (!Array.isArray(m.steps) || m.steps.length !== 108)
    refuse('steps', 'not the 108-shard schedule');
  const r = m.runtime;
  if (!r || r.unshared !== true || r.maxWasmBytes !== MEMORY_BOUNDS.maxWasmHeapBytes)
    refuse('runtime', 'not the unshared 256 MiB build');
  m.steps!.forEach((s, i) => {
    if (
      s.id !== i ||
      typeof s.sha256 !== 'string' ||
      !Number.isSafeInteger(s.size) ||
      s.size > m.maxShardBytes!
    )
      refuse(`steps[${i}]`, 'shard identity or size');
    for (const b of [...s.inputs, ...s.outputs])
      if (!(b.dtype in TYPES)) refuse(`steps[${i}].${b.name}`, `dtype ${b.dtype}`);
  });
  if (!Array.isArray(m.canaries)) refuse('canaries', 'missing');
  return m as EncoderStreamManifest;
}

/** The encoder ORT surface: like OrtModule, with the boundary dtypes the shards exchange. */
export interface EncoderOrt {
  readonly Tensor: new (
    type: string,
    data: Storage,
    dims: readonly number[],
  ) => { dispose(): void };
  readonly InferenceSession: {
    create(
      model: Uint8Array,
      options: object,
    ): Promise<{
      run(
        feeds: Record<string, unknown>,
      ): Promise<
        Record<
          string,
          | { type: string; dims: readonly number[]; getData(): Promise<unknown>; dispose(): void }
          | undefined
        >
      >;
      release(): Promise<void>;
    }>;
  };
}

/** The encoder ORT build's heap, as the candidate's factory observer reports it. */
export interface HeapSnapshot {
  readonly available: boolean;
  readonly shared: boolean;
  readonly currentBytes?: number;
}

export type EncoderInvalidation = 'cancelled' | 'disposed' | 'schedule' | 'memory' | 'local-asset';

/** An encode stopped: cancelled, disposed, a schedule or heap violation, or a shard the reader refused. */
export class EncoderUnavailable extends Error {
  readonly kind: EncoderInvalidation;
  /** The reader's error code, for a refused shard. */
  readonly code?: string;
  constructor(kind: EncoderInvalidation, message: string, code?: string) {
    super(message);
    this.name = 'EncoderUnavailable';
    this.kind = kind;
    if (code !== undefined) this.code = code;
  }
}

export interface EncoderInspection {
  readonly liveSessions: number;
  readonly maxLiveSessions: number;
  readonly sessionsCreated: number;
  readonly sessionsReleased: number;
  readonly running: boolean;
  readonly disposed: boolean;
  readonly heapMeasured: boolean;
}

export interface StreamedEncoder extends LoadedEncoderCapability {
  readonly manifest: EncoderStreamManifest;
  inspect(): EncoderInspection;
}

const sameShape = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * The loaded encoder. `ort` is the encoder's own runtime (manifest.runtime, one thread); `reader` reads the
 * shards; `snapshotMemory`, where the host can observe the heap, enforces the unshared 256 MiB bound.
 */
export function loadStreamedEncoder(o: {
  readonly manifest: EncoderStreamManifest;
  readonly reader: LocalAssetReader;
  readonly ort: EncoderOrt;
  readonly snapshotMemory?: () => HeapSnapshot;
  readonly now?: () => number;
}): StreamedEncoder {
  const manifest = admitEncoderManifest(o.manifest);
  const now = o.now ?? (() => performance.now());
  const s = {
    liveSessions: 0,
    maxLiveSessions: 0,
    sessionsCreated: 0,
    sessionsReleased: 0,
    running: false,
    disposed: false,
  };
  let current: { abort(reason: EncoderUnavailable): void; done: Promise<unknown> } | null = null;

  function heap(): number {
    const m = o.snapshotMemory?.();
    if (!o.snapshotMemory) return 0;
    if (
      !m?.available ||
      m.shared !== false ||
      !Number.isSafeInteger(m.currentBytes) ||
      m.currentBytes! <= 0 ||
      m.currentBytes! > manifest.runtime.maxWasmBytes
    )
      throw new EncoderUnavailable(
        'memory',
        'Bounded unshared encoder memory could not be verified.',
      );
    return m.currentBytes!;
  }

  async function run(
    request: EncodeRequest,
    onTiming: StageTimingHook | undefined,
    stopped: () => EncoderUnavailable | null,
  ): Promise<EncodeResult> {
    const check = () => {
      const reason = stopped();
      if (reason) throw reason;
    };
    const ids: OperationIds = request.ids;
    const timings = { verifiedReadMs: 0, sessionCreateMs: 0, runMs: 0, wasmHeapBytes: 0 };
    const started = now();
    const state = new Map<string, { data: Storage; shape: readonly number[]; dtype: Dtype }>([
      ['image', { data: request.input.tensor, shape: [1, 3, 256, 256], dtype: 'FLOAT' }],
    ]);
    const stage = (stage: 'encoder-session-create' | 'encoder-run', startedAtMs: number) =>
      onTiming?.({
        ids,
        operation: 'encode',
        stage,
        route: 'cpu',
        startedAtMs,
        completedAtMs: now(),
        boundary: 'inference-complete',
      });
    try {
      for (const step of manifest.steps) {
        check();
        let session: Awaited<ReturnType<EncoderOrt['InferenceSession']['create']>> | undefined;
        let outputs: Awaited<ReturnType<NonNullable<typeof session>['run']>> | undefined;
        const feeds: Record<string, { dispose(): void }> = {};
        let primary: unknown;
        try {
          const readAt = now();
          let bytes: Uint8Array | null = await readLocal(o.reader, step);
          check();
          if (bytes.byteLength !== step.size)
            throw new EncoderUnavailable(
              'schedule',
              `Encoder shard size mismatch at step ${step.id}.`,
            );
          timings.verifiedReadMs += now() - readAt;
          const createAt = now();
          session = await o.ort.InferenceSession.create(bytes, {
            executionProviders: ['wasm'],
            enableCpuMemArena: false,
            enableMemPattern: false,
            extra: { session: { disable_prepacking: '1' } },
          });
          bytes = null;
          s.sessionsCreated++;
          s.liveSessions++;
          s.maxLiveSessions = Math.max(s.maxLiveSessions, s.liveSessions);
          if (s.liveSessions > MEMORY_BOUNDS.maxLiveEncoderSessions)
            throw new EncoderUnavailable('schedule', 'More than one live encoder session.');
          timings.sessionCreateMs += now() - createAt;
          stage('encoder-session-create', createAt);
          timings.wasmHeapBytes = Math.max(timings.wasmHeapBytes, heap());
          check();
          for (const spec of step.inputs) {
            const value = state.get(spec.name);
            const [type, Ctor] = TYPES[spec.dtype];
            if (
              !value ||
              value.dtype !== spec.dtype ||
              !(value.data instanceof Ctor) ||
              !sameShape(value.shape, spec.shape)
            )
              throw new EncoderUnavailable(
                'schedule',
                `Encoder boundary input mismatch: ${spec.name}`,
              );
            feeds[spec.name] = new o.ort.Tensor(type, value.data, spec.shape);
          }
          const runAt = now();
          outputs = await session.run(feeds);
          timings.runMs += now() - runAt;
          stage('encoder-run', runAt);
          timings.wasmHeapBytes = Math.max(timings.wasmHeapBytes, heap());
          check();
          for (const spec of step.outputs) {
            const value = outputs[spec.name];
            const [type, Ctor] = TYPES[spec.dtype];
            if (!value || value.type !== type || !sameShape(value.dims, spec.shape))
              throw new EncoderUnavailable(
                'schedule',
                `Encoder boundary output mismatch: ${spec.name}`,
              );
            const raw = await value.getData();
            if (!(raw instanceof Ctor))
              throw new EncoderUnavailable('schedule', 'Encoder output storage mismatch.');
            const copy = new Ctor(raw);
            if (copy instanceof Float32Array && !copy.every(Number.isFinite))
              throw new EncoderUnavailable('schedule', 'Nonfinite encoder output.');
            state.set(spec.name, { data: copy, shape: spec.shape, dtype: spec.dtype });
          }
          let live = 0;
          for (const v of state.values()) live += v.data.byteLength;
          if (live !== step.liveBoundaryBytesBeforeRelease || live > manifest.maxLiveBoundaryBytes)
            throw new EncoderUnavailable(
              'schedule',
              'Encoder boundary allocation schedule mismatch.',
            );
          for (const name of step.releaseAfter) state.delete(name);
        } catch (error) {
          primary = error;
        } finally {
          for (const value of Object.values(outputs ?? {})) value?.dispose();
          for (const value of Object.values(feeds)) value.dispose();
          if (session) {
            try {
              await session.release();
            } finally {
              s.liveSessions--;
              s.sessionsReleased++;
            }
          }
        }
        if (primary) throw primary;
      }
      check();
      const w = state.get('w');
      if (
        state.size !== 1 ||
        !w ||
        !(w.data instanceof Float32Array) ||
        !sameShape(w.shape, [1, 18, 512])
      )
        throw new EncoderUnavailable('schedule', 'Invalid final encoder W+.');
      const result: E4eTimings = {
        ...timings,
        totalMs: now() - started,
        maxLiveSessions: s.maxLiveSessions,
      };
      return {
        ids,
        confirmedCropId: request.confirmedCropId,
        wPlus: { space: 'w-plus', shape: [18, 512], values: w.data },
        provider: 'cpu',
        timings: result,
      };
    } finally {
      state.clear();
    }
  }

  const encoder: StreamedEncoder = {
    manifest,
    async encode(request, signal, onTiming) {
      if (s.disposed) throw new EncoderUnavailable('disposed', 'The encoder was disposed.');
      validateWorkerRequest({ type: 'encode', id: request?.ids?.requestId || 'encode', request });
      if (current) throw new EncoderUnavailable('schedule', 'One encode runs at a time.');
      let reason: EncoderUnavailable | null = null;
      const stop = (r: EncoderUnavailable) => {
        reason ??= r;
      };
      const onAbort = () => stop(new EncoderUnavailable('cancelled', 'Encoding cancelled.'));
      if (signal?.aborted) onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      s.running = true;
      const done = run(request, onTiming, () => reason).catch((error: unknown) => {
        if (error instanceof EncoderUnavailable) throw error;
        const local = (error as { error?: { code?: string } } | null)?.error;
        if (error instanceof Error && error.name === 'LocalAssetUnavailable')
          throw new EncoderUnavailable('local-asset', error.message, local?.code);
        throw error;
      });
      current = { abort: stop, done: done.catch(() => {}) };
      try {
        return await done;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        current = null;
        s.running = false;
      }
    },
    abort() {
      current?.abort(new EncoderUnavailable('cancelled', 'Encoding cancelled.'));
    },
    async dispose() {
      if (s.disposed) return;
      s.disposed = true;
      const pending = current;
      pending?.abort(new EncoderUnavailable('disposed', 'The encoder was disposed.'));
      await pending?.done;
    },
    inspect: () => ({
      liveSessions: s.liveSessions,
      maxLiveSessions: s.maxLiveSessions,
      sessionsCreated: s.sessionsCreated,
      sessionsReleased: s.sessionsReleased,
      running: s.running,
      disposed: s.disposed,
      heapMeasured: o.snapshotMemory !== undefined,
    }),
  };
  return encoder;
}

/**
 * Imports the encoder's own runtime from verified bytes, one thread, with the candidate's factory observer
 * so the heap the encoder runs in can be checked (ort-worker.mjs encodeStream). `release` revokes the URLs.
 */
export async function loadEncoderRuntime(
  reader: LocalAssetReader,
  runtime: EncoderStreamManifest['runtime'],
  host: ModuleHost,
): Promise<{ ort: EncoderOrt; snapshotMemory: () => HeapSnapshot; release(): void }> {
  const urls: string[] = [];
  const url = (bytes: Uint8Array, type: string) => {
    const u = host.url(bytes, type);
    urls.push(u);
    return u;
  };
  const release = () => {
    for (const u of urls.splice(0)) host.revoke(u);
  };
  try {
    const moduleUrl = url(await readLocal(reader, runtime.module), 'text/javascript');
    const factoryUrl = url(await readLocal(reader, runtime.factory), 'text/javascript');
    const wasmUrl = url(await readLocal(reader, runtime.wasm), 'application/wasm');
    const observerUrl = url(
      new TextEncoder().encode(
        `import factory from ${JSON.stringify(factoryUrl)};let ref;export default async function(config){const m=await factory(config);ref=new WeakRef(m);return m;}export function snapshot(){const buffer=ref?.deref()?.HEAPU8?.buffer;return {available:Boolean(buffer),shared:Object.prototype.toString.call(buffer)==='[object SharedArrayBuffer]',currentBytes:buffer?.byteLength};}`,
      ),
      'text/javascript',
    );
    const observer = (await host.import(observerUrl)) as { snapshot(): HeapSnapshot };
    const ort = (await host.import(moduleUrl)) as EncoderOrt & {
      env: { wasm: { numThreads?: number; wasmPaths?: unknown } };
    };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: observerUrl, wasm: wasmUrl };
    return { ort, snapshotMemory: () => observer.snapshot(), release };
  } catch (error) {
    release();
    throw error;
  }
}

/** Max absolute W+ error of an encode against a qualification reference. */
export function maxWPlusError(actual: Float32Array, reference: Uint8Array): number {
  const expected = floats(reference);
  if (expected.length !== actual.length) throw Error('Encoder reference length mismatch');
  let max = 0;
  for (let i = 0; i < actual.length; i++)
    max = Math.max(max, Math.abs((actual[i] as number) - (expected[i] as number)));
  return max;
}
