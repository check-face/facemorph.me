import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CPU_MODULE_BYTES,
  CPU_CHUNK_VALUES,
  CPU_SCRATCH_BYTES,
  createCpuKernel,
  sampleCpu,
  wasmCapabilities,
} from '../../src/preflight/wasm-sample.mjs';

test('real WASM f32 arithmetic writes completed values, wraps scratch and cannot grow beyond 4MiB', async () => {
  assert.equal(WebAssembly.validate(CPU_MODULE_BYTES), true);
  const kernel = await createCpuKernel();
  assert.equal(kernel.memory.buffer.byteLength, CPU_SCRATCH_BYTES);
  assert.throws(() => kernel.memory.grow(1), RangeError);
  assert.equal(kernel.memory.buffer.byteLength, CPU_SCRATCH_BYTES);
  const values = new Float32Array(kernel.memory.buffer);
  assert.equal(values[0], 0.5);
  assert.equal(kernel.runChunk(values.length - 1, 2), 1.0003000497817993);
  assert.equal(values[0], 0.5001500248908997);
  assert.equal(values[values.length - 1], 0.5001500248908997);
  assert.equal(values[1], 0.5, 'unvisited elements are untouched');
  for (const [start, count] of [
    [-1, 1],
    [values.length, 1],
    [0, 0],
    [0, CPU_CHUNK_VALUES + 1],
  ] as const)
    assert.throws(() => kernel.runChunk(start, count), /Unbounded/);
});

test('the maximum WASM chunk really completes before yielding, with a fixed iteration ceiling', async () => {
  const kernel = await createCpuKernel();
  let maxChunkMs = 0;
  for (let chunk = 0; chunk < 16; chunk++) {
    const before = performance.now();
    const checksum = kernel.runChunk(chunk * CPU_CHUNK_VALUES);
    maxChunkMs = Math.max(maxChunkMs, performance.now() - before);
    assert.equal(Number.isFinite(checksum), true);
  }
  assert.ok(
    maxChunkMs < 25,
    `32K-value chunk exceeded the test's 25ms completion bound: ${maxChunkMs}`,
  );
  console.log(
    JSON.stringify({
      cpuChunkValues: CPU_CHUNK_VALUES,
      maxChunkMs,
      scratchBytes: CPU_SCRATCH_BYTES,
    }),
  );
});

test('real sampling separates compile/warmup/completed work and stops at its duration', async () => {
  const start = performance.now();
  const result = await sampleCpu(50);
  const elapsedMs = performance.now() - start;
  assert.equal(result.kind, 'result');
  if (result.kind !== 'result') return;
  assert.equal(result.scratchBytes, CPU_SCRATCH_BYTES);
  assert.equal(typeof result.wasmSimd, 'boolean');
  assert.equal(typeof result.wasmThreads, 'boolean');
  assert.ok(result.sample.samples > 0);
  assert.ok(result.sample.compileMs >= 0);
  assert.ok(result.sample.warmupMs >= 0);
  assert.ok(result.sample.completionMs >= 0);
  assert.ok(result.sample.completionMs <= elapsedMs);
  assert.ok(elapsedMs >= 50 && elapsedMs < 500, `real sample window: ${elapsedMs}ms`);
});

test('invalid durations refuse without sampling; capability probes use real WASM', async () => {
  for (const duration of [0, -1, NaN, Infinity, 2001])
    assert.deepEqual(await sampleCpu(duration), { kind: 'unavailable' });
  const capability = wasmCapabilities();
  assert.equal(typeof capability.wasmSimd, 'boolean');
  assert.equal(typeof capability.wasmThreads, 'boolean');
  if (globalThis.crossOriginIsolated !== true) assert.equal(capability.wasmThreads, false);
});
