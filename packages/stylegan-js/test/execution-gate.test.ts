// Compute permits surround real ORT work through readback, while verified reads remain outside them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as onnx from 'onnxruntime-web';
import { loadCpuGenerator } from '../src/engine/adapters/cpu.ts';
import { submitWithCompute, type GeneratorManifest } from '../src/engine/adapters/generator.ts';
import { loadOrtRuntime, type OrtModule, type ModuleHost } from '../src/engine/adapters/ort.ts';
import {
  loadEncoderRuntime,
  loadStreamedEncoder,
  maxWPlusError,
  type EncoderOrt,
  type EncoderStreamManifest,
} from '../src/engine/encode.ts';
import { inputLatent } from '../src/engine/identity.ts';
import {
  floats,
  runCompute,
  type EngineAsset,
  type LocalAssetReader,
} from '../src/engine/reader.ts';
import { acquiredManifest, pathOf, runtimeReader, UNTESTED } from './engine/support/runtime.ts';

function gated(base: LocalAssetReader) {
  let active = 0,
    calls = 0;
  const reader: LocalAssetReader = {
    allowRepair: false,
    async read(asset) {
      assert.equal(active, 0, 'reads must never nest inside a compute permit');
      return base.read(asset);
    },
    async compute(work) {
      assert.equal(active, 0, 'these sequential operations never nest permits');
      calls++;
      active++;
      try {
        return await work();
      } finally {
        active--;
      }
    },
  };
  return {
    reader,
    held: () => assert.equal(active, 1, 'compute is held'),
    calls: () => calls,
    idle: () => assert.equal(active, 0),
  };
}

test('optional compute runs immediately by default and preserves values and errors', async () => {
  const reader = {
    allowRepair: false,
    read: async () => {
      throw Error('unexpected read');
    },
  } as const;
  let ran = false;
  const pending = runCompute(reader, () => {
    ran = true;
    return 17;
  });
  assert.equal(ran, true);
  assert.equal(await pending, 17);
  const error = Error('compute failed');
  await assert.rejects(
    runCompute(reader, () => {
      throw error;
    }),
    (e) => e === error,
  );
  const hooked = gated(reader);
  assert.equal(
    await runCompute(hooked.reader, async () => {
      hooked.held();
      await Promise.resolve();
      hooked.held();
      return 23;
    }),
    23,
  );
  await assert.rejects(
    runCompute(hooked.reader, async () => {
      throw error;
    }),
    (e) => e === error,
  );
  assert.equal(hooked.calls(), 2);
  hooked.idle();
});

