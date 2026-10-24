// The CPU adapter and the engine over it, with the real model (fm-3h3w): the acquired candidate runtime read through
// a verifying local reader, onnxruntime-web's WASM backend in Node, the real canaries and references, the manager's
// real lease registry and loaded handle, and a real MessageChannel for the worker boundary. Where the runtime is not
// acquired, every case here is reported untested. The browser and GPU routes are the browser harness's
// (test/browser/engine-harness.mjs).
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import * as onnx from 'onnxruntime-web';
import { loadCpuGenerator } from '../../src/engine/adapters/cpu.ts';
import {
  GeneratorUnavailable,
  type Generator,
  type GeneratorManifest,
} from '../../src/engine/adapters/generator.ts';
import type { OrtModule } from '../../src/engine/adapters/ort.ts';
import {
  createCanaryQualification,
  type CanaryManifest,
  type CanaryRecords,
} from '../../src/engine/canary.ts';
import { createEngine, type EngineTraceEvent } from '../../src/engine/engine.ts';
import { inputLatent } from '../../src/engine/identity.ts';
import { LocalAssetUnavailable } from '../../src/engine/reader.ts';
import { cpuThreads } from '../../src/engine/routes.ts';
import { connectEngine, serveEngine } from '../../src/engine/worker.ts';
import { assertCloneSafe, validateWorkerResponse } from '../../src/contracts/worker-messages.ts';
import type { StageTimingEvent } from '../../src/contracts/timing.ts';
import {
  createLoadedHandle,
  HandleUnavailable,
} from '../../../browser-model-manager/src/handles/handle.ts';
import { createLeaseRegistry } from '../../../browser-model-manager/src/handles/leases.ts';
import { acquiredManifest, pathOf, RUNTIME, runtimeReader, UNTESTED } from './support/runtime.ts';

const runtime = acquiredManifest();
const manifest = runtime?.manifest as unknown as GeneratorManifest & CanaryManifest;
const ort = onnx as unknown as OrtModule;
ort.env.wasm.numThreads = cpuThreads({
  sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
  crossOriginIsolated: false, // Node is not a cross-origin isolated page: one thread, as an unisolated browser
  hardwareConcurrency: undefined,
});

// The candidate's CPU route on the same canaries (onnxruntime-web 1.24.3 in Chromium, recorded on eris on 24 October
// 2026 through tools/ort-qualify; the manager's adapter-generator.test.ts holds the same table).
const CANDIDATE_CPU: Record<string, [number, number]> = {
  'frame-00': [1, 0.000004470348358154297],
  'frame-25': [1, 0.0000033080577850341797],
  'encoded-synthetic-photo': [1, 0.0000036954879760742188],
  'zero-noise': [1, 0.000005304813385009766],
  'alternate-noise': [1, 0.0000027120113372802734],
  'trunc-psi-0': [1, 0.0000030994415283203125],
  'trunc-psi-1': [1, 0.000004947185516357422],
};

const ids = (n: number, revision = n) => ({
  requestId: `r${n}`,
  inputRevision: revision,
  attemptId: 0,
});
const z7 = () => inputLatent('seed', '7').z;
const records = (): CanaryRecords & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (k) => map.get(k),
    put: async (k, v) => void map.set(k, structuredClone(v)),
  };
};

let shared: Generator | null = null;
async function generator(): Promise<Generator> {
  shared ??= await loadCpuGenerator({
    reader: runtimeReader(),
    manifest,
    manifestSha256: runtime!.sha256,
    ort: async () => ort,
  });
  return shared;
}
test.after(() => shared?.dispose());

const qualification = (g: Generator, store: CanaryRecords, full = false) =>
  createCanaryQualification({
    manifest,
    manifestSha256: runtime!.sha256,
    route: 'cpu',
    bundle: manifest.synthesis,
    records: store,
    reader: runtimeReader(),
    synthesizeRaw: (v, noise) => g.synthesizeRaw(v, noise),
    full,
  });

