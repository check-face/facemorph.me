// The model-free device check (preflight): capabilities, the WebGPU adapter/features/limits,
// WASM/SIMD/threading, coarse CPU/memory hints, and short worker WASM and small WebGPU compute samples. It
// never references a model asset. A synthetic check never establishes full-model success; scores stay local
// under diagnostics consent.

/** Named budgets, each with its unit in the name. */
export const PREFLIGHT_BUDGETS = Object.freeze({
  samplingMs: 2000,
  uiDeadlineMs: 5000,
  scratchBytes: 16 * 1024 * 1024,
  checkerCodeBytesCompressed: 100 * 1024,
});

export type CapabilityFact<T> = { readonly state: 'known'; readonly value: T } | { readonly state: 'unknown' } | { readonly state: 'failed'; readonly reason: string };

export interface SampleResult {
  /** Measured to completion (readback), never to submission; warmup and compile are separate. */
  readonly warmupMs: number;
  readonly compileMs: number;
  readonly completionMs: number;
  readonly samples: number;
}

export interface PreflightEvidence {
  readonly webgpuAdapter: CapabilityFact<{ readonly features: readonly string[]; readonly maxBufferSize: number }>;
  readonly wasmSimd: CapabilityFact<boolean>;
  readonly wasmThreads: CapabilityFact<boolean>;
  readonly hardwareConcurrency: CapabilityFact<number>;
  readonly deviceMemoryGiB: CapabilityFact<number>;
  readonly cpuSample: CapabilityFact<SampleResult>;
  readonly gpuSample: CapabilityFact<SampleResult>;
}

export type PreflightOutcome = 'ok' | 'skip' | 'timeout' | 'gpu-lost';

/** Eligible for a route, with the model's own check (canaries) still to come. */
export type RouteEligibility =
  | { readonly route: 'cpu' | 'webgpu'; readonly eligibility: 'eligible-model-check-pending' }
  | { readonly route: 'cpu' | 'webgpu'; readonly eligibility: 'not-eligible'; readonly reason: string };

export type EstimateSourceClass = 'recent-actual-device' | 'calibrated-local-check' | 'comparable-device';

export interface CalibrationScope {
  readonly checkpoint: string;
  readonly resolution: number;
  readonly provider: 'cpu' | 'webgpu';
  readonly runtime: string;
  readonly threadMode: 'single' | 'multi';
  readonly workload: string;
}

export type EstimatedStage = 'photo-preprocessing' | 'e4e-per-confirmed-crop' | 'synthesis-per-output' | 'model-load-and-check' | 'video-export';

export interface StageEstimate {
  readonly stage: EstimatedStage;
  /** Milliseconds, low to high. */
  readonly rangeMs: readonly [number, number];
  readonly scope: CalibrationScope;
  readonly source: EstimateSourceClass;
}

export type Estimate = { readonly kind: 'estimate'; readonly stages: readonly StageEstimate[] } | { readonly kind: 'no-reliable-estimate'; readonly outcome: Exclude<PreflightOutcome, 'ok'> };

/** Generator and encoder are admitted separately. */
export interface AdmissionSplit {
  readonly generator: RouteEligibility;
  readonly encoder: RouteEligibility;
}

export interface ConsentCostRow {
  readonly item: 'generator' | 'encoder';
  readonly missingBytes: number;
  readonly downloadRangeMs: readonly [number, number] | 'unknown';
  readonly useRangeMs: readonly [number, number] | 'unknown';
  readonly cache: 'cold' | 'warm';
}

/** A change large enough that the person must approve again. */
export interface MaterialCostChange {
  readonly before: ConsentCostRow;
  readonly after: ConsentCostRow;
  readonly requiresRevisedConsent: true;
}

/** skip, timeout and gpu-lost all mean "no reliable estimate"; only ok can carry stage estimates. */
export function estimateFrom(outcome: PreflightOutcome, stages: readonly StageEstimate[]): Estimate {
  return outcome === 'ok' && stages.length > 0 ? { kind: 'estimate', stages } : { kind: 'no-reliable-estimate', outcome: outcome === 'ok' ? 'skip' : outcome };
}

/** The GPU route is eligible only with a known adapter; the CPU route needs WASM (threads are optional). */
export function eligibility(e: PreflightEvidence): AdmissionSplit {
  const gpu: RouteEligibility =
    e.webgpuAdapter.state === 'known' ? { route: 'webgpu', eligibility: 'eligible-model-check-pending' } : { route: 'webgpu', eligibility: 'not-eligible', reason: e.webgpuAdapter.state === 'failed' ? e.webgpuAdapter.reason : 'no WebGPU adapter' };
  const cpu: RouteEligibility = e.wasmSimd.state === 'failed' ? { route: 'cpu', eligibility: 'not-eligible', reason: e.wasmSimd.reason } : { route: 'cpu', eligibility: 'eligible-model-check-pending' };
  return { generator: gpu.eligibility === 'eligible-model-check-pending' ? gpu : cpu, encoder: cpu };
}
