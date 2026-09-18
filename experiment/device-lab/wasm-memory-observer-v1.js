// Diagnostic only: samples memories constructed after installation in this realm.
// Weak references prevent telemetry from extending a runtime heap's lifetime.
export function installWasmMemoryObserver(root = globalThis) {
  const records = [];
  let namespace, descriptor, original, replacement, installed = false, reason = null;
  let totalConstructed = 0, samples = 0;
  const scope = 'Observed WASM linear-memory capacity in this worker, not resident RAM; excludes other workers, pre-existing/internal-created memories, GPU and browser allocations. Growth between checkpoints may be missed.';
  function snapshot(stage = null) {
    const memories = [];
    for (const record of records) {
      try {
        const memory = record.ref.deref();
        if (!memory) { memories.push({id: record.id, collected: true, observedPeakBytes: record.peak}); continue; }
        const buffer = memory.buffer, bytes = buffer.byteLength;
        if (record.last !== null && bytes > record.last) record.growth++;
        record.last = bytes; record.peak = Math.max(record.peak, bytes);
        memories.push({id: record.id, collected: false, shared: Object.prototype.toString.call(buffer) === '[object SharedArrayBuffer]', currentBytes: bytes, observedPeakBytes: record.peak, observedGrowthTransitions: record.growth});
      } catch { memories.push({id: record.id, available: false}); }
    }
    return {version: 1, available: installed, reason, stage, sample: ++samples, totalConstructed, trackedMemories: records.length, truncated: totalConstructed > records.length, memories, currentObservedBytes: memories.reduce((n,m) => n + (m.currentBytes || 0),0), scope};
  }
  function restore() {
    if (!installed) return;
    try {
      if (namespace.Memory === replacement) Object.defineProperty(namespace, 'Memory', descriptor);
      else reason = 'Constructor changed by another owner; not overwritten during restore';
    } catch { reason = 'Constructor restoration unavailable'; }
    installed = false;
    records.length = 0;
  }
  try {
    namespace = root.WebAssembly;
    if (!namespace || typeof namespace.Memory !== 'function' || typeof root.WeakRef !== 'function') throw Error('WebAssembly.Memory or WeakRef unavailable');
    descriptor = Object.getOwnPropertyDescriptor(namespace, 'Memory');
    if (!descriptor || !('value' in descriptor) || (!descriptor.configurable && !descriptor.writable)) throw Error('Memory constructor cannot be observed safely');
    original = namespace.Memory;
    replacement = new Proxy(original, {construct(target, args, newTarget) {
      // Delegate before inspecting anything: descriptor getters and native errors are unchanged.
      const memory = Reflect.construct(target, args, newTarget);
      try {
        totalConstructed++;
        if (records.length < 32) records.push({id: totalConstructed, ref: new root.WeakRef(memory), last: memory.buffer.byteLength, peak: memory.buffer.byteLength, growth: 0});
      } catch { /* Telemetry must never reject a successful allocation. */ }
      return memory;
    }});
    Object.defineProperty(namespace, 'Memory', {...descriptor, value: replacement});
    installed = true;
  } catch (error) { reason = String(error?.message || error); }
  return {snapshot, restore};
}