test(
  'loading on the CPU is sequential: the synthesis session, then mapping only on the first map()',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    assert.deepEqual(g.loadTrace.slice(0, 3), [
      'noise-read',
      'synthesis-load-start',
      'synthesis-load-done',
    ]);
    assert.ok(
      !g.loadTrace.includes('mapping-load-start'),
      'no mapping session beside the CPU model load',
    );
    assert.equal(g.engine, 'ort-wasm');
    const { verifiedReadMs, sessionCreateMs, totalMs } = g.loadTimings;
    assert.ok(
      verifiedReadMs > 0 && sessionCreateMs > 0 && totalMs >= verifiedReadMs + sessionCreateMs - 1,
      JSON.stringify(g.loadTimings),
    );
    assert.deepEqual(g.provider, {
      requested: 'cpu',
      actual: 'cpu',
      admission: 'admitted',
      validation: 'unvalidated',
    });
    await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } });
    assert.deepEqual(g.loadTrace.slice(3), ['mapping-load-start', 'mapping-load-done']);
  },
);

test(
  'every product canary passes on the CPU adapter at the frozen gates, equal to the candidate CPU route',
  { timeout: 900_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const q = qualification(g, records(), true);
    const receipt = await q.admit();
    assert.equal(receipt.ran, 7);
    for (const c of receipt.checks) {
      t.diagnostic(`${c.name}: maxRgb ${c.maxRgb}, maxFloat ${c.maxFloat}`);
      assert.equal(c.passed, true);
      assert.ok(c.maxRgb <= 1 && c.maxFloat <= 0.002);
      assert.deepEqual(
        [c.maxRgb, c.maxFloat],
        CANDIDATE_CPU[c.name],
        `${c.name} equals the candidate's`,
      );
    }
  },
);

test(
  'admission from the trace: cold runs one canary before the first face and the rest behind it; warm runs none; full runs all first',
  { timeout: 1_200_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const store = records();
    const kinds = (trace: readonly EngineTraceEvent[]) =>
      trace.map((e) =>
        e.kind === 'canary'
          ? `canary:${e.phase}:${e.index}`
          : e.kind === 'operation'
            ? `${e.operation}`
            : e.kind,
      );
    const wPlus = (await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }))
      .wPlus;

    const cold = createEngine({ generator: g, qualification: qualification(g, store) });
    const face = await cold.synthesize({ ids: ids(2), wPlus, output: 'rgba' });
    assert.equal(face.status, 'completed');
    await cold.qualified();
    assert.deepEqual(kinds(cold.trace()), [
      'canary:admission:0',
      'admitted',
      'synthesize',
      ...[1, 2, 3, 4, 5, 6].map((i) => `canary:background:${i}`),
      'qualified',
    ]);

    const warm = createEngine({ generator: g, qualification: qualification(g, store) });
    assert.equal(
      (await warm.synthesize({ ids: ids(3), wPlus, output: 'rgba' })).status,
      'completed',
    );
    await warm.qualified();
    assert.deepEqual(kinds(warm.trace()), ['admitted', 'qualified', 'synthesize']);
    assert.deepEqual(warm.trace()[0], {
      kind: 'admitted',
      ran: 0,
      cached: true,
      partial: false,
      full: false,
    });

    const ci = createEngine({ generator: g, qualification: qualification(g, store, true) });
    assert.equal((await ci.synthesize({ ids: ids(4), wPlus, output: 'rgba' })).status, 'completed');
    assert.deepEqual(kinds(ci.trace()), [
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => `canary:admission:${i}`),
      'admitted',
      'qualified',
      'synthesize',
    ]);
  },
);

test(
  'timing hooks report completion after the output is read back, on the caller clock',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const events: StageTimingEvent[] = [];
    const mapped = await g.map(
      { ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } },
      undefined,
      (e) => events.push(e),
    );
    const before = performance.now();
    let after = 0;
    const result = await g
      .synthesize(
        { ids: ids(2), wPlus: mapped.wPlus, output: 'rgba-and-raw-float' },
        undefined,
        (e) => events.push(e),
      )
      .finally(() => (after = performance.now()));
    assert.equal(result.rgba.length, 1024 * 1024 * 4);
    assert.equal(result.rawFloat?.length, 3 * 1024 * 1024);
    assert.equal(result.provider, 'cpu');
    const synth = events.find((e) => e.stage === 'synthesis')!;
    assert.deepEqual(
      [synth.boundary, synth.route, synth.operation],
      ['readback-complete', 'cpu', 'synthesize'],
    );
    assert.ok(synth.startedAtMs >= before - 1 && synth.completedAtMs <= after + 1);
    assert.ok(
      synth.completedAtMs - synth.startedAtMs > 250,
      `a CPU face lasted ${synth.completedAtMs - synth.startedAtMs} ms`,
    );
    assert.equal(events.find((e) => e.stage === 'mapping')?.boundary, 'readback-complete');
  },
);

