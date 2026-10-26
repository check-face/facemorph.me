import { PREFLIGHT_BUDGETS, estimateFrom } from '../contracts/preflight.ts';
import type {
  CapabilityFact,
  PreflightEvidence,
  PreflightOutcome,
  RouteEligibility,
  SampleResult,
} from '../contracts/preflight.ts';
import { admitsGpuSample, createGpuSample } from './gpu-sample.ts';
import { Scratch } from './types.ts';
import type { CheckResult, GpuAdapter } from './types.ts';

const unknown = <T>(): CapabilityFact<T> => ({ state: 'unknown' });
const known = <T>(value: T): CapabilityFact<T> => ({ state: 'known', value });
const failed = <T>(reason: string): CapabilityFact<T> => ({ state: 'failed', reason });
const fact = (value: unknown): CapabilityFact<number> =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? known(value) : unknown();
let recent: { at: number; key: string; value: CheckResult } | undefined;
let cancelActive: (() => void) | undefined;

/** Browser-rounded memory is a coarse hint, never usable capacity or an allocation budget. */
export function memoryHint(_value: unknown): CapabilityFact<number> {
  return unknown();
}
export function storageFact(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function cacheKey(): string {
  return `${navigator.userAgent}|${navigator.hardwareConcurrency}|${crossOriginIsolated}`;
}

/** Local ephemeral reuse only: no storage, diagnostics events, model assets or inference imports. */
export async function checkDevice(
  options: {
    signal?: AbortSignal;
    rerun?: boolean;
    declined?: boolean;
    idle?: Promise<unknown>;
  } = {},
): Promise<CheckResult> {
  const start = performance.now();
  const scratch = new Scratch();
  const controller = new AbortController();
  let outcome: PreflightOutcome = 'ok';
  let worker: Worker | undefined;
  let releaseWorker: (() => void) | undefined;
  let gpu: Awaited<ReturnType<typeof createGpuSample>> | undefined;
  let sampleAt: number | undefined;
  let sampleEnd: number | undefined;
  let idle: number | undefined;
  let samplingTimer: ReturnType<typeof setTimeout> | undefined;
  const e: { -readonly [K in keyof PreflightEvidence]: PreflightEvidence[K] } = {
    webgpuAdapter: unknown(),
    wasmSimd: unknown(),
    wasmThreads: unknown(),
    hardwareConcurrency: fact(navigator.hardwareConcurrency),
    deviceMemoryGiB: memoryHint((navigator as Navigator & { deviceMemory?: number }).deviceMemory),
    cpuSample: unknown(),
    gpuSample: unknown(),
  };
  const storage = { quotaBytes: null as number | null, usageBytes: null as number | null };
  let end!: () => void;
  const stopped = new Promise<void>((resolve) => {
    end = resolve;
  });
  function cleanup() {
    if (idle !== undefined) cancelIdleCallback(idle);
    if (samplingTimer !== undefined) clearTimeout(samplingTimer);
    worker?.terminate();
    worker = undefined;
    releaseWorker?.();
    releaseWorker = undefined;
    gpu?.dispose();
  }
  function stop(reason: PreflightOutcome) {
    if (controller.signal.aborted) return;
    outcome = reason;
    controller.abort();
    cleanup();
    sampleEnd ??= performance.now();
    end();
  }
  const onAbort = () => stop('skip');
  const onVisible = () => {
    if (document.visibilityState !== 'visible') stop('skip');
  };
  cancelActive?.();
  const cancelThis = () => stop('skip');
  cancelActive = cancelThis;
  const deadline = setTimeout(() => stop('timeout'), PREFLIGHT_BUDGETS.uiDeadlineMs);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  document.addEventListener('visibilitychange', onVisible);
  const key = cacheKey();
  try {
    if (options.declined || options.signal?.aborted || document.visibilityState !== 'visible')
      stop('skip');
    if (
      !controller.signal.aborted &&
      !options.rerun &&
      recent?.key === key &&
      start - recent.at < 5 * 60_000
    )
      return { ...structuredClone(recent.value), reused: true };
    const work = async () => {
      // Wait for a visible idle turn. The overall deadline still applies if the page remains busy.
      await new Promise<void>((resolve) => {
        if ('requestIdleCallback' in globalThis) idle = requestIdleCallback(() => resolve());
        else setTimeout(resolve, 0);
      });
      // A caller can additionally wait for the application's real compute-idle boundary.
      // Waiting holds no worker, device or scratch allocation; the UI deadline still applies.
      await options.idle;
      if (controller.signal.aborted) return;
      const browserGpu = (
        navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }
      ).gpu;
      const [adapter] = await Promise.all([
        browserGpu?.requestAdapter().catch(() => null) ?? null,
        navigator.storage
          ?.estimate()
          .then((s) => {
            if (!controller.signal.aborted) {
              storage.quotaBytes = storageFact(s.quota);
              storage.usageBytes = storageFact(s.usage);
            }
          })
          .catch(() => {}),
      ]);
      if (controller.signal.aborted) return;
      if (adapter)
        e.webgpuAdapter = known({
          features: [...adapter.features].sort(),
          maxBufferSize: adapter.limits.maxBufferSize,
        });
      else e.webgpuAdapter = failed('no-webgpu-adapter');
      sampleAt = performance.now();
      const stopAt = sampleAt + PREFLIGHT_BUDGETS.samplingMs;
      // End submissions at the sample boundary; termination bounds even a stuck WASM worker.
      samplingTimer = setTimeout(() => {
        if (e.cpuSample.state === 'unknown') e.cpuSample = failed('wasm-timeout');
        if (e.gpuSample.state === 'unknown') e.gpuSample = failed('gpu-timeout');
        stop('timeout');
      }, PREFLIGHT_BUDGETS.samplingMs);
      const cpu = new Promise<void>((resolve) => {
        try {
          releaseWorker = scratch.acquire(4 * 1024 * 1024);
          worker = new Worker(new URL('./cpu-worker.mjs', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }) => {
            if (controller.signal.aborted) return;
            if (data.kind === 'result') {
              e.cpuSample = known(data.sample as SampleResult);
              e.wasmSimd = known(Boolean(data.wasmSimd));
              e.wasmThreads = known(Boolean(data.wasmThreads));
            } else e.cpuSample = failed('wasm-unavailable');
            worker?.terminate();
            worker = undefined;
            releaseWorker?.();
            releaseWorker = undefined;
            resolve();
          };
          worker.onerror = () => {
            e.cpuSample = failed('wasm-unavailable');
            worker?.terminate();
            worker = undefined;
            releaseWorker?.();
            releaseWorker = undefined;
            resolve();
          };
          // Leave a small delivery margin before the hard sampling bound.
          worker.postMessage({
            kind: 'sample',
            durationMs: PREFLIGHT_BUDGETS.samplingMs,
            stopAtEpochMs: performance.timeOrigin + stopAt - 75,
          });
        } catch {
          e.cpuSample = failed('wasm-unavailable');
          releaseWorker?.();
          releaseWorker = undefined;
          resolve();
        }
      });
      const gpuWork = async () => {
        if (!adapter || !admitsGpuSample(adapter.limits)) {
          e.gpuSample = failed(adapter ? 'gpu-limits' : 'no-webgpu-adapter');
          return;
        }
        try {
          const session = await createGpuSample(adapter, controller.signal, scratch);
          if (controller.signal.aborted || performance.now() >= stopAt) {
            session.dispose();
            return;
          }
          gpu = session;
          const sample = await session.run(stopAt - 30);
          if (controller.signal.aborted) return;
          e.gpuSample = sample;
          if (e.gpuSample.state === 'failed')
            outcome = e.gpuSample.reason === 'gpu-lost' ? 'gpu-lost' : 'skip';
        } catch {
          if (!controller.signal.aborted) {
            e.gpuSample = failed('gpu-unavailable');
            outcome = 'skip';
          }
        }
      };
      await Promise.all([cpu, gpuWork()]);
      sampleEnd = performance.now();
      end();
    };
    if (!controller.signal.aborted) void work().catch(() => stop('skip'));
    await stopped;
    controller.abort();
    cleanup();
    if (e.cpuSample.state !== 'known' && outcome === 'ok') outcome = 'skip';
    const routes: RouteEligibility[] = [
      { route: 'cpu', eligibility: 'eligible-model-check-pending' },
      e.webgpuAdapter.state === 'known'
        ? { route: 'webgpu', eligibility: 'eligible-model-check-pending' }
        : { route: 'webgpu', eligibility: 'not-eligible', reason: 'no-webgpu-adapter' },
    ];
    const result: CheckResult = {
      outcome,
      estimate: estimateFrom(outcome, []),
      evidence: structuredClone(e),
      storage: { ...storage },
      coarseMemoryGiB: storageFact(
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      ),
      routes,
      elapsedMs: performance.now() - start,
      samplingMs: sampleAt === undefined ? 0 : (sampleEnd ?? performance.now()) - sampleAt,
      scratchPeakBytes: scratch.peak,
      resourcesRemaining: scratch.resources,
      reused: false,
    };
    if (outcome === 'ok') recent = { at: performance.now(), key, value: structuredClone(result) };
    return result;
  } finally {
    controller.abort();
    cleanup();
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', onAbort);
    document.removeEventListener('visibilitychange', onVisible);
    if (cancelActive === cancelThis) cancelActive = undefined;
  }
}
