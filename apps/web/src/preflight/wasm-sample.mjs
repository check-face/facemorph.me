// Model-free generated WASM only. No runtime, assets, storage or diagnostics dependency.
export const CPU_SCRATCH_BYTES = 4 * 1024 * 1024;
export const CPU_CHUNK_VALUES = 32 * 1024;
const VALUES = CPU_SCRATCH_BYTES / 4;
const MAX_DURATION_MS = 2000;
const unsigned = (value) => {
  const bytes = [];
  do {
    const part = value & 127;
    value >>>= 7;
    bytes.push(part | (value ? 128 : 0));
  } while (value);
  return bytes;
};
const section = (id, bytes) => [id, ...unsigned(bytes.length), ...bytes];
const name = (text) => [text.length, ...Array.from(text, (c) => c.charCodeAt(0))];
const f32 = (value) => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buffer));
};
const HEADER = [0, 97, 115, 109, 1, 0, 0, 0];
// (start:i32, count:i32)->f32: scratch[(start+i)&mask] = x*1.0001 + .0001;
// return the completed sum. The host bounds each call; wrapping visits all scratch pages.
const body = [
  2,
  2,
  0x7f,
  2,
  0x7d, // locals: i/address i32, value/sum f32
  0x02,
  0x40,
  0x03,
  0x40, // block / loop
  0x20,
  2,
  0x20,
  1,
  0x4f,
  0x0d,
  1, // if i >= count: exit
  0x20,
  0,
  0x20,
  2,
  0x6a,
  0x41,
  ...unsigned(VALUES - 1),
  0x71,
  0x41,
  2,
  0x74,
  0x21,
  3, // address = ((start+i)&mask)<<2
  0x20,
  3,
  0x2a,
  2,
  0,
  0x43,
  ...f32(1.0001),
  0x94,
  0x43,
  ...f32(0.0001),
  0x92,
  0x21,
  4,
  0x20,
  3,
  0x20,
  4,
  0x38,
  2,
  0, // store computed value
  0x20,
  5,
  0x20,
  4,
  0x92,
  0x21,
  5, // sum += value
  0x20,
  2,
  0x41,
  1,
  0x6a,
  0x21,
  2,
  0x0c,
  0,
  0x0b,
  0x0b,
  0x20,
  5,
  0x0b,
];
export const CPU_MODULE_BYTES = new Uint8Array([
  ...HEADER,
  ...section(1, [1, 0x60, 2, 0x7f, 0x7f, 1, 0x7d]),
  ...section(3, [1, 0]),
  ...section(5, [1, 1, 64, 64]), // 64 pages, maximum exactly 4 MiB
  ...section(7, [2, ...name('memory'), 2, 0, ...name('run'), 0, 0]),
  ...section(10, [1, ...unsigned(body.length), ...body]),
]);
// A real SIMD v128.const module, validated without compiling or executing a sample.
const simdBody = [0, 0xfd, 0x0c, ...Array(16).fill(0), 0x0b];
const SIMD_BYTES = new Uint8Array([
  ...HEADER,
  ...section(1, [1, 0x60, 0, 1, 0x7b]),
  ...section(3, [1, 0]),
  ...section(10, [1, ...unsigned(simdBody.length), ...simdBody]),
]);
export function wasmCapabilities() {
  let wasmSimd = false,
    wasmThreads = false;
  try {
    wasmSimd = WebAssembly.validate(SIMD_BYTES);
  } catch {}
  if (globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function') {
    try {
      // Zero pages: detect the permitted shared-memory capability without reserving scratch
      // or spawning a thread. This does not imply multithreaded model admission.
      wasmThreads =
        new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true }).buffer instanceof
        SharedArrayBuffer;
    } catch {}
  }
  return { wasmSimd, wasmThreads };
}
export async function createCpuKernel() {
  const began = performance.now();
  const module = await WebAssembly.compile(CPU_MODULE_BYTES);
  const compileMs = performance.now() - began;
  const setupAt = performance.now();
  const instance = await WebAssembly.instantiate(module);
  const { memory, run } = instance.exports;
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof run !== 'function' ||
    memory.buffer.byteLength !== CPU_SCRATCH_BYTES
  )
    throw Error('Invalid WASM sample exports');
  new Float32Array(memory.buffer).fill(0.5);
  return {
    memory,
    compileMs,
    setupMs: performance.now() - setupAt,
    /** @param {number} start @param {number} [count] */
    runChunk(start, count = CPU_CHUNK_VALUES) {
      if (
        !Number.isInteger(start) ||
        start < 0 ||
        start >= VALUES ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > CPU_CHUNK_VALUES
      )
        throw Error('Unbounded WASM sample chunk');
      const completed = run(start, count);
      if (typeof completed !== 'number' || !Number.isFinite(completed))
        throw Error('Invalid WASM sample output');
      return completed;
    },
  };
}
/**
 * @returns {Promise<{kind:'unavailable'} | {kind:'result', wasmSimd:boolean,
 * wasmThreads:boolean, scratchBytes:number, sample:import('../contracts/preflight.ts').SampleResult}>}
 */
export async function sampleCpu(durationMs = MAX_DURATION_MS) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS)
    return { kind: 'unavailable' };
  const stopAt = performance.now() + durationMs;
  try {
    const capabilities = wasmCapabilities();
    const kernel = await createCpuKernel();
    if (performance.now() >= stopAt) return { kind: 'unavailable' };
    const warmupAt = performance.now();
    kernel.runChunk(0);
    const warmupMs = kernel.setupMs + performance.now() - warmupAt;
    let samples = 0,
      completionMs = 0,
      cursor = CPU_CHUNK_VALUES;
    while (performance.now() < stopAt) {
      const before = performance.now();
      const completed = kernel.runChunk(cursor);
      if (!Number.isFinite(completed)) return { kind: 'unavailable' };
      completionMs += performance.now() - before;
      samples++;
      cursor = (cursor + CPU_CHUNK_VALUES) % VALUES;
      // Timer yields let worker termination/cancellation run between fixed-size units.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return samples
      ? {
          kind: 'result',
          ...capabilities,
          scratchBytes: kernel.memory.buffer.byteLength,
          sample: { compileMs: kernel.compileMs, warmupMs, completionMs, samples },
        }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