test('GPU submission keeps its queue boundary and retains the permit through readback', async () => {
  const queue = Promise.withResolvers<void>();
  const readback = Promise.withResolvers<number>();
  const gate = gated({
    allowRepair: false,
    read: async () => {
      throw Error('unexpected read');
    },
  });
  let submitted = false;
  const pending = submitWithCompute(gate.reader, async () => {
    gate.held();
    await queue.promise;
    gate.held();
    return { done: readback.promise };
  }).then((value) => {
    submitted = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(submitted, false, 'cannot reuse shared GPU buffers before submission is queued');
  queue.resolve();
  const result = await pending;
  gate.held();
  readback.resolve(31);
  assert.equal(await result.done, 31);
  gate.idle();

  const error = Error('submission failed');
  await assert.rejects(
    submitWithCompute(gate.reader, async () => {
      throw error;
    }),
    (e) => e === error,
  );
  const failed = await submitWithCompute(gate.reader, async () => ({
    done: Promise.reject(error),
  }));
  await assert.rejects(failed.done, (e) => e === error);
  gate.idle();
  const raw = Promise.resolve({ done: Promise.resolve(9) });
  assert.equal(
    submitWithCompute({ allowRepair: false, read: gate.reader.read }, () => raw),
    raw,
    'without hook even the original submission promise is unchanged',
  );
});

test('both runtime loaders read bytes before taking a permit and import inside it', async () => {
  const asset = (source: string) => ({
    sha256: createHash('sha256').update(source).digest('hex'),
    size: Buffer.byteLength(source),
    source,
  });
  const module = asset('export const env = {wasm:{}};');
  const factory = asset('export default async function(){return {HEAPU8:new Uint8Array(16)}};');
  const wasm = asset('wasm');
  const gate = gated({
    allowRepair: false,
    read: async (a) => ({
      ok: true,
      value: new TextEncoder().encode((a as ReturnType<typeof asset>).source),
    }),
  });
  const revoked: string[] = [];
  const host: ModuleHost = {
    url: (bytes) => 'data:text/javascript;base64,' + Buffer.from(bytes).toString('base64'),
    revoke: (url) => {
      revoked.push(url);
    },
    import: (url) => {
      gate.held();
      return import(url);
    },
  };
  const cpu = await loadOrtRuntime(gate.reader, { module, factory, wasm }, host, 2);
  assert.equal(cpu.ort.env.wasm.numThreads, 2);
  const encoder = await loadEncoderRuntime(
    gate.reader,
    { version: 'test', unshared: true, maxWasmBytes: 268435456, module, factory, wasm },
    host,
  );
  assert.equal((encoder.ort as unknown as OrtModule).env.wasm.numThreads, 1);
  assert.equal(encoder.snapshotMemory().available, false);
  assert.equal(gate.calls(), 2);
  gate.idle();
  cpu.release();
  encoder.release();
  assert.equal(revoked.length, 7);
});

const runtime = acquiredManifest();
const base = onnx as unknown as OrtModule;
base.env.wasm.numThreads = 1;

test(
  'real CPU mapping and synthesis hold compute through getData, including the timed reader wrapper',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const manifest = runtime.manifest as unknown as GeneratorManifest;
    const gate = gated(runtimeReader());
    let creates = 0,
      runs = 0,
      readbacks = 0;
    const ort: OrtModule = {
      ...base,
      InferenceSession: {
        async create(model, options) {
          gate.held();
          creates++;
          const session = await base.InferenceSession.create(model, options);
          gate.held();
          return {
            inputNames: session.inputNames,
            async run(feeds, fetches) {
              gate.held();
              runs++;
              const outputs = await session.run(feeds, fetches);
              gate.held();
              return Object.fromEntries(
                Object.entries(outputs).map(([name, value]) => [
                  name,
                  value && {
                    getData: async () => {
                      gate.held();
                      readbacks++;
                      const data = await value.getData();
                      gate.held();
                      return data;
                    },
                    dispose: () => value.dispose(),
                  },
                ]),
              );
            },
            release: () => session.release(),
          };
        },
      },
    };
    const generator = await loadCpuGenerator({
      reader: gate.reader,
      manifest,
      manifestSha256: runtime.sha256,
      ort: async () => ort,
    });
    t.after(() => generator.dispose());
    const mapped = await generator.map({
      ids: { requestId: 'gate-map', inputRevision: 1, attemptId: 0 },
      z: inputLatent('seed', '7').z,
      truncation: { psi: 0.7, cutoff: 8 },
    });
    const raw = await generator.synthesizeRaw(mapped.wPlus.values);
    assert.equal(raw.length, 3 * 1024 * 1024);
    assert.ok(raw.every(Number.isFinite));
    assert.deepEqual([creates, runs, readbacks, gate.calls()], [2, 2, 2, 4]);
    gate.idle();
  },
);

test(
  'real streamed encoder holds each permit through output readback and session release',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const stream = runtime.manifest['encoderStream'] as EngineAsset;
    if (!stream) return t.skip('untested: streamed encoder absent');
    const manifest = JSON.parse(readFileSync(pathOf(stream), 'utf8')) as EncoderStreamManifest;
    const gate = gated(runtimeReader());
    const encoderBase = onnx as unknown as EncoderOrt;
    let creates = 0,
      runs = 0,
      releases = 0,
      readbacks = 0;
    const ort: EncoderOrt = {
      Tensor: encoderBase.Tensor,
      InferenceSession: {
        async create(bytes, options) {
          gate.held();
          creates++;
          const session = await encoderBase.InferenceSession.create(bytes, options);
          gate.held();
          return {
            async run(feeds) {
              gate.held();
              runs++;
              const out = await session.run(feeds);
              gate.held();
              return Object.fromEntries(
                Object.entries(out).map(([name, value]) => [
                  name,
                  value && {
                    ...value,
                    getData: async () => {
                      gate.held();
                      readbacks++;
                      const data = await value.getData();
                      gate.held();
                      return data;
                    },
                    dispose: () => value.dispose(),
                  },
                ]),
              );
            },
            async release() {
              gate.held();
              releases++;
              await session.release();
              gate.held();
            },
          };
        },
      },
    };
    const encoder = loadStreamedEncoder({ manifest, reader: gate.reader, ort });
    t.after(() => encoder.dispose());
    const canary = manifest.canaries[0]!;
    const input = new Float32Array(floats(readFileSync(pathOf(canary.input))).slice());
    const output = await encoder.encode({
      ids: { requestId: 'gate-encode', inputRevision: 1, attemptId: 0 },
      input: {
        tensor: input,
        tensorDigest: createHash('sha256').update(new Uint8Array(input.buffer)).digest('hex'),
        policyVersion: 'crop-preprocessing-v1',
      },
      confirmedCropId: 'c'.repeat(64),
    });
    const error = maxWPlusError(output.wPlus.values, readFileSync(pathOf(canary.reference)));
    assert.ok(error <= canary.threshold && canary.threshold === 0.0001, String(error));
    assert.deepEqual([creates, runs, releases, gate.calls()], [108, 108, 108, 108]);
    assert.ok(readbacks >= 108);
    gate.idle();
    t.diagnostic(`real e4e max |W+ error| ${error}; ${readbacks} gated readbacks`);
  },
);
