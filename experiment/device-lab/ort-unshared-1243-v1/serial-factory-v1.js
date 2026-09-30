// Wrapper around the matching, unmodified ORT1.24.3 serial Emscripten factory.
import createRuntime from './ort-wasm-simd.mjs';
let runtimeRef = null, observedPeakBytes = 0, lastBytes = null, growthTransitions = 0;
export default function createObservedRuntime(config) {
  return createRuntime(config).then(runtime => {
    // Never extend heap lifetime for diagnostics; ORT owns the module.
    if (typeof WeakRef === 'function') runtimeRef = new WeakRef(runtime);
    return runtime;
  });
}
export function snapshotSerialMemory(stage = null) {
  try {
    const runtime = runtimeRef?.deref(), heap = runtime?.HEAPU8, buffer = heap?.buffer;
    const tag = Object.prototype.toString.call(buffer);
    if (!ArrayBuffer.isView(heap) || !['[object ArrayBuffer]','[object SharedArrayBuffer]'].includes(tag)) return {available:false,stage,reason:'Serial module HEAPU8 buffer unavailable'};
    const bytes = buffer.byteLength;
    if (lastBytes !== null && bytes > lastBytes) growthTransitions++;
    lastBytes = bytes; observedPeakBytes = Math.max(observedPeakBytes,bytes);
    return {available:true,stage,source:'Matching Emscripten module HEAPU8.buffer',shared:tag==='[object SharedArrayBuffer]',currentBytes:bytes,observedPeakBytes,observedGrowthTransitions:growthTransitions,scope:'Actual serial runtime linear-memory capacity at snapshots, not peak resident RAM; internal WASM growth is visible at next snapshot'};
  } catch (error) { return {available:false,stage,reason:String(error)}; }
}
