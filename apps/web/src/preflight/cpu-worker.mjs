import { sampleCpu } from './wasm-sample.mjs';
// Each worker has one owner and one check. The orchestrator terminates it on skip,
// timeout or backgrounding; no messages start a second allocation or a late sample.
let started = false;
self.onmessage = async ({ data }) => {
  if (started) return;
  started = true;
  let durationMs = data?.durationMs;
  if (data?.stopAtEpochMs !== undefined) {
    durationMs = Number.isFinite(data.stopAtEpochMs)
      ? Math.min(durationMs, data.stopAtEpochMs - (performance.timeOrigin + performance.now()))
      : 0;
  }
  const result =
    data?.kind === 'sample' && typeof durationMs === 'number'
      ? await sampleCpu(durationMs)
      : { kind: 'unavailable' };
  self.postMessage(result);
  self.close();
};
