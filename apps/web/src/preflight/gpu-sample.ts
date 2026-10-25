import type { CapabilityFact, SampleResult } from '../contracts/preflight.ts';
import { PREFLIGHT_BUDGETS } from '../contracts/preflight.ts';
import type { GpuAdapter, GpuDevice, GpuLimits } from './types.ts';
import { Scratch } from './types.ts';

const ELEMENTS = 65536;
const BYTES = ELEMENTS * 4;
const WORKGROUP = 64;
// Generated data, strided memory reads and multiply/add arithmetic. Calibration must name
// the kernel family; this is not an encoder, a model canary or a memory-exhaustion probe.
const CODE = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  var value = f32(i % 127u) * 0.0078125;
  for (var k = 0u; k < 64u; k++) {
    value = value * 0.999 + f32((i + k * 17u) % 251u) * 0.0001;
  }
  data[i] = data[i] * 0.001 + value;
}`;

export function admitsGpuSample(limits: GpuLimits): boolean {
  return (
    limits.maxBufferSize >= BYTES &&
    limits.maxStorageBufferBindingSize >= BYTES &&
    limits.maxComputeWorkgroupSizeX >= WORKGROUP &&
    limits.maxComputeInvocationsPerWorkgroup >= WORKGROUP &&
    limits.maxComputeWorkgroupsPerDimension >= ELEMENTS / WORKGROUP
  );
}

/** The device is exposed for lifecycle management (and real loss/validation tests), never inference. */
export async function createGpuSample(adapter: GpuAdapter, signal: AbortSignal, scratch: Scratch) {
  const device = await adapter.requestDevice();
  let disposed = false;
  let started = false;
  let failed = false;
  let buffer: ReturnType<GpuDevice['createBuffer']> | undefined;
  let release: (() => void) | undefined;
  let fail!: () => void;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = () => {
      failed = true;
      reject(Error('gpu-lost'));
    };
  });
  // Attach immediately: device loss may precede run(). No raw driver strings escape.
  void failure.catch(() => {});
  const onError = () => {
    fail();
    dispose();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    device.removeEventListener('uncapturederror', onError);
    signal.removeEventListener('abort', onError);
    buffer?.destroy();
    device.destroy();
    release?.();
  }
  device.addEventListener('uncapturederror', onError);
  signal.addEventListener('abort', onError, { once: true });
  void device.lost.then(() => {
    if (!disposed) onError();
  });
  if (signal.aborted) onError();
  async function run(stopAt: number): Promise<CapabilityFact<SampleResult>> {
    if (started) return { state: 'failed', reason: 'gpu-sample-already-run' };
    started = true;
    if (!Number.isFinite(stopAt)) {
      dispose();
      return { state: 'failed', reason: 'gpu-timeout' };
    }
    stopAt = Math.min(stopAt, performance.now() + PREFLIGHT_BUDGETS.samplingMs);
    if (disposed || failed || signal.aborted) {
      dispose();
      return { state: 'failed', reason: 'gpu-lost' };
    }
    try {
      return await Promise.race([
        failure,
        (async () => {
          device.pushErrorScope('validation');
          release = scratch.acquire(BYTES);
          buffer = device.createBuffer({ size: BYTES, usage: 128 }); // STORAGE
          const compileAt = performance.now();
          const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: CODE }), entryPoint: 'main' },
          });
          const compileMs = performance.now() - compileAt;
          if (disposed || signal.aborted || performance.now() >= stopAt) throw Error('gpu-timeout');
          const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer } }],
          });
          const submit = async () => {
            // Validate setup before submitting, then each bounded unit; an error must
            // end sampling immediately rather than hide in a two-second error scope.
            if (disposed || signal.aborted || performance.now() >= stopAt) return false;
            device.pushErrorScope('validation');
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(ELEMENTS / WORKGROUP);
            pass.end();
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            if (await device.popErrorScope()) throw Error('gpu-validation');
            return true;
          };
          if (await device.popErrorScope()) throw Error('gpu-validation');
          const warmAt = performance.now();
          if (!(await submit())) throw Error('gpu-timeout');
          const warmupMs = performance.now() - warmAt;
          let samples = 0,
            completionMs = 0;
          while (!disposed && !signal.aborted && performance.now() < stopAt) {
            const at = performance.now();
            if (!(await submit())) break;
            completionMs += performance.now() - at;
            samples++;
            // One completed submission at a time, yielding for cancellation/backgrounding.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          if (failed || signal.aborted) throw Error('gpu-lost');
          return samples
            ? { state: 'known' as const, value: { compileMs, warmupMs, completionMs, samples } }
            : { state: 'failed' as const, reason: 'gpu-timeout' };
        })(),
      ]);
    } catch {
      return { state: 'failed', reason: failed ? 'gpu-lost' : 'gpu-unavailable' };
    } finally {
      dispose();
    }
  }
  return { device, run, dispose };
}
