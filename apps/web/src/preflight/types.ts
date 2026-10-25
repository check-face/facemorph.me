import type {
  PreflightEvidence,
  PreflightOutcome,
  RouteEligibility,
  Estimate,
} from '../contracts/preflight.ts';
import { PREFLIGHT_BUDGETS } from '../contracts/preflight.ts';

/** Only check-owned allocations. Never shares a device, buffer or worker with inference. */
export class Scratch {
  current = 0;
  peak = 0;
  resources = 0;
  acquire(bytes: number): () => void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.current + bytes > PREFLIGHT_BUDGETS.scratchBytes
    )
      throw Error('preflight-scratch-budget');
    this.current += bytes;
    this.peak = Math.max(this.peak, this.current);
    this.resources++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current -= bytes;
      this.resources--;
    };
  }
}

export interface CheckResult {
  readonly outcome: PreflightOutcome;
  // Calibration is separate work. A synthetic sample alone never promises a model timing.
  readonly estimate: Estimate;
  readonly evidence: PreflightEvidence;
  readonly storage: { readonly quotaBytes: number | null; readonly usageBytes: number | null };
  readonly coarseMemoryGiB: number | null;
  readonly routes: readonly RouteEligibility[];
  readonly elapsedMs: number;
  readonly samplingMs: number;
  readonly scratchPeakBytes: number;
  readonly resourcesRemaining: number;
  readonly reused: boolean;
}

// Narrow browser interfaces keep the checker independent of any inference/runtime types.
export interface BufferHandle {
  destroy(): void;
}
export interface GpuDevice extends EventTarget {
  readonly lost: Promise<unknown>;
  readonly queue: {
    submit(commands: unknown[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  createBuffer(descriptor: { size: number; usage: number }): BufferHandle;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipelineAsync(descriptor: unknown): Promise<{
    getBindGroupLayout(index: number): unknown;
  }>;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): {
    beginComputePass(): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, group: unknown): void;
      dispatchWorkgroups(count: number): void;
      end(): void;
    };
    finish(): unknown;
  };
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<unknown>;
  destroy(): void;
}
export interface GpuLimits {
  readonly maxBufferSize: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxComputeWorkgroupSizeX: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxComputeWorkgroupsPerDimension: number;
}
export interface GpuAdapter {
  readonly features: Iterable<string>;
  readonly limits: GpuLimits;
  requestDevice(): Promise<GpuDevice>;
}
