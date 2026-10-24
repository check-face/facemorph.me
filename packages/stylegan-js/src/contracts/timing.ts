// Stage timing hooks. A hook fires when real work has completed (inference, readback, or GPU
// mapAsync), never at submission, never from a mock and never as a whole bridge-call duration.
// Engine events are reporting-transport-free: the caller decides what, if anything, is reported.

import type { ComputeRoute } from './capability.ts';
import type { OperationIds, OperationKind } from './operations.ts';

/** What the measured end of a stage waited for. */
export type StageCompletionBoundary = 'inference-complete' | 'readback-complete' | 'map-async-complete';

export type EngineStage =
  | 'mapping'
  | 'synthesis'
  | 'readback'
  | 'encoder-session-create'
  | 'encoder-run'
  | 'image-encode'
  | 'video-encode'
  | 'metadata-read';

export interface StageTimingEvent {
  readonly ids: OperationIds;
  readonly operation: OperationKind;
  readonly stage: EngineStage;
  readonly route: ComputeRoute;
  /** Milliseconds on the caller's monotonic clock. */
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly boundary: StageCompletionBoundary;
}

export type StageTimingHook = (event: StageTimingEvent) => void;

/** One bounded e4e encode, measured inside the encoder's own session loop. */
export interface E4eTimings {
  readonly verifiedReadMs: number;
  readonly sessionCreateMs: number;
  readonly runMs: number;
  readonly totalMs: number;
  readonly wasmHeapBytes: number;
  readonly maxLiveSessions: number;
}
