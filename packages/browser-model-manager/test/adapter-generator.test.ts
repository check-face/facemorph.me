// The generator ORT adapter on a loaded handle (fm-ffn7), with the real model: the acquired candidate runtime read
// through a verifying local reader, onnxruntime-web's WASM backend, the candidate's own canary qualification
// (apps/web/src/Next/browser/canary-qualification.mjs) and its decoder. Where the runtime has not been acquired, every
// test here is reported untested.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as ort from 'onnxruntime-web';
import {
  loadOrtGenerator,
  type GeneratorManifest,
  type OrtGenerator,
  type OrtModule,
} from '../src/adapters/ort-generator.ts';
import { createLoadedHandle, HandleUnavailable } from '../src/handles/handle.ts';
import { createLeaseRegistry, evictUnleased } from '../src/handles/leases.ts';
import { acquiredManifest, runtimeReader } from './support/runtime-reader.ts';

const runtime = acquiredManifest();
const untested =
  'untested: the candidate runtime is not acquired here (scripts/runtime/acquire.mjs)';
const manifest = runtime?.manifest as unknown as GeneratorManifest & {
  canaries: { name: string; noise?: string }[];
  sampleIndices: unknown;
};

// The candidate's CPU route (onnxruntime-web 1.24.3 in Chromium) on the same canaries, recorded on eris on 24 October
// 2026 (tools/ort-qualify, pinned run): maxRgb and maxFloat per canary.
const CANDIDATE_CPU = {
  'frame-00': [1, 0.000004470348358154297],
  'frame-25': [1, 0.0000033080577850341797],
  'encoded-synthetic-photo': [1, 0.0000036954879760742188],
  'zero-noise': [1, 0.000005304813385009766],
  'alternate-noise': [1, 0.0000027120113372802734],
  'trunc-psi-0': [1, 0.0000030994415283203125],
  'trunc-psi-1': [1, 0.000004947185516357422],
} as const;

const ids = (n: number) => ({ requestId: `r${n}`, inputRevision: n, attemptId: 0 });
async function load(reads: string[] = []): Promise<OrtGenerator> {
  const r = await loadOrtGenerator({
    ort: ort as unknown as OrtModule,
    reader: runtimeReader(reads),
    manifest,
    manifestSha256: runtime!.sha256,
  });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.value;
}

test(
  'a real synthesis matches the candidate CPU path on every canary, at the fixed gates',
  { timeout: 600_000 },
  async (t) => {
    if (!runtime) return t.skip(untested);
    const generator = await load();
    t.after(() => generator.dispose());
    const { createCanaryQualification } = (await import(
      '../../../apps/web/src/Next/browser/canary-qualification.mjs' as string
    )) as {
      createCanaryQualification(o: unknown): {
        runNext(): Promise<unknown>;
        complete(): boolean;
        checks(): { name: string; maxRgb: number; maxFloat: number; passed: boolean }[];
      };
    };
    const reader = runtimeReader();
    const records = new Map<string, unknown>();
    const q = createCanaryQualification({
      manifest,
      manifestSha256: runtime.sha256,
      provider: 'wasm',
      bundle: manifest.synthesis,
      records: {
        get: async (k: string) => records.get(k),
        put: async (k: string, v: unknown) => void records.set(k, v),
      },
      acquireBytes: async (asset: Parameters<typeof reader.read>[0]) => {
        const r = await reader.read(asset);
        if (!r.ok) throw Error(r.error.message);
        return r.value;
      },
      runSynthesis: (values: Float32Array, noise: string) =>
        generator.synthesizeRaw(values, noise as 'original' | 'zero' | 'alternate'),
      full: true,
    });
    while (!q.complete()) await q.runNext();
    const checks = q.checks();
    assert.equal(checks.length, 7);
    for (const c of checks) {
      t.diagnostic(`${c.name}: maxRgb ${c.maxRgb}, maxFloat ${c.maxFloat}`);
      assert.equal(c.passed, true, `${c.name} passes RGB <= 1 and sampled float <= 0.002`);
      assert.deepEqual(
        [c.maxRgb, c.maxFloat],
        CANDIDATE_CPU[c.name as keyof typeof CANDIDATE_CPU],
        `${c.name} equals the candidate's`,
      );
    }
  },
);