test(
  'operation validation: invalid requests settle invalid-request and run nothing',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const engine = createEngine({ generator: g });
    const bad = [
      engine.map({
        ids: ids(1),
        z: new Float32Array(3).fill(NaN),
        truncation: { psi: 0.7, cutoff: 8 },
      }),
      engine.map({
        ids: { requestId: '', inputRevision: 0, attemptId: 0 },
        z: z7(),
        truncation: { psi: 0.7, cutoff: 8 },
      }),
      engine.synthesize({
        ids: ids(2),
        wPlus: { space: 'w-plus', shape: [18, 512], values: new Float32Array(10) },
        output: 'rgba',
      }),
      engine.synthesize({
        ids: ids(3),
        wPlus: { space: 'w-plus', shape: [18, 512], values: new Float32Array(9216) },
        output: 'png' as 'rgba',
      }),
    ];
    for (const s of await Promise.all(bad)) {
      assert.equal(s.status, 'failed');
      if (s.status === 'failed') assert.equal(s.error.code, 'invalid-request');
    }
    // Valid in the schema, wrong for this model: refused by the adapter as invalid, not run.
    const short = await engine.map({
      ids: ids(4),
      z: new Float32Array(256),
      truncation: { psi: 0.7, cutoff: 8 },
    });
    assert.equal(short.status === 'failed' && short.error.code, 'invalid-request');
    assert.equal(
      engine.trace().filter((e) => e.kind === 'operation').length,
      1,
      'only the schema-valid request reached the lane',
    );
  },
);

test(
  'abort at each stage settles cancelled, never runs queued work, and leaves the lane working',
  { timeout: 900_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const engine = createEngine({ generator: g });
    const wPlus = (await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }))
      .wPlus;
    // Before submission.
    const early = new AbortController();
    early.abort();
    assert.equal(
      (
        await engine.synthesize(
          { ids: ids(2), wPlus, output: 'rgba' },
          { signal: early.signal, slot: 'a' },
        )
      ).status,
      'cancelled',
    );
    // While running (inside the inference) and while queued behind it.
    const running = new AbortController(),
      queued = new AbortController();
    const first = engine.synthesize(
      { ids: ids(3), wPlus, output: 'rgba' },
      { signal: running.signal, slot: 'b' },
    );
    const second = engine.synthesize(
      { ids: ids(4), wPlus, output: 'rgba' },
      { signal: queued.signal, slot: 'c' },
    );
    // ORT WASM on this thread computes without yielding, so "during the run" is the same tick it started in.
    assert.ok(engine.state().running);
    assert.equal(engine.state().queued, 1);
    const abortedAt = performance.now();
    running.abort();
    queued.abort();
    assert.equal((await first).status, 'cancelled');
    assert.ok(
      performance.now() - abortedAt < 100,
      'cancelled at once, not when the inference ends',
    );
    assert.equal((await second).status, 'cancelled');
    // During mapping, then a working face after it all.
    const mapAbort = new AbortController();
    const mapping = engine.map(
      { ids: ids(5), z: z7(), truncation: { psi: 0.7, cutoff: 8 } },
      { signal: mapAbort.signal },
    );
    mapAbort.abort();
    assert.equal((await mapping).status, 'cancelled');
    const after = await engine.synthesize({ ids: ids(6), wPlus, output: 'rgba' }, { slot: 'd' });
    assert.equal(after.status, 'completed');
    const ran = engine
      .trace()
      .filter((e) => e.kind === 'operation')
      .map((e) => (e as { requestId: string }).requestId);
    assert.ok(
      !ran.includes('r2') && !ran.includes('r4'),
      `queued and pre-aborted work never ran (${ran.join()})`,
    );
  },
);

test(
  'stale revisions are rejected and a newer input supersedes older pending work',
  { timeout: 900_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const engine = createEngine({ generator: g });
    const wPlus = (await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }))
      .wPlus;
    const r2 = engine.synthesize({ ids: ids(2, 2), wPlus, output: 'rgba' });
    const r3 = engine.synthesize({ ids: ids(3, 3), wPlus, output: 'rgba' });
    const stale = await engine.synthesize({ ids: ids(4, 1), wPlus, output: 'rgba' });
    assert.deepEqual(stale, { status: 'superseded', ids: ids(4, 1), by: ids(3, 3) });
    assert.deepEqual(await r2, { status: 'superseded', ids: ids(2, 2), by: ids(3, 3) });
    const latest = await r3;
    assert.equal(latest.status, 'completed');
    // Separate slots do not supersede each other.
    const [x, y] = await Promise.all([
      engine.synthesize({ ids: ids(5, 1), wPlus, output: 'rgba' }, { slot: 'left' }),
      engine.synthesize({ ids: ids(6, 0), wPlus, output: 'rgba' }, { slot: 'right' }),
    ]);
    assert.deepEqual([x.status, y.status], ['completed', 'completed']);
  },
);

test(
  'dispose, double dispose and dispose during a run: everything settles and every session is released',
  { timeout: 900_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await loadCpuGenerator({
      reader: runtimeReader(),
      manifest,
      manifestSha256: runtime.sha256,
      ort: async () => ort,
    });
    const mapped = await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } });
    assert.equal(g.inspect().liveSessions, 2);
    const running = g.synthesize({ ids: ids(2), wPlus: mapped.wPlus, output: 'rgba' });
    assert.equal(g.inspect().pending, 1, 'in flight');
    await Promise.all([g.dispose(), g.dispose()]);
    const error = await running.then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof GeneratorUnavailable && error.kind === 'disposed', String(error));
    assert.deepEqual(g.inspect(), {
      disposed: true,
      liveSessions: 0,
      backendResources: 0,
      pending: 0,
    });
    await g.dispose();
    await assert.rejects(
      g.map({ ids: ids(3), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }),
      GeneratorUnavailable,
    );
    // Disposed while the mapping session is still being created: the late session is released, never kept.
    const h = await loadCpuGenerator({
      reader: runtimeReader(),
      manifest,
      manifestSha256: runtime.sha256,
      ort: async () => ort,
    });
    const mapping = h.map({ ids: ids(4), z: z7(), truncation: { psi: 0.7, cutoff: 8 } });
    await h.dispose();
    await assert.rejects(mapping, GeneratorUnavailable);
    assert.equal(h.inspect().liveSessions, 0);
  },
);

test(
  'a corrupt asset on disk is a typed failure: nothing repaired, nothing refetched, nothing leaked',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    // A planted copy of the runtime whose mapping model has one flipped byte.
    const root = mkdtempSync(join(tmpdir(), 'engine-corrupt-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    symlinkSync(join(RUNTIME, 'chunks'), join(root, 'chunks'));
    mkdirSync(join(root, 'assets'));
    const mappingFile = pathOf(manifest.mapping as { url: string });
    const mappingDir = mappingFile.split('/').at(-2) as string;
    for (const d of readdirSync(join(RUNTIME, 'assets')))
      if (d !== mappingDir) symlinkSync(join(RUNTIME, 'assets', d), join(root, 'assets', d));
    mkdirSync(join(root, 'assets', mappingDir));
    const bytes = readFileSync(mappingFile);
    bytes[1000] = (bytes[1000] as number) ^ 0xff;
    writeFileSync(pathOf(manifest.mapping as { url: string }, root), bytes);

    const reads: string[] = [];
    const g = await loadCpuGenerator({
      reader: runtimeReader(root, reads),
      manifest,
      manifestSha256: runtime.sha256,
      ort: async () => ort,
    });
    t.after(() => g.dispose());
    const error = await g.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof LocalAssetUnavailable, String(error));
    assert.equal(error.error.code, 'corrupt');
    assert.equal(
      reads.filter((s) => s === manifest.mapping.sha256).length,
      1,
      'read once; no repair',
    );
    assert.equal(
      g.inspect().liveSessions,
      1,
      'only the synthesis session; no mapping session from bad bytes',
    );
    const engine = createEngine({ generator: g });
    const settled = await engine.map({ ids: ids(2), z: z7(), truncation: { psi: 0.7, cutoff: 8 } });
    assert.deepEqual(settled.status === 'failed' && [settled.error.code, settled.error.cause], [
      'route-failed',
      'corrupt',
    ]);
  },
);