test(
  'timing hooks fire when the output has been read back, not when the run was submitted; dispose releases both sessions',
  { timeout: 300_000 },
  async (t) => {
    if (!runtime) return t.skip(untested);
    const generator = await load();
    assert.ok(
      generator.loadTimings.sessionCreateMs > 0 && generator.loadTimings.verifiedReadMs > 0,
    );
    const events: {
      stage: string;
      startedAtMs: number;
      completedAtMs: number;
      boundary: string;
    }[] = [];
    const z = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i));
    const mapped = await generator.map(
      { ids: ids(1), z, truncation: { psi: 0.7, cutoff: 8 } },
      undefined,
      (e) => events.push(e),
    );
    assert.equal(mapped.wPlus.values.length, 18 * 512);
    const submitted = performance.now();
    let settledAt = 0;
    const result = await generator
      .synthesize(
        { ids: ids(2), wPlus: mapped.wPlus, output: 'rgba-and-raw-float' },
        undefined,
        (e) => events.push(e),
      )
      .finally(() => (settledAt = performance.now()));
    assert.equal(result.rgba.length, 1024 * 1024 * 4);
    assert.equal(result.rawFloat?.length, 3 * 1024 * 1024);
    const synth = events.find((e) => e.stage === 'synthesis')!;
    assert.equal(synth.boundary, 'readback-complete');
    assert.ok(synth.startedAtMs >= submitted - 1 && synth.completedAtMs <= settledAt + 1);
    // A CPU synthesis takes over a second: an event emitted at submission would last almost nothing.
    assert.ok(
      synth.completedAtMs - synth.startedAtMs > 250,
      `synthesis lasted ${synth.completedAtMs - synth.startedAtMs} ms`,
    );
    assert.equal(events.find((e) => e.stage === 'mapping')?.boundary, 'readback-complete');
    assert.deepEqual(generator.inspect(), { liveSessions: 2, disposed: false });
    await generator.dispose();
    assert.deepEqual(
      generator.inspect(),
      { liveSessions: 0, disposed: true },
      'dispose releases both sessions',
    );
    await assert.rejects(
      generator.synthesize({ ids: ids(3), wPlus: mapped.wPlus, output: 'rgba' }),
      /disposed/,
    );
  },
);

test(
  'a leased asset survives manager eviction; release lets it go',
  { timeout: 300_000 },
  async (t) => {
    if (!runtime) return t.skip(untested);
    const generator = await load();
    const registry = createLeaseRegistry();
    const handle = createLoadedHandle({
      manifestSha256: runtime.sha256,
      capability: generator,
      assets: generator.assets,
      registry,
    });
    // A real store on disk: one file per asset digest, as the shard store keeps them.
    const dir = mkdtempSync(join(tmpdir(), 'manager-store-'));
    const store = { remove: async (sha: string) => rmSync(join(dir, sha), { force: true }) };
    const leased = manifest.average.sha256;
    const unleased = 'f'.repeat(64);
    for (const sha of [leased, unleased]) writeFileSync(join(dir, sha), sha);
    const first = await evictUnleased([leased, unleased], [store], registry);
    assert.deepEqual(first, { removed: [unleased], kept: [leased] });
    assert.ok(existsSync(join(dir, leased)) && !existsSync(join(dir, unleased)));
    await handle.release();
    assert.deepEqual(registry.leased(), [], 'release lets every lease go (no leak)');
    assert.deepEqual(generator.inspect(), { liveSessions: 0, disposed: true }, 'and every session');
    assert.deepEqual(await evictUnleased([leased], [store], registry), {
      removed: [leased],
      kept: [],
    });
    rmSync(dir, { recursive: true, force: true });
  },
);

test(
  'a deletion in another tab invalidates the handle while an operation is loading: it settles with a typed error and releases, reading nothing more',
  { timeout: 300_000 },
  async (t) => {
    if (!runtime) return t.skip(untested);
    const reads: string[] = [];
    const generator = await load(reads); // the mapping session is created on first map(), from verified reads
    const registry = createLeaseRegistry();
    const handle = createLoadedHandle({
      manifestSha256: runtime.sha256,
      capability: generator,
      assets: generator.assets,
      registry,
    });
    const causes: string[] = [];
    handle.onInvalidated((c) => causes.push(c));
    const { listenForDeletions, DELETION_CHANNEL } = await import('../src/handles/cross-tab.ts');
    const channel = new BroadcastChannel(DELETION_CHANNEL);
    const stop = listenForDeletions(channel, registry);
    // The other tab: a real separate thread on the real channel, deleting the mapping model when told to.
    const { Worker } = await import('node:worker_threads');
    const other = new Worker(
      `const { parentPort } = require('node:worker_threads');
     const c = new BroadcastChannel(${JSON.stringify(DELETION_CHANNEL)});
     parentPort.on('message', () => { c.postMessage({ type: 'deleted', sha256s: [${JSON.stringify(manifest.mapping.sha256)}] }); c.close(); parentPort.close(); });
     parentPort.postMessage('ready');`,
      { eval: true },
    );
    t.after(async () => {
      stop();
      channel.close();
      await other.terminate();
    });
    await new Promise((r) => other.once('message', r));
    const z = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i));
    const running = handle.capability.map({ ids: ids(9), z, truncation: { psi: 0.7, cutoff: 8 } });
    other.postMessage('delete');
    const error = await running.then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof HandleUnavailable, `settled with ${String(error)}`);
    assert.deepEqual(error.error, {
      code: 'invalidated',
      cause: 'cross-tab-deletion',
      message: error.error.message,
    });
    assert.deepEqual(causes, ['cross-tab-deletion']);
    assert.deepEqual(handle.inspect(), { pending: 0, state: 'invalidated' });
    const readsAtSettle = reads.length;
    await handle.release();
    assert.deepEqual(registry.leased(), [], 'leases released');
    assert.deepEqual(
      generator.inspect(),
      { liveSessions: 0, disposed: true },
      'sessions released, none created late',
    );
    assert.equal(reads.length, readsAtSettle, 'nothing more was read: no repair, no refetch');
    await assert.rejects(
      handle.capability.map({ ids: ids(10), z, truncation: { psi: 0.7, cutoff: 8 } }),
      HandleUnavailable,
    );
  },
);