test(
  'lease loss through the manager handle: the running operation settles typed, sessions and leases are released',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    for (const cause of ['browser-eviction', 'corruption', 'device-loss'] as const) {
      const g = await loadCpuGenerator({
        reader: runtimeReader(),
        manifest,
        manifestSha256: runtime.sha256,
        ort: async () => ort,
      });
      const registry = createLeaseRegistry();
      const handle = createLoadedHandle({
        manifestSha256: runtime.sha256,
        capability: g,
        assets: g.assets,
        registry,
      });
      const engine = createEngine({ generator: handle.capability });
      const wPlus = (
        await handle.capability.map({ ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } })
      ).wPlus;
      const running = engine.synthesize({ ids: ids(2), wPlus, output: 'rgba' });
      assert.ok(engine.state().running, 'in flight');
      registry.invalidate(manifest.synthesis.sha256, cause);
      const settled = await running;
      assert.equal(settled.status, 'failed', cause);
      if (settled.status === 'failed')
        assert.deepEqual(
          [settled.error.code, settled.error.cause],
          [
            'route-failed',
            cause === 'browser-eviction'
              ? 'evicted'
              : cause === 'corruption'
                ? 'corrupt'
                : 'device-loss',
          ],
          cause,
        );
      await handle.release();
      assert.deepEqual(registry.leased(), [], `${cause}: no lease left`);
      assert.equal(g.inspect().liveSessions, 0, `${cause}: no session left`);
      await assert.rejects(
        handle.capability.map({ ids: ids(3), z: z7(), truncation: { psi: 0.7, cutoff: 8 } }),
        HandleUnavailable,
      );
    }
  },
);

test(
  'across a real MessageChannel only clone-safe messages cross, and a signal becomes a cancel message',
  { timeout: 900_000 },
  async (t) => {
    if (!runtime) return t.skip(UNTESTED);
    const g = await generator();
    const engine = createEngine({ generator: g });
    const { port1, port2 } = new MessageChannel();
    t.after(() => {
      port1.close();
      port2.close();
    });
    // Every message on the wire, both ways, as the receiving side gets it.
    const wire: unknown[] = [];
    port1.addEventListener('message', (e) => wire.push(e.data));
    port2.addEventListener('message', (e) => wire.push(e.data));
    serveEngine(port2 as never, engine);
    const client = connectEngine(port1 as never);
    const timings: StageTimingEvent[] = [];
    const mapped = await client.map(
      { ids: ids(1), z: z7(), truncation: { psi: 0.7, cutoff: 8 } },
      { onTiming: (e) => timings.push(e) },
    );
    assert.equal(mapped.status, 'completed');
    const wPlus = mapped.status === 'completed' ? mapped.result.wPlus : (null as never);
    const face = await client.synthesize(
      { ids: ids(2), wPlus, output: 'rgba-and-raw-float' },
      { onTiming: (e) => timings.push(e) },
    );
    assert.equal(face.status, 'completed');
    if (face.status === 'completed') assert.equal(face.result.rgba.length, 1024 * 1024 * 4);
    const controller = new AbortController();
    const cancelled = client.synthesize(
      { ids: ids(3), wPlus, output: 'rgba' },
      { signal: controller.signal },
    );
    controller.abort();
    assert.equal((await cancelled).status, 'cancelled');
    assert.equal((await client.status()).provider.actual, 'cpu');
    await new Promise((r) => setTimeout(r, 50)); // the worker's own 'cancelled' settlement for it arrives too
    assert.deepEqual(
      timings.map((e) => e.stage),
      ['mapping', 'synthesis'],
    );
    assert.ok(wire.length >= 9);
    for (const m of wire) {
      assertCloneSafe(m);
      const types = new Set(['map', 'synthesize', 'cancel', 'status']);
      if (!types.has((m as { type: string }).type)) validateWorkerResponse(m);
    }
    assert.ok(
      wire.some((m) => (m as { type: string }).type === 'cancel'),
      'the abort crossed as a cancel message',
    );
    client.close();
  },
);
